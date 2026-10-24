import type { CatalogEntry } from './catalog'
import type { PlannerState } from './planner'
import type { AffectSignal, DeciderContext, PerformanceEmotion, TimingEvent } from './types'

import { describe, expect, it } from 'vitest'

import { createDecider, createPlannerDecider, defaultExpressionPerformanceSettings, replayAffectTrace } from '.'

const planner = createPlannerDecider()
const settings = {
  ...defaultExpressionPerformanceSettings,
  intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0, habituationBase: 1 },
}
function entry(id: string, emotion: Exclude<PerformanceEmotion, 'neutral'>, kind: CatalogEntry['kind'] = 'face', minBand: 'slight' | 'strong' = 'slight'): CatalogEntry {
  return { id, kind, label: id, fileName: id, parameterIds: [], confirmed: true, exposedToLlm: true, group: null, mappings: [{ emotion, minBand, weight: 1 }] }
}
const ctx: DeciderContext = { settings, catalog: [entry('smile', 'happy'), entry('frown', 'sad'), entry('glare', 'angry'), entry('gasp', 'surprised'), entry('ponder', 'think')] }
// Equal effect thresholds turn the effect gate into a step at 0, so effects are always picked.
const effectCtx: DeciderContext = { settings: { ...settings, picker: { ...settings.picker, effectGateFrom: 0, effectGateTo: 0 } }, catalog: [entry('smile', 'happy'), entry('sparkle', 'happy', 'effect')] }

function emotion(nominal: number, at: number, turnId = 'A', name: PerformanceEmotion = 'happy'): AffectSignal {
  return { kind: 'emotion', source: 'act', emotion: name, nominal, turnId, at }
}
function timing(kind: TimingEvent['kind'], at: number, turnId = 'A'): AffectSignal {
  return { kind: 'timing', event: { id: `${turnId}-${kind}-${at}`, kind, turnId, at }, at }
}
function run(signals: AffectSignal[], context = ctx, state: PlannerState = planner.initial(1)) {
  const decisions = signals.map((signal) => {
    const result = planner.decide(signal, context, state)
    state = result.state
    return result.decision
  })
  return { decisions, state }
}
function changes(decisions: ReturnType<typeof run>['decisions']) {
  return decisions.map(decision => decision.slots.map(command => [command.slot, command.expressionId]))
}

/** Two chatty turns: four sentences each and a marker every 1.1 s, 20 markers in total. */
function chattyConversation(): AffectSignal[] {
  const names: PerformanceEmotion[] = ['happy', 'surprised', 'happy', 'think', 'sad', 'happy', 'angry', 'surprised', 'think', 'happy']
  const signals: AffectSignal[] = []
  for (const [turnIndex, turnId] of ['A', 'B'].entries()) {
    const start = turnIndex * 20
    for (let sentence = 0; sentence < 4; sentence++) {
      const at = start + sentence * 2.9
      signals.push({ kind: 'speech', event: 'clip-start', turnId, clipId: `${turnId}${sentence}`, at }, timing('sentence_start', at, turnId))
      signals.push({ kind: 'speech', event: 'clip-end', turnId, clipId: `${turnId}${sentence}`, at: at + 2.5 })
      if (sentence < 3)
        signals.push(timing('pause', at + 2.68, turnId))
    }
    signals.push({ kind: 'speech', event: 'turn-end', turnId, at: start + 11.4 }, timing('utterance_end', start + 11.4, turnId))
    for (let marker = 0; marker < 10; marker++)
      signals.push(emotion(marker % 3 === 0 ? 0.9 : 0.6, start + 0.2 + marker * 1.1, turnId, names[marker]))
  }
  return signals.sort((a, b) => a.at - b.at)
}

/** The replay CLI's summary metric: the most slot commands inside any half-open 5 s span. */
function slotChangesPer5sMax(decisions: { at: number, decision: { slots: unknown[] } }[]) {
  const times = decisions.flatMap(({ at, decision }) => decision.slots.map(() => at))
  let max = 0
  for (let end = 0, start = 0; end < times.length; end++) {
    while (times[end] - times[start] >= 5)
      start++
    max = Math.max(max, end - start + 1)
  }
  return max
}

