import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import type { PreparedTrace, Vec3 } from '../metrics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'

import { percentile } from '../gate/bands'
import { conjugate, DEG, HZ, mean, multiply, norm, rotationVector } from '../metrics/math'
import { mirrorBone, mirrorRotation } from '../metrics/mirror'
import { traceParent } from './kinematics'
import { consensusSides, dot } from './mirror'
import { criterionReport, fixed, formatReport, reportOnly, requirement } from './report'

export const CUE_BODY_VERSION = 5

/** Natural's cue durations for one count (`cue-gestures.ts`, `start`; the glance holds 0.6 s). */
export const CUE_SECONDS: Readonly<Record<CueGestureKind, number>> = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
const CUES = Object.keys(CUE_SECONDS) as CueGestureKind[]
/** Bones below the neck; a rig without `upperChest` skips it. */
export const CUE_BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']

/** Cue kinds printed but left out of the verdict (owner decision 2026-11-12, E/g3/s/rules.md 14), with the reason. */
const REPORT_ONLY: Partial<Record<CueGestureKind, string>> = {
  lean: 'the null of the bone-normalised maximum is set by idle drift of a near-still shoulder; a FAIL means not shown above idle, not a motion fault; judged by visual review',
}

const C = { tail: 0.5, clearance: 1, emotionOnset: 2, percentile: 0.95, events: 5, minimumWindows: 20, falsePositive: 0.05, nullPercentile: 0.99, minimumEvents: 6, draws: 1000, seed: 20261112, pseudoEvents: 100 }

