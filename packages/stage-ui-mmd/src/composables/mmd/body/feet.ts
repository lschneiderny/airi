import type { Foot, FootAnchor, LegGeometry } from '@proj-airi/motion-driver-humanoid/foot-contact'
import type { FootGeometry, LocomotionFoot } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { TurnStep } from '@proj-airi/motion-driver-humanoid/look-at'
import type { BodyFootStep } from '@proj-airi/motion-driver-humanoid/performance'
import type { AnimationClip, Bone, Matrix4 } from 'three'

import type { MMDFrameContext } from '../frame-pipeline'
import type { MMDBodyPose } from './pose'

import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
import { Euler, Quaternion, Vector3 } from 'three'

import { toRigTraits } from '../rig'

const sides = ['left', 'right'] as const
/** The axis that turns the gait foot frame's forward (+Z) toward up (+Y). */
const FOOT_LATERAL = new Vector3(-1, 0, 0)

/**
 * Which ground contact a carried foot pivots about (owner decision O6): the solved ankle while flat, or the rig's heel or
 * ball point. Only the kind is the performer's report; the points come from the rig (`MMDFootContact`).
 */
export type MMDFootPivot = 'flat' | 'heel' | 'ball'

/**
 * The rig's heel and ball points in the ankle bone's local frame, read from the bind skeleton: the ball is the toe bone
 * (つま先, the rig traits' `feet[side].toe`), the heel lies under the ankle at the toe bone's height (PMX has no heel
 * point; the rig traits' `heelBack` is 0). Null without a toe bone.
 */
function contactPoints(pose: MMDBodyPose, ankle: Bone, side: Foot): Record<'heel' | 'ball', Vector3> | null {
  const toe = pose.bone(pose.rig.bones[`${side}Toes`])
  if (!toe)
    return null
  ankle.updateWorldMatrix(true, false)
  toe.updateWorldMatrix(false, false)
  const local = ankle.matrixWorld.clone().invert()
  const ball = toe.getWorldPosition(new Vector3())
  const heel = ankle.getWorldPosition(new Vector3())
  heel.y = ball.y
  return { heel: heel.applyMatrix4(local), ball: ball.applyMatrix4(local) }
}

/** The model root on the ground line: world x, and yaw about +Y. The root never leaves z = 0. */
export interface MMDRootPose {
  readonly x: number
  readonly yaw: number
}

/** Ground frame (world x and z, model-unit heights) to the mesh-local frame of a root at `root`. */
function toMeshAnchor(anchor: FootAnchor, root: MMDRootPose): FootAnchor {
  const dx = anchor.position.x - root.x
  const dz = anchor.position.z
  const cos = Math.cos(root.yaw)
  const sin = Math.sin(root.yaw)
  return { position: { x: cos * dx - sin * dz, y: anchor.position.y, z: sin * dx + cos * dz }, yaw: anchor.yaw - root.yaw }
}

/**
 * The leg IK's ankle target in the mesh-local frame: a ground anchor with the gait's roll applied, which moves the ankle
 * about its pivot along the foot's forward axis.
 */
export function meshAnkleTarget(ground: FootAnchor, roll: LocomotionFoot['roll'] | undefined, root: MMDRootPose): FootAnchor {
  return toMeshAnchor(roll
    ? { position: { x: ground.position.x + Math.sin(ground.yaw) * roll.ankleOffset[0], y: ground.position.y + roll.ankleOffset[1], z: ground.position.z + Math.cos(ground.yaw) * roll.ankleOffset[0] }, yaw: ground.yaw }
    : ground, root)
}

function toGroundAnchor(anchor: FootAnchor, root: MMDRootPose): FootAnchor {
  const { x, y, z } = anchor.position
  const cos = Math.cos(root.yaw)
  const sin = Math.sin(root.yaw)
  return { position: { x: root.x + cos * x + sin * z, y, z: -sin * x + cos * z }, yaw: anchor.yaw + root.yaw }
}

/**
 * Planted anchors live in the ground frame, so root motion never drags a planted foot. They are converted into the
 * mesh-local frame before every IK write. With the root at the origin both frames coincide exactly.
 */
