import type { CatalogEntry } from './catalog'
import type { AffectSignal, Decider, DeciderContext, PerformanceEmotion, ReactionEpisode } from './types'

import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { AffectTraceSchema, bandOf, createPickerDecider, createPlannerDecider, defaultExpressionPerformanceSettings, primaryMapping, replayAffectTrace } from '.'

const settings = {
  ...defaultExpressionPerformanceSettings,
  intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0, habituationBase: 1 },
}
type Mapping = CatalogEntry['mappings'][number]
function entry(id: string, kind: CatalogEntry['kind'], mappings: Mapping[]): CatalogEntry {
  return { id, kind, label: id, fileName: id, parameterIds: [], confirmed: true, exposedToLlm: true, group: null, mappings }
}
const catalog = [
  entry('glare', 'face', [{ emotion: 'angry', minBand: 'strong', weight: 1 }, { emotion: 'sad', minBand: 'clear', weight: 0.5 }]),
  entry('tied', 'face', [{ emotion: 'sad', minBand: 'clear', weight: 1 }, { emotion: 'love', minBand: 'slight', weight: 1 }]),
  entry('other', 'face', [{ emotion: 'angry', minBand: 'slight', weight: 1 }]),
  entry('plain', 'prop', []),
]
const ctx: DeciderContext = { settings, catalog }
/** An episode as the mind decides it under these settings: without jitter and habituation its intensity is its dose. */
function episode(name: PerformanceEmotion, nominal: number, escalation = false): ReactionEpisode {
  return { id: `${name}-1`, emotion: name, nominal, intensity: nominal, band: bandOf(nominal, settings)!, escalation }
}
function reaction(name: PerformanceEmotion, nominal: number, at: number, turnId?: string, escalation = false): AffectSignal {
  return { kind: 'reaction', episode: episode(name, nominal, escalation), turnId, at }
}
/** `derived` is the episode the mind derived from the entry's mapping, or null when the request started none. */
function expression(expressionId: string, at: number, turnId?: string, holdSeconds?: number, derived: ReactionEpisode | null = null): AffectSignal {
  return { kind: 'expression', source: 'tool', expressionId, holdSeconds, episode: derived, turnId, at }
}

it('reads the heaviest mapping of an entry as its primary one, the earliest on ties', () => {
  expect(primaryMapping(catalog[0])).toMatchObject({ emotion: 'angry', minBand: 'strong' })
  expect(primaryMapping(catalog[1])?.emotion).toBe('sad')
  expect(primaryMapping(catalog[3])).toBeNull()
})

