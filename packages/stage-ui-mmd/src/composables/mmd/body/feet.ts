import type { Foot, FootAnchor, LegGeometry } from '@proj-airi/motion-driver-humanoid/foot-contact'
import type { LocomotionFoot } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { LookAtFrame } from '@proj-airi/motion-driver-humanoid/look-at'
import type { AnimationClip } from 'three'

import type { MMDFrameContext } from '../frame-pipeline'
import type { MMDBodyPose } from './pose'

import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
import { Euler, Quaternion, Vector3 } from 'three'

import { toRigTraits } from '../rig'

const sides = ['left', 'right'] as const

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
  /** Feet that carry weight this frame, and their solved world ankles from the previous measurement. */
  private readonly carrying: Record<Foot, boolean> = { left: false, right: false }
  private readonly carried: Partial<Record<Foot, Vector3>> = {}

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
      return [{ side, chain, hip, knee, ankle, ik, geometry, upperLength: upper.length(), lowerLength: lower.length(), restBend }]
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
    look: LookAtFrame
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
      let kneeAnimated = false
      for (const [name, weight] of clean.clipWeights) {
        if (weight <= 0)
          continue
        for (const track of input.clips.get(name)?.tracks ?? []) {
          if (track.name === `.bones[${chain?.ikBone}].position`)
            clipFootTrackWeight += weight
          if (track.name === `.bones[${chain?.knee}].quaternion`)
            kneeAnimated = true
        }
      }
      return {
        position: this.last[side],
        yaw: this.planted[side]?.yaw ?? 0,
        clipFootTrackWeight: Math.min(1, clipFootTrackWeight),
        kneeAnimated,
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
    // One-shots duck this layer even without IK tracks; stance clips duck it
    // only through clipFootTrackWeight, so feet stay planted while sitting down.
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
    for (const step of input.look.turnSteps) {
      this.plannedYaw += step.yaw
      const left = this.planted.left ?? toGroundAnchor(this.result.feet.left.anchor, root)
      const right = this.planted.right ?? toGroundAnchor(this.result.feet.right.anchor, root)
      const anchor = step.foot === 'left' ? left : right
      const [arc] = planFootSteps([{ foot: step.foot, yawDelta: root.yaw + this.plannedYaw - anchor.yaw, duration: step.duration }], { left, right }, { x: root.x, y: 0, z: 0 })
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
      const anchor = toMeshAnchor(this.planted[side] ?? toGroundAnchor(contact.anchor, root), root)
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
      if (kneeIndex !== undefined && !samples[side].kneeAnimated) {
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
        knee.quaternion.copy(clean.quaternions[kneeIndex]).multiply(new Quaternion().setFromEuler(new Euler(pitch, 0, 0)))
        knee.updateWorldMatrix(true, true)
        const hipWorld = leg.hip.getWorldPosition(new Vector3())
        const from = leg.ankle.getWorldPosition(new Vector3()).sub(hipWorld).normalize()
        const to = mmd.mesh.localToWorld(new Vector3().copy(anchor.position)).sub(hipWorld).normalize()
        const parent = leg.hip.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()
        const align = new Quaternion().setFromUnitVectors(from, to)
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
      ik.quaternion.copy(clean.quaternions[chain.ikBoneIndex]).slerp(parent.invert().multiply(worldYaw), contact.c)
      ik.updateWorldMatrix(false, true)
    }
  }

  /**
   * Read after the real IK, grants, and physics, never the commanded IK target. `skate` is the largest horizontal
   * world movement of a solved ankle that carried weight in both this frame and the previous one; it should be 0.
   */
  measure() {
    let errorL = 0
    let errorR = 0
    let contact = 0
    let skate = 0
    for (const leg of this.legs) {
      const world = leg.ankle.getWorldPosition(new Vector3())
      const before = this.carried[leg.side]
      if (this.carrying[leg.side]) {
        if (before)
          skate = Math.max(skate, Math.hypot(world.x - before.x, world.z - before.z))
        this.carried[leg.side] = world
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
    return { maxError: Math.max(errorL, errorR), errorL, errorR, contact: this.legs.length ? contact / this.legs.length : 0, skate }
  }
}
