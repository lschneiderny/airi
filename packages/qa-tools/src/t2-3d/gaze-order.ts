import type { DetectorParameters, MetricSample, PreparedTrace, Quat } from './metrics'
import type { DecodedMotionTrace } from './read-trace'

import { gazeMetrics, prepareTrace } from './metrics'
import { integratedEpisode } from './metrics/gaze'
import { conjugate, DEG, multiply } from './metrics/math'
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
  readonly version: 4
  /** The goal-2 criterion: displacement order per `gaze-shift` event of at least CRITERION_DEG. */
  readonly criterion: GazeCriterion
  readonly eyeFloor: number
  readonly episodes: readonly GazeOrderEpisode[]
  /** Episodes the bands' accepted head-rotation range left out. */
  readonly excluded: number
  readonly eyeBeforeHead: GazeOrderShare
  readonly headBeforeChest: GazeOrderShare
  /** Gate detector, reported only: fully ordered over episodes in which the eyes and the head have onsets. */
  readonly ordered: GazeOrderShare
  /** Over `gaze-shift:<deg>` marker events of at least LARGE_SHIFT_DEG with a `blink` marker inside the shift window. */
  readonly blink: GazeOrderShare
  /** The accompanied large shifts by the source of their first blink. */
  readonly blinkSources: { readonly body: number, readonly natural: number }
}

const SHIFT_PREFIX = 'gaze-shift:'
const WINDOW_SECONDS = 2
const LARGE_SHIFT_DEG = 40
// Event times are float64 sums of dt; the trace clock is float32, which rounds about 4e-6 s at 60 s.
const CLOCK_TOLERANCE = 1e-4

/** One `gaze-shift` event of at least CRITERION_DEG, judged by displacement (architecture 9.1). Times are ms after the event. */
export interface GazeCriterionShift {
  readonly t: number
  readonly amplitudeDeg: number
  readonly yawDeg: number
  readonly goal: string | null
  /** Largest displacement along the shift's yaw direction within the window, degrees. */
  readonly excursionDeg: { readonly gaze: number, readonly head: number, readonly chest: number }
  /** Gaze line at 90 %, head and chest at 50 % of their own excursion; null when that joint was not recruited. */
  readonly reachMs: { readonly gaze: number | null, readonly head: number | null, readonly chest: number | null }
  readonly headRecruited: boolean
  readonly chestRecruited: boolean
  readonly eyesBeforeHead: boolean
  /** Null when the chest was not recruited. */
  readonly headBeforeChest: boolean | null
  readonly ordered: boolean
  /** `eyes-only`: neither head nor chest recruited; `no-chest`: head only; `no-head`: chest without head, never ordered. */
  readonly pattern: 'full' | 'no-chest' | 'eyes-only' | 'no-head'
}

export interface GazeCriterion {
  readonly shifts: readonly GazeCriterionShift[]
  readonly share: GazeOrderShare
  readonly eyesOnly: number
  readonly noChest: number
  /** Shifts of at least LARGE_SHIFT_DEG and how many recruited the head. */
  readonly large: { readonly shifts: number, readonly headRecruited: number }
  /** Sustained shifts of more than TRUNK_DEG of yaw and how many recruited the chest. */
  readonly sustainedWide: { readonly shifts: number, readonly chestRecruited: number }
}

const CRITERION_DEG = 10
const CRITERION_WINDOW_SECONDS = 1.5
const GAZE_REACH = 0.9
const JOINT_REACH = 0.5
const RECRUITED = 0.1
const TRUNK_DEG = 25

/** Yaw of the rotated forward axis (+Z), positive toward +X. */
function forwardYaw([x, y, z, w]: Quat): number {
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y))
}

function share(ordered: number, total: number): GazeOrderShare {
  return { ordered, total, share: total ? ordered / total : null }
}

