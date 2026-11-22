import type { Point } from './pointer-macos'

import { setTimeout as wait } from 'node:timers/promises'

/** The part of `CdpClient` that sends input; tests pass a fake. */
export interface CdpInputSender {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

/** One step of a stage drag: where the OS cursor goes, and the CDP mouse event the stage window gets there. */
export interface StageDragStep {
  /** Milliseconds after the press. */
  atMs: number
  /** Global display point of the OS cursor. */
  screen: Point
  mouse: Record<string, unknown>
}

export interface StageDragOptions {
  /** Global display point of the stage window's top-left content corner (`screenX`, `screenY`). */
  origin: Point
  /** Moves between the press and the release; the desktop stage starts a drag after 8 DIP. Default 12. */
  moves?: number
  /** Time between moves. Default 40 ms. */
  stepMs?: number
}

/**
 * Plans a left-button drag on the stage window from `from` to `to` (global display points): a hover and a press at
 * `from`, evenly spaced moves with the button held, and a release at `to`. The CDP coordinates are relative to the
 * window, because CDP mouse events address the page.
 */
export function planStageDrag(from: Point, to: Point, options: StageDragOptions): StageDragStep[] {
  const { origin, moves = 12, stepMs = 40 } = options
  if (!Number.isInteger(moves) || moves < 1)
    throw new Error(`A stage drag needs at least one move, got ${moves}`)
  const at = (point: Point) => ({ x: point.x - origin.x, y: point.y - origin.y })
  const steps: StageDragStep[] = [
    { atMs: 0, screen: from, mouse: { type: 'mouseMoved', ...at(from) } },
    { atMs: 0, screen: from, mouse: { type: 'mousePressed', ...at(from), button: 'left', buttons: 1, clickCount: 1 } },
  ]
  for (let index = 1; index <= moves; index++) {
    const point = { x: Math.round(from.x + (to.x - from.x) * index / moves), y: Math.round(from.y + (to.y - from.y) * index / moves) }
    steps.push({ atMs: index * stepMs, screen: point, mouse: { type: 'mouseMoved', ...at(point), button: 'left', buttons: 1 } })
  }
  steps.push({ atMs: moves * stepMs, screen: to, mouse: { type: 'mouseReleased', ...at(to), button: 'left', buttons: 0, clickCount: 1 } })
  return steps
}

/**
 * Plays a planned drag. `warp` moves the OS cursor before each CDP event, so the main process's polled cursor, the
 * click-through hit test, and cursor attention see the same pointer as the page; omit it where the platform cannot
 * warp. A posted OS drag (`dragSteps` of the macOS backend) replaces this only when posted events are allowed.
 */
export async function playStageDrag(stage: CdpInputSender, steps: readonly StageDragStep[], warp?: (point: Point) => Promise<unknown>): Promise<void> {
  const started = Date.now()
  for (const step of steps) {
    const remaining = step.atMs - (Date.now() - started)
    if (remaining > 0)
      await wait(remaining)
    await warp?.(step.screen)
    await stage.send('Input.dispatchMouseEvent', step.mouse)
  }
}
