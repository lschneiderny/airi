import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import type { ModeSample } from './capture-timeline'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { describe, expect, it } from 'vitest'

import { captureTimeline } from './capture-timeline'

function state(mode: MotionQaState['performanceMode'], away = false) {
  return {
    performanceMode: mode,
    host: capabilitiesForHost('linux-wayland'),
    performance: { away, resolvedAtMs: 30_000, cursorMovedAtMs: null, desktop: { idleSeconds: away ? 301 : 30, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, screenChange: null, systemAudioLevel: null, sampledAtMs: 30_000 } },
  }
}

describe('liveliness capture timeline', () => {
  it('records host-profile inputs through warm-up and away without changing the idle guard', async () => {
    const actions: string[] = []
    let now = 0
    const samples: ModeSample[] = []
    await captureTimeline({
      screenshots: [{ at: 5, file: 'warm.png' }, { at: 25, file: 'score.png' }],
      durationSeconds: 49,
      idleAfterSeconds: 20,
      samplePerformance: true,
      waitUntil: async (at) => { now = at },
      takeScreenshot: async (shot) => { actions.push(`shot:${now}:${shot.file}`) },
      readState: async () => {
        actions.push(`mode:${now}`)
        return state(now < 20 ? 'watching' : 'idle', now >= 30)
      },
      modeSamples: samples,
    })
    expect(actions).toEqual(['mode:0', 'shot:5:warm.png', 'mode:10', 'mode:20', 'shot:25:score.png', 'mode:30', 'mode:40'])
    expect(samples).toEqual([
      { at: 0, ...state('watching') },
      { at: 10, ...state('watching') },
      { at: 20, ...state('idle') },
      { at: 30, ...state('idle', true) },
      { at: 40, ...state('idle', true) },
    ])
  })

  it.each(['watching', 'talking', null] as const)('fails the capture when the scored mode is %s', async (mode) => {
    const samples: ModeSample[] = []
    await expect(captureTimeline({
      screenshots: [],
      durationSeconds: 30,
      idleAfterSeconds: 20,
      waitUntil: async () => {},
      takeScreenshot: async () => {},
      readState: async () => state(mode),
      modeSamples: samples,
    })).rejects.toThrow(/mode-left-idle.*20/)
    expect(samples).toEqual([{ at: 20, ...state(mode) }])
  })

  it('records a standalone host-profile capture without imposing a gate verdict', async () => {
    const samples: ModeSample[] = []
    await captureTimeline({
      screenshots: [],
      durationSeconds: 19,
      samplePerformance: true,
      waitUntil: async () => {},
      takeScreenshot: async () => {},
      readState: async () => state('watching'),
      modeSamples: samples,
    })
    expect(samples).toEqual([{ at: 0, ...state('watching') }, { at: 10, ...state('watching') }])
  })

  it('does not constrain modes for non-liveliness captures', async () => {
    let reads = 0
    await captureTimeline({
      screenshots: [],
      durationSeconds: 30,
      waitUntil: async () => {},
      takeScreenshot: async () => {},
      readState: async () => {
        reads++
        return state('talking')
      },
      modeSamples: [],
    })
    expect(reads).toBe(0)
  })
})
