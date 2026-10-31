import type { MMD } from '@moeru/three-mmd'
import type { LocomotionFrame } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { LookAtFrame } from '@proj-airi/motion-driver-humanoid/look-at'
import type { NaturalMotionFrame } from '@proj-airi/motion-driver-natural/natural-motion'
import type { AnimationClip } from 'three'

import type { MMDFrameContext, MMDFrameStage } from '../frame-pipeline'
import type { MMDRigProfile } from '../rig'
import type { MMDBodyRoot, MMDLocomotionGoal } from './locomotion'

import { createLookAt } from '@proj-airi/motion-driver-humanoid/look-at'
import { composeWeightShift, createWeightShift } from '@proj-airi/motion-driver-humanoid/weight-shift'
import { Euler, Quaternion, Vector3 } from 'three'

import { fnv1a32 } from '../natural/seed'
import { toRigTraits } from '../rig'
import { MMDEyes } from './eyes'
import { MMDFootContact } from './feet'
import { blendBodyComposition, MMDLocomotion } from './locomotion'
import { MMDBodyPose } from './pose'

export type { MMDBodyRoot, MMDLocomotionGoal } from './locomotion'

export interface MMDBodyInput {
  readonly enabled: boolean
  /** True when the host moves the root through the `root` handle (stage mode). Without it the gait never leaves idle. */
  readonly rootMotion: boolean
  readonly frame: NaturalMotionFrame
  readonly target: Vector3 | null
  readonly disableFootContact: boolean
  readonly disableLookAt: boolean
  /** Looping base clips. They duck the body fully but keep half of the head's look-at. */
  readonly stanceClips: ReadonlySet<string>
}

/** Share of the head and neck look-at kept under a fully weighted stance clip. */
export const STANCE_HEAD_ATTENTION = 0.5

/** Time constant over which a look-at hip yaw hands facing over to the root once the gait leaves idle. */
const FACING_HANDOFF = 0.1

/** Owns one model's body planners. The pipeline remains the only frame clock. */
export class MMDBody {
  readonly poseStages: MMDFrameStage[]
  readonly surfaceStage: MMDFrameStage
  private readonly pose: MMDBodyPose
  private readonly eyes: MMDEyes
  private readonly feet: MMDFootContact
  private readonly shift
  private readonly look
  private readonly locomotion: MMDLocomotion | null
  private readonly root: MMDBodyRoot | undefined
  private goal: MMDLocomotionGoal | null = null
  private gait: LocomotionFrame | null = null
  private gaitEnabled = false
  private rootX = 0
  private rootYaw = 0
  private support = 0
  private skate = 0
  private now = 0
  private duck = 1
  private attention = 1
  private contactDuck = 1
  private roll = 0
  private facing = 0
  private turns = 0
  private offset = new Vector3()
  private input: MMDBodyInput | null = null
  private lookFrame: LookAtFrame
  private readonly upper = new Map<string, Quaternion>()
  private readonly clips = new Map<string, AnimationClip>()
  private feetSnapshot = { maxError: 0, errorL: 0, errorR: 0, contact: 0 }

