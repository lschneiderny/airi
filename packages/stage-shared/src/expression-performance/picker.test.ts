import type { CatalogEntry } from './catalog'
import type { AffectSignal, DeciderContext, ReactionEpisode } from './types'

import { describe, expect, it } from 'vitest'

import { bandOf, createDecider, defaultExpressionPerformanceSettings, drawRandom, expressionSeed, pickerCandidates, recencyWeight } from '.'

const decider = createDecider('picker')
const settings = {
  ...defaultExpressionPerformanceSettings,
  intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0, habituationBase: 1 },
}
function entry(id: string, kind: CatalogEntry['kind'] = 'face'): CatalogEntry {
  return { id, kind, label: id, fileName: id, parameterIds: [], confirmed: true, exposedToLlm: true, group: null, mappings: [{ emotion: 'happy', minBand: 'slight', weight: 1 }] }
}
/** A happy episode as the mind decides it under these settings: without jitter and habituation its intensity is its dose. */
function episode(nominal = 0.9, escalation = false): ReactionEpisode {
  return { id: 'happy-1', emotion: 'happy', nominal, intensity: nominal, band: bandOf(nominal, settings)!, escalation }
}
function reaction(nominal = 0.9, at = 0, escalation = false, intentId = `${at}-intent`): AffectSignal {
  return { kind: 'reaction', intentId, episode: episode(nominal, escalation), at, turnId: 'turn' }
}
const ctx: DeciderContext = { settings, catalog: [entry('a'), entry('b'), entry('effect', 'effect')] }

