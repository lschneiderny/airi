import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import type { PreparedTrace, Vec3 } from '../metrics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'

import { percentile } from '../gate/bands'
import { conjugate, DEG, HZ, mean, multiply, norm, rotationVector } from '../metrics/math'
import { traceParent } from './kinematics'
import { criterionReport, fixed, formatReport, requirement } from './report'

export const CUE_BODY_VERSION = 3

/** Natural's cue durations for one count (`cue-gestures.ts`, `start`; the glance holds 0.6 s). */
export const CUE_SECONDS: Readonly<Record<CueGestureKind, number>> = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
const CUES = Object.keys(CUE_SECONDS) as CueGestureKind[]
/** Bones below the neck; a rig without `upperChest` skips it. */
export const CUE_BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']

const C = { tail: 0.5, clearance: 1, emotionOnset: 2, percentile: 0.95, events: 5, minimumWindows: 20, falsePositive: 0.1, minimumEvents: 6, draws: 1000, seed: 20261112, pseudoEvents: 100 }

export const CUE_BODY_CONSTANTS: readonly ReportConstant[] = [
  { name: 'cue window', value: `start .. start + duration + ${C.tail}`, unit: 's', source: 'plan 2.3' },
  { name: 'placebo window', value: `same length, ${C.clearance} s clear of every cue window and every emotion event's first ${C.emotionOnset} s`, unit: 's', source: 'unit M2 R3: placebo windows of the same runs; 2 s is the start of the gate emotionHoldSeconds' },
  { name: 'event threshold', value: C.percentile, unit: 'percentile of the placebo windows\' max over bones of turn / placebo SD', source: 'unit M2 R3: family-wise over the bones' },
  { name: 'time-locked average', value: `>= ${C.minimumEvents} events`, unit: 'per kind, averaged frame by frame from the cue marker', source: 'unit M3 item 6: averaging time-locked responses detects a small evoked response in noise' },
  { name: 'null', value: `${C.draws} seeded draws (seed ${C.seed})`, unit: 'averages of as many placebo windows as events', source: 'unit M3 item 6: the same runs\' idle' },
  { name: 'per-event count', value: C.events, unit: 'of 6, report only', source: 'plan 2.3 (version 2 rule)' },
  { name: 'minimum placebo windows', value: C.minimumWindows, unit: 'per kind', source: 'unit M2 R3: a 95th percentile needs at least 20 samples' },
  { name: 'split-half false positives', value: C.falsePositive, unit: 'share of placebo windows', source: 'unit M2 R3 negative control (printed, not required)' },
  ...CUES.map(cue => ({ name: `${cue} duration`, value: CUE_SECONDS[cue], unit: 's', source: 'motion-driver-natural cue-gestures.ts start' })),
]

/** The largest turn, degrees, of a bone relative to its trace parent (world at the root) from `start` to any sample up to `end`. */
function excursion(p: PreparedTrace, bone: MotionTraceBone, start: number, end: number): number | null {
  const own = p.orientations[bone]
  const parentBone = traceParent(p, bone)
  const parent = parentBone ? p.orientations[parentBone] : null
  const i = Math.round((start - p.times[0]) * HZ)
  const j = Math.round((end - p.times[0]) * HZ)
  if (!own || (parentBone && !parent) || i < 0 || j >= p.times.length)
    return null
  const local = (k: number) => parent ? multiply(conjugate(parent[k]), own[k]) : own[k]
  const from = conjugate(local(i))
  let largest = 0
  for (let k = i + 1; k <= j; k++) {
    const turn = multiply(from, local(k))
    largest = Math.max(largest, 2 * Math.acos(Math.min(1, Math.abs(turn[3]))) * DEG)
  }
  return largest
}

type Sample = Partial<Record<MotionTraceBone, number>>
type Trajectory = Partial<Record<MotionTraceBone, Vec3[]>>

