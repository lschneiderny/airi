import type { MotionScenario } from './schema'

import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { hostProfileViolations, MotionScenarioSchema, stripEmotions } from '.'

const events: MotionScenario['events'] = [
  { kind: 'cursor', at: 1, x: 1, y: 0 },
  { kind: 'pointer', at: 2, phase: 'move', x: 0, y: 1 },
  { kind: 'placement', at: 3, inward: 1 },
  { kind: 'mode', at: 4, mode: 'idle' },
]
const scenario: MotionScenario = { version: 1, id: 'host-profile', seed: 1, durationSeconds: 10, levels: ['t1', 't2'], events }

describe('hostProfileViolations', () => {
  it('reports every unavailable Wayland input and every forced mode', () => {
    const violations = hostProfileViolations({ ...scenario, settings: { host: 'linux-wayland' } })
    expect(violations).toHaveLength(4)
    for (const [index, kind] of ['cursor', 'pointer', 'placement', 'mode'].entries())
      expect(violations[index]).toContain(kind)
  })

  it('allows Windows cursor, pointer and placement but refuses a forced mode', () => {
    const violations = hostProfileViolations({ ...scenario, settings: { host: 'windows' } })
    expect(violations).toEqual([expect.stringContaining('mode')])
  })

  it('keeps unprofiled scripts unrestricted and does not mutate stripped profiles', () => {
    expect(hostProfileViolations(scenario)).toEqual([])
    const input: MotionScenario = { ...scenario, settings: { host: 'linux-wayland' }, events: [{ kind: 'emotion', at: 2, emotion: 'happy', band: 'clear', source: 'devtools' }] }
    const stripped = stripEmotions(input)
    expect(stripped.settings?.host).toBe('linux-wayland')
    expect(stripped.events).toEqual([{ kind: 'noop', at: 2, replaced: 'emotion' }])
    expect(input.events[0].kind).toBe('emotion')
    expect(hostProfileViolations(stripped)).toEqual([])
  })
})

describe('host profile scenario validation', () => {
  it.each(events)('names the forbidden $kind input', (event) => {
    const result = safeParse(MotionScenarioSchema, { ...scenario, settings: { host: 'linux-wayland' }, events: [event] })
    expect(result.success).toBe(false)
    expect(result.issues?.map(issue => issue.message).join('; ')).toContain(event.kind)
  })

  it('accepts a valid profile and rejects an unknown host', () => {
    expect(safeParse(MotionScenarioSchema, { ...scenario, settings: { host: 'linux-wayland' }, events: [] }).success).toBe(true)
    const result = safeParse(MotionScenarioSchema, { ...scenario, settings: { host: 'unknown' }, events: [] })
    expect(result.success).toBe(false)
    expect(result.issues?.[0].path?.map(item => item.key)).toEqual(['settings', 'host'])
  })
})
