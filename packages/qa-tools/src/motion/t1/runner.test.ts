import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

import { buildEmotionTrial, stripEmotions } from '@proj-airi/stage-shared/motion-scenario'
import { describe, expect, it, vi } from 'vitest'

import catalogJson from '../../../fixtures/forbooth-catalog.json'

import { runT1 } from './runner'

const catalog = catalogJson as CatalogEntry[]
const step = 1 / 120

/** A short trial keeps each run cheap: 4 s idle, a 2 s hold, 3 s after. */
const trial = (variant: 'full' | 'held-only' = 'full', seed = 1) => buildEmotionTrial({ emotion: 'angry', band: 'strong', variant, seed, warmup: 4, hold: 2, post: 3 })

function withEvents(events: unknown[], overrides: Record<string, unknown> = {}): MotionScenario {
  return { ...trial(), ...overrides, events } as MotionScenario
}

describe('runT1', () => {
  it('serializes two runs of one scenario to the same bytes, whatever ran in between', () => {
    const first = JSON.stringify(runT1(trial()))
    runT1(trial('full', 2))

    expect(JSON.stringify(runT1(trial()))).toBe(first)
    expect(JSON.stringify(runT1(trial('full', 2)))).not.toBe(first)
  })

  it('matches the stripped run sample for sample until the first emotion', () => {
    const scenario = trial()
    const full = runT1(scenario)
    const stripped = runT1(stripEmotions(scenario))
    const at = scenario.events[0].at
    const before = full.t.filter(t => t < at).length

    expect(before).toBeGreaterThan(0)
    expect(stripped.t.slice(0, before)).toEqual(full.t.slice(0, before))
    for (const id of Object.keys(full.channels))
      expect(stripped.channels[id].slice(0, before)).toEqual(full.channels[id].slice(0, before))
    expect(full.channels.ParamBrowLY.slice(before)).not.toEqual(stripped.channels.ParamBrowLY.slice(before))
  })

  it('performs an angry strong pulse as a hold and an impulse within one step', () => {
    const trace = runT1(trial())
    const at = trial().events[0].at
    const natural = trace.events.flatMap(entry => entry.source === 'natural' ? [entry] : [])
    const impulse = natural.find(entry => entry.event.kind === 'impulse')
    const hold = natural.find(entry => entry.event.kind === 'hold' && entry.event.emotion === 'angry')

    expect(trace.events.some(entry => entry.source === 'scenario' && entry.event.kind === 'emotion' && entry.t === at)).toBe(true)
    expect(impulse?.event).toMatchObject({ kind: 'impulse', emotion: 'angry', band: 'strong' })
    expect(impulse!.t).toBeGreaterThanOrEqual(at - 1e-9)
    expect(impulse!.t).toBeLessThanOrEqual(at + step + 1e-9)
    expect(hold?.event).toMatchObject({ kind: 'hold', emotion: 'angry' })
    expect(hold!.event.kind === 'hold' && hold!.event.strength).toBeGreaterThan(0.8)
  })

  it('performs no hold while held emotions are off', () => {
    const scenario = { ...trial(), settings: { ...trial().settings, heldEmotions: false } } as MotionScenario
    const kinds = runT1(scenario).events.flatMap(entry => entry.source === 'natural' ? [entry.event.kind] : [])

    expect(kinds).toContain('impulse')
    expect(kinds).not.toContain('hold')
  })

  it('rejects scenarios the shared schema rejects', () => {
    const bad = (event: Record<string, unknown>, overrides?: Record<string, unknown>) => () => runT1(withEvents([{ kind: 'emotion', at: 1, emotion: 'angry', band: 'strong', source: 'devtools', ...event }], overrides))

    expect(bad({ emotion: 'furious' })).toThrow()
    expect(bad({ band: 'extreme' })).toThrow()
    expect(bad({}, { levels: ['t3'] })).toThrow(/level t1/)
    expect(() => runT1(withEvents([{ kind: 'marker', at: 2, label: 'a' }, { kind: 'marker', at: 1, label: 'b' }]))).toThrow()
    expect(() => runT1(withEvents([], { settings: { performance: { bands: 'yes' } } }))).toThrow(/invalid performance settings/)
  })

  it('performs an ACT marker like a pulse and rejects a marker without an emotion', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const act = (marker: string) => withEvents([{ kind: 'act', at: 4, marker }])
    const performed = runT1(act('<|ACT {"emotion":{"name":"angry","intensity":0.9}}|>')).events.flatMap(entry => entry.source === 'natural' ? [entry.event.kind] : [])

    expect(performed).toContain('impulse')
    expect(() => runT1(act('<|ACT {"emotion":"furious"}|>'))).toThrow(/no recognized emotion/)
  })

  it('resolves expression events against the catalog only', () => {
    const show = withEvents([{ kind: 'expression', at: 4, expressionId: 'expression1', on: true }])

    expect(runT1(show, { catalog }).events.map(entry => entry.event.kind)).toContain('expression')
    expect(() => runT1(show)).toThrow(/not an exposed catalog entry/)
  })

  it('records speech through the conductor without stale turns', () => {
    const speech = withEvents([{ kind: 'speech', at: 2, turnId: 'turn-1', seconds: 2, envelopeSeed: 5 }], { levels: ['t1'] })
    const trace = runT1(speech)

    expect(trace.t.at(-1)).toBeGreaterThan(4)
    expect(JSON.stringify(runT1(speech))).toBe(JSON.stringify(trace))
  })
})
