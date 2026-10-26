import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { NaturalBreathOutput } from './breath'
import type { GestureKind, naturalEmotions } from './emotions'
import type { NaturalFaceOutput } from './face'
import type { GazePoint } from './gaze'
import type { PostureHome } from './posture'
import type { RandomStream } from './random'

export interface Live2DNaturalMotionOptions {
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
export type NaturalMotionEvent = NaturalImpulseEvent | NaturalHoldEvent | NaturalGestureEvent | NaturalAttentionEvent | NaturalTouchEvent | NaturalPlacementEvent

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