/** Each below-neck bone's turn relative to its parent from `start`, rotation vectors in degrees, over the cue window. */
function trajectory(p: PreparedTrace, start: number, seconds: number): Trajectory | null {
  const i = Math.round((start - p.times[0]) * HZ)
  const n = Math.round((seconds + C.tail) * HZ)
  if (i < 0 || i + n >= p.times.length)
    return null
  const entries = CUE_BONES.flatMap((bone) => {
    const own = p.orientations[bone]
    const parentBone = traceParent(p, bone)
    const parent = parentBone ? p.orientations[parentBone] : null
    if (!own || (parentBone && !parent))
      return []
    const local = (k: number) => parent ? multiply(conjugate(parent[k]), own[k]) : own[k]
    const from = conjugate(local(i))
    return [[bone, Array.from({ length: n + 1 }, (_, k): Vec3 => {
      const v = rotationVector(multiply(from, local(i + k)))
      return [v[0] * DEG, v[1] * DEG, v[2] * DEG]
    })] as const]
  })
  return Object.fromEntries(entries)
}

/** The per-event statistic on the frame-by-frame average of `trajectories`. */
function averagedStatistic(trajectories: readonly Trajectory[], sd: CueModel['sd']): number {
  let best = 0
  for (const bone of CUE_BONES) {
    const series = trajectories.flatMap(x => x[bone] ? [x[bone]] : [])
    if (!series.length || series.length !== trajectories.length)
      continue
    let largest = 0
    for (let k = 0; k < series[0].length; k++) {
      let x = 0
      let y = 0
      let z = 0
      for (const s of series) {
        x += s[k][0]
        y += s[k][1]
        z += s[k][2]
      }
      largest = Math.max(largest, norm([x, y, z]) / series.length)
    }
    const spread = sd[bone] ?? 0
    best = Math.max(best, largest === 0 ? 0 : spread > 0 ? largest / spread : Number.POSITIVE_INFINITY)
  }
  return best
}

/** The null's 95th percentile: the averaged statistic over `draws` seeded draws of `size` distinct placebo windows. */
function nullThreshold(pool: readonly Trajectory[], size: number, sd: CueModel['sd'], random: () => number): number | null {
  if (size < 1 || pool.length < size)
    return null
  const stats = Array.from({ length: C.draws }, () => {
    const order = pool.map((_, i) => i)
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(random() * (order.length - i))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    return averagedStatistic(order.slice(0, size).map(i => pool[i]), sd)
  })
  return percentile(stats, C.percentile)
}

