import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import type { ModeSample } from './capture-timeline'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { initialResolverMemory, resolvePerformanceState } from '@proj-airi/stage-shared/performance-state'
import { describe, expect, it } from 'vitest'

import { captureTimeline } from './capture-timeline'
import { livelinessGateFor } from './options'

function state(mode: MotionQaState['performanceMode'], away = false) {
  return {
    performanceMode: mode,
    host: capabilitiesForHost('linux-wayland'),
    performance: { away, resolvedAtMs: 30_000, cursorMovedAtMs: null, desktop: { idleSeconds: away ? 301 : 30, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, screenChange: null, systemAudioLevel: null, sampledAtMs: 30_000 } },
  }
}

describe('liveliness capture timeline', () => {
  it('records host-profile inputs through warm-up while requiring scored idle without away', async () => {
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
        return state(now < 20 ? 'watching' : 'idle', now < 20)
      },
      modeSamples: samples,
    })
    expect(actions).toEqual(['mode:0', 'shot:5:warm.png', 'mode:10', 'mode:20', 'shot:25:score.png', 'mode:30', 'mode:40'])
    expect(samples).toEqual([
      { at: 0, ...state('watching', true) },
      { at: 10, ...state('watching', true) },
      { at: 20, ...state('idle') },
      { at: 30, ...state('idle') },
      { at: 40, ...state('idle') },
    ])
  })

  it.each([true, null])('rejects idle with away %s in the scored host-profile window and retains its sample', async (away) => {
    const samples: ModeSample[] = []
    const reported = { ...state('idle', true), performance: away === null ? null : state('idle', away).performance }
    await expect(captureTimeline({
      screenshots: [],
      durationSeconds: 30,
      idleAfterSeconds: 20,
      samplePerformance: true,
      waitUntil: async () => {},
      takeScreenshot: async () => {},
      readState: async () => reported,
      modeSamples: samples,
    })).rejects.toThrow(/away-active.*20/)
    expect(samples.at(-1)).toEqual({ at: 20, ...reported })
  })

  it('rejects a full-length capture when the unchanged resolver enters away during scoring', async () => {
    const gate = livelinessGateFor('t3')
    const samples: ModeSample[] = []
    let now = 0
    let memory = initialResolverMemory
    await expect(captureTimeline({
      screenshots: [],
      durationSeconds: gate.warmUpSeconds + gate.scoredSeconds - 1,
      idleAfterSeconds: gate.warmUpSeconds,
      samplePerformance: true,
      waitUntil: async (at) => { now = at },
      takeScreenshot: async () => {},
      readState: async () => {
        const sample = state('idle')
        sample.host.signals.systemIdleTime = { kind: 'live' }
        const desktop = { ...sample.performance.desktop, idleSeconds: now, sampledAtMs: now * 1000 }
        const resolved = resolvePerformanceState({
          nowMs: now * 1000,
          desktop,
          cursorMovedAtMs: null,
          speaking: false,
          userSpeaking: false,
          generating: false,
          visible: true,
          override: null,
          cueAttention: null,
          foregroundCategory: null,
        }, memory)
        memory = resolved.memory
        return {
          ...sample,
          performanceMode: resolved.state.mode,
          performance: { ...sample.performance, resolvedAtMs: now * 1000, desktop, away: resolved.state.away },
        }
      },
      modeSamples: samples,
    })).rejects.toThrow('away-active at 310 s: true')
    expect(samples.at(-2)).toMatchObject({ at: 300, performanceMode: 'idle', performance: { away: false, desktop: { idleSeconds: 300 } } })
    expect(samples.at(-1)).toMatchObject({ at: 310, performanceMode: 'idle', performance: { away: true, desktop: { idleSeconds: 310 } } })
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