export class MMDFootContact {
  private readonly legs
  private readonly planner
  private result: ReturnType<ReturnType<typeof createFootContact>['step']> | null = null
  private readonly targets: Partial<Record<Foot, FootAnchor>> = {}
  private readonly planted: Partial<Record<Foot, FootAnchor>> = {}
  private readonly steps: Partial<Record<Foot, { start: number, arc: ReturnType<typeof planFootSteps>[number] }>> = {}
  private readonly last: Record<Foot, Vector3>
  private plannedYaw = 0
  private root: MMDRootPose = { x: 0, yaw: 0 }
  /** Feet that carry weight this frame, and their solved world ankles and ankle matrices from the previous measurement. */
  private readonly carrying: Record<Foot, boolean> = { left: false, right: false }
  private readonly carried: Partial<Record<Foot, { position: Vector3, matrix: Matrix4 }>> = {}

  constructor(private readonly pose: MMDBodyPose) {
    this.legs = sides.flatMap((side) => {
      const chain = pose.rig.legIk[side]
      const hip = pose.bone(chain?.upperLeg)
      const knee = pose.bone(chain?.knee)
      const ankle = pose.bone(chain?.target)
      const ik = pose.bone(chain?.ikBone)
      if (!chain || !hip || !knee || !ankle || !ik)
        return []
      const geometry: LegGeometry = { hip: pose.localPosition(hip), knee: pose.localPosition(knee), ankle: pose.localPosition(ankle) }
      const upper = new Vector3().copy(geometry.knee).sub(geometry.hip)
      const lower = new Vector3().copy(geometry.ankle).sub(geometry.knee)
      const axis = new Vector3(1, 0, 0).applyQuaternion(knee.getWorldQuaternion(new Quaternion())).applyQuaternion(pose.mmd.mesh.getWorldQuaternion(new Quaternion()).invert())
      const restBend = Math.atan2(upper.clone().cross(lower).dot(axis), upper.dot(lower))
      return [{ side, chain, hip, knee, ankle, ik, geometry, upperLength: upper.length(), lowerLength: lower.length(), restBend, bindKnee: knee.quaternion.clone(), contacts: contactPoints(pose, ankle, side) }]
    })
    const left = this.legs.find(leg => leg.side === 'left')?.geometry ?? this.legs[0]?.geometry
    const right = this.legs.find(leg => leg.side === 'right')?.geometry ?? left
    this.planner = left && right ? createFootContact({ legs: { left, right }, traits: toRigTraits(pose.rig) }) : null
    this.last = {
      left: new Vector3().copy(left?.ankle ?? { x: 0, y: 0, z: 0 }),
      right: new Vector3().copy(right?.ankle ?? { x: 0, y: 0, z: 0 }),
    }
  }

  /** Bind geometry of both legs, or null when either leg IK chain is missing. */
  get bindLegs(): Record<Foot, LegGeometry> | null {
    const left = this.legs.find(leg => leg.side === 'left')?.geometry
    const right = this.legs.find(leg => leg.side === 'right')?.geometry
    return left && right ? { left, right } : null
  }

  /**
   * The heel and ball the gait rolls a foot over, from the same contact points `measure` reads under each pivot, so a
   * rolling foot pivots about exactly the point its contact skate is measured at. Null unless both feet have a toe bone
   * and a toe IK bone: the leg IK bone's pitch reaches the ankle only through the toe IK child.
   */
  get rollGeometry(): Record<Foot, FootGeometry> | null {
    const geometry: Partial<Record<Foot, FootGeometry>> = {}
    for (const leg of this.legs) {
      if (!leg.contacts || this.pose.rig.toeIk[leg.side] === null)
        return null
      // Ankle-local axes are the mesh axes at bind; the gait's foot frame is forward +Z, up +Y (as `toMeshAnchor`).
      geometry[leg.side] = { ankleHeight: -leg.contacts.ball.y, ballForward: leg.contacts.ball.z, heelBack: -leg.contacts.heel.z }
    }
    return geometry.left && geometry.right ? { left: geometry.left, right: geometry.right } : null
  }

