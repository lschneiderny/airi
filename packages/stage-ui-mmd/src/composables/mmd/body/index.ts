import type { MMD } from '@moeru/three-mmd'
import type { ClipBoneMask, ClipMaskGroup } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { LocomotionFrame } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { BodyCapabilities, BodyGazeGoal, BodyPerformanceInput, BodyRigTraits } from '@proj-airi/motion-driver-humanoid/performance'
import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'
import type { NaturalBodyIntent, NaturalMotionFrame } from '@proj-airi/motion-driver-natural/frame-types'
import type { AnimationClip } from 'three'

import type { MMDCleanPose, MMDFrameContext, MMDFrameStage } from '../frame-pipeline'
import type { MMDRigProfile } from '../rig'
import type { MMDArmsMeasurement } from './arms'
import type { MMDBodyRoot, MMDLocomotionGoal } from './locomotion'
import type { MMDBodyEvent, MMDBodyWeights } from './performer'

import { BODY_CHANNELS, BODY_TICK, channelIndex } from '@proj-airi/motion-driver-humanoid/performance'
import { Quaternion, Vector3 } from 'three'

import { fnv1a32 } from '../natural/seed'
import { buildMMDClipMask, toRigTraits } from '../rig'
import { buildMMDArmTestColliders, buildMMDHeadColliders } from '../touch/colliders'
import { MMDArms } from './arms'
import { MMDBodyClock } from './clock'
import { MMDEyes } from './eyes'
import { MMDFootContact } from './feet'
import { MMDBodyIntent } from './intent'
import { MMDLocomotion, writeGaitChannels } from './locomotion'
import { MMDBodyPerformer } from './performer'
import { MMDBodyPose } from './pose'
import { buildBodyRigTraits } from './rig-traits'

export type { MMDBodyRoot, MMDLocomotionGoal } from './locomotion'
export type { MMDBodyEvent } from './performer'

export interface MMDBodyInput {
  readonly enabled: boolean
  /** True when the host moves the root through the `root` handle (stage mode). Without it the gait never leaves idle. */
  readonly rootMotion: boolean
  readonly frame: NaturalMotionFrame
  /** `controller.bodyIntent()` of the same Natural frame. */
  readonly intent: NaturalBodyIntent
  /** The host energy handed to Natural, 0-1. */
  readonly energy?: number
  /** The director's stance; standing when absent. */
  readonly stance?: BodyIntent['stance']
  /** The sustained gaze point in world space: the camera, the chat, or the director's attention point. */
  readonly target: Vector3 | null
  readonly disableFootContact: boolean
  /** QA switch: the head, neck and eyes keep the clip pose and the gaze point is cleared. */
  readonly disableLookAt: boolean
  /** Looping base clips. They duck the body fully but keep half of the head's gaze. */
  readonly stanceClips: ReadonlySet<string>
  /** Debug override of the arm rest hang angle in degrees below horizontal (0-90); null or absent keeps the default. */
  readonly armRestHangDeg?: number | null
  /** The user drags the character. */
  readonly dragging: boolean
  /** The clip the animation manager reports on its layer (`snapshot().layer.name`); `performing()` reads its weight. */
  readonly layerClip?: string | null
  /**
   * The director's full-layer action is in its `playing` phase. It owns root and leg IK from that frame on, because the
   * clip's weight is still 0 on the frame the manager creates the layer.
   */
  readonly fullLayerPlaying?: boolean
}

export interface MMDRegisterClipOptions {
  /** Groups the clip owns even though its mask keyed none of their bones, so a full-body action stops the gait. */
  readonly forceGroups?: readonly ClipMaskGroup[]
}

const OWNERSHIP_GROUPS: readonly ClipMaskGroup[] = ['root', 'leftLegIk', 'rightLegIk', 'lowerBody', 'leftArm', 'rightArm', 'leftFingers', 'rightFingers', 'upperBody', 'head']

export type MMDBodyOwnership = Readonly<Record<ClipMaskGroup, number>>

/** Share of the head and neck gaze kept under a fully weighted stance clip. */
export const STANCE_HEAD_ATTENTION = 0.5

