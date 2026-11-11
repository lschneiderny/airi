import type { MMDBodyPose } from '@proj-airi/stage-ui-mmd/composables/mmd/body/pose'
import type { SkinnedMesh } from 'three'

import { Quaternion, Vector3 } from 'three'

/** The scenario's point is anchored to bind head geometry, in the root's stance frame. */
export class Motion3dLookTarget {
  private readonly head: Vector3 | null
  private readonly distance: number

  constructor(private readonly mesh: SkinnedMesh, private readonly pose: MMDBodyPose) {
    const bind = (name: string | undefined) => {
      const index = name === undefined ? undefined : pose.indices.get(name)
      return index === undefined ? null : new Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[index].clone().invert())
    }
    this.head = bind(pose.rig.bones.head)
    const neck = bind(pose.rig.bones.neck)
    this.distance = this.head && neck ? this.head.distanceTo(neck) : 0
  }

  resolve(cursor: { x: number, y: number } | null) {
    if (!cursor || !this.head || this.distance <= 0)
      return null
    this.mesh.updateWorldMatrix(true, false)
    const head = this.head.clone().applyMatrix4(this.mesh.matrixWorld)
    const rotation = this.mesh.getWorldQuaternion(new Quaternion())
    const right = this.pose.right.clone().applyQuaternion(rotation)
    const up = this.pose.up.clone().applyQuaternion(rotation)
    const forward = this.pose.forward.clone().applyQuaternion(rotation)
    const yaw = Math.asin(cursor.x / 3)
    const pitch = Math.asin(cursor.y / 3)
    const target = head.clone()
      .addScaledVector(right, 9 * this.distance * Math.sin(yaw))
      .addScaledVector(up, 9 * this.distance * Math.sin(pitch))
      .addScaledVector(forward, 9 * this.distance * Math.cos(yaw) * Math.cos(pitch))
    const offset = target.clone().sub(head)
    return { target, cursor: { x: offset.dot(right) / (3 * this.distance), y: offset.dot(up) / (3 * this.distance) } }
  }
}