  constructor(mmd: MMD, rig: MMDRigProfile, options: { modelKey: string, input: () => MMDBodyInput | null, root?: MMDBodyRoot }) {
    this.pose = new MMDBodyPose(mmd, rig)
    this.eyes = new MMDEyes(this.pose)
    this.feet = new MMDFootContact(this.pose)
    this.shift = createWeightShift({ seed: fnv1a32(options.modelKey) })
    this.look = createLookAt(toRigTraits(rig))
    this.lookFrame = this.look.step({ targetYaw: 0, targetPitch: 0, facingYaw: 0 }, 0)
    const legs = this.feet.bindLegs
    this.locomotion = legs ? new MMDLocomotion(legs, toRigTraits(rig), fnv1a32(`${options.modelKey}:locomotion`)) : null
    this.root = options.root
    this.poseStages = [
      // Root motion lands before every bone write and before physics, so the pose and Ammo both see this frame's root.
      { id: 'locomotion', run: (context) => {
        this.input = options.input()
        if (this.input?.enabled)
          this.applyLocomotion(context)
      } },
      { id: 'weight-shift', run: (context) => {
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
          contactDuck: this.contactDuck,
          disabled: this.input.disableFootContact,
          look: this.lookFrame,
          now: this.now,
          clips: this.clips,
          root: { x: this.rootX, yaw: this.rootYaw },
          gait: this.gait && this.gait.weight > 0 ? this.gait.feet : null,
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
      if (!this.input?.enabled)
        return
      const { skate, ...feet } = this.feet.measure()
      this.feetSnapshot = feet
      this.skate = skate
    } }
  }

  registerClip(name: string, clip: AnimationClip): void {
    this.clips.set(name, clip)
  }

  /** The single entry point for walk goals. A goal set while a clip plays is dropped, not deferred. */
  setLocomotionGoal(goal: MMDLocomotionGoal | null): void {
    this.goal = goal
  }

  /**
   * The host has put the root at `x` (a drag or a teleport). The gait returns to idle there, both feet re-plant beside
   * the new root and the goal is cleared, so the next gait frame never undoes the move. Physics is the host's call.
   */
  rebase(x: number, yaw = this.rootYaw): void {
    this.goal = null
    this.rootX = x
    this.rootYaw = yaw
    this.locomotion?.rebase(x, yaw)
    this.gait = this.locomotion?.frame ?? null
    this.feet.rebase({ x, yaw })
  }

  /** The latest gait frame; todo 11's arm stage reads `armSwing` and `weight` from it. */
  get locomotionFrame(): LocomotionFrame | null {
    return this.gait
  }

  private applyLocomotion({ dt, clean }: MMDFrameContext): void {
    const input = this.input
    if (!input || !this.locomotion)
      return
    // Every playing clip is a stance clip or a one-shot, and both stop the gait; clips that key the root or a leg IK
    // bone are among them. Todo 11 replaces this with the body's per-group ownership.
    const clipPlaying = [...clean.clipWeights.values()].some(weight => weight > 0)
    this.gaitEnabled = input.rootMotion && this.root !== undefined && !clipPlaying
    if (!this.gaitEnabled)
      this.goal = null
    this.gait = this.locomotion.step(dt, {
      goalX: this.goal?.goalX ?? null,
      pace: this.goal?.pace ?? 'walk',
      arriveFacing: this.goal?.arriveFacing ?? 0,
      enabled: this.gaitEnabled,
      idleSupport: this.support,
      plantedFeet: this.feet.anchors(),
    })
    const { position, yaw } = this.gait.root
    if (position.x === this.rootX && yaw === this.rootYaw)
      return
    this.rootX = position.x
    this.rootYaw = yaw
    this.root?.setPose(position.x, yaw)
    this.pose.mmd.mesh.updateWorldMatrix(true, true)
  }

  private applyShift({ dt, clean }: MMDFrameContext): void {
    const input = this.input
    if (!input)
      return
    this.now += dt
    let stanceWeight = 0
    let otherWeight = 0
    for (const [name, weight] of clean.clipWeights) {
      if (input.stanceClips.has(name))
        stanceWeight += weight
      else
        otherWeight += weight
    }
    this.duck = 1 - Math.min(1, stanceWeight + otherWeight)
    this.attention = 1 - Math.min(1, otherWeight + stanceWeight * (1 - STANCE_HEAD_ATTENTION))
    this.contactDuck = 1 - Math.min(1, otherWeight)
    const { pose, breath } = input.frame
    this.roll += ((pose.bodyZ ?? 0) - this.roll) * (1 - Math.exp(-dt / 0.5))
    const rig = this.pose.rig
    const hip = this.pose.bone(rig.bones.leftUpperLeg ?? rig.bones.hips)
    const gait = this.gait
    const walk = (gait?.weight ?? 0) * this.duck
    const shift = this.shift.step({ now: this.now, hipY: hip ? this.pose.localPosition(hip).y : 0, duck: this.duck * (1 - walk) })
    this.support = shift.s
    const idle = composeWeightShift({
      weightShift: shift,
      naturalBodyX: -(pose.bodyY ?? 0) * this.duck,
      naturalBodyRoll: this.roll * this.duck,
      breath: (breath.value - 0.45) * 2 * this.duck,
    })
    const composed = gait ? blendBodyComposition(idle, gait.body, walk) : idle
    this.offset = this.pose.right.clone().multiplyScalar(composed.pelvisLateral).addScaledVector(this.pose.forward, composed.pelvisForeAft).addScaledVector(this.pose.up, -composed.pelvisDrop)
    this.pose.translate(rig.hipsTranslation.groove ?? rig.hipsTranslation.center, clean, this.offset)
    this.pose.rotate(rig.bones.hips, clean, { pitch: 0, yaw: composed.lowerBodyYaw, roll: composed.lowerBodyRoll })
    for (const [name, pitch, roll, share, counterYaw] of [
      [rig.bones.spine, composed.spinePitch, composed.upperBodyRoll, 0.6, 0],
      [rig.bones.chest, composed.chestPitch, composed.chestCounterRoll, 0.4, (gait?.body.chestCounterYaw ?? 0) * walk],
    ] as const) {
      this.pose.rotate(name, clean, {
        pitch,
        yaw: (pose.bodyX ?? 0) * Math.PI / 18 * share * this.duck + counterYaw,
        roll: roll - (pose.bodyZ ?? 0) * Math.PI / 18 * share * this.duck,
      })
      const bone = this.pose.bone(name)
      if (bone)
        this.upper.set(bone.name, bone.quaternion.clone())
    }
    // Look-at works in the stance frame: the root's yaw plus the hip yaw. While the gait moves, it owns facing
    // through the root, so look-at may not step and the hip yaw fades out.
    const moving = gait !== null && gait.mode !== 'idle'
    const facing = moving ? this.rootYaw : this.rootYaw + this.facing
    const target = input.disableLookAt ? null : input.target
    const head = this.pose.bone(rig.bones.head)
    let yaw = facing
    let pitch = 0
    if (target && head) {
      const direction = this.pose.mmd.mesh.worldToLocal(target.clone()).sub(this.pose.localPosition(head))
      yaw = this.rootYaw + Math.atan2(direction.dot(this.pose.right), direction.dot(this.pose.forward))
      pitch = Math.atan2(-direction.dot(this.pose.up), Math.hypot(direction.dot(this.pose.right), direction.dot(this.pose.forward)))
    }
    this.lookFrame = this.look.step({ targetYaw: yaw, targetPitch: pitch, facingYaw: facing, allowTurn: !moving }, dt)
    if (moving)
      this.facing *= Math.exp(-dt / FACING_HANDOFF)
    else
      this.facing = this.lookFrame.facingYaw - this.rootYaw
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
        const scale = key === 'neck' || key === 'head' ? this.attention : this.duck
        const rotation = new Quaternion().setFromEuler(new Euler(angles.pitch * scale, angles.yaw * scale, 0, 'YXZ'))
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
      locomotion: this.gait && this.locomotion
        ? {
            mode: this.gait.mode,
            position: { x: this.gait.root.position.x, z: this.gait.root.position.z },
            yaw: this.gait.root.yaw,
            goalX: this.goal?.goalX ?? null,
            reason: this.goal?.reason ?? null,
            pace: this.goal?.pace ?? null,
            speed: this.gait.speed,
            phase: this.gait.phase,
            weight: this.gait.weight,
            skate: this.skate,
            leashClamps: this.locomotion.leashClamps,
            enabled: this.gaitEnabled,
          }
        : null,
    }
  }
}