describe('picker', () => {
  it.each(['picker', 'planner'] as const)('%s picks the same entries for the same intents despite different conductor seeds', (kind) => {
    const policy = createDecider(kind)
    let first = policy.initial(17)
    let second = policy.initial(9001)
    const picked = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const signals: AffectSignal[] = [
        reaction(0.6, i * 10, false, `${i}-emotion`),
        { kind: 'timing', event: { id: `${i}-start`, kind: 'sentence_start', turnId: 'turn', at: i * 10 + 1 }, at: i * 10 + 1 },
        { kind: 'deadline', at: i * 10 + 8 },
      ]
      for (const signal of signals) {
        const left = policy.decide(signal, ctx, first)
        const right = policy.decide(signal, ctx, second)
        expect(left.decision).toEqual(right.decision)
        for (const command of left.decision.slots) {
          if (command.expressionId)
            picked.add(command.expressionId)
        }
        first = left.state
        second = right.state
      }
    }
    expect(picked.has('a')).toBe(true)
    expect(picked.has('b')).toBe(true)
  })

  const combo: CatalogEntry = { ...entry('combo:look', 'combo'), slots: ['face', 'effect'], members: [{ expressionId: 'a', strength: 1 }, { expressionId: 'effect', strength: 1 }] }
  const comboCtx = { ...ctx, catalog: [...ctx.catalog.map(entry => ({ ...entry, mappings: entry.kind === 'face' ? [] : entry.mappings })), combo] }

  it('automatically emits every combo slot without a separate effect pick', () => {
    const { decision, state } = decider.decide(reaction(), comboCtx, decider.initial(1))
    expect(decision.slots.map(command => [command.slot, command.expressionId])).toEqual([['face', combo.id], ['effect', combo.id]])
    expect(state.occupants).toEqual({ face: combo.id, effect: combo.id })
  })

  it('excludes combos with occupied spans or a prop and selects them only on their first slot', () => {
    for (const occupants of [{ face: 'a', effect: null }, { face: null, effect: 'effect' }])
      expect(pickerCandidates(comboCtx.catalog, episode(), 'face', occupants)).toEqual([])
    expect(pickerCandidates(comboCtx.catalog, episode(), 'effect', { face: null, effect: null }).map(candidate => candidate.id)).toEqual(['effect'])
    const propCombo: CatalogEntry = { ...combo, slots: ['face', 'prop'], members: [{ expressionId: 'a', strength: 1 }, { expressionId: 'prop', strength: 1 }] }
    expect(pickerCandidates([...ctx.catalog, entry('prop', 'prop'), propCombo], episode(), 'face', { face: null, effect: null }).map(candidate => candidate.id)).not.toContain(combo.id)
  })

  it.each(['picker', 'planner'] as const)('%s advances identical streams with and without combo candidates', (kind) => {
    const policy = createDecider(kind)
    let withCombo = policy.initial(123)
    let withoutCombo = policy.initial(123)
    for (let i = 0; i < 20; i++) {
      const signal = reaction([0.25, 0.6, 0.9][i % 3], i * 3)
      withCombo = policy.decide(signal, comboCtx, withCombo).state
      withoutCombo = policy.decide(signal, ctx, withoutCombo).state
      expect(withCombo.streams).toEqual(withoutCombo.streams)
      expect(withCombo.tickets).toEqual(withoutCombo.tickets)
    }
  })

  it('sorts ids by Unicode code point rather than UTF-16 units', () => {
    expect(pickerCandidates([entry('\u{10000}'), entry('\uE000'), entry('aa'), entry('a')], episode(), 'face', { face: null, effect: null }).map(candidate => candidate.id)).toEqual(['a', 'aa', '\uE000', '\u{10000}'])
  })

  it.each([[0.5, 0], [0.65, 0.5], [0.8, 1]])('gates effects at intensity %s', (intensity, probability) => {
    let effects = 0
    for (let seed = 0; seed < 10000; seed++) {
      effects += Number(decider.decide(reaction(intensity, 0, false, `${seed}-emotion`), ctx, decider.initial(seed)).decision.slots.some(slot => slot.slot === 'effect'))
    }
    expect(Math.abs(effects / 10000 - probability)).toBeLessThan(0.02)
  })

  it('lowers recently selected frequency and recovers with age', () => {
    const counts = [0, 0, 0]
    for (let seed = 0; seed < 10000; seed++) {
      for (const [index, age] of [0, 1, 100].entries()) {
        const state = { ...decider.initial(seed), recency: { a: -age } }
        const result = decider.decide(reaction(0.9, 0, false, `${seed}-emotion`), ctx, state)
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
    const empty = decider.decide(reaction(), { ...ctx, catalog: [] }, initial)
    const mapped = decider.decide(reaction(), ctx, initial)
    expect(empty.decision.slots).toEqual([])
    expect(empty.state.streams).toEqual(mapped.state.streams)
    expect(empty.state.tickets).toEqual(mapped.state.tickets)
    for (const slot of ['face', 'effect'] as const) {
      const gate = drawRandom(expressionSeed('0-intent', slot))
      const pick = drawRandom(gate.random)
      expect(empty.state.streams[slot]).toBe(pick.random)
      expect(empty.state.tickets?.[slot]).toEqual({ gate: gate.value, pick: pick.value })
    }
    const withoutRecency = { ...mapped.state, recency: {} }
    expect(decider.decide(reaction(0.9, 3), ctx, empty.state)).toEqual(decider.decide(reaction(0.9, 3), ctx, withoutRecency))
  })

  it('replays identical seeds and JSON checkpoints independent of input order', () => {
    let state = decider.initial(42)
    let replay = decider.initial(42)
    let checkpoint = decider.initial(42)
    for (let i = 0; i < 200; i++) {
      const signal = reaction([0.25, 0.6, 0.9][i % 3], i * 3)
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
    expect(decider.decide(reaction(), { ...ctx, catalog }, decider.initial(1)).decision.slots).toEqual([])
    const unconfirmed = [...catalog, { ...entry('unconfirmed'), confirmed: false }]
    expect(decider.decide(reaction(), { ...ctx, catalog: unconfirmed }, decider.initial(1)).decision.slots.map(slot => slot.expressionId)).toContain(entry('unconfirmed').id)
  })

  it('ignores malformed weights and neutral mappings', () => {
    const catalog = [0, -1, Number.NaN].map((weight, i) => ({ ...entry(`${i}`), mappings: [{ emotion: 'happy' as const, minBand: 'slight' as const, weight }] }))
    // A malformed document bypassing the catalog validator must still never select neutral.
    catalog.push(JSON.parse(JSON.stringify({ ...entry('neutral'), mappings: [{ emotion: 'neutral', minBand: 'slight', weight: 1 }] })))
    expect(decider.decide(reaction(), { ...ctx, catalog }, decider.initial(1)).decision.slots).toEqual([])
  })

  it('clears face and effect on neutral and forgets the episode tickets', () => {
    const first = decider.decide(reaction(), ctx, decider.initial(1))
    const neutral = decider.decide({ kind: 'neutral', intentId: '133-neutral', turnId: 'turn', at: 1 }, ctx, first.state)
    expect(neutral.state.tickets).toBeNull()
    expect(neutral.decision.slots.map(slot => [slot.slot, slot.expressionId])).toEqual([['face', null], ['effect', null]])
    expect(neutral.state.occupants).toEqual({ face: null, effect: null })
  })

  it('reuses tickets and occupied slots on escalation but fills empty slots', () => {
    const first = decider.decide(reaction(0.5), ctx, decider.initial(1))
    const escalated = decider.decide(reaction(0.9, 1, true), ctx, first.state)
    expect(escalated.state.tickets).toEqual(first.state.tickets)
    expect(escalated.state.streams).toEqual(first.state.streams)
    expect(escalated.decision.slots.map(slot => slot.slot)).toEqual(['effect'])
    expect(escalated.state.occupants.face).toBe(first.state.occupants.face)
  })

  it.each(['picker', 'planner'] as const)('%s draws tickets for an escalation whose episode began before its state', (kind) => {
    // The mind keeps the reaction history, so a decider that was just switched to can meet an escalation first.
    const policy = createDecider(kind)
    const initial = policy.initial(1)
    const escalated = policy.decide(reaction(0.9, 0, true), ctx, initial)
    expect(escalated.state.tickets).not.toBeNull()
    expect(escalated.state.streams).not.toEqual(initial.streams)
    expect(escalated.decision.slots.map(slot => slot.slot)).toContain('face')
  })

  it('honors switches and minimum bands', () => {
    const disabled = decider.decide(reaction(), { ...ctx, settings: { ...settings, autoExpressions: false } }, decider.initial(1))
    expect(disabled.decision.slots).toEqual([])
    const enabled = decider.decide(reaction(), ctx, decider.initial(1))
    expect(disabled.state.streams).toEqual(enabled.state.streams)
    expect(enabled.decision.slots.every(slot => slot.holdSeconds === (slot.slot === 'effect' ? 6 : 4) && slot.until === 'speech' && slot.turnId === 'turn')).toBe(true)
    const strongOnly = { ...entry('strong'), mappings: [{ emotion: 'happy' as const, minBand: 'strong' as const, weight: 1 }] }
    expect(decider.decide(reaction(0.6), { ...ctx, catalog: [strongOnly] }, decider.initial(1)).decision.slots).toEqual([])
  })

  it('emits explicit face, effect, and prop commands with correct lifetimes', () => {
    for (const kind of ['face', 'effect', 'prop'] as const) {
      for (const [holdSeconds, expectedHoldSeconds, until] of [
        [undefined, kind === 'effect' ? 6 : 4, 'speech'],
        [0, 0, 'speech'],
        [5, 5, 'hold'],
      ] as const) {
        const result = decider.decide({ kind: 'expression', intentId: '175-expression', source: 'tool', expressionId: kind, at: 5, holdSeconds, episode: null, turnId: 't' }, { ...ctx, catalog: [entry(kind, kind)] }, decider.initial(1))
        expect(result.decision.slots).toEqual([{ slot: kind, expressionId: kind, holdSeconds: expectedHoldSeconds, until, turnId: 't' }])
        expect(result.state.recency[kind]).toBe(5)
      }
    }
    expect(decider.decide({ kind: 'expression', intentId: '180-expression', source: 'act', expressionId: 'unknown', episode: null, at: 0 }, ctx, decider.initial(1)).decision.slots).toEqual([])
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
      expect(decider.decide(signal, ctx, state)).toEqual({ decision: { slots: [] }, state })
    decider.decide(reaction(), ctx, state)
    expect(JSON.stringify(state)).toBe(before)
    expect(decider.nextDeadline(state)).toBeNull()
  })
})

describe('picker clear signal', () => {
  it('releases only the named slot and keeps the other occupant and the episode tickets', () => {
    const state = decider.decide(reaction(), ctx, decider.initial(1)).state

    const result = decider.decide({ kind: 'clear', intentId: '204-clear', source: 'tool', slot: 'face', turnId: 'turn', at: 1 }, ctx, state)

    expect(result.decision).toEqual({ slots: [{ slot: 'face', expressionId: null, holdSeconds: 0, until: 'hold', turnId: 'turn' }] })
    expect(state.occupants.face).not.toBeNull()
    expect(result.state.occupants.face).toBeNull()
    expect(result.state.occupants.effect).toBe(state.occupants.effect)
    expect(result.state.tickets).toEqual(state.tickets)
  })

  it('releases face, effect, and prop when no slot is named, unlike neutral', () => {
    const state = decider.decide(reaction(), ctx, decider.initial(1)).state

    const cleared = decider.decide({ kind: 'clear', intentId: '216-clear', source: 'act', at: 1 }, ctx, state)
    const neutral = decider.decide({ kind: 'neutral', intentId: '217-neutral', at: 3, turnId: 'turn' }, ctx, state)

    expect(cleared.decision.slots).toEqual((['face', 'effect', 'prop'] as const).map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'hold', turnId: undefined })))
    expect(cleared.state.occupants).toEqual({ face: null, effect: null })
    expect(neutral.decision.slots.map(command => command.slot)).toEqual(['face', 'effect'])
  })
})
