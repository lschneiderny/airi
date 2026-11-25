import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat, Vec3 } from '../metrics'

import { multiply } from '@proj-airi/qa-tools/t2-3d/metrics/math'
import { analyticTrace } from '@proj-airi/qa-tools/t2-3d/metrics/test-trace'
import { describe, expect, it } from 'vitest'

import { loadedRun, rotX, rotY, TEST_BONES } from './test-runs'
import { walkStyleReading } from './walk-style'

const DEG = Math.PI / 180
const FINGERS = (['left', 'right'] as const).flatMap(side => [
  `${side}MiddleProximal`,
  ...(['Index', 'Little'] as const).flatMap(finger => (['Proximal', 'Intermediate', 'Distal'] as const).map(joint => `${side}${finger}${joint}`)),
] as MotionTraceBone[])
const BONES: readonly MotionTraceBone[] = [...TEST_BONES, 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', ...FINGERS]
/** Joint offsets from the parent joint at rest, leg length 1: hips 0.2 wide, shoulders 0.3 wide. */
const OFFSETS: Partial<Record<MotionTraceBone, [number, number, number]>> = {
  leftUpperLeg: [0.1, -0.05, 0],
  rightUpperLeg: [-0.1, -0.05, 0],
  leftLowerLeg: [0, -0.5, 0],
  rightLowerLeg: [0, -0.5, 0],
  leftFoot: [0, -0.5, 0],
  rightFoot: [0, -0.5, 0],
  leftShoulder: [0.05, 0.05, 0],
  rightShoulder: [-0.05, 0.05, 0],
  leftUpperArm: [0.1, 0, 0],
  rightUpperArm: [-0.1, 0, 0],
  leftLowerArm: [0, -0.3, 0],
  rightLowerArm: [0, -0.3, 0],
  leftHand: [0, -0.25, 0],
  rightHand: [0, -0.25, 0],
  // The hand hangs with its palm toward the thigh and its thumb side forward: the index knuckle ahead of the little one,
  // which sits nearer the wrist.
  ...Object.fromEntries((['left', 'right'] as const).flatMap(side => [
    [`${side}MiddleProximal`, [0, -0.08, 0]],
    [`${side}IndexProximal`, [0, -0.08, 0.02]],
    [`${side}LittleProximal`, [0, -0.07, -0.02]],
    ...(['Index', 'Little'] as const).flatMap(finger => [[`${side}${finger}Intermediate`, [0, -0.04, 0]], [`${side}${finger}Distal`, [0, -0.03, 0]]]),
  ])),
}
const rotZ = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)]

/** The wrist extends 15 degrees and moves 10 either way with the swing; the arm twists 4 and pronates 5 either way. */
const WRIST = { mean: 15, swing: 10 }
const ROLL = { twist: 4, pronation: 5 }
/** Curl of each joint, knuckle to tip, degrees. */
const CURL = { Index: [10, 15, 5], Little: [20, 25, 10] } as const

/** Strides per second: 1.4 steps per second at 1 L/s, so a step of 1 / 1.4 L. */
const STRIDE_HZ = 0.7
/** The spine, chest and upper chest each pitch 9 degrees back (positive is forward); an unsigned lean would read it forward. */
const LEAN = -9 * DEG
/** The P95 - P5 spread of a sine of unit amplitude sampled over whole cycles. */
const SINE_SPREAD = 2 * Math.sin(0.45 * Math.PI)

/**
 * 1 s of starting (mode 2), then walking at 1 L/s along +z to 20 s, a 90 degree turn under way over 3 s, and walking
 * along +x to 40 s. The thighs swing 25 degrees each way with the knee bent 30 degrees, the pelvis twists 10 degrees
 * each way, the upper arms swing 15 degrees each way with the elbows bent 20 degrees, the spine, chest and upper chest
 * are pitched 9 degrees back, the neck 10 degrees forward, and the hips bob 0.02 L each way twice a stride.
 */
