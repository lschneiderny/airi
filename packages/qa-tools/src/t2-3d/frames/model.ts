import type { MMD } from '@moeru/three-mmd'
import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { Object3D, SkinnedMesh } from 'three'

import type { Quat, Vec3 } from '../metrics'
import type { FrameRig, LocalPose } from './pose'

import { MOTION_TRACE_BONES } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { MMDBodyPose } from '@proj-airi/stage-ui-mmd/composables/mmd/body/pose'
import { readMMDRigProfile } from '@proj-airi/stage-ui-mmd/composables/mmd/rig'
import { Matrix4, Quaternion, Vector3 } from 'three'

const quat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w]
const vec = (v: Vector3): Vec3 => [v.x, v.y, v.z]

/**
 * The renderer-neutral rig of a loaded PMX. Slots, rest rotations and the trace basis follow stage-ui-mmd's motion-trace
 * sampler (`createMMDMotionTraceSampler`), so a traced bone maps back to the bone the trace recorded; the frames
 * command proves that mapping on every run by comparing a re-run's trace with the stored one.
 */
export function frameRigFromMMD(mmd: MMD): FrameRig {
  const mesh = mmd.mesh
  const profile = readMMDRigProfile(mmd.pmx)
  const pose = new MMDBodyPose(mmd, profile)
  const names: Partial<Record<MotionTraceBone, string>> = { ...profile.bones, ...profile.fingerBones }
  // A rig whose eyes follow one both-eyes control bone records that bone under both eye slots; the bone-map module that
  // names it is not exported, so such eyes stay unmapped here and are posed from the re-run like any untraced bone.
  if (profile.eyeSource !== 'eyes') {
    delete names.leftEye
    delete names.rightEye
  }
  const slots = new Map<number, MotionTraceBone>()
  for (const slot of MOTION_TRACE_BONES) {
    const name = names[slot]
    const index = name === undefined ? undefined : pose.indices.get(name)
    if (index !== undefined && !slots.has(index))
      slots.set(index, slot)
  }
  const bones = mesh.skeleton.bones
  const indexOf = new Map<Object3D, number>(bones.map((bone, index) => [bone, index]))
  const bindToMesh = mesh.bindMatrix.clone().invert()
  const physics = new Set(profile.physicsOwned)
  const geometry = mesh.geometry
  const triangles = geometry.index?.array
  if (!triangles)
    throw new TypeError('The PMX mesh has no triangle index')
  return {
    basis: quat(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(pose.right, pose.up, pose.forward)).invert()),
    bones: bones.map((bone, index) => {
      const rest = bindToMesh.clone().multiply(mesh.skeleton.boneInverses[index].clone().invert())
      const position = new Vector3()
      const rotation = new Quaternion()
      rest.decompose(position, rotation, new Vector3())
      return {
        name: bone.name,
        parent: bone.parent ? indexOf.get(bone.parent) ?? -1 : -1,
        slot: slots.get(index) ?? null,
        bindRotation: quat(rotation),
        bindPosition: vec(position),
        physics: physics.has(bone.name),
      }
    }),
    positions: geometry.attributes.position.array,
    skinIndices: geometry.attributes.skinIndex.array,
    skinWeights: geometry.attributes.skinWeight.array,
    triangles,
  }
}

/** Every bone's transform relative to its parent bone (its world transform for a root bone), read after a pipeline step. */
export function localPoses(mesh: SkinnedMesh): LocalPose[] {
  const bones = mesh.skeleton.bones
  const parentInverse = new Matrix4()
  const local = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  return bones.map((bone) => {
    const parent = bones.find(other => other === bone.parent)
    local.copy(bone.matrixWorld)
    if (parent)
      local.premultiply(parentInverse.copy(parent.matrixWorld).invert())
    local.decompose(position, rotation, scale)
    return { rotation: quat(rotation), position: vec(position) }
  })
}
