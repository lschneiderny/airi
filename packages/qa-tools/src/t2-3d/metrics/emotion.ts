import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MetricResult, PreparedTrace, Quat, Vec3 } from './types'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { ARMS, UPPER } from './bones'
import { conjugate, finite, heading, mean, median, multiply, normalize, rotationVector } from './math'
import { postureFeatures } from './mirror'
import { result, skipped } from './result'

export interface EmotionTrial {
  readonly trialId?: string
  readonly condition: string
  readonly placebo: boolean
  readonly t: number
  /** Raw trace frames whose rotations the baseline and hold averages read, ascending. */
  readonly frames: readonly number[]
  readonly posture: Readonly<Partial<Record<MotionTraceBone, Vec3>>>
}

function averageQuaternion(q: readonly Quat[]): Quat {
  const anchor = q[0]
  const sum = [0, 0, 0, 0]
  for (const v of q) {
    const sign = anchor.reduce((s, x, i) => s + x * v[i], 0) < 0 ? -1 : 1
    for (let i = 0; i < 4; i++)
      sum[i] += sign * v[i]
  }
  return normalize([sum[0], sum[1], sum[2], sum[3]])
}

/**
 * Mirrors prepareTrace's resampling: each 60 Hz sample slerps its two neighbouring
 * raw frames; a frame counts only when its interpolation weight is nonzero.
 */
function sourceFrames(p: PreparedTrace, indices: readonly number[]): number[] {
  const stride = MOTION_TRACE_CHANNELS.length
  const count = p.input.trace.frames
  const time = (frame: number) => p.input.channels[frame * stride]
  const frames = new Set<number>()
  let left = 0
  for (const i of indices) {
    const t = p.times[i]
    while (left + 1 < count - 1 && time(left + 1) < t)
      left++
    const right = Math.min(left + 1, count - 1)
    const weight = left === right ? 0 : (t - time(left)) / (time(right) - time(left))
    if (weight < 1 - 1e-10)
      frames.add(left)
    if (weight > 1e-10)
      frames.add(right)
  }
  return [...frames].sort((a, b) => a - b)
}

/** S3: r_b=Ry(-yawS(te))*rotvec(mean(N_hold)*conj(mean(N_base))), radians; difference cancels bind pose. */
export function emotionTrials(p: PreparedTrace): EmotionTrial[] {
  const seen = new Set<string>()
  return p.input.trace.events.flatMap((e) => {
    if (e.kind !== 'emotion' || !['pulse', 'hold-start', 'placebo'].includes(e.phase))
      return []
    if (e.trialId !== undefined && seen.has(e.trialId))
      return []
    if (e.trialId !== undefined)
      seen.add(e.trialId)
    const baseline = p.times.flatMap((t, i) => t >= e.t - 1 && t <= e.t ? [i] : [])
    const hold = p.times.flatMap((t, i) => t >= e.t + 2 && t <= e.t + 4 ? [i] : [])
    if (!baseline.length || !hold.length || e.t - 1 < p.times[0] || e.t + 4 > p.times[p.times.length - 1])
      return []
    const frame = Math.min(p.yaw.length - 1, Math.round((e.t - p.times[0]) * 60))
    const posture: Partial<Record<MotionTraceBone, Vec3>> = {}
    for (const bone of UPPER) {
      const q = p.orientations[bone]
      if (q) {
        const base = averageQuaternion(baseline.map(i => q[i]))
        const held = averageQuaternion(hold.map(i => q[i]))
        posture[bone] = heading(rotationVector(multiply(held, conjugate(base))), p.yaw[frame])
      }
    }
    return [{ trialId: e.trialId, frames: sourceFrames(p, [...baseline, ...hold]), condition: e.phase === 'placebo' ? 'placebo' : e.emotion, placebo: e.phase === 'placebo', t: e.t, posture }]
  })
}

