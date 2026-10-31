import type { MMD } from '@moeru/three-mmd'
import type { LookAtFrame } from '@proj-airi/motion-driver-humanoid/look-at'
import type { NaturalMotionFrame } from '@proj-airi/motion-driver-natural/natural-motion'
import type { AnimationClip } from 'three'

import type { MMDFrameContext, MMDFrameStage } from '../frame-pipeline'
import type { MMDRigProfile } from '../rig'

import { createLookAt } from '@proj-airi/motion-driver-humanoid/look-at'
import { composeWeightShift, createWeightShift } from '@proj-airi/motion-driver-humanoid/weight-shift'
import { Euler, Quaternion, Vector3 } from 'three'

import { fnv1a32 } from '../natural/seed'
import { toRigTraits } from '../rig'
import { MMDEyes } from './eyes'
import { MMDFootContact } from './feet'
import { MMDBodyPose } from './pose'

export interface MMDBodyInput {
  readonly enabled: boolean
  readonly frame: NaturalMotionFrame
  readonly target: Vector3 | null
  readonly disableFootContact: boolean
  readonly disableLookAt: boolean
}

/** Owns one model's body planners. The pipeline remains the only frame clock. */
export class MMDBody {
  readonly poseStages: MMDFrameStage[]
  readonly surfaceStage: MMDFrameStage
  private readonly pose: MMDBodyPose
  private readonly eyes: MMDEyes
  private readonly feet: MMDFootContact
  private readonly shift
  private readonly look
  private now = 0
  private duck = 1
  private roll = 0
  private facing = 0
  private turns = 0
  private offset = new Vector3()
  private input: MMDBodyInput | null = null
  private lookFrame: LookAtFrame
  private readonly upper = new Map<string, Quaternion>()
  private readonly clips = new Map<string, AnimationClip>()
  private feetSnapshot = { maxError: 0, errorL: 0, errorR: 0, contact: 0 }

  constructor(mmd: MMD, rig: MMDRigProfile, options: { modelKey: string, input: () => MMDBodyInput | null }) {
    this.pose = new MMDBodyPose(mmd, rig)
    this.eyes = new MMDEyes(this.pose)
    this.feet = new MMDFootContact(this.pose)
    this.shift = createWeightShift({ seed: fnv1a32(options.modelKey) })
    this.look = createLookAt(toRigTraits(rig))
    this.lookFrame = this.look.step({ targetYaw: 0, targetPitch: 0, facingYaw: 0 }, 0)
    this.poseStages = [
      { id: 'weight-shift', run: (context) => {
        this.input = options.input()
        if (this.input?.enabled)
          this.applyShift(context)
      } },
      { id: 'foot-contact', run: (context) => {
        if (!this.input?.enabled)
          return
        // Evaluate IK parent space with this frame's FINAL facing. Restore it
        // immediately: the look-at stage is the owner of the visible center yaw.
        const center = this.pose.bone(rig.hipsTranslation.center)
        const before = center?.quaternion.clone()
        this.applyFacing(context)
        this.feet.apply(context, {
          offset: this.offset,
          duck: this.duck,
          disabled: this.input.disableFootContact,
          look: this.lookFrame,
          now: this.now,
          clips: this.clips,
        })
        if (center && before) {
          center.quaternion.copy(before)
          center.updateWorldMatrix(false, true)
        }
      } },
      { id: 'look-at', run: context => this.applyLook(context) },
      { id: 'eyes', run: ({ clean, dt }) => {
        if (this.input?.enabled) {
          this.eyes.apply(clean, {
            target: this.input.disableLookAt ? null : this.input.target,
            frame: this.input.frame,
            dt,
            duck: this.duck,
          })
        }
      } },
    ]
    this.surfaceStage = { id: 'body-diagnostics', run: () => {
      if (this.input?.enabled)
        this.feetSnapshot = this.feet.measure()
    } }
  }

  registerClip(name: string, clip: AnimationClip): void {
    this.clips.set(name, clip)
  }

