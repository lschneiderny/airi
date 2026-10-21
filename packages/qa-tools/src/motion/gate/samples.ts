import type { EmotionGate, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import { quantile, scoredChannels } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

/**
 * Review-report measurements the scorer does not need: a coarse paired trajectory per channel and the absolute
 * parameter levels a reaction reached. They are computed from the same traces as the scored statistics, with
 * the scorer's `eventDelta` unit conventions (`emotion-score.ts` `channelSeries`, `eventDelta`): half-range units
 * minus the baseline mean for face and posture, and `log(level / base)` of the 80th-percentile lid openness for the
 * eyelid, so a trajectory's plateau is the same number as the scored `E`. Nothing here feeds a verdict.
 */

/** Grid of the paired trajectory, seconds after the pulse: the baseline window through the end of the release fit. */
export const trajectoryGrid = { start: -1, step: 0.1, points: 111 } as const

export const trajectoryTimes: readonly number[] = Array.from({ length: trajectoryGrid.points }, (_, index) => Math.round((trajectoryGrid.start + index * trajectoryGrid.step) * 1000) / 1000)

/** Where one Cubism parameter sat before the pulse and how far it went in the scored window, in the rig's raw units. */
export interface ParameterLevel {
  id: string
  /** Mean over the baseline window. */
  baseline: number
  /** The scored-window sample furthest from the baseline. */
  peak: number
  min: number
  max: number
}

export interface ChannelSamples {
  /** Emotion run minus the stripped run with the same seed, both relative to their own baseline, on `trajectoryTimes`. */
  trajectory: number[]
  levels: ParameterLevel[]
}

export interface TrialSamples {
  trialId: string
  channels: Partial<Record<ScoredChannel, ChannelSamples>>
}

const parameterIds: Partial<Record<ScoredChannel, readonly string[]>> = {
  angleX: ['ParamAngleX'],
  angleY: ['ParamAngleY'],
  angleZ: ['ParamAngleZ'],
  bodyAngleX: ['ParamBodyAngleX'],
  bodyAngleY: ['ParamBodyAngleY'],
  bodyAngleZ: ['ParamBodyAngleZ'],
  mouthForm: ['ParamMouthForm'],
  mouthOpen: ['ParamMouthOpenY'],
  cheek: ['ParamCheek'],
  browMean: ['ParamBrowLY', 'ParamBrowRY'],
  browAsym: ['ParamBrowLY', 'ParamBrowRY'],
  browAngle: ['ParamBrowLAngle', 'ParamBrowRAngle'],
  eyeSmile: ['ParamEyeLSmile', 'ParamEyeRSmile'],
  eyelid: ['ParamEyeLOpen', 'ParamEyeROpen'],
}

const sampledChannels = (Object.keys(scoredChannels) as ScoredChannel[]).filter(channel => scoredChannels[channel] !== 'modulation')

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

function windowValues(times: readonly number[], values: readonly number[], start: number, end: number): number[] {
  const picked: number[] = []
  for (let index = 0; index < times.length; index++) {
    if (times[index] >= start - 1e-9 && times[index] <= end + 1e-9)
      picked.push(values[index])
  }
  return picked
}

/** One kept 30 Hz sample: the recorder may stop that much before the scenario end, so the grid's last point holds the last sample. */
const samplePeriod = 1 / 30

function interpolate(times: readonly number[], values: readonly number[], time: number): number {
  if (!times.length || time < times[0] - 1e-9 || time > times[times.length - 1] + samplePeriod + 1e-9)
    return Number.NaN
  if (time >= times[times.length - 1])
    return values[times.length - 1]
  let low = 0
  let high = times.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (times[middle] < time)
      low = middle + 1
    else
      high = middle
  }
  if (low === 0 || Math.abs(times[low] - time) < 1e-9)
    return values[low]
  const weight = (time - times[low - 1]) / (times[low] - times[low - 1])
  return values[low - 1] + (values[low] - values[low - 1]) * weight
}

