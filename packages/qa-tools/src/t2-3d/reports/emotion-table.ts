import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionBandsFile } from '../gate/types'
import type { EmotionTrial, PreparedTrace, Quat, Vec3 } from '../metrics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { percentile } from '../gate/bands'
import { emotionMetrics, emotionTrials, onsetMetrics } from '../metrics'
import { UPPER } from '../metrics/bones'
import { conjugate, DEG, heading, mean, multiply, normalize, rotationVector } from '../metrics/math'
import { criterionReport, fixed, formatReport, gateStatus, requireGate, requirement } from './report'

export const EMOTION_TABLE_VERSION = 1

/** Plan 2.3's C002 constants: the gate's own windows and threshold, and the placebo band. */
const C = {
  separation: 2,
  baseline: [-1, 0] as const,
  hold: [2, 4] as const,
  release: [8, 11] as const,
  placeboTrials: 5,
  placeboPercentile: 0.95,
  vacuity: 2,
}

export const EMOTION_TABLE_CONSTANTS: readonly ReportConstant[] = [
  { name: 'pair separation', value: C.separation, unit: 'SD', source: 'gate emotionSeparationMinimum' },
  { name: 'baseline window', value: C.baseline.join('..'), unit: 's after the cue', source: 'gate emotionBaselineSeconds' },
  { name: 'hold window', value: C.hold.join('..'), unit: 's after the cue', source: 'gate emotionHoldSeconds' },
  { name: 'release window', value: C.release.join('..'), unit: 's after the cue', source: 'plan 2.3: before the next cue at +12 s' },
  { name: 'placebo band', value: C.placeboPercentile, unit: 'percentile of placebo hold |p|', source: 'plan 2.3: placebo trials define the idle band' },
  { name: 'minimum placebo trials', value: C.placeboTrials, unit: 'trials', source: 'gate placeboTrials' },
  { name: 'vacuity', value: C.vacuity, unit: 'x placebo p95, each non-neutral emotion mean hold |p|', source: 'plan 2.3' },
]

/** The gate's S3 posture vector between the baseline window and `window` after the cue, flattened over UPPER bones. */
function postureVector(p: PreparedTrace, t: number, window: readonly [number, number], bones: readonly MotionTraceBone[]): number[] | null {
  const pick = (from: number, to: number) => p.times.flatMap((time, i) => time >= t + from && time <= t + to ? [i] : [])
  const base = pick(C.baseline[0], C.baseline[1])
  const held = pick(window[0], window[1])
  if (!base.length || !held.length || t + C.baseline[0] < p.times[0] || t + window[1] > p.times[p.times.length - 1])
    return null
  const average = (q: readonly Quat[]): Quat => {
    const sum = [0, 0, 0, 0]
    for (const v of q) {
      const sign = q[0].reduce((s, x, i) => s + x * v[i], 0) < 0 ? -1 : 1
      for (let i = 0; i < 4; i++)
        sum[i] += sign * v[i]
    }
    return normalize([sum[0], sum[1], sum[2], sum[3]])
  }
  const frame = Math.min(p.yaw.length - 1, Math.round((t - p.times[0]) * 60))
  return bones.flatMap((bone) => {
    const q = p.orientations[bone] ?? []
    const v: Vec3 = heading(rotationVector(multiply(average(held.map(i => q[i])), conjugate(average(base.map(i => q[i]))))), p.yaw[frame])
    return [...v]
  })
}

