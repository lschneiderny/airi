import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { Buffer } from 'node:buffer'
import { writeFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'

export interface PlannedScreenshot {
  /** Scenario time (s) the shot is planned for. */
  at: number
  /** File name inside the run's `screenshots/` directory. */
  file: string
}

export interface TakenScreenshot extends PlannedScreenshot {
  /** Scenario time (s) when the capture was requested, on the renderer clock. */
  actualAt: number
  /** The same moment on the trace clock (capture origin), from the capture marker. */
  traceT: number
}

/** One file per `screenshotsAt` entry, in time order: `NN-<at>s.png`. */
export function planScreenshots(screenshotsAt: readonly number[]): PlannedScreenshot[] {
  return [...screenshotsAt].sort((a, b) => a - b).map((at, index) => ({ at, file: `${String(index + 1).padStart(2, '0')}-${at.toFixed(1)}s.png` }))
}

/** Captures the stage page as PNG into `file`. Bounded by `timeoutMs`. */
export async function captureStagePng(stage: CdpClient, file: string, timeoutMs = 30_000): Promise<void> {
  const response = await stage.send('Page.captureScreenshot', { format: 'png' }, timeoutMs)
  const data = response.result && typeof response.result === 'object' ? (response.result as { data?: unknown }).data : undefined
  if (typeof data !== 'string' || data.length === 0)
    throw new Error('Page.captureScreenshot returned no image data')
  writeFileSync(file, Buffer.from(data, 'base64'))
}

/**
 * Brings the stage page to the front and measures its frame rate for 500 ms. `runScenario` is paced by
 * `requestAnimationFrame`, which a hidden or covered window throttles, so a run on a throttled window fails here with a
 * named error instead of drifting or hanging.
 */
export async function assertStageAnimating(stage: CdpClient, minFrames = 15): Promise<{ frames: number, visibility: string }> {
  await stage.send('Page.bringToFront', {}, 10_000)
  let measured: { frames: number, visibility: string }
  try {
    measured = await stage.evaluate<{ frames: number, visibility: string }>(`new Promise((resolve) => {
      let frames = 0
      const startedAt = performance.now()
      const step = () => {
        frames += 1
        if (performance.now() - startedAt >= 500)
          resolve({ frames, visibility: document.visibilityState })
        else
          requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })`, 5_000)
  }
  catch (error) {
    throw new Error(`The stage window is not animating (no frames within 5 s; is it hidden or minimized?): ${errorMessageFrom(error) ?? 'unknown error'}`)
  }
  if (measured.frames < minFrames)
    throw new Error(`The stage window is throttled: ${measured.frames} frames in 500 ms, visibility ${measured.visibility}; keep it visible and uncovered during a T3 run`)
  return measured
}

/** Resolves at the wall-clock deadline; the scenario timeline is the behavior being followed here, not a settle delay. */
export function untilDeadline(deadlineMs: number, now: () => number = Date.now): Promise<void> {
  const wait = deadlineMs - now()
  return wait > 0 ? new Promise(resolveWait => setTimeout(resolveWait, wait)) : Promise.resolve()
}