function sample(p: PreparedTrace, start: number, seconds: number): Sample | null {
  const entries = CUE_BONES.flatMap((bone) => {
    const d = excursion(p, bone, start, start + seconds + C.tail)
    return d === null ? [] : [[bone, d] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/** Same-length windows of one run on a grid from the scored start, clear of every cue window and emotion onset. */
function placeboWindows(run: LoadedRun, seconds: number): { sample: Sample, trajectory: Trajectory }[] {
  const { p } = run
  const { scoredFrom, events } = run.input.trace
  const busy = events.flatMap((e) => {
    if (e.kind === 'gesture')
      return [[e.t, e.t + (CUE_SECONDS[e.gesture as CueGestureKind] ?? 0) + C.tail]]
    return e.kind === 'emotion' ? [[e.t, e.t + C.emotionOnset]] : []
  })
  const length = seconds + C.tail
  const windows: { sample: Sample, trajectory: Trajectory }[] = []
  for (let start = scoredFrom; start + length <= p.times[p.times.length - 1]; start += length) {
    if (busy.some(([from, to]) => to >= start - C.clearance && from <= start + length + C.clearance))
      continue
    const s = sample(p, start, seconds)
    const x = trajectory(p, start, seconds)
    if (s && x)
      windows.push({ sample: s, trajectory: x })
  }
  return windows
}

export interface CueModel {
  readonly sd: Readonly<Partial<Record<MotionTraceBone, number>>>
  readonly threshold: number | null
  readonly windows: number
}

function standardDeviation(values: readonly number[]): number {
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, values.length - 1))
}

/** The family-wise statistic: the largest bone turn in units of that bone's placebo SD (a turn on a still bone is infinite). */
function statistic(s: Sample, sd: CueModel['sd']): { value: number, bone: MotionTraceBone | null } {
  let best = { value: 0, bone: null as MotionTraceBone | null }
  for (const [bone, d] of Object.entries(s) as [MotionTraceBone, number][]) {
    const spread = sd[bone] ?? 0
    const z = d === 0 ? 0 : spread > 0 ? d / spread : Number.POSITIVE_INFINITY
    if (z > best.value)
      best = { value: z, bone }
  }
  return best
}

export function fitCueModel(samples: readonly Sample[]): CueModel {
  const sd = Object.fromEntries(CUE_BONES.flatMap((bone) => {
    const values = samples.flatMap(s => s[bone] === undefined ? [] : [s[bone]])
    return values.length > 1 ? [[bone, standardDeviation(values)]] : []
  }))
  const stats = samples.map(s => statistic(s, sd).value)
  return { sd, threshold: samples.length >= C.minimumWindows ? percentile(stats, C.percentile) : null, windows: samples.length }
}

export interface CueEvent {
  readonly run: string
  readonly cue: CueGestureKind
  readonly t: number
  readonly statistic: number
  readonly bone: MotionTraceBone | null
  readonly counted: boolean
}

export interface CueBodyDetail {
  readonly events: readonly CueEvent[]
  readonly models: Readonly<Record<CueGestureKind, CueModel>>
  /** Per-event counts (version 2 rule), report only. */
  readonly perKind: Readonly<Record<CueGestureKind, { readonly counted: number, readonly total: number }>>
  readonly averaged: Readonly<Record<CueGestureKind, { readonly events: number, readonly statistic: number, readonly nullP95: number | null }>>
  readonly splitHalf: ReturnType<typeof cueFalsePositives>
}

/**
 * C002 cue-body report, version 3 (unit M3 item 6): per cue kind, the kind's events are aligned at the cue marker and
 * their below-neck trajectories averaged; the largest averaged bone turn, in units of that bone's SD over same-length
 * placebo windows, must exceed the 95th percentile of the same statistic on 1000 seeded averages of as many placebo
 * windows. At least 6 events and 20 placebo windows per kind. Per-event counts (version 2) are printed only.
 */
export function cueBodyReport(runs: readonly LoadedRun[]): CriterionReport<CueBodyDetail> {
  const windows = Object.fromEntries(CUES.map(cue => [cue, runs.flatMap(run => placeboWindows(run, CUE_SECONDS[cue]))])) as Record<CueGestureKind, { sample: Sample, trajectory: Trajectory }[]>
  const models = Object.fromEntries(CUES.map(cue => [cue, fitCueModel(windows[cue].map(w => w.sample))])) as Record<CueGestureKind, CueModel>
  const random = createRandomStream(C.seed)
  const traced: { cue: CueGestureKind, trajectory: Trajectory | null }[] = []
  const events: CueEvent[] = runs.flatMap(run => run.input.trace.events.flatMap((e) => {
    if (e.kind !== 'gesture' || !(e.gesture in CUE_SECONDS))
      return []
    const cue = e.gesture as CueGestureKind
    const s = sample(run.p, e.t, CUE_SECONDS[cue])
    traced.push({ cue, trajectory: trajectory(run.p, e.t, CUE_SECONDS[cue]) })
    const model = models[cue]
    const stat = s ? statistic(s, model.sd) : { value: 0, bone: null }
    return [{ run: run.dir, cue, t: e.t, statistic: stat.value, bone: stat.bone, counted: model.threshold !== null && stat.value > model.threshold }]
  }))
  const perKind = Object.fromEntries(CUES.map(cue => [cue, { counted: events.filter(e => e.cue === cue && e.counted).length, total: events.filter(e => e.cue === cue).length }])) as CueBodyDetail['perKind']
  const averaged = Object.fromEntries(CUES.map((cue) => {
    const trajectories = traced.flatMap(x => x.cue === cue && x.trajectory ? [x.trajectory] : [])
    const sd = models[cue].sd
    return [cue, { events: trajectories.length, statistic: averagedStatistic(trajectories, sd), nullP95: models[cue].windows >= C.minimumWindows ? nullThreshold(windows[cue].map(w => w.trajectory), trajectories.length, sd, random) : null }]
  })) as Record<CueGestureKind, { events: number, statistic: number, nullP95: number | null }>
  return criterionReport('cue-body', CUE_BODY_VERSION, runs.map(r => r.dir), CUE_BODY_CONSTANTS, CUES.map((cue) => {
    const a = averaged[cue]
    return requirement(
      `cue-${cue}`,
      `the time-locked average of >= ${C.minimumEvents} ${cue} events: largest below-neck turn / placebo SD > p95 of ${C.draws} seeded placebo averages (>= ${C.minimumWindows} placebo windows)`,
      `${fixed(a.statistic, 2)} against ${fixed(a.nullP95, 2)} over ${a.events} events and ${models[cue].windows} windows; per-event (report only) ${perKind[cue].counted}/${perKind[cue].total}`,
      a.events >= C.minimumEvents && a.nullP95 !== null && a.statistic > a.nullP95,
    )
  }), { events, models, perKind, averaged, splitHalf: cueFalsePositives(runs) })
}

/**
 * The item 6 negative control: placebo windows split in alternating halves. The null comes from one half; 100
 * pseudo-events of 6 windows drawn from the other half are scored against it, in both directions. Expected 5 %.
 */
export function cueFalsePositives(runs: readonly LoadedRun[]): Readonly<Record<CueGestureKind, { readonly flagged: number, readonly total: number }>> {
  const random = createRandomStream(C.seed + 1)
  return Object.fromEntries(CUES.map((cue) => {
    const windows = runs.flatMap(run => placeboWindows(run, CUE_SECONDS[cue]))
    const halves = [windows.filter((_, i) => i % 2 === 0), windows.filter((_, i) => i % 2 === 1)]
    let flagged = 0
    let total = 0
    for (const [fit, score] of [[halves[0], halves[1]], [halves[1], halves[0]]]) {
      const { sd } = fitCueModel(fit.map(w => w.sample))
      const bar = nullThreshold(fit.map(w => w.trajectory), C.minimumEvents, sd, random)
      if (bar === null || score.length < C.minimumEvents)
        continue
      for (let k = 0; k < C.pseudoEvents; k++) {
        const order = score.map((_, i) => i)
        for (let i = 0; i < C.minimumEvents; i++) {
          const j = i + Math.floor(random() * (order.length - i))
          ;[order[i], order[j]] = [order[j], order[i]]
        }
        total++
        if (averagedStatistic(order.slice(0, C.minimumEvents).map(i => score[i].trajectory), sd) > bar)
          flagged++
      }
    }
    return [cue, { flagged, total }]
  })) as Record<CueGestureKind, { flagged: number, total: number }>
}

export function formatCueBody(report: CriterionReport<CueBodyDetail>): string {
  const d = report.detail
  return formatReport(report, [
    'placebo model per kind: windows, p95 of the statistic, bone SD of the turn (deg)',
    ...CUES.map(cue => `  ${cue}\t${d.models[cue].windows}\t${fixed(d.models[cue].threshold, 2)}\t${Object.entries(d.models[cue].sd).map(([b, v]) => `${b} ${fixed(v ?? null, 3)}`).join(', ')}`),
    `split-half false positives of the time-locked rule (expected 5 %): ${CUES.map(cue => `${cue} ${d.splitHalf[cue].flagged}/${d.splitHalf[cue].total}`).join(', ')}`,
    'cue events: run, cue, t s, statistic, largest bone, counted',
    ...d.events.map(e => `  ${e.run}\t${e.cue}\t${e.t.toFixed(3)}\t${fixed(e.statistic, 2)}\t${e.bone ?? '-'}\t${e.counted ? 'yes' : 'no'}`),
  ])
}

export function formatCueFalsePositives(shares: ReturnType<typeof cueFalsePositives>): string {
  return `${[
    `cue-body split-half false positives of the time-locked rule (unit M3 item 6): pseudo-events of 6 placebo windows from one half against the null of the other, expected 5 %, at most ${C.falsePositive * 100} %`,
    ...CUES.map(cue => `  ${cue}\t${shares[cue].flagged}/${shares[cue].total} = ${fixed(shares[cue].total ? shares[cue].flagged / shares[cue].total : null)}\t${shares[cue].total && shares[cue].flagged / shares[cue].total <= C.falsePositive ? 'within' : 'NOT within'}`),
  ].join('\n')}\n`
}

export const CUE_FALSE_POSITIVE_LIMIT = C.falsePositive
