import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import type { PlannedScreenshot } from '../../t3/screenshot'

export interface ModeSample {
  at: number
  mode: MotionQaState['performanceMode']
}

/** One capture schedule owns screenshots and scored-window mode checks; it leaves no timer running after a failure. */
export async function captureTimeline(options: {
  screenshots: readonly PlannedScreenshot[]
  durationSeconds: number
  idleAfterSeconds?: number
  waitUntil: (at: number) => Promise<void>
  takeScreenshot: (shot: PlannedScreenshot) => Promise<void>
  readMode: () => Promise<MotionQaState['performanceMode']>
  modeSamples: ModeSample[]
}): Promise<void> {
  const checks: Array<{ at: number, shot?: PlannedScreenshot }> = options.screenshots.map(shot => ({ at: shot.at, shot }))
  if (options.idleAfterSeconds !== undefined) {
    for (let at = options.idleAfterSeconds; at <= options.durationSeconds; at += 10)
      checks.push({ at })
  }
  checks.sort((a, b) => a.at - b.at)
  for (const check of checks) {
    await options.waitUntil(check.at)
    if (check.shot) {
      await options.takeScreenshot(check.shot)
    }
    else {
      const mode = await options.readMode()
      options.modeSamples.push({ at: check.at, mode })
      if (mode !== 'idle')
        throw new Error(`mode-left-idle at ${check.at} s: ${mode ?? 'unknown'}`)
    }
  }
}
