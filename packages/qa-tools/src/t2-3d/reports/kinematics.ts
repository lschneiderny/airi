import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace, Vec3 } from '../metrics'

import { add, conjugate, DEG, HZ, norm, rotate, sub } from '../metrics/math'

export type Side = 'left' | 'right'
export const SIDES: readonly Side[] = ['left', 'right']

/**
 * Plan 2.1 constants, fixed before any gesture exists.
 * D_MIN: half of architecture 4a's smallest major stroke, the beat `[0, -0.06, 0.03]` (0.067 A), at the lowest energy
 * gain `clamp(0.55 + 0.9 E, 0.5, 1.5) = 0.5`, in arm lengths A.
 * APEX_SECONDS: 4a's longest stroke (250 ms) plus the follower group delay (about 40 ms), rounded to 300 ms.
 * APEX_RATIO: twice the ratio of 4a's post-stroke drift speed (about 0.15 A/s) to a gain-0.5 beat's peak (0.57 A/s).
 */
export const STROKE_CONSTANTS = {
  minTravel: { value: 0.0168, unit: 'A', source: 'plan 2.1: half of 4a beat |[0,-0.06,0.03]| = 0.067 A at gain 0.5' },
  apexSeconds: { value: 0.3, unit: 's', source: 'plan 2.1: 4a longest stroke 250 ms + follower group delay ~40 ms' },
  apexRatio: { value: 0.5, unit: 'x peak speed', source: 'plan 2.1: 2 x (4a hold drift 0.15 A/s / gain-0.5 beat peak 0.57 A/s = 0.26)' },
} as const

/** Plan 2.6 pop classifier constants. */
export const POP_CONSTANTS = {
  threshold: { value: 30, unit: 'deg/s', source: 'plan 2.6: unit S threshold; largest legitimate idle step 8.2 deg/s, corrector pops 131 to 151 deg/s' },
  spikeRatio: { value: 2, unit: 'x neighbour speed', source: 'plan 2.6 position step: s_k >= 2 max(s_k-1, s_k+1)' },
  isolation: { value: 0.25, unit: 'x |dv_k|', source: 'plan 2.6 velocity step: |dv_k-1|, |dv_k+1| <= 0.25 |dv_k|' },
} as const

export interface HandPath {
  readonly side: Side
  /** Upper-arm plus forearm rest-offset length, model units. */
  readonly armLength: number
  /** Wrist position from the shoulder joint in the chest frame, arm lengths, one per 60 Hz sample. */
  readonly position: readonly Vec3[]
  /**
   * Speed of `position` over [t_i, t_i+1], arm lengths per second, on the gate's velocity convention (index i is the
   * interval that starts at sample i); the last sample repeats its predecessor.
   */
  readonly speed: readonly number[]
}

function restOffset(p: PreparedTrace, bone: MotionTraceBone): Vec3 | null {
  const index = p.input.trace.rig.bones.indexOf(bone)
  if (index < 0)
    return null
  const [x, y, z] = p.input.trace.rig.restOffsets[index]
  return [x, y, z]
}

/**
 * Plan 2.1 hand path: forward kinematics over the trace's world orientations and rest offsets. Orientations are
 * rest-relative in the trace basis, so each rest offset rotates by its parent's orientation. Null without the chain.
 */
export function handPath(p: PreparedTrace, side: Side): HandPath | null {
  const upper = p.orientations[`${side}UpperArm`]
  const lower = p.orientations[`${side}LowerArm`]
  const chest = p.orientations.chest
  const elbow = restOffset(p, `${side}LowerArm`)
  const wrist = restOffset(p, `${side}Hand`)
  if (!upper || !lower || !chest || !elbow || !wrist || !p.orientations[`${side}Hand`])
    return null
  const armLength = norm(elbow) + norm(wrist)
  const position = p.times.map((_, i): Vec3 => {
    const v = rotate(conjugate(chest[i]), add(rotate(upper[i], elbow), rotate(lower[i], wrist)))
    return [v[0] / armLength, v[1] / armLength, v[2] / armLength]
  })
  const speed = position.map((_, i) => {
    const k = Math.min(i, position.length - 2)
    return k < 0 ? 0 : norm(sub(position[k + 1], position[k])) * HZ
  })
  return { side, armLength, position, speed }
}

export interface KinematicStroke {
  readonly side: Side
  /** Sample indices on the 60 Hz grid: the speed minimum before, the speed peak and the minimum after. */
  readonly start: number
  readonly peak: number
  readonly end: number
  /** Path length between the bounding minima, arm lengths. */
  readonly travel: number
  readonly peakSpeed: number
  /** The apex sample (plan 2.1), or null when the first minimum after the peak misses the window or the speed ratio. */
  readonly apex: number | null
}

