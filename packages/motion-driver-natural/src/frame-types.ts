import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'

import type { NaturalBreathOutput } from './breath'
import type { CueGestureKind } from './cue-gestures'
import type { GestureKind, naturalEmotions } from './emotions'
import type { NaturalFaceOutput } from './face'
import type { GazePoint } from './gaze'
import type { IdleBehaviourKind } from './idle-activities'
import type { PostureHome, Vec3 } from './posture'
import type { RandomStream } from './random'

export type NaturalTouchRegion = 'head' | 'body'

/**
 * A touch gesture as every renderer's touch classifier reports it. A poke point is region-relative, X right and Y down.
 * The stage routes these to the conductor and the situation, so a pet or poke means the same on every renderer.
 */
export type NaturalTouchGesture
  = | { kind: 'poke', region: NaturalTouchRegion, x: number, y: number }
    | { kind: 'pet-start' }
    | { kind: 'pet-end', durationMs: number }

export interface NaturalRigTraits {
  bodyFromHeadPhysics: { x: boolean, y: boolean, z: boolean }
}

export interface NaturalMotionOptions {
  /** Seeds every layer stream; equal seeds replay equal motion. Takes precedence over `random`. */
  seed?: number
  /** Draws the seed when `seed` is absent. @default Math.random */
  random?: RandomStream
  /** Rest posture; `desk` is the calibration fixture of the liveliness gate. @default 'product' */
  home?: PostureHome
  /**
   * QA seam: the per-emotion recipe table that impulses, held emotions, gestures, and mood read.
   * Scorer mutation tests pass a modified copy; the controller reads it and never mutates it.
   * @default naturalEmotions
   */
  emotionTable?: typeof naturalEmotions
}

/**
 * What the controller performed, reported to a {@link NaturalMotionObserver}. `at` is active seconds
 * on the controller clock: the start of the grid step that first performs the change.
 *
 * `side` is the sign (-1 or 1) a layer applies to its sided axes and its one-sided brow:
 * - `impulse`: a negative side raises the left brow (`browLY`);
 * - `hold`: side 1 raises the left brow; `null` while nothing is held;
 * - `gesture`: the clip's sided axes; drawn even for clips without sided axes.
 */
export type NaturalMotionEvent = NaturalImpulseEvent | NaturalHoldEvent | NaturalGestureEvent | NaturalAttentionEvent | NaturalTouchEvent | NaturalPlacementEvent | NaturalGlanceEvent | NaturalIdleEvent

/** A self-directed idle behaviour started, or the one that ran ended; `behaviour` names it in both cases. */
export interface NaturalIdleEvent {
  kind: 'idle'
  at: number
  phase: 'start' | 'end'
  behaviour: IdleBehaviourKind
}

/** A chat fixation or screen-change glance actually started. Point is normalized eye space; hold is seconds. */
export interface NaturalGlanceEvent {
  kind: 'glance'
  at: number
  cause: 'chat-sent' | 'chat-unfold' | 'chat-typing' | 'screen-change'
  point: GazePoint
  hold: number
}

/** The eased placement yaw changed by at least 0.005, or placement was disabled. No motion or RNG effect. */
export interface NaturalPlacementEvent {
  kind: 'placement'
  at: number
  inward: number
  yawBias: number
}

/** A cursor episode changed phase; distance is measured in head widths from the eye anchor. */
export interface NaturalAttentionEvent {
  kind: 'attention'
  at: number
  phase: 'notice' | 'engage' | 'release' | 'dismiss'
  distance: number
}

/** A poke was performed or the pet target became active or inactive. */
export interface NaturalTouchEvent {
  kind: 'touch'
  at: number
  touch: 'poke' | 'pet-start' | 'pet-end'
  region?: 'head' | 'body'
}

/** An emotion episode started or escalated. `band` is the band performed, `clear` while band recruitment is off; `intensity` is clamped to 0..1. */
export interface NaturalImpulseEvent {
  kind: 'impulse'
  at: number
  emotion: PerformanceEmotion
  band: Band
  intensity: number
  side: -1 | 1
}

/**
 * The held emotion or its side changed. `emotion` is `null` when the hold is released or while held
 * emotions are switched off; `strength` is the commanded 0..1 strength before per-model strengths.
 */
export interface NaturalHoldEvent {
  kind: 'hold'
  at: number
  emotion: PerformanceEmotion | null
  strength: number
  side: -1 | 1 | null
}

/** A gesture clip started; `shake-or-drop` reports the clip it chose. */
export interface NaturalGestureEvent {
  kind: 'gesture'
  at: number
  gesture: Exclude<GestureKind, 'shake-or-drop'>
  side: -1 | 1
}