const length = (v: readonly number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

export interface EmotionTableDetail {
  readonly conditions: readonly string[]
  readonly trialCounts: Readonly<Record<string, number>>
  readonly sigmaDeg: number
  /** Pairwise separation in SD units, keyed `a|b` with a < b. */
  readonly separation: Readonly<Record<string, number>>
  readonly failingPairs: readonly string[]
  readonly placeboP95Deg: number | null
  readonly meanHoldDeg: Readonly<Record<string, number>>
  readonly releases: readonly { readonly trial: string, readonly condition: string, readonly releaseDeg: number | null, readonly inBand: boolean }[]
  readonly onsets: readonly { readonly run: string, readonly emotion: string | null, readonly t: number, readonly attackFraction: number, readonly eased: boolean }[]
}

/**
 * C002 emotion table (plan 2.3) over the pooled emotion runs: the gate's trial vectors and sigma, every pair printed,
 * every pair with a non-neutral emotion required at 2 SD; the neutral-placebo pair is printed only.
 */
export function emotionTableReport(runs: readonly LoadedRun[], bands: MotionBandsFile): CriterionReport<EmotionTableDetail> {
  const emotion = bands.classes.emotion
  const perRun = runs.map(run => ({ run, trials: emotionTrials(run.p) }))
  const trials: EmotionTrial[] = perRun.flatMap(x => x.trials)
  const conditions = [...new Set(trials.map(t => t.condition))].sort()
  const bones = UPPER.filter(b => trials.every(t => t.posture[b]))
  const vector = (t: EmotionTrial) => bones.flatMap(b => t.posture[b] ?? [])
  const centres = new Map(conditions.map((c) => {
    const vectors = trials.filter(t => t.condition === c).map(vector)
    return [c, vectors[0].map((_, i) => mean(vectors.map(v => v[i])))]
  }))
  const distance = (a: readonly number[], b: readonly number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0))
  const sigma = Math.sqrt(mean(trials.map(t => distance(vector(t), centres.get(t.condition) ?? []) ** 2)))
  const separation: Record<string, number> = {}
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++)
      separation[`${conditions[i]}|${conditions[j]}`] = sigma > 1e-18 ? distance(centres.get(conditions[i]) ?? [], centres.get(conditions[j]) ?? []) / sigma : 0
  }
  const noOp = (c: string) => c === 'neutral' || c === 'placebo'
  const required = Object.entries(separation).filter(([pair]) => !pair.split('|').every(noOp))
  const failing = required.filter(([, d]) => d < C.separation).map(([pair]) => pair)
  const placebo = trials.filter(t => t.placebo).map(t => length(vector(t)))
  const placeboP95 = placebo.length ? percentile(placebo, C.placeboPercentile) : null
  const meanHold = Object.fromEntries(conditions.filter(c => !noOp(c)).map(c => [c, mean(trials.filter(t => t.condition === c).map(t => length(vector(t)))) * DEG]))
  const releases = perRun.flatMap(({ run, trials }) => trials.map((trial) => {
    const r = postureVector(run.p, trial.t, C.release, bones)
    const releaseDeg = r ? length(r) * DEG : null
    return { trial: trial.trialId ?? `${run.dir}@${trial.t.toFixed(3)}`, condition: trial.condition, releaseDeg, inBand: releaseDeg !== null && placeboP95 !== null && releaseDeg <= placeboP95 * DEG }
  }))
  const onsets = runs.flatMap((run) => {
    if (!emotion)
      return []
    const attack = onsetMetrics(run.p, emotion).find(m => m.id === 'onset.attackFraction')?.samples ?? []
    const pulses = run.input.trace.events.flatMap(e => e.kind === 'emotion' && e.phase !== 'placebo' ? [e] : [])
    return attack.map((s) => {
      const t = run.p.times[s.start]
      const cue = pulses.filter(e => e.t <= t).at(-1) ?? null
      const eased = (s.value * (s.end - s.start)) / 60 >= 0.05
      return { run: run.dir, emotion: cue?.emotion ?? null, t, attackFraction: s.value, eased }
    })
  })
  const gates = runs.map(requireGate)
  const onsetIds = ['onset.attackFraction', 'onset.easedOrAnticipated', 'emotion.armShare'] as const
  const gateLine = onsetIds.map(id => `${id} ${[...new Set(gates.map(g => gateStatus(g, id).status))].join('/')}`).join(', ')
  const nonNeutral = conditions.filter(c => !noOp(c))
  const vacuous = placeboP95 === null || nonNeutral.some(c => meanHold[c] < C.vacuity * placeboP95 * DEG)
  const pooled = emotionMetrics(trials)
  const requirements = [
    requirement('pairs', `every pair with a non-neutral emotion >= ${C.separation} SD (neutral-placebo printed only)`, `${required.length - failing.length}/${required.length}; gate minSeparation over all pairs ${fixed(pooled[0].value)}`, required.length > 0 && failing.length === 0),
    requirement('gate-onset-and-arm-share', 'onset.attackFraction, onset.easedOrAnticipated and emotion.armShare not FAIL in any gate.json', gateLine, onsetIds.every(id => gates.every(g => gateStatus(g, id).status !== 'FAIL'))),
    requirement('placebo-trials', `placebo trials >= ${C.placeboTrials}`, `${placebo.length}`, placebo.length >= C.placeboTrials),
    requirement('not-vacuous', `each non-neutral emotion's mean hold |p| >= ${C.vacuity} x placebo p95`, nonNeutral.map(c => `${c} ${fixed(meanHold[c], 2)}`).join(', '), !vacuous),
    requirement('release', 'every trial |r_release| <= placebo p95 of hold |p|', `${releases.filter(r => r.inBand).length}/${releases.length} in band (p95 ${fixed(placeboP95 === null ? null : placeboP95 * DEG, 2)} deg)`, releases.length > 0 && releases.every(r => r.inBand)),
  ]
  return criterionReport('emotion-table', EMOTION_TABLE_VERSION, runs.map(r => r.dir), EMOTION_TABLE_CONSTANTS, requirements, {
    conditions,
    trialCounts: Object.fromEntries(conditions.map(c => [c, trials.filter(t => t.condition === c).length])),
    sigmaDeg: sigma * DEG,
    separation,
    failingPairs: failing,
    placeboP95Deg: placeboP95 === null ? null : placeboP95 * DEG,
    meanHoldDeg: meanHold,
    releases,
    onsets,
  })
}

export function formatEmotionTable(report: CriterionReport<EmotionTableDetail>): string {
  const d = report.detail
  const cell = (a: string, b: string) => a === b ? '-' : fixed(d.separation[a < b ? `${a}|${b}` : `${b}|${a}`] ?? null, 2)
  return formatReport(report, [
    `trials per condition: ${JSON.stringify(d.trialCounts)}; pooled sigma ${fixed(d.sigmaDeg, 2)} deg`,
    `separation table (SD units):`,
    `\t${d.conditions.join('\t')}`,
    ...d.conditions.map(a => `${a}\t${d.conditions.map(b => cell(a, b)).join('\t')}`),
    `required pairs below ${C.separation}: ${d.failingPairs.join(', ') || 'none'}`,
    `mean hold |p| per emotion, deg: ${Object.entries(d.meanHoldDeg).map(([c, v]) => `${c} ${fixed(v, 2)}`).join(', ')}; placebo p95 ${fixed(d.placeboP95Deg, 2)}`,
    'release per trial: trial, condition, |r_release| deg, in band',
    ...d.releases.map(r => `  ${r.trial}\t${r.condition}\t${fixed(r.releaseDeg, 2)}\t${r.inBand ? 'yes' : 'no'}`),
    'onset episodes (gate emotion-class detector): run, preceding emotion, t s, attack fraction, attack >= 50 ms',
    ...d.onsets.map(o => `  ${o.run}\t${o.emotion ?? '-'}\t${o.t.toFixed(3)}\t${o.attackFraction.toFixed(3)}\t${o.eased ? 'yes' : 'no'}`),
  ])
}
