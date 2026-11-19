import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MetricResult, PreparedTrace, Vec3 } from './types'

import { butterworth } from './filter'
import { jointOnset } from './gaze'
import { add, DEG, heading, HZ, laggedCorrelation, mean, median, norm, rotate, sub, unwrap } from './math'
import { episodeResult, result, skipped } from './result'
import { episode, peaks, runs } from './segments'

/** S5: p_b=p_parent+N_parent*restOffset_b (world model units, not joint-local bind axes). */
export function jointPositions(p: PreparedTrace): Readonly<Partial<Record<MotionTraceBone, readonly Vec3[]>>> {
  const positions: Partial<Record<MotionTraceBone, Vec3[]>> = {}
  const rig = p.input.trace.rig
  for (const [i, bone] of rig.bones.entries()) {
    const parent = rig.parents[i]
    const parentBone = rig.bones[parent]
    positions[bone] = p.rootPosition.map((root, t) => {
      if (parent < 0)
        return root
      const q = p.orientations[parentBone]?.[t]
      const position = positions[parentBone]?.[t]
      return q && position ? add(position, rotate(q, rig.restOffsets[i])) : root
    })
  }
  return positions
}

/** S5 specified P95/P5 use linear interpolation of sorted samples, no fitted percentile choice. */
function percentile(x: readonly number[], fraction: number): number {
  const a = [...x].sort((a, b) => a - b)
  const index = fraction * (a.length - 1)
  const low = Math.floor(index)
  return a[low] + (index - low) * (a[Math.ceil(index)] - a[low])
}

/**
 * S5 / 10.4: kinematic heel/toe extrema of F6 ankle displacement, walking speed>.2 leg lengths/s.
 * twist amplitude=.5*(P95-P5), degrees; chestCounter=Pearson(hips,chest), correlation.
 * armSwingLag=median signed argmax |r| within +/-250ms, ms; foot pitch=asin((Nfoot*Z).y), degrees.
 */
export function gaitMetrics(p: PreparedTrace): MetricResult[] {
  const positions = jointPositions(p)
  const walking = p.rootVelocity.map(v => norm(v) > 0.2)
  const walkingSpans = runs(walking)
  const steps = (['left', 'right'] as const).map((side) => {
    const bone = `${side}Foot` as const
    const position = positions[bone]
    if (!position)
      return { side, heel: [], toe: [] }
    const d = butterworth(position.slice(0, walking.length).map((v, i) => heading(sub(v, p.rootPosition[i]), p.yaw[i])[2] / p.input.trace.rig.legLength), 6)
    return { side, heel: peaks(d, -Infinity).filter(i => walking[i]), toe: peaks(d.map(v => -v), -Infinity).filter(i => walking[i]) }
  })
  const intervals = steps.map(s => walkingSpans.flatMap((span) => {
    const heel = s.heel.filter(i => i >= span.start && i < span.end)
    return heel.slice(1).map((v, i) => (v - heel[i]) / HZ)
  }))
  const strides = intervals.flat()
  const count = Math.max(...intervals.map(s => s.length))
  const ids = ['pelvisTwistDeg', 'chestCounter', 'armSwingLagMs', 'heelStrikePitchDeg', 'toeOffPitchDeg'] as const
  const unit = (k: typeof ids[number]) => k.endsWith('Deg') ? 'deg' : k.endsWith('Ms') ? 'ms' : 'correlation'
  const metrics: MetricResult[] = []
  if (!positions.leftFoot && !positions.rightFoot) {
    metrics.push(...ids.map(k => skipped(`gait.${k}`, unit(k), 'trace', 'foot-bones-absent')))
  }
  else if (count < 10) {
    metrics.push(...ids.map(k => skipped(`gait.${k}`, unit(k), 'trace', 'insufficient-strides')))
  }
  else {
    const fs = 1 / mean(strides)
    const yawT = butterworth(p.yaw.slice(0, walking.length), 0.4 * fs)
    const twist = (bone: 'hips' | 'chest') => {
      const q = p.orientations[bone]
      if (!q)
        return null
      const angles = unwrap(q.slice(0, walking.length).map((v) => {
        const f = rotate(v, [0, 0, 1])
        return Math.atan2(f[0], f[2])
      }))
      return angles.map((a, i) => a - yawT[i]).filter((_, i) => walking[i])
    }
    const hips = twist('hips')
    const chest = twist('chest')
    metrics.push(hips
      ? result('gait.pelvisTwistDeg', 'deg', 'trace', (percentile(hips, 0.95) - percentile(hips, 0.05)) * DEG / 2)
      : skipped('gait.pelvisTwistDeg', 'deg', 'trace', 'bone-absent hips'))
    metrics.push(hips && chest
      ? result('gait.chestCounter', 'correlation', 'trace', laggedCorrelation(hips, chest, 0)?.zero ?? null)
      : skipped('gait.chestCounter', 'correlation', 'trace', 'bones-absent'))
    const armLags = (['left', 'right'] as const).flatMap((side) => {
      const upper = p.o6[`${side}UpperArm`]
      const lower = p.o6[`${side}LowerArm`]
      return walkingSpans.flatMap((span) => {
        const c = upper && lower && span.end - span.start > 30 ? laggedCorrelation(upper.slice(span.start, span.end).map(v => v[0]), lower.slice(span.start, span.end).map(v => v[0]), 15) : null
        return c ? [c.lag * 1000 / HZ] : []
      })
    })
    metrics.push(!p.o6.leftUpperArm && !p.o6.rightUpperArm
      ? skipped('gait.armSwingLagMs', 'ms', 'trace', 'arm-bones-absent')
      : result('gait.armSwingLagMs', 'ms', 'trace', armLags.length ? median(armLags) : null))
    for (const [key, kind] of [['heelStrikePitchDeg', 'heel'], ['toeOffPitchDeg', 'toe']] as const) {
      const values = steps.flatMap((s) => {
        const q = p.orientations[`${s.side}Foot`]
        return q ? s[kind].map(i => Math.asin(Math.max(-1, Math.min(1, rotate(q[i], [0, 0, 1])[1]))) * DEG) : []
      })
      metrics.push(result(`gait.${key}`, 'deg', 'trace', values.length ? median(values) : null))
    }
  }
  // S5 / 10.3: heading onset minus own relative-head onset, ms, pooled over >=3 turns (>=8 for character statistic).
  const head = p.worldVelocity.head
  if (!head) {
    metrics.push(skipped('gait.headLeadMs', 'ms', 'episode', 'bone-absent head'))
    return metrics
  }
  const turnSpeed = p.yawRate.map(Math.abs)
  const turnValues = peaks(turnSpeed, 0.5).flatMap((peak) => {
    const e = episode(turnSpeed, peak)
    const sign = Math.sign(p.yawRate[peak])
    const speed = head.map((v, i) => Math.max(0, sign * (heading(v, p.yaw[i])[1] - p.yawRate[i])))
    const onset = jointOnset(speed, peak, 0)
    return onset === null ? [] : [{ ...e, value: (e.start - onset) * 1000 / HZ }]
  })
  metrics.push(turnValues.length < 3
    ? { ...skipped('gait.headLeadMs', 'ms', 'episode', 'insufficient-turns'), samples: turnValues }
    : episodeResult(p, 'gait.headLeadMs', 'ms', turnValues))
  return metrics
}
