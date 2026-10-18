import type { AffectSignal, DeciderContext } from './types'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { AffectTraceSchema, createDecider, defaultExpressionPerformanceSettings, replayAffectTrace, withAffectTrace } from '.'

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
