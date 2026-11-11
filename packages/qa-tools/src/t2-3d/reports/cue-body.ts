import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import type { PreparedTrace } from '../metrics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { percentile } from '../gate/bands'
import { conjugate, DEG, HZ, mean, multiply } from '../metrics/math'
import { traceParent } from './kinematics'
import { criterionReport, fixed, formatReport, requirement } from './report'

export const CUE_BODY_VERSION = 2

/** Natural's cue durations for one count (`cue-gestures.ts`, `start`; the glance holds 0.6 s). */
export const CUE_SECONDS: Readonly<Record<CueGestureKind, number>> = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
const CUES = Object.keys(CUE_SECONDS) as CueGestureKind[]
/** Bones below the neck; a rig without `upperChest` skips it. */
export const CUE_BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']

const C = { tail: 0.5, clearance: 1, emotionOnset: 2, percentile: 0.95, events: 5, minimumWindows: 20, falsePositive: 0.1 }

export const CUE_BODY_CONSTANTS: readonly ReportConstant[] = [
  { name: 'cue window', value: `start .. start + duration + ${C.tail}`, unit: 's', source: 'plan 2.3' },
  { name: 'placebo window', value: `same length, ${C.clearance} s clear of every cue window and every emotion event's first ${C.emotionOnset} s`, unit: 's', source: 'unit M2 R3: placebo windows of the same runs; 2 s is the start of the gate emotionHoldSeconds' },
  { name: 'event threshold', value: C.percentile, unit: 'percentile of the placebo windows\' max over bones of turn / placebo SD', source: 'unit M2 R3: family-wise over the bones' },
  { name: 'events per kind', value: C.events, unit: 'of 6', source: 'plan 2.3' },
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

function sample(p: PreparedTrace, start: number, seconds: number): Sample | null {
  const entries = CUE_BONES.flatMap((bone) => {
    const d = excursion(p, bone, start, start + seconds + C.tail)
    return d === null ? [] : [[bone, d] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/** Same-length windows of one run on a grid from the scored start, clear of every cue window and emotion onset. */
function placeboSamples(run: LoadedRun, seconds: number): Sample[] {
  const { p } = run
  const { scoredFrom, events } = run.input.trace
  const busy = events.flatMap((e) => {
    if (e.kind === 'gesture')
      return [[e.t, e.t + (CUE_SECONDS[e.gesture as CueGestureKind] ?? 0) + C.tail]]
    return e.kind === 'emotion' ? [[e.t, e.t + C.emotionOnset]] : []
  })
  const length = seconds + C.tail
  const samples: Sample[] = []
  for (let start = scoredFrom; start + length <= p.times[p.times.length - 1]; start += length) {
    if (busy.some(([from, to]) => to >= start - C.clearance && from <= start + length + C.clearance))
      continue
    const s = sample(p, start, seconds)
    if (s)
      samples.push(s)
  }
  return samples
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
  readonly perKind: Readonly<Record<CueGestureKind, { readonly counted: number, readonly total: number }>>
  readonly splitHalf: ReturnType<typeof cueFalsePositives>
}

/**
 * C002 cue-body report, version 2 (unit M2 R3): a cue event counts when the largest below-neck bone turn over the cue
 * window, in units of that bone's SD over same-length placebo windows of the same runs, exceeds the 95th percentile of
 * the same largest-of-bones statistic over those placebo windows. Every kind must count on at least 5 of its 6 events.
 */
export function cueBodyReport(runs: readonly LoadedRun[]): CriterionReport<CueBodyDetail> {
  const models = Object.fromEntries(CUES.map(cue => [cue, fitCueModel(runs.flatMap(run => placeboSamples(run, CUE_SECONDS[cue])))])) as Record<CueGestureKind, CueModel>
  const events: CueEvent[] = runs.flatMap(run => run.input.trace.events.flatMap((e) => {
    if (e.kind !== 'gesture' || !(e.gesture in CUE_SECONDS))
      return []
    const cue = e.gesture as CueGestureKind
    const s = sample(run.p, e.t, CUE_SECONDS[cue])
    const model = models[cue]
    const stat = s ? statistic(s, model.sd) : { value: 0, bone: null }
    return [{ run: run.dir, cue, t: e.t, statistic: stat.value, bone: stat.bone, counted: model.threshold !== null && stat.value > model.threshold }]
  }))
  const perKind = Object.fromEntries(CUES.map(cue => [cue, { counted: events.filter(e => e.cue === cue && e.counted).length, total: events.filter(e => e.cue === cue).length }])) as CueBodyDetail['perKind']
  return criterionReport('cue-body', CUE_BODY_VERSION, runs.map(r => r.dir), CUE_BODY_CONSTANTS, CUES.map(cue => requirement(
    `cue-${cue}`,
    `the largest below-neck turn / placebo SD exceeds the placebo p95 of that statistic on >= ${C.events} of the ${cue} events (>= ${C.minimumWindows} placebo windows)`,
    `${perKind[cue].counted}/${perKind[cue].total}; placebo p95 ${fixed(models[cue].threshold, 2)} over ${models[cue].windows} windows`,
    models[cue].threshold !== null && perKind[cue].counted >= C.events,
  )), { events, models, perKind, splitHalf: cueFalsePositives(runs) })
}

/**
 * The R3 negative control: placebo windows split in alternating halves, each half scored against the model fitted on
 * the other. A kind's share of flagged windows should stay at or under 10 %.
 */
export function cueFalsePositives(runs: readonly LoadedRun[]): Readonly<Record<CueGestureKind, { readonly flagged: number, readonly total: number }>> {
  return Object.fromEntries(CUES.map((cue) => {
    const samples = runs.flatMap(run => placeboSamples(run, CUE_SECONDS[cue]))
    const halves = [samples.filter((_, i) => i % 2 === 0), samples.filter((_, i) => i % 2 === 1)]
    let flagged = 0
    for (const [fit, score] of [[halves[0], halves[1]], [halves[1], halves[0]]]) {
      const model = fitCueModel(fit)
      flagged += model.threshold === null ? 0 : score.filter(s => statistic(s, model.sd).value > (model.threshold ?? 0)).length
    }
    return [cue, { flagged, total: samples.length }]
  })) as Record<CueGestureKind, { flagged: number, total: number }>
}

export function formatCueBody(report: CriterionReport<CueBodyDetail>): string {
  const d = report.detail
  return formatReport(report, [
    'placebo model per kind: windows, p95 of the statistic, bone SD of the turn (deg)',
    ...CUES.map(cue => `  ${cue}\t${d.models[cue].windows}\t${fixed(d.models[cue].threshold, 2)}\t${Object.entries(d.models[cue].sd).map(([b, v]) => `${b} ${fixed(v ?? null, 3)}`).join(', ')}`),
    `split-half placebo false positives (negative control, at most ${C.falsePositive * 100} %): ${CUES.map(cue => `${cue} ${d.splitHalf[cue].flagged}/${d.splitHalf[cue].total}`).join(', ')}`,
    'cue events: run, cue, t s, statistic, largest bone, counted',
    ...d.events.map(e => `  ${e.run}\t${e.cue}\t${e.t.toFixed(3)}\t${fixed(e.statistic, 2)}\t${e.bone ?? '-'}\t${e.counted ? 'yes' : 'no'}`),
  ])
}

export function formatCueFalsePositives(shares: ReturnType<typeof cueFalsePositives>): string {
  return `${[
    `cue-body split-half placebo false positives (unit M2 R3): each half's windows scored against the other half's model, at most ${C.falsePositive * 100} %`,
    ...CUES.map(cue => `  ${cue}\t${shares[cue].flagged}/${shares[cue].total} = ${fixed(shares[cue].total ? shares[cue].flagged / shares[cue].total : null)}\t${shares[cue].total && shares[cue].flagged / shares[cue].total <= C.falsePositive ? 'within' : 'NOT within'}`),
  ].join('\n')}\n`
}

export const CUE_FALSE_POSITIVE_LIMIT = C.falsePositive
