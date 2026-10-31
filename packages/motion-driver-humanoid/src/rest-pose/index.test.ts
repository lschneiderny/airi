import type { RestRelativeRotation, Vec3 } from '../types'
import type { ArmRestInput } from './index'

import { describe, expect, it } from 'vitest'

import { mirrorRotation, rotationToMatrix } from '../types'
import { createArmRest, DEFAULT_ARM_REST_POSE } from './index'

const rad = Math.PI / 180
const free = { leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }

function input(overrides: Partial<ArmRestInput> = {}): ArmRestInput {
  return {
    bindArmAngle: 36 * rad,
    pose: DEFAULT_ARM_REST_POSE,
    breath: 0,
    torsoRoll: 0,
    swingWeight: 0,
    owned: free,
    ...overrides,
  }
}

function apply(r: RestRelativeRotation, v: Vec3): Vec3 {
  const m = rotationToMatrix(r)
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  }
}

function compose(...rs: RestRelativeRotation[]) {
  return (v: Vec3) => rs.reduceRight((acc, r) => apply(r, acc), v)
}

function leftForearm(rho: number, rotations: Record<string, RestRelativeRotation | undefined>): Vec3 {
  const { leftShoulder, leftUpperArm, leftLowerArm } = rotations
  return compose(leftShoulder!, leftUpperArm!, leftLowerArm!)({ x: Math.cos(rho), y: -Math.sin(rho), z: 0 })
}

