import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { MMDBodyPose } from '@proj-airi/stage-ui-mmd/composables/mmd/body/pose'
import type { MMDRigProfile } from '@proj-airi/stage-ui-mmd/composables/mmd/rig'
import type { Bone } from 'three'

import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'

export const CLAIM_CLIP_NAME = 'qa-right-arm-claim'

/** Plan 2.5: a raised pose with a 0.2 Hz, 3 degree sway; keys every 1/30 s so the mixer's slerp stays on the analytic pose. */
const SWAY = { hz: 0.2, deg: 3 }
const KEY_HZ = 30
const DEG = Math.PI / 180

/** The trace bones whose parent-relative rotation the ownership report checks against this clip's analytic pose. */
export const CLAIM_TRACE_BONES = [['rightShoulder', 'rightUpperArm'], ['rightUpperArm', 'rightLowerArm'], ['rightLowerArm', 'rightHand']] as const satisfies readonly (readonly [MotionTraceBone, MotionTraceBone])[]

interface Key {
  readonly axis: Vector3
  readonly degrees: number
  readonly sway: boolean
}

/**
 * A programmatic clip, never an asset, keyed on the rig's right shoulder, upper arm, elbow, wrist and right finger
 * bones, so its mask owns `rightArm` and `rightFingers`. Axes come from the bind segments: the upper arm rises toward
 * up by 40 degrees and sways, the shoulder by 5, the forearm folds toward forward by 60 degrees, the wrist by 10 and
 * every finger joint by 15. MMD bones bind with identity local rotations, so each key is the bone's local rotation.
 */
export class Motion3dClaimClip {
  readonly clip: AnimationClip
  private readonly keys = new Map<string, Key>()
  private readonly q = new Quaternion()

  constructor(private readonly pose: MMDBodyPose, private readonly rig: MMDRigProfile, seconds: number) {
    const position = (name: string | null | undefined) => {
      const bone = pose.bone(name)
      if (!bone)
        throw new TypeError(`The claim clip needs the rig bone ${name ?? '(unmapped)'}`)
      return pose.mmd.mesh.worldToLocal(bone.getWorldPosition(new Vector3()))
    }
    const { bones, fingerBones } = rig
    const arm = position(bones.rightLowerArm).sub(position(bones.rightUpperArm)).normalize()
    const forearm = position(bones.rightHand).sub(position(bones.rightLowerArm)).normalize()
    const raise = new Vector3().crossVectors(arm, pose.up).normalize()
    const fold = new Vector3().crossVectors(forearm, pose.forward).normalize()
    const add = (name: string | null | undefined, key: Key) => {
      if (name && pose.bone(name))
        this.keys.set(name, key)
    }
    add(bones.rightShoulder, { axis: raise, degrees: 5, sway: false })
    add(bones.rightUpperArm, { axis: raise, degrees: 40, sway: true })
    add(bones.rightLowerArm, { axis: fold, degrees: 60, sway: false })
    add(bones.rightHand, { axis: fold, degrees: 10, sway: false })
    for (const [slot, name] of Object.entries(fingerBones)) {
      if (slot.startsWith('right'))
        add(name, { axis: fold, degrees: 15, sway: false })
    }
    const times = Array.from({ length: Math.ceil(seconds * KEY_HZ) + 1 }, (_, i) => i / KEY_HZ)
    const tracks = [...this.keys.keys()].map((name) => {
      const values = times.flatMap(t => this.local(name, t, new Quaternion()).toArray())
      return new QuaternionKeyframeTrack(`.bones[${name}].quaternion`, times, values)
    })
    this.clip = new AnimationClip(CLAIM_CLIP_NAME, seconds, tracks)
  }

  /** The analytic local rotation of a rig bone at clip time `t`; identity for a bone the clip does not key. */
  local(name: string, t: number, out: Quaternion): Quaternion {
    const key = this.keys.get(name)
    if (!key)
      return out.identity()
    const degrees = key.degrees + (key.sway ? SWAY.deg * Math.sin(2 * Math.PI * SWAY.hz * t) : 0)
    return out.setFromAxisAngle(key.axis, degrees * DEG)
  }

  /**
   * The expected trace rotation of each `CLAIM_TRACE_BONES` child relative to its trace parent at clip time `t`: the
   * product of the analytic local rotations along the rig path between them, in the trace basis. Flattened xyzw.
   */
  expected(t: number, basis: Quaternion): number[] {
    return CLAIM_TRACE_BONES.flatMap(([parentSlot, childSlot]) => {
      const parent = this.pose.bone(this.rig.bones[parentSlot])
      let bone: Bone | null = this.pose.bone(this.rig.bones[childSlot]) ?? null
      const product = new Quaternion()
      while (bone && bone !== parent) {
        product.premultiply(this.local(bone.name, t, this.q))
        bone = bone.parent && 'isBone' in bone.parent ? bone.parent as Bone : null
      }
      return product.premultiply(basis).multiply(basis.clone().invert()).toArray()
    })
  }
}
