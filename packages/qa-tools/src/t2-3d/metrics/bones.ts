import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Region } from './types'

export const CORE = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
] as const satisfies readonly MotionTraceBone[]

export const UPPER = CORE.filter(b => !b.endsWith('Leg'))
export const ARMS = CORE.filter(b => /Shoulder|Arm|Hand/.test(b))
export const REGIONS: Readonly<Record<Region, readonly MotionTraceBone[]>> = {
  head: ['neck', 'head'],
  trunk: ['hips', 'spine', 'chest'],
  armL: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
  armR: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
  legs: ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg'],
}

export const CHAIN_PAIRS = [
  ['spine', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['leftShoulder', 'leftUpperArm'],
  ['leftUpperArm', 'leftLowerArm'],
  ['leftLowerArm', 'leftHand'],
  ['rightShoulder', 'rightUpperArm'],
  ['rightUpperArm', 'rightLowerArm'],
  ['rightLowerArm', 'rightHand'],
] as const satisfies readonly (readonly [MotionTraceBone, MotionTraceBone])[]

export const SIGNAL_BONES = ['hips', 'spine', 'chest', 'head', 'leftUpperArm', 'rightUpperArm'] as const
export const isFinger = (bone: string): boolean => /Thumb|Index|Middle|Ring|Little/.test(bone)
