import type { DecodedMotionTrace } from '../read-trace'
import type { MotionBandsFile } from './types'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { median } from '../metrics/math'

export class GateRefusal extends Error {
  constructor(override readonly name: string, readonly detail: string) {
    super(`${name}: ${detail}`)
  }
}

/** Structural refusals belong to readTrace; this boundary owns judgeability. */
export function checkKinematics(input: DecodedMotionTrace, minimumSeconds?: number): { scoredSeconds: number, hz: number } {
  const { trace, channels, rot } = input
  const stride = MOTION_TRACE_CHANNELS.length
  const times = Array.from({ length: trace.frames }, (_, i) => channels[i * stride])
  const intervals = times.slice(1).map((t, i) => t - times[i])
  const medianInterval = median(intervals)
  if (medianInterval > 1 / 30 + 1e-6)
    throw new GateRefusal('rate-too-low', `Median interval ${medianInterval} s is above 1/30 s`)
  const walls = times.map((t, i) => channels[i * stride + 1] - t).filter(Number.isFinite)
  if (intervals.some(dt => dt >= 1 / 20 - 1e-6)
    || intervals.filter(dt => dt > 1 / 24 + 1e-6).length > intervals.length * 0.005
    || (walls.length && Math.max(...walls) - Math.min(...walls) > 0.1 + 1e-6)) {
    throw new GateRefusal('frame-gap', 'Frame gaps or wall/time drift exceed the gate limits')
  }
  const scenario = trace.source.scenario.class
  const scoredSeconds = times.length ? times[times.length - 1] - Math.max(times[0], trace.scoredFrom) : 0
  const minimum = minimumSeconds ?? (scenario === 'talk' ? 5 : 10)
  if (scoredSeconds + 1e-6 < minimum)
    throw new GateRefusal('trace-too-short', `${scoredSeconds} scored seconds; ${scenario} requires ${minimum}`)
  const required = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'] as const
  if (required.some(bone => !trace.rig.bones.includes(bone)))
    throw new GateRefusal('rig-incomplete', 'Missing hips, spine, head, upper arm, lower arm or hand')
  const hips = trace.rig.bones.indexOf('hips')
  let nonUpright = 0
  let scored = 0
  for (let frame = 0; frame < trace.frames; frame++) {
    if (times[frame] < trace.scoredFrom)
      continue
    const offset = (frame * trace.rig.bones.length + hips) * 4
    const [x, y, z, w] = rot.subarray(offset, offset + 4)
    const forwardX = 2 * (x * z + w * y)
    const forwardZ = 1 - 2 * (x * x + y * y)
    nonUpright += Math.hypot(forwardX, forwardZ) < 0.5 ? 1 : 0
    scored++
  }
  if (nonUpright > scored * 0.01)
    throw new GateRefusal('non-upright', `${nonUpright}/${scored} scored frames have horizontal hips forward length < 0.5`)
  return { scoredSeconds, hz: intervals.length ? 1 / medianInterval : trace.hz }
}

export function checkTrace(input: DecodedMotionTrace, bands: MotionBandsFile): { scoredSeconds: number, hz: number } {
  const timing = checkKinematics(input)
  const scenario = input.trace.source.scenario.class
  if (!bands.classes[scenario])
    throw new GateRefusal('class-unknown', `No reference bands for class ${scenario}`)
  return timing
}
