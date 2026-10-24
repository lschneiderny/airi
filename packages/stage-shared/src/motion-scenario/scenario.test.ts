import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { buildEmotionTrial, buildIdleWithPlacebos, buildLongHold, buildPointerApproach, buildPointerPoke, buildPointerStroke, createScenarioPlayer, MotionScenarioSchema, stripEmotions } from '.'
import { ExpressionPerformanceSettingsSchema } from '../expression-performance'

function scenario(overrides: Record<string, unknown> = {}) {
  return { version: 1, id: 'demo', seed: 1, durationSeconds: 30, levels: ['t1', 't2'], events: [{ kind: 'marker', at: 1, label: 'a' }], ...overrides }
}

function issuePaths(input: unknown) {
  const result = safeParse(MotionScenarioSchema, input)
  expect(result.success).toBe(false)
  return (result.issues ?? []).map(issue => (issue.path ?? []).map(item => String(item.key)).join('.'))
}

describe('motionScenarioSchema', () => {
  it('accepts every builder output', () => {
    const outputs = [
      buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }),
      buildEmotionTrial({ emotion: 'sad', band: 'slight', variant: 'held-only', seed: 2 }),
      buildIdleWithPlacebos({ seed: 3 }),
      buildLongHold({ emotion: 'love', band: 'clear', seed: 4 }),
    ]
    for (const output of outputs)
      expect(safeParse(MotionScenarioSchema, output).success).toBe(true)
  })

  it('rejects unsorted events at the later event', () => {
    const events = [{ kind: 'marker', at: 5, label: 'a' }, { kind: 'marker', at: 2, label: 'b' }]
    expect(issuePaths(scenario({ events }))).toContain('events.1.at')
  })

  it('rejects an event after the scenario ends and accepts one at the end', () => {
    expect(issuePaths(scenario({ durationSeconds: 5, events: [{ kind: 'marker', at: 5, label: 'a' }, { kind: 'marker', at: 5.5, label: 'b' }] }))).toEqual(['events.1.at'])
    expect(safeParse(MotionScenarioSchema, scenario({ durationSeconds: 5, events: [{ kind: 'marker', at: 5, label: 'a' }] })).success).toBe(true)
  })

  it('rejects unknown event kinds', () => {
    expect(issuePaths(scenario({ events: [{ kind: 'dance', at: 1 }] }))[0]).toBe('events.0.kind')
  })

  it('rejects speech and cursor events in a t3 scenario', () => {
    const events = [
      { kind: 'speech', at: 1, turnId: 't', seconds: 2, envelopeSeed: 1 },
      { kind: 'cursor', at: 2, clear: true },
      { kind: 'pointer', at: 3, phase: 'move', x: 0, y: 0 },
    ]
    expect(issuePaths(scenario({ levels: ['t1', 't3'], events }))).toEqual(['events.0.kind', 'events.1.kind'])
    expect(safeParse(MotionScenarioSchema, scenario({ events }), {}).success).toBe(true)
    const parsed = safeParse(MotionScenarioSchema, scenario({ levels: ['t1', 't3'], events: [events[2]] }))
    expect(parsed.success).toBe(true)
  })

  it.each([
    ['negative time', -1],
    ['NaN time', Number.NaN],
    ['infinite time', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_, at) => {
    expect(issuePaths(scenario({ events: [{ kind: 'marker', at, label: 'a' }] }))).toContain('events.0.at')
  })

  it('rejects unknown fields on the scenario, an event and the settings', () => {
    expect(issuePaths(scenario({ extra: 1 }))).toContain('extra')
    expect(issuePaths(scenario({ events: [{ kind: 'marker', at: 1, label: 'a', extra: 1 }] }))).toContain('events.0.extra')
    expect(issuePaths(scenario({ settings: { extra: true } }))).toContain('settings.extra')
  })

  it('rejects settings that are not a record', () => {
    expect(issuePaths(scenario({ settings: [] }))).toEqual(['settings'])
    expect(issuePaths(scenario({ settings: [{ heldEmotions: true }] }))).toEqual(['settings'])
  })

  it('rejects a cursor event that is neither a position nor a clear', () => {
    expect(issuePaths(scenario({ events: [{ kind: 'cursor', at: 1, x: 1 }] }))).toContain('events.0.kind')
    expect(issuePaths(scenario({ events: [{ kind: 'cursor', at: 1, x: 1, y: 2, clear: true }] }))).toContain('events.0.kind')
  })

  it('accepts pointer events in a t1 scenario and rejects malformed coordinates', () => {
    const events = [{ kind: 'pointer', at: 1, phase: 'move', x: 0.25, y: -0.5 }]
    expect(safeParse(MotionScenarioSchema, scenario({ events })).success).toBe(true)
    expect(issuePaths(scenario({ events: [{ kind: 'pointer', at: 1, x: 0, y: 0 }] }))).toContain('events.0.phase')
    expect(issuePaths(scenario({ events: [{ kind: 'pointer', at: 1, phase: 'move', x: Number.NaN, y: 0 }] }))).toContain('events.0.x')
  })

  it('rejects an out-of-range seed', () => {
    expect(issuePaths(scenario({ seed: 2 ** 32 }))).toContain('seed')
    expect(issuePaths(scenario({ seed: 1.5 }))).toContain('seed')
  })
})