function slotsSuite<S>(name: 'picker' | 'planner', decider: Decider<S>) {
  const withKind = { ...decider, kind: name }
  describe(`${name} explicit expression slots`, () => {
    const combo = { ...entry('combo:angry', 'combo', [{ emotion: 'angry', minBand: 'clear', weight: 1 }]), slots: ['face', 'effect'] as const, members: [{ expressionId: 'glare', strength: 1 }, { expressionId: 'steam', strength: 0.5 }] }
    const comboCtx: DeciderContext = { ...ctx, catalog: [...catalog, entry('steam', 'effect', [{ emotion: 'angry', minBand: 'slight', weight: 1 }]), { ...combo, slots: [...combo.slots] }] }

    it('holds the expression mapped to a lingering emotion twice as long', () => {
      const tied = decider.decide(expression('tied', 0, 'A'), ctx, decider.initial(17)).decision
      expect(tied.slots).toMatchObject([{ expressionId: 'tied', holdSeconds: 8, until: 'speech' }])
    })

    it('emits a combo in face, effect order and keeps both occupants through an escalation', () => {
      const first = decider.decide(expression(combo.id, 0, 'A', 5, episode('angry', 0.6)), comboCtx, decider.initial(17))
      expect(first.decision.slots).toEqual(['face', 'effect'].map(slot => ({ slot, expressionId: combo.id, holdSeconds: 5, until: 'hold', turnId: 'A' })))
      expect(first.state).toMatchObject({ occupants: { face: combo.id, effect: combo.id } })
      const escalated = decider.decide(reaction('angry', 0.9, 1, 'A', true), comboCtx, first.state)
      expect(escalated.decision.slots).toEqual([])
      expect(escalated.state).toMatchObject({ occupants: { face: combo.id, effect: combo.id } })
    })

    it('replacing face nulls the effect occupant of its previous combo', () => {
      const first = decider.decide(expression(combo.id, 0), comboCtx, decider.initial(17))
      const replaced = decider.decide(expression('other', 1), comboCtx, first.state)
      expect(replaced.state).toMatchObject({ occupants: { face: 'other', effect: null } })
      expect(first.state).toMatchObject({ occupants: { face: combo.id, effect: combo.id } })
    })

    it('clearing either slot vacates the entire combo', () => {
      const first = decider.decide(expression(combo.id, 0), comboCtx, decider.initial(17))
      for (const slot of ['face', 'effect'] as const) {
        const cleared = decider.decide({ kind: 'clear', source: 'tool', slot, at: 1 }, comboCtx, first.state)
        expect(cleared.state).toMatchObject({ occupants: { face: null, effect: null } })
      }
    })

    it('a prop command or clear vacates a face+prop combo face occupant', () => {
      const faceProp = { ...combo, id: 'combo:prop', slots: ['face', 'prop'] as const, members: [{ expressionId: 'glare', strength: 1 }, { expressionId: 'plain', strength: 1 }] }
      const context: DeciderContext = { ...comboCtx, catalog: [...comboCtx.catalog, { ...faceProp, slots: [...faceProp.slots] }] }
      const first = decider.decide(expression(faceProp.id, 0), context, decider.initial(17))
      expect(first.decision.slots.map(command => command.slot)).toEqual(['face', 'prop'])
      expect(first.state).toMatchObject({ occupants: { face: faceProp.id, effect: null } })
      for (const signal of [expression('plain', 1), { kind: 'clear', source: 'tool', slot: 'prop', at: 1 } as const])
        expect(decider.decide(signal, context, first.state).state).toMatchObject({ occupants: { face: null, effect: null } })
    })

    it('exactly replays a combo expression, escalation and face clear', () => {
      const signals: AffectSignal[] = [expression(combo.id, 0, 'A', undefined, episode('angry', 0.6)), reaction('angry', 0.9, 1, 'A', true), { kind: 'clear', source: 'tool', slot: 'face', at: 2 }]
      let state = decider.initial(17)
      const live = signals.map((signal) => {
        const result = decider.decide(signal, comboCtx, state)
        state = result.state
        return { at: signal.at, decision: result.decision }
      })
      const trace = parse(AffectTraceSchema, JSON.parse(JSON.stringify({ version: 2, decider: name, checkpoint: decider.initial(17), initialContext: comboCtx, entries: signals.map(signal => ({ type: 'signal', signal })), truncated: false, endAt: 2 })))
      expect(replayAffectTrace(trace, withKind, { mode: 'exact' })).toEqual(live)
    })

    it('gives a mapped expression its slot and draws the tickets of the episode it started', () => {
      const { decision, state } = decider.decide(expression('glare', 0, 'A', undefined, episode('angry', 0.9)), ctx, decider.initial(17))
      expect(decision.slots).toEqual([{ slot: 'face', expressionId: 'glare', holdSeconds: 4, until: 'speech', turnId: 'A' }])
      expect(JSON.parse(JSON.stringify(state))).toMatchObject({ occupants: { face: 'glare', effect: null } })
      expect(state).toMatchObject({ tickets: { face: expect.any(Object), effect: expect.any(Object) } })
      const timed = decider.decide(expression('glare', 0, 'A', 5, episode('angry', 0.9)), ctx, decider.initial(17)).decision
      expect(timed.slots).toMatchObject([{ holdSeconds: 5, until: 'hold' }])
    })

    it('renews the slot of a repeated mapped expression without new tickets', () => {
      const first = decider.decide(expression('glare', 0, 'A', undefined, episode('angry', 0.9)), ctx, decider.initial(17))
      const repeat = decider.decide(expression('glare', 1, 'A'), ctx, first.state)
      expect(repeat.decision.slots).toHaveLength(1)
      expect(repeat.state).toMatchObject({ tickets: (first.state as { tickets: unknown }).tickets, streams: (first.state as { streams: unknown }).streams })
    })

    it('preserves the other slot occupant when a mapped expression starts a new episode', () => {
      const occupied = decider.decide(reaction('angry', 0.9, 0, 'A'), ctx, decider.initial(17))
      const effect = entry('effect', 'effect', [{ emotion: 'happy', minBand: 'slight', weight: 1 }])
      const result = decider.decide(expression('effect', 0.5, 'A', undefined, episode('happy', settings.intensity.slight)), { ...ctx, catalog: [...catalog, effect] }, occupied.state)
      expect(result.state).toMatchObject({ occupants: { face: occupied.decision.slots[0].expressionId, effect: 'effect' } })
      expect(result.decision.slots.map(slot => slot.expressionId)).toEqual(['effect'])
    })

    it('emits nothing for an unknown entry and the slot alone for an unmapped one', () => {
      expect(decider.decide(expression('missing', 0), ctx, decider.initial(17)).decision).toEqual({ slots: [], moods: [] })
      expect(decider.decide(expression('plain', 0, 'A'), ctx, decider.initial(17)).decision.slots.map(slot => slot.expressionId)).toEqual(['plain'])
    })

    it('draws no tickets for an expression that started no episode', () => {
      const { decision, state } = decider.decide(expression('glare', 0, 'A'), ctx, decider.initial(17))
      expect(decision.slots).toHaveLength(1)
      expect(state).toMatchObject({ tickets: null })
    })

    it('picks for a later escalation of an episode an entry started, also after a JSON checkpoint resume', () => {
      const first = decider.decide(expression('tied', 0, 'A', undefined, episode('sad', 0.6)), ctx, decider.initial(17))
      const stronger = reaction('sad', 0.9, 1, 'A', true)
      const direct = decider.decide(stronger, ctx, first.state)
      const resumed = decider.decide(stronger, ctx, JSON.parse(JSON.stringify(first.state)) as S)
      expect(resumed).toEqual(direct)
      expect(direct.state).toMatchObject({ tickets: { face: expect.any(Object), effect: expect.any(Object) } })
    })
  })

  describe(`${name} replay`, () => {
    function trace(signals: AffectSignal[]) {
      return parse(AffectTraceSchema, { version: 2, decider: name, checkpoint: decider.initial(1), initialContext: ctx, entries: signals.map(signal => ({ type: 'signal', signal })), truncated: false, endAt: 99 })
    }
    function live(signals: AffectSignal[]) {
      let state = decider.initial(1)
      return signals.map((signal) => {
        const result = decider.decide(signal, ctx, state)
        state = result.state
        return { at: signal.at, decision: result.decision }
      })
    }

    it('replays a recorded expression signal to the same slot', () => {
      const signals = [expression('glare', 0, 'A', undefined, episode('angry', 0.9))]
      const replayed = replayAffectTrace(trace(signals), withKind, { mode: 'exact' })
      expect(replayed).toEqual(live(signals))
      expect(replayed[0].decision.slots).toHaveLength(1)
    })

    it('replays a trace of reactions, a clear and a neutral to the live decisions', () => {
      const signals = [reaction('happy', 0.6, 0, 'A'), reaction('happy', 0.9, 1, 'A', true), reaction('sad', 0.6, 5), { kind: 'clear', source: 'act', at: 6 } as const, { kind: 'neutral', turnId: 'B', at: 7 } as const]
      const replayed = replayAffectTrace(trace(signals), withKind, { mode: 'exact' })
      expect(replayed).toEqual(live(signals))
      expect(replayed.slice(3).map(step => step.decision.slots.map(command => command.slot))).toEqual([['face', 'effect', 'prop'], ['face', 'effect']])
    })
  })
}

slotsSuite('picker', createPickerDecider())
slotsSuite('planner', createPlannerDecider())

it('drops superseded planner picks when an explicit mapped prop starts a new reaction', () => {
  const planner = createPlannerDecider()
  const pendingCtx = { ...ctx, catalog: [entry('smile', 'face', [{ emotion: 'happy', minBand: 'slight', weight: 1 }]), entry('hat', 'prop', [{ emotion: 'sad', minBand: 'clear', weight: 1 }])] }
  const pending = planner.decide(reaction('happy', 0.6, 0, 'A'), pendingCtx, planner.initial(17))
  expect(planner.nextDeadline(pending.state)).not.toBeNull()
  const explicit = planner.decide(expression('hat', 0.5, 'A', undefined, episode('sad', 0.6)), pendingCtx, pending.state)
  const restored = JSON.parse(JSON.stringify(explicit.state))
  const released = planner.decide({ kind: 'timing', event: { id: 'sentence', kind: 'sentence_start', turnId: 'A', at: 1 }, at: 1 }, pendingCtx, restored)
  expect(explicit.decision.slots.map(slot => slot.expressionId)).toEqual(['hat'])
  expect(released.decision.slots).toEqual([])
  expect(planner.nextDeadline(released.state)).toBeNull()
})
