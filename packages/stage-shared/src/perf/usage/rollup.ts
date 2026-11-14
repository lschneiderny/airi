import type { IdentityRecord, PerfRecord, RollupFailedRecord, SampleRecord, SegmentRollupRecord, SessionStartRecord, WindowRollupRecord } from './records'
import type { SegmentCellKey } from './rollup-cell'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'
import { FixedHistogram } from './histogram'
import { PERF_RECORD_VERSION, USAGE_FEATURE_KEYS } from './records'
import { SegmentCellAccumulator } from './rollup-cell'
import { RollupExclusions } from './rollup-exclusions'

export { ROLLUP_EVENT_SETTLING_MS, ROLLUP_SESSION_SETTLING_MS } from './rollup-exclusions'

/** A window rollup takes CPU, memory, and contention from the latest sample at most this far from it. */
export const ROLLUP_SAMPLE_JOIN_MS = 7500
/** The recorder tick; the first rollup of a window in a segment is taken to cover one tick. */
const RECORDER_TICK_MS = 5000

export class SegmentRollupFinishedError extends Error {
  constructor() {
    super('SegmentRollupReducer was already finished')
    this.name = 'SegmentRollupFinishedError'
  }
}

export interface SegmentRollupFinish {
  /** Time of the segment's last line; also the rollup row's `t`. */
  readonly endedAt: number
  /** The session ended without `recording-stop` and no later segment followed. */
  readonly recovered: boolean
  /** Lines the caller could not parse (`parsePerfLine` json, schema, or version failures). */
  readonly malformedLines: number
  readonly rawBytes: number
}

/** A stage window rollup with the interval it covers, `(startMs, record.t]`, and what the sample join gave it. */
interface WindowEntry {
  readonly record: WindowRollupRecord
  readonly startMs: number
  readonly cpuPct: number | null
  readonly workingSetKb: number | null
  /** Unknown contention (no sample to join) counts as contended, so it never reaches calm comparisons. */
  readonly hostContended: boolean
  incidents: number
  /** `undefined` while undecided, then the window's cell, or `null` when excluded or unusable. */
  cell: SegmentCellAccumulator | null | undefined
}

function isWellFormed(record: WindowRollupRecord): boolean {
  if (record.frameHist.length !== FRAME_BINS_V1.edges.length + 1)
    return false
  return Object.values(record.stages ?? {}).every(stage =>
    stage.hist.every(([binIndex]) => Number.isInteger(binIndex) && binIndex >= 0 && binIndex <= STAGE_BINS_V1.edges.length))
}

/**
 * Reduces one raw segment (`raw/<sessionId>.<segment>.jsonl`) into its `segment-rollup` row, streaming records in
 * file order. Records it cannot use (another session, a row kind that belongs elsewhere, a duplicate or
 * out-of-order rollup or sample, a histogram of the wrong shape, a rollup before `session-start` or of an epoch
 * without `identity`) are counted into `malformedLines`, never thrown.
 *
 * A window is decided when the next tick's `sample` arrives, because the recorder writes events queued during a
 * tick (suspend, resume, model load) after that tick's rollups; an event written later does not reach back.
 * Excluded windows are counted in `excludedWindows`: hidden, paused, frameless, overlapping the first 60 s after
 * `session-start`, overlapping 20 s from a model load, resume, renderer reload, or new identity epoch, or spanning
 * a suspend..resume gap. A segment after the first starts with its own `session-start`, so its first 60 s are
 * excluded too.
 */
export class SegmentRollupReducer {
  readonly #sessionId: string
  readonly #segment: number
  #sessionStart: SessionStartRecord | null = null
  readonly #identities = new Map<number, IdentityRecord>()
  #latestSample: SampleRecord | null = null
  readonly #latestRollupMs = new Map<string, number>()
  readonly #latestEntry = new Map<string, WindowEntry>()
  #pending: WindowEntry[] = []
  readonly #exclusions = new RollupExclusions()
  readonly #incidentIds = new Set<string>()
  readonly #cells = new Map<string, SegmentCellAccumulator>()
  readonly #shares = new FixedHistogram(FRAME_BINS_V1)
  #unusable = 0
  #excluded = 0
  #recorderMs = 0
  #finished = false

  constructor(segment: { readonly sessionId: string, readonly segment: number }) {
    this.#sessionId = segment.sessionId
    this.#segment = segment.segment
  }

