import type { IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'

import type { ChatStimulus, MindStimulus, TouchReport } from './types'

import { dormantIdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { nextIdleWakeAt } from './idle'
import { seededRandom } from './random'
import { step } from './step'
import { naturalMindState } from './test/fixtures'

const enabled = { kind: 'behavior', idleActivities: true, touchReactions: true, chatAttention: true } as const

describe('behavior permissions', () => {
  it.each([false, true])('makes idle independently dormant like a null drive, with away=%s', (away) => {
    const random = seededRandom(7)
    const referenceRandom = seededRandom(7)
    let state = step(naturalMindState(), [{ ...enabled, idleActivities: false }], 1000, random).state
    let reference = naturalMindState()
    const view: IdleView = {
      drive: { energy: 1, valence: 0, tension: 0, sleepiness: 1, solitude: 1, rate: 10, body: true, errands: ['pastime', 'wander', 'idle-clip'] },
      active: true,
      mode: 'idle',
      away,
      blocked: false,
      settled: true,
      current: null,
      errand: null,
    }
    for (const atMs of [1000, 601000]) {
      const actual = step(state, [{ kind: 'idle', reports: [{ kind: 'view', view }] }], atMs, random)
      const expected = step(reference, [{ kind: 'idle', reports: [{ kind: 'view', view: dormantIdleView(true) }] }], atMs, referenceRandom)
      expect(actual.intents).toEqual([])
      expect(actual.state.idle).toEqual(expected.state.idle)
      expect(nextIdleWakeAt(actual.state.idle)).toBeNull()
      state = actual.state
      reference = expected.state
    }
    expect(step(state, [{ kind: 'idle-play', act: 'sleep' }], 601000, random).intents).toEqual([])
  })

  const touches: TouchReport[] = [
    { gesture: 'poke', region: 'head', point: { x: 0, y: 0 } },
    { gesture: 'pet-start', region: 'head' },
    { gesture: 'pet-end', region: 'head', durationMs: 5000 },
  ]
  it.each(touches)('answers disabled $gesture with no intent or random draw', (touch) => {
    const random = vi.fn(() => 0.5)
    const initial = naturalMindState()
    const input: MindStimulus = { kind: 'touch', ...touch, settings: defaultExpressionPerformanceSettings, voice: null }
    const result = step(initial, [{ ...enabled, touchReactions: false }, input], 1000, random)
    expect(result.intents).toEqual([])
    expect(result.state.touch).toBe(initial.touch)
    expect(random).not.toHaveBeenCalled()
  })

  it('closes a pet on withdrawal without erasing its habituation or dosing its cancellation', () => {
    const random = seededRandom(1)
    const started = step(naturalMindState(), [{
      kind: 'touch',
      gesture: 'pet-start',
      region: 'head',
      settings: defaultExpressionPerformanceSettings,
      voice: null,
    }], 1000, random)
    expect(started.state.touch.affect.pet).not.toBeNull()
    const withdrawn = step(started.state, [{ ...enabled, touchReactions: false }], 2000, random)
    expect(withdrawn.intents).toEqual([])
    expect(withdrawn.state.touch.affect.pet).toBeNull()
    expect(withdrawn.state.touch.affect.doses).toEqual(started.state.touch.affect.doses)
    expect(withdrawn.state.touch.affect.lastPetStartAt).toBe(started.state.touch.affect.lastPetStartAt)
  })

  const chats: ChatStimulus[] = [{ kind: 'chat', cue: 'sent', words: 12 }, { kind: 'chat', cue: 'unfold' }]
  it.each(chats)('answers disabled chat $cue with neither read nor attend', (chat) => {
    const random = vi.fn(() => 0.5)
    const result = step(naturalMindState(), [{ ...enabled, chatAttention: false }, chat], 1000, random)
    expect(result.intents).toEqual([])
    expect(random).not.toHaveBeenCalled()
  })
})
