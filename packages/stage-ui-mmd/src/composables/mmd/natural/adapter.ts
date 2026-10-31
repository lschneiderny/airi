import type { NaturalTouchRegion } from '@proj-airi/motion-driver-natural/frame-types'
import type { NaturalChatInput, NaturalMotionFrame, NaturalMotionVoice } from '@proj-airi/motion-driver-natural/natural-motion'
import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { Camera, SkinnedMesh } from 'three'

import type { MorphSlot } from '../../../constants/morphs'
import type { MMDCleanPose } from '../frame-pipeline'
import type { createMMDMorphRuntime } from '../morph-runtime'
import type { MMDRigProfile } from '../rig'

import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { screenInwardness } from '@proj-airi/stage-shared/stage-placement'
import { Euler, Quaternion, Vector3 } from 'three'

import { EYE_PITCH_LIMIT, EYE_YAW_LIMIT } from '../gaze'
import { applyNaturalFace } from './face'
import { fnv1a32 } from './seed'

export interface MMDNaturalInput {
  readonly performance: PerformanceState
  readonly energy: number
  readonly voice: NaturalMotionVoice
  /** Eye-anchored head widths, Y up. */
  readonly cursor: { x: number, y: number } | null
  readonly chat: NaturalChatInput | null
  readonly placement: number | null
}

/** Projects bind head geometry, not the already posed head (which would feed gaze back into itself). */
export function projectMMDHead(
  mesh: SkinnedMesh,
  camera: Camera,
  viewport: PlacementRect,
) {
  const headIndex = mesh.skeleton.bones.findIndex(bone => ['頭', 'head', 'Head'].includes(bone.name))
  if (headIndex < 0)
    return null
  const head = new Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[headIndex].clone().invert())
  const neckIndex = mesh.skeleton.bones.findIndex(bone => bone.name === '首')
  const neck = neckIndex < 0 ? head.clone().add(new Vector3(0, -1, 0)) : new Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[neckIndex].clone().invert())
  const radius = 1.5 * head.distanceTo(neck)
  if (radius <= 0)
    return null
  const project = (point: Vector3) => {
    point.applyMatrix4(mesh.matrixWorld).project(camera)
    return { x: viewport.x + (point.x + 1) * viewport.width / 2, y: viewport.y + (1 - point.y) * viewport.height / 2 }
  }
  const top = project(head.clone().add(new Vector3(0, radius, 0)))
  const anchor = project(head)
  const width = Math.max(1, Math.abs(anchor.y - top.y) * 2)
  return { ...anchor, width }
}

/** Owns one model's seeded controller and absolute, pre-physics pose overlay. */
export class MMDNaturalAdapter {
  readonly natural: NaturalMotion
  private readonly indices = new Map<string, number>()
  private readonly delta = new Quaternion()
  private readonly angles = new Euler(0, 0, 0, 'YXZ')
  private time = 0
  private events = 0
  private energy = 0.5
  private headYaw = 0
  private placement: number | null = null
  private frame: NaturalMotionFrame

  constructor(
    private readonly mesh: SkinnedMesh,
    private readonly rig: MMDRigProfile,
    modelKey: string,
  ) {
    mesh.skeleton.bones.forEach((bone, index) => this.indices.set(bone.name, index))
    this.natural = new NaturalMotion({ seed: fnv1a32(modelKey) })
    this.natural.setRigTraits({ bodyFromHeadPhysics: { x: false, y: false, z: false } })
    this.natural.setObserver(() => this.events++)
    this.frame = this.natural.advance(0)
  }

  advance(dt: number, input: MMDNaturalInput): void {
    this.time += dt
    this.energy = input.energy
    this.natural.setVoice(input.voice)
    this.natural.setPerformance(input.performance, input.energy, this.time)
    this.natural.setCursor(input.cursor, this.time)
    this.natural.setChat(input.chat, this.time)
    if (input.placement !== this.placement) {
      this.placement = input.placement
      this.natural.setPlacement(input.placement, this.time)
    }
    this.frame = this.natural.advance(this.time)
  }

  /** Touch coordinates are region-relative, X right and Y down. */
  poke(region: NaturalTouchRegion, point: { x: number, y: number }): void {
    this.natural.poke(region, point.x, point.y, this.time)
  }

  setPet(point: { x: number, y: number } | null): void {
    this.natural.setPet(point, this.time)
  }

  setEmotion(emotion: PerformanceEmotion, strength: number): void {
    this.natural.setHeldEmotion({ emotion, strength }, this.time)
  }

  applyPose(clean: MMDCleanPose, eyesOwned = false): void {
    const { pose, breath } = this.frame
    const clamp = (value: number) => Math.max(-1, Math.min(1, value))
    const headSpan = Math.PI / 6
    const bodySpan = Math.PI / 18
    const write = (name: string | undefined, pitch: number, yaw: number, roll: number) => {
      if (!name || this.rig.physicsOwned.includes(name))
        return
      const index = this.indices.get(name)
      if (index === undefined)
        return
      this.delta.setFromEuler(this.angles.set(pitch, yaw, roll, 'YXZ'))
      const bone = this.mesh.skeleton.bones[index]
      bone.quaternion.copy(clean.quaternions[index]).multiply(this.delta)
      if (name === this.rig.bones.head)
        this.headYaw = this.angles.setFromQuaternion(bone.quaternion, 'YXZ').y
    }
    this.headYaw = 0
    for (const [name, share] of [[this.rig.bones.neck, 0.4], [this.rig.bones.head, 0.6]] as const)
      write(name, -clamp(pose.headY) * headSpan * share, clamp(pose.headX) * headSpan * share, -clamp(pose.headZ) * headSpan * share)
    for (const [name, share] of [[this.rig.bones.spine, 0.5], [this.rig.bones.chest, 0.5]] as const) {
      const breathPitch = name === this.rig.bones.chest ? (breath.value - 0.45) * 0.03 : 0
      write(name, clamp(-(pose.bodyY ?? 0) + breathPitch / (bodySpan * share)) * bodySpan * share, clamp(pose.bodyX ?? 0) * bodySpan * share, -clamp(pose.bodyZ ?? 0) * bodySpan * share)
    }
    if (!eyesOwned) {
      for (const name of [this.rig.bones.leftEye, this.rig.bones.rightEye])
        write(name, -clamp(pose.eyeY) * EYE_PITCH_LIMIT, clamp(pose.eyeX) * EYE_YAW_LIMIT, 0)
    }
  }

  applySurface(runtime: ReturnType<typeof createMMDMorphRuntime>, overrides: Readonly<Partial<Record<MorphSlot, string>>> = {}): void {
    applyNaturalFace(runtime, this.frame, overrides)
  }

  get diagnostics() {
    return { events: this.events, energy: this.energy, headYaw: this.headYaw }
  }
}

export function mmdScreenInwardness(viewport: PlacementRect, headX: number): number | null {
  return screenInwardness([viewport], headX)
}
