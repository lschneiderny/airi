import type { ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { NaturalMotionEvent } from './frame-types'
import type { LivelinessTrace, ParameterRanges } from './liveliness'
import type { PostureHome } from './posture'

import { resolveCheekParameterId } from './rig-profile'

/**
 * Parameters a Natural trace records. These are the channels the liveliness scorer reads, plus the
 * face and breath channels Natural composes, so one trace explains a score without a second capture.
 * A rig that lacks a parameter simply has no column for it.
 */
export const naturalTraceParameterIds = [
  'ParamAngleX',
  'ParamAngleY',
  'ParamAngleZ',
  'ParamBodyAngleX',
  'ParamBodyAngleY',
  'ParamBodyAngleZ',
  'ParamEyeBallX',
  'ParamEyeBallY',
  'ParamEyeLOpen',
  'ParamEyeROpen',
  'ParamEyeLSmile',
  'ParamEyeRSmile',
  'ParamBrowLY',
  'ParamBrowRY',
  'ParamBrowLAngle',
  'ParamBrowRAngle',
  'ParamMouthForm',
  'ParamMouthOpenY',
  'ParamCheek',
  'ParamBreath',
] as const

/** Capture context stored beside the samples, so a trace file says what produced it. */
export interface NaturalTraceMeta {
  /** Model id of the stage that captured the trace, or `null` when the stage has none. */
  model: string | null
  driver: string
  /** Natural energy the stage passed to the model, 0..1. */
  energy: number
  home: PostureHome
  adapter: {
    weightMean: number
    bodyWrites: number
    physicsOutputSkips: number
  }
  capturedAt: string
  durationSeconds: number
}

/**
 * One event stamped into a trace. `t` uses the sample origin. `natural` events are what the
 * controller performed (its observer); `scenario` events are the inputs a QA run dispatched.
 */
export type NaturalTraceEvent
  = | { t: number, source: 'natural', event: NaturalMotionEvent }
    | { t: number, source: 'scenario', event: ScenarioEvent }

/**
 * One captured trace. The shape is the input of `scripts/score-natural-trace.ts`
 * (`{ t, channels, ranges }`), so the lab and the CLI score the same file.
 * Version 2 adds `events`; the liveliness scorer ignores them.
 */
export interface NaturalTrace extends LivelinessTrace {
  version: 2
  t: number[]
  ranges: ParameterRanges
  events: NaturalTraceEvent[]
  meta: NaturalTraceMeta
}

export interface NaturalTraceRecorderOptions {
  /** CDI metadata used by the rig profile to resolve the blush channel. */
  displayInfo?: unknown
  /** Rig-specific parameters recorded after the standard ones, such as a ForBOOTH expression switch (`Param60`). Absent ids get no column. */
  extraParameterIds?: readonly string[]
}

/** Cubism model parameter table, as `coreModel.getModel().parameters` returns it. */
export interface CubismParameterTable {
  ids: ArrayLike<string>
  minimumValues: ArrayLike<number>
  maximumValues: ArrayLike<number>
  defaultValues: ArrayLike<number>
}

/** Samples are kept at this rate; the scorer resamples to the same 30 Hz grid. */
const sampleRate = 30
/** Accept a frame slightly early, so a 60 Hz render does not alias down to 20 Hz. */
const earlyToleranceSeconds = 0.25 / sampleRate

/**
 * Collects post-physics parameter values for one capture.
 *
 * The caller passes every rendered frame to `sample`. The recorder keeps one frame per 1/30 s
 * slot by timestamp, so the kept rate does not depend on the display refresh rate. Timestamps
 * are seconds since the first kept frame, or since the first mark when an event is marked before
 * any frame. A frame stall leaves a gap, which the scorer treats as a span break when it exceeds 200 ms.
 */
export class NaturalTraceRecorder {
  private readonly columns: { id: string, index: number, values: number[] }[] = []
  private readonly ranges: ParameterRanges = {}
  private readonly t: number[] = []
  private readonly events: NaturalTraceEvent[] = []
  private origin: number | undefined
  private nextSlot = 0

  constructor(parameters: CubismParameterTable, options: NaturalTraceRecorderOptions = {}) {
    const ids = Array.from(parameters.ids)
    for (const id of new Set([...naturalTraceParameterIds, ...options.extraParameterIds ?? []])) {
      // Keep the canonical scored channel name while sampling the same physical parameter Natural drives.
      const parameterId = id === 'ParamCheek' ? resolveCheekParameterId(ids, options.displayInfo) : id
      const index = parameterId ? ids.indexOf(parameterId) : -1
      if (index < 0)
        continue
      this.columns.push({ id, index, values: [] })
      this.ranges[id] = {
        min: parameters.minimumValues[index],
        max: parameters.maximumValues[index],
        default: parameters.defaultValues[index],
      }
    }
  }

  get frames() {
    return this.t.length
  }

  /** Seconds between the first and the last kept frame. */
  get elapsedSeconds() {
    return this.t.length ? this.t[this.t.length - 1] : 0
  }

  /**
   * Offers one frame. `readValue` receives a parameter index and is only called when the
   * frame is kept. Returns whether the frame was kept.
   */
  sample(nowSeconds: number, readValue: (index: number) => number): boolean {
    this.origin ??= nowSeconds
    const time = nowSeconds - this.origin
    if (this.t.length && time < this.nextSlot - earlyToleranceSeconds)
      return false
    this.t.push(time)
    for (const column of this.columns)
      column.values.push(readValue(column.index))
    // After a stall, restart the grid at this frame rather than keeping a burst of late slots.
    this.nextSlot = time - this.nextSlot > 1 / sampleRate ? time + 1 / sampleRate : this.nextSlot + 1 / sampleRate
    return true
  }

  /** Stamps one event at `nowSeconds` on the clock `sample` receives. The event is copied, so later changes to it are not recorded. */
  mark(nowSeconds: number, source: 'natural', event: NaturalMotionEvent): void
  mark(nowSeconds: number, source: 'scenario', event: ScenarioEvent): void
  mark(nowSeconds: number, source: NaturalTraceEvent['source'], event: NaturalMotionEvent | ScenarioEvent) {
    this.origin ??= nowSeconds
    // The overloads pair each source with its event type.
    this.events.push({ t: nowSeconds - this.origin, source, event: { ...event } } as NaturalTraceEvent)
  }

  build(meta: NaturalTraceMeta): NaturalTrace {
    return {
      version: 2,
      t: [...this.t],
      channels: Object.fromEntries(this.columns.map(column => [column.id, [...column.values]])),
      ranges: { ...this.ranges },
      events: [...this.events],
      meta,
    }
  }
}

/**
 * File name for a downloaded trace: `natural-trace-<ISO>-<model>.json`. Colons in the ISO
 * time and path characters in the model id become `-`, because Windows rejects them.
 *
 * @example
 * naturalTraceFileName({ capturedAt: '2026-10-17T12:00:00.000Z', model: 'Bear/Pajama' })
 * // => 'natural-trace-2026-10-17T12-00-00.000Z-Bear-Pajama.json'
 */
export function naturalTraceFileName(meta: Pick<NaturalTraceMeta, 'capturedAt' | 'model'>) {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, '-')
  return `natural-trace-${safe(meta.capturedAt)}-${safe(meta.model ?? 'model')}.json`
}