/** Time constant over which a turned hip yaw hands facing over to the root once the gait leaves idle. */
const FACING_HANDOFF = 0.1
/** A free fixation of one Natural gaze unit is 20 degrees of visual angle. */
const FIXATION_SPAN = 20 * Math.PI / 180
/** Walking looks along the travel direction, slightly down. */
const TRAVEL_PITCH = 5 * Math.PI / 180
const ABDUCT = { left: channelIndex('leftAbduct'), right: channelIndex('rightAbduct') } as const

/** Owns one model's body: ownership, the 120 Hz clock, the gait and the performer, and the stages that pose them. */
export class MMDBody {
  readonly poseStages: MMDFrameStage[]
  readonly surfaceStage: MMDFrameStage
  readonly traits: BodyRigTraits | null
  private readonly pose: MMDBodyPose
  private readonly eyes: MMDEyes
  private readonly feet: MMDFootContact
  private readonly locomotion: MMDLocomotion | null
  private readonly performer: MMDBodyPerformer | null
  private readonly arms: MMDArms
  private readonly clock = new MMDBodyClock()
  private readonly intent = new MMDBodyIntent()
  private readonly listeners = new Set<(event: MMDBodyEvent) => void>()
  private readonly masks = new Map<string, ClipBoneMask>()
  private readonly owned: Record<ClipMaskGroup, number> = { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 }
  /** Ownership by non-stance clips only. Stance clips reduce foot contact through their foot-IK tracks instead. */
  private readonly oneShotOwned: Record<ClipMaskGroup, number> = { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 }
  private readonly weights: MMDBodyWeights = { pelvis: 0, hips: 0, torso: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
  private stanceWeight = 0
  private facingWeight = 0
  private contactDuck = 1
  private readonly clipWeights = new Map<string, number>()
  private armsSnapshot: MMDArmsMeasurement | null = null
  private readonly root: MMDBodyRoot | undefined
  private goal: MMDLocomotionGoal | null = null
  private gait: LocomotionFrame | null = null
  private readonly gaitEvents: LocomotionFrame['events'][number][] = []
  private readonly gaitChannels = new Float64Array(BODY_CHANNELS.length)
  private readonly gaitInput: { weight: number, support: number, mode: LocomotionFrame['mode'], channels: Float64Array } = { weight: 0, support: 0, mode: 'idle', channels: this.gaitChannels }
  private gaitEnabled = false
  private rootX = 0
  private rootYaw = 0
  private readonly rootPosition = new Vector3()
  private readonly rootVelocity = { x: 0, y: 0, z: 0 }
  private support = 0
  private skate = 0
  private facing = 0
  private turns = 0
  private turning = false
  private headYaw = 0
  private offset = new Vector3()
  private input: MMDBodyInput | null = null
  private readonly clips = new Map<string, AnimationClip>()
  private feetSnapshot = { maxError: 0, errorL: 0, errorR: 0, contact: 0 }
  private readonly gazeGoal = { yaw: 0, pitch: 0, kind: 'free' as BodyGazeGoal['kind'] }
  /** Mesh-local start and length of the gaze line; the eyes aim at its far end. */
  private readonly gazeOrigin = new Vector3()
  private gazeDistance = 0
  private readonly gazePoint = new Vector3()
  private readonly scratch = new Vector3()
  private gazeTarget: Vector3 | null = null

  constructor(mmd: MMD, rig: MMDRigProfile, options: { modelKey: string, input: () => MMDBodyInput | null, root?: MMDBodyRoot }) {
    this.pose = new MMDBodyPose(mmd, rig)
    this.eyes = new MMDEyes(this.pose)
    this.feet = new MMDFootContact(this.pose)
    const legs = this.feet.bindLegs
    this.locomotion = legs ? new MMDLocomotion(legs, toRigTraits(rig), fnv1a32(`${options.modelKey}:locomotion`)) : null
    if (this.locomotion)
      this.rootPosition.copy(this.locomotion.frame.root.position)
    this.root = options.root
    const { skeleton, bindMatrix } = mmd.mesh
    const colliders = buildMMDArmTestColliders(mmd.pmx, skeleton.boneInverses, bindMatrix, rig)
    const head = buildMMDHeadColliders(mmd.pmx, skeleton.boneInverses, bindMatrix, rig)
    this.arms = new MMDArms(this.pose, colliders, head)
    this.traits = buildBodyRigTraits(mmd.pmx, rig, [...colliders.kinematic, ...head], { boneInverses: skeleton.boneInverses, bindMatrix })
    this.performer = this.traits
      ? new MMDBodyPerformer(this.pose, this.traits, { seed: fnv1a32(options.modelKey), onEvent: event => this.listeners.forEach(listener => listener(event)) })
      : null
    this.poseStages = [
      // Root motion lands before every bone write and before physics, so the pose and Ammo both see this frame's root.
      { id: 'locomotion', run: (context) => {
        this.input = options.input()
        this.updateOwnership(context.clean.clipWeights)
        if (this.input?.enabled)
          this.advance(context)
      } },
      { id: 'body-torso', run: ({ clean }) => {
        this.offset.set(0, 0, 0)
        if (this.input?.enabled && this.performer)
          this.offset.copy(this.performer.applyTorso(clean, this.weights))
      } },
      { id: 'foot-contact', run: (context) => {
        if (!this.input?.enabled)
          return
        // Evaluate IK parent space with this frame's FINAL facing. Restore it
        // immediately: the head stage is the owner of the visible center yaw.
        const center = this.pose.bone(rig.hipsTranslation.center)
        const before = center?.quaternion.clone()
        this.applyFacing(context.clean)
        this.feet.apply(context, {
          offset: this.offset,
          duck: 1 - this.weights.pelvis,
          contactDuck: this.contactDuck,
          disabled: this.input.disableFootContact,
          turnSteps: this.performer?.turnSteps ?? [],
          now: this.clock.time,
          clips: this.clips,
          root: { x: this.rootX, yaw: this.rootYaw },
          gait: this.gait && this.gait.weight > 0 ? this.gait.feet : null,
        })
        if (center && before) {
          center.quaternion.copy(before)
          center.updateWorldMatrix(false, true)
        }
      } },
      { id: 'body-head', run: ({ clean }) => {
        if (!this.input?.enabled)
          return
        this.applyFacing(clean)
        if (this.performer && !this.input.disableLookAt)
          this.headYaw = this.performer.applyHead(clean, this.weights.head)
      } },
      { id: 'body-arms', run: ({ clean }) => {
        if (this.input?.enabled && this.performer)
          this.performer.applyArms(clean, this.weights)
      } },
      { id: 'eyes', run: ({ clean }) => {
        if (this.input?.enabled)
          this.eyes.apply(clean, { point: this.input.disableLookAt ? null : this.resolveGazePoint(), weight: 1 - this.weights.head })
      } },
    ]
    this.surfaceStage = { id: 'body-diagnostics', run: () => {
      if (!this.input?.enabled)
        return
      const { skate, ...feet } = this.feet.measure()
      this.feetSnapshot = feet
      this.skate = skate
      this.armsSnapshot = this.arms.measure(this.owned, this.performer?.diagnostics.correctionDeg ?? { left: 0, right: 0 })
    } }
  }

  /** Body events (`blink`, `gaze-shift`) as the performer plans them, on the frame's tick. Returns the unsubscribe. */
  onEvent(listener: (event: MMDBodyEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Body lid closure [0, 1]; the face shows `max(Natural's closure, lidClose)`. */
  get lidClose(): number {
    return this.performer?.lidClose ?? 0
  }

  get capabilities(): BodyCapabilities | null {
    return this.performer?.capabilities ?? null
  }

  /** Turns one performance layer on or off for tuning; the stack eases it in or out. */
  setPerformanceLayer(layer: string, enabled: boolean): void {
    this.performer?.setLayerEnabled(layer, enabled)
  }

  /**
   * Rewinds the performer and its clock with a fresh Natural controller, so event timestamps and performer time share
   * one origin. The root, the gait and the planted feet stay where they are.
   */
  resetPerformance(): void {
    this.performer?.reset()
    this.clock.reset()
    this.intent.reset()
  }

  /** World positions of bones with the arms in the standing rest pose; see `MMDArms.restPositions`. */
  restPositions(clean: MMDCleanPose, names: readonly string[]): Map<string, [number, number, number]> {
    const performer = this.performer
    return this.arms.restPositions(names, () => {
      if (!performer)
        return
      const rest = performer.restChannels()
      const lift = this.arms.lift({ swingWeight: 1, owned: { leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }, hangDeg: null })
      rest[ABDUCT.left] += lift.left
      rest[ABDUCT.right] += lift.right
      performer.applyArms(clean, { pelvis: 0, hips: 0, torso: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }, rest)
    })
  }

  registerClip(name: string, clip: AnimationClip, options: MMDRegisterClipOptions = {}): void {
    this.clips.set(name, clip)
    const mask = buildMMDClipMask(clip, this.pose.rig)
    const groups = { ...mask.groups }
    for (const group of options.forceGroups ?? [])
      groups[group] = true
    this.masks.set(name, { ...mask, groups })
  }

  /**
   * How much of each bone group the playing clips own this frame, `min(1, sum(weight * mask))`. A playing clip that was
   * never registered with the body owns every group, so unknown motion still stops the gait.
   */
  ownership(): MMDBodyOwnership {
    return this.owned
  }

  /**
   * The clip on the manager's layer and its captured weight this frame, or null when no layer clip has weight.
   * The weight returns to 0 once the layer has eased out and been torn down.
   */
  performing(): { name: string, weight: number } | null {
    const name = this.input?.layerClip
    const weight = name ? this.clipWeights.get(name) ?? 0 : 0
    return name && weight > 0 ? { name, weight } : null
  }

  /** The only reader of raw clip weights in the body; every duck term is derived from the ownership it records. */
  private updateOwnership(weights: ReadonlyMap<string, number>): void {
    for (const group of OWNERSHIP_GROUPS) {
      this.owned[group] = 0
      this.oneShotOwned[group] = 0
    }
    this.stanceWeight = 0
    this.clipWeights.clear()
    const stanceClips = this.input?.stanceClips
    for (const [name, weight] of weights) {
      if (!(weight > 0))
        continue
      this.clipWeights.set(name, weight)
      const stance = stanceClips?.has(name) ?? false
      if (stance)
        this.stanceWeight += weight
      const mask = this.masks.get(name)
      for (const group of OWNERSHIP_GROUPS) {
        if (!mask || mask.groups[group]) {
          this.owned[group] += weight
          if (!stance)
            this.oneShotOwned[group] += weight
        }
      }
    }
    for (const group of OWNERSHIP_GROUPS) {
      this.owned[group] = Math.min(1, this.owned[group])
      this.oneShotOwned[group] = Math.min(1, this.oneShotOwned[group])
    }
    this.stanceWeight = Math.min(1, this.stanceWeight)
    // Each written group blends toward the clip once, in the performer. Stance clips duck the whole body but leave the
    // head half its gaze; a gesture that owns only an arm or the fingers keeps breath, sway and planted feet.
    const { owned, oneShotOwned: oneShot, stanceWeight: stance } = this
    this.weights.pelvis = Math.max(stance, owned.root, owned.lowerBody)
    this.weights.hips = Math.max(stance, owned.lowerBody)
    this.weights.torso = Math.max(stance, owned.upperBody)
    this.weights.head = Math.min(1, oneShot.head + stance * (1 - STANCE_HEAD_ATTENTION))
    this.weights.leftArm = owned.leftArm
    this.weights.rightArm = owned.rightArm
    this.weights.leftFingers = owned.leftFingers
    this.weights.rightFingers = owned.rightFingers
    this.facingWeight = Math.max(stance, owned.root)
    // Planner duck: one-shots only. Stance clips reduce contact through their foot-IK tracks.
    this.contactDuck = 1 - Math.max(oneShot.root, oneShot.leftLegIk, oneShot.rightLegIk, oneShot.lowerBody)
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
    this.locomotion?.rebase(x, yaw, this.clock.time)
    this.gait = this.locomotion?.frame ?? null
    if (this.gait)
      this.rootPosition.copy(this.gait.root.position)
    this.feet.rebase({ x, yaw })
  }

  /** The latest gait frame with every gait event of this display frame. */
  get locomotionFrame(): LocomotionFrame | null {
    return this.gait
  }

  /** Runs this display frame's ticks: the gait first, then the performer with that tick's gait frame. */
  private advance({ dt }: MMDFrameContext): void {
    const input = this.input
    if (!input)
      return
    // A clip that keys the root or a leg IK bone owns the body's travel and stops the gait. Clips that animate only
    // arms, fingers or the head, such as an idle-slot VMD, leave walking on.
    const { root, leftLegIk, rightLegIk } = this.owned
    this.gaitEnabled = input.rootMotion && this.root !== undefined && root === 0 && leftLegIk === 0 && rightLegIk === 0 && !input.fullLayerPlaying
    if (!this.gaitEnabled)
      this.goal = null
    const due = this.clock.advance(dt)
    const first = this.clock.ticks - due
    const lift = this.arms.lift({ swingWeight: this.gait?.weight ?? 0, owned: this.owned, hangDeg: input.armRestHangDeg ?? null })
    this.resolveGaze(input)
    this.intent.capture({
      intent: input.intent,
      frame: input.frame,
      dt,
      gaze: this.gazeGoal,
      energy: input.energy ?? 0.5,
      stance: input.stance ?? 'stand',
      dragging: input.dragging,
      owned: this.owned,
      armLift: lift,
      eyeLimits: { yaw: this.performer?.traits.eyeYawLimit ?? 0, pitch: this.performer?.traits.eyePitchLimit ?? 0 },
    })
    this.performer?.beginFrame()
    this.gaitEvents.length = 0
    const plantedFeet = this.feet.anchors()
    for (let k = 0; k < due; k++) {
      let gait: BodyPerformanceInput['gait'] = null
      if (this.locomotion) {
        const frame = this.locomotion.tick({
          now: (first + k + 1) * BODY_TICK,
          goalX: this.goal?.goalX ?? null,
          pace: this.goal?.pace ?? 'walk',
          arriveFacing: this.goal?.arriveFacing ?? 0,
          enabled: this.gaitEnabled,
          idleSupport: this.support,
          plantedFeet,
        })
        this.gaitEvents.push(...frame.events)
        this.measureRootVelocity(frame)
        writeGaitChannels(frame, this.performer?.traits.legLength ?? 1, this.gaitChannels)
        this.gaitInput.weight = frame.weight
        this.gaitInput.support = frame.support
        this.gaitInput.mode = frame.mode
        gait = this.gaitInput
        this.gait = frame
      }
      // While the gait moves it owns facing through the root, so the hip yaw hands over and no turn is planned.
      const moving = this.gait !== null && this.gait.mode !== 'idle'
      if (moving)
        this.facing *= Math.exp(-BODY_TICK / FACING_HANDOFF)
      if (!this.performer)
        continue
      this.performer.step(this.intent.tick({ alpha: (k + 1) / due, facingYaw: this.facing, allowTurn: !moving, rootVelocity: this.rootVelocity, gait }))
      const frame = this.performer.frame
      if (!frame)
        continue
      this.support = frame.support
      if (!moving)
        this.facing = frame.facingYaw
      this.turning = frame.turning
      if (frame.turnStarted)
        this.turns++
    }
    this.performer?.sample(this.clock.fraction)
    if (this.gait)
      this.gait = { ...this.gait, events: [...this.gaitEvents] }
    const gait = this.gait
    if (!gait || (gait.root.position.x === this.rootX && gait.root.yaw === this.rootYaw))
      return
    this.rootX = gait.root.position.x
    this.rootYaw = gait.root.yaw
    this.root?.setPose(this.rootX, this.rootYaw)
    this.pose.mmd.mesh.updateWorldMatrix(true, true)
  }

  /** Root velocity in stance axes, model units per second; it swings the arms and never moves the root. */
  private measureRootVelocity(frame: LocomotionFrame): void {
    const { position, yaw } = frame.root
    const dx = (position.x - this.rootPosition.x) / BODY_TICK
    const dz = (position.z - this.rootPosition.z) / BODY_TICK
    this.rootVelocity.x = Math.cos(yaw) * dx - Math.sin(yaw) * dz
    this.rootVelocity.y = (position.y - this.rootPosition.y) / BODY_TICK
    this.rootVelocity.z = Math.sin(yaw) * dx + Math.cos(yaw) * dz
    this.rootPosition.copy(position)
  }

  /**
   * The gaze goal in the stance frame (mesh-local, so facing is the hip yaw on the center bone): the travel direction
   * while walking, the sustained target when the host has one, otherwise Natural's free fixation around the facing.
   */
  private resolveGaze(input: MMDBodyInput): void {
    const { pose } = this
    const head = pose.bone(pose.rig.bones.head)
    if (head)
      this.gazeOrigin.copy(pose.mmd.mesh.worldToLocal(head.getWorldPosition(this.gazeOrigin)))
    const far = 100 * (this.performer?.traits.legLength ?? 10)
    this.gazeTarget = input.disableLookAt ? null : input.target
    const moving = this.gait !== null && this.gait.mode !== 'idle' && this.gait.mode !== 'stopping'
    if (moving) {
      this.gazeGoal.yaw = 0
      this.gazeGoal.pitch = TRAVEL_PITCH
      this.gazeGoal.kind = 'travel'
      this.gazeDistance = far
      return
    }
    if (this.gazeTarget) {
      const d = pose.mmd.mesh.worldToLocal(this.scratch.copy(this.gazeTarget)).sub(this.gazeOrigin)
      const right = d.dot(pose.right)
      const forward = d.dot(pose.forward)
      this.gazeGoal.yaw = Math.atan2(right, forward)
      this.gazeGoal.pitch = Math.atan2(-d.dot(pose.up), Math.hypot(right, forward))
      this.gazeGoal.kind = 'sustained'
      this.gazeDistance = d.length()
      return
    }
    const { fixation } = input.frame
    this.gazeGoal.yaw = this.facing + FIXATION_SPAN * fixation.x
    this.gazeGoal.pitch = -FIXATION_SPAN * fixation.y
    this.gazeGoal.kind = 'free'
    this.gazeDistance = far
  }

  /** The far end of the displayed gaze line in world space; without a performer, the sustained target itself. */
  private resolveGazePoint(): Vector3 | null {
    if (!this.performer)
      return this.gazeTarget
    const { yaw, pitch } = this.performer.gazeLine
    const { right, up, forward } = this.pose
    this.gazePoint.copy(this.gazeOrigin)
      .addScaledVector(right, Math.sin(yaw) * Math.cos(pitch) * this.gazeDistance)
      .addScaledVector(up, -Math.sin(pitch) * this.gazeDistance)
      .addScaledVector(forward, Math.cos(yaw) * Math.cos(pitch) * this.gazeDistance)
    return this.pose.mmd.mesh.localToWorld(this.gazePoint)
  }

  private applyFacing(clean: MMDCleanPose): void {
    const name = this.pose.rig.hipsTranslation.center
    const center = this.pose.bone(name)
    const index = name ? this.pose.indices.get(name) : undefined
    if (center && index !== undefined) {
      center.quaternion.copy(clean.quaternions[index])
      this.pose.premultiply(center, new Quaternion().setFromAxisAngle(this.pose.up, this.facing * (1 - this.facingWeight)))
    }
  }

  get diagnostics() {
    const performer = this.performer
    return {
      feet: this.feetSnapshot,
      lookAt: {
        target: this.gazeTarget,
        yaw: this.headYaw,
        pitch: performer ? performer.channel(16) + performer.channel(19) : 0,
        turning: this.turning,
        turns: this.turns,
      },
      arms: this.armsSnapshot,
      performance: performer
        ? { ...performer.diagnostics, gaze: { ...performer.diagnostics.gaze, kind: this.gazeGoal.kind } }
        : null,
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
