/**
 * Duration given to a frame that states none.
 *
 * GIFs often store a delay of 0, and browsers play such frames at 100 ms rather
 * than as fast as they can.
 */
const unstatedFrameDurationMs = 100

function frameDurationMs(statedMs: number): number {
  // NaN fails the comparison, so it counts as unstated too; an infinite delay would freeze every later frame.
  return statedMs > 0 && Number.isFinite(statedMs) ? statedMs : unstatedFrameDurationMs
}

/**
 * The frame a looping GIF shows after `elapsedMs` of item-clock time.
 *
 * The animation loops forever. Elapsed time that is negative or not finite
 * shows the first frame. Runs every frame and allocates nothing.
 */
export function gifFrameAt(frameDurationsMs: ArrayLike<number>, elapsedMs: number): number {
  const frameCount = frameDurationsMs.length
  if (frameCount <= 1 || !(elapsedMs > 0) || !Number.isFinite(elapsedMs))
    return 0

  let loopMs = 0
  for (let frame = 0; frame < frameCount; frame++)
    loopMs += frameDurationMs(frameDurationsMs[frame])

  const intoLoopMs = elapsedMs % loopMs
  let endMs = 0
  for (let frame = 0; frame < frameCount; frame++) {
    endMs += frameDurationMs(frameDurationsMs[frame])
    if (intoLoopMs < endMs)
      return frame
  }
  return frameCount - 1
}
