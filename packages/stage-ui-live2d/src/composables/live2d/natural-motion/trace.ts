import type { LivelinessTrace, ParameterRanges } from './liveliness'
import type { PostureHome } from './posture'

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
 * One captured trace. The shape is the input of `scripts/score-natural-trace.ts`
 * (`{ t, channels, ranges }`), so the lab and the CLI score the same file.
 */
export interface NaturalTrace extends LivelinessTrace {
  t: number[]
  ranges: ParameterRanges
  meta: NaturalTraceMeta
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
 * are seconds since the first kept frame. A frame stall leaves a gap, which the scorer treats
 * as a span break when it exceeds 200 ms.
 */
export class NaturalTraceRecorder {
  private readonly columns: { id: string, index: number, values: number[] }[] = []
  private readonly ranges: ParameterRanges = {}
  private readonly t: number[] = []
  private origin: number | undefined
  private nextSlot = 0

  constructor(parameters: CubismParameterTable) {
    const ids = Array.from(parameters.ids)
    for (const id of naturalTraceParameterIds) {
      const index = ids.indexOf(id)
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

  build(meta: NaturalTraceMeta): NaturalTrace {
    return {
      t: [...this.t],
      channels: Object.fromEntries(this.columns.map(column => [column.id, [...column.values]])),
      ranges: { ...this.ranges },
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
