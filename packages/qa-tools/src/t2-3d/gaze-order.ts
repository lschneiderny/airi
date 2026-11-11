import type { DetectorParameters, MetricSample } from './metrics'
import type { DecodedMotionTrace } from './read-trace'

import { gazeMetrics, prepareTrace } from './metrics'
import { integratedEpisode } from './metrics/gaze'
import { DEG } from './metrics/math'
import { headSignal } from './metrics/period'

export type GazeOrderRefusalName = 'no-head-turns' | 'bone-absent' | 'missing-floor'

/** The trace cannot be reported on; never a share of 0 or 1. */
export class GazeOrderRefusal extends Error {
  constructor(override readonly name: GazeOrderRefusalName, readonly detail: string) {
    super(`${name}: ${detail}`)
  }
}

/** One head-turn episode of the gate's gaze detector. Onset differences are in ms; null when either joint has no onset. */
export interface GazeOrderEpisode {
  /** Time of the head's peak speed, motion seconds. */
  readonly t: number
  /** Integrated head rotation, degrees. */
  readonly headDeg: number
  /** Head onset minus eye onset (the gate's `gaze.eyeLeadMs`); positive when the eyes start first. */
  readonly eyeLeadMs: number | null
  /** Chest onset minus head onset (the gate's `gaze.chestLagMs`); positive when the chest starts last. */
  readonly chestLagMs: number | null
  readonly eyeBeforeHead: boolean | null
  readonly headBeforeChest: boolean | null
  /** Eyes strictly before head, and head strictly before chest when the chest has an onset. */
  readonly ordered: boolean
  /** `no-chest`: the chest never crossed its floor; `no-eye-head`: the eyes or the head have no onset, outside share (c). */
  readonly pattern: 'full' | 'no-chest' | 'no-eye-head'
  /** The gate's own non-strict `gaze.orderRate` indicator for this episode. */
  readonly gateOrdered: boolean
}

export interface GazeOrderShare {
  readonly ordered: number
  readonly total: number
  readonly share: number | null
}

export interface GazeOrderReport {
  readonly kind: 'gaze-order'
  readonly version: 3
  readonly eyeFloor: number
  readonly episodes: readonly GazeOrderEpisode[]
  /** Episodes the bands' accepted head-rotation range left out. */
  readonly excluded: number
  readonly eyeBeforeHead: GazeOrderShare
  readonly headBeforeChest: GazeOrderShare
  /** The goal-2 criterion: fully ordered over episodes in which the eyes and the head have onsets. */
  readonly ordered: GazeOrderShare
  /** Over `gaze-shift:<deg>` marker events of at least LARGE_SHIFT_DEG with a `blink` marker inside the shift window. */
  readonly blink: GazeOrderShare
}

const SHIFT_PREFIX = 'gaze-shift:'
const WINDOW_SECONDS = 2
const LARGE_SHIFT_DEG = 40
// Event times are float64 sums of dt; the trace clock is float32, which rounds about 4e-6 s at 60 s.
const CLOCK_TOLERANCE = 1e-4

const share = (ordered: number, total: number): GazeOrderShare => ({ ordered, total, share: total ? ordered / total : null })
const key = (sample: MetricSample) => `${sample.start}:${sample.end}`

/**
 * Lead rule for goal 2, version 3. Episodes and onsets come from the gate's own gaze detector (`gazeMetrics`, read-only):
 * kinematic head turns of at least 0.5 rad/s and 10 degrees inside the bands' accepted range, `jointOnset` with the
 * fitted head and chest floors. The only added parameter is the eye floor, declared equal to the fitted head floor:
 * human body capture has no eyes to fit one, and a saccade crosses the head's floor at once while fixational drift
 * never does. Blinks are counted from the `blink` and `gaze-shift` marker events.
 */
