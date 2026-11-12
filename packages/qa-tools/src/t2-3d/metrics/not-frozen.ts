import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace, Quat } from './types'

import { conjugate, DEG, median, multiply, normalize } from './math'
import { placeWindows } from './segments'

/**
 * Gate version 4 (lane U revision 2, candidate D): a region whose smoothness cannot be scored is skipped only when its
 * windowed range reaches this many degrees, else it is frozen. The geometric mean of the labelled cases' worst frozen
 * reading (0.068 deg, a drift of 0.1 x idle) and worst alive reading (1.516 deg, an idle arm): margin 22.2x. No human
 * reference sets it.
 */
export const NOT_FROZEN_DEG = 0.3214

/** Linear interpolation at rank (n - 1) * p, the rule of `gate/bands.ts` `percentile`. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (sorted.length - 1) * p
  const lower = Math.floor(rank)
  return sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower)
}

/**
 * Median, over the class windows of the eligible spans, of the p95 angle in degrees between `bone`'s orientation
 * against the chest and that window's mean of it. Trunk motion that carries a still head or arm does not count.
 * Null without the bones or without a window.
 */
export function windowedRangeDeg(p: PreparedTrace, bone: MotionTraceBone): number | null {
  const chest = p.orientations.chest
  const target = p.orientations[bone]
  const windows = placeWindows(p.eligibleSpans, p.windowSeconds)
  if (!chest || !target || !windows.length)
    return null
  return median(windows.map(({ start, end }) => {
    const poses: Quat[] = []
    for (let i = start; i < end; i++)
      poses.push(multiply(conjugate(chest[i]), target[i]))
    const sum = [0, 0, 0, 0]
    for (const q of poses) {
      const sign = q[0] * poses[0][0] + q[1] * poses[0][1] + q[2] * poses[0][2] + q[3] * poses[0][3] < 0 ? -1 : 1
      for (let c = 0; c < 4; c++)
        sum[c] += sign * q[c]
    }
    const mean = normalize([sum[0], sum[1], sum[2], sum[3]])
    return percentile(poses.map(q => 2 * Math.acos(Math.min(1, Math.abs(multiply(conjugate(mean), q)[3]))) * DEG), 0.95)
  }))
}
