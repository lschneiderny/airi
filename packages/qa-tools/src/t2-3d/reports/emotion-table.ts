import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionBandsFile } from '../gate/types'
import type { EmotionTrial, PreparedTrace, Quat, Vec3 } from '../metrics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { percentile } from '../gate/bands'
import { motionQualityGate } from '../gate/definition'
import { emotionMetrics, emotionTrials, onsetMetrics } from '../metrics'
import { UPPER } from '../metrics/bones'
import { conjugate, DEG, heading, mean, multiply, normalize, rotationVector } from '../metrics/math'
import { criterionReport, fixed, formatReport, gateStatus, requireGate, requirement } from './report'

export const EMOTION_TABLE_VERSION = 2

/** Plan 2.3's C002 constants: the gate's own windows and threshold, and the placebo band. */
const C = {
  separation: 2,
  baseline: [-1, 0] as const,
  hold: [2, 4] as const,
  release: [8, 11] as const,
  placeboTrials: 5,
  placeboPercentile: 0.95,
  vacuity: 2,
  episodes: motionQualityGate.constants.episodeMinimum,
}

/** Criterion C002's gate run: `qa:motion3d gate <emotion runs> --require` these ids. */
export const C002_REQUIRED = ['emotion.minSeparationFromNeutral', 'emotion.armShare'] as const
const ONSET_IDS = ['onset.attackFraction', 'onset.easedOrAnticipated'] as const

export const EMOTION_TABLE_CONSTANTS: readonly ReportConstant[] = [
  { name: 'pair separation', value: C.separation, unit: 'SD, each non-neutral emotion against neutral and against placebo', source: 'gate emotionSeparationMinimum; emotion.minSeparationFromNeutral (gate version 3)' },
  { name: 'gate requirement', value: C002_REQUIRED.join(','), unit: '--require ids', source: 'criterion C002' },
  { name: 'onset episodes', value: C.episodes, unit: 'per run, each onset metric', source: 'gate episodeMinimum' },
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
  readonly requiredPairs: readonly string[]
  readonly minSeparationFromNeutral: number | null
  readonly episodes: readonly { readonly run: string, readonly attack: number, readonly eased: number }[]
  readonly placeboP95Deg: number | null
  readonly meanHoldDeg: Readonly<Record<string, number>>
  readonly releases: readonly { readonly trial: string, readonly condition: string, readonly releaseDeg: number | null, readonly inBand: boolean }[]
  readonly onsets: readonly { readonly run: string, readonly emotion: string | null, readonly t: number, readonly attackFraction: number, readonly eased: boolean }[]
}

/**
 * C002 emotion table, version 2 (unit M2 R4) over the pooled emotion runs: the gate's trial vectors and sigma; each
 * non-neutral emotion against neutral and against placebo required at 2 SD, as `emotion.minSeparationFromNeutral`;
 * every other pair printed as report only. The pooled verdict comes from the gate run with `--require` C002's ids.
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
  const required = Object.entries(separation).filter(([pair]) => {
    const [a, b] = pair.split('|')
    return noOp(a) !== noOp(b)
  })
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
  const required2 = gates.map(g => g.requirements)
  const gateRequired = required2.every(r => r && C002_REQUIRED.every(id => r.metrics.includes(id)) && r.passed)
  const episodes = runs.map((run) => {
    const count = (id: string) => (emotion ? onsetMetrics(run.p, emotion).find(m => m.id === id)?.samples?.length : 0) ?? 0
    return { run: run.dir, attack: count(ONSET_IDS[0]), eased: count(ONSET_IDS[1]) }
  })
  const onsetLine = ONSET_IDS.map(id => `${id} ${[...new Set(gates.map(g => gateStatus(g, id).status))].join('/')}`).join(', ')
  const nonNeutral = conditions.filter(c => !noOp(c))
  const vacuous = placeboP95 === null || nonNeutral.some(c => meanHold[c] < C.vacuity * placeboP95 * DEG)
  const pooled = emotionMetrics(trials)
  const fromNeutral = pooled.find(m => m.id === 'emotion.minSeparationFromNeutral')?.value ?? null
  const requirements = [
    requirement('pairs-from-neutral', `each non-neutral emotion >= ${C.separation} SD from neutral and from placebo (emotion.minSeparationFromNeutral); other pairs report only`, `${required.length - failing.length}/${required.length}; emotion.minSeparationFromNeutral ${fixed(fromNeutral)}; all-pairs emotion.minSeparation ${fixed(pooled[0].value)} (report only)`, required.length > 0 && failing.length === 0 && fromNeutral !== null && fromNeutral >= C.separation),
    requirement('gate-required', `every gate.json carries --require ${C002_REQUIRED.join(',')} and passed it`, required2.map(r => r ? `${r.metrics.join(',')} ${r.passed ? 'PASS' : 'FAIL'}` : 'no --require').join('; '), gateRequired),
    requirement('onset-not-vacuous', `${ONSET_IDS.join(' and ')} PASS in every gate.json, each from >= ${C.episodes} episodes per run`, `${onsetLine}; episodes per run (attack/eased): ${episodes.map(e => `${e.attack}/${e.eased}`).join(', ')}`, ONSET_IDS.every(id => gates.every(g => gateStatus(g, id).status === 'PASS')) && episodes.every(e => e.attack >= C.episodes && e.eased >= C.episodes)),
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
    requiredPairs: required.map(([pair]) => pair),
    minSeparationFromNeutral: fromNeutral,
    episodes,
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
    `required pairs (non-neutral against neutral and placebo) below ${C.separation}: ${d.failingPairs.join(', ') || 'none'}; every other cell is report only`,
    `mean hold |p| per emotion, deg: ${Object.entries(d.meanHoldDeg).map(([c, v]) => `${c} ${fixed(v, 2)}`).join(', ')}; placebo p95 ${fixed(d.placeboP95Deg, 2)}`,
    'release per trial: trial, condition, |r_release| deg, in band',
    ...d.releases.map(r => `  ${r.trial}\t${r.condition}\t${fixed(r.releaseDeg, 2)}\t${r.inBand ? 'yes' : 'no'}`),
    'onset episodes (gate emotion-class detector): run, preceding emotion, t s, attack fraction, attack >= 50 ms',
    ...d.onsets.map(o => `  ${o.run}\t${o.emotion ?? '-'}\t${o.t.toFixed(3)}\t${o.attackFraction.toFixed(3)}\t${o.eased ? 'yes' : 'no'}`),
  ])
}
