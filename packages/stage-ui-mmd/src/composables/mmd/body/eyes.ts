import type { NaturalMotionFrame } from '@proj-airi/motion-driver-natural/natural-motion'

import type { MMDCleanPose } from '../frame-pipeline'
import type { MMDBodyPose } from './pose'

import { aimEyes } from '@proj-airi/motion-driver-humanoid/look-at'
import { Euler, Quaternion, Vector3 } from 'three'

import { toRigTraits } from '../rig'

/** Closed-loop eye aim is evaluated after every head and body rotation. */
export class MMDEyes {
  private lowX = 0
  private lowY = 0
  private readonly eyes

  constructor(private readonly pose: MMDBodyPose) {
    const { rig } = pose
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

  apply(clean: MMDCleanPose, input: {
    target: Vector3 | null
    frame: NaturalMotionFrame
    dt: number
    duck: number
  }): void {
    const rate = 1 - Math.exp(-input.dt / 0.15)
    this.lowX += (input.frame.pose.eyeX - this.lowX) * rate
    this.lowY += (input.frame.pose.eyeY - this.lowY) * rate
    const traits = toRigTraits(this.pose.rig)
    for (const { bone, index, basis } of this.eyes) {
      bone.quaternion.copy(clean.quaternions[index])
      bone.updateWorldMatrix(true, false)
      const eye = bone.getWorldPosition(new Vector3())
      const reference = bone.getWorldQuaternion(new Quaternion()).multiply(basis)
      let yaw = input.frame.pose.eyeX * traits.eyeYawLimit
      let pitch = -input.frame.pose.eyeY * traits.eyePitchLimit
      if (input.target) {
        const direction = input.target.clone().sub(eye).applyQuaternion(reference.invert())
        const aim = aimEyes({ leftEye: { x: 0, y: 0, z: 0 }, rightEye: { x: 0, y: 0, z: 0 } }, direction, traits).leftEye
        yaw = aim.yaw + (input.frame.pose.eyeX - this.lowX) * traits.eyeYawLimit * 0.3
        pitch = aim.pitch - (input.frame.pose.eyeY - this.lowY) * traits.eyePitchLimit * 0.3
      }
      yaw = Math.max(-traits.eyeYawLimit, Math.min(traits.eyeYawLimit, yaw))
      pitch = Math.max(-traits.eyePitchLimit, Math.min(traits.eyePitchLimit, pitch))
      const delta = new Quaternion().setFromEuler(new Euler(pitch * input.duck, yaw * input.duck, 0, 'YXZ'))
      delta.premultiply(basis).multiply(basis.clone().invert())
      bone.quaternion.copy(clean.quaternions[index]).multiply(delta)
      bone.updateWorldMatrix(false, true)
    }
  }
}
