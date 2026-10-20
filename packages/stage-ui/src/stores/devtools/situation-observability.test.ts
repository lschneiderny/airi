import type { GateDecision, GateHoldReason, GateMemory, GateTrace, RenderedSituation, SituationState } from '@proj-airi/stage-shared/situation'

import { initialGateMemory, initialSituationState, reduceSituation, WAKE_TOPIC_KEY } from '@proj-airi/stage-shared/situation'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useContextObservabilityStore } from './context-observability'
import { SITUATION_GATE_HISTORY_MAX, SITUATION_RENDER_HISTORY_MAX, situationBlockUsage, useSituationObservabilityStore } from './situation-observability'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

function stateWithWake(): SituationState {
  return reduceSituation(initialSituationState, { kind: 'wake', cause: 'unlock', atMs: T0 }, T0)
}

function rendered(text: string, shownEventIds: string[] = []): RenderedSituation {
  return { text, shownEventIds }
}

function trace(nowMs: number, forceTiming = false): GateTrace {
  return {
    nowMs,
    chattiness: 0.5,
    threshold: 0.4,
    candidate: null,
    gapMs: 600_000,
    hourlyCap: 4,
    firesLastHour: 0,
    backoffLevel: 0,
    ignoreStreak: 0,
    pendingTopicKey: null,
    nextEligibleAtMs: nowMs,
    forceTiming,
  }
}

function hold(reason: GateHoldReason, nowMs: number, forceTiming = false): GateDecision {
  return { fire: false, reason, trace: trace(nowMs, forceTiming) }
}

function fire(topicKey: string, nowMs: number): GateDecision {
  return { fire: true, reason: 'ready', topicKey, topicText: topicKey, trace: trace(nowMs) }
}

function memoryWith(patch: Partial<GateMemory>): GateMemory {
  return { ...initialGateMemory, ...patch }
}