describe('planner', () => {
  const combo: CatalogEntry = { ...entry('combo:look', 'happy', 'combo'), slots: ['face', 'effect'], members: [{ expressionId: 'smile', strength: 1 }, { expressionId: 'sparkle', strength: 1 }] }
  const comboCtx: DeciderContext = { ...effectCtx, catalog: [...effectCtx.catalog.map(entry => ({ ...entry, mappings: [] })), combo] }

  it('charges a spanning pick for both slots and rejects it atomically without enough budget', () => {
    const first = run([emotion(0.9, 0)], comboCtx)
    expect(changes(first.decisions)).toEqual([[['face', combo.id], ['effect', combo.id]]])
    expect(first.state.budget.changes).toEqual([0, 0])
    const full = { ...planner.initial(1), budget: { changes: [0, 0], lastAt: 0 } }
    const rejected = run([emotion(0.9, 1)], comboCtx, full)
    expect(changes(rejected.decisions)).toEqual([[]])
    expect(rejected.state.budget.changes).toEqual([0, 0])
  })

  it('drops a pending effect plan when an emitted combo spans it', () => {
    const pending = run([emotion(0.6, 0)], effectCtx).state
    expect(pending.scheduler.plans.map(plan => plan.payload.slot)).toEqual(['face', 'effect'])
    const explicit = run([{ kind: 'expression', source: 'tool', expressionId: combo.id, at: 0.2 }], { ...comboCtx, catalog: comboCtx.catalog.map(entry => ({ ...entry, mappings: [] })) }, pending)
    expect(explicit.state.scheduler.plans).toEqual([])
    expect(changes(run([timing('pause', 1)], comboCtx, explicit.state).decisions)).toEqual([[]])
    // An automatic combo emitted at sentence_start also drops a still-pending pause plan.
    const withPendingCombo = { ...pending, scheduler: { ...pending.scheduler, plans: pending.scheduler.plans.map(plan => plan.payload.slot === 'face' ? { ...plan, payload: { ...plan.payload, expressionId: combo.id } } : plan) } }
    const released = run([timing('sentence_start', 1), timing('pause', 2)], comboCtx, withPendingCombo)
    expect(changes(released.decisions)).toEqual([[['face', combo.id], ['effect', combo.id]], []])
    expect(released.state.scheduler.plans).toEqual([])
  })

  it('arbitrates every combo slot against other plans released at the same deadline', () => {
    const pending = run([emotion(0.6, 0)], effectCtx).state
    const withCombo = { ...pending, scheduler: { ...pending.scheduler, plans: pending.scheduler.plans.map(plan => plan.payload.slot === 'face' ? { ...plan, payload: { ...plan.payload, expressionId: combo.id } } : plan) } }
    const released = run([{ kind: 'deadline', at: settings.planner.scheduleExpiry }], comboCtx, withCombo)
    expect(changes(released.decisions)).toEqual([[['face', combo.id], ['effect', combo.id]]])
    expect(released.state.budget.changes).toEqual([settings.planner.scheduleExpiry, settings.planner.scheduleExpiry])
    const effectFirst = { ...withCombo, scheduler: { ...withCombo.scheduler, plans: [...withCombo.scheduler.plans].reverse().map((plan, seq) => ({ ...plan, seq })) } }
    expect(changes(run([{ kind: 'deadline', at: settings.planner.scheduleExpiry }], comboCtx, effectFirst).decisions)).toEqual([[['effect', 'sparkle']]])
  })

  it('drops a pending spanning plan when only its effect is explicitly replaced or cleared', () => {
    const pending = run([emotion(0.6, 0)], comboCtx).state
    expect(pending.scheduler.plans).toHaveLength(1)
    for (const signal of [{ kind: 'expression', source: 'tool', expressionId: 'sparkle', at: 0.2 }, { kind: 'clear', source: 'tool', slot: 'effect', at: 0.2 }] as const) {
      const changed = run([signal, timing('sentence_start', 1)], comboCtx, pending)
      expect(changed.decisions[1].slots).toEqual([])
      expect(changed.state.scheduler.plans).toEqual([])
    }
  })

  it('computes the slots of a pending combo from the current catalog at emission', () => {
    const pending = run([emotion(0.6, 0)], comboCtx).state
    const edited = { ...comboCtx, catalog: comboCtx.catalog.map(entry => entry.id === combo.id ? { ...combo, members: [{ expressionId: 'smile', strength: 1 }], slots: ['face' as const] } : entry) }
    const released = run([timing('sentence_start', 1)], edited, pending)
    expect(changes(released.decisions)).toEqual([[['face', combo.id]]])
    expect(released.state.budget.changes).toEqual([1])
  })

  it('reacts at once but shows a clear face at the next sentence_start and its effect at the next pause', () => {
    const { decisions } = run([emotion(0.6, 0), timing('sentence_start', 1), timing('pause', 2)], effectCtx)

    expect(decisions[0].episodes.map(episode => episode.band)).toEqual(['clear'])
    expect(decisions[0].slots).toEqual([])
    expect(decisions[1].slots).toEqual([{ slot: 'face', expressionId: 'smile', holdSeconds: settings.naturalBands.clear.faceHold, until: 'speech', turnId: 'A' }])
    expect(changes(decisions).slice(2)).toEqual([[['effect', 'sparkle']]])
  })

  it('shows strong faces and effects immediately', () => {
    const { decisions, state } = run([emotion(0.9, 0)], effectCtx)

    expect(changes(decisions)).toEqual([[['face', 'smile'], ['effect', 'sparkle']]])
    expect(decisions[0].slots.every(command => command.holdSeconds === settings.naturalBands.strong.faceHold)).toBe(true)
    expect(planner.nextDeadline(state)).toBeNull()
  })

  it('shows a slight or clear devtools pulse without a turn immediately', () => {
    expect(changes(run([{ kind: 'emotion', source: 'devtools', emotion: 'happy', nominal: 0.25, at: 0 }]).decisions)).toEqual([[['face', 'smile']]])
  })

  it('caps automatic slot changes at 3 per 5 s and 1 per 0.8 s, dropping instead of queueing over-budget picks', () => {
    const names: PerformanceEmotion[] = ['happy', 'sad', 'angry', 'surprised', 'think', 'happy', 'sad', 'angry']
    const times = [0, 1, 2, 3, 4, 6.5, 7, 8]
    const signals = times.map((at, i) => emotion(0.9, at, 'A', names[i]))
    signals.splice(4, 0, { kind: 'expression', source: 'tool', expressionId: 'ponder', turnId: 'A', at: 3.5 })
    const { decisions, state } = run(signals)
    const emitted = decisions.flatMap((decision, i) => decision.slots.map(command => [signals[i].at, command.expressionId]))

    // 3 and 4 exceed 3 changes in 5 s, 7 is within 0.8 s of 6.5; the explicit expression at 3.5 bypasses the budget.
    expect(emitted).toEqual([[0, 'smile'], [1, 'frown'], [2, 'glare'], [3.5, 'ponder'], [6.5, 'smile'], [8, 'glare']])
    expect(decisions.every(decision => decision.episodes.length === 1 || decision.slots[0]?.expressionId === 'ponder')).toBe(true)
    expect(planner.nextDeadline(state)).toBeNull()
    expect(run([timing('sentence_start', 9), timing('pause', 10)], ctx, state).decisions.flatMap(decision => decision.slots)).toEqual([])
  })

  it('applies minGap between performance moments while windowMax counts every slot change', () => {
    const momentCtx: DeciderContext = {
      settings: effectCtx.settings,
      catalog: [entry('smile', 'happy'), entry('frown', 'sad'), entry('glare', 'angry'), entry('sparkle', 'happy', 'effect'), entry('tears', 'sad', 'effect'), entry('steam', 'angry', 'effect')],
    }
    const { decisions, state } = run([emotion(0.9, 0), emotion(0.9, 0.5, 'A', 'sad'), emotion(0.9, 1, 'A', 'angry')], momentCtx)

    // One decision is one moment: face and effect pass together at 0. The moment at 0.5 is inside
    // minGap and is dropped. At 1 the face is the third slot change in the window, and the effect
    // would be the fourth, so windowMax drops it.
    expect(changes(decisions)).toEqual([[['face', 'smile'], ['effect', 'sparkle']], [], [['face', 'glare']]])
    expect(state.budget.changes).toEqual([0, 0, 1])
  })

  it('emits an expired schedule once from its deadline signal with no further input', () => {
    const scheduled = run([emotion(0.6, 0)]).state

    expect(planner.nextDeadline(scheduled)).toBe(settings.planner.scheduleExpiry)
    const { decisions, state } = run([{ kind: 'deadline', at: settings.planner.scheduleExpiry }, { kind: 'deadline', at: 7 }], ctx, scheduled)
    expect(changes(decisions)).toEqual([[['face', 'smile']], []])
    expect(planner.nextDeadline(state)).toBeNull()
  })

  it('never lets another turn take a schedule', () => {
    const { decisions } = run([emotion(0.6, 0, 'A'), timing('sentence_start', 1, 'B'), timing('sentence_start', 2, 'A')])

    expect(changes(decisions)).toEqual([[], [], [['face', 'smile']]])
  })

  it('cancels the turn schedule on utterance_end', () => {
    const { decisions, state } = run([emotion(0.6, 0), timing('utterance_end', 1), timing('sentence_start', 2)])

    expect(changes(decisions)).toEqual([[], [], []])
    expect(planner.nextDeadline(state)).toBeNull()
  })

  it('applies only the first plan per slot when one event releases several', () => {
    const { decisions } = run([emotion(0.6, 0, 'A', 'sad'), emotion(0.6, 1, 'A', 'happy'), emotion(0.25, 1.5, 'A', 'angry'), timing('sentence_start', 2)])

    // Equal clear bands and intensities fall back to insertion order; the slight plan ranks below both.
    expect(changes(decisions)[3]).toEqual([['face', 'frown']])
  })

  it('handles a clear like the picker: immediate null commands that ignore the budget and drop pending plans', () => {
    const exhausted = run(['happy', 'sad', 'angry'].map((name, i) => emotion(0.9, i, 'A', name as PerformanceEmotion))).state
    const cleared = run([{ kind: 'clear', source: 'tool', turnId: 'A', at: 2.1 }], ctx, exhausted)

    expect(cleared.decisions[0]).toEqual({ episodes: [], slots: (['face', 'effect', 'prop'] as const).map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'hold', turnId: 'A' })), holds: [{ emotion: null, strength: 0, holdSeconds: 0, until: 'hold', turnId: 'A' }] })
    expect(cleared.state.occupants).toEqual({ face: null, effect: null })
    expect(cleared.state.reaction).toEqual(exhausted.reaction)
    const pending = run([emotion(0.6, 0), { kind: 'clear', source: 'tool', slot: 'face', at: 0.5 }, timing('sentence_start', 1)])
    expect(changes(pending.decisions)).toEqual([[], [['face', null]], []])
  })

  it('never activates a pending automatic plan once automatic expressions are off, on timing or deadline', () => {
    const pending = run([emotion(0.6, 0), emotion(0.6, 0.5, 'A', 'sad')], effectCtx).state
    const disabled: DeciderContext = { ...effectCtx, settings: { ...effectCtx.settings, autoExpressions: false } }

    expect(planner.decide(timing('sentence_start', 1), disabled, pending).decision.slots).toEqual([])
    expect(planner.decide(timing('pause', 1), disabled, pending).decision.slots).toEqual([])
    expect(planner.decide({ kind: 'deadline', at: settings.planner.scheduleExpiry }, disabled, pending).decision.slots).toEqual([])
    // Plans dropped while off stay dropped, so re-enabling cannot resurrect them.
    const { decisions, state } = run([timing('emphasis', 1), timing('sentence_start', 2), { kind: 'deadline', at: 7 }], effectCtx, planner.decide(timing('emphasis', 1), disabled, pending).state)
    expect(decisions.flatMap(decision => decision.slots)).toEqual([])
    expect(planner.nextDeadline(state)).toBeNull()
  })

  it('keeps explicit expressions and clears working while automatic expressions are off', () => {
    const disabled: DeciderContext = { ...ctx, settings: { ...ctx.settings, autoExpressions: false } }
    const { decisions } = run([emotion(0.6, 0), { kind: 'expression', source: 'tool', expressionId: 'ponder', turnId: 'A', at: 1 }, { kind: 'clear', source: 'tool', slot: 'face', turnId: 'A', at: 2 }], disabled)

    expect(decisions[0].episodes.map(episode => episode.band)).toEqual(['clear'])
    expect(changes(decisions)).toEqual([[], [['face', 'ponder']], [['face', null]]])
  })

  it('clears face and effect immediately on neutral and drops every pending plan', () => {
    const { decisions, state } = run([emotion(0.6, 0), emotion(0.6, 1, 'A', 'neutral'), timing('sentence_start', 2)])

    expect(changes(decisions)).toEqual([[], [['face', null], ['effect', null]], []])
    expect(planner.nextDeadline(state)).toBeNull()
  })

  it('replays identical seeds and JSON checkpoints identically', () => {
    const signals = chattyConversation()
    let state = planner.initial(42)
    let checkpoint = planner.initial(42)
    for (const [i, signal] of signals.entries()) {
      const result = planner.decide(signal, ctx, state)
      const restored = planner.decide(signal, ctx, checkpoint)
      expect(restored).toEqual(result)
      state = result.state
      checkpoint = i === 20 ? JSON.parse(JSON.stringify(restored.state)) : restored.state
    }
  })

  it('returns the same episodes as the picker for every signal, so Natural motion is never delayed', () => {
    const picker = createDecider('picker')
    let pickerState = picker.initial(1)
    let plannerState = planner.initial(1)
    for (const signal of chattyConversation()) {
      const fromPicker = picker.decide(signal, ctx, pickerState)
      const fromPlanner = planner.decide(signal, ctx, plannerState)
      expect(fromPlanner.decision.episodes).toEqual(fromPicker.decision.episodes)
      pickerState = fromPicker.state
      plannerState = fromPlanner.state
    }
  })

  it('keeps a chatty picker-recorded conversation within budget in compare mode, unlike the picker', () => {
    const trace = { version: 1 as const, decider: 'picker' as const, checkpoint: createDecider('picker').initial(1), initialContext: ctx, entries: chattyConversation().map(signal => ({ type: 'signal' as const, signal })), truncated: false, endAt: 40 }
    const fromPicker = replayAffectTrace(trace, { ...createDecider('picker'), kind: 'picker' }, { mode: 'compare', seed: 1 })
    const fromPlanner = replayAffectTrace(trace, { ...createDecider('planner'), kind: 'planner' }, { mode: 'compare', seed: 1 })

    expect(slotChangesPer5sMax(fromPicker)).toBeGreaterThan(3)
    expect(slotChangesPer5sMax(fromPlanner)).toBeLessThanOrEqual(3)
    expect(fromPlanner.flatMap(({ decision }) => decision.slots).length).toBeGreaterThan(0)
  })

  it('is selected by the decision seam, which rejects a picker state', () => {
    const selected = createDecider('planner')
    const state = selected.decide(emotion(0.6, 0), ctx, selected.initial(1)).state

    expect(selected.nextDeadline(state)).toBe(settings.planner.scheduleExpiry)
    expect(() => selected.decide(emotion(0.6, 0), ctx, createDecider('picker').initial(1))).toThrow('picker state')
  })
})
