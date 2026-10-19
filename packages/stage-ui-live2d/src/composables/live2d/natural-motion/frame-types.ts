import type { NaturalBreathOutput } from './breath'
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
