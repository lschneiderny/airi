import type { AffectSignal, DeciderContext } from './types'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { AffectTraceSchema, applyMappingWeights, CatalogEntrySchema, createDecider, defaultExpressionPerformanceSettings, parseAffectTrace, parseCuratedCatalogDocument, parseExpressionPerformanceSettings, PerformanceProfileSchema, replayAffectTrace, resolveEffectiveSettings, withAffectTrace } from '.'

const picker = { ...createDecider('picker'), kind: 'picker' as const }
const context: DeciderContext = {
  settings: { ...defaultExpressionPerformanceSettings, intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0, habituationBase: 1 } },
  catalog: ['a', 'b'].map(id => ({ id, label: id, fileName: id, parameterIds: [], kind: 'face', confirmed: true, exposedToLlm: true, group: null, mappings: [{ emotion: 'happy', minBand: 'slight', weight: 1 }] })),
}
function emotion(at: number): AffectSignal {
  return { kind: 'emotion', emotion: 'happy', source: 'act', nominal: 0.9, at }
}
function fixture() {
  return parse(AffectTraceSchema, {
    version: 1,
    decider: 'picker',
    checkpoint: picker.initial(1),
    initialContext: context,
    entries: [emotion(0), emotion(3)].map(signal => ({ type: 'signal', signal })),
    truncated: false,
    endAt: 8,
  })
}