  /** @throws {SegmentRollupFinishedError} after `finish`. */
  push(record: PerfRecord): void {
    if (this.#finished)
      throw new SegmentRollupFinishedError()
    if (record.sessionId !== this.#sessionId) {
      this.#unusable += 1
      return
    }
    switch (record.kind) {
      case 'session-start':
        if (this.#sessionStart !== null || record.segment !== this.#segment)
          this.#unusable += 1
        else
          this.#sessionStart = record
        break
      case 'identity':
        if (this.#identities.size > 0 && !this.#identities.has(record.epoch))
          this.#exclusions.addIdentityChange(record.t)
        this.#identities.set(record.epoch, record)
        break
      case 'sample':
        this.#pushSample(record)
        break
      case 'window-rollup':
        this.#pushWindow(record)
        break
      case 'event':
        this.#exclusions.addEvent(record)
        break
      case 'incident':
        this.#pushIncident(record.id, record.window)
        break
      case 'segment-rollup':
      case 'rollup-failed':
      case 'bench-run':
        this.#unusable += 1
        break
      default: {
        const unhandled: never = record
        return unhandled
      }
    }
  }

  /**
   * Decides the remaining windows and returns the `segment-rollup` row, or a `rollup-failed` row when the segment
   * has no usable `session-start` or names bins other than the v1 bins.
   * @throws {SegmentRollupFinishedError} when called twice.
   */
  finish(params: SegmentRollupFinish): SegmentRollupRecord | RollupFailedRecord {
    if (this.#finished)
      throw new SegmentRollupFinishedError()
    this.#finished = true
    const header = { v: PERF_RECORD_VERSION, t: params.endedAt, sessionId: this.#sessionId } as const
    const sessionStart = this.#sessionStart
    if (sessionStart === null)
      return { ...header, kind: 'rollup-failed', segment: this.#segment, reason: 'missing-session-start' }
    if (sessionStart.frameBins !== FRAME_BINS_V1.id || sessionStart.stageBins !== STAGE_BINS_V1.id)
      return { ...header, kind: 'rollup-failed', segment: this.#segment, reason: 'unsupported-bins' }
    this.#decidePending(sessionStart)
    return {
      ...header,
      kind: 'segment-rollup',
      segment: this.#segment,
      startedAt: sessionStart.t,
      endedAt: params.endedAt,
      recovered: params.recovered,
      malformedLines: params.malformedLines + this.#unusable,
      excludedWindows: this.#excluded,
      cells: [...this.#cells.values()].map(cell => cell.toCell()),
      recorderMs: this.#recorderMs,
      rawBytes: params.rawBytes,
      host: sessionStart.host,
      buildMode: sessionStart.buildMode,
    }
  }

  #pushSample(record: SampleRecord): void {
    if (this.#latestSample !== null && record.t <= this.#latestSample.t) {
      this.#unusable += 1
      return
    }
    this.#latestSample = record
    this.#recorderMs += record.recorderMs
    if (this.#sessionStart !== null)
      this.#decidePending(this.#sessionStart)
  }

  #pushWindow(record: WindowRollupRecord): void {
    const latestMs = this.#latestRollupMs.get(record.window)
    if (this.#sessionStart === null || !isWellFormed(record) || (latestMs !== undefined && record.t <= latestMs)) {
      this.#unusable += 1
      return
    }
    this.#latestRollupMs.set(record.window, record.t)
    this.#recorderMs += record.recorderUs / 1000
    const sample = this.#latestSample !== null && Math.abs(record.t - this.#latestSample.t) <= ROLLUP_SAMPLE_JOIN_MS ? this.#latestSample : null
    const process = sample?.processes.find(candidate => candidate.role === `window:${record.window}`)
    const entry: WindowEntry = {
      record,
      startMs: latestMs ?? record.t - RECORDER_TICK_MS,
      cpuPct: process?.cpuPctOfCore ?? null,
      workingSetKb: process?.workingSetKb ?? null,
      hostContended: sample?.hostContended ?? true,
      incidents: 0,
      cell: undefined,
    }
    this.#latestEntry.set(record.window, entry)
    this.#pending.push(entry)
  }

  /** Counts an incident toward the cell of its window's latest rollup; incidents of other windows count nowhere. */
  #pushIncident(id: string, window: string | undefined): void {
    if (this.#incidentIds.has(id)) {
      this.#unusable += 1
      return
    }
    this.#incidentIds.add(id)
    const entry = window === undefined ? undefined : this.#latestEntry.get(window)
    if (entry?.cell === undefined) {
      if (entry !== undefined)
        entry.incidents += 1
      return
    }
    if (entry.cell !== null)
      entry.cell.incidents += 1
  }

  #decidePending(sessionStart: SessionStartRecord): void {
    for (const entry of this.#pending)
      this.#decide(entry, sessionStart)
    this.#pending = []
  }

  #decide(entry: WindowEntry, sessionStart: SessionStartRecord): void {
    const { record } = entry
    entry.cell = null
    const identity = this.#identities.get(record.epoch)
    if (identity === undefined) {
      this.#unusable += 1
      return
    }
    const p50FrameMs = FixedHistogram.approxQuantile(record.frameHist, FRAME_BINS_V1.edges, 0.5)
    const excluded = !record.visible || record.paused || this.#exclusions.excludes({ startMs: entry.startMs, endMs: record.t }, sessionStart.t)
    if (p50FrameMs === null || excluded) {
      this.#excluded += 1
      return
    }
    const cell = this.#cellFor(entry, identity)
    this.#shares.reset()
    this.#shares.mergeFrom(record.frameHist)
    cell.add({
      record,
      p50FrameMs,
      share21: this.#shares.shareAtLeast(21),
      share36: this.#shares.shareAtLeast(36),
      share100: this.#shares.shareAtLeast(100),
      cpuPct: entry.cpuPct,
      workingSetKb: entry.workingSetKb,
      incidents: entry.incidents,
    })
    entry.cell = cell
  }

  #cellFor(entry: WindowEntry, identity: IdentityRecord): SegmentCellAccumulator {
    const { record } = entry
    const { tags } = record
    const key: SegmentCellKey = {
      epoch: record.epoch,
      sha: identity.sha,
      dirty: identity.dirty,
      diffHash: identity.diffHash,
      window: record.window,
      renderer: tags.renderer,
      modelId: tags.modelId,
      featureHash: tags.featureHash,
      features: tags.features,
      activity: tags.activity,
      hostContended: entry.hostContended,
      stageHost: tags.stageHost,
      devtoolsOpen: tags.devtoolsOpen,
      refreshHz: tags.display.refreshHz,
    }
    const { features, ...rest } = key
    const id = JSON.stringify([rest, USAGE_FEATURE_KEYS.map(name => features[name])])
    let cell = this.#cells.get(id)
    if (cell === undefined) {
      cell = new SegmentCellAccumulator(key)
      this.#cells.set(id, cell)
    }
    return cell
  }
}
