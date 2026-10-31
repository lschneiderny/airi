import type { ArmBoneName, HumanoidBoneName, HumanoidFingerBoneName } from './index'

import { describe, expect, it } from 'vitest'

import { matrixToRotation, mirrorRotation, rotationToMatrix } from './index'

describe('humanoid bone names', () => {
  it('uses unique names for the canonical bone list', () => {
    const bones: HumanoidBoneName[] = [
      'hips',
      'spine',
      'chest',
      'upperChest',
      'neck',
      'head',
      'leftEye',
      'rightEye',
      'leftUpperLeg',
      'leftLowerLeg',
      'leftFoot',
      'leftToes',
      'rightUpperLeg',
      'rightLowerLeg',
      'rightFoot',
      'rightToes',
      'leftShoulder',
      'leftUpperArm',
      'leftLowerArm',
      'leftHand',
      'rightShoulder',
      'rightUpperArm',
      'rightLowerArm',
      'rightHand',
    ]

    expect(new Set(bones).size).toBe(bones.length)
  })
})

describe('finger and arm bone names', () => {
  it('types the 40 finger bones and the arm chain', () => {
    const finger: HumanoidFingerBoneName = 'rightLittleDistal'
    const arm: ArmBoneName[] = ['leftShoulder', 'rightHand', finger]
    expect(arm).toHaveLength(3)
  })
})

describe('rest-relative rotation order', () => {
  const deg = Math.PI / 180
  const apply = (m: ReturnType<typeof rotationToMatrix>, v: [number, number, number]) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]

  it('pins intrinsic YXZ (R = Ry(yaw) * Rx(pitch) * Rz(roll))', () => {
    const m = rotationToMatrix({ yaw: 90 * deg, pitch: 90 * deg, roll: 90 * deg })
    // Rz(90): x -> y; Rx(90): y -> z; Ry(90): z -> x.
    const x = apply(m, [1, 0, 0])
    expect(x[0]).toBeCloseTo(1, 9)
    expect(x[1]).toBeCloseTo(0, 9)
    expect(x[2]).toBeCloseTo(0, 9)
    // Roll is applied first: with yaw only, x -> (0, 0, -1).
    const yawOnly = apply(rotationToMatrix({ yaw: 90 * deg, pitch: 0, roll: 0 }), [1, 0, 0])
    expect(yawOnly[2]).toBeCloseTo(-1, 9)
  })

  it('round-trips through the matrix', () => {
    const r = { yaw: 0.4, pitch: -0.3, roll: 1.1 }
    const back = matrixToRotation(rotationToMatrix(r))
    expect(back.yaw).toBeCloseTo(r.yaw, 9)
    expect(back.pitch).toBeCloseTo(r.pitch, 9)
    expect(back.roll).toBeCloseTo(r.roll, 9)
  })

  it('mirrors yaw and roll', () => {
    expect(mirrorRotation({ yaw: 0.2, pitch: 0.3, roll: -0.4 })).toEqual({ yaw: -0.2, pitch: 0.3, roll: 0.4 })
  })
})
