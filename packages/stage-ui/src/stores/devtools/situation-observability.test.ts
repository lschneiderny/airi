import type {
  GateDecision,
  GateHoldReason,
  GateMemory,
  GateTrace,
  Reason,
  ReasonCategory,
  ReasonKind,
  RenderedSituation,
  RitualDay,
  SituationState,
  Thread,
  UrgeGateDecision,
  UrgeGateHoldReason,
  UrgeGateTrace,
} from '@proj-airi/stage-shared/situation'

import type { ThreadExtractionLedgerEntry } from './situation-observability'

import { initialGateMemory, initialSituationState, initialUrgeMemory, reduceSituation, THREAD_CUE_MAX_CHARS, THREAD_SUMMARY_MAX_CHARS, THREADS_MAX, WAKE_TOPIC_KEY } from '@proj-airi/stage-shared/situation'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useContextObservabilityStore } from './context-observability'
import {
  SITUATION_ENGAGEMENT_WINDOW_MS,
  SITUATION_EXTRACTION_LEDGER_MAX,
  SITUATION_GATE_HISTORY_MAX,
  SITUATION_RENDER_HISTORY_MAX,
  SITUATION_URGE_HISTORY_MAX,
  situationBlockUsage,
  useSituationObservabilityStore,
} from './situation-observability'

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

const MINUTE_MS = 60_000

const RITUAL_DAY: RitualDay = {
  dayKey: '2026-10-20',
  firstPresentAtMs: T0,
  lastAwayEndedAtMs: null,
  states: { 'greeting': 'done', 'sign-off': 'open', 'welcome-back': 'expired' },
  windowOpenedAtMs: { 'greeting': T0, 'sign-off': null, 'welcome-back': null },
}

function reason(key: string, kind: ReasonKind, category: ReasonCategory, text = key): Reason {
  return { key, kind, category, text, sourceEventId: null, ripeness: 0.8, weight: 0.5, urgent: false, dueAtMs: null, dueNow: false }
}

function urgeTrace(nowMs: number, patch: Partial<UrgeGateTrace> = {}): UrgeGateTrace {
  return {
    nowMs,
    chattiness: 0.5,
    hazardPerHour: { open: 0.6, continuation: 0, ritual: 0, due: 0, total: 0.6 },
    multipliers: { base: 0.6, pressure: 1, exchange: 1, clear: 1, damping: 1, floor: 1, game: 1 },
    urge: 0.1,
    urgeThreshold: 1,
    expectedWaitMs: 90 * MINUTE_MS,
    phase: 'open',
    unanswered: 0,
    reopenAtMs: null,
    doubleTextDueAtMs: null,
    rituals: RITUAL_DAY,
    reasons: [reason('own-day', 'own-day', 'open')],
    pick: null,
    firesLastHour: 0,
    pendingTopicKey: null,
    forceTiming: false,
    ...patch,
  }
}

function urgeHold(holdReason: UrgeGateHoldReason, nowMs: number, patch: Partial<UrgeGateTrace> = {}): UrgeGateDecision {
  return { fire: false, reason: holdReason, trace: urgeTrace(nowMs, patch) }
}

function urgeFire(picked: Reason, nowMs: number, patch: Partial<UrgeGateTrace> = {}): UrgeGateDecision {
  const pick = { categoryRoll: 0.2, reasonRoll: 0.7, category: 'open' as const, reasonKey: picked.key }
  return { fire: true, reason: 'urge', category: picked.category, topicKey: picked.key, topicText: picked.text, picked, trace: urgeTrace(nowMs, { pick, ...patch }) }
}

