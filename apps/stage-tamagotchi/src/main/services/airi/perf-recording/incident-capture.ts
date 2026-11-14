import type {
  FrameStallInput,
  FrameStallMemory,
  IncidentBudget,
  IncidentDecision,
  IncidentRecord,
  MemoryGrowthMemory,
  PeggedMemory,
  PerfRecord,
  SampleRecord,
  UsageEventRecord,
} from '@proj-airi/stage-shared/perf/usage'

import type { PerfFrameRing } from '../../../../shared/eventa'
import type { PerfRecordingFs } from './segment-file'
import type { PerfRecordingTimers, PerfWindowSource } from './types'

import { dirname, join } from 'node:path'

import { useLogg } from '@guiiai/logg'
import {
  decideFrameStall,
  decideMemoryGrowth,
  decidePegged,
  INITIAL_FRAME_STALL_MEMORY,
  INITIAL_MEMORY_GROWTH_MEMORY,
  INITIAL_PEGGED_MEMORY,
  PERF_RECORD_VERSION,
  ROLLUP_EVENT_SETTLING_MS,
  ROLLUP_SESSION_SETTLING_MS,
} from '@proj-airi/stage-shared/perf/usage'

import { pullFrameRing } from './pull'
import { usageEvent } from './records'
import { PERF_FILE_MODE } from './segment-file'

const log = useLogg('main/perf-recording').useGlobalConfig()

/** The ticks an incident file carries: 30 s at the 5 s cadence, the incident's own tick last. */
const RECENT_TICKS = 6

/** `incidents/<id>.json`; `pnpm perf incident` (`packages/qa-tools/src/perf/incident.ts`) reads the same shape. */
interface PerfIncidentFile {
  incident: IncidentRecord
  /** The JSONL lines of the last {@link RECENT_TICKS} ticks, as the raw segment holds them. */
  recent: string[]
  /** The ring of `window` when it answered within 3 s; it holds only the frames of the window's current scene. */
  frameRing: (PerfFrameRing & { window: string }) | null
  ringMissing: boolean
}

interface Detection {
  trigger: IncidentRecord['trigger']
  decision: Pick<IncidentDecision<unknown>, 'fire' | 'suppressedReason'>
  window: string | undefined
  pid: number | undefined
  peak: Record<string, number>
}

export interface PerfIncidentCaptureOptions {
  /** The perf data directory; incident files go to its `incidents/`, created at the first incident. */
  directory: string
  sessionId: string
  startedAt: number
  fs: Pick<PerfRecordingFs, 'mkdir' | 'writeFile' | 'rename'>
  timers: PerfRecordingTimers
  /** Shared by the app run's sessions, so turning recording off and on does not refill the caps. */
  budget: IncidentBudget
}

export interface PerfIncidentTick {
  t: number
  sample: SampleRecord
  /** Every record of the tick in write order, the sample included. */
  records: readonly PerfRecord[]
  windows: readonly PerfWindowSource[]
}

function pulledWindow(record: PerfRecord, windows: readonly PerfWindowSource[]): { window: string, rollup: FrameStallInput['rollup'], hidden: boolean } | null {
  if (record.kind === 'window-rollup')
    return { window: record.window, rollup: record, hidden: !record.visible || record.paused }
  if (record.kind === 'event' && record.name === 'rollup-missing' && record.window !== undefined) {
    const label = record.window
    return { window: label, rollup: null, hidden: !(windows.find(window => window.label === label)?.visible ?? false) }
  }
  return null
}

/**
 * Detects one recording session's incidents from the records of each tick and writes `incidents/<id>.json`.
 *
 * `decide` runs the frame-stall decider per pulled rollup (a `rollup-missing` counts as a stall), the pegged decider per
 * process, and the memory-growth decider per window process, then applies the budget. Conditions come from the records
 * themselves: settling for 60 s after the session start, 20 s after a resume or identity change, and 20 s after a
 * window's model load or reload for that window. `write` writes each fired incident's file at once with the recent
 * lines, then pulls a frame ring in the background and rewrites the file once if it arrives within 3 s.
 */
