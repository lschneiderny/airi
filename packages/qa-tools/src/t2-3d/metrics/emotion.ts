import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MetricResult, PreparedTrace, Quat, Vec3 } from './types'

import { ARMS, UPPER } from './bones'
import { conjugate, heading, mean, median, multiply, normalize, rotationVector } from './math'
import { result, skipped } from './result'

export interface EmotionTrial {
  readonly condition: string
  readonly placebo: boolean
  readonly t: number
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

/** S3: r_b=Ry(-yawS(te))*rotvec(mean(N_hold)*conj(mean(N_base))), radians; difference cancels bind pose. */
export function emotionTrials(p: PreparedTrace): EmotionTrial[] {
  const seen = new Set<string>()
  return p.input.trace.events.flatMap((e) => {
    if (e.kind !== 'emotion' || !['pulse', 'hold-start', 'placebo'].includes(e.phase))
      return []
    if (e.trialId && seen.has(e.trialId))
      return []
    if (e.trialId)
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
    return [{ condition: e.phase === 'placebo' ? 'placebo' : e.emotion, placebo: e.phase === 'placebo', t: e.t, posture }]
  })
}

/**
 * S3 / assignment: d(e,f)=|mean(p_e)-mean(p_f)|/sqrt(mean |p-mean(p_own)|²), all pairs including placebo.
 * min/median separation are standard-deviation units; armShare is squared arm displacement / total.
 * Trials may originate in multiple traces; the shared present bone intersection aligns their vectors.
 */
export function emotionMetrics(trials: readonly EmotionTrial[]): MetricResult[] {
  const ids = ['emotion.minSeparation', 'emotion.medianSeparation', 'emotion.armShare'] as const
  const conditions = [...new Set(trials.map(t => t.condition))].sort()
  const placebo = conditions.find(c => trials.some(t => t.condition === c && t.placebo))
  const groups = new Map(conditions.map(c => [c, trials.filter(t => t.condition === c)]))
  if (!placebo || conditions.length < 2 || conditions.some(c => (groups.get(c)?.length ?? 0) < (c === placebo ? 5 : 3)))
    return ids.map(id => skipped(id, id.endsWith('armShare') ? 'fraction' : 'standard-deviations', 'trace', 'insufficient-trials'))
  const bones = UPPER.filter(b => trials.every(t => t.posture[b]))
  if (!bones.length)
    return ids.map(id => skipped(id, id.endsWith('armShare') ? 'fraction' : 'standard-deviations', 'trace', 'bones-absent'))
  const vector = (t: EmotionTrial) => bones.flatMap(b => t.posture[b] ?? [])
  const centres = new Map(conditions.map((c) => {
    const vectors = (groups.get(c) ?? []).map(vector)
    return [c, vectors[0].map((_, i) => mean(vectors.map(p => p[i])))]
  }))
  const squaredDistance = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)
  const sigma = Math.sqrt(mean(trials.map(t => squaredDistance(vector(t), centres.get(t.condition) ?? []))))
  const pairs: number[] = []
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++)
      pairs.push(Math.sqrt(squaredDistance(centres.get(conditions[i]) ?? [], centres.get(conditions[j]) ?? [])) / sigma)
  }
  const shares = conditions.filter(c => c !== placebo).flatMap((c) => {
    const a = centres.get(c) ?? []
    const b = centres.get(placebo) ?? []
    const total = squaredDistance(a, b)
    const arm = a.reduce((s, v, i) => s + (ARMS.includes(bones[Math.floor(i / 3)]) ? (v - b[i]) ** 2 : 0), 0)
    return total > 1e-18 ? [arm / total] : []
  })
  return [
    result(ids[0], 'standard-deviations', 'trace', sigma > 1e-18 ? Math.min(...pairs) : null),
    result(ids[1], 'standard-deviations', 'trace', sigma > 1e-18 ? median(pairs) : null),
    result(ids[2], 'fraction', 'trace', shares.length ? mean(shares) : null),
  ]
}
