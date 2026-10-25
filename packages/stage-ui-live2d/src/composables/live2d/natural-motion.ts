import type { ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { NaturalBreathOutput } from './natural-motion/breath'
import type { NaturalFaceOutput } from './natural-motion/face'
import type { Live2DNaturalMotionFrame, Live2DNaturalMotionOptions, Live2DNaturalMotionVoice, NaturalMotionEvent, NaturalMotionObserver } from './natural-motion/frame-types'
import type { GazePoint } from './natural-motion/gaze'
import type { NaturalEpisode } from './natural-motion/mood'
import type { PendingAction } from './natural-motion/pending-actions'
import type { Vec3 } from './natural-motion/posture'
import type { Live2DRigProfile } from './natural-motion/rig-profile'
import type { Live2DTouchRegion } from './touch-gestures'

import { errorMessageFrom } from '@moeru/std'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { EMOTION_VALUES } from '../../constants/emotions'
import { NaturalBlinkScheduler } from './natural-motion/blink'
import { NaturalBodyLayer } from './natural-motion/body'
import { NaturalBreathLayer } from './natural-motion/breath'
import { mapCursor, NaturalCursorAttention, releaseAt } from './natural-motion/cursor-attention'
import { naturalEmotions } from './natural-motion/emotions'
import { NaturalPerformanceEnergy } from './natural-motion/energy'
import { NaturalFaceLayer } from './natural-motion/face'
import { withHints } from './natural-motion/face-hints'
import { NaturalAttentionShifts, NaturalGazeLayer } from './natural-motion/gaze'
import { NaturalGestures } from './natural-motion/gestures'
import { NaturalHoldLayer } from './natural-motion/hold'
import { NaturalImpulses } from './natural-motion/impulses'
import { clamp, lerp, lerpRecord } from './natural-motion/interpolation'
import { NaturalMood } from './natural-motion/mood'
import { modulateByMood, moodMouthForm } from './natural-motion/mood-modulation'
import { startPending } from './natural-motion/pending-actions'
import { NaturalPostureLayers, postureHomes } from './natural-motion/posture'
import { createRandomStream, deriveSeed } from './natural-motion/random'
import { NaturalSpeechEmphasis, SpeechOnsetShifts } from './natural-motion/speech-emphasis'
import { NaturalPetLayer } from './natural-motion/touch'

export type { Live2DNaturalMotionFrame, Live2DNaturalMotionOptions, Live2DNaturalMotionPose, Live2DNaturalMotionVoice, NaturalAttentionEvent, NaturalGestureEvent, NaturalHoldEvent, NaturalImpulseEvent, NaturalMotionEvent, NaturalMotionObserver, NaturalTouchEvent } from './natural-motion/frame-types'

// Layer stream indices for `deriveSeed`. Appending layers keeps existing sequences stable.
// Index 4 belonged to the v1 fixation rule and now seeds the gaze layer that replaces it.
const streamIndex = { drift: 0, continuous: 1, gain: 2, shift: 3, gaze: 4, attention: 5, body: 6, face: 7, blink: 8, breath: 9, emphasis: 10, impulses: 11, gestures: 12, cursorAttention: 13 }

// Fixed integration grid. Processes advance only in whole steps and the output is
// interpolated between the two grid states around the current time, so frame
// partition never changes the sampled path and draws stay deterministic per seed.
const step = 1 / 120

// Critically damped follower time constants (seconds): the head trails eye pursuit.
const followers = {
  cursorX: 0.22,
  cursorY: 0.26,
}
// Attention calms autonomous posture without freezing it.
const attentionCalm = 0.3

// Head widths: outer distance where cursor approach starts smoothing.
const approachFarDistance = 1.6
// Head widths: inner distance where cursor approach reaches full strength.
const approachNearDistance = 0.9
// Seconds: smoothing time for the cursor approach.
const approachSmoothingSeconds = 0.2
// Head widths above the eye anchor: threshold for the upward-cursor pose.
const aboveAnchorThreshold = 0.2
// Eye-target units: maximum upward cursor target during approach.
const aboveAnchorEyeLimit = 0.35
// Hand-relative scale: horizontal pet-hand offset for the gaze override.
const petOverrideXScale = 0.1
// Eye-target units: downward gaze override while petting.
const petOverrideY = -0.12
// Seconds: minimum pet duration before the camera glance at pet end.
const longPetDurationSeconds = 3
// Seconds: duration of the camera glance after a long pet.
const petGlanceDurationSeconds = 1.2
// Unitless pet level above which the pet owns the gaze override.
const petOverrideLevel = 0.5
// Seconds: smoothing time for the gaze-on-cursor pose response.
const cursorFixationSmoothingSeconds = 0.3
// Unitless: retained head-follow share when gaze is not fixed on the cursor.
const headFollowBaseShare = 0.4
// Unitless: additional head-follow share when gaze is fixed on the cursor.
const headFollowCursorShare = 0.6
// Unitless head-pitch contribution: downward tuck at full approach.
const approachHeadTuck = 0.05
// Unitless eye-opening reduction: softening at full approach.
const approachEyeSoftening = 0.12

type Axis = keyof typeof followers

interface Snapshot {
  head: Vec3
  body: Vec3
  gaze: GazePoint
  face: NaturalFaceOutput
  blinkFactor: number
  breath: NaturalBreathOutput
}

/**
 * Owns autonomous posture, gaze, body, face, blink, and breath, without model or renderer state.
 * Times are monotonic seconds. The first advance establishes the time origin.
 * Suspension freezes every process and active time; resume continues from the frozen state.
 * Cursor loss fades attention; deliberate dismissal also ends pursuit immediately.
 */
export class Live2DNaturalMotion {
  private readonly posture: NaturalPostureLayers
  private readonly gaze: NaturalGazeLayer
  private readonly cursorAttention: NaturalCursorAttention
  private readonly body: NaturalBodyLayer
  private readonly attention: NaturalAttentionShifts
  private readonly face: NaturalFaceLayer
  private readonly blink: NaturalBlinkScheduler
  private readonly breath: NaturalBreathLayer
  private readonly energy = new NaturalPerformanceEnergy()
  private readonly emotions: typeof naturalEmotions
  private readonly mood: NaturalMood
  private readonly hold: NaturalHoldLayer
  private readonly gestures: NaturalGestures
  private emotionStrengths: Partial<Record<PerformanceEmotion, number>> = {}
  private performanceSettings = defaultExpressionPerformanceSettings
  private readonly emphasis: NaturalSpeechEmphasis
  private readonly impulses: NaturalImpulses
  private readonly onsetShifts = new SpeechOnsetShifts()
  private readonly pet = new NaturalPetLayer()
  private petHand = { x: 0, y: 0 }
  private petStartedAt: number | null = null
  private petOverride = false
  /** Active-time deadline, including the saccade, of the grateful camera hold. */
  private petGlanceUntil = 0
  /** Gives each poke's surprise its own episode id; reaction ids reject reuse without escalation. */
  private pokes = 0
  /** Active seconds of the last poke surprise; a repeat within `pokeSurpriseDedupeSeconds` only flinches. */
  private lastPokeSurprise = Number.NEGATIVE_INFINITY
  private readonly pending: PendingAction[] = []
  /** Last `reactSeq` seen; `undefined` until the first state, which only sets the baseline. */
  private reactSeq: number | undefined
  private voice: Live2DNaturalMotionVoice = { speaking: false, speechActiveOrRecent: false, level: 0 }
  private saccadeCount = 0
  private cursor: GazePoint | null = null
  private cursorMode: 'live' | 'dismissed' = 'live'
  /** Keep the last destination while a missing cursor's attention fades. */
  private mappedCursor = mapCursor({ x: 0, y: 0 })
  private onCursor = 0
  private approach = 0
  private bodyFromHeadPhysics: Live2DRigProfile['bodyFromHeadPhysics'] = { x: false, y: false, z: false }
  private shiftCount = 0
  private readonly u = Object.fromEntries(Object.keys(followers).map(axis => [axis, 0])) as Record<Axis, number>
  private readonly x = { ...this.u }
  private lastTimestamp: number | undefined
  private activeTime = 0
  private stepIndex = 0
  private previous: Snapshot
  private next: Snapshot
  private suspended = false
  private observer: NaturalMotionObserver | null = null
  /** The hold last reported to the observer; only compared while one is attached. */
  private reportedHoldEmotion: PerformanceEmotion | null = null
  private reportedHoldSide: -1 | 1 | null = null
  /** Delivers one event to the observer; a failing observer cannot interrupt the step that reports to it. */
  private readonly notify = (event: NaturalMotionEvent) => {
    try {
      this.observer?.(event)
    }
    catch (error) {
      console.error('[natural-motion] The observer failed:', errorMessageFrom(error) ?? 'unknown error')
    }
  }

  constructor(options: Live2DNaturalMotionOptions = {}) {
    this.emotions = options.emotionTable ?? naturalEmotions
    this.mood = new NaturalMood(this.emotions)
    this.hold = new NaturalHoldLayer(this.emotions)
    const seed = options.seed ?? Math.floor((options.random ?? Math.random)() * 2 ** 32)
    const stream = (layer: keyof typeof streamIndex) => createRandomStream(deriveSeed(seed, streamIndex[layer]))
    const home = postureHomes[options.home ?? 'product']
    this.posture = new NaturalPostureLayers([...home], {
      drift: stream('drift'),
      continuous: stream('continuous'),
      gain: stream('gain'),
      shift: stream('shift'),
    })
    this.gaze = new NaturalGazeLayer(stream('gaze'))
    this.cursorAttention = new NaturalCursorAttention(stream('cursorAttention'))
    this.body = new NaturalBodyLayer(stream('body'), home)
    this.attention = new NaturalAttentionShifts(stream('attention'))
    this.face = new NaturalFaceLayer(stream('face'))
    this.blink = new NaturalBlinkScheduler(stream('blink'))
    this.breath = new NaturalBreathLayer(stream('breath'))
    this.emphasis = new NaturalSpeechEmphasis(stream('emphasis'))
    this.impulses = new NaturalImpulses(stream('impulses'), this.emotions)
    this.gestures = new NaturalGestures(stream('gestures'))
    this.previous = { head: [...home], body: this.body.pose, gaze: { x: 0, y: 0 }, face: NaturalFaceLayer.rest(), blinkFactor: 1, breath: this.breath.output }
    this.next = this.integrate()
  }

  /** Returns a fresh normalized pose, the unclamped gaze point (before head compensation), and face, blink, and breath channels. */
  advance(nowSeconds: number): Live2DNaturalMotionFrame {
    const elapsed = this.lastTimestamp === undefined ? 0 : nowSeconds - this.lastTimestamp
    this.lastTimestamp = nowSeconds
    if (!this.suspended && elapsed > 0) {
      this.activeTime += elapsed
      while (this.activeTime > this.stepIndex * step) {
        this.previous = this.next
        this.next = this.integrate()
      }
    }
    const weight = clamp((this.activeTime - (this.stepIndex - 1) * step) / step, 1)
    const { previous: a, next: b } = this
    const breath = lerpRecord(a.breath, b.breath, weight)
    const [headX, postureY, headZ] = a.head.map((value, axis) => lerp(value, b.head[axis], weight))
    // Breath coupling (0.001, see breath.ts) rides on the applied pitch, so eye compensation sees it too.
    const headY = clamp(postureY + breath.headY, 1)
    const [bodyX, bodyY, bodyZ] = a.body.map((value, axis) => lerp(value, b.body[axis], weight))
    const fixation = { x: lerp(a.gaze.x, b.gaze.x, weight), y: lerp(a.gaze.y, b.gaze.y, weight) }
    const eye = NaturalGazeLayer.eye(fixation, { x: headX, y: headY })
    const physics = this.bodyFromHeadPhysics
    return {
      pose: {
        headX,
        headY,
        headZ,
        bodyX: physics.x ? null : bodyX,
        bodyY: physics.y ? null : bodyY,
        bodyZ: physics.z ? null : bodyZ,
        eyeX: clamp(eye.x, 0.95),
        eyeY: clamp(eye.y, 0.95),
      },
      fixation,
      face: {
        ...lerpRecord(a.face, b.face, weight),
        // Grid states integrated before a voice change may still hold an opening.
        ...(this.voice.speechActiveOrRecent ? { silentMouthOpen: 0 } : {}),
      },
      blink: { blinkFactor: lerp(a.blinkFactor, b.blinkFactor, weight) },
      breath,
    }
  }

  /**
   * Reports performed impulses, holds, gestures, cursor attention, and touch to `observer`, or stops reporting with `null`.
   * Reporting never changes motion: the observer receives values the controller already computed, and
   * no event is built while no observer is attached. A newly attached observer receives the current
   * hold, if any, on the next grid step.
   */
  setObserver(observer: NaturalMotionObserver | null) {
    this.observer = observer
    this.reportedHoldEmotion = null
    this.reportedHoldSide = null
  }

  /** Applies voice activity and the mouth level from the next grid step; the mouth suppression applies immediately. */
  setVoice(voice: Live2DNaturalMotionVoice) {
    this.voice = { ...voice }
    this.face.speechActiveOrRecent = voice.speechActiveOrRecent
    this.breath.speaking = voice.speaking
  }

  /** Eye-anchored offset in head widths, Y up; attention changes from the next grid step. */
  setCursor(offset: GazePoint | null, nowSeconds: number, mode: 'live' | 'dismissed' = 'live') {
    this.advance(nowSeconds)
    this.cursor = offset === null ? null : { x: clamp(offset.x, 100), y: clamp(offset.y, 100) }
    this.cursorMode = mode
    if (this.cursor !== null)
      this.mappedCursor = mapCursor(this.cursor)
  }

  /**
   * Applies the performance state and user energy (0..1, 0.5 neutral) after advancing to this
   * timestamp. Presets cross-fade from the next grid step and no process restarts.
   * A changed `reactSeq` starts the desktop reaction named by `reactKind`; the first call only
   * records the sequence, because a reaction that happened before this controller existed is stale.
   */
  setPerformance(state: PerformanceState, energy: number, nowSeconds: number) {
    this.advance(nowSeconds)
    this.energy.setState(state, energy)
    const seen = this.reactSeq
    this.reactSeq = state.reactSeq
    if (seen !== undefined && state.reactSeq !== seen && state.reactKind !== 'none')
      this.pending.push({ kind: 'react', reaction: state.reactKind })
  }

  /**
   * Starts an episode on the next grid step after advancing to this timestamp.
   */
  impulse(episode: NaturalEpisode, nowSeconds: number) {
    this.advance(nowSeconds)
    this.pending.push({ kind: 'emotion', episode })
  }

  /** Advances first; the held target takes effect on the next grid step. Repeated targets keep their side and onset. */
  setHeldEmotion(held: { readonly emotion: PerformanceEmotion, readonly strength: number } | null, nowSeconds: number) {
    this.advance(nowSeconds)
    this.hold.set(held)
  }

  /** Per-model values are clamped to 0..2; malformed persisted entries use 1. Zero disables new emotion performance. */
  setEmotionStrengths(record: Partial<Record<PerformanceEmotion, number>>) {
    this.emotionStrengths = {}
    for (const emotion of EMOTION_VALUES) {
      const value = record[emotion]
      this.emotionStrengths[emotion] = Number.isFinite(value) ? Math.max(0, Math.min(2, value ?? 1)) : 1
    }
    this.hold.setStrengths(this.emotionStrengths)
  }

  /** The current mood afterglow; all zero at rest. */
  get moodState(): { valence: number, arousal: number, tension: number } {
    return { valence: this.mood.valence, arousal: this.mood.arousal, tension: this.mood.tension }
  }

  /** Switches apply on the next grid step. Disabled mood keeps decaying but receives no new doses. */
  setPerformanceSettings(settings: ExpressionPerformanceSettings) {
    this.performanceSettings = structuredClone(settings)
    this.impulses.setPerformanceSettings(settings.naturalBands, settings.bands)
    this.mood.setPerformanceSettings(settings.moodDynamics)
    this.hold.setSettings(settings.held)
    if (!settings.heldEmotions) {
      this.blink.intervalScale = 1
      this.breath.periodScale = 1
      this.emphasis.sizeScale = 1
    }
  }

  /**
   * Starts a poke reaction after advancing to this timestamp; it begins at the next grid step.
   * Position is relative to the touched region's center: x from -1 left to 1 right, y from
   * -1 top to 1 bottom. The head flinches away, the face shows surprise, and gaze meets the camera.
   */
  poke(region: Live2DTouchRegion, x: number, y: number, nowSeconds: number) {
    this.advance(nowSeconds)
    this.pending.push({ kind: 'poke', region, x, y })
  }

  /**
   * Starts or continues a pet with a head-relative hand (x: -1 left to 1 right, y: -1 top to
   * 1 bottom), or ends it with `null`. The pet gradually takes gaze and head from the cursor.
   */
  setPet(hand: { x: number, y: number } | null, nowSeconds: number) {
    this.advance(nowSeconds)
    if (hand !== null)
      this.petHand = { x: clamp(hand.x, 1), y: clamp(hand.y, 1) }
    this.pet.set(hand)
  }

  /** Suspension freezes every layer; resume keeps all state, so output continues without a jump. */
  setSuspended(suspended: boolean, nowSeconds: number) {
    this.advance(nowSeconds)
    this.suspended = suspended
  }

  /**
   * Applies rig ownership. Body axes that rig physics derives from the head are
   * reported as `null`; their processes keep running, so ownership changes never reset motion.
   */
  setRigProfile(profile: Pick<Live2DRigProfile, 'bodyFromHeadPhysics'>) {
    this.bodyFromHeadPhysics = { ...profile.bodyFromHeadPhysics }
  }

  /** Advances every process by one grid step and returns the new grid state. */
  private integrate(): Snapshot {
    const stepStart = this.stepIndex * step
    this.stepIndex++
    const permission = this.cursorMode === 'dismissed' || this.energy.aside || this.energy.screen ? 'dismiss' : 'full'
    if (permission === 'dismiss')
      this.petGlanceUntil = 0
    const attention = this.cursorAttention.step(step, stepStart, { cursor: this.cursor, permission })
    const mapped = this.mappedCursor
    const proximity = this.cursor !== null && permission === 'full'
      ? Math.max(0, Math.min(1, (approachFarDistance - mapped.distance) / (approachFarDistance - approachNearDistance)))
      : 0
    this.approach += (proximity * proximity * (3 - 2 * proximity) - this.approach) * (1 - Math.exp(-step / approachSmoothingSeconds))
    const above = this.cursor !== null && this.cursor.y > aboveAnchorThreshold
    this.pet.step(step)
    const cursorShare = attention.weight * (1 - this.pet.level)
    this.gaze.setCursorTarget({ x: mapped.eye.x, y: above ? Math.min(aboveAnchorEyeLimit, mapped.eye.y) : mapped.eye.y }, attention.oriented ? cursorShare : 0)
    for (const event of attention.events) {
      if (event.kind === 'notice' && stepStart >= this.petGlanceUntil)
        this.gaze.orient(stepStart)
      else if (event.kind === 'release')
        this.gaze.disengage(stepStart)
      else if (event.kind === 'dismiss')
        this.gaze.dismiss(stepStart)
      if (this.observer)
        this.notify({ kind: 'attention', at: event.at, phase: event.kind, distance: event.distance })
    }
    this.gaze.setAside(this.energy.aside, stepStart)
    // Clearing an override starts a new fixation. Defer that transition (and
    // cursor reorientation) until the long-pet camera glance has fully held.
    if (stepStart >= this.petGlanceUntil) {
      // A dismissed release tail cannot reacquire gaze when permission returns;
      // only an active pet or its still-owned tail can keep the override.
      const overriding = permission === 'full' && this.pet.level > petOverrideLevel && (this.pet.active || this.petOverride)
      if (overriding) {
        this.gaze.setOverride({ x: petOverrideXScale * this.petHand.x, y: petOverrideY }, stepStart)
      }
      else if (this.petOverride) {
        this.gaze.setOverride(null, stepStart)
        if (attention.oriented && attention.weight > releaseAt)
          this.gaze.orient(stepStart)
      }
      this.petOverride = overriding
    }
    if (this.pet.active && this.petStartedAt === null) {
      this.petStartedAt = stepStart
      if (this.observer)
        this.notify({ kind: 'touch', at: stepStart, touch: 'pet-start', region: 'head' })
    }
    else if (!this.pet.active && this.petStartedAt !== null) {
      if (permission === 'full' && stepStart - this.petStartedAt > longPetDurationSeconds)
        this.petGlanceUntil = this.gaze.glance({ x: 0, y: 0 }, petGlanceDurationSeconds, stepStart)
      this.petStartedAt = null
      if (this.observer)
        this.notify({ kind: 'touch', at: stepStart, touch: 'pet-end', region: 'head' })
    }
    const pending = this.pending.splice(0)
    if (this.observer) {
      for (const action of pending) {
        if (action.kind === 'poke')
          this.notify({ kind: 'touch', at: stepStart, touch: 'poke', region: action.region })
      }
    }
    const pokeState = startPending(pending, stepStart, { impulses: this.impulses, gaze: this.gaze, energy: this.energy, mood: this.mood, gestures: this.gestures, emotionStrengths: this.emotionStrengths, settings: this.performanceSettings, emotions: this.emotions, notify: this.observer ? this.notify : undefined }, { pokes: this.pokes, lastPokeSurprise: this.lastPokeSurprise })
    this.pokes = pokeState.pokes
    this.lastPokeSurprise = pokeState.lastPokeSurprise
    this.energy.step(step)
    this.mood.step(step)
    if (this.performanceSettings.heldEmotions)
      this.hold.step(step)
    if (this.observer)
      this.reportHold(stepStart)
    const moodScales = modulateByMood({
      amplitudeScale: this.energy.amplitudeScale * this.pet.postureAmplitudeScale * (1 - attentionCalm * cursorShare),
      shiftRateScale: this.energy.shiftRateScale,
      cameraFixationProbability: this.energy.cameraFixationProbability,
      emphasisAcceptance: this.energy.emphasisAcceptance,
    }, this.mood, this.performanceSettings)
    this.posture.amplitudeScale = moodScales.amplitudeScale
    this.posture.shiftRateScale = moodScales.shiftRateScale
    this.gaze.cameraFixationProbability = moodScales.cameraFixationProbability
    this.gaze.targetWeights = this.energy.targetWeights
    let emphasisAcceptance = moodScales.emphasisAcceptance
    if (this.performanceSettings.heldEmotions) {
      const mod = this.hold.modulation()
      this.posture.amplitudeScale *= mod.amplitude
      this.gaze.cameraFixationProbability = Math.max(0, Math.min(1, this.gaze.cameraFixationProbability + mod.cameraFixation))
      // Gaze normalizes relative weights at selection. Leave the neutral weights untouched.
      if (mod.deskWeight !== 0)
        this.gaze.targetWeights = { ...this.gaze.targetWeights, desk: this.gaze.targetWeights.desk + mod.deskWeight }
      emphasisAcceptance = Math.max(0, Math.min(1, emphasisAcceptance + mod.nodAcceptance))
      this.blink.intervalScale = mod.blinkInterval
      this.breath.periodScale = mod.breathPeriod
      this.emphasis.sizeScale = mod.nodSize
    }
    // Speech onsets can lead a due posture shift, so detection runs before attention and posture see the shift time.
    const emphasis = this.emphasis.step(step, this.voice.level, emphasisAcceptance)
    this.onsetShifts.update(this.posture, this.emphasis, this.voice.speaking)
    if (this.performanceSettings.heldEmotions) {
      const remaining = this.gestures.activeUntil() - stepStart
      // Postpone only a due shift. Adding the remaining duration every step would accumulate minutes of idle delay.
      if (remaining > 0.5 && this.posture.secondsUntilShift <= step)
        this.posture.postponeShift(remaining)
    }
    if (stepStart >= this.petGlanceUntil)
      this.attention.update(this.posture, this.gaze, stepStart, step)
    this.onCursor += (Number(this.gaze.onCursor) - this.onCursor) * (1 - Math.exp(-step / cursorFixationSmoothingSeconds))
    const headShare = cursorShare * (headFollowBaseShare + headFollowCursorShare * this.onCursor)
    this.follow({
      cursorX: headShare * mapped.head.x,
      cursorY: headShare * (above ? mapped.head.y * (1 - this.approach) - approachHeadTuck * this.approach : mapped.head.y),
    })
    this.posture.continuousScale = this.performanceSettings.heldEmotions ? this.gestures.continuousScale(stepStart + step) : 1
    const posture = this.posture.step(step, [this.x.cursorX, this.x.cursorY, 0])
    // Eye compensation sees the complete head pose.
    const impulse = this.impulses.headOffset(stepStart + step)
    const petHead = this.pet.headOffset()
    const heldPosture = this.performanceSettings.heldEmotions ? this.hold.posture() : [0, 0, 0]
    const gestureHead = this.performanceSettings.heldEmotions ? this.gestures.headOffset(stepStart + step) : [0, 0, 0]
    const head = posture.map((value, axis) => {
      let total = value + emphasis[axis] + impulse[axis] + petHead[axis]
      if (heldPosture[axis] !== 0)
        total += heldPosture[axis]
      if (gestureHead[axis] !== 0)
        total += gestureHead[axis]
      return clamp(total, 1)
    }) as Vec3
    // Emotion recruitment owns its body lean; following its head pulse would leak clear into body.
    // Physics-owned body axes still follow the full head through rig physics, outside Natural's control.
    // The pet tilt is a whole-head gesture like a desktop nudge, so the body follows it.
    const nudge = this.impulses.headOffset(stepStart + step, false)
    const followerHead = posture.map((value, axis) => {
      const total = value + emphasis[axis] + nudge[axis] + petHead[axis]
      // Held posture recruits the follower at every band; short gestures own their separate strong-only body offset.
      return clamp(heldPosture[axis] === 0 ? total : total + heldPosture[axis], 1)
    }) as Vec3
    if (this.posture.shiftCount !== this.shiftCount) {
      this.shiftCount = this.posture.shiftCount
      this.body.beginShift()
    }
    const gaze = this.gaze.step(step)
    if (this.gaze.saccadeCount !== this.saccadeCount) {
      this.saccadeCount = this.gaze.saccadeCount
      this.blink.onGazeShift(this.gaze.saccadeSize)
      this.face.onGazeShift(this.gaze.saccadeSize)
    }
    const lean = this.impulses.bodyOffset(stepStart + step)
    if (this.performanceSettings.heldEmotions) {
      const gestureBody = this.gestures.bodyOffset(stepStart + step)
      for (const axis of [0, 1, 2] as const) {
        if (gestureBody[axis] !== 0)
          lean[axis] += gestureBody[axis]
      }
    }
    const face = withHints(this.face.step(step), stepStart + step, this.impulses, this.pet, moodMouthForm(this.mood, this.performanceSettings), this.performanceSettings.heldEmotions && this.hold.level > 0 ? { hold: this.hold, accentScale: this.performanceSettings.held.accentScale } : undefined)
    face.eyeOpenMultiplier *= 1 - approachEyeSoftening * this.approach
    return {
      head,
      body: this.body.step(step, followerHead).map((value, axis) => clamp(value + lean[axis], 1)) as Vec3,
      gaze,
      face,
      blinkFactor: this.blink.step(step),
      breath: this.breath.step(step),
    }
  }

  /** Reports the performed hold when its emotion or side differs from the last report; switched-off held emotions perform none. */
  private reportHold(at: number) {
    const emotion = this.performanceSettings.heldEmotions ? this.hold.emotion : null
    const side = emotion === null ? null : this.hold.side
    if (emotion === this.reportedHoldEmotion && side === this.reportedHoldSide)
      return
    this.reportedHoldEmotion = emotion
    this.reportedHoldSide = side
    this.notify({ kind: 'hold', at, emotion, strength: emotion === null ? 0 : this.hold.strength, side })
  }

  /** Exact two-stage critically damped follower update over one grid step. */
  private follow(targets: Record<Axis, number>) {
    for (const [axis, target] of Object.entries(targets) as [Axis, number][]) {
      const h = step / followers[axis]
      const e = Math.exp(-h)
      const oldU = this.u[axis]
      this.u[axis] = target + (oldU - target) * e
      this.x[axis] = target + ((this.x[axis] - target) + (oldU - target) * h) * e
    }
  }
}