function criterion(p: PreparedTrace, events: readonly { t: number, label: string }[]): GazeCriterion {
  const world = p.orientations
  const eyes = (['leftEye', 'rightEye'] as const).flatMap(b => world[b] ? [world[b]] : [])
  const gaze = p.times.map((_, i) => eyes.reduce((s, e) => s + forwardYaw(e[i]), 0) / eyes.length)
  const relative = (child: readonly Quat[], parent: readonly Quat[]) => child.map((q, i) => forwardYaw(multiply(conjugate(parent[i]), q)))
  const head = relative(world.head!, world.chest!)
  const chest = relative(world.chest!, world.hips!)
  const parsed = events.flatMap((event) => {
    const [amplitude, yaw, goal] = event.label.slice(SHIFT_PREFIX.length).split(':')
    const amplitudeDeg = Number.parseFloat(amplitude)
    return amplitudeDeg >= CRITERION_DEG ? [{ t: event.t, amplitudeDeg, yawDeg: Number.parseFloat(yaw ?? 'NaN'), goal: goal ?? null }] : []
  }).filter(e => e.t >= p.times[0] - CLOCK_TOLERANCE)
  const index = (t: number) => {
    const i = p.times.findIndex(time => time >= t - CLOCK_TOLERANCE)
    return i < 0 ? p.times.length : i
  }
  const shifts = parsed.map((event, k): GazeCriterionShift => {
    const start = index(event.t)
    const end = index(Math.min(parsed[k + 1]?.t ?? Number.POSITIVE_INFINITY, event.t + CRITERION_WINDOW_SECONDS))
    const sign = Math.sign(event.yawDeg) || 1
    const track = (signal: readonly number[], share: number) => {
      const displacement = signal.slice(start, end).map(v => sign * (v - signal[start]) * DEG)
      const excursion = Math.max(0, ...displacement)
      const reached = displacement.findIndex(d => excursion > 0 && d >= share * excursion)
      return { excursion, ms: reached < 0 ? null : (p.times[start + reached] - event.t) * 1000 }
    }
    const g = track(gaze, GAZE_REACH)
    const h = track(head, JOINT_REACH)
    const c = track(chest, JOINT_REACH)
    const headRecruited = h.excursion >= RECRUITED * event.amplitudeDeg
    const chestRecruited = c.excursion >= RECRUITED * event.amplitudeDeg
    const before = (a: number | null, b: number | null) => a !== null && b !== null && a < b
    const eyesBeforeHead = !headRecruited || before(g.ms, h.ms)
    const headBeforeChest = chestRecruited ? headRecruited && before(h.ms, c.ms) : null
    const pattern = headRecruited ? (chestRecruited ? 'full' : 'no-chest') : (chestRecruited ? 'no-head' : 'eyes-only')
    return {
      ...event,
      excursionDeg: { gaze: g.excursion, head: h.excursion, chest: c.excursion },
      reachMs: { gaze: g.ms, head: headRecruited ? h.ms : null, chest: chestRecruited ? c.ms : null },
      headRecruited,
      chestRecruited,
      eyesBeforeHead,
      headBeforeChest,
      ordered: pattern !== 'no-head' && eyesBeforeHead && headBeforeChest !== false,
      pattern,
    }
  })
  const large = shifts.filter(s => s.amplitudeDeg >= LARGE_SHIFT_DEG)
  const wide = shifts.filter(s => s.goal === 'sustained' && Math.abs(s.yawDeg) > TRUNK_DEG)
  return {
    shifts,
    share: share(shifts.filter(s => s.ordered).length, shifts.length),
    eyesOnly: shifts.filter(s => s.pattern === 'eyes-only').length,
    noChest: shifts.filter(s => s.pattern === 'no-chest').length,
    large: { shifts: large.length, headRecruited: large.filter(s => s.headRecruited).length },
    sustainedWide: { shifts: wide.length, chestRecruited: wide.filter(s => s.chestRecruited).length },
  }
}

const key = (sample: MetricSample) => `${sample.start}:${sample.end}`

