import type { PerformerCapabilities } from '@proj-airi/character-mind'
import type { BodyLookTarget } from '@proj-airi/motion-driver-humanoid/types'
import type { FaceBaseline } from '@proj-airi/motion-driver-natural/baseline'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { CursorOrder, CursorReport } from '@proj-airi/motion-driver-natural/cursor-notice'
import type { NaturalEmotionStrengths } from '@proj-airi/motion-driver-natural/emotion-strengths'
import type { NaturalMotionObserver, NaturalTouchRegion } from '@proj-airi/motion-driver-natural/frame-types'
import type { IdleBehaviourReport, IdleCueKind, NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleErrandRecord } from '@proj-airi/motion-driver-natural/idle-errands'
import type { IdleOrder, IdleReport } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { NaturalChatInput, NaturalChatRead, NaturalMotionFrame, NaturalMotionVoice } from '@proj-airi/motion-driver-natural/natural-motion'
import type { ExpressionPerformanceSettings, HoldCommand, MoodDose, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { Camera, SkinnedMesh } from 'three'

import type { MorphSlot } from '../../../constants/morphs'
import type { SlotLease, SpeechEvent } from '../../../stores/expression-slots'
import type { createMMDMorphRuntime } from '../morph-runtime'

import { mapCursor } from '@proj-airi/motion-driver-natural/cursor-attention'
import { IdleBehaviourReports } from '@proj-airi/motion-driver-natural/idle-activities'
import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { screenInwardness } from '@proj-airi/stage-shared/stage-placement'
import { Vector3 } from 'three'

import { applySpeechEvent, createLease, leaseReleaseAt } from '../../../stores/expression-slots'
import { applyNaturalFace } from './face'
import { fnv1a32 } from './seed'

/** Natural realises every mind channel; the director still resolves available clips and stage geometry. */
export const MMD_NATURAL_CAPABILITIES: PerformerCapabilities = {
  posture: true,
  face: true,
  gaze: true,
  gestures: ['nod', 'shake', 'glance', 'shrug', 'lean'],
  body: true,
}

export interface MMDNaturalInput {
  readonly performance: PerformanceState
  readonly energy: number
  readonly voice: NaturalMotionVoice
  /** Eye-anchored head widths, Y up. */
  readonly cursor: { x: number, y: number } | null
  readonly chat: NaturalChatInput | null
  readonly placement: number | null
  /** This model's per-emotion strengths; the same setting shape as Live2D's. */
  readonly emotionStrengths: NaturalEmotionStrengths
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
  private time = 0
  private events = 0
  private energy = 0.5
  private placement: number | null = null
  private frame: NaturalMotionFrame
  private readonly pending: NaturalEpisode[] = []
  private readonly pendingGestures: { kind: CueGestureKind, count: number }[] = []
  private readonly pendingMoods: MoodDose[] = []
  /** The mind's mood seed, applied on the next frame; a newer seed replaces it. */
  private pendingMoodLevel: Omit<MoodDose, 'id'> | null = null
  private readonly pendingIdleCues: IdleCueKind[] = []
  private readonly pendingIdleOrders: IdleOrder[] = []
  private readonly pendingCursorOrders: CursorOrder[] = []
  /** Chat reads the character mind decided; applied after the frame's chat input, so an unfolded chat has its target. */
  private readonly pendingChatReads: NaturalChatRead[] = []
  private readonly pendingLooks: { target: BodyLookTarget, holdSeconds: number }[] = []
  private readonly pendingBeats: number[] = []
  private idleDrive: NaturalIdleDrive | null = null
  private appliedIdleDrive: NaturalIdleDrive | null = null
  private readonly idleReports = new IdleBehaviourReports()
  private idleBehaviourReports: IdleBehaviourReport[] = []
  private hold: { emotion: PerformanceEmotion, strength: number, lease: SlotLease } | null = null
  private readonly activeSpeech = new Map<string, { lastClipEndAt: number | null }>()
  private muted = false
  private settings = defaultExpressionPerformanceSettings
  private input: MMDNaturalInput | null = null
  private readonly listeners = new Set<NaturalMotionObserver>()

  constructor(modelKey: string) {
    this.natural = new NaturalMotion({ seed: fnv1a32(modelKey) })
    this.natural.setRigTraits({ bodyFromHeadPhysics: { x: false, y: false, z: false } })
    this.natural.setObserver((event) => {
      this.events++
      for (const listener of this.listeners)
        listener(event)
    })
    this.frame = this.natural.advance(0)
  }

  /** Additive observation only; unsubscribing leaves the diagnostic counter intact. */
  onEvent(listener: NaturalMotionObserver): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  advance(dt: number, input: MMDNaturalInput, now = this.time + dt): void {
    this.input = input
    this.time += dt
    // Strengths first, as in the Live2D adapter: the setters below advance time and can start a queued episode,
    // which must see this frame's per-model strengths.
    this.natural.setEmotionStrengths(input.emotionStrengths)
    if (this.hold && now >= leaseReleaseAt(this.hold.lease, this.muted, this.settings.slots))
      this.hold = null
    this.natural.setHeldEmotion(this.hold, this.time)
    for (const episode of this.pending.splice(0))
      this.natural.impulse(episode, this.time)
    for (const { kind, count } of this.pendingGestures.splice(0))
      this.natural.gesture(kind, count, this.time)
    if (this.pendingMoodLevel) {
      this.natural.setMood(this.pendingMoodLevel, this.time)
      this.pendingMoodLevel = null
    }
    for (const dose of this.pendingMoods.splice(0))
      this.natural.addMood(dose, this.time)
    for (const cue of this.pendingIdleCues.splice(0))
      this.natural.idleCue(cue, this.time)
    for (const order of this.pendingIdleOrders.splice(0))
      this.natural.idle(order, this.time)
    for (const order of this.pendingCursorOrders.splice(0))
      this.natural.cursorEpisode(order, this.time)
    for (const intervalSeconds of this.pendingBeats.splice(0))
      this.natural.beat(intervalSeconds, this.time)
    // Before the performance state, whose energy the drive moves. Forwarded on change only.
    if (this.idleDrive !== this.appliedIdleDrive) {
      this.appliedIdleDrive = this.idleDrive
      this.natural.setIdleDrive(this.idleDrive, this.time)
    }
    this.energy = input.energy
    this.natural.setVoice(input.voice)
    this.natural.setPerformance(input.performance, input.energy, this.time)
    this.natural.setCursor(input.cursor, this.time)
    this.natural.setChat(input.chat, this.time)
    for (const read of this.pendingChatReads.splice(0))
      this.natural.chatRead(read, this.time)
    for (const look of this.pendingLooks.splice(0)) {
      let target: Parameters<NaturalMotion['look']>[0] = null
      if (look.target === 'camera') {
        target = { x: 0, y: 0 }
      }
      else if (look.target === 'away') {
        target = 'away'
      }
      else {
        const point = look.target === 'chat' ? input.chat?.target : input.cursor
        if (point)
          target = mapCursor(point).eye
      }
      this.natural.look(target, look.holdSeconds, this.time)
    }
    if (input.placement !== this.placement) {
      this.placement = input.placement
      this.natural.setPlacement(input.placement, this.time)
    }
    this.frame = this.natural.advance(this.time)
    this.idleBehaviourReports = this.idleReports.read(this.natural.idleState)
  }

  /** Sets the drive of self-directed idle behaviour from the next frame, or switches it off with `null`. */
  setIdleDrive(drive: NaturalIdleDrive | null): void {
    this.idleDrive = drive
  }

  /** The latest errand Natural started for the mind (an unasked clip, a wander), kept after it ends. */
  get idleErrand(): IdleErrandRecord | null {
    return this.natural.idleErrand
  }

  /** The realiser's answer to errand `seq`, applied at the next frame. */
  answerIdleErrand(seq: number, outcome: 'done' | 'refused'): void {
    this.natural.answerIdleErrand(seq, outcome, this.time)
  }

  /** Reach-out body language, played at the next frame like a cue gesture. */
  idleCue(kind: IdleCueKind): void {
    this.pendingIdleCues.push(kind)
  }

  /**
   * Plays what the character mind's idle policy decided, at the next frame. The body performs its own form of an act
   * from the body intent, so the whole-body kinds show; Natural answers the order in its idle reports.
   */
  idle(order: IdleOrder): void {
    this.pendingIdleOrders.push(order)
  }

  /**
   * A beat the music detector heard, `intervalSeconds` after its previous beat, handed to Natural's beat clock at the
   * next frame on this adapter's motion time, so a bound groove plays on it.
   */
  beat(intervalSeconds: number): void {
    this.pendingBeats.push(intervalSeconds)
  }

  /** Calls `listener` with Natural's idle reports for the character mind; returns the function that stops it. */
  onIdleReports(listener: (reports: readonly IdleReport[]) => void): () => void {
    return this.natural.onIdleReports(listener)
  }

  /**
   * Plays the cursor episode the character mind drew for a report, at the next frame. Natural drops an order whose
   * report it no longer awaits.
   */
  cursorEpisode(order: CursorOrder): void {
    this.pendingCursorOrders.push(order)
  }

  /** Reads the chat at the next frame, as the character mind decided for a sent message or an unfolded chat. */
  chatRead(read: NaturalChatRead): void {
    this.pendingChatReads.push({ ...read })
  }

  /** Queues one director look request; the next frame supplies its cursor or chat geometry before it starts. */
  look(target: BodyLookTarget, holdSeconds: number): void {
    this.pendingLooks.push({ target, holdSeconds })
  }

  /** Calls `listener` with Natural's cursor reports for the character mind; returns the function that stops it. */
  onCursorReports(listener: (reports: readonly CursorReport[]) => void): () => void {
    return this.natural.onCursorReports(listener)
  }

  /** The idle behaviours that started or ended in the latest frame. */
  get idleBehaviours(): readonly IdleBehaviourReport[] {
    return this.idleBehaviourReports
  }

  /** Ends the behaviour in progress for whoever follows the reports, when this adapter stops being advanced. */
  endIdleReports(): readonly IdleBehaviourReport[] {
    return this.idleReports.read({ seq: this.natural.idleState.seq, behaviour: null })
  }

  /** Touch coordinates are region-relative, X right and Y down. */
  poke(region: NaturalTouchRegion, point: { x: number, y: number }): void {
    this.natural.poke(region, point.x, point.y, this.time)
  }

  /** Ends a sleep with the gentle wake at the next step; ignored while she is awake. */
  wake(): void {
    this.natural.wake(this.time)
  }

  /** Starts a desktop reaction; `wake` also rouses her from sleep with a start. */
  react(reaction: 'wake' | 'screen-change'): void {
    this.natural.react(reaction, this.time)
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

  /** An ACT cue gesture, played at the next frame like an episode. */
  gesture(kind: CueGestureKind, count: number): void {
    this.pendingGestures.push({ kind, count })
  }

  /** A mood dose the mind decided, a touch's or an emotion episode's; Natural ignores a repeated dose id. */
  addMood(dose: MoodDose): void {
    this.pendingMoods.push({ ...dose })
  }

  /** Seeds Natural's mood with the mind's level on the next frame, before that frame's doses. */
  setMood(level: Omit<MoodDose, 'id'>): void {
    this.pendingMoodLevel = { valence: level.valence, arousal: level.arousal, tension: level.tension }
  }

  /** Sets the resting face target; Natural filters it on its grid and the face mapping reads the result. */
  setFaceBaseline(baseline: FaceBaseline): void {
    this.natural.setFaceBaseline(baseline)
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

  /** `lidClose` is the body performer's lid closure; the face shows the larger of it and Natural's own blink closure. */
  applySurface(runtime: ReturnType<typeof createMMDMorphRuntime>, overrides: Readonly<Partial<Record<MorphSlot, string>>> = {}, lidClose = 0): void {
    const blinkFactor = Math.min(this.frame.blink.blinkFactor, 1 - lidClose)
    applyNaturalFace(runtime, blinkFactor === this.frame.blink.blinkFactor ? this.frame : { ...this.frame, blink: { blinkFactor } }, overrides)
  }

  get diagnostics() {
    return { events: this.events, energy: this.energy }
  }

  /** The body adapter consumes the same frame; it must never advance Natural again. */
  get bodyFrame() {
    return {
      frame: this.frame,
      intent: this.natural.bodyIntent(),
      input: this.input,
      onChat: this.natural.onChat || Math.hypot(this.natural.chatHeadFollow.x, this.natural.chatHeadFollow.y) > 0,
    }
  }
}

export function mmdScreenInwardness(viewport: PlacementRect, headX: number): number | null {
  return screenInwardness([viewport], headX)
}
