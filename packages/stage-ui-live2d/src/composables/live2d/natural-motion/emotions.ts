import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { GazePoint } from './gaze'
import type { FaceHints } from './impulses'
import type { Vec3 } from './posture'

/** Head, face, and glance hints that one emotion impulse adds on top of every other layer. */
export interface EmotionSpec {
  /** Head direction `(X yaw, Y pitch, Z roll)`; `sided` axes take a random sign shared with the glance and brow side. */
  head: Vec3
  sided: (0 | 1 | 2)[]
  hints: Partial<Omit<FaceHints, 'browLY' | 'browRY'>>
  /** Raise of one brow, on the random side. */
  oneSidedBrow?: number
  /** Glance target; X takes the random side. */
  glance?: GazePoint
}

/**
 * Sustained face, posture, and modulation targets of a held emotion.
 *
 * Multipliers equal 1 at rest. `cameraFixation`, `deskWeight`, and `nodAcceptance` are
 * additive deltas that equal 0 at rest.
 */
export interface HeldSpec {
  face: {
    browY: number
    browAngle: number
    oneSidedBrow?: number
    eyeSmile: number
    mouthForm: number
    eyeOpenMultiplier: number
    eyeOpenHint: number
    cheek: number
    mouthOpen: number
  }
  posture: Vec3
  sided: (0 | 1 | 2)[]
  modulation: {
    blinkInterval: number
    breathPeriod: number
    amplitude: number
    cameraFixation: number
    deskWeight: number
    nodSize: number
    nodAcceptance: number
  }
}

/** Short head clips that an emotion can trigger; the clip shapes live with the gesture layer. */
export type GestureKind = 'laugh' | 'recoil' | 'shake' | 'drop' | 'sway' | 'tilt-in' | 'look-away' | 'nod-off'

export interface NaturalEmotionSpec {
  /** Absent for emotions that do nothing, such as neutral. */
  impulse?: EmotionSpec
  /** Valence, arousal, and tension per unit of mood dose. */
  mood: readonly [number, number, number]
  held?: HeldSpec
  gesture?: GestureKind
}

/**
 * Per-emotion Natural tables in one place. Neutral has no impulse: it does nothing.
 *
 * Impulse directions retain the existing emotion vocabulary. Their lengths bound the head
 * displacement; body lean uses the corresponding unit direction.
 */
export const naturalEmotions: Record<PerformanceEmotion, NaturalEmotionSpec> = {
  happy: { impulse: { head: [0, 0.9, 0.3], sided: [2], hints: { browY: 0.3, eyeSmile: 0.65, mouthForm: 0.5 } }, mood: [0.7, 0.5, -0.2] },
  sad: { impulse: { head: [0, -0.8, 0.2], sided: [2], hints: { browAngle: 0.3, mouthForm: -0.4, eyeOpen: -0.15 } }, mood: [-0.6, -0.5, 0.1] },
  angry: { impulse: { head: [0, -0.4, 0], sided: [], hints: { browY: -0.4, browAngle: -0.4, mouthForm: -0.3 } }, mood: [-0.5, 0.6, 0.8] },
  think: { impulse: { head: [0, 0, 0.4], sided: [2], hints: {}, oneSidedBrow: 0.2, glance: { x: 0.3, y: 0.25 } }, mood: [0, -0.15, 0.15] },
  surprised: { impulse: { head: [0, 0.8, 0], sided: [], hints: { browY: 0.6, eyeOpen: 0.15 } }, mood: [0.1, 0.8, 0.35] },
  awkward: { impulse: { head: [0, 0, 0.5], sided: [2], hints: { browY: 0.15, mouthForm: -0.1 }, glance: { x: 0.3, y: -0.2 } }, mood: [-0.25, 0.15, 0.6] },
  question: { impulse: { head: [0, 0, 0.8], sided: [2], hints: {}, oneSidedBrow: 0.25 }, mood: [0, 0.1, 0.1] },
  curious: { impulse: { head: [0, 0, 0.8], sided: [2], hints: {}, oneSidedBrow: 0.25 }, mood: [0.2, 0.3, 0] },
  neutral: { mood: [0, 0, 0] },
  love: { impulse: { head: [0, 0.3, 0.6], sided: [2], hints: { eyeSmile: 0.5, mouthForm: 0.4 } }, mood: [0.6, 0.2, -0.1] },
  flustered: { impulse: { head: [0.4, -0.3, 0.3], sided: [0, 2], hints: { eyeSmile: 0.3, browAngle: 0.2 }, glance: { x: 0.35, y: -0.15 } }, mood: [0.2, 0.5, 0.4] },
  sleepy: { impulse: { head: [0, -0.5, 0.2], sided: [2], hints: { eyeOpen: -0.15 } }, mood: [0, -0.6, -0.2] },
} satisfies Record<PerformanceEmotion, NaturalEmotionSpec>