/**
 * Lead rule for goal 2, version 4. The criterion is displacement order per `gaze-shift` event of at least CRITERION_DEG
 * (architecture 9.1: the gaze line reaches 90 % of its excursion before the head reaches 50 %, and the head 50 % before
 * the chest 50 %), with a joint whose excursion stays under 10 % of the amplitude counted as not recruited.
 * Reported only: episodes and onsets from the gate's own gaze detector (`gazeMetrics`, read-only):
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
  const markers = input.trace.events.flatMap(e => e.kind === 'marker' ? [e] : [])
  const shifts = markers.filter(e => e.label.startsWith(SHIFT_PREFIX))
  const displacement = criterion(p, shifts)
  if (!order.samples.length && !displacement.shifts.length)
    throw new GazeOrderRefusal('no-head-turns', `No head turn or gaze shift of 10 degrees or more; ${excluded} head turns excluded by range`)
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
  // `blink` from earlier traces, `blink:<body|natural>` since the lids the face shows are recorded.
  const blinks = markers.filter(e => e.label === 'blink' || e.label.startsWith('blink:')).map(e => ({ t: e.t, source: e.label.slice(6) || 'body' }))
  const large = shifts.flatMap((event, k) => {
    if (Number.parseFloat(event.label.slice(SHIFT_PREFIX.length)) < LARGE_SHIFT_DEG)
      return []
    const until = Math.min(shifts[k + 1]?.t ?? Number.POSITIVE_INFINITY, event.t + WINDOW_SECONDS)
    return [blinks.find(b => b.t >= event.t - CLOCK_TOLERANCE && b.t < until - CLOCK_TOLERANCE)?.source ?? null]
  })
  const eyesAndHead = episodes.filter(e => e.pattern !== 'no-eye-head')
  const withChest = episodes.filter(e => e.headBeforeChest !== null)
  return {
    kind: 'gaze-order',
    version: 4,
    criterion: displacement,
    eyeFloor,
    episodes,
    excluded,
    eyeBeforeHead: share(eyesAndHead.filter(e => e.eyeBeforeHead).length, eyesAndHead.length),
    headBeforeChest: share(withChest.filter(e => e.headBeforeChest).length, withChest.length),
    ordered: share(eyesAndHead.filter(e => e.ordered).length, eyesAndHead.length),
    blink: share(large.filter(source => source !== null).length, large.length),
    blinkSources: { body: large.filter(source => source === 'body').length, natural: large.filter(source => source === 'natural').length },
  }
}

export function formatGazeOrderReport(report: GazeOrderReport): string {
  const ms = (v: number | null) => v === null ? '-' : v.toFixed(1)
  const yes = (v: boolean | null) => v === null ? '-' : v ? 'yes' : 'no'
  const line = (label: string, s: GazeOrderShare) => `${label}: ${s.share === null ? 'no such episode' : `${s.ordered}/${s.total} = ${s.share.toFixed(3)}`}`
  const deg = (v: number) => v.toFixed(1)
  const c = report.criterion
  const lines = [
    `criterion: displacement order per gaze-shift event of ${CRITERION_DEG} deg or more (gaze line ${GAZE_REACH * 100} % before head ${JOINT_REACH * 100} %, head before chest ${JOINT_REACH * 100} %)`,
    't s\tamplitude deg\tyaw deg\tgoal\tgaze/head/chest excursion deg\tgaze 90% ms\thead 50% ms\tchest 50% ms\teyes<head\thead<chest\tordered\tpattern',
    ...c.shifts.map(s => [s.t.toFixed(3), deg(s.amplitudeDeg), deg(s.yawDeg), s.goal ?? '-', `${deg(s.excursionDeg.gaze)}/${deg(s.excursionDeg.head)}/${deg(s.excursionDeg.chest)}`, ms(s.reachMs.gaze), ms(s.reachMs.head), ms(s.reachMs.chest), yes(s.eyesBeforeHead), yes(s.headBeforeChest), yes(s.ordered), s.pattern].join('\t')),
    '',
    line('criterion share (needs 0.90)', c.share),
    `eyes-only shifts: ${c.eyesOnly}; no-chest shifts: ${c.noChest}`,
    `shifts of ${LARGE_SHIFT_DEG} deg or more that recruited the head: ${c.large.headRecruited}/${c.large.shifts}`,
    `sustained shifts beyond ${TRUNK_DEG} deg of yaw that recruited the chest: ${c.sustainedWide.chestRecruited}/${c.sustainedWide.shifts}`,
    `${line(`blink share over gaze-shift events of ${LARGE_SHIFT_DEG} deg or more`, report.blink)} (body ${report.blinkSources.body}, natural ${report.blinkSources.natural})`,
    '',
    'gate detector, reported only:',
    't s\thead deg\teye lead ms\tchest lag ms\teye<head\thead<chest\tordered\tgate indicator\tpattern',
    ...report.episodes.map(e => [e.t.toFixed(3), e.headDeg.toFixed(1), ms(e.eyeLeadMs), ms(e.chestLagMs), yes(e.eyeBeforeHead), yes(e.headBeforeChest), yes(e.ordered), e.gateOrdered ? '1' : '0', e.pattern].join('\t')),
    '',
    `eye floor (declared equal to the fitted head floor): ${report.eyeFloor.toFixed(5)} rad/s`,
    `episodes excluded by the accepted head-rotation range: ${report.excluded}`,
    line('(a) eye strictly before head', report.eyeBeforeHead),
    line('(b) head strictly before chest', report.headBeforeChest),
    line('(c) fully ordered', report.ordered),
  ]
  return `${lines.join('\n')}\n`
}
