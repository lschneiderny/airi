import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from './read-trace'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

export type GazeOrderRefusalName = 'no-gaze-shifts' | 'bone-absent'

/** The trace cannot be reported on; never a share of 0 or 1. */
export class GazeOrderRefusal extends Error {
  constructor(override readonly name: GazeOrderRefusalName, readonly detail: string) {
    super(`${name}: ${detail}`)
  }
}

/**
 * `full`: all three joints moved. `no-chest`, `no-head`: that joint had no onset.
 * `eyes-only`: neither head nor chest moved. `no-eyes`: the eyes did not move, never ordered.
 * `null`: an event under NULL_AMPLITUDE_DEG in whose window no joint moved; it is left out of both shares.
 */
export type GazeOrderPattern = 'full' | 'no-chest' | 'no-head' | 'eyes-only' | 'no-eyes' | 'null'

export interface GazeOrderShift {
  /** Event time, motion seconds. */
  readonly t: number
  readonly amplitudeDeg: number
  /** Onset after the event, ms; null when the joint did not move in the window. */
  readonly onsetMs: { readonly eyes: number | null, readonly head: number | null, readonly chest: number | null }
  readonly pattern: GazeOrderPattern
  readonly ordered: boolean
  readonly blink: boolean
}

export interface GazeOrderReport {
  readonly kind: 'gaze-order'
  readonly version: 2
  readonly shifts: readonly GazeOrderShift[]
  /** All events except `null` ones. */
  readonly ordered: number
  readonly orderedShare: number
  /** The goal-2 criterion: the ordered share over shifts of at least `minAmplitudeDeg`; null without such a shift. */
  readonly criterion: { readonly minAmplitudeDeg: number, readonly ordered: number, readonly total: number, readonly share: number | null }
  readonly nullEvents: number
  readonly patterns: Readonly<Record<GazeOrderPattern, number>>
  readonly largeShifts: number
  /** Share of large shifts with a blink in their window; null when there is no large shift. */
  readonly blinkShare: number | null
}

const SHIFT_PREFIX = 'gaze-shift:'
const WINDOW_SECONDS = 2
const ONSET_SHARE = 0.1
const LARGE_SHIFT_DEG = 40
// Below the smallest scripted jump (15 degrees), so every scripted jump counts.
const CRITERION_DEG = 10
const NULL_AMPLITUDE_DEG = 0.5
// Event times are float64 sums of dt; the trace clock is float32, which rounds about 4e-6 s at 60 s.
const CLOCK_TOLERANCE = 1e-4

/** Parent-relative angular speed of one trace column, rad/s, from the interval that ends at each sample. */
function localSpeed(input: DecodedMotionTrace, column: number, times: readonly number[]): number[] {
  const count = input.trace.rig.bones.length
  const speed = Array.from<number>({ length: times.length }).fill(0)
  for (let i = 1; i < times.length; i++) {
    const a = (i - 1) * count * 4 + column * 4
    const b = i * count * 4 + column * 4
    const q = input.rot
    const d = Math.abs(q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3])
    speed[i] = 2 * Math.acos(Math.min(1, d)) / (times[i] - times[i - 1])
  }
  return speed
}

/** First sample of [start, end) above ONSET_SHARE of the window's own peak; null for a zero peak. */
function onset(speed: readonly number[], start: number, end: number): number | null {
  let peak = 0
  for (let i = start; i < end; i++)
    peak = Math.max(peak, speed[i])
  if (peak <= 0)
    return null
  for (let i = start; i < end; i++) {
    if (speed[i] > ONSET_SHARE * peak)
      return i
  }
  return null
}

function classify(eyes: number | null, head: number | null, chest: number | null): { pattern: GazeOrderPattern, ordered: boolean } {
  if (eyes === null)
    return { pattern: 'no-eyes', ordered: false }
  if (head !== null && chest !== null)
    return { pattern: 'full', ordered: eyes < head && head < chest }
  if (head !== null)
    return { pattern: 'no-chest', ordered: eyes < head }
  if (chest !== null)
    return { pattern: 'no-head', ordered: eyes < chest }
  return { pattern: 'eyes-only', ordered: true }
}

/**
 * Lead rule for goal 2: per `gaze-shift:<deg>` marker, the onset of the eyes, the head and the chest is the first
 * sample at or after the event whose parent-relative angular speed exceeds 10% of that joint's own peak in the
 * shift window, which ends at the next gaze-shift event or 2 s later, whichever is first. Eyes are the mean of the
 * present eye columns. A shift is ordered when eyes < head < chest strictly; a joint without an onset is left out,
 * but the eyes must move.
 */