function walk() {
  const radius = 3 / (Math.PI / 2)
  const heading = (t: number) => Math.min(1, Math.max(0, (t - 20) / 3)) * Math.PI / 2
  const position = (t: number): Vec3 => {
    const bob = 0.02 * Math.cos(2 * Math.PI * 2 * STRIDE_HZ * t)
    if (t < 20)
      return [0, bob, t]
    if (t < 23)
      return [radius * (1 - Math.cos(heading(t))), bob, 20 + radius * Math.sin(heading(t))]
    return [radius + (t - 23), bob, 20 + radius]
  }
  const phase = (t: number) => 2 * Math.PI * STRIDE_HZ * t
  const twist = (t: number) => 10 * DEG * Math.sin(phase(t))
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const yaw = rotY(heading(t))
    const side = bone.startsWith('left') ? 1 : -1
    if (bone === 'hips')
      return rotY(heading(t) + twist(t))
    if (bone === 'spine' || bone === 'chest' || bone === 'upperChest')
      return multiply(yaw, rotX(LEAN))
    if (bone === 'neck' || bone === 'head')
      return multiply(yaw, rotX(10 * DEG))
    if (bone.endsWith('UpperLeg'))
      return multiply(yaw, rotX(-25 * DEG * side * Math.sin(phase(t))))
    if (bone.endsWith('LowerLeg') || bone.endsWith('Foot'))
      return multiply(yaw, rotX(-25 * DEG * side * Math.sin(phase(t)) + 30 * DEG))
    if (bone.endsWith('UpperArm'))
      return multiply(yaw, rotX(15 * DEG * side * Math.sin(phase(t))))
    // Each side mirrors the other: extension bends the hand outward and pronation turns it inward on both, and a finger
    // curls toward the palm, which faces the thigh.
    const swing = multiply(yaw, rotX(15 * DEG * side * Math.sin(phase(t))))
    const lower = multiply(swing, multiply(rotY(-side * ROLL.twist * DEG * Math.sin(phase(t))), rotX(-20 * DEG)))
    if (bone.endsWith('LowerArm'))
      return lower
    const hand = multiply(lower, multiply(rotY(-side * ROLL.pronation * DEG * Math.sin(phase(t))), rotZ(side * (WRIST.mean + WRIST.swing * Math.sin(phase(t))) * DEG)))
    if (bone.endsWith('Hand') || bone.endsWith('MiddleProximal'))
      return hand
    const finger = bone.includes('Index') ? 'Index' : 'Little'
    const joints = bone.endsWith('Proximal') ? 1 : bone.endsWith('Intermediate') ? 2 : 3
    return CURL[finger].slice(0, joints).reduce((q, curl) => multiply(q, rotZ(-side * curl * DEG)), hand)
  }
  const input = analyticTrace({ seconds: 40, bones: BONES, scenario: 'walk', world, position, yaw: t => heading(t) + twist(t), mode: t => t < 1 ? 2 : 3 })
  input.trace.rig.restOffsets = input.trace.rig.bones.map(bone => OFFSETS[bone] ?? [0, 0.1, 0])
  return loadedRun(input, null, null)
}

describe('walk-style measures', () => {
  const reading = walkStyleReading(walk())

  it('measures steady straight walking only: not the start and not the turn under way', () => {
    expect(reading.spans).toHaveLength(2)
    expect(reading.spans[0].from).toBeGreaterThan(1)
    expect(reading.spans[0].to).toBeLessThan(20)
    expect(reading.spans[1].from).toBeGreaterThan(23)
  })

  it('reads the walk\'s stride, bounce, pelvis, arms, trunk, head and knee in leg lengths and degrees', () => {
    const m = reading.measures
    expect(m.speed).toBeCloseTo(1, 2)
    expect(m.cadence).toBeCloseTo(2 * STRIDE_HZ, 2)
    expect(m.step).toBeCloseTo(1 / (2 * STRIDE_HZ), 2)
    expect(m.bounce).toBeCloseTo(0.04, 3)
    expect(m.pelvisTwist).toBeCloseTo(10 * SINE_SPREAD, 0)
    expect(m.pelvisList).toBeCloseTo(0, 3)
    // At each heel strike the pelvis is twisted its full 10 degrees, which narrows the 0.2 L hip line's width.
    expect(m.width).toBeCloseTo(0.2 * Math.cos(10 * DEG), 3)
    expect(m.armSwing).toBeCloseTo(15 * SINE_SPREAD, 0)
    expect(m.elbow).toBeCloseTo(20, 1)
    // The hip midpoint sits 0.05 L under the hips joint and the spine joint 0.1 L over it; three 0.1 L segments lean.
    expect(m.trunk).toBeCloseTo(Math.atan2(0.3 * Math.sin(LEAN), 0.15 + 0.3 * Math.cos(LEAN)) / DEG, 1)
    expect(m.head).toBeCloseTo(10, 1)
    expect(m.kneeSwing).toBeCloseTo(30, 1)
  })

  it('reads the hand: wrist carriage and its range in a stride, the forearm\'s roll, and each finger\'s summed curl', () => {
    const m = reading.measures
    // The steady spans end partway into a stride, which moves the mean of the 10 degree swing by up to a degree.
    expect(Math.abs((m.wrist ?? Number.NaN) - WRIST.mean)).toBeLessThan(1)
    expect(m.wristMove).toBeCloseTo(2 * WRIST.swing, 1)
    expect(m.roll).toBeCloseTo(2 * (ROLL.twist + ROLL.pronation), 1)
    expect(m.index).toBeCloseTo(30, 3)
    expect(m.little).toBeCloseTo(55, 3)
  })
})
