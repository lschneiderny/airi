import type { MMDCleanPose } from '../frame-pipeline'
import type { MMDBodyPose } from './pose'

import { aimEyes } from '@proj-airi/motion-driver-humanoid/look-at'
import { Euler, Quaternion, Vector3 } from 'three'

import { toRigTraits } from '../rig'

/** Closed-loop eye aim is evaluated after every head and body rotation, from the eyes' actual rendered parents. */
export class MMDEyes {
  private readonly eyes
  private readonly limits
  private readonly position = new Vector3()
  private readonly direction = new Vector3()
  private readonly reference = new Quaternion()
  private readonly inverseBasis = new Quaternion()
  private readonly delta = new Quaternion()
  private readonly euler = new Euler(0, 0, 0, 'YXZ')
  private readonly origin = { x: 0, y: 0, z: 0 }

  constructor(pose: MMDBodyPose) {
    const { rig } = pose
    this.limits = toRigTraits(rig)
    const names = [rig.bones.leftEye, rig.bones.rightEye]
    if (rig.eyeSource === 'bothEyes')
      names.push('両目')
    this.eyes = names.flatMap((name) => {
      const bone = pose.bone(name)
      const index = name ? pose.indices.get(name) : undefined
      if (!bone || index === undefined)
        return []
      // Bind forward is measured in world axes, then expressed in eye-local
      // space. This also handles a rotated local eye frame.
      const forward = pose.forward.clone().transformDirection(pose.mmd.mesh.matrixWorld).applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert())
      const basis = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), forward)
      return [{ bone, index, basis }]
    })
  }

  /** Aims every eye at the world `point`, weighted by `weight` (0 keeps the clip's eyes); a null point leaves them clean. */
  apply(clean: MMDCleanPose, input: { point: Vector3 | null, weight: number }): void {
    for (const { bone, index, basis } of this.eyes) {
      bone.quaternion.copy(clean.quaternions[index])
      bone.updateWorldMatrix(true, false)
      if (!input.point)
        continue
      bone.getWorldPosition(this.position)
      this.reference.copy(bone.getWorldQuaternion(this.reference)).multiply(basis).invert()
      this.direction.copy(input.point).sub(this.position).applyQuaternion(this.reference)
      const { yaw, pitch } = aimEyes({ leftEye: this.origin, rightEye: this.origin }, this.direction, this.limits).leftEye
      this.delta.setFromEuler(this.euler.set(pitch * input.weight, yaw * input.weight, 0, 'YXZ'))
      this.delta.premultiply(basis).multiply(this.inverseBasis.copy(basis).invert())
      bone.quaternion.copy(clean.quaternions[index]).multiply(this.delta)
      bone.updateWorldMatrix(false, true)
    }
  }
}
