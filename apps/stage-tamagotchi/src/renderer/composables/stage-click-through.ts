import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

/** The padding around the character rect inside which the stage reads pixels back, in DIP. */
export const stageClickThroughPaddingDip = 8

/** How long the stage keeps the pointer after the last hit before a miss may release it. */
export const stageClickThroughReleaseDebounceMs = 250

/** Consecutive misses that release the pointer. One stray miss on a hair edge keeps it. */
const releaseMisses = 2

export interface StageClickThroughState {
  /** Whether the window lets clicks through to the desktop. The stage window starts click-through. */
  ignoring: boolean
  /** Consecutive readback misses since the last hit. */
  misses: number
  /** Time of the last hit, on the caller's clock; `null` before the first one. */
  lastHitMs: number | null
}

export interface StageClickThroughInput {
  nowMs: number
  /** Cursor in window DIP; `null` when unknown. */
  cursor: { x: number, y: number } | null
  /** The character rect in window DIP, unpadded; `null` before the scene publishes one. */
  rect: PlacementRect | null
  /**
   * Keeps the pointer whatever the pixels say: the controls are open or under the cursor, the stage is paused, a drag
   * is running, or click-through is unavailable on this platform.
   */
  forceCapture: boolean
  /**
   * This frame's alpha readback at the cursor: `true` when she is drawn there. `undefined` when the caller did not
   * read this frame, which leaves the state as it is.
   */
  hit?: boolean
}

export interface StageClickThroughResult {
  state: StageClickThroughState
  /** Whether `ignoring` differs from the previous state, so the caller calls `setIgnoreMouseEvents`. */
  changed: boolean
}

export function createStageClickThroughState(): StageClickThroughState {
  return { ignoring: true, misses: 0, lastHitMs: null }
}

/** Whether the cursor is inside `rect` grown by {@link stageClickThroughPaddingDip} on every side. */
export function isInsidePaddedRect(cursor: { x: number, y: number } | null, rect: PlacementRect | null): boolean {
  if (!cursor || !rect)
    return false
  const pad = stageClickThroughPaddingDip
  return cursor.x >= rect.x - pad && cursor.x <= rect.x + rect.width + pad
    && cursor.y >= rect.y - pad && cursor.y <= rect.y + rect.height + pad
}

/**
 * Decides whether the full-screen stage lets the pointer through, one animation frame at a time.
 *
 * Use when:
 * - The desktop stage page runs its per-frame hit test
 *
 * Expects:
 * - `input.hit` comes from at most one readback this frame, taken only while the cursor is inside the padded rect
 *
 * Returns:
 * - The next state. Outside the padded rect the window lets clicks through at once, without a readback. Inside, a hit
 *   captures at once, so the first click on her never falls through; a release needs two misses in a row and
 *   {@link stageClickThroughReleaseDebounceMs} since the last hit.
 */
export function resolveStageClickThrough(state: StageClickThroughState, input: StageClickThroughInput): StageClickThroughResult {
  const next = nextState(state, input)
  return { state: next, changed: next.ignoring !== state.ignoring }
}

function nextState(state: StageClickThroughState, input: StageClickThroughInput): StageClickThroughState {
  if (input.forceCapture)
    return { ignoring: false, misses: 0, lastHitMs: input.nowMs }

  if (!isInsidePaddedRect(input.cursor, input.rect))
    return { ignoring: true, misses: 0, lastHitMs: state.lastHitMs }

  if (input.hit === undefined)
    return state

  if (input.hit)
    return { ignoring: false, misses: 0, lastHitMs: input.nowMs }

  const misses = state.misses + 1
  if (state.ignoring)
    return { ...state, misses }

  const debounced = state.lastHitMs === null || input.nowMs - state.lastHitMs >= stageClickThroughReleaseDebounceMs
  return { ignoring: misses >= releaseMisses && debounced, misses, lastHitMs: state.lastHitMs }
}
