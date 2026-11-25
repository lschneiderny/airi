import type { BenchRunRecord, PerfRecord, SampleRecord, WindowRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import type { BenchScenario } from './matrix'
import type { PowerLimit } from './power'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { FixedHistogram, FRAME_BINS_V1, parsePerfLine, PERF_RECORD_VERSION, ROLLUP_EVENT_SETTLING_MS, ROLLUP_SESSION_SETTLING_MS, SegmentRollupReducer, STAGE_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'

import { BENCH_MATRIX } from './matrix'

/** The window stage host's stage window; every bench scenario runs that host. */
const STAGE_WINDOW = 'stage-main'
const RAW_SEGMENT = /^(.+)\.(\d+)\.jsonl$/

/** The parsed raw segment of one bench launch, which records exactly one session into its own perf directory. */
export interface RawRun {
  readonly sessionId: string
  readonly segment: number
  readonly records: readonly PerfRecord[]
  /** Lines `parsePerfLine` rejected, unknown versions included. */
  readonly malformedLines: number
  readonly rawBytes: number
}

/** Reads `<perfDir>/raw/<sessionId>.<segment>.jsonl`; throws unless the directory holds exactly one segment. */
export async function readRawRun(perfDir: string): Promise<RawRun> {
  const rawDir = join(perfDir, 'raw')
  const segments = (await readdir(rawDir)).flatMap((name) => {
    const match = RAW_SEGMENT.exec(name)
    return match ? [{ name, sessionId: match[1], segment: Number(match[2]) }] : []
  })
  if (segments.length !== 1)
    throw new Error(`expected one raw segment in ${rawDir}, found ${segments.length}`)
  const [{ name, sessionId, segment }] = segments
  const text = await readFile(join(rawDir, name), 'utf8')
  const records: PerfRecord[] = []
  let malformedLines = 0
  for (const line of text.split('\n')) {
    if (!line.trim())
      continue
    const parsed = parsePerfLine(line)
    if (parsed.ok)
      records.push(parsed.record)
    else
      malformedLines += 1
  }
  return { sessionId, segment, records, malformedLines, rawBytes: Buffer.byteLength(text) }
}

function ofKind<Kind extends PerfRecord['kind']>(records: readonly PerfRecord[], kind: Kind): Extract<PerfRecord, { kind: Kind }>[] {
  return records.filter((record): record is Extract<PerfRecord, { kind: Kind }> => record.kind === kind)
}

/**
 * The earliest time a measured window can start without the rollup excluding it: 60 s after `session-start`, and
 * 20 s after the last model load, renderer reload, resume or new identity epoch (the settling of `RollupExclusions`).
 * `null` before the recorder wrote `session-start`.
 */
export function measurableFrom(records: readonly PerfRecord[]): number | null {
  const [sessionStart] = ofKind(records, 'session-start')
  if (!sessionStart)
    return null
  const settlingFrom = [
    ...ofKind(records, 'event').filter(event => event.name === 'model-load' || event.name === 'renderer-reload' || event.name === 'resume').map(event => event.t),
    ...ofKind(records, 'identity').filter(identity => identity.epoch > 0).map(identity => identity.t),
  ]
  return Math.max(sessionStart.t + ROLLUP_SESSION_SETTLING_MS, ...settlingFrom.map(at => at + ROLLUP_EVENT_SETTLING_MS))
}

/** sha256 of the model file's name, byte size and modification time; the directory never enters it. */
export function modelFingerprint(file: { readonly path: string, readonly size: number, readonly mtimeMs: number }): string {
  return createHash('sha256').update(JSON.stringify([basename(file.path), file.size, file.mtimeMs])).digest('hex')
}

export interface BenchRunContext {
  readonly scenario: BenchScenario
  readonly run: number
  readonly modelFingerprint: string
  /** The measured span in wall-clock epoch milliseconds, the clock the recorder stamps records with. */
  readonly measured: { readonly startMs: number, readonly endMs: number }
  /** The host's power limit read at the start or the end of the measured span; null when it ran at full power. */
  readonly powerLimit: PowerLimit | null
}

export type BenchRunSummary
  = | { readonly ok: true, readonly record: BenchRunRecord, readonly windows: number, readonly samples: number }
    | { readonly ok: false, readonly reason: string }

/** The mean over samples of the summed field of the processes with `role`; samples without a value for it are skipped. */
function meanOverSamples(samples: readonly SampleRecord[], role: string, field: 'cpuPctOfCore' | 'workingSetKb'): number | null {
  const values = samples.flatMap((sample) => {
    const entries = sample.processes.filter(entry => entry.role === role)
    const readings = entries.map(entry => entry[field])
    return entries.length > 0 && readings.every(value => value !== null) ? [readings.reduce<number>((sum, value) => sum + value, 0)] : []
  })
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

/**
 * Reduces the measured span of one launch's raw segment into its `bench-run` record. The stage-window rollups that
 * lie wholly inside the span (each covers the time since the previous rollup of its window) go through
 * `SegmentRollupReducer` together with every other record, so its exclusions and sample joins apply as they do to
 * `pnpm perf`. The frame histogram, shares and stage times come from its cells; fps is the measured windows' frames
 * over their time; CPU and memory are the means of the samples whose interval lies inside the span. The run is
 * invalid with `host-contended` when any of those samples is contended, and with `excluded-window` when the reducer
 * excluded a measured window, because then its cells no longer cover the whole span. A host on battery or in Low
 * Power Mode makes it invalid with that power limit, which takes precedence over the other two reasons.
 */
export function summarizeBenchRun(raw: RawRun, context: BenchRunContext): BenchRunSummary {
  const { startMs, endMs } = context.measured
  const previousAt = new Map<string, number>()
  const measuredWindows: { record: WindowRollupRecord, startMs: number }[] = []
  for (const record of ofKind(raw.records, 'window-rollup')) {
    const windowStart = previousAt.get(record.window)
    previousAt.set(record.window, record.t)
    if (record.window === STAGE_WINDOW && windowStart !== undefined && windowStart >= startMs && record.t <= endMs)
      measuredWindows.push({ record, startMs: windowStart })
  }
  const measuredRecords = new Set<PerfRecord>(measuredWindows.map(entry => entry.record))
  const reducer = new SegmentRollupReducer({ sessionId: raw.sessionId, segment: raw.segment })
  for (const record of raw.records) {
    if (record.kind !== 'window-rollup' || measuredRecords.has(record))
      reducer.push(record)
  }
  const row = reducer.finish({ endedAt: Math.max(0, ...raw.records.map(record => record.t)), recovered: false, malformedLines: raw.malformedLines, rawBytes: raw.rawBytes })
  if (row.kind === 'rollup-failed')
    return { ok: false, reason: `the segment rollup failed: ${row.reason}` }
  const sessionStart = ofKind(raw.records, 'session-start').find(record => record.segment === raw.segment)
  if (!sessionStart)
    return { ok: false, reason: 'the raw segment has no session-start' }
  if (measuredWindows.length === 0)
    return { ok: false, reason: `no ${STAGE_WINDOW} rollup lies inside the measured span` }
  const epochs = new Set(measuredWindows.map(entry => entry.record.epoch))
  if (epochs.size > 1)
    return { ok: false, reason: 'the code identity changed during the measured span' }
  const identity = ofKind(raw.records, 'identity').find(record => epochs.has(record.epoch))
  // A run of unknown dirtiness could pool into clean history, which todo 20 must never do.
  if (identity === undefined || identity.dirty === null)
    return { ok: false, reason: 'the recorder wrote no identity with a known dirty state for the measured span' }

  const histogram = new FixedHistogram(FRAME_BINS_V1)
  let stageSumMs = 0
  let timedStages = false
  const stageTotals = new Map<string, { n: number, sumMs: number, readonly histogram: FixedHistogram }>()
  for (const bucket of row.cells.flatMap(cell => cell.buckets)) {
    histogram.mergeFrom(bucket.frameHist)
    for (const [stageId, stage] of Object.entries(bucket.stages ?? {})) {
      stageSumMs += stage.sumMs
      timedStages = true
      let total = stageTotals.get(stageId)
      if (!total) {
        total = { n: 0, sumMs: 0, histogram: new FixedHistogram(STAGE_BINS_V1) }
        stageTotals.set(stageId, total)
      }
      total.n += stage.n
      total.sumMs += stage.sumMs
      const counts = Array.from<number>({ length: total.histogram.counts.length }).fill(0)
      for (const [binIndex, count] of stage.hist)
        counts[binIndex] += count
      total.histogram.mergeFrom(counts)
    }
  }
  const p50FrameMs = FixedHistogram.approxQuantile(histogram.counts, FRAME_BINS_V1.edges, 0.5)
  const p95FrameMsApprox = FixedHistogram.approxQuantile(histogram.counts, FRAME_BINS_V1.edges, 0.95)
  if (p50FrameMs === null || p95FrameMsApprox === null)
    return { ok: false, reason: 'the rollup excluded every measured window' }
  const frames = measuredWindows.reduce((sum, entry) => sum + entry.record.frames, 0)
  const fps = frames * 1000 / measuredWindows.reduce((sum, entry) => sum + entry.record.t - entry.startMs, 0)

  const samples = ofKind(raw.records, 'sample').filter(sample => sample.t - sample.intervalMs >= startMs && sample.t <= endMs)
  const stageWindowCpuPct = meanOverSamples(samples, `window:${STAGE_WINDOW}`, 'cpuPctOfCore')
  const stageWindowWorkingSetKb = meanOverSamples(samples, `window:${STAGE_WINDOW}`, 'workingSetKb')
  const gpuCpuPct = meanOverSamples(samples, 'gpu', 'cpuPctOfCore')
  const browserCpuPct = meanOverSamples(samples, 'browser', 'cpuPctOfCore')
  if (stageWindowCpuPct === null || stageWindowWorkingSetKb === null || gpuCpuPct === null || browserCpuPct === null)
    return { ok: false, reason: 'the measured samples lack CPU or memory of the stage window, GPU or browser process' }
  // Per frame over the frame count of `stageSumMeanMs`, so the stage values add up to it.
  const stages = Object.fromEntries([...stageTotals].flatMap(([stageId, total]) => {
    const p95MsApprox = FixedHistogram.approxQuantile(total.histogram.counts, STAGE_BINS_V1.edges, 0.95)
    return p95MsApprox === null ? [] : [[stageId, { msPerFrame: total.sumMs / histogram.count, p95MsApprox, n: total.n }]]
  }))
  // The power limit comes first: it is the reason a person can act on, and it can cause the other two.
  const invalidReason = context.powerLimit ?? (samples.some(sample => sample.hostContended) ? 'host-contended' : row.excludedWindows > 0 ? 'excluded-window' : undefined)

  const record: BenchRunRecord = {
    v: PERF_RECORD_VERSION,
    t: endMs,
    sessionId: raw.sessionId,
    kind: 'bench-run',
    matrix: BENCH_MATRIX,
    scenario: context.scenario.id,
    scenarioVersion: context.scenario.version,
    run: context.run,
    sha: identity.sha,
    dirty: identity.dirty,
    diffHash: identity.diffHash,
    modelFingerprint: context.modelFingerprint,
    host: sessionStart.host,
    // The motion QA bridge that drives the bench exists only in dev builds (`scripts/dev-tools/bundle-check.ts`).
    buildMode: 'dev',
    electronVersion: sessionStart.electronVersion,
    valid: invalidReason === undefined,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    metrics: {
      fps,
      p50FrameMs,
      p95FrameMsApprox,
      share21: histogram.shareAtLeast(21),
      share36: histogram.shareAtLeast(36),
      share100: histogram.shareAtLeast(100),
      stageWindowCpuPct,
      // Percent of one core is CPU milliseconds per 10 ms of wall time.
      stageWindowCpuMsPerFrame: stageWindowCpuPct * 10 / fps,
      gpuCpuPct,
      browserCpuPct,
      stageWindowWorkingSetKb,
      stageSumMeanMs: timedStages ? stageSumMs / histogram.count : null,
      recorderMs: samples.reduce((sum, sample) => sum + sample.recorderMs, 0) + measuredWindows.reduce((sum, entry) => sum + entry.record.recorderUs / 1000, 0),
    },
    ...(timedStages ? { stages } : {}),
  }
  // The record crosses into the shared history here; a NaN or out-of-range metric must not reach it.
  const checked = parsePerfLine(JSON.stringify(record))
  if (!checked.ok)
    return { ok: false, reason: `the bench-run record fails the record contract (${checked.reason})` }
  return { ok: true, record, windows: measuredWindows.length, samples: samples.length }
}
