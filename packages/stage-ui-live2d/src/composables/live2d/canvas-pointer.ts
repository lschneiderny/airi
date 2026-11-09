/** A primary pointer sample over the model canvas, in model canvas space, stamped with `performance.now()`. */
export interface CanvasPointerSample {
  x: number
  y: number
  atMs: number
}

/** A pointer sample younger than this drives Natural attention instead of the host cursor mapping. */
export const canvasPointerFreshMs = 100

/**
 * The canvas pointer sample that drives Natural attention, or `undefined` to use the host cursor (or none).
 *
 * A fresh sample wins over the host cursor mapping, so gaze and touch share one input. With a host cursor, a stale
 * sample hands over to it. Without one (native Wayland withholds the cursor), nothing takes over when the hand
 * rests, so the last sample holds until the pointer leaves the canvas; otherwise a still hand would read as a cursor
 * that went away.
 */
export function activeCanvasPointer(sample: CanvasPointerSample | undefined, nowMs: number, context: { hostCursor: boolean, pointerOver: boolean }): CanvasPointerSample | undefined {
  if (!sample)
    return undefined
  if (nowMs - sample.atMs < canvasPointerFreshMs)
    return sample
  return !context.hostCursor && context.pointerOver ? sample : undefined
}
