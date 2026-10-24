import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

import type { TraceEvents } from './verify-trace'

import { describe, expect, it } from 'vitest'

import { compareScenarioEvents, scenarioEventsOf, verifyT3Run } from './verify-trace'

const scenario: MotionScenario = {
  version: 1,
  id: 's',
  seed: 1,
  durationSeconds: 10,
  levels: ['t3'],
  screenshotsAt: [3],
  events: [
    { kind: 'emotion', at: 2, emotion: 'happy', band: 'clear', source: 'devtools' },
    { kind: 'act', at: 6, marker: '<|ACT {"emotion":"angry"}|>' },
  ],
}

function trace(overrides: Partial<TraceEvents> = {}): TraceEvents {
  return {
    version: 2,
    t: [0, 1 / 30],
    events: [
      { t: 0.01, source: 'scenario', event: { kind: 'marker', at: 0, label: 'capture:run' } },
      { t: 2.02, source: 'scenario', event: scenario.events[0] },
      { t: 2.03, source: 'natural', event: { kind: 'hold' } },
      { t: 6.01, source: 'scenario', event: scenario.events[1] },
    ],
    ...overrides,
  }
}

describe('scenarioEventsOf', () => {
  it('drops the capture marker and natural events', () => {
    expect(scenarioEventsOf(trace())).toEqual(scenario.events)
  })
})

describe('compareScenarioEvents', () => {
  it('reports kind, at and length differences by position', () => {
    expect(compareScenarioEvents(scenario.events, scenario.events)).toEqual([])
    expect(compareScenarioEvents(scenario.events, [scenario.events[0]])).toEqual(['#1: act@6 vs missing'])
    expect(compareScenarioEvents(scenario.events, [{ ...scenario.events[0], at: 2.5 }, scenario.events[1]])).toEqual(['#0: emotion@2 vs emotion@2.5'])
  })
})

describe('verifyT3Run', () => {
  const run = { dispatched: 2, rejected: [] }

  function touchTrace(): TraceEvents {
    return trace({
      t: [0, 1, 3, 4, 5],
      channels: { ParamCheek: [0, 0, 0.3, 0.5, 0] },
      events: [
        ...trace().events,
        { t: 1, source: 'natural', event: { kind: 'attention', phase: 'notice' } },
        { t: 1.4, source: 'natural', event: { kind: 'attention', phase: 'engage' } },
        { t: 2, source: 'natural', event: { kind: 'touch', touch: 'pet-start' } },
        { t: 5, source: 'natural', event: { kind: 'touch', touch: 'pet-end' } },
        { t: 6, source: 'natural', event: { kind: 'touch', touch: 'poke' } },
        { t: 7, source: 'natural', event: { kind: 'touch', touch: 'poke' } },
      ],
    })
  }

  it('requires staged attention, one pet, two pokes, and a rising cheek in a touch run', () => {
    const input = { scenario: { ...scenario, id: 't3-touch' }, run, trace: touchTrace(), screenshots: 1 }
    expect(verifyT3Run(input)).toMatchObject({ ok: true, counts: { petStarts: 1, petEnds: 1, pokes: 2, dispatched: 2, rejected: 0 } })
    const absent = verifyT3Run({ ...input, trace: trace() })
    expect(absent.failures).toHaveLength(4)
    const flat = verifyT3Run({ ...input, trace: { ...touchTrace(), channels: { ParamCheek: [0, 0, 0, 0, 0] } } })
    expect(flat.failures).toEqual([expect.stringMatching(/cheek channel/)])
    const reversed = touchTrace()
    reversed.events = reversed.events.map(entry => entry.source === 'natural' && entry.event.phase === 'notice' ? { ...entry, t: 1.5 } : entry)
    expect(verifyT3Run({ ...input, trace: reversed }).failures).toEqual([expect.stringMatching(/notice before engage/)])
  })

  it('fails duplicate pet events and missing pokes even when dispatch succeeded', () => {
    const captured = touchTrace()
    captured.events = captured.events.filter(entry => entry.source !== 'natural' || entry.event.touch !== 'poke')
    captured.events.push({ t: 3, source: 'natural', event: { kind: 'touch', touch: 'pet-start' } })
    const result = verifyT3Run({ scenario: { ...scenario, id: 't3-touch' }, run, trace: captured, screenshots: 1 })
    expect(result.failures).toEqual([expect.stringMatching(/exactly one/), expect.stringMatching(/two pokes/)])
  })

  it('requires zero pet events in a passing-cursor run', () => {
    const input = { scenario: { ...scenario, id: 't3-touch-pass' }, run, screenshots: 1 }
    expect(verifyT3Run({ ...input, trace: trace() }).ok).toBe(true)
    expect(verifyT3Run({ ...input, trace: touchTrace() }).failures).toEqual([expect.stringMatching(/passing cursor/)])
  })

  it('passes a complete run', () => {
    expect(verifyT3Run({ scenario, run, trace: trace(), screenshots: 1 })).toMatchObject({ ok: true, failures: [], counts: { scenarioEvents: 2, naturalHolds: 1, screenshots: 1 } })
  })

  it('fails a trace that lacks the scenario events even when the bridge reported success', () => {
    const result = verifyT3Run({ scenario, run, trace: trace({ events: [{ t: 0, source: 'scenario', event: { kind: 'marker', at: 0, label: 'capture:run' } }] }), screenshots: 1 })
    expect(result.ok).toBe(false)
    expect(result.failures.join('\n')).toMatch(/trace scenario events differ/)
    expect(result.failures.join('\n')).toMatch(/no Natural hold events/)
  })

  it('fails a run whose events were stamped late, as on a throttled window', () => {
    expect(verifyT3Run({ scenario, run, trace: trace(), screenshots: 1, scenarioStartTraceT: 0 }).ok).toBe(true)
    const late = verifyT3Run({ scenario, run, trace: trace(), screenshots: 1, scenarioStartTraceT: -1 })
    expect(late.ok).toBe(false)
    expect(late.failures.join('\n')).toMatch(/throttled/)
  })

  it('fails rejected events, a missing capture marker, an empty trace and missing screenshots', () => {
    const result = verifyT3Run({
      scenario,
      run: { dispatched: 1, rejected: [{ at: 6, kind: 'act', reason: 'parser refused' }] },
      trace: trace({ t: [], events: trace().events.slice(1) }),
      screenshots: 0,
    })
    expect(result.failures).toHaveLength(5)
  })
})