export class PerfIncidentCapture {
  /** The records of the last ticks; lines are serialized only for an incident, after the tick set its recorder time. */
  readonly #recent: (readonly PerfRecord[])[] = []
  readonly #frameStall = new Map<string, FrameStallMemory>()
  /** Keyed `${pid}:${creationTime}`; rebuilt each tick, so exited processes drop out. */
  #pegged = new Map<string, PeggedMemory>()
  #memoryGrowth = new Map<string, MemoryGrowthMemory>()
  readonly #modelLoadMs = new Map<string, number>()
  readonly #windowSettlingUntilMs = new Map<string, number>()
  #settlingUntilMs: number
  #suspended = false
  #epoch = 0
  #incidents = 0

  constructor(private readonly options: PerfIncidentCaptureOptions) {
    this.#settlingUntilMs = options.startedAt + ROLLUP_SESSION_SETTLING_MS
  }

  /** Returns the tick's `incident-suppressed` events and the incidents to write; it keeps the tick's records as recent. */
  decide(tick: PerfIncidentTick): { suppressed: UsageEventRecord[], incidents: IncidentRecord[] } {
    for (const record of tick.records)
      this.#track(record)

    const suppressed: UsageEventRecord[] = []
    const incidents: IncidentRecord[] = []
    for (const { trigger, decision, window, pid, peak } of this.#detect(tick)) {
      const admitted = decision.fire ? this.options.budget.admit(tick.t) : null
      if (admitted?.fire) {
        const id = `${this.options.sessionId}-${++this.#incidents}`
        incidents.push({
          v: PERF_RECORD_VERSION,
          t: tick.t,
          sessionId: this.options.sessionId,
          kind: 'incident',
          id,
          trigger,
          ...(window === undefined ? {} : { window }),
          ...(pid === undefined ? {} : { pid }),
          peak,
          hostContended: tick.sample.hostContended,
          file: `incidents/${id}.json`,
        })
        continue
      }
      const reason = admitted?.suppressedReason ?? decision.suppressedReason
      if (reason !== undefined)
        suppressed.push(usageEvent(tick.t, this.options.sessionId, { name: 'incident-suppressed', ...(window === undefined ? {} : { window }), detail: { trigger, reason, pid: pid ?? null } }))
    }

    this.#recent.push([...tick.records, ...suppressed])
    if (this.#recent.length > RECENT_TICKS)
      this.#recent.shift()
    return { suppressed, incidents }
  }

  /**
   * Writes each incident's file with `ringMissing: true` and returns the incidents whose file was written; their
   * lines belong in the raw segment. The frame ring of the incident's stage window, or of the first stage window for a
   * process without one, is pulled without blocking the caller.
   */
  async write(incidents: readonly IncidentRecord[], windows: readonly PerfWindowSource[]): Promise<IncidentRecord[]> {
    if (incidents.length === 0)
      return []
    const recent = this.#recent.flat().map(record => JSON.stringify(record))
    const written: IncidentRecord[] = []
    for (const incident of incidents) {
      const path = join(this.options.directory, incident.file)
      const file: PerfIncidentFile = { incident, recent, frameRing: null, ringMissing: true }
      try {
        await this.options.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await this.#writeFile(path, file)
      }
      catch (error) {
        log.withError(error).error(`Failed to write the perf incident ${incident.id}`)
        continue
      }
      written.push(incident)
      const source = windows.find(window => window.label === incident.window) ?? windows[0]
      if (source !== undefined)
        void this.#addFrameRing(path, file, source)
    }
    return written
  }

  async #addFrameRing(path: string, file: PerfIncidentFile, source: PerfWindowSource): Promise<void> {
    const ring = await pullFrameRing(source, this.options.timers)
    if (ring === null)
      return
    try {
      await this.#writeFile(path, { ...file, frameRing: { window: source.label, ...ring }, ringMissing: false })
    }
    catch (error) {
      log.withError(error).error(`Failed to add the frame ring to the perf incident ${file.incident.id}`)
    }
  }

