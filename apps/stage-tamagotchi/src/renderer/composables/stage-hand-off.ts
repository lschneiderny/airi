import type { StageRow, StageRowSlot } from '@proj-airi/stage-shared/stage-world'

import { stageDisplayFor } from '@proj-airi/stage-shared/stage-world'

/** How long hand-off stays off after a move the main process could not confirm. */
export const stageHandOffHoldMs = 10_000

/** A root that moved less than this, in model units, keeps its heading. */
const headingEpsilon = 1e-6

export interface StageHandOffState {
  /** The stage display of the last host state: the display the camera is calibrated for. `null` before the first one. */
  displayId: string | null
  /** The display a move invoke is in flight for. */
  movingTo: string | null
  /** The sign of her last movement along x; 0 before she has moved. */
  heading: number
  lastRootX: number | null
}

export function createStageHandOffState(): StageHandOffState {
  return { displayId: null, movingTo: null, heading: 0, lastRootX: null }
}

/**
 * How the stage display of a host state relates to the one before it.
 *
 * - `same`: unchanged
 * - `first`: the first state of this page
 * - `walked`: the move this page asked for was confirmed. Her root keeps its place and only the camera changes
 * - `placed`: the main process put the window on another display by itself (a display change, a new home display), so
 *   she has to be teleported to where the window is
 */
export type StageDisplayChange = 'same' | 'first' | 'walked' | 'placed'

/** Records the stage display of a host state. Call it for every state, from an event or from an invoke result. */
export function observeStageDisplay(state: StageHandOffState, stageDisplayId: string): { state: StageHandOffState, change: StageDisplayChange } {
  if (stageDisplayId === state.displayId)
    return { state, change: 'same' }
  const change = state.displayId === null ? 'first' : stageDisplayId === state.movingTo ? 'walked' : 'placed'
  return { state: { ...state, displayId: stageDisplayId }, change }
}

export interface StageMoveInput {
  /** `null` while the stage has no world yet. */
  row: StageRow | null
  rootX: number | null
  /** False while the window must stay where it is: hand-off is off, held, or the user drags her. */
  enabled: boolean
}

/**
 * Decides, one animation frame at a time, whether the stage window must move to another display.
 *
 * Returns the display to move to, at most once per move: `movingTo` stays set until {@link settleStageMove}. The
 * heading is tracked on every frame, also while hand-off is off, so it is current when hand-off turns on.
 */
export function planStageMove(state: StageHandOffState, input: StageMoveInput): { state: StageHandOffState, moveTo: string | null } {
  let next = state
  if (input.rootX !== state.lastRootX) {
    const moved = input.rootX !== null && state.lastRootX !== null && Math.abs(input.rootX - state.lastRootX) > headingEpsilon
    next = { ...state, lastRootX: input.rootX, heading: moved ? Math.sign(input.rootX! - state.lastRootX!) : state.heading }
  }
  if (!input.enabled || !input.row || input.rootX === null || next.displayId === null || next.movingTo !== null)
    return { state: next, moveTo: null }

  const wanted = stageDisplayFor(input.row, next.displayId, input.rootX, next.heading)
  if (wanted === null || wanted === next.displayId)
    return { state: next, moveTo: null }
  return { state: { ...next, movingTo: wanted }, moveTo: wanted }
}

/** Ends the move in flight, confirmed or not. */
export function settleStageMove(state: StageHandOffState): StageHandOffState {
  return state.movingTo === null ? state : { ...state, movingTo: null }
}

/**
 * Whether no display shows her: the window is on its way to another display, or her root is outside the range in which
 * the display under the camera draws any of her. The page then lets every click through and hides the canvas, so a
 * window that is between two displays never takes the pointer or draws her in the wrong place.
 */
export function isStageCharacterUnseen(state: StageHandOffState, slot: StageRowSlot | null, rootX: number | null): boolean {
  if (state.movingTo !== null)
    return true
  return slot !== null && rootX !== null && (rootX < slot.visible.minX || rootX > slot.visible.maxX)
}

/** How long the cursor must stay on one display before Follow me makes it the home display. */
export const followMeDwellMs = 30_000

export interface FollowMeState {
  /** The display the cursor is on; `null` while it is on none or its position is unknown. */
  displayId: string | null
  /** When the cursor arrived there, on the caller's clock. */
  sinceMs: number
}

export function createFollowMeState(): FollowMeState {
  return { displayId: null, sinceMs: 0 }
}

/**
 * Follow me, one animation frame at a time: names the display to make the home display once the cursor has stayed on
 * it for {@link followMeDwellMs}.
 *
 * A cursor that leaves the display, or whose position becomes unknown, starts the wait again. The display is named
 * once per wait, so a slow answer from the main process is not asked for again on the next frame.
 */
export function followCursor(state: FollowMeState, input: { nowMs: number, cursorDisplayId: string | null, homeDisplayId: string | null }): { state: FollowMeState, rehomeTo: string | null } {
  const { nowMs, cursorDisplayId } = input
  if (cursorDisplayId !== state.displayId)
    return { state: { displayId: cursorDisplayId, sinceMs: nowMs }, rehomeTo: null }
  if (cursorDisplayId === null || cursorDisplayId === input.homeDisplayId || nowMs - state.sinceMs < followMeDwellMs)
    return { state, rehomeTo: null }
  return { state: { displayId: cursorDisplayId, sinceMs: nowMs }, rehomeTo: cursorDisplayId }
}
