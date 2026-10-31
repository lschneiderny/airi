import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { BodyIntent, Vec3 } from '../types'

/** Continuous idle time in milliseconds required before requesting a sit. */
export const IDLE_TO_SIT_MS = 120_000

/** Minimum time in milliseconds between stance changes. */
export const STANCE_MIN_DWELL_MS = 3_000

/** Inputs required to produce a renderer-neutral body intent for one frame. */
export interface BodyDirectorInput {
  /** Epoch milliseconds supplied by the caller; this module never reads a clock. */
  nowMs: number
  /** The resolved mode, attention, and away overlay from stage-shared. */
  performance: Pick<PerformanceState, 'mode' | 'attention' | 'away'>
  /** Optional target positions in model units. */
  cursorPoint: Vec3 | null
  chatPoint: Vec3 | null
  cameraPoint: Vec3 | null
  /** Imported stance clips available for this model. */
  slots: {
    sit: boolean
    sleep: boolean
  }
}

/** Hysteresis state supplied to the next director call. */
export interface BodyDirectorMemory {
  /** Latest finite, non-decreasing epoch time in milliseconds. */
  readonly nowMs: number | null
  /** Start of the current uninterrupted idle period, in epoch milliseconds. */
  readonly idleSinceMs: number | null
  /** Last stance returned by the director. */
  readonly stance: BodyIntent['stance']
  /** Time the last stance change was returned, or null before one occurs. */
  readonly stanceSinceMs: number | null
}

/** Initial pure director state for a newly loaded rig. */
export const initialBodyDirectorMemory: BodyDirectorMemory = Object.freeze({
  nowMs: null,
  idleSinceMs: null,
  stance: 'stand',
  stanceSinceMs: null,
})

function attentionIntent(input: BodyDirectorInput): BodyIntent['attention'] {
  const { attention } = input.performance

  if (attention === 'camera')
    return { kind: 'camera', point: input.cameraPoint }
  if (attention === 'cursor')
    return { kind: 'cursor', point: input.cursorPoint }

  // Screen targets are supplied by the renderer-specific adapter; the chat
  // glance point is owned by the Natural adapter, not the body director.
  if (attention === 'screen')
    return { kind: 'screen', point: null }

  return { kind: 'aside', point: null }
}

/**
 * Produces a body stance and attention target without side effects.
 *
 * Time is supplied in milliseconds and clamped against the latest finite
 * timestamp in memory. Idle duration and stance dwell are retained only in the
 * returned memory, which callers pass into the next frame.
 */
export function decideBody(
  input: BodyDirectorInput,
  previous: BodyDirectorMemory,
): { intent: BodyIntent, memory: BodyDirectorMemory } {
  const finiteNowMs = Number.isFinite(input.nowMs) ? input.nowMs : previous.nowMs ?? 0
  const nowMs = previous.nowMs === null ? finiteNowMs : Math.max(previous.nowMs, finiteNowMs)
  const idleSinceMs = input.performance.mode === 'idle'
    ? previous.idleSinceMs ?? nowMs
    : null

  let desiredStance: BodyIntent['stance'] = 'stand'
  if (input.performance.away) {
    if (input.slots.sleep)
      desiredStance = 'sleep'
  }
  else if (
    input.performance.mode === 'idle'
    && input.slots.sit
    && idleSinceMs !== null
    && nowMs - idleSinceMs >= IDLE_TO_SIT_MS
  ) {
    desiredStance = 'sit'
  }

  let stance = previous.stance
  let stanceSinceMs = previous.stanceSinceMs
  if (desiredStance !== stance) {
    const currentStanceSlotMissing = (stance === 'sit' && !input.slots.sit)
      || (stance === 'sleep' && !input.slots.sleep)
    const dwellElapsed = stanceSinceMs === null || nowMs - stanceSinceMs >= STANCE_MIN_DWELL_MS
    if (currentStanceSlotMissing || dwellElapsed) {
      stance = desiredStance
      stanceSinceMs = nowMs
    }
  }

  return {
    intent: {
      stance,
      attention: attentionIntent(input),
      facingYaw: 0,
    },
    memory: {
      nowMs,
      idleSinceMs,
      stance,
      stanceSinceMs,
    },
  }
}
