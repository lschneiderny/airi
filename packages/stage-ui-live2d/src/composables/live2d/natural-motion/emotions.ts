import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { GazePoint } from './gaze'
import type { FaceHints } from './impulses'
import type { Vec3 } from './posture'

/** Head, face, and glance hints that one emotion impulse adds on top of every other layer. */
interface EmotionSpec {
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

/** Short head clips that an emotion can trigger; the clip shapes live with the gesture layer. `shake-or-drop` plays one of the two at random. */
export type GestureKind = 'laugh' | 'recoil' | 'shake' | 'drop' | 'shake-or-drop' | 'sway' | 'tilt-in' | 'look-away' | 'nod-off'

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
  happy: {
    impulse: { head: [0, 0.9, 0.3], sided: [2], hints: { browY: 0.3, eyeSmile: 0.65, mouthForm: 0.5 } },
    mood: [0.7, 0.5, -0.2],
    held: {
      face: { browY: 0.5, browAngle: 0, eyeSmile: 1.6, mouthForm: 1, eyeOpenMultiplier: 1, eyeOpenHint: 0, cheek: 0.4, mouthOpen: 0 },
      posture: [0, 0.10, 0.06],
      sided: [2],
      modulation: { blinkInterval: 1, breathPeriod: 0.9, amplitude: 1.15, cameraFixation: 0.15, deskWeight: 0, nodSize: 1.3, nodAcceptance: 0.15 },
    },
    gesture: 'laugh',
  },
  sad: {
    impulse: { head: [0, -0.8, 0.2], sided: [2], hints: { browAngle: 0.3, mouthForm: -0.4, eyeOpen: -0.15 } },
    mood: [-0.6, -0.5, 0.1],
    held: {
      face: { browY: -0.2, browAngle: 0.9, eyeSmile: 0, mouthForm: -0.8, eyeOpenMultiplier: 0.75, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 },
      posture: [0, -0.18, 0.04],
      sided: [2],
      modulation: { blinkInterval: 1.3, breathPeriod: 1.15, amplitude: 0.7, cameraFixation: -0.25, deskWeight: 0.3, nodSize: 0.7, nodAcceptance: -0.15 },
    },
  },
  angry: {
    impulse: { head: [0, -0.4, 0], sided: [], hints: { browY: -0.4, browAngle: -0.4, mouthForm: -0.3 } },
    mood: [-0.5, 0.6, 0.8],
    held: {
      face: { browY: -0.7, browAngle: -1, eyeSmile: 0, mouthForm: -0.7, eyeOpenMultiplier: 0.85, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 },
      posture: [0, -0.10, 0],
      sided: [],
      modulation: { blinkInterval: 1.2, breathPeriod: 0.8, amplitude: 0.85, cameraFixation: 0.1, deskWeight: 0, nodSize: 1.4, nodAcceptance: 0.1 },
    },
    gesture: 'shake-or-drop',
  },
  think: {
    impulse: { head: [0, 0, 0.4], sided: [2], hints: {}, oneSidedBrow: 0.2, glance: { x: 0.3, y: 0.25 } },
    mood: [0, -0.15, 0.15],
    held: {
      face: { browY: 0, browAngle: -0.2, oneSidedBrow: 0.4, eyeSmile: 0, mouthForm: -0.2, eyeOpenMultiplier: 0.9, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 },
      posture: [0.08, 0.08, 0.08],
      sided: [0, 2],
      modulation: { blinkInterval: 1.1, breathPeriod: 1, amplitude: 0.8, cameraFixation: -0.3, deskWeight: 0, nodSize: 0.8, nodAcceptance: -0.1 },
    },
  },
  surprised: {
    impulse: { head: [0, 0.8, 0], sided: [], hints: { browY: 0.6, eyeOpen: 0.15 } },
    mood: [0.1, 0.8, 0.35],
    held: {
      face: { browY: 1, browAngle: 0, eyeSmile: 0, mouthForm: -0.1, eyeOpenMultiplier: 1, eyeOpenHint: 0.25, cheek: 0, mouthOpen: 0.3 },
      posture: [0, 0.06, 0],
      sided: [],
      modulation: { blinkInterval: 2, breathPeriod: 0.8, amplitude: 1, cameraFixation: 0.2, deskWeight: 0, nodSize: 1, nodAcceptance: 0 },
    },
    gesture: 'recoil',
  },
  awkward: {
    impulse: { head: [0, 0, 0.5], sided: [2], hints: { browY: 0.15, mouthForm: -0.1 }, glance: { x: 0.3, y: -0.2 } },
    mood: [-0.25, 0.15, 0.6],
    held: {
      face: { browY: 0.2, browAngle: 0.4, eyeSmile: 0.4, mouthForm: 0.3, eyeOpenMultiplier: 1, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 },
      posture: [0.10, -0.04, 0.06],
      sided: [0, 2],
      modulation: { blinkInterval: 0.8, breathPeriod: 0.9, amplitude: 1.05, cameraFixation: -0.3, deskWeight: 0.15, nodSize: 0.9, nodAcceptance: 0 },
    },
    gesture: 'sway',
  },
  question: {
    impulse: { head: [0, 0, 0.8], sided: [2], hints: {}, oneSidedBrow: 0.25 },
    mood: [0, 0.1, 0.1],
    held: {
      face: { browY: 0, browAngle: 0, oneSidedBrow: 0.6, eyeSmile: 0, mouthForm: 0, eyeOpenMultiplier: 1, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 },
      posture: [0, 0, 0.14],
      sided: [2],
      modulation: { blinkInterval: 1, breathPeriod: 1, amplitude: 1, cameraFixation: 0.1, deskWeight: 0, nodSize: 1, nodAcceptance: 0 },
    },
  },
  curious: {
    impulse: { head: [0, 0, 0.8], sided: [2], hints: {}, oneSidedBrow: 0.25 },
    mood: [0.2, 0.3, 0],
    held: {
      face: { browY: 0.4, browAngle: 0, oneSidedBrow: 0.3, eyeSmile: 0, mouthForm: 0.2, eyeOpenMultiplier: 1, eyeOpenHint: 0.1, cheek: 0, mouthOpen: 0 },
      posture: [0, 0.04, 0.12],
      sided: [2],
      modulation: { blinkInterval: 1, breathPeriod: 1, amplitude: 1.05, cameraFixation: 0.15, deskWeight: 0, nodSize: 1, nodAcceptance: 0 },
    },
  },
  neutral: { mood: [0, 0, 0] },
  love: {
    impulse: { head: [0, 0.3, 0.6], sided: [2], hints: { eyeSmile: 0.5, mouthForm: 0.4 } },
    mood: [0.6, 0.2, -0.1],
    held: {
      face: { browY: 0.3, browAngle: 0.3, eyeSmile: 1.4, mouthForm: 0.8, eyeOpenMultiplier: 1, eyeOpenHint: 0, cheek: 0.8, mouthOpen: 0 },
      posture: [0, 0.04, 0.10],
      sided: [2],
      modulation: { blinkInterval: 1.1, breathPeriod: 1, amplitude: 0.95, cameraFixation: 0.25, deskWeight: 0, nodSize: 1.1, nodAcceptance: 0.05 },
    },
    gesture: 'tilt-in',
  },
  flustered: {
    impulse: { head: [0.4, -0.3, 0.3], sided: [0, 2], hints: { eyeSmile: 0.3, browAngle: 0.2 }, glance: { x: 0.35, y: -0.15 } },
    mood: [0.2, 0.5, 0.4],
    held: {
      face: { browY: 0.2, browAngle: 0.6, eyeSmile: 0.6, mouthForm: 0.4, eyeOpenMultiplier: 0.9, eyeOpenHint: 0, cheek: 1.6, mouthOpen: 0 },
      posture: [0.12, -0.10, 0.06],
      sided: [0, 2],
      modulation: { blinkInterval: 0.7, breathPeriod: 0.75, amplitude: 1.1, cameraFixation: -0.35, deskWeight: 0.25, nodSize: 0.9, nodAcceptance: 0 },
    },
    gesture: 'look-away',
  },
  sleepy: {
    impulse: { head: [0, -0.5, 0.2], sided: [2], hints: { eyeOpen: -0.15 } },
    mood: [0, -0.6, -0.2],
    held: {
      face: { browY: -0.2, browAngle: 0.2, eyeSmile: 0, mouthForm: 0, eyeOpenMultiplier: 0.45, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 },
      posture: [0, -0.14, 0.08],
      sided: [2],
      modulation: { blinkInterval: 1.6, breathPeriod: 1.35, amplitude: 0.6, cameraFixation: -0.2, deskWeight: 0.2, nodSize: 0.6, nodAcceptance: -0.25 },
    },
    gesture: 'nod-off',
  },
} satisfies Record<PerformanceEmotion, NaturalEmotionSpec>