export function gazeOrderReport(input: DecodedMotionTrace): GazeOrderReport {
  const { trace, channels } = input
  const markers = trace.events.flatMap(e => e.kind === 'marker' ? [e] : [])
  const events = markers.filter(e => e.label.startsWith(SHIFT_PREFIX))
  if (!events.length)
    throw new GazeOrderRefusal('no-gaze-shifts', 'The trace has no gaze-shift marker')
  const column = (bone: MotionTraceBone) => trace.rig.bones.indexOf(bone)
  const eyeColumns = (['leftEye', 'rightEye'] as const).map(column).filter(c => c >= 0)
  const absent = [...(eyeColumns.length ? [] : ['leftEye/rightEye']), ...(['head', 'chest'] as const).filter(b => column(b) < 0)]
  if (absent.length)
    throw new GazeOrderRefusal('bone-absent', `The trace has no ${absent.join(', ')} column`)
  const stride = MOTION_TRACE_CHANNELS.length
  const times = Array.from({ length: trace.frames }, (_, i) => channels[i * stride])
  const eyeSpeeds = eyeColumns.map(c => localSpeed(input, c, times))
  const eyes = times.map((_, i) => eyeSpeeds.reduce((s, v) => s + v[i], 0) / eyeSpeeds.length)
  const head = localSpeed(input, column('head'), times)
  const chest = localSpeed(input, column('chest'), times)
  const blinks = markers.filter(e => e.label === 'blink').map(e => e.t)
  const firstAtOrAfter = (t: number) => {
    const i = times.findIndex(time => time >= t - CLOCK_TOLERANCE)
    return i < 0 ? times.length : i
  }
  const shifts = events.map((event, k): GazeOrderShift => {
    const until = Math.min(events[k + 1]?.t ?? Number.POSITIVE_INFINITY, event.t + WINDOW_SECONDS)
    const start = firstAtOrAfter(event.t)
    const end = firstAtOrAfter(until)
    const ms = (i: number | null) => i === null ? null : (times[i] - event.t) * 1000
    const e = onset(eyes, start, end)
    const h = onset(head, start, end)
    const c = onset(chest, start, end)
    const amplitudeDeg = Number.parseFloat(event.label.slice(SHIFT_PREFIX.length))
    const still = e === null && h === null && c === null
    return {
      t: event.t,
      amplitudeDeg,
      onsetMs: { eyes: ms(e), head: ms(h), chest: ms(c) },
      ...(still && amplitudeDeg < NULL_AMPLITUDE_DEG ? { pattern: 'null' as const, ordered: false } : classify(e, h, c)),
      blink: blinks.some(t => t >= event.t - CLOCK_TOLERANCE && t < until - CLOCK_TOLERANCE),
    }
  })
  const patterns: Record<GazeOrderPattern, number> = { 'full': 0, 'no-chest': 0, 'no-head': 0, 'eyes-only': 0, 'no-eyes': 0, 'null': 0 }
  for (const s of shifts)
    patterns[s.pattern]++
  const counted = shifts.filter(s => s.pattern !== 'null')
  const ordered = counted.filter(s => s.ordered).length
  const criterion = counted.filter(s => s.amplitudeDeg >= CRITERION_DEG)
  const criterionOrdered = criterion.filter(s => s.ordered).length
  const large = shifts.filter(s => s.amplitudeDeg >= LARGE_SHIFT_DEG)
  return {
    kind: 'gaze-order',
    version: 2,
    shifts,
    ordered,
    orderedShare: counted.length ? ordered / counted.length : 0,
    criterion: { minAmplitudeDeg: CRITERION_DEG, ordered: criterionOrdered, total: criterion.length, share: criterion.length ? criterionOrdered / criterion.length : null },
    nullEvents: patterns.null,
    patterns,
    largeShifts: large.length,
    blinkShare: large.length ? large.filter(s => s.blink).length / large.length : null,
  }
}

export function formatGazeOrderReport(report: GazeOrderReport): string {
  const ms = (v: number | null) => v === null ? '-' : v.toFixed(1)
  const lines = [
    't s\tamplitude deg\teyes ms\thead ms\tchest ms\tpattern\tordered\tblink',
    ...report.shifts.map(s => [s.t.toFixed(3), s.amplitudeDeg.toFixed(2), ms(s.onsetMs.eyes), ms(s.onsetMs.head), ms(s.onsetMs.chest), s.pattern, s.ordered ? 'yes' : 'no', s.blink ? 'yes' : 'no'].join('\t')),
    '',
    `ordered share, all events: ${report.ordered}/${report.shifts.length - report.nullEvents} = ${report.orderedShare.toFixed(3)}`,
    report.criterion.share === null
      ? `ordered share, shifts of ${report.criterion.minAmplitudeDeg} deg or more: no such shift`
      : `ordered share, shifts of ${report.criterion.minAmplitudeDeg} deg or more: ${report.criterion.ordered}/${report.criterion.total} = ${report.criterion.share.toFixed(3)}`,
    `null events (under ${NULL_AMPLITUDE_DEG} deg, no joint moved; in neither share): ${report.nullEvents}`,
    `patterns: ${Object.entries(report.patterns).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    report.blinkShare === null
      ? `blink share over shifts of ${LARGE_SHIFT_DEG} deg or more: no such shift`
      : `blink share over shifts of ${LARGE_SHIFT_DEG} deg or more: ${Math.round(report.blinkShare * report.largeShifts)}/${report.largeShifts} = ${report.blinkShare.toFixed(3)}`,
  ]
  return `${lines.join('\n')}\n`
}