describe('createScenarioPlayer', () => {
  const events = [1, 2, 2, 3].map((at, index) => ({ kind: 'marker' as const, at, label: String(index) }))
  const player = createScenarioPlayer({ version: 1, id: 'p', seed: 1, durationSeconds: 5, levels: ['t1'], events })

  it('returns events in the half-open window in array order', () => {
    expect(player.eventsBetween(1, 2).map(event => event.kind === 'marker' && event.label)).toEqual(['1', '2'])
    expect(player.eventsBetween(0, 1).map(event => event.at)).toEqual([1])
  })

  it('covers every event exactly once across consecutive windows', () => {
    const windows = [[-1, 1.5], [1.5, 2], [2, 10]].flatMap(([t0, t1]) => player.eventsBetween(t0, t1))
    expect(windows).toEqual(events)
  })

  it('returns nothing for an empty or reversed window', () => {
    expect(player.eventsBetween(2, 2)).toEqual([])
    expect(player.eventsBetween(3, 1)).toEqual([])
  })
})

describe('stripEmotions', () => {
  const full = {
    ...scenario({ levels: ['t1'] }),
    events: [
      { kind: 'marker', at: 1, label: 'a' },
      { kind: 'emotion', at: 2, emotion: 'angry', band: 'strong', source: 'devtools', trialId: 'x' },
      { kind: 'act', at: 3, marker: '<|ACT {}|>' },
      { kind: 'placebo', at: 4, trialId: 'p' },
    ],
  }
  const parsed = safeParse(MotionScenarioSchema, full)

  it('swaps only emotion and act events and keeps length and timestamps', () => {
    if (!parsed.success)
      throw new Error('fixture must parse')
    const stripped = stripEmotions(parsed.output)
    expect(stripped.events.map(event => event.at)).toEqual([1, 2, 3, 4])
    expect(stripped.events).toEqual([
      parsed.output.events[0],
      { kind: 'noop', at: 2, replaced: 'emotion', trialId: 'x' },
      { kind: 'noop', at: 3, replaced: 'act' },
      parsed.output.events[3],
    ])
    expect(safeParse(MotionScenarioSchema, stripped).success).toBe(true)
  })

  it('does not mutate its input', () => {
    if (!parsed.success)
      throw new Error('fixture must parse')
    const before = JSON.stringify(parsed.output)
    stripEmotions(parsed.output)
    expect(JSON.stringify(parsed.output)).toBe(before)
  })
})