  /** Writes through a temporary file, so `pnpm perf incident` never reads a half-written rewrite. */
  async #writeFile(path: string, file: PerfIncidentFile): Promise<void> {
    const temporary = `${path}.tmp`
    await this.options.fs.writeFile(temporary, JSON.stringify(file), { mode: PERF_FILE_MODE })
    await this.options.fs.rename(temporary, path)
  }

  #detect(tick: PerfIncidentTick): Detection[] {
    const { t, sample, windows } = tick
    const held = { suspended: this.#suspended, chromiumTrace: sample.chromiumTrace, hostContended: sample.hostContended }
    const conditions = (window: string | null, hidden: boolean) => ({ ...held, hidden, settling: this.#settling(t, window) })
    const detections: Detection[] = []

    for (const record of tick.records) {
      const pulled = pulledWindow(record, windows)
      if (pulled === null)
        continue
      const decision = decideFrameStall(this.#frameStall.get(pulled.window) ?? INITIAL_FRAME_STALL_MEMORY, { rollup: pulled.rollup, conditions: conditions(pulled.window, pulled.hidden) }, t)
      this.#frameStall.set(pulled.window, decision.memory)
      detections.push({
        trigger: 'frame-stall',
        decision,
        window: pulled.window,
        pid: windows.find(window => window.label === pulled.window)?.osPid,
        peak: pulled.rollup === null ? { rollupMissing: 1 } : { frameMaxMs: pulled.rollup.frameMaxMs, longTaskMaxMs: pulled.rollup.longTasks.maxMs },
      })
    }

    const pegged = new Map<string, PeggedMemory>()
    const memoryGrowth = new Map<string, MemoryGrowthMemory>()
    for (const entry of sample.processes) {
      const key = `${entry.pid}:${entry.creationTime}`
      const window = entry.role.startsWith('window:') ? entry.label : undefined
      // A model load or reload in any window loads the GPU and browser processes too.
      const peggedDecision = decidePegged(this.#pegged.get(key) ?? INITIAL_PEGGED_MEMORY, { cpuPctOfCore: entry.cpuPctOfCore, nowMs: t, conditions: conditions(null, false) })
      pegged.set(key, peggedDecision.memory)
      detections.push({ trigger: 'pegged', decision: peggedDecision, window, pid: entry.pid, peak: { cpuPctOfCore: entry.cpuPctOfCore ?? 0 } })
      if (window === undefined)
        continue
      const growthDecision = decideMemoryGrowth(this.#memoryGrowth.get(key) ?? INITIAL_MEMORY_GROWTH_MEMORY, {
        workingSetKb: entry.workingSetKb,
        nowMs: t,
        modelLoadMs: this.#modelLoadMs.get(window) ?? null,
        conditions: conditions(window, false),
      })
      memoryGrowth.set(key, growthDecision.memory)
      detections.push({ trigger: 'memory-growth', decision: growthDecision, window, pid: entry.pid, peak: { workingSetKb: entry.workingSetKb } })
    }
    this.#pegged = pegged
    this.#memoryGrowth = memoryGrowth
    return detections
  }

  /** Session-wide settling, plus that window's own; `null` asks whether any window is settling. */
  #settling(t: number, window: string | null): boolean {
    if (t < this.#settlingUntilMs)
      return true
    if (window !== null)
      return t < (this.#windowSettlingUntilMs.get(window) ?? 0)
    return [...this.#windowSettlingUntilMs.values()].some(untilMs => t < untilMs)
  }

  /** Every update is idempotent, because the records of a failed append come back with the next tick. */
  #track(record: PerfRecord): void {
    if (record.kind === 'identity' && record.epoch !== this.#epoch) {
      this.#epoch = record.epoch
      this.#settle(record.t, undefined)
    }
    if (record.kind !== 'event')
      return
    switch (record.name) {
      case 'model-load':
        if (record.window !== undefined)
          this.#modelLoadMs.set(record.window, record.t)
        this.#settle(record.t, record.window)
        break
      case 'renderer-reload':
        this.#settle(record.t, record.window)
        break
      case 'resume':
        this.#suspended = false
        this.#settle(record.t, undefined)
        break
      case 'suspend':
        this.#suspended = true
        break
      case 'feature-change':
      case 'visibility':
      case 'recording-start':
      case 'recording-stop':
      case 'trace-start':
      case 'trace-stop':
      case 'rollup-missing':
      case 'incident-suppressed':
        break
      default: {
        const unhandled: never = record.name
        return unhandled
      }
    }
  }

  /** Settles one window, or the whole session for `undefined`, for 20 s from `atMs`. */
  #settle(atMs: number, window: string | undefined): void {
    const untilMs = atMs + ROLLUP_EVENT_SETTLING_MS
    if (window === undefined)
      this.#settlingUntilMs = Math.max(this.#settlingUntilMs, untilMs)
    else
      this.#windowSettlingUntilMs.set(window, Math.max(this.#windowSettlingUntilMs.get(window) ?? 0, untilMs))
  }
}