  /** Planted anchors in the ground frame, falling back to the bind ankles beside the root. */
  anchors(): Record<Foot, FootAnchor> {
    const bind = this.bindAnchors()
    return {
      left: this.planted.left ?? toGroundAnchor(bind.left, this.root),
      right: this.planted.right ?? toGroundAnchor(bind.right, this.root),
    }
  }

  /** The caller moved the root to `root`: re-plant both feet at their bind offsets beside it. */
  rebase(root: MMDRootPose): void {
    this.root = root
    const bind = this.bindAnchors()
    for (const side of sides) {
      delete this.steps[side]
      delete this.carried[side]
      this.planted[side] = toGroundAnchor(bind[side], root)
    }
    this.planner?.setAnchors(bind)
  }

  private bindAnchors(): Record<Foot, FootAnchor> {
    const anchor = (side: Foot): FootAnchor => {
      const ankle = this.legs.find(leg => leg.side === side)?.geometry.ankle ?? { x: 0, z: 0 }
      return { position: { x: ankle.x, y: this.pose.rig.footBaselineY ?? 0, z: ankle.z }, yaw: 0 }
    }
    return { left: anchor('left'), right: anchor('right') }
  }

  apply(context: MMDFrameContext, input: {
    offset: Vector3
    duck: number
    /** Planner duck: one-shots only. Stance clips reduce contact through their foot-IK tracks. */
    contactDuck: number
    disabled: boolean
    /** The performer's turn steps issued during this frame's ticks; `startTime` is on the same clock as `now`. */
    turnSteps: readonly TurnStep[]
    /** The performer's foot re-plants issued during this frame's ticks, on the same clock. */
    footSteps: readonly BodyFootStep[]
    now: number
    clips: ReadonlyMap<string, AnimationClip>
    root: MMDRootPose
    /** Gait foot targets in the ground frame; they own both feet while the gait weight is above 0. */
    gait: Record<Foot, LocomotionFoot> | null
  }): void {
    if (!this.planner)
      return
    const { clean, dt, mmd } = context
    const root = input.root
    this.root = root
    const sample = (side: Foot) => {
      const chain = this.pose.rig.legIk[side]
      let clipFootTrackWeight = 0
      let kneeTrackWeight = 0
      for (const [name, weight] of clean.clipWeights) {
        if (weight <= 0)
          continue
        for (const track of input.clips.get(name)?.tracks ?? []) {
          if (track.name === `.bones[${chain?.ikBone}].position`)
            clipFootTrackWeight += weight
          if (track.name === `.bones[${chain?.knee}].quaternion`)
            kneeTrackWeight += weight
        }
      }
      return {
        position: this.last[side],
        yaw: this.planted[side]?.yaw ?? 0,
        clipFootTrackWeight: Math.min(1, clipFootTrackWeight),
        kneeAnimated: kneeTrackWeight > 0,
        kneeTrackWeight: Math.min(1, kneeTrackWeight),
      }
    }
    const samples = { left: sample('left'), right: sample('right') }
    if (input.gait) {
      for (const side of sides) {
        const target = input.gait[side].target
        this.planted[side] = { position: { ...target.position }, yaw: target.yaw }
        delete this.steps[side]
      }
      // The gait leaves facing on the root, so the hip yaw that turn steps track is zero again.
      this.plannedYaw = 0
      const planted = this.anchors()
      this.planner.setAnchors({ left: toMeshAnchor(planted.left, root), right: toMeshAnchor(planted.right, root) })
    }
    const previous = this.result
    // `duck` is the body's `contactDuck`, from non-stance clip ownership only: a one-shot owning the root, a leg IK
    // or the lower body ducks it. A stance clip never does, even when it keys センター; it acts only through clipFootTrackWeight.
    this.result = this.planner.step({
      pelvisOffset: input.offset,
      feet: samples,
      enabled: !input.disabled,
      duck: input.contactDuck,
    }, dt)
    for (const leg of this.legs) {
      const contact = this.result.feet[leg.side]
      if (!input.gait && (!this.planted[leg.side] || (previous?.feet[leg.side].c === 0 && contact.c > 0)))
        this.planted[leg.side] = toGroundAnchor(contact.anchor, root)
    }
    for (const step of input.turnSteps) {
      this.plannedYaw += step.yaw
      const left = this.planted.left ?? toGroundAnchor(this.result.feet.left.anchor, root)
      const right = this.planted.right ?? toGroundAnchor(this.result.feet.right.anchor, root)
      const anchor = step.foot === 'left' ? left : right
      const [arc] = planFootSteps([{ foot: step.foot, yawDelta: root.yaw + this.plannedYaw - anchor.yaw, duration: step.duration }], { left, right }, { x: root.x, y: 0, z: 0 })
      this.steps[step.foot] = { start: step.startTime, arc }
    }
    // A re-plant turns the foot about the root like a turn step, to `yaw` from the standing angle, and leaves the
    // facing the turn steps keep (`plannedYaw`) as it is.
    for (const step of input.footSteps) {
      const left = this.planted.left ?? toGroundAnchor(this.result.feet.left.anchor, root)
      const right = this.planted.right ?? toGroundAnchor(this.result.feet.right.anchor, root)
      const anchor = step.foot === 'left' ? left : right
      const [arc] = planFootSteps([{ foot: step.foot, yawDelta: root.yaw + this.plannedYaw + step.yaw - anchor.yaw, duration: step.duration }], { left, right }, { x: root.x, y: 0, z: 0 }, step.lift)
      this.steps[step.foot] = { start: step.startTime, arc }
    }
    const offset = new Vector3().copy(input.offset).lerp(this.result.pelvisOffset, input.duck)
    this.pose.translate(this.pose.rig.hipsTranslation.groove ?? this.pose.rig.hipsTranslation.center, clean, offset)
    for (const leg of this.legs) {
      const { side, chain, ik, knee } = leg
      const contact = this.result.feet[side]
      const step = this.steps[side]
      if (step) {
        this.planted[side] = step.arc.sample(input.now - step.start)
        if (input.now - step.start >= step.arc.duration)
          delete this.steps[side]
      }
      const roll = input.gait?.[side].roll
      const ground = this.planted[side] ?? toGroundAnchor(contact.anchor, root)
      const anchor = meshAnkleTarget(ground, roll, root)
      this.targets[side] = anchor
      this.carrying[side] = !input.disabled && contact.c >= 1 && (input.gait ? input.gait[side].planted : !this.steps[side])
      if (input.disabled) {
        mmd.ikSolver.setEnabled(chain.ikBoneIndex, false)
        continue
      }
      if (contact.c <= 0)
        continue
      // updateAnimation may have disabled this chain through a VMD property track.
      mmd.ikSolver.setEnabled(chain.ikBoneIndex, true)
      const kneeIndex = this.pose.indices.get(knee.name)
      const kneeWeight = samples[side].kneeTrackWeight
      if (kneeIndex !== undefined && kneeWeight < 1 && (!samples[side].kneeAnimated || contact.c >= 1)) {
        const hipIndex = this.pose.indices.get(leg.hip.name)
        if (hipIndex !== undefined)
          leg.hip.quaternion.copy(clean.quaternions[hipIndex])
        leg.hip.updateWorldMatrix(true, true)
        // Seed CCD on the correct side of the straight-chain singularity. The
        // planner's minimum bend also needs the geometric flexion: a 4-degree
        // seed alone converges too slowly on near-straight 40-iteration PMX legs.
        const distance = this.pose.localPosition(leg.hip).distanceTo(new Vector3().copy(anchor.position))
        const cosine = (distance ** 2 - leg.upperLength ** 2 - leg.lowerLength ** 2) / (2 * leg.upperLength * leg.lowerLength)
        const flexion = this.pose.rig.kneeBendSign * Math.acos(Math.max(-1, Math.min(1, cosine))) - leg.restBend
        const bend = this.pose.rig.kneeBendSign * Math.max(Math.abs(contact.kneePreBend), Math.abs(flexion))
        const limit = chain.kneeLimit
        const pitch = limit ? Math.max(limit.min[0], Math.min(limit.max[0], bend)) : bend
        // A newly weighted knee track is still almost straight, so CCD still needs
        // the planted seed. Hand it back continuously with the track's weight;
        // a fully weighted clip keeps its original bend plane and solved pose.
        knee.quaternion.copy(samples[side].kneeAnimated ? leg.bindKnee : clean.quaternions[kneeIndex]).multiply(new Quaternion().setFromEuler(new Euler(pitch, 0, 0)))
        if (samples[side].kneeAnimated)
          knee.quaternion.slerp(clean.quaternions[kneeIndex], kneeWeight)
        knee.updateWorldMatrix(true, true)
        const hipWorld = leg.hip.getWorldPosition(new Vector3())
        const from = leg.ankle.getWorldPosition(new Vector3()).sub(hipWorld).normalize()
        const to = mmd.mesh.localToWorld(new Vector3().copy(anchor.position)).sub(hipWorld).normalize()
        const parent = leg.hip.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()
        const align = new Quaternion().setFromUnitVectors(from, to)
        align.slerp(new Quaternion(), kneeWeight)
        const local = parent.clone().invert().multiply(align).multiply(parent)
        leg.hip.quaternion.premultiply(local)
        leg.hip.updateWorldMatrix(false, true)
      }
      ik.parent?.updateWorldMatrix(true, false)
      const planted = mmd.mesh.localToWorld(new Vector3().copy(anchor.position))
      ik.parent?.worldToLocal(planted)
      ik.position.copy(clean.positions[chain.ikBoneIndex]).lerp(planted, contact.c)
      const parent = ik.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()
      const worldYaw = mmd.mesh.getWorldQuaternion(new Quaternion())
        .multiply(new Quaternion().setFromAxisAngle(this.pose.up, anchor.yaw))
      // Pitch about the foot's lateral axis after its yaw; positive lifts the toes (+Z forward toward +Y up).
      if (roll && roll.pitch !== 0)
        worldYaw.multiply(new Quaternion().setFromAxisAngle(FOOT_LATERAL, roll.pitch))
      ik.quaternion.copy(clean.quaternions[chain.ikBoneIndex]).slerp(parent.invert().multiply(worldYaw), contact.c)
      ik.updateWorldMatrix(false, true)
    }
  }

