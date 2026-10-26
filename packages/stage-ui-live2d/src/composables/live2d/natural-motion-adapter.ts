import type { ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { EmotionHold } from './expression/hold'
import type { Live2DMotionDriver } from './live2d'
import type { PixiLive2DInternalModel } from './motion-manager'
import type { Live2DNaturalMotionFrame, Live2DNaturalMotionOptions, Live2DNaturalMotionPose, NaturalChatInput } from './natural-motion'
import type { NaturalFaceOutput } from './natural-motion/face'
import type { NaturalEpisode } from './natural-motion/mood'
import type { PostureHome } from './natural-motion/posture'
import type { Live2DRigProfile, NaturalChannel } from './natural-motion/rig-profile'
import type { Live2DTouchRegion } from './touch-gestures'

import { Live2DNaturalMotion } from './natural-motion'

type Core = PixiLive2DInternalModel['coreModel']
interface FocusModel {
  coreModel: Pick<Core, 'getParameterValueByIndex' | 'setParameterValueByIndex'>
  updateFocus: () => void
}

/** Per-frame host inputs. Times share the SDK clock passed to `frame`. */
export interface Live2DNaturalMotionAttention {
  driver: Live2DMotionDriver
  manualActive: boolean
  springActive: boolean
  exclusive: boolean
  performance: PerformanceState
  /** User energy 0..1, 0.5 neutral. */
  energy: number
  voice: {
    speaking: boolean
    /** Lipsync mouth level in [0, 1]. */
    level: number
    /** SDK seconds at which `speaking` last turned false; `null` when speech never ended. */
    speechEndedAtSeconds: number | null
  }
  /** The user's auto-blink setting; `false` keeps Natural blinks off. */
  autoBlink: boolean
  manualBreathActive: boolean
  /** Parameter ids animated by the playing explicit clip. */
  clipOwnedIds: ReadonlySet<string>
  /** Host emotion queue; the adapter empties it on every composition. */
  pendingEmotions: NaturalEpisode[]
  /** The emotion held on the face now; ignored (never kept) while Natural is inactive. */
  heldEmotion: EmotionHold | null
  /** The model's per-emotion strength multipliers; missing emotions use 1. */
  emotionStrengths: Partial<Record<PerformanceEmotion, number>>
  /** Cursor offset from the eye anchor in head widths (y up), or `null` when there is no cursor. */
  cursor: { x: number, y: number } | null
  /** Cursor attention is switched off or an ACT aside cue looks away from it. */
  cursorDismissed: boolean
  /** Screen inwardness of the head (-1..1, positive toward screen +x), or `null` when there is no placement signal. */
  placement: number | null
  /**
   * Chat target, typing, and typed-send counters, or `null` when the setting is off or the host has no chat.
   * Hidden chat is an object with a `null` target, so the controller keeps its sequence baselines.
   */
  chat: NaturalChatInput | null
  /** Host poke queue, `x` and `y` relative to the touched region's center (-1..1, y down); emptied like `pendingEmotions`. */
  pendingPokes: { region: Live2DTouchRegion, x: number, y: number }[]
  /** Hand position relative to the head center (-1..1, y down) while the user pets the head, otherwise `null`. */
  pet: { x: number, y: number } | null
}

/**
 * Counters the devtools Natural lab stores in a trace's metadata. They prove which channels the
 * adapter wrote during a capture; they never change composition. `resetDiagnostics` zeroes them
 * when a capture starts.
 */
export interface Live2DNaturalMotionDiagnostics {
  /** Rest posture the controller drifts around. */
  home: PostureHome
  /** Compositions counted since the last reset. */
  frames: number
  /** Mean posture ownership weight (0 released, 1 full Natural) over those compositions, or 0 before any. */
  weightMean: number
  /** Writes to ParamBodyAngleX/Y/Z. Stays 0 on a rig whose physics derives the body from the head. */
  bodyWrites: number
  /** Natural channels left to physics, summed per composition. */
  physicsOutputSkips: number
}

type ChannelRange = NonNullable<ReturnType<Live2DRigProfile['channels']['get']>>
type PostureAxis = keyof Live2DNaturalMotionPose & NaturalChannel

const postureAxes: readonly PostureAxis[] = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ', 'eyeX', 'eyeY']
const eyelidChannels: readonly NaturalChannel[] = ['eyeLOpen', 'eyeROpen']
/** Face channels composed as additive offsets, scaled to the channel half-range. */
const faceOffsets: Partial<Record<NaturalChannel, keyof NaturalFaceOutput>> = {
  browLY: 'browLY',
  browRY: 'browRY',
  browLAngle: 'browLAngle',
  browRAngle: 'browRAngle',
  eyeLSmile: 'eyeSmile',
  eyeRSmile: 'eyeSmile',
  mouthForm: 'mouthForm',
  cheek: 'cheek',
}

/** Share of the Natural posture offset kept on channels an explicit clip animates. */
const clipResidual = 0.1
/** Lipsync release (200 ms) plus its handoff hold (500 ms). */
const speechHandoffSeconds = 0.7
/** Expression-closed eyes at or below the blink plugin threshold are left untouched. */
const closedEyeThreshold = 0.15
/** Natural micro-narrowing never lowers open lids below this outside a blink. */
const eyelidFloor = 0.2

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const clampRange = (value: number, range: ChannelRange) => Math.max(range.min, Math.min(range.max, value))

/**
 * Composes one eyelid on the post-motion value `base`. Blinks close open lids fully, the
 * micro multiplier and emotion hint never push open lids below 0.2, and expression-closed
 * lids (`base <= 0.15`) keep their value, so a hint never reopens them.
 */
function composeEyelid(base: number, multiplier: number, hint: number, blinkFactor: number) {
  if (base <= closedEyeThreshold)
    return base
  const lifted = base * multiplier + (base > eyelidFloor ? hint : 0)
  return clamp01(Math.max(lifted, Math.min(base, eyelidFloor)) * blinkFactor)
}

/**
 * Owns late Natural composition for one loaded model. Frame timestamps are SDK seconds.
 * The active clock freezes across pause/visibility changes, but not visible stalls.
 * Disposal restores the original SDK method before the model is destroyed.
 *
 * Ownership: every write happens inside the SDK `updateFocus` wrap, which the SDK brackets
 * with `saveParameters()` and `loadParameters()`, so each write is a stateless overlay on
 * that frame's post-motion values. Physics outputs and physics-derived body axes are never
 * written. Posture fades out under manual, spring, or exclusive control; clip-owned
 * posture keeps a 10% residual and clip-owned face channels are skipped.
 */
/** Value equality of two chat inputs, so an unchanged input rebuilt every composition is not forwarded again. */
function sameChat(a: NaturalChatInput | null, b: NaturalChatInput | null) {
  if (a === null || b === null)
    return a === b
  return a.typing === b.typing && a.sentSeq === b.sentSeq && a.sentWords === b.sentWords && a.unfoldSeq === b.unfoldSeq
    && (a.target === null || b.target === null ? a.target === b.target : a.target.x === b.target.x && a.target.y === b.target.y)
}

export class Live2DNaturalMotionAdapter {
  private readonly controller: Live2DNaturalMotion
  private readonly originalFocus: () => void
  private posture: (ChannelRange & { axis: PostureAxis })[] = []
  private eyelids: ChannelRange[] = []
  private offsets: (ChannelRange & { key: keyof NaturalFaceOutput })[] = []
  private mouth: ChannelRange | undefined
  private breath: ChannelRange | undefined
  private time = 0
  private frameTime: number | undefined
  /** Last SDK timestamp, kept across pauses for the speech handoff window. */
  private now = Number.NaN
  private paused = false
  private hidden = false
  /** Natural driver without an exclusive owner: the controller runs, face, blink, and breath compose. */
  private active = false
  /** Posture ownership target; manual and spring control also release it. */
  private eligible = false
  private weight = 0
  private velocity = 0
  private destination = 0
  private start = 0
  private duration = 0
  private points = [0, 0, 0, 0]
  private disposed = false
  private readonly home: PostureHome
  /** Natural channels present on the rig that physics outputs own, so composition skips them. */
  private physicsOwnedChannels = 0
  private diagnosticFrames = 0
  private weightSum = 0
  private bodyWrites = 0
  private physicsOutputSkips = 0
  /** Last placement handed to the controller; a fresh controller starts without a placement signal. */
  private placement: number | null = null
  /** Called after every controller step with that step's placement input and applied yaw bias, for QA diagnostics. */
  onPlacementStep: ((placement: number | null, yawBias: number) => void) | null = null
  /** Last chat input handed to the controller; a fresh controller starts without a chat signal. */
  private chat: NaturalChatInput | null = null
  private readonly visibilityChanged = () => {
    this.hidden = this.visibility?.hidden ?? false
    this.frameTime = undefined
    this.updateSuspension()
  }

  constructor(
    private readonly model: FocusModel,
    rigProfile: Live2DRigProfile,
    private readonly attention: () => Live2DNaturalMotionAttention,
    private readonly visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
    random = Math.random,
    /** Constructor overrides: the stage selects its posture home; fixed seeds and emotion tables serve QA runs. */
    options: Pick<Live2DNaturalMotionOptions, 'seed' | 'home' | 'emotionTable'> = {},
  ) {
    this.home = options.home ?? 'product'
    this.controller = new Live2DNaturalMotion({ random, seed: options.seed, home: this.home, emotionTable: options.emotionTable })
    this.controller.setSuspended(true, 0)
    this.setRigProfile(rigProfile)
    this.originalFocus = model.updateFocus
    // NOTICE:
    // SDK focus follows AIRI final plugins and precedes physics.
    // Late composition avoids saved-pose feedback and duplicate focus offsets.
    // Source: pixi-live2d-display Cubism4InternalModel.update().
    // Remove this wrapper when the SDK exposes a public pre-physics composition hook.
    model.updateFocus = () => this.compose()
    this.visibilityChanged()
    visibility?.addEventListener('visibilitychange', this.visibilityChanged)
  }

  /** Applies rig ownership; call again when physics loads after the model. */
  setRigProfile(profile: Live2DRigProfile) {
    const owned = (channel: NaturalChannel) => {
      const range = profile.channels.get(channel)
      return range && !profile.physicsOutputs.has(range.id) ? range : undefined
    }
    this.physicsOwnedChannels = [...profile.channels.values()].filter(range => profile.physicsOutputs.has(range.id)).length
    this.posture = postureAxes.flatMap((axis) => {
      const range = owned(axis)
      return range ? [{ ...range, axis }] : []
    })
    this.eyelids = eyelidChannels.flatMap(channel => owned(channel) ?? [])
    this.offsets = (Object.entries(faceOffsets) as [NaturalChannel, keyof NaturalFaceOutput][]).flatMap(([channel, key]) => {
      const range = owned(channel)
      return range ? [{ ...range, key }] : []
    })
    this.mouth = owned('mouthOpen')
    this.breath = owned('breath')
    this.controller.setRigProfile(profile)
  }

  /** Read-only snapshot of the capture counters; the lab reads it once when a capture ends. */
  get diagnostics(): Live2DNaturalMotionDiagnostics {
    return {
      home: this.home,
      frames: this.diagnosticFrames,
      weightMean: this.diagnosticFrames ? this.weightSum / this.diagnosticFrames : 0,
      bodyWrites: this.bodyWrites,
      physicsOutputSkips: this.physicsOutputSkips,
    }
  }

  resetDiagnostics() {
    this.diagnosticFrames = 0
    this.weightSum = 0
    this.bodyWrites = 0
    this.physicsOutputSkips = 0
  }

  /**
   * The Natural controller this adapter drives. QA attaches its observer here (`natural.setObserver`);
   * the adapter owns every other call, so callers must not advance or configure it directly.
   */
  get natural(): Live2DNaturalMotion {
    return this.controller
  }

  /** The Natural controller's mood afterglow, read by the stage for LLM state feedback. */
  get mood() {
    return this.controller.moodState
  }

  /** Forwards the expression-performance switches and tunables to the Natural controller. */
  setPerformanceSettings(settings: ExpressionPerformanceSettings) {
    this.controller.setPerformanceSettings(settings)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.frameTime = undefined
    this.updateSuspension()
  }

  frame(nowSeconds: number) {
    if (this.disposed)
      return
    if (!this.paused && !this.hidden && this.frameTime !== undefined)
      this.time += nowSeconds - this.frameTime
    this.frameTime = nowSeconds
    this.now = nowSeconds
  }

  private updateSuspension() {
    this.controller.setSuspended(this.paused || this.hidden || !this.active, this.time)
  }

  private blend() {
    if (this.duration === 0)
      return
    const t = this.time >= this.start + this.duration ? 1 : (this.time - this.start) / this.duration
    const s = 1 - t
    const [a, b, c, d] = this.points
    this.weight = s ** 3 * a + 3 * s ** 2 * t * b + 3 * s * t ** 2 * c + t ** 3 * d
    this.velocity = 3 * (s ** 2 * (b - a) + 2 * s * t * (c - b) + t ** 2 * (d - c)) / this.duration
    if (t === 1) {
      this.weight = this.destination
      this.velocity = 0
      this.duration = 0
    }
  }

  private compose() {
    const attention = this.attention()
    // Strengths first: every controller setter below advances time and can start an episode that
    // an earlier frame queued, and that episode must see this frame's per-model strengths.
    this.controller.setEmotionStrengths(attention.emotionStrengths)
    const { driver, manualActive, springActive, exclusive, voice } = attention
    // Explicit clips never suspend Natural; the clip mask below limits what it writes.
    const active = driver === 'natural' && !exclusive
    const eligible = active && !manualActive && !springActive
    this.blend()
    if (eligible !== this.eligible) {
      this.eligible = eligible
      this.destination = eligible ? 1 : 0
      const nominal = eligible ? 0.45 : 0.20
      const bound = this.velocity > 0 ? 1 - this.weight : this.weight
      this.duration = this.velocity === 0 ? nominal : Math.min(nominal, 3 * bound / Math.abs(this.velocity))
      this.start = this.time
      this.points = [this.weight, this.weight + this.velocity * this.duration / 3, this.destination, this.destination]
    }
    if (active !== this.active) {
      this.active = active
      this.updateSuspension()
    }

    const ended = voice.speechEndedAtSeconds
    // NaN before the first frame keeps a recorded speech end inside the handoff window.
    const mouthAllowed = !voice.speaking && (ended === null || this.now - ended > speechHandoffSeconds)
    this.controller.setPerformance(attention.performance, attention.energy, this.time)
    this.controller.setVoice({ speaking: voice.speaking, speechActiveOrRecent: !mouthAllowed, level: voice.level })
    // Emotions queued while Natural is inactive are stale by the time it resumes.
    for (const emotion of attention.pendingEmotions.splice(0)) {
      if (active)
        this.controller.impulse(emotion, this.time)
    }
    // Touch follows the same rule: a poke or pet from while Natural was inactive is stale.
    for (const poke of attention.pendingPokes.splice(0)) {
      if (active)
        this.controller.poke(poke.region, poke.x, poke.y, this.time)
    }
    this.controller.setPet(active ? attention.pet : null, this.time)
    this.controller.setHeldEmotion(active ? attention.heldEmotion : null, this.time)
    this.controller.setCursor(attention.cursor, this.time, attention.cursorDismissed ? 'dismissed' : 'live')
    // Forwarded on change only: the controller treats a repeated value as a no-op, but every `null`
    // would stamp a placement event into an observed capture.
    if (attention.placement !== this.placement) {
      this.placement = attention.placement
      this.controller.setPlacement(attention.placement, this.time)
    }
    // Forwarded on change only, like placement: the host rebuilds the input object every composition.
    if (!sameChat(attention.chat, this.chat)) {
      this.chat = attention.chat && { ...attention.chat, target: attention.chat.target && { ...attention.chat.target } }
      this.controller.setChat(attention.chat, this.time)
    }
    const frame = this.controller.advance(this.time)
    this.onPlacementStep?.(this.placement, this.controller.placementYawBias)
    this.diagnosticFrames++
    this.weightSum += this.weight
    this.physicsOutputSkips += this.physicsOwnedChannels
    // SDK focus creates synthetic values for absent IDs. Full ownership must
    // bypass those writes, not merely overwrite the model's existing channels.
    if (this.weight < 1)
      this.originalFocus.call(this.model)
    if (this.weight > 0)
      this.composePosture(frame.pose, attention.clipOwnedIds)
    if (active)
      this.composeFace(frame, attention, mouthAllowed)
  }

  private composePosture(pose: Live2DNaturalMotionPose, clipOwnedIds: ReadonlySet<string>) {
    const core = this.model.coreModel
    for (const range of this.posture) {
      const command = pose[range.axis]
      // Rig physics derives this body axis from the head.
      if (command === null) {
        this.physicsOutputSkips++
        continue
      }
      const base = core.getParameterValueByIndex(range.index)
      const natural = range.neutral + command * (command >= 0 ? range.max - range.neutral : range.neutral - range.min)
      let written: number
      if (clipOwnedIds.has(range.id))
        written = clampRange(base + (natural - range.neutral) * clipResidual * this.weight, range)
      else
        written = this.weight === 1 ? natural : base + (natural - base) * this.weight
      core.setParameterValueByIndex(range.index, written)
      if (range.axis.startsWith('body'))
        this.bodyWrites++
    }
  }

  private composeFace({ face, blink, breath }: Live2DNaturalMotionFrame, attention: Live2DNaturalMotionAttention, mouthAllowed: boolean) {
    const core = this.model.coreModel
    const free = (range: ChannelRange) => !attention.clipOwnedIds.has(range.id)
    const blinkFactor = attention.autoBlink ? blink.blinkFactor : 1
    for (const range of this.eyelids.filter(free)) {
      const base = core.getParameterValueByIndex(range.index)
      core.setParameterValueByIndex(range.index, composeEyelid(base, face.eyeOpenMultiplier, face.eyeOpenHint, blinkFactor))
    }
    for (const range of this.offsets.filter(free)) {
      const base = core.getParameterValueByIndex(range.index)
      core.setParameterValueByIndex(range.index, clampRange(base + face[range.key] * (range.max - range.min) / 2, range))
    }
    if (this.mouth && free(this.mouth) && mouthAllowed) {
      const base = core.getParameterValueByIndex(this.mouth.index)
      core.setParameterValueByIndex(this.mouth.index, clampRange(base + face.silentMouthOpen, this.mouth))
    }
    if (this.breath && free(this.breath) && !attention.manualBreathActive)
      core.setParameterValueByIndex(this.breath.index, clampRange(breath.value, this.breath))
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    this.visibility?.removeEventListener('visibilitychange', this.visibilityChanged)
    this.model.updateFocus = this.originalFocus
  }
}