describe('situation observability store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps only the newest renders once the history cap is reached', async () => {
    const store = useSituationObservabilityStore()

    const total = SITUATION_RENDER_HISTORY_MAX + 50
    for (let index = 0; index < total; index++)
      store.recordRender(T0 + index * 1_000, rendered(`[Situation ${index}]`))

    expect(store.renders).toHaveLength(SITUATION_RENDER_HISTORY_MAX)
    expect(store.renders[0].nowMs).toBe(T0 + (total - 1) * 1_000)
    expect(store.renders.at(-1)?.nowMs).toBe(T0 + (total - SITUATION_RENDER_HISTORY_MAX) * 1_000)
    expect((await store.inspect()).renders).toHaveLength(SITUATION_RENDER_HISTORY_MAX)
  })

  it('copies the shown ids of a render, so later changes to the source array do not rewrite history', () => {
    const store = useSituationObservabilityStore()
    const shownEventIds = ['wake@1']

    store.recordRender(T0, rendered('[Situation 09:00]', shownEventIds))
    shownEventIds.push('later')

    expect(store.renders[0]).toMatchObject({ nowMs: T0, text: '[Situation 09:00]', shownEventIds: ['wake@1'] })
  })

  it('returns the published live state and the renders from inspect', async () => {
    const store = useSituationObservabilityStore()
    expect(store.liveState).toEqual({ leading: false, state: initialSituationState })

    const state = stateWithWake()
    store.publishLiveState(true, state)
    store.recordRender(T0, rendered('[Situation 09:00]'))

    expect(store.liveState).toEqual({ leading: true, state })
    const inspection = await store.inspect()
    expect(inspection.leading).toBe(true)
    expect(inspection.state.events.map(event => event.topicKey)).toEqual([WAKE_TOPIC_KEY])
    expect(inspection.renders.map(render => render.text)).toEqual(['[Situation 09:00]'])
  })

  it('reports a window that does not lead as not leading', async () => {
    const store = useSituationObservabilityStore()
    store.publishLiveState(false, initialSituationState)

    const inspection = await store.inspect()

    expect(inspection.leading).toBe(false)
    expect(inspection.state).toBe(initialSituationState)
    expect(inspection.renders).toEqual([])
    expect(inspection.gateHistory).toEqual([])
    expect(inspection.gateMemory).toBe(initialGateMemory)
    expect((await store.preview(T0)).leading).toBe(false)
  })

  it('previews the next block without marking its events as shown', async () => {
    const store = useSituationObservabilityStore()
    const state = stateWithWake()
    const wakeId = state.events[0].id
    store.publishLiveState(true, state)

    const first = await store.preview(T0 + 1_000)
    const second = await store.preview(T0 + 2_000)

    expect(first.text).toContain('- New: unlocked the computer')
    expect(first.shownEventIds).toEqual([wakeId])
    expect(second.text).toContain('- New: unlocked the computer')
    expect(second.shownEventIds).toEqual([wakeId])
    expect(store.liveState.state).toBe(state)
    expect(store.liveState.state.events[0].shownAtMs).toBeNull()
    expect(store.renders).toEqual([])
  })

  it('collapses consecutive identical gate reasons into one entry with a count', async () => {
    const store = useSituationObservabilityStore()

    store.recordGateDecision(hold('gap', T0), initialGateMemory)
    store.recordGateDecision(hold('gap', T0 + 2_000), initialGateMemory)
    store.recordGateDecision(hold('gap', T0 + 4_000), initialGateMemory)
    store.recordGateDecision(hold('no-topic', T0 + 6_000), initialGateMemory)
    store.recordGateDecision(hold('gap', T0 + 8_000), initialGateMemory)

    expect(store.gateHistory.map(entry => [entry.reason, entry.count, entry.firstAtMs, entry.lastAtMs])).toEqual([
      ['gap', 1, T0 + 8_000, T0 + 8_000],
      ['no-topic', 1, T0 + 6_000, T0 + 6_000],
      ['gap', 3, T0, T0 + 4_000],
    ])
    expect((await store.inspect()).gateHistory).toEqual(store.gateHistory)
  })

  it('keeps fires and forced evaluations apart from holds with the same reason', () => {
    const store = useSituationObservabilityStore()

    store.recordGateDecision(fire('wake', T0), initialGateMemory)
    store.recordGateDecision(fire('long-session:1', T0 + 2_000), initialGateMemory)
    store.recordGateDecision(hold('dont-disturb', T0 + 4_000), initialGateMemory)
    store.recordGateDecision(hold('dont-disturb', T0 + 6_000, true), initialGateMemory)

    expect(store.gateHistory.map(entry => [entry.fire, entry.reason, entry.topicKey, entry.forced, entry.count])).toEqual([
      [false, 'dont-disturb', null, true, 1],
      [false, 'dont-disturb', null, false, 1],
      [true, 'ready', 'long-session:1', false, 1],
      [true, 'ready', 'wake', false, 1],
    ])
  })

  it('keeps only the newest gate entries once the history cap is reached', () => {
    const store = useSituationObservabilityStore()

    const total = SITUATION_GATE_HISTORY_MAX + 50
    // Alternating reasons never collapse, so every decision is an entry.
    for (let index = 0; index < total; index++)
      store.recordGateDecision(hold(index % 2 === 0 ? 'gap' : 'no-topic', T0 + index * 2_000), initialGateMemory)

    expect(store.gateHistory).toHaveLength(SITUATION_GATE_HISTORY_MAX)
    expect(store.gateHistory[0].lastAtMs).toBe(T0 + (total - 1) * 2_000)
    expect(store.gateHistory.at(-1)?.firstAtMs).toBe(T0 + (total - SITUATION_GATE_HISTORY_MAX) * 2_000)
  })

  it('keeps a long run of one reason as a single entry', () => {
    const store = useSituationObservabilityStore()

    for (let index = 0; index < 5_000; index++)
      store.recordGateDecision(hold('stage-hidden', T0 + index * 2_000), initialGateMemory)

    expect(store.gateHistory).toHaveLength(1)
    expect(store.gateHistory[0]).toMatchObject({ reason: 'stage-hidden', count: 5_000, firstAtMs: T0, lastAtMs: T0 + 4_999 * 2_000 })
  })

  it('reports the gate memory published after the decision, not the memory the decision left', async () => {
    const store = useSituationObservabilityStore()
    const fired = memoryWith({ lastFireAtMs: T0, fires: [T0], pending: { topicKey: 'wake', firedAtMs: T0, spokenAtMs: null } })
    store.recordGateDecision(fire('wake', T0), fired)

    // The turn was spoken between two gate ticks.
    const spoken = memoryWith({ ...fired, pending: { topicKey: 'wake', firedAtMs: T0, spokenAtMs: T0 + 1_500 } })
    store.publishGateMemory(spoken)

    const inspection = await store.inspect()
    expect(inspection.gate?.memory).toBe(fired)
    expect(inspection.gateMemory).toBe(spoken)
  })

  it('counts spoken and declined unprompted turns per session and ignores other outcomes', async () => {
    const store = useSituationObservabilityStore()

    store.recordUnpromptedOutcome('session-a', 'spoken')
    store.recordUnpromptedOutcome('session-a', 'declined')
    store.recordUnpromptedOutcome('session-a', 'spoken')
    store.recordUnpromptedOutcome('session-b', 'declined')
    store.recordUnpromptedOutcome('session-b', 'cancelled')
    store.recordUnpromptedOutcome('session-b', 'failed')

    expect((await store.inspect()).spend.sessions).toEqual([
      { sessionId: 'session-a', spoken: 2, declined: 1 },
      { sessionId: 'session-b', spoken: 0, declined: 1 },
    ])
  })

  it('measures the last unprompted provider request, which a later user request does not replace', async () => {
    const store = useSituationObservabilityStore()
    const context = useContextObservabilityStore()
    expect((await store.inspect()).spend.lastUnpromptedRequest).toBeNull()

    context.capturePromptProjection({ sessionId: 'session-a', message: 'trigger', contexts: {} })
    context.captureProviderPromptProjection('session-a', [
      { role: 'system', content: 'You are AIRI.' },
      { role: 'user', content: [{ type: 'text', text: '(No one spoke to you.)' }, { type: 'text', text: '[Situation]' }] },
    ], { turnId: 'turn-1', origin: 'unprompted' })
    expect(context.lastPromptProjection).toMatchObject({ turnId: 'turn-1', origin: 'unprompted' })

    context.capturePromptProjection({ sessionId: 'session-a', message: 'hello', contexts: {} })
    context.captureProviderPromptProjection('session-a', [{ role: 'user', content: 'hello there, a much longer user request' }], { turnId: 'turn-2', origin: 'user' })

    expect((await store.inspect()).spend.lastUnpromptedRequest).toMatchObject({
      sessionId: 'session-a',
      turnId: 'turn-1',
      messageCount: 2,
      chars: 'You are AIRI.'.length + '(No one spoke to you.)'.length + '[Situation]'.length,
    })
  })

  it('answers an evaluation request without a gate as skipped, and with one through the gate evaluator only', async () => {
    const store = useSituationObservabilityStore()
    expect(await store.evaluateGate()).toEqual({ status: 'skipped', reason: 'gate-not-running' })

    const calls: unknown[][] = []
    const stop = store.serveGateEvaluation((...args: unknown[]) => {
      calls.push(args)
      return { status: 'evaluated', decision: hold('dont-disturb', T0, true), memory: initialGateMemory }
    })
    expect(await store.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'dont-disturb' } })
    // The evaluator takes no options, so no caller can ask it to skip a hard suppressor.
    expect(calls).toEqual([[]])

    stop()
    expect(await store.evaluateGate()).toEqual({ status: 'skipped', reason: 'gate-not-running' })
  })

  it('counts block lines and characters the way the renderer budgets them', () => {
    expect(situationBlockUsage('')).toEqual({ lines: 0, chars: 0 })
    expect(situationBlockUsage('[Situation 09:00]')).toEqual({ lines: 1, chars: 17 })
    expect(situationBlockUsage('[Situation 09:00]\n- New: x')).toEqual({ lines: 2, chars: 26 })
  })
})