  /**
   * Read after the real IK, grants, and physics, never the commanded IK target. `skate` is the largest horizontal
   * world movement of a solved ankle that carried weight in both this frame and the previous one; it should be 0.
   * `skateContact` is the same for each foot's contact point under this frame's `pivot` kind (flat when omitted): the
   * rig's heel or ball point, placed with this frame's and the previous frame's ankle matrix. A flat foot's contact point
   * is its ankle, so it reads `skate`'s own distance; so does a foot whose rig has no toe bone, whatever the kind.
   */
  measure(pivot: Partial<Record<Foot, MMDFootPivot>> = {}) {
    let errorL = 0
    let errorR = 0
    let contact = 0
    let skate = 0
    let skateContact = 0
    for (const leg of this.legs) {
      const world = leg.ankle.getWorldPosition(new Vector3())
      const before = this.carried[leg.side]
      if (this.carrying[leg.side]) {
        if (before) {
          const step = Math.hypot(world.x - before.position.x, world.z - before.position.z)
          skate = Math.max(skate, step)
          const kind = pivot[leg.side] ?? 'flat'
          const point = kind === 'flat' ? null : leg.contacts?.[kind]
          if (!point) {
            skateContact = Math.max(skateContact, step)
          }
          else {
            const now = point.clone().applyMatrix4(leg.ankle.matrixWorld)
            const then = point.clone().applyMatrix4(before.matrix)
            skateContact = Math.max(skateContact, Math.hypot(now.x - then.x, now.z - then.z))
          }
        }
        this.carried[leg.side] = { position: world, matrix: leg.ankle.matrixWorld.clone() }
      }
      else {
        delete this.carried[leg.side]
      }
      const solved = this.pose.localPosition(leg.ankle)
      this.last[leg.side].copy(solved)
      const target = this.targets[leg.side]
      const error = target ? solved.distanceTo(new Vector3().copy(target.position)) : 0
      if (leg.side === 'left')
        errorL = error
      else
        errorR = error
      contact += this.result?.feet[leg.side].c ?? 0
    }
    return { maxError: Math.max(errorL, errorR), errorL, errorR, contact: this.legs.length ? contact / this.legs.length : 0, skate, skateContact }
  }
}
