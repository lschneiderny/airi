import type { SignalStatus } from '@proj-airi/stage-shared/host-capabilities'

import { isStageClickThroughUsable } from '../../../shared/stage-click-through'

/** How long click-through may stay unusable after the pointer first moves before the classic window is offered. */
export const stageClickThroughGraceMs = 15_000

type CursorPoint = { x: number, y: number } | null

/**
 * Offers the classic window, at most once, when the shown desktop stage cannot use click-through.
 *
 * Use when:
 * - The desktop stage window has just been shown
 *
 * Expects:
 * - `status` reads the current `clickThroughForward` status, and `bridgeFailed` whether the Linux desktop bridge failed
 * - `onChange` calls its listener after each snapshot change; `onCursor` with each compositor cursor reading. Both
 *   return the function that stops them
 *
 * Returns:
 * - The function that stops watching. The watch also stops after it offered. It offers at once when the bridge has
 *   failed or usable click-through is taken away (a revocation), and when click-through is still unusable
 *   {@link stageClickThroughGraceMs} after the pointer first moved. A pointer that never moves gets no offer: the stage
 *   keeps ignoring it without a time limit (Luke, 2026-11-09: "Start the 15 s at first move").
 */
export function watchStageClickThrough(params: {
  status: () => SignalStatus
  bridgeFailed: () => boolean
  onChange: (listener: () => void) => () => void
  onCursor: (listener: (point: CursorPoint) => void) => () => void
  offer: () => void
}): () => void {
  let everUsable = false
  let watching = true
  let firstPoint: CursorPoint = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const offChange = params.onChange(check)
  const offCursor = params.onCursor((point) => {
    if (!point)
      return
    if (!firstPoint) {
      firstPoint = point
      return
    }
    if (timer || (point.x === firstPoint.x && point.y === firstPoint.y))
      return
    timer = setTimeout(() => {
      if (!everUsable)
        finish()
    }, stageClickThroughGraceMs)
  })
  check()

  function check() {
    if (params.bridgeFailed())
      finish()
    else if (isStageClickThroughUsable(params.status()))
      everUsable = true
    else if (everUsable)
      finish()
  }

  function stop() {
    watching = false
    clearTimeout(timer)
    offChange()
    offCursor()
  }

  function finish() {
    if (!watching)
      return
    stop()
    params.offer()
  }

  return stop
}
