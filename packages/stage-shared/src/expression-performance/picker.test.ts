import type { CatalogEntry } from './catalog'
import type { AffectSignal, DeciderContext } from './types'

import { describe, expect, it } from 'vitest'

import { createDecider, defaultExpressionPerformanceSettings, drawRandom, pickerCandidates, recencyWeight } from '.'

const decider = createDecider('picker')
const settings = {
  ...defaultExpressionPerformanceSettings,
  intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0, habituationBase: 1 },
}
function entry(id: string, kind: CatalogEntry['kind'] = 'face'): CatalogEntry {
  return { id, kind, label: id, fileName: id, parameterIds: [], confirmed: true, exposedToLlm: true, group: null, mappings: [{ emotion: 'happy', minBand: 'slight', weight: 1 }] }
}
function emotion(nominal = 0.9, at = 0): AffectSignal {
  return { kind: 'emotion', emotion: 'happy', source: 'act', nominal, at, turnId: 'turn' }
}
const ctx: DeciderContext = { settings, catalog: [entry('a'), entry('b'), entry('effect', 'effect')] }

describe('picker', () => {
  it('sorts ids by Unicode code point rather than UTF-16 units', () => {
    const episode = decider.decide(emotion(), ctx, decider.initial(1)).decision.episodes[0]
    expect(pickerCandidates([entry('\u{10000}'), entry('\uE000'), entry('aa'), entry('a')], episode, 'face').map(candidate => candidate.id)).toEqual(['a', 'aa', '\uE000', '\u{10000}'])
  })

  it.each([[0.5, 0], [0.65, 0.5], [0.8, 1]])('gates effects at intensity %s', (intensity, probability) => {
    let effects = 0
    for (let seed = 0; seed < 10000; seed++) {
      effects += Number(decider.decide(emotion(intensity), ctx, decider.initial(seed)).decision.slots.some(slot => slot.slot === 'effect'))
    }
    expect(Math.abs(effects / 10000 - probability)).toBeLessThan(0.02)
  })

  it('lowers recently selected frequency and recovers with age', () => {
    const counts = [0, 0, 0]
    for (let seed = 0; seed < 10000; seed++) {
      for (const [index, age] of [0, 1, 100].entries()) {
        const state = { ...decider.initial(seed), recency: { a: -age } }
        const result = decider.decide(emotion(), ctx, state)
        counts[index] += Number(result.decision.slots.some(slot => slot.expressionId === 'a'))
      }
    }
    expect(counts[0]).toBeLessThan(counts[1])
    expect(counts[1]).toBeLessThan(counts[2])
    expect(counts[2] / 10000).toBeCloseTo(0.5, 1)
    expect(recencyWeight(1, 0, 0, { ...settings.picker, recencyTau: 0 })).toBe(1)
  })

  it('consumes identical tickets even when both candidate lists are empty', () => {
    const initial = decider.initial(123)
    const empty = decider.decide(emotion(), { ...ctx, catalog: [] }, initial)
    const mapped = decider.decide(emotion(), ctx, initial)
    expect(empty.decision.slots).toEqual([])
    expect(empty.state.streams).toEqual(mapped.state.streams)
    expect(empty.state.tickets).toEqual(mapped.state.tickets)
    for (const slot of ['face', 'effect'] as const) {
      const gate = drawRandom(initial.streams[slot])
      const pick = drawRandom(gate.random)
      expect(empty.state.streams[slot]).toBe(pick.random)
      expect(empty.state.tickets?.[slot]).toEqual({ gate: gate.value, pick: pick.value })
    }
    const withoutRecency = { ...mapped.state, recency: {} }
    expect(decider.decide(emotion(0.9, 3), ctx, empty.state)).toEqual(decider.decide(emotion(0.9, 3), ctx, withoutRecency))
  })

  it('replays identical seeds and JSON checkpoints independent of input order', () => {
    let state = decider.initial(42)
    let replay = decider.initial(42)
    let checkpoint = decider.initial(42)
    for (let i = 0; i < 200; i++) {
      const signal = emotion([0.25, 0.6, 0.9][i % 3], i * 3)
      const result = decider.decide(signal, ctx, state)
      const repeated = decider.decide(signal, { ...ctx, catalog: [...ctx.catalog].reverse() }, replay)
      const restored = decider.decide(signal, ctx, checkpoint)
      expect(repeated).toEqual(result)
      expect(restored).toEqual(result)
      state = result.state
      replay = repeated.state
      checkpoint = i === 100 ? JSON.parse(JSON.stringify(restored.state)) : restored.state
    }
  })

  it('never automatically selects outfit, prop, or system entries but allows unconfirmed faces', () => {
    const catalog = [entry('outfit', 'outfit'), entry('prop', 'prop'), entry('system', 'system')]
    expect(decider.decide(emotion(), { ...ctx, catalog }, decider.initial(1)).decision.slots).toEqual([])
    const unconfirmed = [...catalog, { ...entry('unconfirmed'), confirmed: false }]
    expect(decider.decide(emotion(), { ...ctx, catalog: unconfirmed }, decider.initial(1)).decision.slots.map(slot => slot.expressionId)).toContain(entry('unconfirmed').id)
  })

  it('ignores malformed weights and neutral mappings', () => {
    const catalog = [0, -1, Number.NaN].map((weight, i) => ({ ...entry(`${i}`), mappings: [{ emotion: 'happy' as const, minBand: 'slight' as const, weight }] }))
    // A malformed document bypassing the catalog validator must still never select neutral.
    catalog.push(JSON.parse(JSON.stringify({ ...entry('neutral'), mappings: [{ emotion: 'neutral', minBand: 'slight', weight: 1 }] })))
    expect(decider.decide(emotion(), { ...ctx, catalog }, decider.initial(1)).decision.slots).toEqual([])
  })

  it('clears face and effect on neutral with no episode', () => {
    const first = decider.decide(emotion(), ctx, decider.initial(1))
    const neutral = decider.decide({ ...emotion(0.6, 1), emotion: 'neutral' } as AffectSignal, ctx, first.state)
    expect(neutral.decision.episodes).toEqual([])
    expect(neutral.decision.slots.map(slot => [slot.slot, slot.expressionId])).toEqual([['face', null], ['effect', null]])
    expect(neutral.state.occupants).toEqual({ face: null, effect: null })
  })

  it('reuses tickets and occupied slots on escalation but fills empty slots', () => {
    const first = decider.decide(emotion(0.5), ctx, decider.initial(1))
    const escalated = decider.decide(emotion(0.9, 1), ctx, first.state)
    expect(escalated.state.tickets).toEqual(first.state.tickets)
    expect(escalated.state.streams).toEqual(first.state.streams)
    expect(escalated.decision.slots.map(slot => slot.slot)).toEqual(['effect'])
    expect(escalated.state.occupants.face).toBe(first.state.occupants.face)
    expect(escalated.decision.episodes[0].escalation).toBe(true)
    const repeat = decider.decide(emotion(0.9, 1.5), ctx, escalated.state)
    expect(repeat.decision).toEqual({ episodes: [], slots: [], holds: [] })
  })

  it('honors switches and minimum bands', () => {
    const disabled = decider.decide(emotion(), { ...ctx, settings: { ...settings, autoExpressions: false } }, decider.initial(1))
    expect(disabled.decision.slots).toEqual([])
    expect(disabled.decision.episodes).toHaveLength(1)
    const enabled = decider.decide(emotion(), ctx, decider.initial(1))
    expect(disabled.state.streams).toEqual(enabled.state.streams)
    expect(disabled.state.reaction.random).toBe(drawRandom(1).random)
    expect(enabled.decision.slots.every(slot => slot.holdSeconds === settings.naturalBands.strong.faceHold && slot.until === 'speech' && slot.turnId === 'turn')).toBe(true)
    const bandsOff = decider.decide(emotion(), { ...ctx, settings: { ...settings, bands: false } }, decider.initial(1))
    expect(bandsOff.decision.episodes[0].nominal).toBe(0.6)
    const strongOnly = { ...entry('strong'), mappings: [{ emotion: 'happy' as const, minBand: 'strong' as const, weight: 1 }] }
    expect(decider.decide(emotion(0.6), { ...ctx, catalog: [strongOnly] }, decider.initial(1)).decision.slots).toEqual([])
  })

  it('emits explicit face, effect, and prop commands with correct lifetimes', () => {
    for (const kind of ['face', 'effect', 'prop'] as const) {
      for (const [holdSeconds, expectedHoldSeconds, until] of [
        [undefined, settings.naturalBands.clear.faceHold, 'speech'],
        [0, 0, 'speech'],
        [5, 5, 'hold'],
      ] as const) {
        const result = decider.decide({ kind: 'expression', source: 'tool', expressionId: kind, at: 5, holdSeconds, turnId: 't' }, { ...ctx, catalog: [entry(kind, kind)] }, decider.initial(1))
        expect(result.decision.slots).toEqual([{ slot: kind, expressionId: kind, holdSeconds: expectedHoldSeconds, until, turnId: 't' }])
        expect(result.state.recency[kind]).toBe(5)
      }
    }
    expect(decider.decide({ kind: 'expression', source: 'act', expressionId: 'unknown', at: 0 }, ctx, decider.initial(1)).decision.slots).toEqual([])
  })

  it('ignores performer events and never schedules or mutates a checkpoint', () => {
    const state = decider.initial(1)
    const before = JSON.stringify(state)
    const signals: AffectSignal[] = [
      { kind: 'speech', event: 'clip-start', turnId: 't', at: 0 },
      { kind: 'muted', muted: true, at: 0 },
      { kind: 'timing', event: { id: 'e', kind: 'pause', turnId: 't', at: 0 }, at: 0 },
      { kind: 'deadline', at: 0 },
    ]
    for (const signal of signals)
      expect(decider.decide(signal, ctx, state)).toEqual({ decision: { episodes: [], slots: [], holds: [] }, state })
    decider.decide(emotion(), ctx, state)
    expect(JSON.stringify(state)).toBe(before)
    expect(decider.nextDeadline(state)).toBeNull()
  })
})

