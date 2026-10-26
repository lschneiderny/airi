import { resolve } from 'node:path'

import { Live2DNaturalMotion } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runT1 } from '../motion/t1/runner'
import { loadT3Scenario } from './args'
import { t3ScreenAwareness } from './run-t3'
import { compareScenarioEvents, parseTraceEvents, scenarioEventsOf } from './verify-trace'

const fixtures = resolve(import.meta.dirname, '..', '..', 'fixtures')

describe('builtin t3-screen-attention scenario', () => {
  const { scenario } = loadT3Scenario('builtin:t3-screen-attention', { fixturesDir: resolve(fixtures, 'scenarios'), cwd: fixtures })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('places the head inward, then outward, then types, sends, and unfolds the chat on the desk home without pointer events', () => {
    expect(scenario.home).toBe('desk')
    expect(scenario.durationSeconds).toBe(130)
    expect(scenario.events.map(event => `${event.at}:${event.kind}`)).toEqual(['0:placement', '20:placement', '50:placement', '80:chat-target', '80:chat-typing', '100:chat-sent', '100:chat-typing', '110:chat-unfold'])
  })

  it('makes the T3 runner configure screen-aware attention on', () => {
    expect(t3ScreenAwareness(scenario)).toBe(true)
    expect(t3ScreenAwareness({ ...scenario, events: scenario.events.filter(event => event.kind !== 'placement') })).toBe(true)
    expect(t3ScreenAwareness({ ...scenario, events: scenario.events.filter(event => event.kind === 'placement') })).toBe(true)
    expect(t3ScreenAwareness({ ...scenario, events: [] })).toBe(false)
  })

  // Idle cost about 0.5 s (one runT1 simulation, like t3-smoke); 20 s under load.
  it('drives Natural placement and chat at T1 and stamps the same scenario events', () => {
    const setPlacement = vi.spyOn(Live2DNaturalMotion.prototype, 'setPlacement')
    const setChat = vi.spyOn(Live2DNaturalMotion.prototype, 'setChat')

    const trace = parseTraceEvents(runT1(scenario))

    expect(compareScenarioEvents(scenario.events, scenarioEventsOf(trace))).toEqual([])
    // The adapter forwards inputs on change only, at the composition of the step whose events changed them.
    expect(setPlacement.mock.calls).toEqual([[0, 0], [1, 20], [-1, 50]])
    expect(setChat.mock.calls).toEqual([
      [{ target: { x: -3, y: -1 }, typing: true, sentSeq: 0, sentWords: 0, unfoldSeq: 0 }, 80],
      [{ target: { x: -3, y: -1 }, typing: false, sentSeq: 1, sentWords: 8, unfoldSeq: 0 }, 100],
      [{ target: { x: -3, y: -1 }, typing: false, sentSeq: 1, sentWords: 8, unfoldSeq: 1 }, 110],
    ])
  }, 20_000)
})
