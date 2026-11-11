import type { MotionTraceBone } from './types'

const bodyParents = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftEye: 'head',
  rightEye: 'head',
  leftShoulder: 'upperChest',
  rightShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  rightUpperArm: 'rightShoulder',
  leftLowerArm: 'leftUpperArm',
  rightLowerArm: 'rightUpperArm',
  leftHand: 'leftLowerArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  rightUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  rightLowerLeg: 'rightUpperLeg',
  leftFoot: 'leftLowerLeg',
  rightFoot: 'rightLowerLeg',
  leftToes: 'leftFoot',
  rightToes: 'rightFoot',
} as const

/** Complete canonical hierarchy, ordered so every parent precedes its children. */
export const HUMANOID_PARENTS: Readonly<Record<string, MotionTraceBone | null>> = (() => {
  const parents: Record<string, MotionTraceBone | null> = { ...bodyParents }
  for (const side of ['left', 'right'] as const) {
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const) {
      parents[`${side}${finger}Metacarpal`] = `${side}Hand`
      parents[`${side}${finger}Proximal`] = `${side}${finger}Metacarpal`
      parents[`${side}${finger}Intermediate`] = `${side}${finger}Proximal`
      parents[`${side}${finger}Distal`] = `${side}${finger}Intermediate`
    }
  }
  return parents
})()

export const MOTION_TRACE_BONES = Object.keys(HUMANOID_PARENTS).filter((bone): bone is MotionTraceBone => bone in HUMANOID_PARENTS)

/** Missing slots fold into the next present ancestor; disconnected roots use -1. */
export function motionTraceParents(bones: readonly MotionTraceBone[]): number[] {
  return bones.map((bone) => {
    let parent = HUMANOID_PARENTS[bone]
    while (parent !== null) {
      const index = bones.indexOf(parent)
      if (index >= 0)
        return index
      parent = HUMANOID_PARENTS[parent]
    }
    return -1
  })
}