describe('picker clear signal', () => {
  it('releases only the named slot and keeps the other occupant and the reaction history', () => {
    const state = decider.decide(emotion(), ctx, decider.initial(1)).state

    const result = decider.decide({ kind: 'clear', source: 'tool', slot: 'face', turnId: 'turn', at: 1 }, ctx, state)

    expect(result.decision).toEqual({ episodes: [], slots: [{ slot: 'face', expressionId: null, holdSeconds: 0, until: 'hold', turnId: 'turn' }], holds: [] })
    expect(state.occupants.face).not.toBeNull()
    expect(result.state.occupants.face).toBeNull()
    expect(result.state.occupants.effect).toBe(state.occupants.effect)
    expect(result.state.reaction).toEqual(state.reaction)
  })

  it('releases face, effect, and prop when no slot is named, unlike neutral', () => {
    const state = decider.decide(emotion(), ctx, decider.initial(1)).state

    const cleared = decider.decide({ kind: 'clear', source: 'act', at: 1 }, ctx, state)
    const neutral = decider.decide({ kind: 'emotion', emotion: 'neutral', source: 'act', nominal: 0.6, at: 3, turnId: 'turn' }, ctx, state)

    expect(cleared.decision.slots).toEqual((['face', 'effect', 'prop'] as const).map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'hold', turnId: undefined })))
    expect(cleared.state.occupants).toEqual({ face: null, effect: null })
    expect(neutral.decision.slots.map(command => command.slot)).toEqual(['face', 'effect'])
  })
})