export const CUE_BODY_CONSTANTS: readonly ReportConstant[] = [
  { name: 'cue window', value: `start .. start + duration + ${C.tail}`, unit: 's', source: 'plan 2.3' },
  { name: 'placebo window', value: `same length, ${C.clearance} s clear of every cue window, every neutral or placebo event's first ${C.emotionOnset} s, and every posed emotion up to the next trial's or cue's event`, unit: 's', source: 'unit M2 R3: placebo windows of the same runs; 2 s is the start of the gate emotionHoldSeconds; E/g3/s/rules.md 12.2 (version 5): a posed hold or release in the pool, mirrored, raised the null' },
  { name: 'event threshold', value: C.percentile, unit: 'percentile of the placebo windows\' max over bones of turn / placebo SD', source: 'unit M2 R3: family-wise over the bones' },
  { name: 'time-locked average', value: `>= ${C.minimumEvents} events`, unit: 'per kind, averaged frame by frame from the cue marker', source: 'unit M3 item 6: averaging time-locked responses detects a small evoked response in noise' },
  { name: 'null', value: `p${C.nullPercentile * 100} of ${C.draws} seeded draws (seed ${C.seed})`, unit: 'averages of as many placebo windows as events', source: 'unit M3 items 6 and 7b: the same runs\' idle' },
  { name: 'leave-one-out', value: 'every n - 1 average', unit: 'against the null of n - 1 placebo windows', source: 'unit M3 item 7a: no single event may carry a kind' },
  { name: 'side', value: 'consensus mirroring', unit: 'before every average (events, leave-one-out sets and null draws alike)', source: 'E/g3/s/rules.md 6.4: Natural cues go to a random side; a response and its mirror image are one response' },
  { name: 'per-event count', value: C.events, unit: 'of 6, report only', source: 'plan 2.3 (version 2 rule)' },
  { name: 'minimum placebo windows', value: C.minimumWindows, unit: 'per kind', source: 'unit M2 R3: a 95th percentile needs at least 20 samples' },
  { name: 'split-half false positives', value: C.falsePositive, unit: 'share of placebo windows', source: 'unit M2 R3 negative control (printed, not required)' },
  { name: 'report-only line', value: 'cue-lean', unit: `printed, left out of the verdict: ${REPORT_ONLY.lean}; a per-bone null is owed in a later version`, source: 'owner decision 2026-11-12; E/g3/emotion-measure-review-2.md blocker 1' },
  { name: 'limit', value: 'shrug, glance', unit: 'their no-response averages already clear the null on pure idle; only the leave-one-out keeps the false positives within 5 %', source: 'E/g3/emotion-measure-review-2.md limit 8' },
  { name: 'limit', value: 'shake', unit: 'the design shake at 0.32 of the head turn reads like no response; the smallest passing shake is 0.48', source: 'E/g3/emotion-measure-review-2.md limit 9' },
  { name: 'limit', value: 'every kind', unit: 'a response that cannot be told from mirrored idle reads FAIL', source: 'E/g3/emotion-measure-review-2.md limit 11' },
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

// The 1000-draw nulls reuse each placebo window many times; its mirror image, antisymmetric part and their dot
// products are computed once per trajectory.
const mirrors = new WeakMap<Trajectory, Trajectory>()
const antisymmetricParts = new WeakMap<Trajectory, number[]>()
const antisymmetricDots = new WeakMap<Trajectory, Map<Trajectory, number>>()

/** A trajectory's left-right mirror image: left and right bones swap and every rotation vector mirrors. */
function mirrored(x: Trajectory): Trajectory {
  const cached = mirrors.get(x)
  if (cached)
    return cached
  const image: Trajectory = Object.fromEntries(Object.entries(x).flatMap(([bone, series]) => {
    const other = mirrorBone(bone as MotionTraceBone)
    return other in x ? [[other, (series ?? []).map(mirrorRotation)]] : []
  }))
  mirrors.set(x, image)
  return image
}

function antisymmetricDot(a: Trajectory, b: Trajectory): number {
  const known = antisymmetricDots.get(a)?.get(b)
  if (known !== undefined)
    return known
  const value = dot(antisymmetric(a), antisymmetric(b))
  for (const [x, y] of [[a, b], [b, a]]) {
    const row = antisymmetricDots.get(x) ?? new Map<Trajectory, number>()
    row.set(y, value)
    antisymmetricDots.set(x, row)
  }
  return value
}

/** The trajectory's antisymmetric part, flattened over the bones that have their mirror bone. */
function antisymmetric(x: Trajectory): number[] {
  const cached = antisymmetricParts.get(x)
  if (cached)
    return cached
  const part = CUE_BONES.flatMap((bone) => {
    const own = x[bone]
    const other = x[mirrorBone(bone)]
    if (!own || !other)
      return []
    return own.flatMap((v, k) => {
      const m = mirrorRotation(other[k])
      return [(v[0] - m[0]) / 2, (v[1] - m[1]) / 2, (v[2] - m[2]) / 2]
    })
  })
  antisymmetricParts.set(x, part)
  return part
}

/**
 * The per-event statistic on the frame-by-frame average of `trajectories`, each first mirrored to the set's consensus
 * side (version 5), so a response toward the left and the same response toward the right add up instead of cancelling.
 */
function averagedStatistic(input: readonly Trajectory[], sd: CueModel['sd']): number {
  const sides = consensusSides(input.map(a => input.map(b => antisymmetricDot(a, b))))
  const trajectories = input.map((x, i) => sides[i] < 0 ? mirrored(x) : x)
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

/** The null's 99th percentile (unit M3 item 7b): the averaged statistic over `draws` seeded draws of `size` distinct placebo windows. */
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
  return percentile(stats, C.nullPercentile)
}

function sample(p: PreparedTrace, start: number, seconds: number): Sample | null {
  const entries = CUE_BONES.flatMap((bone) => {
    const d = excursion(p, bone, start, start + seconds + C.tail)
    return d === null ? [] : [[bone, d] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/**
 * Same-length windows of one run on a grid from the scored start, clear of every cue window, of each neutral or placebo
 * trial's first 2 s, and (version 5, E/g3/s/rules.md 12.2) of each posed emotion from its event to the next trial's or
 * cue's event, so that no window holds a posed emotion's hold or release.
 */
function placeboWindows(run: LoadedRun, seconds: number): { sample: Sample, trajectory: Trajectory }[] {
  const { p } = run
  const { scoredFrom, events } = run.input.trace
  const timed = events.filter(e => e.kind === 'gesture' || e.kind === 'emotion').sort((a, b) => a.t - b.t)
  const busy = timed.flatMap((e) => {
    if (e.kind === 'gesture')
      return [[e.t, e.t + (CUE_SECONDS[e.gesture as CueGestureKind] ?? 0) + C.tail]]
    if (e.kind !== 'emotion')
      return []
    if (e.phase === 'placebo' || e.emotion === 'neutral')
      return [[e.t, e.t + C.emotionOnset]]
    const next = timed.find(x => x.t > e.t && (x.kind !== 'emotion' || x.trialId === undefined || x.trialId !== e.trialId))
    return [[e.t, next?.t ?? Number.POSITIVE_INFINITY]]
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

/** Unit M3 item 7: the all-events average and every leave-one-out average against their nulls. */
function judgeAverage(trajectories: readonly Trajectory[], pool: readonly Trajectory[], sd: CueModel['sd'], random: () => number) {
  const n = trajectories.length
  const statistic = averagedStatistic(trajectories, sd)
  const nullAll = nullThreshold(pool, n, sd, random)
  const nullLeaveOut = nullThreshold(pool, n - 1, sd, random)
  const leaveOut = trajectories.map((_, k) => averagedStatistic(trajectories.filter((_, i) => i !== k), sd))
  const weakest = leaveOut.length ? Math.min(...leaveOut) : 0
  const pass = n >= C.minimumEvents && nullAll !== null && nullLeaveOut !== null && statistic > nullAll && weakest > nullLeaveOut
  return { events: n, statistic, nullP99: nullAll, leaveOutMinimum: weakest, leaveOutNullP99: nullLeaveOut, pass, averagePass: nullAll !== null && statistic > nullAll }
}

export interface CueBodyDetail {
  readonly events: readonly CueEvent[]
  readonly models: Readonly<Record<CueGestureKind, CueModel>>
  /** Per-event counts (version 2 rule), report only. */
  readonly perKind: Readonly<Record<CueGestureKind, { readonly counted: number, readonly total: number }>>
  readonly averaged: Readonly<Record<CueGestureKind, ReturnType<typeof judgeAverage>>>
  readonly splitHalf: ReturnType<typeof cueFalsePositives>
}

/**
 * C002 cue-body report, version 5 (unit M3 items 6 and 7; E/g3/s/rules.md 6.4 and 12.2): per cue kind, the kind's events are
 * aligned at the cue marker, mirrored to their consensus side and their below-neck trajectories averaged; the largest
 * averaged bone turn, in units of that bone's SD over same-length placebo windows, must exceed the 99th percentile of
 * the same statistic on 1000 seeded averages of as many placebo windows, mirrored the same way, and so must every
 * average with one event left out. The placebo windows lie clear of every posed emotion's hold and release. At least 6
 * events and 20 placebo windows per kind. Per-event counts (version 2) are printed only. cue-lean is printed with its
 * reading and bar but left out of the verdict (`REPORT_ONLY`); nod, shake, shrug and glance decide it.
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
    return [cue, judgeAverage(trajectories, models[cue].windows >= C.minimumWindows ? windows[cue].map(w => w.trajectory) : [], sd, random)]
  })) as Record<CueGestureKind, ReturnType<typeof judgeAverage>>
  return criterionReport('cue-body', CUE_BODY_VERSION, runs.map(r => r.dir), CUE_BODY_CONSTANTS, CUES.map((cue) => {
    const a = averaged[cue]
    const line = requirement(
      `cue-${cue}`,
      `the time-locked average of >= ${C.minimumEvents} ${cue} events and every average with one event left out: largest below-neck turn / placebo SD > p${C.nullPercentile * 100} of ${C.draws} seeded placebo averages of as many windows (>= ${C.minimumWindows} placebo windows)`,
      `${fixed(a.statistic, 2)} against ${fixed(a.nullP99, 2)} over ${a.events} events; weakest leave-one-out ${fixed(a.leaveOutMinimum, 2)} against ${fixed(a.leaveOutNullP99, 2)}; ${models[cue].windows} windows; per-event (report only) ${perKind[cue].counted}/${perKind[cue].total}`,
      a.pass,
    )
    const reason = REPORT_ONLY[cue]
    return reason ? reportOnly(line, reason) : line
  }), { events, models, perKind, averaged, splitHalf: cueFalsePositives(runs) })
}

/**
 * The item 6 and 7 negative control: placebo windows split in alternating halves. The nulls come from one half; 100
 * pseudo-events of 6 windows drawn from the other half are judged by the full rule, in both directions. Nominal 1 %.
 * `averageOnly` counts the pseudo-events whose all-events average alone clears its null.
 */
export function cueFalsePositives(runs: readonly LoadedRun[]): Readonly<Record<CueGestureKind, { readonly flagged: number, readonly averageOnly: number, readonly total: number }>> {
  const random = createRandomStream(C.seed + 1)
  return Object.fromEntries(CUES.map((cue) => {
    const windows = runs.flatMap(run => placeboWindows(run, CUE_SECONDS[cue]))
    const halves = [windows.filter((_, i) => i % 2 === 0), windows.filter((_, i) => i % 2 === 1)]
    let flagged = 0
    let averageOnly = 0
    let total = 0
    for (const [fit, score] of [[halves[0], halves[1]], [halves[1], halves[0]]]) {
      const { sd } = fitCueModel(fit.map(w => w.sample))
      const pool = fit.map(w => w.trajectory)
      const barAll = nullThreshold(pool, C.minimumEvents, sd, random)
      const barLeaveOut = nullThreshold(pool, C.minimumEvents - 1, sd, random)
      if (barAll === null || barLeaveOut === null || score.length < C.minimumEvents)
        continue
      for (let k = 0; k < C.pseudoEvents; k++) {
        const order = score.map((_, i) => i)
        for (let i = 0; i < C.minimumEvents; i++) {
          const j = i + Math.floor(random() * (order.length - i))
          ;[order[i], order[j]] = [order[j], order[i]]
        }
        const picked = order.slice(0, C.minimumEvents).map(i => score[i].trajectory)
        total++
        const all = averagedStatistic(picked, sd) > barAll
        if (all)
          averageOnly++
        if (all && picked.every((_, out) => averagedStatistic(picked.filter((_, i) => i !== out), sd) > barLeaveOut))
          flagged++
      }
    }
    return [cue, { flagged, averageOnly, total }]
  })) as Record<CueGestureKind, { flagged: number, averageOnly: number, total: number }>
}

export function formatCueBody(report: CriterionReport<CueBodyDetail>): string {
  const d = report.detail
  return formatReport(report, [
    'placebo model per kind: windows, p95 of the statistic, bone SD of the turn (deg)',
    ...CUES.map(cue => `  ${cue}\t${d.models[cue].windows}\t${fixed(d.models[cue].threshold, 2)}\t${Object.entries(d.models[cue].sd).map(([b, v]) => `${b} ${fixed(v ?? null, 3)}`).join(', ')}`),
    `split-half false positives of the full rule (nominal 1 %; all-events average alone in brackets): ${CUES.map(cue => `${cue} ${d.splitHalf[cue].flagged}/${d.splitHalf[cue].total} (${d.splitHalf[cue].averageOnly})`).join(', ')}`,
    'cue events: run, cue, t s, statistic, largest bone, counted',
    ...d.events.map(e => `  ${e.run}\t${e.cue}\t${e.t.toFixed(3)}\t${fixed(e.statistic, 2)}\t${e.bone ?? '-'}\t${e.counted ? 'yes' : 'no'}`),
  ])
}

export function formatCueFalsePositives(shares: ReturnType<typeof cueFalsePositives>): string {
  return `${[
    `cue-body split-half false positives of the full rule (unit M3 item 7): pseudo-events of 6 placebo windows from one half against the p${C.nullPercentile * 100} nulls of the other, with leave-one-out, nominal 1 %, at most ${C.falsePositive * 100} %; all-events average alone in brackets`,
    ...CUES.map(cue => `  ${cue}\t${shares[cue].flagged}/${shares[cue].total} = ${fixed(shares[cue].total ? shares[cue].flagged / shares[cue].total : null)} (${shares[cue].averageOnly})\t${shares[cue].total && shares[cue].flagged / shares[cue].total <= C.falsePositive ? 'within' : 'NOT within'}`),
  ].join('\n')}\n`
}

export const CUE_FALSE_POSITIVE_LIMIT = C.falsePositive
