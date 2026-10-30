import type {
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

import { initialSituationState, initialUrgeMemory, reduceSituation, THREAD_CUE_MAX_CHARS, THREAD_SUMMARY_MAX_CHARS, THREADS_MAX, WAKE_TOPIC_KEY } from '@proj-airi/stage-shared/situation'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useContextObservabilityStore } from './context-observability'
import {
  SITUATION_ENGAGEMENT_WINDOW_MS,
  SITUATION_EXTRACTION_LEDGER_MAX,
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
  return { atMs, sessionId: 'session-a', requestChars: 4_000, messageCount: 12, status, threads: [], error: null, answer: { chars: 1_200, finishReason: 'stop' } }
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
      { role: 'user', content: [{ type: 'text', text: '(A quiet moment.)' }, { type: 'text', text: '[Situation]' }] },
    ], { turnId: 'turn-1', origin: 'unprompted' })
    expect(context.lastPromptProjection).toMatchObject({ turnId: 'turn-1', origin: 'unprompted' })

    context.capturePromptProjection({ sessionId: 'session-a', message: 'hello', contexts: {} })
    context.captureProviderPromptProjection('session-a', [{ role: 'user', content: 'hello there, a much longer user request' }], { turnId: 'turn-2', origin: 'user' })

    expect((await store.inspect()).spend.lastUnpromptedRequest).toMatchObject({
      sessionId: 'session-a',
      turnId: 'turn-1',
      messageCount: 2,
      chars: 'You are AIRI.'.length + '(A quiet moment.)'.length + '[Situation]'.length,
    })
  })

  it('answers an evaluation request without a gate as skipped, and with one through the gate evaluator only', async () => {
    const store = useSituationObservabilityStore()
    expect(await store.evaluateGate()).toEqual({ status: 'skipped', reason: 'gate-not-running' })

    const calls: unknown[][] = []
    const stop = store.serveGateEvaluation((...args: unknown[]) => {
      calls.push(args)
      return { status: 'evaluated', decision: urgeHold('dont-disturb', T0, { forceTiming: true }), memory: initialUrgeMemory }
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

  /**
   * One hour of 2 s gate ticks that fills every history to its cap: the hazard changes at every tick, and the hold
   * reason changes every third tick, the way it does while he chats (typing, urge, generating, speaking). The open
   * threads are also listed as reasons. Four fires each record a spoken outcome, and the extraction ledger is full.
   * Returns the inspection and its size as the inspector bus would carry it, measured as JSON bytes.
   */
  async function fillHour(threads: readonly Thread[]) {
    const store = useSituationObservabilityStore()
    const reasons = [...threads.map(thread => reason(thread.topicKey, 'thread-question', 'open', thread.cue)), reason('own-day', 'own-day', 'open', 'something from your own day')]
    const holds = ['user-typing', 'urge', 'generating', 'character-speaking'] as const
    const ticks = 60 * 60 / 2
    for (let index = 0; index < ticks; index++) {
      const nowMs = T0 + index * 2_000
      const total = 0.6 + (index % 500) / 1_000
      const patch = { reasons, hazardPerHour: { open: total, continuation: 0, ritual: 0, due: 0, total }, firesLastHour: Math.floor(index / 450) }
      const fires = index % 450 === 449
      const urgeReason = holds[Math.floor(index / 3) % holds.length]
      const picked = reasons[index % reasons.length]
      store.recordUrgeDecision(fires ? urgeFire(picked, nowMs, patch) : urgeHold(urgeReason, nowMs, patch), initialUrgeMemory)
      if (fires)
        store.recordReasonOutcome('thread-question', 'spoken', nowMs)
    }
    for (let index = 0; index < SITUATION_EXTRACTION_LEDGER_MAX; index++)
      store.recordExtraction({ ...ledgerEntry(T0 + index * MINUTE_MS), threads: threads.slice(0, 3).map(thread => ({ kind: thread.kind, summary: thread.summary })) })
    store.publishUrgeState(initialUrgeMemory, threads)

    const inspection = await store.inspect()
    expect(inspection.urge.history).toHaveLength(SITUATION_URGE_HISTORY_MAX)
    expect(inspection.urgeHistory).toHaveLength(SITUATION_URGE_HISTORY_MAX)
    return { inspection, bytes: new TextEncoder().encode(JSON.stringify(inspection)).length }
  }

  it('keeps the inspection under 64 KB after a chat-active hour that fills every history', async () => {
    const threads = Array.from({ length: 8 }, (_, index) => ({ ...longThread(index), summary: 's'.repeat(100), cue: 'c'.repeat(80) }))

    const { bytes } = await fillHour(threads)

    // Measured 43,577 bytes at the current caps. The 60 KB target leaves room below the 64 KB budget.
    expect(bytes).toBeLessThanOrEqual(60 * 1024)
  })

  it('bounds the inspection with every history full and the most threads at the stored text limits', async () => {
    const threads = Array.from({ length: THREADS_MAX }, (_, index) => longThread(index))

    const { bytes } = await fillHour(threads)

    // Known bound, not the budget: 73,393 bytes at the current caps. The threads, and the reasons that repeat
    // them, are data the inspector must show, so this case may exceed 64 KB; it must not grow past this bound.
    expect(bytes).toBeLessThanOrEqual(76 * 1024)
  })

  it('counts block lines and characters the way the renderer budgets them', () => {
    expect(situationBlockUsage('')).toEqual({ lines: 0, chars: 0 })
    expect(situationBlockUsage('[Situation 09:00]')).toEqual({ lines: 1, chars: 17 })
    expect(situationBlockUsage('[Situation 09:00]\n- New: x')).toEqual({ lines: 2, chars: 26 })
  })
})
