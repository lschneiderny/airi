import type { Foot, FootAnchor, LegGeometry } from '@proj-airi/motion-driver-humanoid/foot-contact'
import type { LookAtFrame } from '@proj-airi/motion-driver-humanoid/look-at'
import type { AnimationClip } from 'three'

import type { MMDFrameContext } from '../frame-pipeline'
import type { MMDBodyPose } from './pose'

import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
import { Euler, Quaternion, Vector3 } from 'three'

import { toRigTraits } from '../rig'

const sides = ['left', 'right'] as const

/** Mesh-local anchors survive pose restoration, but never a model replacement. */
export class MMDFootContact {
  private readonly legs
  private readonly planner
  private result: ReturnType<ReturnType<typeof createFootContact>['step']> | null = null
  private readonly targets: Partial<Record<Foot, FootAnchor>> = {}
  private readonly planted: Partial<Record<Foot, FootAnchor>> = {}
  private readonly steps: Partial<Record<Foot, { start: number, arc: ReturnType<typeof planFootSteps>[number] }>> = {}
  private readonly last: Record<Foot, Vector3>
  private plannedYaw = 0

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

  apply(context: MMDFrameContext, input: {
    offset: Vector3
    duck: number
    disabled: boolean
    look: LookAtFrame
    now: number
    clips: ReadonlyMap<string, AnimationClip>
  }): void {
    if (!this.planner)
      return
    const { clean, dt, mmd } = context
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
    const previous = this.result
    // All active clips duck this layer, including one-shots without IK tracks.
    this.result = this.planner.step({
      pelvisOffset: input.offset,
      feet: samples,
      enabled: !input.disabled,
      duck: input.duck,
    }, dt)
    for (const leg of this.legs) {
      const contact = this.result.feet[leg.side]
      if (!this.planted[leg.side] || (previous?.feet[leg.side].c === 0 && contact.c > 0))
        this.planted[leg.side] = contact.anchor
    }
    for (const step of input.look.turnSteps) {
      this.plannedYaw += step.yaw
      const left = this.planted.left ?? this.result.feet.left.anchor
      const right = this.planted.right ?? this.result.feet.right.anchor
      const anchor = step.foot === 'left' ? left : right
      const [arc] = planFootSteps([{ foot: step.foot, yawDelta: this.plannedYaw - anchor.yaw, duration: step.duration }], { left, right }, { x: 0, y: 0, z: 0 })
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
      const anchor = this.planted[side] ?? contact.anchor
      this.targets[side] = anchor
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

  /** Read after the real IK, grants, and physics, never the commanded IK target. */
  measure() {
    let errorL = 0
    let errorR = 0
    let contact = 0
    for (const leg of this.legs) {
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
    return { maxError: Math.max(errorL, errorR), errorL, errorR, contact: this.legs.length ? contact / this.legs.length : 0 }
  }
}
