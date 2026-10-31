import type { NaturalTouchRegion } from '@proj-airi/motion-driver-natural/frame-types'
import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { NaturalChatInput, NaturalMotionFrame, NaturalMotionVoice } from '@proj-airi/motion-driver-natural/natural-motion'
import type { ExpressionPerformanceSettings, HoldCommand, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { Camera, SkinnedMesh } from 'three'

import type { MorphSlot } from '../../../constants/morphs'
import type { SlotLease, SpeechEvent } from '../../../stores/expression-slots'
import type { MMDCleanPose } from '../frame-pipeline'
import type { createMMDMorphRuntime } from '../morph-runtime'
import type { MMDRigProfile } from '../rig'

import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { screenInwardness } from '@proj-airi/stage-shared/stage-placement'
import { Euler, Quaternion, Vector3 } from 'three'

import { applySpeechEvent, createLease, leaseReleaseAt } from '../../../stores/expression-slots'
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
  private readonly pending: NaturalEpisode[] = []
  private hold: { emotion: PerformanceEmotion, strength: number, lease: SlotLease } | null = null
  private readonly activeSpeech = new Map<string, { lastClipEndAt: number | null }>()
  private muted = false
  private settings = defaultExpressionPerformanceSettings
  private input: MMDNaturalInput | null = null

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

  advance(dt: number, input: MMDNaturalInput, now = this.time + dt): void {
    this.input = input
    this.time += dt
    if (this.hold && now >= leaseReleaseAt(this.hold.lease, this.muted, this.settings.slots))
      this.hold = null
    this.natural.setHeldEmotion(this.hold, this.time)
    for (const episode of this.pending.splice(0))
      this.natural.impulse(episode, this.time)
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

  impulse(episode: NaturalEpisode): void {
    this.pending.push(episode)
  }

  setPerformanceSettings(settings: ExpressionPerformanceSettings): void {
    if (this.settings === settings)
      return
    this.settings = settings
    this.natural.setPerformanceSettings(settings)
  }

  /** Lease timestamps use the conductor clock, not accumulated animation time. */
  applyHolds(commands: HoldCommand[], now: number): void {
    for (const command of commands) {
      if (command.emotion === null) {
        this.hold = null
        continue
      }
      const lease = createLease(`emotion:${command.emotion}`, command, now, 0)
      const speech = lease.turnId === null ? undefined : this.activeSpeech.get(lease.turnId)
      this.hold = {
        emotion: command.emotion,
        strength: command.strength,
        lease: speech ? { ...lease, sawClipStart: true, lastClipEndAt: speech.lastClipEndAt } : lease,
      }
    }
  }

  onSpeech(event: SpeechEvent, turnId: string, now: number): void {
    if (event === 'clip-start' && !this.activeSpeech.has(turnId))
      this.activeSpeech.set(turnId, { lastClipEndAt: null })
    else if (event === 'clip-end' && this.activeSpeech.has(turnId))
      this.activeSpeech.set(turnId, { lastClipEndAt: now })
    else if (event === 'clip-stopped' || event === 'turn-end')
      this.activeSpeech.delete(turnId)
    if (this.hold?.lease.turnId === turnId) {
      const lease = applySpeechEvent(this.hold.lease, event, now, this.muted, this.settings.slots)
      this.hold = lease ? { ...this.hold, lease } : null
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  get mood() {
    return this.natural.moodState
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

  /** The body adapter consumes the same frame; it must never advance Natural again. */
  get bodyFrame() {
    return {
      frame: this.frame,
      input: this.input,
      onChat: this.natural.onChat || Math.hypot(this.natural.chatHeadFollow.x, this.natural.chatHeadFollow.y) > 0,
    }
  }
}

export function mmdScreenInwardness(viewport: PlacementRect, headX: number): number | null {
  return screenInwardness([viewport], headX)
}
