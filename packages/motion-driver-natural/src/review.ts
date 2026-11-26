import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'

import type { GazeTargetKind } from './gaze'
import type { IdleBehaviourKind } from './idle-activities'
import type { IdleErrandKind } from './idle-errands'

/**
 * Review gains: how much of each always-on idle layer reaches the frame. They exist so a reviewer can mute, solo or
 * resize one layer on a running model and name the one that looks wrong.
 *
 * - Every gain is 1 by default, and the default leaves every frame bit-identical.
 * - A gain scales what a layer contributes, never its random process: the layer keeps stepping and drawing, so the
 *   other layers and every later draw stay as they were, and a gain set back to 1 returns to the same motion.
 *   `shiftRate` is the exception: it changes when shifts start, so the shift schedule differs from then on.
 * - The controller clamps each gain to 0..2 (`shiftRate` to 0.1..2) and eases a change over 0.25 s.
 */
export interface NaturalReviewGains {
  /** Size of the posture shifts: the head's moves from one held pose to the next. */
  shifts: number
  /** How often posture shifts start; it divides the hold between them. */
  shiftRate: number
  /** Slow drift of the rest pose. */
  drift: number
  /** Continuous sub-second head motion. */
  wobble: number
  /** How far the eyes leave the camera for any target: fixations, glances and the cursor. */
  eyes: number
  /** How far the body follows the head. Offsets that an act or an emotion adds to the body are not scaled. */
  body: number
}

export const neutralReviewGains: Readonly<NaturalReviewGains> = Object.freeze({ shifts: 1, shiftRate: 1, drift: 1, wobble: 1, eyes: 1, body: 1 })

/** What drives the head and the eyes at the latest grid step, for a reviewer's readout. */
export interface NaturalReviewState {
  /** Active seconds of the controller clock. */
  time: number
  mode: PerformanceMode
  head: {
    /** Counts posture shifts; a new value is a new shift. */
    seq: number
    /** The shift is still moving; false while the pose is held. */
    moving: boolean
    /** Length of the latest shift in normalized head units, after the amplitude scales and the review gain. */
    size: number
    /** The eyes moved to a new target 30 to 80 ms before this shift. Only with pep does the target set the shift's direction. */
    withGlance: boolean
  }
  eyes: {
    /** Counts saccades; a new value is a new eye movement. */
    seq: number
    target: GazeTargetKind | 'pet'
  }
  /** The idle behaviour in progress, or `null`. */
  act: IdleBehaviourKind | null
  /** The errand a host is realising, or `null`. */
  errand: IdleErrandKind | null
  /** Something other than idle life that moves her now, or `null`. */
  owner: 'pet' | 'cursor' | 'gesture' | 'emotion' | null
}