/**
 * Plan 2.1 kinematic strokes: every local maximum of chest-frame hand speed, bounded by the nearest strict speed minima
 * before and after, whose path between them is at least `minTravel`. The apex is the first speed minimum after the
 * peak, when it lies within `apexSeconds` and its speed is at most `apexRatio` of the peak.
 */
export function kinematicStrokes(path: HandPath): KinematicStroke[] {
  const { speed } = path
  const strokes: KinematicStroke[] = []
  for (let i = 1; i < speed.length - 1; i++) {
    if (!(speed[i] > speed[i - 1]) || !(speed[i] >= speed[i + 1]))
      continue
    let start = i
    while (start > 0 && speed[start - 1] < speed[start])
      start--
    let end = i
    while (end < speed.length - 1 && speed[end + 1] < speed[end])
      end++
    let travel = 0
    for (let k = start; k < end; k++)
      travel += (speed[k] + speed[k + 1]) / 2 / HZ
    if (travel < STROKE_CONSTANTS.minTravel.value)
      continue
    const apex = end - i <= Math.round(STROKE_CONSTANTS.apexSeconds.value * HZ) && speed[end] <= STROKE_CONSTANTS.apexRatio.value * speed[i] ? end : null
    strokes.push({ side: path.side, start, peak: i, end, travel, peakSpeed: speed[i], apex })
  }
  return strokes
}

/** Apex times in trace seconds for every stroke of both hands that has an apex. */
export function apexTimes(p: PreparedTrace, sides: readonly Side[] = SIDES): { side: Side, t: number, stroke: KinematicStroke }[] {
  return sides.flatMap((side) => {
    const path = handPath(p, side)
    return path ? kinematicStrokes(path).flatMap(stroke => stroke.apex === null ? [] : [{ side, t: p.times[stroke.apex], stroke }]) : []
  }).sort((a, b) => a.t - b.t)
}

/** The bone's parent in the trace hierarchy, or null at the root. */
export function traceParent(p: PreparedTrace, bone: MotionTraceBone): MotionTraceBone | null {
  const { bones, parents } = p.input.trace.rig
  const index = bones.indexOf(bone)
  return index < 0 || parents[index] < 0 ? null : bones[parents[index]]
}

/** Unfiltered angular velocity of a bone relative to its trace parent (the root's yaw rate at the root), deg/s. */
export function relativeVelocity(p: PreparedTrace, bone: MotionTraceBone): Vec3[] | null {
  const own = p.worldVelocity[bone]
  if (!own)
    return null
  const parent = traceParent(p, bone)
  const base = parent ? p.worldVelocity[parent] : null
  return own.map((v, i) => {
    const r = sub(v, base ? base[i] : [0, p.yawRate[i] ?? 0, 0])
    return [r[0] * DEG, r[1] * DEG, r[2] * DEG]
  })
}

export interface Pop {
  readonly bone: MotionTraceBone
  /** Velocity-grid sample index; its time is `times[index]`. */
  readonly index: number
  readonly t: number
  readonly kind: 'position-step' | 'velocity-step'
  /** Spike height over the neighbour mean, or |dv_k|, deg/s. */
  readonly size: number
}

/**
 * Plan 2.6 pop classifier on a bone's relative angular velocity v (deg/s, 60 Hz) with speed s = |v|:
 * position step (velocity spike): s_k - (s_k-1 + s_k+1) / 2 >= 30 and s_k >= 2 max(s_k-1, s_k+1);
 * velocity step (isolated acceleration impulse): |dv_k| >= 30 with |dv_k-1| and |dv_k+1| at most 0.25 |dv_k|,
 * where dv_k = v_k - v_k-1. Neither shape can come from a minimum-jerk stroke of 110 ms or longer.
 */
export function pops(p: PreparedTrace, bone: MotionTraceBone): Pop[] {
  const v = relativeVelocity(p, bone)
  if (!v)
    return []
  const threshold = POP_CONSTANTS.threshold.value
  const s = v.map(norm)
  const dv = v.map((x, i) => i === 0 ? 0 : norm(sub(x, v[i - 1])))
  const found: Pop[] = []
  for (let k = 1; k < v.length - 1; k++) {
    const spike = s[k] - (s[k - 1] + s[k + 1]) / 2
    if (spike >= threshold && s[k] >= POP_CONSTANTS.spikeRatio.value * Math.max(s[k - 1], s[k + 1]))
      found.push({ bone, index: k, t: p.times[k], kind: 'position-step', size: spike })
    else if (k >= 2 && dv[k] >= threshold && dv[k - 1] <= POP_CONSTANTS.isolation.value * dv[k] && dv[k + 1] <= POP_CONSTANTS.isolation.value * dv[k])
      found.push({ bone, index: k, t: p.times[k], kind: 'velocity-step', size: dv[k] })
  }
  return found
}
