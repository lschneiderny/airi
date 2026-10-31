import type { MMD } from '@moeru/three-mmd'
import type { Bone } from 'three'

import type { MMDCleanPose } from '../frame-pipeline'
import type { MMDRigProfile } from '../rig'

import { Euler, Quaternion, Vector3 } from 'three'

/** Bone indices and bind axes are resolved once, after the PMX Z conversion. */
export class MMDBodyPose {
  readonly indices = new Map<string, number>()
  readonly forward = new Vector3(0, 0, 1)
  readonly up = new Vector3(0, 1, 0)
  readonly right = new Vector3(1, 0, 0)
  private readonly delta = new Quaternion()
  private readonly angles = new Euler(0, 0, 0, 'YXZ')

  constructor(readonly mmd: MMD, readonly rig: MMDRigProfile) {
    mmd.mesh.updateWorldMatrix(true, true)
    mmd.mesh.skeleton.bones.forEach((bone, index) => this.indices.set(bone.name, index))
    // PMX local axes are not necessarily mesh axes. Resolve the head's bind
    // forward in mesh space instead of applying a second, hard-coded Z flip.
    const head = this.bone(rig.bones.head)
    if (head) {
      const world = head.getWorldQuaternion(new Quaternion())
      const meshRotation = mmd.mesh.getWorldQuaternion(new Quaternion()).invert()
      this.forward.applyQuaternion(world).applyQuaternion(meshRotation).normalize()
      this.up.applyQuaternion(world).applyQuaternion(meshRotation).normalize()
      this.right.crossVectors(this.up, this.forward).normalize()
    }
  }

  bone(name: string | null | undefined): Bone | undefined {
    if (!name || this.rig.physicsOwned.includes(name))
      return undefined
    const index = this.indices.get(name)
    return index === undefined ? undefined : this.mmd.mesh.skeleton.bones[index]
  }

  localPosition(bone: Bone): Vector3 {
    return this.mmd.mesh.worldToLocal(bone.getWorldPosition(new Vector3()))
  }

  /** Rest-relative local overlay; every call starts at the pipeline snapshot. */
  rotate(name: string | null | undefined, clean: MMDCleanPose, angles: { pitch: number, yaw: number, roll: number }): void {
    const bone = this.bone(name)
    const index = name ? this.indices.get(name) : undefined
    if (!bone || index === undefined)
      return
    this.delta.setFromEuler(this.angles.set(angles.pitch, angles.yaw, angles.roll, 'YXZ'))
    bone.quaternion.copy(clean.quaternions[index]).multiply(this.delta)
  }

  /** A mesh-frame rotation converted into the bone's current parent frame. */
  premultiply(bone: Bone, rotation: Quaternion): void {
    const meshWorld = this.mmd.mesh.getWorldQuaternion(new Quaternion())
    const parentWorld = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()
    const basis = parentWorld.invert().multiply(meshWorld)
    const delta = basis.clone().multiply(rotation).multiply(basis.invert())
    bone.quaternion.premultiply(delta)
    bone.updateWorldMatrix(false, true)
  }

  translate(name: string | null, clean: MMDCleanPose, offset: Vector3): void {
    const bone = this.bone(name)
    const index = name ? this.indices.get(name) : undefined
    if (!bone || index === undefined)
      return
    bone.parent?.updateWorldMatrix(true, false)
    const origin = this.mmd.mesh.localToWorld(new Vector3())
    const end = this.mmd.mesh.localToWorld(offset.clone())
    if (bone.parent) {
      bone.parent.worldToLocal(origin)
      bone.parent.worldToLocal(end)
    }
    bone.position.copy(clean.positions[index]).add(end.sub(origin))
    bone.updateWorldMatrix(false, true)
  }
}
