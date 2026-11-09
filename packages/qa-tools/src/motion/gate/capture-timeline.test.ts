import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import { describe, expect, it } from 'vitest'

import { captureTimeline } from './capture-timeline'

describe('liveliness capture timeline', () => {
  it('samples every ten seconds only in the scored window while keeping screenshot deadlines', async () => {
    const actions: string[] = []
    let now = 0
    const samples: { at: number, mode: MotionQaState['performanceMode'] }[] = []
    await captureTimeline({
      screenshots: [{ at: 5, file: 'warm.png' }, { at: 25, file: 'score.png' }],
      durationSeconds: 49,
      idleAfterSeconds: 20,
      waitUntil: async (at) => { now = at },
      takeScreenshot: async (shot) => { actions.push(`shot:${now}:${shot.file}`) },
      readMode: async () => {
        actions.push(`mode:${now}`)
        return now < 20 ? 'watching' : 'idle'
      },
      modeSamples: samples,
    })
    expect(actions).toEqual(['shot:5:warm.png', 'mode:20', 'shot:25:score.png', 'mode:30', 'mode:40'])
    expect(samples).toEqual([{ at: 20, mode: 'idle' }, { at: 30, mode: 'idle' }, { at: 40, mode: 'idle' }])
  })

  it.each(['watching', 'talking', null] as const)('fails the capture when the scored mode is %s', async (mode) => {
    await expect(captureTimeline({
      screenshots: [],
      durationSeconds: 30,
      idleAfterSeconds: 20,
      waitUntil: async () => {},
      takeScreenshot: async () => {},
      readMode: async () => mode,
      modeSamples: [],
    })).rejects.toThrow(/mode-left-idle.*20/)
  })

  it('does not constrain modes for non-liveliness captures', async () => {
    let reads = 0
    await captureTimeline({
      screenshots: [],
      durationSeconds: 30,
      waitUntil: async () => {},
      takeScreenshot: async () => {},
      readMode: async () => {
        reads++
        return 'talking'
      },
      modeSamples: [],
    })
    expect(reads).toBe(0)
  })
})