export function gazeOrderReport(input: DecodedMotionTrace, params: DetectorParameters): GazeOrderReport {
  const eyeFloor = params.floors.head
  if (eyeFloor === undefined)
    throw new GazeOrderRefusal('missing-floor', 'The detector parameters have no head floor')
  const p = prepareTrace(input)
  const head = headSignal(p)
  const metrics = gazeMetrics(p, { ...params, floors: { ...params.floors, leftEye: eyeFloor, rightEye: eyeFloor } })
  const metric = (id: string) => metrics.find(m => m.id === `gaze.${id}`)!
  const order = metric('orderRate')
  const eyeLead = metric('eyeLeadMs')
  const chestLag = metric('chestLagMs')
  const absent = [order, eyeLead, chestLag].find(m => /skipped: (?:bone-absent|eye-bones-absent|missing)/.test(m.status))
  if (!head || absent)
    throw new GazeOrderRefusal(absent?.status.includes('missing') ? 'missing-floor' : 'bone-absent', absent?.status ?? 'The trace has no head column')
  const excluded = /outside accepted head rotation: ([^;]*)/.exec(order.detail)?.[1].split(', ').length ?? 0
  if (!order.samples.length)
    throw new GazeOrderRefusal('no-head-turns', `No head turn of 10 degrees or more in the accepted range; ${excluded} excluded by range`)
  const leads = new Map(eyeLead.samples.map(s => [key(s), s.value]))
  const lags = new Map(chestLag.samples.map(s => [key(s), s.value]))
  // Every episode in which any joint has an onset carries an `orderRate` sample, with the episode's span and peak.
  const episodes = (order.samples as readonly (MetricSample & { readonly peak: number })[]).map((sample): GazeOrderEpisode => {
    const lead = leads.get(key(sample)) ?? null
    const lag = lags.get(key(sample)) ?? null
    const eyeBeforeHead = lead === null ? null : lead > 0
    const headBeforeChest = lag === null ? null : lag > 0
    return {
      t: p.times[sample.peak],
      headDeg: (integratedEpisode(head, sample)?.angle ?? 0) * DEG,
      eyeLeadMs: lead,
      chestLagMs: lag,
      eyeBeforeHead,
      headBeforeChest,
      ordered: eyeBeforeHead === true && headBeforeChest !== false,
      pattern: lead === null ? 'no-eye-head' : lag === null ? 'no-chest' : 'full',
      gateOrdered: sample.value === 1,
    }
  })
  const markers = input.trace.events.flatMap(e => e.kind === 'marker' ? [e] : [])
  const shifts = markers.filter(e => e.label.startsWith(SHIFT_PREFIX))
  const blinks = markers.filter(e => e.label === 'blink').map(e => e.t)
  const large = shifts.flatMap((event, k) => {
    if (Number.parseFloat(event.label.slice(SHIFT_PREFIX.length)) < LARGE_SHIFT_DEG)
      return []
    const until = Math.min(shifts[k + 1]?.t ?? Number.POSITIVE_INFINITY, event.t + WINDOW_SECONDS)
    return [blinks.some(t => t >= event.t - CLOCK_TOLERANCE && t < until - CLOCK_TOLERANCE)]
  })
  const eyesAndHead = episodes.filter(e => e.pattern !== 'no-eye-head')
  const withChest = episodes.filter(e => e.headBeforeChest !== null)
  return {
    kind: 'gaze-order',
    version: 3,
    eyeFloor,
    episodes,
    excluded,
    eyeBeforeHead: share(eyesAndHead.filter(e => e.eyeBeforeHead).length, eyesAndHead.length),
    headBeforeChest: share(withChest.filter(e => e.headBeforeChest).length, withChest.length),
    ordered: share(eyesAndHead.filter(e => e.ordered).length, eyesAndHead.length),
    blink: share(large.filter(Boolean).length, large.length),
  }
}

export function formatGazeOrderReport(report: GazeOrderReport): string {
  const ms = (v: number | null) => v === null ? '-' : v.toFixed(1)
  const yes = (v: boolean | null) => v === null ? '-' : v ? 'yes' : 'no'
  const line = (label: string, s: GazeOrderShare) => `${label}: ${s.share === null ? 'no such episode' : `${s.ordered}/${s.total} = ${s.share.toFixed(3)}`}`
  const lines = [
    't s\thead deg\teye lead ms\tchest lag ms\teye<head\thead<chest\tordered\tgate indicator\tpattern',
    ...report.episodes.map(e => [e.t.toFixed(3), e.headDeg.toFixed(1), ms(e.eyeLeadMs), ms(e.chestLagMs), yes(e.eyeBeforeHead), yes(e.headBeforeChest), yes(e.ordered), e.gateOrdered ? '1' : '0', e.pattern].join('\t')),
    '',
    `eye floor (declared equal to the fitted head floor): ${report.eyeFloor.toFixed(5)} rad/s`,
    `episodes excluded by the accepted head-rotation range: ${report.excluded}`,
    line('(a) eye strictly before head', report.eyeBeforeHead),
    line('(b) head strictly before chest', report.headBeforeChest),
    line('(c) fully ordered (criterion)', report.ordered),
    line(`blink share over gaze-shift events of ${LARGE_SHIFT_DEG} deg or more`, report.blink),
  ]
  return `${lines.join('\n')}\n`
}