  private applyShift({ dt, clean }: MMDFrameContext): void {
    const input = this.input
    if (!input)
      return
    this.now += dt
    this.duck = 1 - Math.min(1, [...clean.clipWeights.values()].reduce((sum, weight) => sum + weight, 0))
    const { pose, breath } = input.frame
    this.roll += ((pose.bodyZ ?? 0) - this.roll) * (1 - Math.exp(-dt / 0.5))
    const rig = this.pose.rig
    const hip = this.pose.bone(rig.bones.leftUpperLeg ?? rig.bones.hips)
    const shift = this.shift.step({ now: this.now, hipY: hip ? this.pose.localPosition(hip).y : 0, duck: this.duck })
    const composed = composeWeightShift({
      weightShift: shift,
      naturalBodyX: -(pose.bodyY ?? 0) * this.duck,
      naturalBodyRoll: this.roll * this.duck,
      breath: (breath.value - 0.45) * 2 * this.duck,
    })
    this.offset = this.pose.right.clone().multiplyScalar(composed.pelvisLateral).addScaledVector(this.pose.forward, composed.pelvisForeAft).addScaledVector(this.pose.up, -composed.pelvisDrop)
    this.pose.translate(rig.hipsTranslation.groove ?? rig.hipsTranslation.center, clean, this.offset)
    this.pose.rotate(rig.bones.hips, clean, { pitch: 0, yaw: composed.lowerBodyYaw, roll: composed.lowerBodyRoll })
    for (const [name, pitch, roll, share] of [
      [rig.bones.spine, composed.spinePitch, composed.upperBodyRoll, 0.6],
      [rig.bones.chest, composed.chestPitch, composed.chestCounterRoll, 0.4],
    ] as const) {
      this.pose.rotate(name, clean, {
        pitch,
        yaw: (pose.bodyX ?? 0) * Math.PI / 18 * share * this.duck,
        roll: roll - (pose.bodyZ ?? 0) * Math.PI / 18 * share * this.duck,
      })
      const bone = this.pose.bone(name)
      if (bone)
        this.upper.set(bone.name, bone.quaternion.clone())
    }
    const target = input.disableLookAt ? null : input.target
    const head = this.pose.bone(rig.bones.head)
    let yaw = this.facing
    let pitch = 0
    if (target && head) {
      const direction = this.pose.mmd.mesh.worldToLocal(target.clone()).sub(this.pose.localPosition(head))
      yaw = Math.atan2(direction.dot(this.pose.right), direction.dot(this.pose.forward))
      pitch = Math.atan2(-direction.dot(this.pose.up), Math.hypot(direction.dot(this.pose.right), direction.dot(this.pose.forward)))
    }
    this.lookFrame = this.look.step({ targetYaw: yaw, targetPitch: pitch, facingYaw: this.facing }, dt)
    this.facing = this.lookFrame.facingYaw
    if (this.lookFrame.turnStarted)
      this.turns++
  }

  private applyFacing({ clean }: MMDFrameContext): void {
    const name = this.pose.rig.hipsTranslation.center
    const center = this.pose.bone(name)
    const index = name ? this.pose.indices.get(name) : undefined
    if (center && index !== undefined) {
      center.quaternion.copy(clean.quaternions[index])
      this.pose.premultiply(center, new Quaternion().setFromAxisAngle(this.pose.up, this.facing * this.duck))
    }
  }

  private applyLook(context: MMDFrameContext): void {
    const input = this.input
    if (!input?.enabled)
      return
    this.applyFacing(context)
    const active = input.target !== null && !input.disableLookAt
    const { pose } = input.frame
    for (const [name, share] of [[this.pose.rig.bones.neck, 0.4], [this.pose.rig.bones.head, 0.6]] as const) {
      const span = Math.PI / 6 * share * (active ? 0.5 : 1) * this.duck
      const clamp = (value: number) => Math.max(-1, Math.min(1, value))
      this.pose.rotate(name, context.clean, { pitch: -clamp(pose.headY) * span, yaw: clamp(pose.headX) * span, roll: -clamp(pose.headZ) * span })
    }
    for (const key of ['spine', 'chest', 'neck', 'head'] as const) {
      const bone = this.pose.bone(this.pose.rig.bones[key])
      if (!bone)
        continue
      const upper = this.upper.get(bone.name)
      if (upper)
        bone.quaternion.copy(upper)
      if (active) {
        const angles = this.lookFrame.rotations[key]
        const rotation = new Quaternion().setFromEuler(new Euler(angles.pitch * this.duck, angles.yaw * this.duck, 0, 'YXZ'))
        this.pose.premultiply(bone, rotation)
      }
    }
  }

  get diagnostics() {
    return {
      feet: this.feetSnapshot,
      lookAt: {
        target: this.input?.disableLookAt ? null : this.input?.target ?? null,
        yaw: this.lookFrame.rotations.head.yaw,
        pitch: this.lookFrame.rotations.head.pitch,
        turning: this.lookFrame.turning,
        turns: this.turns,
      },
    }
  }
}