/**
 * Receives performed events synchronously inside `advance` and the setters that advance.
 * It only receives values the controller already computed, so attaching one never changes motion.
 * An observer that throws is reported with `console.error`; the step it interrupted still completes.
 */
export type NaturalMotionObserver = (event: NaturalMotionEvent) => void

/** Normalized pose commands in [-1, 1]. */
export interface NaturalMotionPose {
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
export interface NaturalMotionVoice {
  /** Speech output is playing; breath becomes shallower. */
  speaking: boolean
  /** Speech is active or ended moments ago; lipsync owns the mouth, so silent mouth openings stop. */
  speechActiveOrRecent: boolean
  /** Lipsync mouth level in [0, 1] (the scene's `mouthOpenSize`, unscaled), sent every frame; its onsets drive speech emphasis nods. */
  level: number
}

/**
 * Observational state of the latest advance, assembled at its next 120 Hz grid endpoint.
 * Pose channels remain interpolated; these terms sum to the grid head before its clamp
 * and the breath pitch addition. Axes are yaw, pitch, roll in Natural units.
 * Latest events start at seq 1, remain available after completion, and are null before
 * their first start. Reading them never consumes an event or requires an observer.
 */
export interface NaturalBodyIntent {
  /** Active seconds requested by the frame; the grid endpoint can lead by up to one tick. */
  readonly time: number
  readonly head: {
    readonly posture: Readonly<Vec3>
    readonly slow: Readonly<Vec3>
    readonly emphasis: Readonly<Vec3>
    readonly impulse: Readonly<Vec3>
    readonly pet: Readonly<Vec3>
    readonly held: Readonly<Vec3>
    readonly gesture: Readonly<Vec3>
    readonly cue: Readonly<Vec3>
  }
  readonly posture: {
    readonly shiftSeq: number
    readonly amplitude: number
    readonly shiftRate: number
    readonly activityGain: number
  }
  readonly gaze: {
    /** First match wins: pet override, cursor fixation, chat fixation, aside, free. */
    readonly on: 'cursor' | 'chat' | 'pet' | 'aside' | 'free'
    readonly saccadeSeq: number
    readonly saccadeSize: number
  }
  readonly breath: {
    readonly phase: number
    /** Effective period, including the held-emotion period scale, in seconds. */
    readonly period: number
    readonly scale: number
  }
  readonly voice: {
    readonly speaking: boolean
    readonly level: number
    readonly slow: number
    readonly onsetSeq: number
    /** `at` is the detector's active time at acceptance; nods have unsided side 1. */
    readonly emphasis: {
      readonly seq: number
      readonly at: number
      readonly magnitude: number
      readonly tau: number
      readonly kind: 'nod' | 'tilt'
      readonly side: -1 | 1
    } | null
  }
  readonly mood: {
    readonly valence: number
    readonly arousal: number
    readonly tension: number
  }
  readonly energy: {
    readonly mode: PerformanceMode
    readonly away: boolean
    readonly reactingUntil: number
  }
  /** Raw held target and eased level; the side is retained after release. */
  readonly held: {
    readonly emotion: PerformanceEmotion | null
    readonly strength: number
    readonly level: number
    readonly side: -1 | 1
  }
  /** Includes poke surprise episodes and accepted escalations; at is grid-step start. */
  readonly impulse: {
    readonly seq: number
    readonly at: number
    readonly emotion: PerformanceEmotion
    readonly band: Band
    readonly intensity: number
    readonly side: -1 | 1
  } | null
  readonly gesture: {
    readonly seq: number
    readonly at: number
    readonly kind: Exclude<GestureKind, 'shake-or-drop'>
    readonly side: -1 | 1
    readonly scale: number
    readonly lifetime: number
  } | null
  readonly cue: {
    readonly seq: number
    readonly start: number
    readonly end: number
    readonly kind: CueGestureKind
    readonly count: number
    readonly side: -1 | 1
  } | null
  readonly touch: {
    /** Every performed poke, including those whose surprise is deduplicated. */
    readonly poke: {
      readonly seq: number
      readonly at: number
      readonly region: NaturalTouchRegion
      readonly x: number
      readonly y: number
    } | null
    readonly pet: {
      readonly level: number
      readonly active: boolean
      /** Eased head-relative hand coordinates. */
      readonly x: number
      readonly y: number
    }
  }
  readonly react: {
    readonly seq: number
    readonly at: number
    readonly kind: 'wake' | 'screen-change'
  } | null
  readonly attention: {
    readonly approach: number
    readonly cursorShare: number
  }
}

export interface NaturalMotionFrame {
  pose: NaturalMotionPose
  /** Unclamped gaze point before head compensation. */
  fixation: GazePoint
  face: NaturalFaceOutput
  /** `blinkFactor` multiplies eye openness: 1 open, 0 closed. */
  blink: { blinkFactor: number }
  breath: NaturalBreathOutput
}
