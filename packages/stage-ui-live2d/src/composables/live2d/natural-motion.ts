import type { ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { NaturalBreathOutput } from './natural-motion/breath'
import type { NaturalFaceOutput } from './natural-motion/face'
import type { GazePoint } from './natural-motion/gaze'
import type { NaturalEpisode } from './natural-motion/mood'
import type { PostureHome, Vec3 } from './natural-motion/posture'
import type { RandomStream } from './natural-motion/random'
import type { Live2DRigProfile } from './natural-motion/rig-profile'
import type { Live2DTouchRegion } from './touch-gestures'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { EMOTION_VALUES } from '../../constants/emotions'
import { NaturalBlinkScheduler } from './natural-motion/blink'
import { NaturalBodyLayer } from './natural-motion/body'
import { NaturalBreathLayer } from './natural-motion/breath'
import { naturalEmotions } from './natural-motion/emotions'
import { NaturalPerformanceEnergy } from './natural-motion/energy'
import { NaturalFaceLayer } from './natural-motion/face'
import { NaturalAttentionShifts, NaturalGazeLayer } from './natural-motion/gaze'
import { NaturalGestures } from './natural-motion/gestures'
import { NaturalHoldLayer } from './natural-motion/hold'
import { NaturalImpulses } from './natural-motion/impulses'
import { NaturalMood } from './natural-motion/mood'
import { NaturalPostureLayers, postureHomes } from './natural-motion/posture'
import { createRandomStream, deriveSeed } from './natural-motion/random'
import { NaturalSpeechEmphasis, SpeechOnsetShifts } from './natural-motion/speech-emphasis'
import { NaturalPetLayer, pokeDirection, pokeGlanceHold, pokeStrength, pokeSurpriseDedupeSeconds } from './natural-motion/touch'

export interface Live2DNaturalMotionOptions {
  /** Seeds every layer stream; equal seeds replay equal motion. Takes precedence over `random`. */
  seed?: number
  /** Draws the seed when `seed` is absent. @default Math.random */
  random?: RandomStream
  /** Rest posture; `desk` is the calibration fixture of the liveliness gate. @default 'product' */
  home?: PostureHome
}

/** Normalized pose commands in [-1, 1]. */
export interface Live2DNaturalMotionPose {
  headX: number
  headY: number
  headZ: number
  /** `null` when rig physics derives this body axis from the head, so the consumer skips the write. */
  bodyX: number | null
  bodyY: number | null
  bodyZ: number | null
  /** Shared by both eyes, so pupils stay conjugate. */
  eyeX: number
  eyeY: number
}

/** Voice activity inputs. The host derives both from speech output and voice detection. */
export interface Live2DNaturalMotionVoice {
  /** Speech output is playing; breath becomes shallower. */
  speaking: boolean
  /** Speech is active or ended moments ago; lipsync owns the mouth, so silent mouth openings stop. */
  speechActiveOrRecent: boolean
  /** Lipsync mouth level in [0, 1] (the scene's `mouthOpenSize`, unscaled), sent every frame; its onsets drive speech emphasis nods. */
  level: number
}

export interface Live2DNaturalMotionFrame {
  pose: Live2DNaturalMotionPose
  /** Unclamped gaze point before head compensation. */
  fixation: GazePoint
  face: NaturalFaceOutput
  /** `blinkFactor` multiplies eye openness: 1 open, 0 closed. */
  blink: { blinkFactor: number }
  breath: NaturalBreathOutput
}

// Layer stream indices for `deriveSeed`. Appending layers keeps existing sequences stable.
// Index 4 belonged to the v1 fixation rule and now seeds the gaze layer that replaces it.
const streamIndex = { drift: 0, continuous: 1, gain: 2, shift: 3, gaze: 4, attention: 5, body: 6, face: 7, blink: 8, breath: 9, emphasis: 10, impulses: 11, gestures: 12 }

// Fixed integration grid. Processes advance only in whole steps and the output is
// interpolated between the two grid states around the current time, so frame
// partition never changes the sampled path and draws stay deterministic per seed.
const step = 1 / 120

// Critically damped follower time constants (seconds) of the v1 cursor head bias.
const followers = {
  cursorX: 0.14,
  cursorY: 0.17,
}

type Axis = keyof typeof followers

// Desktop reactions. Wake lifts the head slightly and glances at the camera; a screen
// change glances at the desk for 0.4 s. The wake nudge stays small: intensity 0.4 gives a
// 0.063 normalized peak, below the smallest emotion impulse at full intensity.
const wakeNudge = { direction: [0, 1, 0] as Vec3, intensity: 0.4 }
const wakeGlanceHold = 1
const screenChangeGlanceHold = 0.4
const glanceTargets = { camera: { x: 0, y: 0 }, desk: { x: 0, y: -0.18 } }

/** Work requested between grid steps; it starts at the next step so grid states stay consistent. */
type PendingAction
  = | { kind: 'emotion', episode: NaturalEpisode }
    | { kind: 'react', reaction: 'wake' | 'screen-change' }
    | { kind: 'poke', region: Live2DTouchRegion, x: number }

interface Snapshot {
  head: Vec3
  body: Vec3
  gaze: GazePoint
  face: NaturalFaceOutput
  blinkFactor: number
  breath: NaturalBreathOutput
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function lerp(a: number, b: number, weight: number) {
  return a + (b - a) * weight
}

function lerpRecord<T extends Record<keyof T, number>>(a: T, b: T, weight: number): T {
  return Object.fromEntries(Object.keys(a).map(key => [key, lerp(a[key as keyof T], b[key as keyof T], weight)])) as T
}

/**
 * Owns autonomous posture, gaze, body, face, blink, and breath, without model or renderer state.
 * Times are monotonic seconds. The first advance establishes the time origin.
 * Suspension freezes every process and active time; resume continues from the frozen state.
 * Cursor expiry and disabled attention are represented by a null cursor.
 */
export class Live2DNaturalMotion {
  private readonly posture: NaturalPostureLayers
  private readonly gaze: NaturalGazeLayer
  private readonly body: NaturalBodyLayer
  private readonly attention: NaturalAttentionShifts
  private readonly face: NaturalFaceLayer
  private readonly blink: NaturalBlinkScheduler
  private readonly breath: NaturalBreathLayer
  private readonly energy = new NaturalPerformanceEnergy()
  private readonly mood = new NaturalMood()
  private readonly hold = new NaturalHoldLayer()
  private readonly gestures: NaturalGestures
  private emotionStrengths: Partial<Record<PerformanceEmotion, number>> = {}
  private performanceSettings = defaultExpressionPerformanceSettings
  private readonly emphasis: NaturalSpeechEmphasis
  private readonly impulses: NaturalImpulses
  private readonly onsetShifts = new SpeechOnsetShifts()
  private readonly pet = new NaturalPetLayer()
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

  constructor(options: Live2DNaturalMotionOptions = {}) {
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
    this.body = new NaturalBodyLayer(stream('body'), home)
    this.attention = new NaturalAttentionShifts(stream('attention'))
    this.face = new NaturalFaceLayer(stream('face'))
    this.blink = new NaturalBlinkScheduler(stream('blink'))
    this.breath = new NaturalBreathLayer(stream('breath'))
    this.emphasis = new NaturalSpeechEmphasis(stream('emphasis'))
    this.impulses = new NaturalImpulses(stream('impulses'))
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

  /** Applies voice activity and the mouth level from the next grid step; the mouth suppression applies immediately. */
  setVoice(voice: Live2DNaturalMotionVoice) {
    this.voice = { ...voice }
    this.face.speechActiveOrRecent = voice.speechActiveOrRecent
    this.breath.speaking = voice.speaking
  }

  /** Changes attention after advancing to this timestamp; it takes effect from the next grid step. */
  setCursor(target: GazePoint | null, nowSeconds: number) {
    this.advance(nowSeconds)
    this.cursor = target === null ? null : { x: clamp(target.x, 1), y: clamp(target.y, 1) }
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
    this.energy.setPerformanceSettings(settings.naturalBands)
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
   * `x` is the poke's horizontal position relative to the touched region's center, -1 left to
   * 1 right. The head flinches away, the face shows a brief surprise, and the gaze meets the camera.
   */
  poke(region: Live2DTouchRegion, x: number, nowSeconds: number) {
    this.advance(nowSeconds)
    this.pending.push({ kind: 'poke', region, x })
  }

  /**
   * Starts or continues a pet with the hand at `hand` (-1 left of the head center, 1 right), or
   * ends it with `null`, after advancing to this timestamp. While a pet is in progress cursor
   * attention is ignored, so the character settles into the hand instead of watching it.
   */
  setPet(hand: number | null, nowSeconds: number) {
    this.advance(nowSeconds)
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
    const c = this.pet.active ? null : this.cursor
    this.gaze.setCursor(c, stepStart)
    this.startPending(stepStart)
    this.energy.step(step)
    this.mood.step(step)
    if (this.performanceSettings.heldEmotions)
      this.hold.step(step)
    this.pet.step(step)
    this.posture.amplitudeScale = this.energy.amplitudeScale * this.pet.postureAmplitudeScale
    this.posture.shiftRateScale = this.energy.shiftRateScale
    this.gaze.cameraFixationProbability = this.energy.cameraFixationProbability
    this.gaze.targetWeights = this.energy.targetWeights
    let emphasisAcceptance = this.energy.emphasisAcceptance
    if (this.performanceSettings.mood && this.mood.active) {
      const settings = this.performanceSettings.moodDynamics
      this.posture.amplitudeScale *= Math.max(0.8, Math.min(1.2, 1 + settings.amplitude * this.mood.arousal))
      this.posture.shiftRateScale *= Math.max(0.7, Math.min(1.3, 1 + settings.shiftRate * this.mood.arousal))
      this.gaze.cameraFixationProbability = Math.max(0, Math.min(1, this.gaze.cameraFixationProbability + settings.cameraValence * this.mood.valence - settings.cameraTension * this.mood.tension))
      emphasisAcceptance = Math.max(0, Math.min(1, emphasisAcceptance + settings.emphasis * this.mood.arousal))
    }
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
    this.attention.update(this.posture, this.gaze, stepStart, step)
    // Cursor attention keeps the v1 head bias, smoothed so cursor changes never jump.
    this.follow({
      cursorX: 0.25 * (c?.x ?? 0),
      cursorY: 0.20 * (c?.y ?? 0),
    })
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
    return {
      head,
      body: this.body.step(step, followerHead).map((value, axis) => clamp(value + lean[axis], 1)) as Vec3,
      gaze,
      face: this.withHints(this.face.step(step), stepStart + step),
      blinkFactor: this.blink.step(step),
      breath: this.breath.step(step),
    }
  }

  /** Starts emotion impulses and desktop reactions requested since the previous step. */
  private startPending(at: number) {
    for (const action of this.pending.splice(0)) {
      if (action.kind === 'poke') {
        const strength = pokeStrength[action.region]
        this.impulses.nudge(pokeDirection(action.region, action.x), strength.nudge, at)
        // Surprise carries no glance of its own; a repeat within its 2 s dedupe only flinches.
        // A poke uses the `clear` band, which is how reactions run with band recruitment disabled.
        if (at - this.lastPokeSurprise >= pokeSurpriseDedupeSeconds) {
          this.lastPokeSurprise = at
          this.impulses.trigger({ id: `poke-${++this.pokes}`, emotion: 'surprised', nominal: strength.surprise, intensity: strength.surprise, band: 'clear', escalation: false }, at)
        }
        this.gaze.glance(glanceTargets.camera, pokeGlanceHold, at)
        // The fixed reacting overlay, like a desktop reaction, not the emotion energy settings.
        this.energy.react(at, 1, true)
        continue
      }
      if (action.kind === 'emotion') {
        const enabled = this.performanceSettings.heldEmotions
        if (enabled && this.emotionStrengths[action.episode.emotion] === 0)
          continue
        const gesture = enabled ? naturalEmotions[action.episode.emotion].gesture : undefined
        const started = this.impulses.trigger(action.episode, at, { head: gesture === undefined })
        if (!started)
          continue
        if (gesture)
          this.gestures.trigger(gesture, action.episode.intensity, this.performanceSettings.bands ? action.episode.band : 'clear', at)
        if (this.performanceSettings.mood)
          this.mood.add(action.episode)
        if (started.glance)
          this.gaze.glance(started.glance.point, started.glance.hold, at)
        if (started.energy)
          this.energy.react(at, action.episode.intensity)
        continue
      }
      if (action.reaction === 'wake') {
        this.impulses.nudge(wakeNudge.direction, wakeNudge.intensity, at)
        this.gaze.glance(glanceTargets.camera, wakeGlanceHold, at)
      }
      else {
        this.gaze.glance(glanceTargets.desk, screenChangeGlanceHold, at)
      }
      this.energy.react(at, 1, true)
    }
  }

  /** Adds emotion face hints and the pet face to the face layer output; with neither active every value is unchanged. */
  private withHints(face: NaturalFaceOutput, time: number): NaturalFaceOutput {
    const held = this.performanceSettings.heldEmotions && this.hold.level > 0
    const hints = this.impulses.hints(time, held && this.hold.emotion
      ? { emotion: this.hold.emotion, scale: 1 - this.performanceSettings.held.accentScale * this.hold.level }
      : undefined)
    const pet = this.pet.face()
    const result = {
      ...face,
      eyeOpenMultiplier: face.eyeOpenMultiplier * pet.eyeOpenMultiplier,
      eyeOpenHint: face.eyeOpenHint + hints.eyeOpen,
      browY: face.browY + hints.browY + pet.browY,
      browAngle: face.browAngle + hints.browAngle,
      browLY: face.browLY + hints.browY + hints.browLY + pet.browY,
      browRY: face.browRY + hints.browY + hints.browRY + pet.browY,
      browLAngle: face.browLAngle + hints.browAngle,
      browRAngle: face.browRAngle + hints.browAngle,
      eyeSmile: face.eyeSmile + hints.eyeSmile + pet.eyeSmile,
      mouthForm: face.mouthForm + hints.mouthForm + pet.mouthForm + (this.performanceSettings.mood && this.mood.active ? this.performanceSettings.moodDynamics.mouthForm * this.mood.valence : 0),
      cheek: face.cheek + pet.cheek,
    }
    if (held) {
      const hold = this.hold.face()
      const share = 1 - this.pet.level
      result.eyeOpenMultiplier *= 1 + (hold.eyeOpenMultiplier - 1) * share
      // Additive lid hints and one-sided brow raises overlap pet channels too.
      result.eyeOpenHint += hold.eyeOpenHint * share
      result.browY += hold.browY * share
      result.browLY += (hold.browY + Math.max(0, hold.oneSidedBrow)) * share
      result.browRY += (hold.browY + Math.max(0, -hold.oneSidedBrow)) * share
      result.browAngle += hold.browAngle
      result.browLAngle += hold.browAngle
      result.browRAngle += hold.browAngle
      result.eyeSmile += hold.eyeSmile * share
      result.mouthForm += hold.mouthForm * share
      result.cheek += hold.cheek * share
      result.silentMouthOpen += hold.mouthOpen
    }
    return result
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
