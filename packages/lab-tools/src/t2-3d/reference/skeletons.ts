import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { BvhClip, Vec3 } from './bvh'

import { MOTION_TRACE_BONES, motionTraceParents } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Matrix4, Quaternion, Vector3 } from 'three'

import { ReferenceRefusal } from './bvh'

export type SkeletonProfile = 'cmu' | '100style'

/** Checked against the actual CMU MotionBuilder and 100STYLE hierarchies. */
const profiles: Record<SkeletonProfile, Partial<Record<MotionTraceBone, string>>> = {
  'cmu': {
    hips: 'Hips',
    spine: 'Spine',
    chest: 'Spine1',
    neck: 'Neck1',
    head: 'Head',
    leftShoulder: 'LeftShoulder',
    rightShoulder: 'RightShoulder',
    leftUpperArm: 'LeftArm',
    rightUpperArm: 'RightArm',
    leftLowerArm: 'LeftForeArm',
    rightLowerArm: 'RightForeArm',
    leftHand: 'LeftHand',
    rightHand: 'RightHand',
    leftUpperLeg: 'LeftUpLeg',
    rightUpperLeg: 'RightUpLeg',
    leftLowerLeg: 'LeftLeg',
    rightLowerLeg: 'RightLeg',
    leftFoot: 'LeftFoot',
    rightFoot: 'RightFoot',
    leftToes: 'LeftToeBase',
    rightToes: 'RightToeBase',
  },
  '100style': {
    hips: 'Hips',
    spine: 'Chest2',
    chest: 'Chest4',
    neck: 'Neck',
    head: 'Head',
    leftShoulder: 'LeftCollar',
    rightShoulder: 'RightCollar',
    leftUpperArm: 'LeftShoulder',
    rightUpperArm: 'RightShoulder',
    leftLowerArm: 'LeftElbow',
    rightLowerArm: 'RightElbow',
    leftHand: 'LeftWrist',
    rightHand: 'RightWrist',
    leftUpperLeg: 'LeftHip',
    rightUpperLeg: 'RightHip',
    leftLowerLeg: 'LeftKnee',
    rightLowerLeg: 'RightKnee',
    leftFoot: 'LeftAnkle',
    rightFoot: 'RightAnkle',
    leftToes: 'LeftToe',
    rightToes: 'RightToe',
  },
}

function snap(vector: Vector3): Vector3 {
  const values = vector.toArray()
  const index = values.reduce((best, value, i) => Math.abs(value) > Math.abs(values[best]) ? i : best, 0)
  if (vector.length() === 0 || Math.abs(values[index]) / vector.length() < Math.SQRT1_2)
    throw new ReferenceRefusal('reference-rest-pose', 'Rest axis is degenerate or not upright')
  return new Vector3().setComponent(index, Math.sign(values[index]))
}

export function resolveSkeleton(clip: BvhClip, profile: SkeletonProfile) {
  const table = profiles[profile]
  const bones = MOTION_TRACE_BONES.filter(bone => table[bone] !== undefined)
  const indices = bones.map((bone) => {
    const name = table[bone]
    const index = clip.names.findIndex(joint => joint === name)
    if (index < 0)
      throw new ReferenceRefusal('reference-missing-bone', `${profile}: ${name} (${bone})`)
    return index
  })
  const parents = motionTraceParents(bones)
  const rest: Vector3[] = []
  for (let i = 0; i < clip.names.length; i++) {
    const position = new Vector3(...clip.offsets[i])
    rest.push(clip.parents[i] < 0 ? position : position.add(rest[clip.parents[i]]))
  }
  for (let column = 0; column < bones.length; column++) {
    let ancestor = clip.parents[indices[column]]
    while (ancestor >= 0 && !indices.includes(ancestor))
      ancestor = clip.parents[ancestor]
    const expected = parents[column] < 0 ? -1 : indices[parents[column]]
    if (ancestor !== expected)
      throw new ReferenceRefusal('reference-hierarchy', `${profile}: ${table[bones[column]]} has the wrong mapped ancestor`)
  }
  const position = (bone: MotionTraceBone) => rest[indices[bones.indexOf(bone)]]
  const up = snap(position('head').clone().sub(position('hips')))
  const left = snap(position('leftUpperLeg').clone().sub(position('rightUpperLeg')))
  if (Math.abs(up.dot(left)) > 0)
    throw new ReferenceRefusal('reference-rest-pose', 'Rest up and left axes are parallel')
  // Both legs must descend and the head must rise along the derived up axis.
  for (const side of ['left', 'right'] as const) {
    const leg = position(`${side}UpperLeg`).clone().sub(position(`${side}Foot`))
    if (leg.dot(up) <= 0 || leg.dot(up) / leg.length() < Math.SQRT1_2)
      throw new ReferenceRefusal('reference-rest-pose', `${side} leg is not upright`)
  }
  const forward = left.clone().cross(up)
  const basis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(left, up, forward)).invert()
  const restOffsets: Vec3[] = indices.map((index, column) => {
    const displacement = rest[index].clone()
    if (parents[column] >= 0)
      displacement.sub(rest[indices[parents[column]]])
    return displacement.applyQuaternion(basis).toArray()
  })
  const legLengths = (['left', 'right'] as const).map(side =>
    position(`${side}UpperLeg`).distanceTo(position(`${side}LowerLeg`))
    + position(`${side}LowerLeg`).distanceTo(position(`${side}Foot`)),
  )
  return { bones, parents, indices, basis, restOffsets, legLength: (legLengths[0] + legLengths[1]) / 2 }
}
