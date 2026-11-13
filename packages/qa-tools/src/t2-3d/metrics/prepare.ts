import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'
import type { BoneSeries, PreparedTrace, Quat, Region, Vec3 } from './types'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { MotionTraceRefusal } from '../read-trace'
import { CORE, REGIONS } from './bones'
import { butterworth, filterVectors } from './filter'
import { conjugate, dot, heading, HZ, mean, multiply, norm, normalize, rotationVector, scale, slerp, sub, yawQuat } from './math'
import { placeWindows, runs } from './segments'

/** P13, rad/s: sqrt(mean_b |O_b|^2), over present bones only. */
export function regionSpeed(series: BoneSeries<Vec3>, bones: readonly MotionTraceBone[], length: number): number[] {
  const present = bones.flatMap(b => series[b] ? [series[b]] : [])
  return Array.from({ length }, (_, i) => Math.sqrt(mean(present.map(v => dot(v[i], v[i])))))
}

/** P1-P9: sample scored poses at 60 Hz, reconstruct N before differencing, then filter. */
export function prepareTrace(input: DecodedMotionTrace): PreparedTrace {
  const { trace, rot, root, channels: rawChannels } = input
  const stride = MOTION_TRACE_CHANNELS.length
  const rawTimes = Array.from({ length: trace.frames }, (_, i) => rawChannels[i * stride])
  const first = rawTimes.findIndex(t => t >= trace.scoredFrom)
  const startTime = first < 0 ? 0 : rawTimes[first]
  const count = first < 0 ? 0 : Math.max(0, Math.floor((rawTimes[rawTimes.length - 1] - startTime) * HZ + 1e-4) + 1)
  const times = Array.from({ length: count }, (_, i) => startTime + i / HZ)
  let left = Math.max(0, first)
  const neighbours = times.map((t) => {
    while (left + 1 < rawTimes.length - 1 && rawTimes[left + 1] < t)
      left++
    const right = Math.min(left + 1, rawTimes.length - 1)
    return { left, right, t: left === right ? 0 : (t - rawTimes[left]) / (rawTimes[right] - rawTimes[left]) }
  })
  const lerp = (block: Float32Array, width: number, col: number): number[] => neighbours.map(({ left, right, t }) =>
    t < 1e-10 ? block[left * width + col] : t > 1 - 1e-10 ? block[right * width + col] : block[left * width + col] * (1 - t) + block[right * width + col] * t)
  const channels = Array.from({ length: stride }, (_, i) => lerp(rawChannels, stride, i))
  const rootAxes = [0, 1, 2].map(i => lerp(root, 4, i))
  const rootPosition: Vec3[] = times.map((_, i) => [rootAxes[0][i], rootAxes[1][i], rootAxes[2][i]])
  const rawYaw = lerp(root, 4, 3)
  const yaw = butterworth(rawYaw, 0.5)
  const yawRate = yaw.slice(1).map((v, i) => (v - yaw[i]) * HZ)
  const orientations: Partial<Record<MotionTraceBone, Quat[]>> = {}
  const worldVelocity: Partial<Record<MotionTraceBone, Vec3[]>> = {}
  const o6: Partial<Record<MotionTraceBone, Vec3[]>> = {}
  const o15: Partial<Record<MotionTraceBone, Vec3[]>> = {}
  const bones = trace.rig.bones
  const core: readonly MotionTraceBone[] = CORE
  const poseColumns: Quat[][] = []
  const velocityColumns: Vec3[][] = []
  for (const [b, bone] of bones.entries()) {
    const parent = trace.rig.parents[b]
    const readQ = (frame: number): Quat => {
      const off = (frame * bones.length + b) * 4
      return normalize([rot[off], rot[off + 1], rot[off + 2], rot[off + 3]])
    }
    const poses = neighbours.map(({ left, right, t }, i) => multiply(
      parent < 0 ? yawQuat(rawYaw[i]) : poseColumns[parent][i],
      slerp(readQ(left), readQ(right), t),
    ))
    orientations[bone] = poses
    poseColumns.push(poses)
    const velocity = poses.slice(1).map((q, i) => scale(rotationVector(multiply(q, conjugate(poses[i]))), HZ))
    worldVelocity[bone] = velocity
    velocityColumns.push(velocity)
  }
  for (const [b, bone] of bones.entries()) {
    // P9 folds excluded core joints (notably upperChest) into the next core descendant.
    let parent = trace.rig.parents[b]
    if (core.includes(bone)) {
      while (parent >= 0 && !core.includes(bones[parent]))
        parent = trace.rig.parents[parent]
    }
    const relative = velocityColumns[b].map((v, i) => heading(sub(v, parent < 0 ? [0, yawRate[i], 0] : velocityColumns[parent][i]), yaw[i]))
    o6[bone] = filterVectors(relative, 6)
    o15[bone] = filterVectors(relative, 15)
  }
  const rootVelocity = rootPosition.slice(1).map((p, i) => scale(heading(sub(p, rootPosition[i]), yaw[i]), HZ / trace.rig.legLength))
  const length = rootVelocity.length
  const bodySpeed = regionSpeed(o6, CORE, length)
  const speeds: Record<Region, readonly number[]> = {
    head: regionSpeed(o6, REGIONS.head, length),
    trunk: regionSpeed(o6, REGIONS.trunk, length),
    armL: regionSpeed(o6, REGIONS.armL, length),
    armR: regionSpeed(o6, REGIONS.armR, length),
    legs: regionSpeed(o6, REGIONS.legs, length),
  }
  // Reject arithmetic overflow before a detector can collapse it to a zero
  // peak or an empty episode set. Optional scalar NaNs remain absent channels.
  const scalars = [times, yaw, yawRate, bodySpeed, ...Object.values(speeds)]
  const vectors = [rootPosition, rootVelocity, ...Object.values(orientations), ...Object.values(worldVelocity), ...Object.values(o6), ...Object.values(o15)]
  if (scalars.some(signal => signal.some(value => !Number.isFinite(value)))
    || vectors.some(signal => signal.some(value => value.some(component => !Number.isFinite(component))))) {
    throw new MotionTraceRefusal('trace-nonfinite', 'Nonfinite prepared kinematic signal')
  }
  const scenario = trace.source.scenario.class
  const reference = trace.source.level === 'reference'
  const eligible = rootVelocity.map((v, i) => {
    if (scenario === 'walk')
      return norm(v) > 0.2
    if (reference)
      return true
    if (scenario === 'idle')
      return channels[7][i] === 0 && channels[3][i] === 0
    if (scenario === 'talk')
      return channels[7][i] === 0
    return true
  })
  const eligibleSpans = runs(eligible)
  const windowSeconds = scenario === 'talk' ? 5 : 10
  const windows = placeWindows(eligibleSpans, windowSeconds).filter(s =>
    scenario !== 'talk' || reference || mean(channels[3].slice(s.start, s.end).map(v => v === 1 ? 1 : 0)) >= 0.8)
  return { input, times, orientations, worldVelocity, o6, o15, rootPosition, rootVelocity, yaw, yawRate, channels, bodySpeed, regionSpeed: speeds, eligibleSpans, windows, windowSeconds }
}