/** The scorer's per-sample channel value: half-range units (pairs averaged, browAsym halved difference), raw lid openness. */
function channelSeries(trace: NaturalTrace, channel: ScoredChannel): number[] | null {
  const ids = parameterIds[channel]
  if (!ids)
    return null
  const columns: number[][] = []
  const halves: number[] = []
  for (const id of ids) {
    const column = trace.channels[id]
    const range = trace.ranges[id]
    if (!column || !range || !(range.max > range.min))
      return null
    columns.push(column)
    halves.push((range.max - range.min) / 2)
  }
  if (channel === 'eyelid')
    return columns[0].map((_, index) => mean(columns.map(column => column[index])))
  const normalized = columns.map((column, which) => column.map(value => value / halves[which]))
  if (channel === 'browAsym')
    return normalized[0].map((value, index) => (value - normalized[1][index]) / 2)
  return normalized[0].map((_, index) => mean(normalized.map(column => column[index])))
}

/** Running 80th percentile of lid openness over a centered 1 s window, so blinks do not read as release (the scorer's `runningLidReference`). */
function lidReference(times: readonly number[], lid: readonly number[], time: number): number {
  const values = windowValues(times, lid, time - 0.5, time + 0.5)
  return values.length ? quantile(values, 0.8) : Number.NaN
}

/** Baseline-relative value of a channel on the trajectory grid around `pulse`, or `null` when the trace does not cover it. */
function relativeTrajectory(trace: NaturalTrace, channel: ScoredChannel, pulse: number, gate: EmotionGate): number[] | null {
  const series = channelSeries(trace, channel)
  if (!series)
    return null
  const baseline = windowValues(trace.t, series, pulse + gate.windows.baseline[0], pulse + gate.windows.baseline[1])
  if (baseline.length < 2)
    return null
  // Eyelid: the scorer's effect is `log(quantile(scored, 0.8) / quantile(baseline, 0.8))`, so each point is the log ratio of the
  // running 80th percentile to the baseline percentile; the paired difference of two logs is then a log ratio as well.
  const values = scoredChannels[channel] === 'eyelid'
    ? trajectoryTimes.map(time => Math.log(lidReference(trace.t, series, pulse + time) / quantile(baseline, 0.8)))
    : trajectoryTimes.map(time => interpolate(trace.t, series, pulse + time) - mean(baseline))
  return values.every(Number.isFinite) ? values : null
}

function parameterLevels(trace: NaturalTrace, channel: ScoredChannel, pulse: number, gate: EmotionGate): ParameterLevel[] | null {
  const cls = scoredChannels[channel]
  const window = cls === 'face' ? gate.windows.face : cls === 'eyelid' ? gate.windows.eyelid : gate.windows.posture
  const levels: ParameterLevel[] = []
  for (const id of parameterIds[channel] ?? []) {
    const column = trace.channels[id]
    const range = trace.ranges[id]
    if (!column || !range)
      return null
    const baseline = windowValues(trace.t, column, pulse + gate.windows.baseline[0], pulse + gate.windows.baseline[1])
    const scored = windowValues(trace.t, column, pulse + window[0], pulse + window[1])
    if (baseline.length < 2 || !scored.length)
      return null
    const base = mean(baseline)
    const peak = scored.reduce((furthest, value) => (Math.abs(value - base) > Math.abs(furthest - base) ? value : furthest), scored[0])
    if (![base, peak].every(Number.isFinite))
      return null
    levels.push({ id, baseline: base, peak, min: range.min, max: range.max })
  }
  return levels
}

export interface MeasureSamplesOptions {
  trialId: string
  gate: EmotionGate
}

/**
 * Per-channel review samples of one paired trial. Returns `null` when the emotion trace has no scenario emotion
 * event for the trial or the stripped trace no `noop` for it; channels the traces cannot cover are omitted.
 */
export function measureTrialSamples(run: NaturalTrace, paired: NaturalTrace, { trialId, gate }: MeasureSamplesOptions): TrialSamples | null {
  const pulseEvent = run.events.find(entry => entry.source === 'scenario' && entry.event.kind === 'emotion' && entry.event.trialId === trialId)
  const noopEvent = paired.events.find(entry => entry.source === 'scenario' && entry.event.kind === 'noop' && entry.event.trialId === trialId)
  if (!pulseEvent || !noopEvent)
    return null
  const channels: TrialSamples['channels'] = {}
  for (const channel of sampledChannels) {
    const own = relativeTrajectory(run, channel, pulseEvent.t, gate)
    const stripped = relativeTrajectory(paired, channel, noopEvent.t, gate)
    const levels = parameterLevels(run, channel, pulseEvent.t, gate)
    if (!own || !stripped || !levels)
      continue
    channels[channel] = { trajectory: own.map((value, index) => value - stripped[index]), levels }
  }
  return { trialId, channels }
}