describe('builders', () => {
  it('produces byte-identical JSON for the same inputs', () => {
    const build = () => JSON.stringify([
      buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }),
      buildIdleWithPlacebos({ seed: 1 }),
      buildLongHold({ emotion: 'happy', band: 'clear', seed: 1 }),
    ])
    expect(build()).toBe(build())
  })

  it('places the pulse at the warm-up with the documented trial id', () => {
    const trial = buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 })
    expect(trial.events).toEqual([{ kind: 'emotion', at: 20, emotion: 'angry', band: 'strong', source: 'devtools', trialId: 'angry-strong-full-1' }])
    expect(trial.durationSeconds).toBe(30)
    expect(createScenarioPlayer(trial).eventsBetween(19.9, 20.1)).toHaveLength(1)
  })

  it('keeps the hold length in settings and valid performance settings', () => {
    const settings = [
      buildEmotionTrial({ emotion: 'sad', band: 'clear', variant: 'held-only', seed: 2, hold: 7 }).settings?.performance,
      buildLongHold({ emotion: 'sad', band: 'clear', seed: 2, seconds: 90 }).settings?.performance,
    ]
    const parsed = settings.map(performance => safeParse(ExpressionPerformanceSettingsSchema, performance))
    expect(parsed.every(result => result.success)).toBe(true)
    expect(parsed.map(result => result.success && result.output.held.turnlessSeconds)).toEqual([7, 90])
  })

  it('neutralizes head and face recruitment only in the held-only variant', () => {
    const heldOnly = safeParse(ExpressionPerformanceSettingsSchema, buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'held-only', seed: 1 }).settings?.performance)
    const full = buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }).settings?.performance as Record<string, unknown>
    expect(full.naturalBands).toBeUndefined()
    if (!heldOnly.success)
      throw new Error('held-only settings must parse')
    const bands = heldOnly.output.naturalBands
    expect([bands.headGain, bands.bodyGain, bands.strong.headTau, bands.strong.faceHold]).toEqual([0, 0, null, 0])
  })

  it('spaces placebos with unique trial ids', () => {
    const idle = buildIdleWithPlacebos({ seed: 5, placebos: 3, spacing: 2, warmup: 10 })
    expect(idle.events.map(event => event.at)).toEqual([10, 12, 14])
    expect(new Set(idle.events.map(event => event.kind === 'placebo' && event.trialId)).size).toBe(3)
  })

  it('builds a sorted 144 Hz pointer stroke including both endpoints', () => {
    const events = buildPointerStroke({ at: 2, durationSeconds: 1, rateHz: 144, amplitude: 0.6, speed: 1.2, axis: 'x' })
    expect(events).toHaveLength(145)
    expect(events.every(event => event.kind === 'pointer' && event.phase === 'move')).toBe(true)
    expect(events.map(event => event.at)).toEqual([...events].map(event => event.at).sort((a, b) => a - b))
    expect(events.every(event => event.kind === 'pointer' && Math.abs(event.x) <= 0.6)).toBe(true)
  })

  it('builds a pointer poke with the requested hold duration', () => {
    expect(buildPointerPoke({ at: 2, x: 0.25, y: -0.5, holdSeconds: 0.1 })).toEqual([
      { kind: 'pointer', at: 2, phase: 'down', x: 0.25, y: -0.5 },
      { kind: 'pointer', at: 2.1, phase: 'up', x: 0.25, y: -0.5 },
    ])
  })

  it.each([
    ['left', -0.6, 0],
    ['right', 0.6, 0],
    ['top', 0, -0.6],
    ['bottom', 0, 0.6],
  ] as const)('approaches from %s and ends at the requested distance', (from, x, y) => {
    const events = buildPointerApproach({ at: 0, from, startDistance: 8, endDistance: 0.6, speed: 3, rateHz: 60 })
    expect(events.at(-1)).toMatchObject({ kind: 'pointer', phase: 'move', x, y })
  })
})
