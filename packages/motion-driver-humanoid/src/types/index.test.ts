import type { HumanoidBoneName } from './index'

import { describe, expect, it } from 'vitest'

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