/** A thread at the stored text limits, as long as an extraction can make it. */
function longThread(index: number): Thread {
  const id = `thread:question:${T0}:${index}` as const
  return {
    id,
    topicKey: id,
    sessionId: 'session-abcdefghijklmn',
    kind: 'question',
    summary: 's'.repeat(THREAD_SUMMARY_MAX_CHARS),
    cue: 'c'.repeat(THREAD_CUE_MAX_CHARS),
    bornAtMs: T0,
    dueAtMs: T0 + 60 * MINUTE_MS,
    raisedCount: 0,
    lastRaisedAtMs: T0,
    expiresAtMs: T0 + 24 * 60 * MINUTE_MS,
  }
}

function ledgerEntry(atMs: number, status: ThreadExtractionLedgerEntry['status'] = 'ok'): ThreadExtractionLedgerEntry {
  return { atMs, sessionId: 'session-a', requestChars: 4_000, messageCount: 12, status, threads: [], error: null }
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

  it('records the full urge trace, the decision, the memory, the reasons, and the rituals of the newest evaluation', async () => {
    const store = useSituationObservabilityStore()
    const thread = reason('thread:question:1', 'thread-question', 'open', 'how his interview went')
    const fired = { ...initialUrgeMemory, lastFireAtMs: T0, fires: [T0] }

    store.recordUrgeDecision(urgeHold('urge', T0), initialUrgeMemory)
    const decision = urgeFire(thread, T0 + 2_000, { reasons: [thread] })
    store.recordUrgeDecision(decision, fired)

    const inspection = await store.inspect()
    expect(inspection.urge.trace).toBe(decision.trace)
    expect(inspection.urge.decision).toEqual({ fire: true, reason: 'urge', category: 'open', topicKey: thread.key, atMs: T0 + 2_000 })
    expect(inspection.urge.memory).toBe(fired)
    expect(inspection.reasons).toEqual([thread])
    expect(inspection.rituals).toBe(RITUAL_DAY)
    expect(inspection.urge.history).toEqual([
      { fromMs: T0 + 2_000, toMs: T0 + 2_000, count: 1, fire: true, reason: 'urge', category: 'open', topicKey: thread.key },
      { fromMs: T0, toMs: T0, count: 1, fire: false, reason: 'urge', category: null, topicKey: null },
    ])
  })

  it('reports no urge data before the gate evaluated once', async () => {
    const inspection = await useSituationObservabilityStore().inspect()

    expect(inspection.urge).toEqual({ trace: null, decision: null, history: [], memory: null })
    expect(inspection.urgeHistory).toEqual([])
    expect(inspection.reasons).toEqual([])
    expect(inspection.threads).toEqual([])
    expect(inspection.rituals).toBeNull()
    expect(inspection.extraction).toEqual({ ledger: [], inFlight: false })
    expect(inspection.outcomes['own-day']).toEqual({ spoken: 0, declined: 0, cancelled: 0, failed: 0, engaged: 0, ignored: 0 })
  })

  it('collapses urge decisions and urge levels into runs', async () => {
    const store = useSituationObservabilityStore()
    const hazard = (total: number) => ({ hazardPerHour: { open: total, continuation: 0, ritual: 0, due: 0, total } })

    store.recordUrgeDecision(urgeHold('urge', T0, hazard(0.6001)), initialUrgeMemory)
    store.recordUrgeDecision(urgeHold('urge', T0 + 2_000, hazard(0.6004)), initialUrgeMemory)
    store.recordUrgeDecision(urgeHold('user-typing', T0 + 4_000, hazard(0.6004)), initialUrgeMemory)
    store.recordUrgeDecision(urgeHold('urge', T0 + 6_000, { ...hazard(0.25), phase: 'continuation-window' }), initialUrgeMemory)

    const inspection = await store.inspect()
    expect(inspection.urge.history.map(entry => [entry.reason, entry.count, entry.fromMs, entry.toMs])).toEqual([
      ['urge', 1, T0 + 6_000, T0 + 6_000],
      ['user-typing', 1, T0 + 4_000, T0 + 4_000],
      ['urge', 2, T0, T0 + 2_000],
    ])
    // 0.6001 and 0.6004 both round to 0.6, so the first three evaluations are one run.
    expect(inspection.urgeHistory).toEqual([
      { fromMs: T0 + 6_000, toMs: T0 + 6_000, phase: 'continuation-window', hazardTotal: 0.25 },
      { fromMs: T0, toMs: T0 + 4_000, phase: 'open', hazardTotal: 0.6 },
    ])
  })

  it('keeps at most the history cap of urge decisions and urge levels, however many evaluations arrive', async () => {
    const store = useSituationObservabilityStore()

    // Every evaluation differs from the one before in reason and hazard, so none collapses.
    for (let index = 0; index < 2_000; index++) {
      const total = index / 1_000
      store.recordUrgeDecision(urgeHold(index % 2 === 0 ? 'urge' : 'floor', T0 + index * 2_000, { hazardPerHour: { open: total, continuation: 0, ritual: 0, due: 0, total } }), initialUrgeMemory)
    }

    const inspection = await store.inspect()
    expect(inspection.urgeHistory.length).toBeLessThanOrEqual(SITUATION_URGE_HISTORY_MAX)
    expect(inspection.urge.history.length).toBeLessThanOrEqual(SITUATION_URGE_HISTORY_MAX)
    expect(inspection.urgeHistory[0].toMs).toBe(T0 + 1_999 * 2_000)
  })

  it('publishes the urge memory and the open threads between evaluations', async () => {
    const store = useSituationObservabilityStore()
    const spoken = { ...initialUrgeMemory, lastSpokenAtMs: T0, unanswered: 1 }
    const threads = [longThread(0)]

    store.publishUrgeState(spoken, threads)

    const inspection = await store.inspect()
    expect(inspection.urge.memory).toBe(spoken)
    expect(inspection.threads).toBe(threads)
  })

  it('counts outcomes per reason kind and settles each spoken turn as engaged or ignored once', async () => {
    const store = useSituationObservabilityStore()

    store.recordReasonOutcome('thread-question', 'declined', T0)
    store.recordReasonOutcome('thread-question', 'spoken', T0)
    store.recordReasonOutcome('own-day', 'failed', T0)
    store.recordReasonOutcome('own-day', 'cancelled', T0)
    // His reply inside the window engages her thread turn.
    store.recordUserTurn(T0 + SITUATION_ENGAGEMENT_WINDOW_MS)
    // A second reply settles nothing more.
    store.recordUserTurn(T0 + SITUATION_ENGAGEMENT_WINDOW_MS + 1_000)

    // A spoken ritual with no reply is ignored at the first evaluation past the window.
    store.recordReasonOutcome('ritual-greeting', 'spoken', T0 + 20 * MINUTE_MS)
    store.recordUrgeDecision(urgeHold('urge', T0 + 20 * MINUTE_MS + SITUATION_ENGAGEMENT_WINDOW_MS), initialUrgeMemory)
    expect((await store.inspect()).outcomes['ritual-greeting']).toEqual({ spoken: 1, declined: 0, cancelled: 0, failed: 0, engaged: 0, ignored: 0 })
    store.recordUrgeDecision(urgeHold('urge', T0 + 20 * MINUTE_MS + SITUATION_ENGAGEMENT_WINDOW_MS + 2_000), initialUrgeMemory)

    // A reply after the window, before any evaluation settled the turn, counts it as ignored too.
    store.recordReasonOutcome('continuation', 'spoken', T0 + 60 * MINUTE_MS)
    store.recordUserTurn(T0 + 60 * MINUTE_MS + SITUATION_ENGAGEMENT_WINDOW_MS + 1)

    const { outcomes } = await store.inspect()
    expect(outcomes['thread-question']).toEqual({ spoken: 1, declined: 1, cancelled: 0, failed: 0, engaged: 1, ignored: 0 })
    expect(outcomes['own-day']).toEqual({ spoken: 0, declined: 0, cancelled: 1, failed: 1, engaged: 0, ignored: 0 })
    expect(outcomes['ritual-greeting']).toEqual({ spoken: 1, declined: 0, cancelled: 0, failed: 0, engaged: 0, ignored: 1 })
    expect(outcomes.continuation).toEqual({ spoken: 1, declined: 0, cancelled: 0, failed: 0, engaged: 0, ignored: 1 })
  })

  it('keeps the newest extraction ledger entries and the in-flight flag', async () => {
    const store = useSituationObservabilityStore()

    store.publishExtractionInFlight(true)
    for (let index = 0; index < SITUATION_EXTRACTION_LEDGER_MAX + 5; index++)
      store.recordExtraction(ledgerEntry(T0 + index * MINUTE_MS, index % 2 === 0 ? 'ok' : 'skipped'))

    const { extraction } = await store.inspect()
    expect(extraction.inFlight).toBe(true)
    expect(extraction.ledger).toHaveLength(SITUATION_EXTRACTION_LEDGER_MAX)
    expect(extraction.ledger[0].atMs).toBe(T0 + (SITUATION_EXTRACTION_LEDGER_MAX + 4) * MINUTE_MS)
    store.publishExtractionInFlight(false)
    expect((await store.inspect()).extraction.inFlight).toBe(false)
  })

  it('keeps the inspection under 64 KB after an hour of gate ticks', async () => {
    const store = useSituationObservabilityStore()
    // A heavy hour: the most threads at the stored text limits, each also a reason; a hazard that changes at every tick,
    // so the urge history reaches its cap; a hold by typing every ten minutes; four fires and four extractions.
    const threads = Array.from({ length: THREADS_MAX }, (_, index) => longThread(index))
    const reasons = [...threads.map(thread => reason(thread.topicKey, 'thread-question', 'open', thread.cue)), reason('own-day', 'own-day', 'open', 'something from your own day')]
    const ticks = 60 * 60 / 2
    for (let index = 0; index < ticks; index++) {
      const nowMs = T0 + index * 2_000
      const total = 0.6 + (index % 500) / 1_000
      const patch = { reasons, hazardPerHour: { open: total, continuation: 0, ritual: 0, due: 0, total }, firesLastHour: Math.floor(index / 450) }
      const fires = index % 450 === 449
      const typing = index % 300 < 3
      const decision = fires ? urgeFire(reasons[index % reasons.length], nowMs, patch) : urgeHold(typing ? 'user-typing' : 'urge', nowMs, patch)
      store.recordUrgeDecision(decision, initialUrgeMemory)
      store.recordGateDecision(fires ? fire(reasons[index % reasons.length].key, nowMs) : hold(typing ? 'user-typing' : 'gap', nowMs), initialGateMemory)
      if (fires) {
        store.recordReasonOutcome('thread-question', 'spoken', nowMs)
        store.recordExtraction({ ...ledgerEntry(nowMs), threads: threads.slice(0, 3).map(thread => ({ kind: thread.kind, summary: thread.summary })) })
      }
    }
    store.publishUrgeState(initialUrgeMemory, threads)

    const inspection = await store.inspect()
    const bytes = new TextEncoder().encode(JSON.stringify(inspection)).length
    // Printed for the evidence of the inspection size budget.
    console.info(`[situation-observability] inspection payload after 1 h of 2 s ticks: ${bytes} bytes`)
    expect(inspection.urgeHistory).toHaveLength(SITUATION_URGE_HISTORY_MAX)
    expect(bytes).toBeLessThan(64 * 1024)
  })

  it('counts block lines and characters the way the renderer budgets them', () => {
    expect(situationBlockUsage('')).toEqual({ lines: 0, chars: 0 })
    expect(situationBlockUsage('[Situation 09:00]')).toEqual({ lines: 1, chars: 17 })
    expect(situationBlockUsage('[Situation 09:00]\n- New: x')).toEqual({ lines: 2, chars: 26 })
  })
})