/**
 * S3 / assignment: d(e,f)=|mean(p_e)-mean(p_f)|/sqrt(mean |p-mean(p_own)|²), all pairs including placebo.
 * min/median separation are standard-deviation units; armShare is squared arm displacement / total.
 * minSeparationFromNeutral is min over every emotion e other than neutral of min(d(e,neutral), d(e,placebo)),
 * with the same sigma; the neutral-placebo pair is excluded because neutral has no posture of its own.
 * A pool with no `neutral` condition cannot show that any emotion is clear of neutral, so the
 * value is undefined (a gated FAIL) with detail `no-neutral-condition`, never a skip.
 * Trials may originate in multiple traces; the shared present bone intersection aligns their vectors.
 * Since gate version 5 the three separations read `postureFeatures` (side-invariant, continuous through 180 degrees),
 * because an emotion's sided pose goes to a random side; armShare keeps the signed vectors its band was fitted on.
 */
export function emotionMetrics(trials: readonly EmotionTrial[]): MetricResult[] {
  const ids = ['emotion.minSeparation', 'emotion.medianSeparation', 'emotion.armShare', 'emotion.minSeparationFromNeutral'] as const
  const unit = (id: typeof ids[number]) => id.endsWith('armShare') ? 'fraction' : 'standard-deviations'
  const conditions = [...new Set(trials.map(t => t.condition))].sort()
  const placebo = conditions.find(c => trials.some(t => t.condition === c && t.placebo))
  const groups = new Map(conditions.map(c => [c, trials.filter(t => t.condition === c)]))
  if (!placebo || conditions.length < 2 || conditions.some(c => (groups.get(c)?.length ?? 0) < (c === placebo ? 5 : 3)))
    return ids.map(id => skipped(id, unit(id), 'trace', 'insufficient-trials'))
  const bones = UPPER.filter(b => trials.every(t => t.posture[b]))
  if (!bones.length)
    return ids.map(id => skipped(id, unit(id), 'trace', 'bones-absent'))
  const vector = (t: EmotionTrial) => bones.flatMap(b => t.posture[b] ?? [])
  const features = new Map(trials.map(t => [t, postureFeatures(vector(t), bones)]))
  const centresOf = (rows: (t: EmotionTrial) => readonly number[]) => new Map(conditions.map((c) => {
    const vectors = (groups.get(c) ?? []).map(rows)
    return [c, vectors[0].map((_, i) => mean(vectors.map(p => p[i])))]
  }))
  const centres = centresOf(vector)
  const featureCentres = centresOf(t => features.get(t) ?? [])
  const squaredDistance = (a: readonly number[], b: readonly number[]) => finite(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0), 'posture squared distance')
  const sigma = Math.sqrt(mean(trials.map(t => squaredDistance(features.get(t) ?? [], featureCentres.get(t.condition) ?? []))))
  const separation = (a: string, b: string) => finite(Math.sqrt(squaredDistance(featureCentres.get(a) ?? [], featureCentres.get(b) ?? [])) / sigma, 'emotion separation')
  const pairs: number[] = []
  if (sigma > 1e-18) {
    for (let i = 0; i < conditions.length; i++) {
      for (let j = i + 1; j < conditions.length; j++)
        pairs.push(separation(conditions[i], conditions[j]))
    }
  }
  const neutral = conditions.find(c => c === 'neutral')
  const fromNeutral = neutral && sigma > 1e-18
    ? conditions.filter(c => c !== placebo && c !== neutral).flatMap(c => [separation(c, neutral), separation(c, placebo)])
    : []
  const shares = conditions.filter(c => c !== placebo).flatMap((c) => {
    const a = centres.get(c) ?? []
    const b = centres.get(placebo) ?? []
    const total = squaredDistance(a, b)
    const arm = finite(a.reduce((s, v, i) => s + (ARMS.includes(bones[Math.floor(i / 3)]) ? (v - b[i]) ** 2 : 0), 0), 'arm posture energy')
    return total > 1e-18 ? [arm / total] : []
  })
  return [
    result(ids[0], 'standard-deviations', 'trace', sigma > 1e-18 ? Math.min(...pairs) : null),
    result(ids[1], 'standard-deviations', 'trace', sigma > 1e-18 ? median(pairs) : null),
    result(ids[2], 'fraction', 'trace', shares.length ? mean(shares) : null),
    neutral
      ? result(ids[3], 'standard-deviations', 'trace', fromNeutral.length ? Math.min(...fromNeutral) : null)
      : result(ids[3], 'standard-deviations', 'trace', null, 'undefined: no-motion', 'no-neutral-condition'),
  ]
}