describe('affect trace', () => {
  it('replays deterministically from a checkpoint after 3000 earlier signals', () => {
    let state = picker.initial(17)
    for (let i = 0; i < 3000; i++)
      state = picker.decide(emotion(i * 3), context, state).state
    const trace = { ...fixture(), checkpoint: JSON.parse(JSON.stringify(state)), entries: [emotion(9000), emotion(9003)].map(signal => ({ type: 'signal' as const, signal })), endAt: 9004 }
    const expected = trace.entries.map(({ signal }) => {
      const result = picker.decide(signal, context, state)
      state = result.state
      return { at: signal.at, decision: result.decision }
    })
    expect(replayAffectTrace(trace, picker, { mode: 'exact' })).toEqual(expected)
    expect(replayAffectTrace(trace, picker, { mode: 'exact' })).toEqual(expected)
  })

  it('applies changed mapping weights in order just as live', () => {
    const changed = { ...context, catalog: context.catalog.map(entry => ({ ...entry, mappings: entry.mappings.map(mapping => ({ ...mapping, weight: entry.id === 'a' ? 1e100 : 1e-100 })) })) }
    const trace = fixture()
    trace.entries.splice(1, 0, { type: 'context', context: changed })
    let state = picker.initial(1)
    const first = picker.decide(emotion(0), context, state)
    state = first.state
    const second = picker.decide(emotion(3), changed, state)
    expect(replayAffectTrace(trace, picker, { mode: 'exact' })).toEqual([{ at: 0, decision: first.decision }, { at: 3, decision: second.decision }])
    expect(second.decision.slots[0].expressionId).toBe('a')
    expect(replayAffectTrace(fixture(), picker, { mode: 'exact' })[1].decision).not.toEqual(second.decision)
  })

  it('forwards every signal before deciding and preserves lifecycle methods', () => {
    const order: string[] = []
    const wrapped = withAffectTrace({ ...picker, decide(signal, ctx, state) {
      order.push(`decide:${signal.at}`)
      return picker.decide(signal, ctx, state)
    } }, signal => order.push(`sink:${signal.at}`))
    for (const at of [0, 3])
      wrapped.decide(emotion(at), context, wrapped.initial(1))
    expect(order).toEqual(['sink:0', 'decide:0', 'sink:3', 'decide:3'])
    expect(wrapped.nextDeadline(wrapped.initial(1))).toBeNull()
  })

  it('validates a clear signal and replays it exactly to the live slot commands', () => {
    const signals: AffectSignal[] = [emotion(0), { kind: 'clear', source: 'tool', slot: 'face', at: 1 }, emotion(4), { kind: 'clear', source: 'devtools', turnId: 'turn', at: 5 }]
    const trace = parse(AffectTraceSchema, { ...fixture(), entries: signals.map(signal => ({ type: 'signal', signal })) })
    let state = picker.initial(1)
    const live = signals.map((signal) => {
      const result = picker.decide(signal, context, state)
      state = result.state
      return { at: signal.at, decision: result.decision }
    })

    expect(replayAffectTrace(trace, picker, { mode: 'exact' })).toEqual(live)
    expect(live[1].decision.slots).toEqual([{ slot: 'face', expressionId: null, holdSeconds: 0, until: 'hold' }])
    expect(live[3].decision.slots.map(command => [command.slot, command.expressionId, command.turnId])).toEqual([['face', null, 'turn'], ['effect', null, 'turn'], ['prop', null, 'turn']])
    expect(safeParse(AffectTraceSchema, { ...fixture(), entries: [{ type: 'signal', signal: { kind: 'clear', source: 'tool', slot: 'outfit', at: 1 } }] }).success).toBe(false)
  })

  it('parses and exactly replays contexts expanded by a 2x mood gain profile', () => {
    const base = parseExpressionPerformanceSettings({ moodDynamics: { strongGain: 0.8 } })
    expect(base.success).toBe(true)
    const doubled = { ...context, settings: resolveEffectiveSettings(base.value, { moodGainScale: 2 }).settings }
    const changed = { ...context, settings: resolveEffectiveSettings(base.value, { moodGainScale: 1.5 }).settings }
    expect(doubled.settings.moodDynamics.strongGain).toBe(1.6)
    const signals = [emotion(0), emotion(3)]
    const exported = JSON.stringify({ ...fixture(), initialContext: doubled, entries: [{ type: 'signal', signal: signals[0] }, { type: 'context', context: changed }, { type: 'signal', signal: signals[1] }] })
    const trace = parseAffectTrace(JSON.parse(exported))
    let state = picker.initial(1)
    const live = signals.map((signal, index) => {
      const result = picker.decide(signal, index === 0 ? doubled : changed, state)
      state = result.state
      return { at: signal.at, decision: result.decision }
    })

    expect(trace.initialContext.settings.moodDynamics.strongGain).toBe(1.6)
    expect(replayAffectTrace(trace, picker, { mode: 'exact' })).toEqual(live)
  })

  it('keeps persisted bounds and rejects contexts outside the profile-scaled bounds', () => {
    expect(parseExpressionPerformanceSettings({ moodDynamics: { strongGain: 1.6 } }).success).toBe(false)
    const beyond = { ...context.settings, moodDynamics: { ...context.settings.moodDynamics, strongGain: 2.01 } }
    expect(safeParse(AffectTraceSchema, { ...fixture(), initialContext: { ...context, settings: beyond } }).success).toBe(false)
    const reversed = { ...context.settings, moodDynamics: { ...context.settings.moodDynamics, valenceTau: -1 } }
    expect(safeParse(AffectTraceSchema, { ...fixture(), initialContext: { ...context, settings: reversed } }).success).toBe(false)
    const negative = context.catalog.map(entry => ({ ...entry, mappings: entry.mappings.map(mapping => ({ ...mapping, weight: -1 })) }))
    expect(safeParse(AffectTraceSchema, { ...fixture(), initialContext: { ...context, catalog: negative } }).success).toBe(false)
  })

  it('still accepts persisted documents with long taus and heavy mapping weights unchanged', () => {
    const settings = parseExpressionPerformanceSettings({ autoExpressions: false, moodDynamics: { valenceTau: 7200 } })
    expect(settings.success).toBe(true)
    expect(settings.value.autoExpressions).toBe(false)
    expect(settings.value.moodDynamics.valenceTau).toBe(7200)
    const curated = parseCuratedCatalogDocument({ version: 1, overrides: [{ id: 'a', mappings: [{ emotion: 'happy', weight: 6 }] }] })
    expect(curated.success && curated.value.overrides[0].mappings?.[0].weight).toBe(6)
  })

  describe('every persisted value under every profile scale', () => {
    function expectExactRoundTrip(live: DeciderContext) {
      const signals = [emotion(0), emotion(3)]
      const trace = parseAffectTrace(JSON.parse(JSON.stringify({ ...fixture(), initialContext: live, entries: signals.map(signal => ({ type: 'signal', signal })) })))
      let state = picker.initial(1)
      const decisions = signals.map((signal) => {
        const result = picker.decide(signal, live, state)
        state = result.state
        return { at: signal.at, decision: result.decision }
      })
      expect(replayAffectTrace(trace, picker, { mode: 'exact' })).toEqual(decisions)
    }

    it.each(['slightGain', 'clearGain', 'strongGain'] as const)('records %s at its persisted bounds under every gain scale', (field) => {
      const accepted: number[] = []
      for (const value of [0, 0.4, 1, 1.0001]) {
        const base = parseExpressionPerformanceSettings({ moodDynamics: { [field]: value } })
        if (!base.success)
          continue
        accepted.push(value)
        for (const moodGainScale of [0, 1, 2])
          expectExactRoundTrip({ ...context, settings: resolveEffectiveSettings(base.value, { moodGainScale }).settings })
      }
      expect(accepted).toEqual([0, 0.4, 1])
    })

    it.each(['valenceTau', 'arousalTau', 'tensionTau'] as const)('records %s at its persisted bounds under every decay scale', (field) => {
      const accepted: number[] = []
      const values = [0, 45, 3600, 7200, 1e308, Number.MAX_VALUE]
      for (const value of values) {
        const base = parseExpressionPerformanceSettings({ moodDynamics: { [field]: value } })
        if (!base.success)
          continue
        accepted.push(value)
        for (const moodDecayScale of [0.5, 1, 2]) {
          const settings = resolveEffectiveSettings(base.value, { moodDecayScale }).settings
          expect(settings.moodDynamics[field]).toBe(Math.min(value * moodDecayScale, Number.MAX_VALUE))
          expectExactRoundTrip({ ...context, settings })
        }
      }
      expect(accepted).toEqual(values)
    })

    it('records every persisted mapping weight under every profile multiplier', () => {
      const accepted: number[] = []
      const weights = [Number.MIN_VALUE, 0.1, 1, 5, 6, 1e308, Number.MAX_VALUE]
      for (const weight of weights) {
        const entry = safeParse(CatalogEntrySchema, { ...context.catalog[0], mappings: [{ emotion: 'happy', minBand: 'slight', weight }] })
        if (!entry.success)
          continue
        accepted.push(weight)
        for (const multiplier of [0, Number.MIN_VALUE, 0.5, 1, 5]) {
          const profile = { mappingWeights: { rig: { a: multiplier } } }
          expect(safeParse(PerformanceProfileSchema, profile).success).toBe(true)
          const catalog = applyMappingWeights([entry.output], 'rig', profile)
          expect(catalog[0].mappings.map(mapping => mapping.weight)).toEqual(multiplier === 0 ? [] : [Math.min(weight * multiplier, Number.MAX_VALUE)])
          expectExactRoundTrip({ ...context, catalog })
        }
      }
      expect(accepted).toEqual(weights)
    })
  })

  it('refuses truncated traces and mismatched exact policies', () => {
    expect(() => replayAffectTrace({ ...fixture(), truncated: true }, picker, { mode: 'exact' })).toThrow('truncated')
    expect(() => replayAffectTrace({ ...fixture(), truncated: true }, picker, { mode: 'compare', seed: 1 })).toThrow('truncated')
    expect(() => replayAffectTrace(fixture(), { ...picker, kind: 'planner' }, { mode: 'exact' })).toThrow('recorded decider kind')
  })

  it.each([
    { version: undefined },
    { checkpoint: undefined },
    { checkpoint: { invalid: Infinity } },
    { entries: [{ type: 'signal', signal: { kind: 'emotion', at: 1 } }] },
    { entries: [{ type: 'signal', signal: emotion(3) }, { type: 'signal', signal: emotion(1) }] },
    { endAt: 1 },
  ])('rejects malformed input %j', (fields) => {
    expect(safeParse(AffectTraceSchema, { ...fixture(), ...fields }).success).toBe(false)
  })

  it('drops recorded deadlines and synthesizes the comparison policy deadlines through endAt', () => {
    const received: AffectSignal[] = []
    const decider = {
      kind: 'planner' as const,
      initial: (seed: number) => seed,
      nextDeadline: (state: number) => state + 2,
      decide(signal: AffectSignal) {
        received.push(signal)
        return { state: signal.at, decision: { episodes: [], slots: [] } }
      },
    }
    const trace = fixture()
    trace.entries = [emotion(1), { kind: 'deadline' as const, at: 2 }, emotion(6)].map(signal => ({ type: 'signal', signal }))
    trace.endAt = 10
    replayAffectTrace(trace, decider, { mode: 'compare', seed: 0 })
    expect(received).toEqual([emotion(1), { kind: 'deadline', at: 3 }, { kind: 'deadline', at: 5 }, emotion(6), { kind: 'deadline', at: 8 }, { kind: 'deadline', at: 10 }])
  })

  it('feeds exact deadlines verbatim and never initializes the policy', () => {
    const received: AffectSignal[] = []
    const trace = fixture()
    trace.entries.push({ type: 'signal', signal: { kind: 'deadline', at: 7 } })
    replayAffectTrace(trace, { ...picker, initial() {
      throw new Error('must use checkpoint')
    }, decide(signal, ctx, state) {
      received.push(signal)
      return picker.decide(signal, ctx, state)
    } }, { mode: 'exact' })
    expect(received).toEqual(trace.entries.filter(entry => entry.type === 'signal').map(entry => entry.signal))
  })
})
