import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import type { PlannedScreenshot } from '../../t3/screenshot'

export interface ModeSample extends Pick<MotionQaState, 'performanceMode' | 'performance' | 'host'> {
  at: number
}

/** One capture schedule owns screenshots and scored-window mode checks; it leaves no timer running after a failure. */
export async function captureTimeline(options: {
  screenshots: readonly PlannedScreenshot[]
  durationSeconds: number
  idleAfterSeconds?: number
  /** Host-profile diagnostics also sample warm-up and standalone captures, without adding a verdict. */
  samplePerformance?: boolean
  waitUntil: (at: number) => Promise<void>
  takeScreenshot: (shot: PlannedScreenshot) => Promise<void>
  readState: () => Promise<Pick<MotionQaState, 'performanceMode' | 'performance' | 'host'>>
  modeSamples: ModeSample[]
}): Promise<void> {
  const checks: Array<{ at: number, shot?: PlannedScreenshot }> = options.screenshots.map(shot => ({ at: shot.at, shot }))
  const firstSample = options.samplePerformance ? 0 : options.idleAfterSeconds
  if (firstSample !== undefined) {
    for (let at = firstSample; at <= options.durationSeconds; at += 10)
      checks.push({ at })
  }
  checks.sort((a, b) => a.at - b.at)
  for (const check of checks) {
    await options.waitUntil(check.at)
    if (check.shot) {
      await options.takeScreenshot(check.shot)
    }
    else {
      const { performanceMode, performance, host } = await options.readState()
      options.modeSamples.push({ at: check.at, performanceMode, performance, host })
      if (options.idleAfterSeconds !== undefined && check.at >= options.idleAfterSeconds) {
        if (performanceMode !== 'idle')
          throw new Error(`mode-left-idle at ${check.at} s: ${performanceMode ?? 'unknown'}`)
        if (options.samplePerformance && performance?.away !== false)
          throw new Error(`away-active at ${check.at} s: ${performance?.away ?? 'unknown'}`)
      }
    }
  }
}
