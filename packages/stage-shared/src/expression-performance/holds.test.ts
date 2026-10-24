import type { CatalogEntry } from './catalog'
import type { AffectSignal, Decider, DeciderContext, PerformanceEmotion } from './types'

import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { AffectTraceSchema, createPickerDecider, createPlannerDecider, defaultExpressionPerformanceSettings, replayAffectTrace } from '.'

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
function emotion(name: PerformanceEmotion, nominal: number, at: number, turnId?: string): AffectSignal {
  return { kind: 'emotion', source: 'act', emotion: name, nominal, turnId, at }
}
function expression(expressionId: string, at: number, turnId?: string, holdSeconds?: number): AffectSignal {
  return { kind: 'expression', source: 'tool', expressionId, holdSeconds, turnId, at }
}

function holdsSuite<S>(name: 'picker' | 'planner', decider: Decider<S>) {
  const withKind = { ...decider, kind: name }
  describe(`${name} emotion holds`, () => {
    it('holds a turn-bound emotion at the episode strength until speech ends', () => {
      const { decision } = decider.decide(emotion('happy', 0.6, 0, 'A'), ctx, decider.initial(17))
      expect(decision.holds).toEqual([{ emotion: 'happy', strength: decision.episodes[0].intensity, holdSeconds: settings.naturalBands.clear.faceHold, until: 'speech', turnId: 'A' }])
      expect(decision.holds[0].strength).toBe(0.6)
    })

    it('holds a turnless emotion for the configured seconds', () => {
      const { decision } = decider.decide(emotion('happy', 0.6, 0), ctx, decider.initial(17))
      expect(decision.holds).toEqual([{ emotion: 'happy', strength: 0.6, holdSeconds: 4, until: 'hold' }])
    })

    it('holds an escalation at the higher strength', () => {
      const first = decider.decide(emotion('happy', 0.6, 0, 'A'), ctx, decider.initial(17))
      const escalated = decider.decide(emotion('happy', 0.9, 1, 'A'), ctx, first.state)
      expect(escalated.decision.holds.map(hold => hold.strength)).toEqual([0.9])
    })

    it('releases the hold on a state-changing neutral and on a slotless clear, but not a named clear', () => {
      const first = decider.decide(emotion('happy', 0.6, 0, 'A'), ctx, decider.initial(17))
      const release = { emotion: null, strength: 0, holdSeconds: 0, until: 'hold' }
      expect(decider.decide(emotion('neutral', 0.6, 1, 'A'), ctx, first.state).decision.holds).toEqual([{ ...release, turnId: 'A' }])
      expect(decider.decide({ kind: 'clear', source: 'act', at: 1 }, ctx, first.state).decision.holds).toEqual([release])
      expect(decider.decide({ kind: 'clear', source: 'act', slot: 'face', at: 1 }, ctx, first.state).decision.holds).toEqual([])
    })
  })

  describe(`${name} explicit expression reactions`, () => {
    const combo = { ...entry('combo:angry', 'combo', [{ emotion: 'angry', minBand: 'clear', weight: 1 }]), slots: ['face', 'effect'] as const, members: [{ expressionId: 'glare', strength: 1 }, { expressionId: 'steam', strength: 0.5 }] }
    const comboCtx: DeciderContext = { ...ctx, catalog: [...catalog, entry('steam', 'effect', [{ emotion: 'angry', minBand: 'slight', weight: 1 }]), { ...combo, slots: [...combo.slots] }] }

    it('emits a combo in face, effect order, holds both occupants, and derives one reaction', () => {
      const first = decider.decide(expression(combo.id, 0, 'A', 5), comboCtx, decider.initial(17))
      expect(first.decision.slots).toEqual(['face', 'effect'].map(slot => ({ slot, expressionId: combo.id, holdSeconds: 5, until: 'hold', turnId: 'A' })))
      expect(first.decision.episodes).toHaveLength(1)
      expect(first.decision.holds).toHaveLength(1)
      expect(first.state).toMatchObject({ occupants: { face: combo.id, effect: combo.id } })
      const escalated = decider.decide(emotion('angry', 0.9, 1, 'A'), comboCtx, first.state)
      expect(escalated.decision.episodes).toMatchObject([{ escalation: true }])
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
      const signals: AffectSignal[] = [expression(combo.id, 0, 'A'), emotion('angry', 0.9, 1, 'A'), { kind: 'clear', source: 'tool', slot: 'face', at: 2 }]
      let state = decider.initial(17)
      const live = signals.map((signal) => {
        const result = decider.decide(signal, comboCtx, state)
        state = result.state
        return { at: signal.at, decision: result.decision }
      })
      const trace = parse(AffectTraceSchema, JSON.parse(JSON.stringify({ version: 1, decider: name, checkpoint: decider.initial(17), initialContext: comboCtx, entries: signals.map(signal => ({ type: 'signal', signal })), truncated: false, endAt: 2 })))
      expect(replayAffectTrace(trace, withKind, { mode: 'exact' })).toEqual(live)
    })

    it('derives the heaviest mapping as an episode and mirrors the slot lifetime in the hold', () => {
      const { decision, state } = decider.decide(expression('glare', 0, 'A'), ctx, decider.initial(17))
      expect(decision.episodes).toMatchObject([{ emotion: 'angry', band: 'strong', intensity: 0.9, escalation: false }])
      expect(decision.slots).toEqual([{ slot: 'face', expressionId: 'glare', holdSeconds: settings.naturalBands.clear.faceHold, until: 'speech', turnId: 'A' }])
      expect(decision.holds).toEqual([{ emotion: 'angry', strength: 0.9, holdSeconds: decision.slots[0].holdSeconds, until: 'speech', turnId: 'A' }])
      expect(JSON.parse(JSON.stringify(state))).toMatchObject({ occupants: { face: 'glare', effect: null } })
      const timed = decider.decide(expression('glare', 0, 'A', 5), ctx, decider.initial(17)).decision
      expect(timed.holds).toMatchObject([{ holdSeconds: 5, until: 'hold' }])
    })

    it('refreshes the hold of a repeated mapped expression without a new episode', () => {
      const first = decider.decide(expression('glare', 0, 'A'), ctx, decider.initial(17))
      const repeat = decider.decide(expression('glare', 1, 'A'), ctx, first.state)
      expect(repeat.decision.episodes).toEqual([])
      expect(repeat.decision.slots).toHaveLength(1)
      expect(repeat.decision.holds).toEqual(first.decision.holds)
    })

    it('breaks weight ties toward the earliest mapping', () => {
      const { decision } = decider.decide(expression('tied', 0), ctx, decider.initial(17))
      expect(decision.episodes.map(episode => episode.emotion)).toEqual(['sad'])
    })

    it('refreshes the mapped hold even when its configured dose is zero', () => {
      const zero = { ...ctx, settings: { ...settings, intensity: { ...settings.intensity, strong: 0 } } }
      const result = decider.decide(expression('glare', 0, 'A', 5), zero, decider.initial(17))
      expect(result.decision.episodes).toEqual([])
      expect(result.decision.holds).toEqual([{ emotion: 'angry', strength: 0, holdSeconds: 5, until: 'hold', turnId: 'A' }])
    })

    it('preserves the other slot occupant when a mapped expression starts a new episode', () => {
      const occupied = decider.decide(emotion('angry', 0.9, 0, 'A'), ctx, decider.initial(17))
      const effect = entry('effect', 'effect', [{ emotion: 'happy', minBand: 'slight', weight: 1 }])
      const result = decider.decide(expression('effect', 0.5, 'A'), { ...ctx, catalog: [...catalog, effect] }, occupied.state)
      expect(result.state).toMatchObject({ occupants: { face: occupied.decision.slots[0].expressionId, effect: 'effect' } })
      expect(result.decision.slots.map(slot => slot.expressionId)).toEqual(['effect'])
    })

    it('adds no episode or hold for unmapped or unknown entries', () => {
      for (const id of ['plain', 'missing']) {
        const { decision } = decider.decide(expression(id, 0, 'A'), ctx, decider.initial(17))
        expect(decision.episodes).toEqual([])
        expect(decision.holds).toEqual([])
      }
      expect(decider.decide(expression('missing', 0), ctx, decider.initial(17)).decision).toEqual({ episodes: [], slots: [], holds: [] })
    })

    it('keeps the old slot-only behavior when held emotions are off', () => {
      const initial = decider.initial(17)
      const off = { ...ctx, settings: { ...settings, heldEmotions: false } }
      const { decision, state } = decider.decide(expression('glare', 0, 'A'), off, initial)
      expect(decision.slots).toHaveLength(1)
      expect(decision.episodes).toEqual([])
      expect(decision.holds).toEqual([])
      expect(state).toMatchObject({ reaction: (initial as { reaction: unknown }).reaction, tickets: null })
    })

    it('escalates a derived episode with a later stronger signal, also after a JSON checkpoint resume', () => {
      const first = decider.decide(expression('tied', 0, 'A'), ctx, decider.initial(17))
      const stronger = emotion('sad', 0.9, 1, 'A')
      const direct = decider.decide(stronger, ctx, first.state)
      const resumed = decider.decide(stronger, ctx, JSON.parse(JSON.stringify(first.state)) as S)
      expect(direct.decision.episodes).toMatchObject([{ emotion: 'sad', escalation: true }])
      expect(direct.decision.holds.map(hold => hold.strength)).toEqual([0.9])
      expect(resumed).toEqual(direct)
      expect(direct.state).toMatchObject({ tickets: { face: expect.any(Object), effect: expect.any(Object) } })
    })
  })

  describe(`${name} hold traces`, () => {
    function trace(signals: AffectSignal[]) {
      return parse(AffectTraceSchema, { version: 1, decider: name, checkpoint: decider.initial(1), initialContext: ctx, entries: signals.map(signal => ({ type: 'signal', signal })), truncated: false, endAt: 99 })
    }
    function live(signals: AffectSignal[]) {
      let state = decider.initial(1)
      return signals.map((signal) => {
        const result = decider.decide(signal, ctx, state)
        state = result.state
        return { at: signal.at, decision: result.decision }
      })
    }

    it('replays a recorded expression signal to the same episode and hold', () => {
      const signals = [expression('glare', 0, 'A')]
      const replayed = replayAffectTrace(trace(signals), withKind, { mode: 'exact' })
      expect(replayed).toEqual(live(signals))
      expect(replayed[0].decision.episodes).toHaveLength(1)
      expect(replayed[0].decision.holds).toHaveLength(1)
    })

    it('replays an emotion-only trace to the live decisions including holds', () => {
      const signals = [emotion('happy', 0.6, 0, 'A'), emotion('happy', 0.9, 1, 'A'), emotion('sad', 0.6, 5), { kind: 'clear', source: 'act', at: 6 } as const, emotion('neutral', 0.6, 7, 'B')]
      const replayed = replayAffectTrace(trace(signals), withKind, { mode: 'exact' })
      expect(replayed).toEqual(live(signals))
      expect(replayed.map(step => step.decision.holds.map(hold => hold.emotion))).toEqual([['happy'], ['happy'], ['sad'], [null], [null]])
    })
  })
}

holdsSuite('picker', createPickerDecider())
holdsSuite('planner', createPlannerDecider())

it('drops superseded planner picks when an explicit mapped prop starts a new reaction', () => {
  const planner = createPlannerDecider()
  const pendingCtx = { ...ctx, catalog: [entry('smile', 'face', [{ emotion: 'happy', minBand: 'slight', weight: 1 }]), entry('hat', 'prop', [{ emotion: 'sad', minBand: 'clear', weight: 1 }])] }
  const pending = planner.decide(emotion('happy', 0.6, 0, 'A'), pendingCtx, planner.initial(17))
  expect(planner.nextDeadline(pending.state)).not.toBeNull()
  const explicit = planner.decide(expression('hat', 0.5, 'A'), pendingCtx, pending.state)
  const restored = JSON.parse(JSON.stringify(explicit.state))
  const released = planner.decide({ kind: 'timing', event: { id: 'sentence', kind: 'sentence_start', turnId: 'A', at: 1 }, at: 1 }, pendingCtx, restored)
  expect(explicit.decision.slots.map(slot => slot.expressionId)).toEqual(['hat'])
  expect(released.decision.slots).toEqual([])
  expect(planner.nextDeadline(released.state)).toBeNull()
})