function leftHandPosition(rotations: Record<string, RestRelativeRotation | undefined>): Vec3 {
  const { leftShoulder, leftUpperArm, leftLowerArm } = rotations
  const sh = apply(leftShoulder!, { x: 0.1, y: 0, z: 0 })
  const up = compose(leftShoulder!, leftUpperArm!)({ x: 0.5, y: -0.05, z: 0 })
  const low = compose(leftShoulder!, leftUpperArm!, leftLowerArm!)({ x: 0.45, y: -0.05, z: 0 })
  return { x: sh.x + up.x + low.x, y: sh.y + up.y + low.y, z: sh.z + up.z + low.z }
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('createArmRest', () => {
  it('gives A-pose (36 deg) and T-pose (0 deg) rigs the same world forearm direction', () => {
    const a = createArmRest().step(input({ bindArmAngle: 36 * rad }), 1 / 60).rotations
    const t = createArmRest().step(input({ bindArmAngle: 0 }), 1 / 60).rotations
    const fa = leftForearm(36 * rad, a)
    const ft = leftForearm(0, t)
    for (const f of [fa, ft]) {
      expect(f.x).toBeCloseTo(0.2034, 4)
      expect(f.y).toBeCloseTo(-0.9399, 4)
      expect(f.z).toBeCloseTo(0.2741, 4)
    }
    expect(fa.x).toBeCloseTo(ft.x, 4)
    expect(fa.y).toBeCloseTo(ft.y, 4)
    expect(fa.z).toBeCloseTo(ft.z, 4)
  })

  it('matches the worked-example angles', () => {
    const a = createArmRest().step(input({ bindArmAngle: 36 * rad }), 1 / 60).rotations
    expect(a.leftUpperArm!.yaw / rad).toBeCloseTo(-0.35, 1)
    expect(a.leftUpperArm!.pitch / rad).toBeCloseTo(-3.99, 1)
    expect(a.leftUpperArm!.roll / rad).toBeCloseTo(-36.99, 1)
    expect(a.leftLowerArm!.yaw / rad).toBeCloseTo(-9.76, 1)
    expect(a.leftLowerArm!.pitch / rad).toBeCloseTo(-7.02, 1)
    expect(a.leftLowerArm!.roll / rad).toBeCloseTo(0.6, 1)
    const t = createArmRest().step(input({ bindArmAngle: 0 }), 1 / 60).rotations
    expect(t.leftUpperArm!.roll / rad).toBeCloseTo(-72.99, 1)
    expect(t.leftLowerArm!.yaw / rad).toBeCloseTo(-12, 1)
  })

  it('mirrors the right side from the left', () => {
    const { rotations } = createArmRest().step(input({ breath: 0.5 }), 1 / 60)
    const names = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'IndexProximal', 'LittleDistal', 'ThumbMetacarpal'] as const
    for (const n of names) {
      const l = rotations[`left${n}` as keyof typeof rotations]!
      const r = rotations[`right${n}` as keyof typeof rotations]!
      const m = mirrorRotation(l)
      expect(r.yaw).toBeCloseTo(m.yaw, 9)
      expect(r.pitch).toBeCloseTo(m.pitch, 9)
      expect(r.roll).toBeCloseTo(m.roll, 9)
    }
  })

  it('applies the torso-roll term with the same sign on both upper arms', () => {
    const level = createArmRest().step(input(), 1 / 60).rotations
    const rolled = createArmRest().step(input({ torsoRoll: 0.05 }), 1 / 60).rotations
    expect(rolled.leftUpperArm!.roll - level.leftUpperArm!.roll).toBeCloseTo(-0.04, 9)
    expect(rolled.rightUpperArm!.roll - level.rightUpperArm!.roll).toBeCloseTo(-0.04, 9)
  })

  it('curls fingers with the index/middle/ring/little scale and no non-thumb metacarpal', () => {
    const { rotations } = createArmRest().step(input(), 1 / 60)
    const rolls = (['Index', 'Middle', 'Ring', 'Little'] as const).map(f => -rotations[`left${f}Proximal`]!.roll / rad)
    expect(rolls[0]).toBeCloseTo(15, 3)
    expect(rolls[1]).toBeCloseTo(15 * 1.15, 3)
    expect(rolls[2]).toBeCloseTo(15 * 1.3, 3)
    expect(rolls[3]).toBeCloseTo(15 * 1.45, 3)
    expect(rotations.leftIndexMetacarpal).toBeUndefined()
    expect(rotations.leftThumbMetacarpal).toBeDefined()
    expect(rotations.leftThumbIntermediate).toBeUndefined()
  })

  it('rotates the thumb about the measured axis', () => {
    const axis = { x: 0, y: 1, z: 0 }
    const { rotations } = createArmRest().step(input({ thumbAxis: { left: axis, right: axis } }), 1 / 60)
    expect(rotations.leftThumbMetacarpal!.yaw / rad).toBeCloseTo(10, 3)
    expect(rotations.leftThumbMetacarpal!.roll).toBeCloseTo(0, 9)
  })

  it('scales output by (1 - owned) per group', () => {
    const rest = createArmRest().step(input(), 1 / 60).rotations
    const half = createArmRest().step(input({ owned: { ...free, leftArm: 0.5 } }), 1 / 60).rotations
    const owned = createArmRest().step(input({ owned: { ...free, leftArm: 1, leftFingers: 1 } }), 1 / 60).rotations
    expect(half.leftHand!.roll).toBeCloseTo(rest.leftHand!.roll / 2, 9)
    expect(half.rightHand!.roll).toBeCloseTo(rest.rightHand!.roll, 9)
    expect(half.leftIndexProximal!.roll).toBeCloseTo(rest.leftIndexProximal!.roll, 9)
    for (const key of ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'leftIndexProximal'] as const) {
      expect(Math.abs(owned[key]!.yaw) + Math.abs(owned[key]!.pitch) + Math.abs(owned[key]!.roll)).toBeCloseTo(0, 9)
    }
    expect(owned.rightHand!.roll).toBeCloseTo(rest.rightHand!.roll, 9)
  })

  it('couples breath to shoulder roll (1.6 deg peak to peak) while the hand barely moves', () => {
    const neutral = createArmRest().step(input({ breath: 0 }), 1 / 60).rotations
    const up = createArmRest().step(input({ breath: 1 }), 1 / 60).rotations
    const down = createArmRest().step(input({ breath: -1 }), 1 / 60).rotations
    expect((up.leftShoulder!.roll - down.leftShoulder!.roll) / rad).toBeCloseTo(1.6, 3)
    const armLength = 1.0
    const home = leftHandPosition(neutral)
    expect(distance(leftHandPosition(up), home) / armLength).toBeLessThan(0.005)
    expect(distance(leftHandPosition(down), home) / armLength).toBeLessThan(0.005)
  })

  it('adds locomotion swing as forward pitch and extra elbow flex', () => {
    const swing = { left: { flexion: 20 * rad, elbowFlex: 10 * rad }, right: { flexion: 0, elbowFlex: 0 } }
    const rest = createArmRest().step(input({ bindArmAngle: 0 }), 1 / 60).rotations
    const walking = createArmRest().step(input({ bindArmAngle: 0, swing, swingWeight: 1 }), 1 / 60).rotations
    const half = createArmRest().step(input({ bindArmAngle: 0, swing, swingWeight: 0.5 }), 1 / 60).rotations
    const upperDirection = (r: typeof rest) => compose(r.leftShoulder!, r.leftUpperArm!)({ x: 1, y: 0, z: 0 })
    const expected = apply({ yaw: 0, pitch: -20 * rad, roll: 0 }, upperDirection(rest))
    const actual = upperDirection(walking)
    expect(actual.x).toBeCloseTo(expected.x, 9)
    expect(actual.y).toBeCloseTo(expected.y, 9)
    expect(actual.z).toBeCloseTo(expected.z, 9)
    expect(walking.leftLowerArm!.yaw / rad).toBeCloseTo(-22, 3)
    expect(half.leftLowerArm!.yaw / rad).toBeCloseTo(-17, 3)
    expect(walking.rightUpperArm!.pitch).toBeCloseTo(rest.rightUpperArm!.pitch, 9)
  })

  it('smooths torso roll with a critically damped spring and no jump on a step change', () => {
    const arm = createArmRest()
    const dt = 1 / 120
    const roll = (torsoRoll: number) => arm.step(input({ torsoRoll }), dt).rotations.leftUpperArm!.roll
    const base = roll(0)
    expect(roll(0)).toBeCloseTo(base, 12)
    const values = [base]
    for (let i = 0; i < 240; i++) values.push(roll(0.1))
    const deltas = values.slice(1).map((v, i) => v - values[i])
    expect(Math.abs(deltas[0]!)).toBeLessThan(0.1 * 0.8 * 0.02)
    expect(deltas.every(d => d <= 1e-12)).toBe(true)
    expect(values.at(-1)! - base).toBeCloseTo(-0.8 * 0.1, 3)
  })

  it('advances no time for negative or non-finite dt', () => {
    const arm = createArmRest()
    arm.step(input({ torsoRoll: 0 }), 1 / 60)
    const before = arm.step(input({ torsoRoll: 0.1 }), -1).rotations.leftUpperArm!.roll
    const nan = arm.step(input({ torsoRoll: 0.1 }), Number.NaN).rotations.leftUpperArm!.roll
    expect(before).toBeCloseTo(nan, 12)
  })
})
