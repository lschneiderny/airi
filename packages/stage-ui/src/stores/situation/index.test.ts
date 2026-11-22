import type { MindSlowState, VoiceLine, VoiceRun } from '@proj-airi/character-mind'
import type { ChatHistoryItem, ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { ActivityObservation, ContextObservation, NotifyObservation, Thread, TouchObservation, WakeObservation } from '@proj-airi/stage-shared/situation'
import type { ForegroundWindowSample } from '@proj-airi/stage-shared/stores/foreground-window'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { SituationChatControls } from '.'
import type { LlmStream } from '../../features/situation/thread-extraction'
import type { ChatReactionPayload, ChatUnpromptedPayload, ChatUnpromptedResult } from '../chat'
import type { ThreadExtractionLedgerEntry } from '../devtools/situation-observability'

import { CharacterMind, reactionTurnId } from '@proj-airi/character-mind'
import { createChatHooks } from '@proj-airi/core-agent'
import { DEFAULT_CHARACTER_PROFILE, initialCharacterState, readCharacter } from '@proj-airi/stage-shared/character-state'
import { evaluateUrgeGate, FLOOR_MS, HOUR_MS, initialSituationState, notifyTopicKey, recordUrgeFireOutcome, SETTLE_MS, threadMinAgeMs, TOUCH_TOPIC_KEY, userGateMemoryOf } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GATE_INTERVAL_MS, useSituationStore } from '.'
import { MindVoice } from '../../composables/performance/mind-voice'
import { useCharacterBehaviorSettings } from '../../features/character-behavior/settings'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useSituationInnerState } from '../../features/situation/inner-state'
import { useSituationSettings } from '../../features/situation/settings'
import { EXTRACTION_MAX_TOKENS } from '../../features/situation/thread-extraction'
import { chatComposerActivityChangedEvent, getSpeechBusContext, situationForgetRequestedEvent, speechInputUserSpeakingChangedEvent, voiceRequestSnapshot, voiceRequestTurns, voiceSnapshotChanged, voiceTurnsChanged } from '../../services/speech/bus'
import { connectMind } from '../../test/connect-mind'
import { characterStateContext, useCharacterStateStore } from '../character-state'
import { useCharacterNotebookStore } from '../character/notebook'
import { useSituationObservabilityStore } from '../devtools/situation-observability'
import { DESKTOP_SAMPLE_STALE_MS } from './sensors/desktop'
import { EXCHANGE_QUIET_MS } from './sensors/exchange'
import { FOREGROUND_SAMPLE_STALE_HIDDEN_MS, FOREGROUND_SAMPLE_STALE_VISIBLE_MS } from './sensors/foreground'

// The situation store feeds the character state, whose store reads the active card id and its profile from the card
// store. The real card store's setup needs an i18n application context.
vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', {
      state: () => ({ activeCardId: 'default', cards: new Map<string, unknown>() }),
    }),
  }
})

// The real urge gate, wrapped so tests can read its decisions and the memory each one left.
vi.mock(import('@proj-airi/stage-shared/situation'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    evaluateUrgeGate: vi.fn(actual.evaluateUrgeGate),
    recordUrgeFireOutcome: vi.fn(actual.recordUrgeFireOutcome),
  }
})

// 8 pm local time: outside the greeting and sign-off windows, so no ritual opens unless a test moves the clock.
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
/** 9 am local time on the same logical day: his first appearance opens the greeting window. */
const MORNING = new Date(2026, 9, 20, 9, 0, 0).getTime()
/**
 * The gate seed of every test. Its first two urge thresholds are high (about 4.9 and 3.6 hours of base rate), so no
 * test sees an ordinary fire it did not force, and the reason roll of its first forced fire picks the first reason.
 */
const SEED = 497396
let notifyCount = 0

/** The leader's inner state lives in localStorage, which the Node project does not provide. */
class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

/** A synced runtime whose leadership the test flips. It reports the current role on subscribe, like the plugin. */
function createLeadership(initiallyLeader: boolean) {
  let isLeader = initiallyLeader
  const listeners = new Set<(isLeader: boolean) => void>()
  const unsubscribe = vi.fn()
  const runtime: SyncedPiniaRuntime = {
    addRole: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    getParticipants: vi.fn(() => []),
    getRoles: vi.fn(() => []),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listeners.add(listener)
      listener(isLeader)
      return () => {
        listeners.delete(listener)
        unsubscribe()
      }
    }),
    participantId: 'situation-test',
    plugin: vi.fn(),
  }
  return {
    runtime,
    unsubscribe,
    set(next: boolean) {
      isLeader = next
      for (const listener of listeners)
        listener(next)
    },
  }
}

function wake(atMs: number): WakeObservation {
  return { kind: 'wake', cause: 'unlock', atMs, awayMs: null }
}

function activity(appId: string, atMs: number): ActivityObservation {
  return { kind: 'activity', appId, label: appId, category: 'other', title: null, atMs }
}

/** A fresh desktop sample at the current fake time. */
function desktopSample(overrides: Partial<DesktopActivitySnapshot> = {}): DesktopActivitySnapshot {
  return { idleSeconds: 0, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: null, screenChange: null, sampledAtMs: Date.now(), ...overrides }
}

/** A fresh foreground sample at the current fake time. */
function foregroundSample(overrides: Partial<ForegroundWindowSample> = {}): ForegroundWindowSample {
  return { exePath: 'C:\\Windows\\notepad.exe', exeName: 'notepad.exe', title: 'notes.txt - Notepad', pid: 7, ownProcess: false, busy: 'accepts', sampledAtMs: Date.now(), ...overrides }
}

/** The provider of the fake chat selection. The fake `stream` never reaches it. */
const extractionProvider: GenerationProvider = {
  generation() {
    throw new Error('The fake stream sends no request')
  },
}

/**
 * Fake chat controls: a quiet chat whose unprompted turns are spoken, unless a test replaces `submitUnprompted`. Its
 * session holds `state.messages`, and its thread extraction stream answers with no text unless a test replaces it.
 */
function createChatControls() {
  const state: { sending: boolean, queued: number, unpromptedPending: boolean, messages: ChatHistoryItem[] } = { sending: false, queued: 0, unpromptedPending: false, messages: [] }
  const submitUnprompted = vi.fn(async (_payload: ChatUnpromptedPayload): Promise<ChatUnpromptedResult> => ({ status: 'spoken', text: 'Still at it?' }))
  const submitReaction = vi.fn(async (_payload: ChatReactionPayload): Promise<ChatUnpromptedResult> => ({ status: 'spoken', text: 'Hey!' }))
  const stream = vi.fn<LlmStream>(async () => {})
  const controls: SituationChatControls = {
    sending: () => state.sending,
    pendingQueuedSendCount: () => state.queued,
    unpromptedPending: () => state.unpromptedPending,
    activeSessionId: () => 'session-1',
    submitUnprompted: payload => submitUnprompted(payload),
    submitReaction: payload => submitReaction(payload),
    submitNotice: async () => ({ status: 'declined' }),
    cancelTurn: async () => {},
    sessionMessages: () => state.messages,
    extractionSelection: async () => ({ provider: extractionProvider, model: 'chat-model', characterName: 'Airi' }),
    stream: (...args) => stream(...args),
  }
  return { state, controls, submitUnprompted, submitReaction, stream }
}

/** Emits the hooks of one finished user turn, as the chat runtime does. */
async function userTurn(hooks: ChatHookRegistry, turnId: string, sessionId = 'session-1') {
  const context: ChatStreamEventContext = { sessionId, turnId, message: { role: 'user', content: 'hi', createdAt: Date.now(), id: turnId }, contexts: {}, composedMessage: [] }
  const output = { role: 'assistant' as const, content: 'Hi!', slices: [], tool_results: [] }
  await hooks.emitBeforeSendHooks('hi', context)
  await hooks.emitAssistantMessageHooks(output, 'Hi!', context)
  await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Hi!', toolCalls: [] }, context)
}

/** One stored chat message with an id, as the session store keeps them. */
function said(role: 'user' | 'assistant', id: string, content: string): ChatHistoryItem {
  return role === 'user'
    ? { role, content, createdAt: Date.now(), id }
    : { role, content, slices: [], tool_results: [], createdAt: Date.now(), id }
}

/** A thread extraction stream whose model answers `text`. */
function answers(text: string): LlmStream {
  return async (_model, _provider, _conversation, options) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text })
  }
}

/** The conversation text that extraction call `index` sent to the model. */
function extractionInput(stream: ReturnType<typeof createChatControls>['stream'], index: number): string {
  for (const turn of stream.mock.calls[index]?.[2].turns ?? []) {
    if (turn.type !== 'user')
      continue
    const segment = turn.content[0]
    return segment && 'text' in segment && typeof segment.text === 'string' ? segment.text : ''
  }
  return ''
}

describe('situation store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores observations and renders nothing before it is initialized', () => {
    const store = useSituationStore()

    store.ingest(wake(T0))

    expect(store.state).toBe(initialSituationState)
    expect(store.renderForRequest(T0)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ingests and ticks only while this window leads', () => {
    const leadership = createLeadership(false)
    const store = useSituationStore()
    store.initialize(leadership.runtime)

    store.ingest(wake(T0))
    expect(store.leading).toBe(false)
    expect(store.state).toBe(initialSituationState)
    expect(store.renderForRequest(T0)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)

    leadership.set(true)
    store.ingest(wake(T0))

    expect(store.leading).toBe(true)
    expect(store.state.events.map(event => event.topicKey)).toEqual(['wake'])
    expect(vi.getTimerCount()).toBe(1)
  })

  it('derives settled events from the 1 s ticker without a new observation', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    // The first app ever seen has no switch event, so the test switches away from an earlier app.
    store.ingest(activity('editor', T0))
    vi.advanceTimersByTime(10 * 60 * 1_000)
    store.ingest(activity('game', Date.now()))

    vi.advanceTimersByTime(SETTLE_MS - 1_000)
    expect(store.state.events.filter(event => event.kind === 'app-switch')).toEqual([])

    vi.advanceTimersByTime(1_000)
    expect(store.state.events.filter(event => event.kind === 'app-switch').map(event => event.topicKey)).toEqual(['activity:game'])
  })

  it('stops the ticker on demotion and restarts from the initial state on promotion', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.ingest(activity('editor', T0))
    store.ingest(activity('game', T0 + 1_000))

    leadership.set(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(store.state).toBe(initialSituationState)

    // A long demotion: nothing ticks and nothing is retained, so the settle of the old activity never appears.
    vi.advanceTimersByTime(3 * 60 * 60 * 1_000)
    store.ingest(wake(Date.now()))
    expect(store.state).toBe(initialSituationState)

    leadership.set(true)
    expect(store.state).toBe(initialSituationState)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(store.state.events).toEqual([])
  })

  it('keeps one ticker when leadership is reported twice', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.initialize(leadership.runtime)
    leadership.set(true)

    expect(leadership.runtime.onLeadershipChange).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('renders the block for a request and marks its new events as shown', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.ingest(wake(T0))

    const first = store.renderForRequest(T0 + 1_000)
    const second = store.renderForRequest(T0 + 2_000)

    expect(first).toMatch(/^\[Situation \d\d:\d\d\]\n- New: unlocked the computer \(just now\)$/)
    expect(store.state.events.map(event => event.shownAtMs)).toEqual([T0 + 1_000])
    expect(second).toMatch(/^\[Situation \d\d:\d\d\]$/)
  })

  it('feeds the devtools inspector with every render and with the live state', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    const observability = useSituationObservabilityStore()
    store.initialize(leadership.runtime)
    store.ingest(wake(T0))
    expect(observability.liveState).toEqual({ leading: true, state: store.state })

    const text = store.renderForRequest(T0 + 1_000)

    const shownIds = store.state.events.filter(event => event.shownAtMs === T0 + 1_000).map(event => event.id)
    expect(shownIds).not.toEqual([])
    expect(observability.renders.map(render => ({ nowMs: render.nowMs, text: render.text, shownEventIds: render.shownEventIds })))
      .toEqual([{ nowMs: T0 + 1_000, text, shownEventIds: shownIds }])
    // The live state already carries the shown marks of that render.
    expect(observability.liveState.state).toBe(store.state)

    leadership.set(false)
    expect(observability.liveState).toEqual({ leading: false, state: initialSituationState })
  })

  it('marks a topic as addressed only in the leader', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.ingest(wake(T0))

    store.markAddressed('wake')

    expect(store.state.events.map(event => event.addressedAtMs)).toEqual([T0])
  })

  it('keeps a follower window at the initial state while the leader window folds observations', () => {
    const leaderWindow = createLeadership(true)
    const followerWindow = createLeadership(false)
    setActivePinia(createPinia())
    const leader = useSituationStore()
    setActivePinia(createPinia())
    const follower = useSituationStore()
    leader.initialize(leaderWindow.runtime)
    follower.initialize(followerWindow.runtime)

    leader.ingest(wake(T0))
    follower.ingest(wake(T0))

    expect(leader.state.events).toHaveLength(1)
    expect(follower.state).toBe(initialSituationState)
    expect(follower.renderForRequest(T0)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('records a return the mind decided in the leader, and nothing in a follower', () => {
    const leaderWindow = createLeadership(true)
    const followerWindow = createLeadership(false)
    setActivePinia(createPinia())
    const leader = useSituationStore()
    setActivePinia(createPinia())
    const follower = useSituationStore()
    leader.initialize(leaderWindow.runtime)
    follower.initialize(followerWindow.runtime)

    for (const store of [leader, follower]) {
      store.observeReturn(wake(T0))
      store.observeReturn({ kind: 'return', atMs: T0, awayMs: 10 * 60_000 })
    }

    expect(leader.state.events.map(event => event.kind)).toEqual(['wake', 'returned'])
    expect(leader.state.tracking).toMatchObject({ lastReturnAtMs: T0, lastAwayMs: 10 * 60_000 })
    expect(follower.state).toBe(initialSituationState)
  })

  it('keeps the situation out of Pinia state, so no plugin can sync or persist it', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.ingest(wake(T0))

    expect(store.$state).toEqual({})
  })

  it('stops the ticker and the leadership subscription on dispose', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.ingest(wake(T0))

    store.dispose()
    leadership.set(true)

    expect(leadership.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(store.leading).toBe(false)
    expect(store.state).toBe(initialSituationState)
  })

  it('feeds desktop, conversation, and stage sensors into the leader situation', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    const hooks = createChatHooks()
    store.observeChat(hooks, createChatControls().controls)
    usePerformanceRuntimeState().publish({ exposedActions: [], exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    store.initialize(leadership.runtime)

    useDesktopActivityStore().setSnapshot(desktopSample())
    await userTurn(hooks, 'turn-1')

    expect(store.state.presence).toEqual({ state: 'here', reason: null, sinceMs: T0 })
    expect(store.state.conversation).toMatchObject({ lastUserAtMs: T0, lastCharacterAtMs: T0, lastUnpromptedAtMs: null })
    expect(store.renderForRequest(T0)).toMatch(/^\[Situation \d\d:\d\d\]\n- The user is at the desk, active for less than a minute\n- You two last talked just now\.\n- Stage - can show: face: smile$/)
  })

  it('renders the mind\'s wake and return after a 6 min lock next to the presence from an unlocked sample', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const desktop = useDesktopActivityStore()

    desktop.setSnapshot(desktopSample({ locked: true }))
    expect(store.state.presence).toMatchObject({ state: 'away', reason: 'locked' })
    // The producer keeps sampling while the session is locked.
    const keepLocked = setInterval(() => desktop.setSnapshot(desktopSample({ locked: true })), 1_000)
    vi.advanceTimersByTime(6 * 60 * 1_000)
    clearInterval(keepLocked)
    desktop.setSnapshot(desktopSample({ unlockedAtMs: Date.now() }))
    // The unlocked sample alone reports only presence; the wake and the return come from the mind.
    expect(store.state.events.map(event => event.kind)).toEqual(['went-away'])
    store.observeReturn({ kind: 'wake', cause: 'unlock', atMs: Date.now(), awayMs: 6 * 60 * 1_000 })
    store.observeReturn({ kind: 'return', atMs: Date.now(), awayMs: 6 * 60 * 1_000 })

    const block = store.renderForRequest(Date.now())
    expect(block).toContain('- The user is at the desk, active for less than a minute')
    expect(block).toContain('- New: unlocked the computer (just now)')
    expect(block).toContain('- New: came back after 6 min away (just now)')
  })

  it('adds no stepped-away topic for a 1 s lock, and adds the stepped-away topic once a lock lasts 5 min', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const desktop = useDesktopActivityStore()
    const topics = () => store.state.events.map(event => event.topicKey)

    desktop.setSnapshot(desktopSample({ locked: true }))
    vi.advanceTimersByTime(1_000)
    desktop.setSnapshot(desktopSample({ unlockedAtMs: Date.now() }))
    vi.advanceTimersByTime(10 * 60 * 1_000)
    expect(topics()).not.toContain('presence:away')
    expect(store.renderForRequest(Date.now())).not.toContain('stepped away')

    // The producer keeps sampling while the session is locked.
    desktop.setSnapshot(desktopSample({ locked: true }))
    const keepLocked = setInterval(() => desktop.setSnapshot(desktopSample({ locked: true })), 1_000)
    vi.advanceTimersByTime(5 * 60 * 1_000 - 1_000)
    expect(topics()).not.toContain('presence:away')
    vi.advanceTimersByTime(1_000)
    clearInterval(keepLocked)
    expect(topics()).toContain('presence:away')
  })

  it('turns presence unknown from its own ticker when desktop samples stop arriving', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    useDesktopActivityStore().setSnapshot(desktopSample())

    vi.advanceTimersByTime(DESKTOP_SAMPLE_STALE_MS)
    expect(store.state.presence.state).toBe('here')
    vi.advanceTimersByTime(1_000)

    expect(store.state.presence).toMatchObject({ state: 'unknown', reason: 'stale' })
    // The freshness check rides on the store ticker; the sensors add no timer of their own.
    expect(vi.getTimerCount()).toBe(1)
  })

  it('registers no sensors in a follower window', async () => {
    const leadership = createLeadership(false)
    const store = useSituationStore()
    const hooks = createChatHooks()
    store.observeChat(hooks, createChatControls().controls)
    store.initialize(leadership.runtime)

    useDesktopActivityStore().setSnapshot(desktopSample({ locked: true }))
    usePerformanceRuntimeState().publish({ exposedActions: [], exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    await userTurn(hooks, 'turn-1')

    expect(store.state).toBe(initialSituationState)
  })

  it('stops its sensors on demotion and reads current values again on promotion', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    const hooks = createChatHooks()
    store.observeChat(hooks, createChatControls().controls)
    store.initialize(leadership.runtime)
    const desktop = useDesktopActivityStore()
    desktop.setSnapshot(desktopSample())

    leadership.set(false)
    await userTurn(hooks, 'turn-1')
    desktop.setSnapshot(desktopSample({ locked: true }))
    expect(store.state).toBe(initialSituationState)

    leadership.set(true)

    // The new leader reads the current sample; the turn from while it followed is not replayed.
    expect(store.state.presence).toMatchObject({ state: 'away', reason: 'locked' })
    expect(store.state.conversation.lastUserAtMs).toBeNull()
  })

  it('starts the conversation sensor when the chat hooks arrive after promotion, and keeps the first hooks', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const first = createChatHooks()
    const second = createChatHooks()

    store.observeChat(first, createChatControls().controls)
    store.observeChat(second, createChatControls().controls)
    await userTurn(second, 'turn-ignored')
    expect(store.state.conversation.lastUserAtMs).toBeNull()
    await userTurn(first, 'turn-1')

    expect(store.state.conversation.lastUserAtMs).toBe(T0)
  })

  it('reports the end of an exchange from its 1 s ticker once the chat has been quiet for 15 min', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    const hooks = createChatHooks()
    const chat = createChatControls()
    store.observeChat(hooks, chat.controls)
    store.initialize(leadership.runtime)
    const ended = vi.fn()
    store.onExchangeEnd(ended)

    await userTurn(hooks, 'turn-1')
    vi.advanceTimersByTime(EXCHANGE_QUIET_MS - 1_000)
    expect(ended).not.toHaveBeenCalled()
    chat.state.sending = true
    vi.advanceTimersByTime(1_000)
    expect(ended).not.toHaveBeenCalled()
    chat.state.sending = false
    vi.advanceTimersByTime(EXCHANGE_QUIET_MS)

    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith({ sessionId: 'session-1', startedAtMs: T0, endedAtMs: T0, userTurns: 1 })
  })

  it('reports no exchange end in a follower, nor for an exchange left open at demotion', async () => {
    const leadership = createLeadership(false)
    const store = useSituationStore()
    const hooks = createChatHooks()
    store.observeChat(hooks, createChatControls().controls)
    store.initialize(leadership.runtime)
    const ended = vi.fn()
    store.onExchangeEnd(ended)

    await userTurn(hooks, 'turn-1')
    leadership.set(true)
    await userTurn(hooks, 'turn-2')
    leadership.set(false)
    leadership.set(true)
    vi.advanceTimersByTime(2 * EXCHANGE_QUIET_MS)

    expect(ended).not.toHaveBeenCalled()
  })

  it('turns foreground samples into activity and keeps AIRI\'s own app out of it', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const foreground = useForegroundWindowStore()

    foreground.setSample(foregroundSample({ exePath: 'C:\\AIRI\\AIRI.exe', exeName: 'AIRI.exe', title: 'AIRI', ownProcess: true }))
    foreground.setSample(foregroundSample())
    // Another AIRI process (not one of this app's pids) is still AIRI: the reducer drops it through selfAppIds.
    store.ingest(activity('airi', T0))

    expect(store.state.activity).toMatchObject({ appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt' })
    expect(store.state.busy.state).toBe('accepts')
  })

  it('keeps the user\'s foreground category when AIRI\'s own windows come to the front', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const foreground = useForegroundWindowStore()
    const game = 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe'

    foreground.setSample(foregroundSample({ exePath: game, exeName: 'Hades.exe', title: 'Hades' }))
    expect(store.state.activity?.category).toBe('game')

    // The Godot stage sidecar and the chat window are AIRI's own; the stage reads this category for attention.
    foreground.setSample(foregroundSample({ exePath: 'C:\\AIRI\\godot-stage.exe', exeName: 'godot-stage.exe', title: 'Stage', ownProcess: true }))
    foreground.setSample(foregroundSample({ exePath: 'C:\\AIRI\\AIRI.exe', exeName: 'AIRI.exe', title: 'Chat', ownProcess: true }))

    expect(store.state.activity).toMatchObject({ appId: 'hades', category: 'game' })
    expect(store.foregroundCategory).toBe('game')
  })

  it('clears the watching category when the producer stops, after 5 s visible or 20 s hidden', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const game = 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe'

    // Visible stage: the 5 s limit.
    store.setStageVisible(true)
    useForegroundWindowStore().setSample(foregroundSample({ exePath: game, exeName: 'Hades.exe', title: 'Hades' }))
    expect(store.foregroundCategory).toBe('game')
    vi.advanceTimersByTime(FOREGROUND_SAMPLE_STALE_VISIBLE_MS)
    expect(store.foregroundCategory).toBe('game')
    vi.advanceTimersByTime(1_000)
    expect(store.foregroundCategory).toBeNull()
    // The reducer keeps the app for the session; only the attention-driving category expired.
    expect(store.state.activity?.category).toBe('game')

    // Hidden stage: the 20 s limit.
    store.setStageVisible(false)
    useForegroundWindowStore().setSample(foregroundSample({ exePath: game, exeName: 'Hades.exe', title: 'Hades' }))
    expect(store.foregroundCategory).toBe('game')
    vi.advanceTimersByTime(FOREGROUND_SAMPLE_STALE_HIDDEN_MS)
    expect(store.foregroundCategory).toBe('game')
    vi.advanceTimersByTime(1_000)
    expect(store.foregroundCategory).toBeNull()
  })

  it('judges foreground staleness by stage visibility from its own ticker', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    useForegroundWindowStore().setSample(foregroundSample())

    vi.advanceTimersByTime(FOREGROUND_SAMPLE_STALE_HIDDEN_MS)
    expect(store.state.busy.state).toBe('accepts')
    vi.advanceTimersByTime(1_000)
    expect(store.state.busy.state).toBe('unknown')

    useForegroundWindowStore().setSample(foregroundSample())
    store.setStageVisible(true)
    vi.advanceTimersByTime(FOREGROUND_SAMPLE_STALE_VISIBLE_MS)
    expect(store.state.busy.state).toBe('accepts')
    vi.advanceTimersByTime(1_000)
    expect(store.state.busy.state).toBe('unknown')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('names the foreground app and title in the block while foreground sharing is on', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.setStageVisible(true)

    useForegroundWindowStore().setSample(foregroundSample())

    expect(store.renderForRequest(Date.now())).toContain('- Now: Notepad (other): notes.txt, for less than a minute')
  })

  it('forgets the foreground app, title and category when foreground sharing turns off, and keeps none while it is off', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.setStageVisible(true)
    const foreground = useForegroundWindowStore()
    const game = 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe'
    // The first app only starts the session; switching to the game and staying there settles an app-switch topic.
    foreground.setSample(foregroundSample())
    vi.advanceTimersByTime(1_000)
    foreground.setSample(foregroundSample({ exePath: game, exeName: 'Hades.exe', title: 'Asphodel run 3' }))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(store.state.events.map(event => event.kind)).toContain('app-switch')
    expect(store.foregroundCategory).toBeNull()
    foreground.setSample(foregroundSample({ exePath: game, exeName: 'Hades.exe', title: 'Asphodel run 3' }))
    expect(store.foregroundCategory).toBe('game')

    await useSituationSettings().update({ shareForegroundWindow: false })
    // A reply that was already in flight still lands in the shared store.
    foreground.setSample(foregroundSample({ title: 'secret plans.txt - Notepad' }))
    vi.advanceTimersByTime(SETTLE_MS)

    expect(store.state.activity).toBeNull()
    expect(store.state.recentActivities).toEqual([])
    expect(store.state.events.filter(event => event.topicKey.startsWith('activity:'))).toEqual([])
    expect(store.foregroundCategory).toBeNull()
    const block = store.renderForRequest(Date.now())
    expect(block).not.toMatch(/Now:|Before that:/u)
    expect(JSON.stringify({ block, state: store.state })).not.toMatch(/hades|asphodel|notepad|notes\.txt|secret/iu)
  })

  it('reports the foreground app again once foreground sharing is back on', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.setStageVisible(true)
    const settings = useSituationSettings()
    await settings.update({ shareForegroundWindow: false })
    useForegroundWindowStore().setSample(foregroundSample())
    expect(store.state.activity).toBeNull()

    await settings.update({ shareForegroundWindow: true })

    expect(store.state.activity).toMatchObject({ appId: 'notepad', title: 'notes.txt' })
    expect(store.renderForRequest(Date.now())).toContain('- Now: Notepad (other): notes.txt')
  })

  it('forgets the foreground app when the block list changes, and reads an allowed app again', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.setStageVisible(true)
    const foreground = useForegroundWindowStore()
    foreground.setSample(foregroundSample({ title: 'secret plans.txt - Notepad' }))
    expect(store.state.activity).toMatchObject({ appId: 'notepad' })

    // The host answers nothing for a blocked app, so no later reading would replace what the state holds.
    await useSituationSettings().update({ blockedApps: ['notepad.exe'] })

    expect(store.state.activity).toBeNull()
    expect(JSON.stringify({ block: store.renderForRequest(Date.now()), state: store.state })).not.toMatch(/notepad|secret/iu)

    foreground.setSample(foregroundSample({ exePath: 'C:\\Apps\\Code.exe', exeName: 'Code.exe', title: 'main.ts' }))
    expect(store.state.activity).toMatchObject({ appId: 'code', title: 'main.ts' })
  })

  it('forgets a title it holds when window titles stop being shared', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    store.setStageVisible(true)
    const settings = useSituationSettings()
    const foreground = useForegroundWindowStore()
    foreground.setSample(foregroundSample({ title: 'secret plans.txt - Notepad' }))
    expect(store.state.activity).toMatchObject({ title: 'secret plans.txt' })

    await settings.update({ shareWindowTitles: false })

    expect(JSON.stringify({ block: store.renderForRequest(Date.now()), state: store.state })).not.toMatch(/secret/iu)
    // The host answers the next read without a title.
    foreground.setSample(foregroundSample({ title: '' }))
    expect(store.state.activity).toMatchObject({ appId: 'notepad', title: null })
  })

  it('ignores the web extension while browser sharing is off, and forgets what it already shared', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const settings = useSituationSettings()
    // The extension's source keys name its module inside the extension: `<extension id>:<module id>`.
    const browsing = (text: string): ContextObservation => ({ kind: 'context', sourceKey: 'proj-airi:plugin-web-extension:module-a', text, atMs: Date.now() })
    const watching = (eventId: string, headline: string): NotifyObservation => ({ kind: 'notify', sourceKey: 'proj-airi:plugin-web-extension:module-b', eventId, headline, urgency: 'soon', reminder: false, provenance: { kind: 'plugin' }, atMs: Date.now() })
    expect(settings.document.shareBrowserActivity).toBe(true)
    store.ingest(browsing('User is browsing: Secret page (https://example.test/secret).'))
    store.ingest(watching('video-1', 'User is watching: Secret video'))
    store.ingest({ kind: 'context', sourceKey: 'vision', text: 'A cat on the desk', atMs: Date.now() })
    const shared = store.renderForRequest(Date.now())
    expect(shared).toContain('Secret page (https://example.test/secret)')
    expect(shared).toContain('Secret video')

    await settings.update({ shareBrowserActivity: false })
    expect(JSON.stringify(store.state)).not.toMatch(/secret/iu)
    // What the extension sends while sharing is off never enters the situation.
    store.ingest(browsing('User is browsing: Hidden page (https://example.test/hidden).'))
    store.ingest(watching('video-2', 'User is watching: Hidden video'))

    const block = store.renderForRequest(Date.now())
    expect(block).toContain('A cat on the desk')
    expect(JSON.stringify({ block, state: store.state })).not.toMatch(/secret|hidden|example\.test/iu)

    await settings.update({ shareBrowserActivity: true })
    store.ingest(browsing('User is browsing: Docs page (https://example.test/docs).'))
    expect(store.renderForRequest(Date.now())).toContain('Docs page (https://example.test/docs)')
  })

  it('stores stage visibility, which starts hidden', () => {
    const store = useSituationStore()
    expect(store.stageVisible).toBe(false)

    store.setStageVisible(true)

    expect(store.stageVisible).toBe(true)
    expect(store.$state).toEqual({})
  })
})

describe('situation gate loop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
    // Every test starts from empty storage; a reload inside one test shares it, as windows share one origin.
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.mocked(evaluateUrgeGate).mockClear()
    vi.mocked(recordUrgeFireOutcome).mockClear()
    notifyCount = 0
  })

  afterEach(() => {
    useSituationStore().dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /**
   * A leader in a host that supports unprompted turns, with a visible stage, an attentive user, and desktop and
   * foreground samples that its producers keep fresh, so only the gate's own rules decide. The gate's seed is pinned.
   */
  function startQuietLeader(options: { capable?: boolean, leader?: boolean, foreground?: () => ForegroundWindowSample | null, slow?: MindSlowState } = {}) {
    const leadership = createLeadership(options.leader ?? true)
    const store = useSituationStore()
    const hooks = createChatHooks()
    const chat = createChatControls()
    const desktop = useDesktopActivityStore()
    const foreground = useForegroundWindowStore()
    // `options.foreground` returns the next foreground sample, or `null` once its producer stops.
    const keepFresh = () => {
      desktop.setSnapshot(desktopSample())
      const sample = options.foreground ? options.foreground() : foregroundSample()
      if (sample)
        foreground.setSample(sample)
    }
    keepFresh()
    setInterval(keepFresh, 1_000)
    store.setStageVisible(true)
    if (options.capable ?? true)
      store.setHostCapabilities({ unprompted: true })
    store.observeChat(hooks, chat.controls)
    store.initialize(leadership.runtime)
    const connected = connectMind(store, SEED, options.slow)
    return { store, hooks, chat, leadership, observability: useSituationObservabilityStore(), ...connected }
  }

  /** An ordinary topic: a notify that is not urgent, so only the urge decides when the gate raises it. */
  function offerTopic(headline = 'Package shipped') {
    notifyCount += 1
    const eventId = `evt-${notifyCount}`
    useSituationStore().ingest({ kind: 'notify', sourceKey: 'plugin:qa', eventId, headline, urgency: 'soon', reminder: false, provenance: { kind: 'plugin' }, atMs: Date.now() })
    return notifyTopicKey('plugin:qa', eventId)
  }

  /** An urgent topic: an immediate notify, which the gate raises at its next tick past every timing hold. */
  function offerUrgentTopic(headline = 'Doorbell') {
    notifyCount += 1
    const eventId = `evt-${notifyCount}`
    useSituationStore().ingest({ kind: 'notify', sourceKey: 'plugin:qa', eventId, headline, urgency: 'immediate', reminder: false, provenance: { kind: 'plugin' }, atMs: Date.now() })
    return notifyTopicKey('plugin:qa', eventId)
  }

  async function nextGateTick() {
    await vi.advanceTimersByTimeAsync(GATE_INTERVAL_MS)
  }

  it.each(['spoken', 'declined', 'cancelled', 'failed', 'refused'] as const)('consumes a notebook occurrence after a %s attempt, independently of event history', async (status) => {
    const { store, chat } = startQuietLeader()
    const notebook = useCharacterNotebookStore()
    const task = notebook.scheduleTask({ title: 'Take a break', priority: 'critical' })
    const observation: NotifyObservation = {
      kind: 'notify',
      sourceKey: 'character:task-scheduler',
      eventId: `${task.id}:${task.revision}`,
      headline: task.title,
      urgency: 'immediate',
      reminder: true,
      provenance: { kind: 'task-reminder', taskId: task.id, revision: task.revision, dueAtMs: task.createdAt, priority: task.priority },
      atMs: task.firstNotifiedAt ?? Date.now(),
    }
    store.ingest(observation)
    const topicKey = notifyTopicKey(observation.sourceKey, observation.eventId)
    let result: ChatUnpromptedResult
    if (status === 'spoken')
      result = { status, text: 'Take a break?' }
    else if (status === 'failed')
      result = { status, error: 'Provider failed' }
    else if (status === 'refused')
      result = { status: 'failed', error: 'Another unprompted turn is still pending' }
    else
      result = { status }
    chat.state.unpromptedPending = status === 'refused'
    chat.submitUnprompted.mockResolvedValueOnce(result)
    expect(await store.speak('reminder-attempt', { kind: 'reach-out', topicKey, topicText: task.title, reason: { kind: 'notify', category: 'urgent' } })).toBe(status)
    expect(task.addressedRevision).toBe(0)
    expect(notebook.getDueTasks(Date.now(), 60_000)).toEqual([])
    expect(store.state.events.some(event => event.topicKey === topicKey)).toBe(false)
    notebook.requeueTask(task.id, { dueAt: Date.now() })
    expect(notebook.getDueTasks(Date.now(), 0)).toHaveLength(1)
  })

  it('withdraws a completed or rescheduled reminder before another gate decision', () => {
    const { store } = startQuietLeader()
    const notebook = useCharacterNotebookStore()
    const task = notebook.scheduleTask({ title: 'Take a break' })
    const offer = () => store.ingest({
      kind: 'notify',
      sourceKey: 'character:task-scheduler',
      eventId: `${task.id}:${task.revision}`,
      headline: task.title,
      urgency: 'soon',
      reminder: true,
      provenance: { kind: 'task-reminder', taskId: task.id, revision: task.revision, dueAtMs: task.createdAt, priority: task.priority },
      atMs: task.firstNotifiedAt ?? Date.now(),
    })
    offer()
    expect(store.state.events.filter(event => event.kind === 'notify')).toHaveLength(1)
    notebook.requeueTask(task.id, { dueAt: Date.now() + 60_000 })
    expect(store.state.events.filter(event => event.kind === 'notify')).toEqual([])
    offer()
    notebook.markTaskDone(task.id)
    expect(store.state.events.filter(event => event.kind === 'notify')).toEqual([])
  })

  /** The newest urge gate evaluation: its input, the memory it started from, and its decision and memory. */
  function lastEvaluation() {
    const { calls, results } = vi.mocked(evaluateUrgeGate).mock
    const call = calls.at(-1)
    const result = results.at(-1)
    if (!call || result?.type !== 'return')
      throw new Error('The urge gate has not evaluated')
    return { input: call[0], memoryBefore: call[1], decision: result.value.decision, memory: result.value.memory }
  }

  /** The gate memory that the next evaluation starts from, read through one more gate tick. */
  async function memoryAtNextTick() {
    await nextGateTick()
    return lastEvaluation().memoryBefore
  }

  function triggerOf(payload: ChatUnpromptedPayload) {
    return { topicKey: payload.topicKey, text: payload.topicText, kind: payload.reason?.kind }
  }

  /** Emits the hooks the runtime emits for an unprompted turn that starts speaking. */
  async function unpromptedTurnSpeaks(hooks: ChatHookRegistry, turnId: string, trigger?: ReturnType<typeof triggerOf>) {
    const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, origin: 'unprompted', message: { role: 'user', content: '(A quiet moment.)', createdAt: Date.now(), id: turnId, trigger }, contexts: {}, composedMessage: [] }
    await hooks.emitBeforeSendHooks('(A quiet moment.)', context)
    await hooks.emitTokenLiteralHooks(' Still at it?', context)
  }

  /** Emits every hook the runtime emits for an unprompted turn that is spoken to the end. */
  async function unpromptedTurnIsSpoken(hooks: ChatHookRegistry, payload: ChatUnpromptedPayload) {
    const turnId = payload.messageId!
    const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, origin: 'unprompted', message: { role: 'user', content: '(A quiet moment.)', createdAt: Date.now(), id: turnId, trigger: triggerOf(payload) }, contexts: {}, composedMessage: [] }
    const output = { role: 'assistant' as const, content: 'Still at it?', slices: [], tool_results: [] }
    await unpromptedTurnSpeaks(hooks, turnId, triggerOf(payload))
    await hooks.emitAssistantMessageHooks(output, 'Still at it?', context)
    await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Still at it?', toolCalls: [] }, context)
  }

  /** A declined turn emits only the before-send and stream-end hooks, as the runtime's decline contract pins. */
  async function unpromptedTurnIsDeclined(hooks: ChatHookRegistry, payload: ChatUnpromptedPayload) {
    const turnId = payload.messageId!
    const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, origin: 'unprompted', message: { role: 'user', content: '(A quiet moment.)', createdAt: Date.now(), id: turnId, trigger: triggerOf(payload) }, contexts: {}, composedMessage: [] }
    await hooks.emitBeforeSendHooks('(A quiet moment.)', context)
    await hooks.emitStreamEndHooks({ ...context, cueStats: { act: 0, recovered: 0, rejected: 0, origin: 'unprompted', declined: true, silent: false, wordless: false, breaks: 0, breaksIgnored: 0 } })
  }

  /** Saves one ripe question from an earlier exchange of `session-1` before the leader starts. */
  function saveRipeQuestion(): Thread {
    const thread: Thread = {
      id: 'thread:question:1',
      topicKey: 'thread:question:1',
      sessionId: 'session-1',
      kind: 'question',
      summary: 'He had a job interview this morning.',
      cue: 'how his interview went',
      bornAtMs: Date.now() - 3 * HOUR_MS,
      dueAtMs: null,
      raisedCount: 0,
      lastRaisedAtMs: null,
      expiresAtMs: Date.now() + 6 * HOUR_MS,
    }
    const inner = useSituationInnerState()
    inner.claim(-1)
    inner.read()
    inner.write({ threads: [thread] }, -1)
    return thread
  }

  /** Her pacing after she just talked about her own day, so its weight starts at zero and a thread is the reason she opens with. */
  function ownDayJustNow(): MindSlowState {
    return { pacing: { lastSpokenAtMs: null, unanswered: 0, awaitingSinceMs: null, damp: null, lastOwnDayAtMs: Date.now() } }
  }

  it('extracts the threads of an ended exchange without a chat hook or a chat message, and saves them for the gate', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    chat.state.messages = [
      { role: 'user', content: 'I have a job interview tomorrow at nine.', createdAt: Date.now(), id: 'user-1' },
      { role: 'assistant', content: 'Good luck! Tell me how it goes.', slices: [], tool_results: [], createdAt: Date.now(), id: 'assistant-1' },
    ]
    await userTurn(hooks, 'turn-1')
    const beforeSend = vi.fn()
    const turnComplete = vi.fn()
    hooks.onBeforeSend(beforeSend)
    hooks.onChatTurnComplete(turnComplete)
    const inFlight = vi.spyOn(observability, 'publishExtractionInFlight')
    const messageCountsDuringExtraction: number[] = []
    chat.stream.mockImplementation(async (_model, _provider, _conversation, options) => {
      messageCountsDuringExtraction.push(chat.state.messages.length)
      await options?.onStreamEvent?.({ type: 'text-delta', text: '{"threads":[{"kind":"event","summary":"He has a job interview tomorrow at nine.","cue":"how the interview went","dueInMinutes":780}],"events":[]}' })
    })
    const recorded = new Promise<ThreadExtractionLedgerEntry>((resolve) => {
      const record = observability.recordExtraction
      vi.spyOn(observability, 'recordExtraction').mockImplementation((entry) => {
        record(entry)
        resolve(entry)
      })
    })

    await vi.advanceTimersByTimeAsync(EXCHANGE_QUIET_MS + 1_000)
    const entry = await recorded

    expect(entry).toMatchObject({ sessionId: 'session-1', status: 'ok', messageCount: 2, threads: [{ kind: 'event', summary: 'He has a job interview tomorrow at nine.' }] })
    expect(chat.stream).toHaveBeenCalledOnce()
    expect(chat.stream.mock.calls[0][0]).toBe('chat-model')
    expect(chat.stream.mock.calls[0][3]).toMatchObject({ origin: 'unprompted', maxTokens: EXTRACTION_MAX_TOKENS })
    expect(inFlight.mock.calls).toEqual([[true], [false]])
    // IS-11: the extraction runs below the chat runtime, so no chat hook fires and the session gains no message.
    expect(beforeSend).not.toHaveBeenCalled()
    expect(turnComplete).not.toHaveBeenCalled()
    expect(messageCountsDuringExtraction).toEqual([2])
    expect(chat.state.messages).toHaveLength(2)
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
    expect(useSituationInnerState().read().threads).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      kind: 'event',
      summary: 'He has a job interview tomorrow at nine.',
      cue: 'how the interview went',
      dueAtMs: entry.atMs + 780 * 60_000,
    })])
  })

  it('drops the threads of an extraction that finishes after its gate run stopped', async () => {
    const { store, hooks, chat, observability } = startQuietLeader()
    chat.state.messages = [{ role: 'user', content: 'I have a job interview tomorrow at nine.', createdAt: Date.now(), id: 'user-1' }]
    await userTurn(hooks, 'turn-1')
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let streamStarted = () => {}
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve
    })
    chat.stream.mockImplementation(async (_model, _provider, _conversation, options) => {
      streamStarted()
      await released
      await options?.onStreamEvent?.({ type: 'text-delta', text: '{"threads":[{"kind":"event","summary":"He has a job interview tomorrow at nine.","cue":"how the interview went","dueInMinutes":null}],"events":[]}' })
    })
    const recorded = new Promise<ThreadExtractionLedgerEntry>((resolve) => {
      const record = observability.recordExtraction
      vi.spyOn(observability, 'recordExtraction').mockImplementation((entry) => {
        record(entry)
        resolve(entry)
      })
    })

    await vi.advanceTimersByTimeAsync(EXCHANGE_QUIET_MS + 1_000)
    await started
    // The gate stops and starts again (a capability flip) while the old run's extraction is still in flight.
    store.setHostCapabilities({ unprompted: false })
    store.setHostCapabilities({ unprompted: true })
    release()
    const entry = await recorded

    expect(entry.status).toBe('ok')
    expect(useSituationInnerState().read().threads).toEqual([])
  })

  it('forgets the threads and read position of a deleted chat session and keeps those of the others', () => {
    const deleted = saveRipeQuestion()
    const kept: Thread = { ...deleted, id: 'thread:question:2', topicKey: 'thread:question:2', sessionId: 'session-2' }
    useSituationInnerState().write({
      threads: [deleted, kept],
      extractedThrough: [{ sessionId: 'session-1', messageId: 'user-1' }, { sessionId: 'session-2', messageId: 'user-2' }],
    }, -1)
    const { store } = startQuietLeader()

    store.forget({ scope: 'sessions', sessionIds: ['session-1'] })

    expect(useSituationInnerState().read()).toMatchObject({ threads: [kept], extractedThrough: [{ sessionId: 'session-2', messageId: 'user-2' }] })
  })

  it('forgets everything when a follower window asks the leader over the speech bus', async () => {
    saveRipeQuestion()
    const { store, observability } = startQuietLeader()
    store.renderForRequest(Date.now())
    expect(observability.renders).toHaveLength(1)

    getSpeechBusContext().emit(situationForgetRequestedEvent, { scope: 'everything' })
    await vi.advanceTimersByTimeAsync(0)

    expect(useSituationInnerState().read()).toMatchObject({ threads: [], extractedThrough: [] })
    expect(observability.renders).toEqual([])
    expect((await observability.inspect()).threads).toEqual([])
  })

  it('clears the stored inner state when a follower forgets everything and no leader runs', () => {
    saveRipeQuestion()
    const { store } = startQuietLeader({ leader: false })

    store.forget({ scope: 'everything' })

    expect(useSituationInnerState().read().threads).toEqual([])
  })

  it('keeps the threads of a late-night exchange past the rollover, until the next logical day ends', async () => {
    // 02:25 on Oct 21 still belongs to the logical day of Oct 20, which rolls over at 04:00 the same morning.
    vi.setSystemTime(new Date(2026, 9, 21, 2, 25, 0))
    const { hooks, chat, observability } = startQuietLeader()
    chat.state.messages = [{ role: 'user', content: 'Still deciding on the green paint, and I move house tomorrow night.', createdAt: Date.now(), id: 'user-1' }]
    await userTurn(hooks, 'turn-1')
    chat.stream.mockImplementation(async (_model, _provider, _conversation, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: JSON.stringify({
        threads: [
          { kind: 'question', summary: 'He is deciding whether to paint his room green.', cue: 'whether he picked the green', dueInMinutes: null },
          { kind: 'event', summary: 'He moves house tomorrow night.', cue: 'how the move went', dueInMinutes: 1320 },
        ],
        events: [],
      }) })
    })
    const recorded = new Promise<ThreadExtractionLedgerEntry>((resolve) => {
      const record = observability.recordExtraction
      vi.spyOn(observability, 'recordExtraction').mockImplementation((entry) => {
        record(entry)
        resolve(entry)
      })
    })

    // The exchange ends at about 02:40, and its threads are extracted then.
    await vi.advanceTimersByTimeAsync(EXCHANGE_QUIET_MS + 1_000)
    const entry = await recorded

    expect(entry.status).toBe('ok')
    const threads = useSituationInnerState().read().threads
    expect(threads.map(thread => thread.kind)).toEqual(['question', 'event'])
    const [question, event] = threads
    // Neither thread expires at this morning's rollover, before it can ripen and be raised.
    expect(question.expiresAtMs).toBeGreaterThan(new Date(2026, 9, 21, 4, 0, 0).getTime())
    expect(question.expiresAtMs).toBeGreaterThan(question.bornAtMs + threadMinAgeMs(question))
    expect(event.expiresAtMs).toBeGreaterThan(event.bornAtMs + threadMinAgeMs(event))
    // The event ripens the next night and is capped where the next logical day ends.
    expect(event.expiresAtMs).toBe(new Date(2026, 9, 22, 4, 0, 0).getTime())
  })

  /** Resolves with the ledger entry of each extraction that settles after `next()` was called, in order. */
  function watchExtractions(observability: ReturnType<typeof useSituationObservabilityStore>) {
    const waiting: ((entry: ThreadExtractionLedgerEntry) => void)[] = []
    const record = observability.recordExtraction
    vi.spyOn(observability, 'recordExtraction').mockImplementation((entry) => {
      record(entry)
      waiting.shift()?.(entry)
    })
    return { next: () => new Promise<ThreadExtractionLedgerEntry>(resolve => waiting.push(resolve)) }
  }

  /** Lets the chat stay quiet until the open exchanges end, and resolves with the next extraction's entry. */
  async function endExchange(extractions: ReturnType<typeof watchExtractions>) {
    const entry = extractions.next()
    await vi.advanceTimersByTimeAsync(EXCHANGE_QUIET_MS + 1_000)
    return await entry
  }

  const INTERVIEW = [said('user', 'user-1', 'I have a job interview tomorrow at nine.'), said('assistant', 'assistant-1', 'Good luck! Tell me how it goes.')]
  const INTERVIEW_TEXT = 'User: I have a job interview tomorrow at nine.\nAiri: Good luck! Tell me how it goes.'
  const SISTER = [said('user', 'user-2', 'My sister visits on Sunday.'), said('assistant', 'assistant-2', 'How fun, what will you do?')]
  const SISTER_TEXT = 'User: My sister visits on Sunday.\nAiri: How fun, what will you do?'

  // ROOT CAUSE:
  // Every extraction read the newest 12 messages of the session, so the extraction after a second exchange read the
  // first one again and stored near-duplicates of its threads (F4 IS-4 gap, F3 manual QA).
  it('reads only the messages after the previous extraction of the same chat session', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    const extractions = watchExtractions(observability)
    chat.stream.mockImplementation(answers('{"threads":[{"kind":"event","summary":"He has a job interview tomorrow at nine.","cue":"how the interview went","dueInMinutes":780}],"events":[]}'))
    chat.state.messages = [...INTERVIEW]
    await userTurn(hooks, 'turn-1')

    // The first extraction of a session reads all of it.
    expect(await endExchange(extractions)).toMatchObject({ status: 'ok', messageCount: 2 })
    expect(extractionInput(chat.stream, 0)).toBe(INTERVIEW_TEXT)

    chat.stream.mockImplementation(answers('{"threads":[],"events":[]}'))
    chat.state.messages.push(...SISTER)
    await userTurn(hooks, 'turn-2')

    expect(await endExchange(extractions)).toMatchObject({ status: 'empty', messageCount: 2 })
    expect(extractionInput(chat.stream, 1)).toBe(SISTER_TEXT)
    expect(useSituationInnerState().read().threads).toHaveLength(1)
  })

  it('keeps the read position of each chat session apart', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    const extractions = watchExtractions(observability)
    chat.stream.mockImplementation(answers('{"threads":[],"events":[]}'))
    const otherSession = [said('user', 'other-1', 'Can you recommend a book?'), said('assistant', 'other-2', 'Try The Left Hand of Darkness.')]
    chat.controls.sessionMessages = sessionId => sessionId === 'session-2' ? otherSession : chat.state.messages
    chat.state.messages = [...INTERVIEW]
    await userTurn(hooks, 'turn-1')
    await endExchange(extractions)

    // The other session has never been extracted, so its first extraction reads all of it.
    await userTurn(hooks, 'turn-2', 'session-2')
    expect(await endExchange(extractions)).toMatchObject({ sessionId: 'session-2', messageCount: 2 })
    expect(extractionInput(chat.stream, 1)).toBe('User: Can you recommend a book?\nAiri: Try The Left Hand of Darkness.')

    // Back in the first session, only its new messages are read.
    chat.state.messages.push(...SISTER)
    await userTurn(hooks, 'turn-3')
    expect(await endExchange(extractions)).toMatchObject({ sessionId: 'session-1', messageCount: 2 })
    expect(extractionInput(chat.stream, 2)).toBe(SISTER_TEXT)
  })

  it('reads the messages of a failed extraction again with the next one', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    const extractions = watchExtractions(observability)
    chat.stream.mockRejectedValueOnce(new Error('503 Service Unavailable'))
    chat.state.messages = [...INTERVIEW]
    await userTurn(hooks, 'turn-1')
    expect(await endExchange(extractions)).toMatchObject({ status: 'failed' })

    chat.stream.mockImplementation(answers('{"threads":[],"events":[]}'))
    chat.state.messages.push(...SISTER)
    await userTurn(hooks, 'turn-2')

    expect(await endExchange(extractions)).toMatchObject({ status: 'empty', messageCount: 4 })
    expect(extractionInput(chat.stream, 1)).toBe(`${INTERVIEW_TEXT}\n${SISTER_TEXT}`)
  })

  it('continues after the messages read before a reload of the leader window', async () => {
    const first = startQuietLeader()
    const firstExtractions = watchExtractions(first.observability)
    first.chat.stream.mockImplementation(answers('{"threads":[],"events":[]}'))
    first.chat.state.messages = [...INTERVIEW]
    await userTurn(first.hooks, 'turn-1')
    await endExchange(firstExtractions)
    first.leadership.set(false)

    // The reloaded window has its own Pinia but the same localStorage; its mind loads her pacing from the card's record.
    const { slow } = first.mind.state
    setActivePinia(createPinia())
    const reloaded = startQuietLeader({ slow })
    const reloadedExtractions = watchExtractions(reloaded.observability)
    reloaded.chat.stream.mockImplementation(answers('{"threads":[],"events":[]}'))
    reloaded.chat.state.messages = [...INTERVIEW, ...SISTER]
    await userTurn(reloaded.hooks, 'turn-2')

    expect(await endExchange(reloadedExtractions)).toMatchObject({ status: 'empty', messageCount: 2 })
    expect(extractionInput(reloaded.chat.stream, 0)).toBe(SISTER_TEXT)
  })

  it('names a web extension page topic by its kind in the unprompted trigger, never by its title or link', async () => {
    const { store, chat, observability } = startQuietLeader()
    store.ingest({ kind: 'notify', sourceKey: 'proj-airi:plugin-web-extension:module-a', eventId: 'video-1', headline: 'User is watching: Secret page', note: 'https://example.test/secret', urgency: 'immediate', reminder: false, provenance: { kind: 'plugin' }, atMs: Date.now() })

    await nextGateTick()

    const topicKey = notifyTopicKey('proj-airi:plugin-web-extension:module-a', 'video-1')
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true, topicKey })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    const payload = chat.submitUnprompted.mock.calls[0][0]
    expect(payload.topicKey).toBe(topicKey)
    expect(payload.topicText.trim()).not.toBe('')
    expect(payload.topicText).not.toMatch(/secret|example\.test/iu)
  })

  it('fires once when the user is quiet, after marking the topic addressed, and then holds new topics for the floor', async () => {
    const { store, chat, observability } = startQuietLeader()
    let addressedBeforeSubmit: number | null | undefined
    const topicKey = offerUrgentTopic()
    chat.submitUnprompted.mockImplementation(async () => {
      addressedBeforeSubmit = store.state.events.find(event => event.topicKey === topicKey)?.addressedAtMs
      return { status: 'spoken', text: 'Still at it?' }
    })

    await nextGateTick()

    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true, reason: 'urgent', topicKey })
    expect(lastEvaluation().decision).toMatchObject({ fire: true, topicText: 'Doorbell' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect(chat.submitUnprompted.mock.calls[0][0]).toMatchObject({ topicKey, topicText: 'Doorbell', reason: { kind: 'notify', category: 'urgent' }, messageId: expect.any(String) })
    expect(addressedBeforeSubmit).toEqual(expect.any(Number))

    // The floor now holds every ordinary topic.
    await vi.advanceTimersByTimeAsync(60 * 1_000)
    offerTopic()
    await nextGateTick()
    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'floor' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
  })

  it('holds while a chat turn is sending', async () => {
    const { chat, observability } = startQuietLeader()
    chat.state.sending = true
    offerUrgentTopic()

    await nextGateTick()

    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'generating' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('never runs in a host without the unprompted capability, nor in a follower', async () => {
    const { chat, observability } = startQuietLeader({ capable: false })
    offerUrgentTopic()
    await vi.advanceTimersByTimeAsync(10 * GATE_INTERVAL_MS)
    expect((await observability.inspect()).urge.decision).toBeNull()
    expect(chat.submitUnprompted).not.toHaveBeenCalled()

    useSituationStore().dispose()
    setActivePinia(createPinia())
    const follower = startQuietLeader({ leader: false })
    useSituationStore().ingest({ kind: 'notify', sourceKey: 'plugin:qa', eventId: 'follower-1', headline: 'Doorbell', urgency: 'immediate', reminder: false, provenance: { kind: 'plugin' }, atMs: Date.now() })
    await vi.advanceTimersByTimeAsync(10 * GATE_INTERVAL_MS)
    expect((await follower.observability.inspect()).urge.decision).toBeNull()
    expect(follower.chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('holds right after promotion, so a new leader eases in instead of speaking up at once', async () => {
    const { chat } = startQuietLeader()
    offerTopic()

    await nextGateTick()

    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'urge' })
    expect(lastEvaluation().decision.trace.multipliers.clear).toBeLessThan(0.05)
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('starts no second turn while one is pending, even before sending turns true', async () => {
    const { chat, observability } = startQuietLeader()
    // The turn is still in preparation: `sending` stays false and no result arrives.
    chat.submitUnprompted.mockImplementation(() => new Promise<ChatUnpromptedResult>(() => {}))
    offerUrgentTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    const firstDecision = (await observability.inspect()).urge.decision

    // New urgent topics for half an hour: nothing is evaluated while the turn is pending.
    for (let minute = 0; minute < 30; minute++) {
      offerUrgentTopic()
      await vi.advanceTimersByTimeAsync(60 * 1_000)
    }
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect((await observability.inspect()).urge.decision).toBe(firstDecision)
  })

  it('evaluates nothing while another caller\'s unprompted turn is pending', async () => {
    const { chat } = startQuietLeader()
    // The mind's first tick at its connection restored the run; nothing is evaluated after it.
    vi.mocked(evaluateUrgeGate).mockClear()
    chat.state.unpromptedPending = true
    offerUrgentTopic()

    await nextGateTick()

    expect(evaluateUrgeGate).not.toHaveBeenCalled()
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('treats a busy result as no fire, so the next topic can go at once', async () => {
    const { chat, observability } = startQuietLeader()
    chat.submitUnprompted.mockResolvedValueOnce({ status: 'failed', error: 'Another unprompted turn is still pending' })
    offerUrgentTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect((await observability.inspect()).urge.memory).toMatchObject({ lastFireAtMs: null, pending: null })

    const next = offerUrgentTopic('Kettle')
    await nextGateTick()

    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true, reason: 'urgent', topicKey: next })
    expect(chat.submitUnprompted).toHaveBeenCalledTimes(2)
  })

  it('names her previous spoken remark in the block, not the topic she is raising now', async () => {
    const { store, hooks, chat } = startQuietLeader()
    const blocks: string[] = []
    chat.submitUnprompted.mockImplementation(async (payload) => {
      // The chat store renders the situation block while it builds the unprompted request.
      blocks.push(store.renderForRequest(Date.now()) ?? '')
      await unpromptedTurnIsSpoken(hooks, payload)
      return { status: 'spoken', text: 'Still at it?' }
    })
    const first = offerUrgentTopic('Doorbell')
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)
    const second = offerUrgentTopic('Oven timer')
    await nextGateTick()

    expect(chat.submitUnprompted.mock.calls.map(([payload]) => payload.topicKey)).toEqual([first, second])
    expect(blocks[0]).not.toContain('You last spoke up on your own')
    expect(blocks[1]).toContain('You last spoke up on your own 10 min ago, about Doorbell.')
    expect(blocks[1]).not.toContain('about Oven timer')
  })

  it('fires nothing about a 1 s lock and unlock', async () => {
    const { store, chat } = startQuietLeader()
    const desktop = useDesktopActivityStore()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)

    desktop.setSnapshot(desktopSample({ locked: true }))
    expect(store.state.presence).toMatchObject({ state: 'away', reason: 'locked' })
    // The producer's own 1 s sample reports the return before the unlock time arrives, as in a live run.
    await vi.advanceTimersByTimeAsync(1_000)
    desktop.setSnapshot(desktopSample({ unlockedAtMs: Date.now() }))
    for (let tick = 0; tick < 3; tick++)
      await nextGateTick()

    expect(store.state.events.map(event => event.topicKey)).toEqual([])
    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'urge' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('never names a declined topic as her last remark', async () => {
    const { store, hooks, chat } = startQuietLeader()
    const blocks: string[] = []
    let declined = ''
    chat.submitUnprompted.mockImplementation(async (payload) => {
      blocks.push(store.renderForRequest(Date.now()) ?? '')
      if (payload.topicKey === declined) {
        await unpromptedTurnIsDeclined(hooks, payload)
        return { status: 'declined' }
      }
      await unpromptedTurnIsSpoken(hooks, payload)
      return { status: 'spoken', text: 'Still at it?' }
    })
    const first = offerUrgentTopic('Doorbell')
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)
    declined = offerUrgentTopic('Oven timer')
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)
    const third = offerUrgentTopic('Cat on the desk')
    await nextGateTick()

    expect(chat.submitUnprompted.mock.calls.map(([payload]) => payload.topicKey)).toEqual([first, declined, third])
    expect(blocks[1]).toContain('about Doorbell.')
    expect(blocks[2]).toContain('You last spoke up on your own')
    expect(blocks[2]).toContain('about Doorbell.')
    expect(blocks[2]).not.toContain('about Oven timer')
    expect(store.state.conversation.lastUnpromptedTopic).toBe('Cat on the desk')
  })

  it('does not count an unprompted turn as the user engaging', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    chat.submitUnprompted.mockImplementation(async (payload) => {
      await unpromptedTurnSpeaks(hooks, payload.messageId!, triggerOf(payload))
      return { status: 'spoken', text: 'Still at it?' }
    })
    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    // The runtime emits onBeforeSend for unprompted turns too; this one must not count as his reply.
    await unpromptedTurnSpeaks(hooks, 'another-unprompted-turn')
    expect(await memoryAtNextTick()).toMatchObject({ unanswered: 1, awaitingSinceMs: expect.any(Number), damp: null })

    // His reply answers the opening; its damping recovers by half every hour.
    await userTurn(hooks, 'user-reply')
    expect(await memoryAtNextTick()).toMatchObject({ unanswered: 0, awaitingSinceMs: null, damp: { depth: 0.5 } })
  })

  it('records a fire as spoken at its first literal, so a reply during her turn counts as his answer', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    // She starts speaking, the user answers mid-reply, and that user send cancels the rest of the turn.
    chat.submitUnprompted.mockImplementation(async (payload) => {
      await unpromptedTurnSpeaks(hooks, payload.messageId!, triggerOf(payload))
      await userTurn(hooks, 'user-reply')
      return { status: 'cancelled' }
    })

    await observability.evaluateGate()
    const memory = await memoryAtNextTick()

    // The reply turned her unanswered opening into damping; a cancelled outcome alone would have left nothing.
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect(memory).toMatchObject({ unanswered: 0, lastSpokenAtMs: expect.any(Number), pending: { spokenAtMs: expect.any(Number) } })
    expect(memory.damp).toMatchObject({ depth: expect.any(Number), sinceMs: expect.any(Number) })
  })

  it('holds while the user speaks, the character speaks, or a composer reports writing in any window', async () => {
    const { chat, observability } = startQuietLeader()
    const bus = getSpeechBusContext()
    offerUrgentTopic()

    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: true })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'user-speaking' })
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: false })

    // Speech-to-text still finishes the message that the user just spoke.
    bus.emit(voiceSnapshotChanged, { connected: true, drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase: 'finalizing', text: 'hello', segments: [] } })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'user-speaking' })
    bus.emit(voiceSnapshotChanged, { connected: true, drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase: 'settled', text: 'hello', segments: [] } })

    bus.emit(voiceTurnsChanged, [{ sessionId: 'session-1', turnId: 'reply-1' }])
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'character-speaking' })
    bus.emit(voiceTurnsChanged, [])

    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: true, lastInputAtMs: Date.now() })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'user-typing' })

    // A composer that stops reporting (its window closed) expires after 15 s.
    await vi.advanceTimersByTimeAsync(16_000)
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
  })

  it('stops counting a voice input once its host ends without reporting, as a crashed window does', async () => {
    const { chat, observability } = startQuietLeader()
    const bus = getSpeechBusContext()
    // The voice host holds this lock while it is connected. The browser releases it with the page, also on a crash.
    const lock = `situation-test-voice-host:${crypto.randomUUID()}`
    const held = Promise.withResolvers<void>()
    const crashed = Promise.withResolvers<void>()
    void navigator.locks.request(lock, () => {
      held.resolve()
      return crashed.promise
    })
    await held.promise
    offerUrgentTopic()

    bus.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', lock, drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase: 'capturing', text: '', segments: [] } })
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: true })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'user-speaking' })

    // The host's renderer crashes mid-capture: no snapshot and no speaking change arrives, only the lock is released.
    crashed.resolve()
    // Lock requests are granted in order, so this one runs after every window that waited for the host to end.
    await navigator.locks.request(lock, () => {})
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true, reason: 'urgent' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
  })

  it('stops counting the character as speaking once the voice host ends mid-speech without reporting', async () => {
    const bus = getSpeechBusContext()
    const lock = `situation-test-voice-host:${crypto.randomUUID()}`
    const held = Promise.withResolvers<void>()
    const crashed = Promise.withResolvers<void>()
    void navigator.locks.request(lock, () => {
      held.resolve()
      return crashed.promise
    })
    await held.promise
    // The audio host runs in another window, which connected before this leader started, and it is speaking a reply.
    const stopHost = [
      bus.on(voiceRequestSnapshot, () => bus.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', lock, drafts: [] })),
      bus.on(voiceRequestTurns, () => bus.emit(voiceTurnsChanged, [{ sessionId: 'session-1', turnId: 'reply-1' }])),
    ]
    try {
      const { chat, observability } = startQuietLeader()
      offerUrgentTopic()
      await nextGateTick()
      expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'character-speaking' })

      // The host's renderer crashes mid-speech: no turns change arrives, only the lock is released.
      crashed.resolve()
      // Lock requests are granted in order, so this one runs after every window that waited for the host to end.
      await navigator.locks.request(lock, () => {})
      await nextGateTick()
      expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true, reason: 'urgent' })
      expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    }
    finally {
      stopHost.forEach(stop => stop())
    }
  })

  it('holds while the stage is hidden and eases in again after it is shown', async () => {
    const { store, chat, observability } = startQuietLeader()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)
    expect(lastEvaluation().decision.trace.multipliers.clear).toBeGreaterThan(0.9)
    store.setStageVisible(false)
    offerTopic()
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'stage-hidden' })

    store.setStageVisible(true)
    await nextGateTick()

    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'urge' })
    expect(lastEvaluation().decision.trace.multipliers.clear).toBeLessThan(0.05)
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('stays quiet when behavior settings say so', async () => {
    const { chat, observability } = startQuietLeader()
    const settings = useCharacterBehaviorSettings()
    offerUrgentTopic()

    await settings.update({ speaking: { unpromptedEnabled: false } })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'disabled' })

    await settings.update({ speaking: { unpromptedEnabled: true, dontDisturb: true } })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'dont-disturb' })

    await settings.update({ speaking: { dontDisturb: false, quietApps: ['notepad.exe'] } })
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'quiet-app' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it.each([
    ['zed.exe', 'zed.app', 'zed', false],
    ['zed.app.exe', 'zed.app', 'zed.app', true],
    ['zed.app', 'zed.app.exe', 'zed.app', true],
    ['mystery.app', 'mystery', 'mystery.app', false],
    ['zed.exe', 'z*.APP', 'zed', false],
  ])('preserves Windows quiet matching for %s against %s', async (exeName, pattern, appId, quiet) => {
    const { store, observability } = startQuietLeader({
      foreground: () => foregroundSample({ exePath: `C:\\Tools\\${exeName}`, exeName, title: 'Draft' }),
    })
    await useCharacterBehaviorSettings().update({ speaking: { quietApps: [pattern] } })
    offerTopic()

    const evaluation = await observability.evaluateGate()

    expect(store.state.activity).toMatchObject({ appId, category: 'other' })
    expect(evaluation).toMatchObject({
      status: 'evaluated',
      decision: quiet ? { fire: false, reason: 'quiet-app' } : { fire: true },
    })
  })

  it.each(['zoom.us.exe', 'Microsoft Teams.exe', 'FaceTime.exe', 'zoom.us.app.exe', 'FaceTime.app'])(
    'does not add a default Windows quiet match for %s',
    async (exeName) => {
      const { observability } = startQuietLeader({
        foreground: () => foregroundSample({ exePath: `C:\\Tools\\${exeName}`, exeName, title: 'Draft' }),
      })
      offerTopic()

      expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
    },
  )

  it('shows mood 1 in the gate trace while the character store has no reading', async () => {
    const { observability } = startQuietLeader()
    offerTopic()
    expect(useCharacterStateStore().reading).toBeNull()

    const evaluation = await observability.evaluateGate()

    expect(lastEvaluation().input.moodFactor).toBe(1)
    expect(evaluation).toMatchObject({ status: 'evaluated', decision: { trace: { multipliers: { mood: 1 } } } })
  })

  it('passes the reading urge factor of a sulky character into the gate trace', async () => {
    const { observability } = startQuietLeader()
    offerTopic()
    const context = characterStateContext(Date.now())
    const resting = readCharacter(initialCharacterState('default', DEFAULT_CHARACTER_PROFILE, context), DEFAULT_CHARACTER_PROFILE, null, context)
    useCharacterStateStore().replicated = {
      cardId: 'default',
      reading: { ...resting, urgeFactor: 0.8 },
      revision: 1,
      updatedAtMs: Date.now(),
    }

    const evaluation = await observability.evaluateGate()

    expect(lastEvaluation().input.moodFactor).toBe(0.8)
    expect(evaluation).toMatchObject({ status: 'evaluated', decision: { trace: { multipliers: { mood: 0.8 } } } })
    // The forced fire's line settles before the next evaluation.
    await vi.advanceTimersByTimeAsync(0)
    useCharacterStateStore().replicated = { cardId: null, reading: null, revision: 2, updatedAtMs: Date.now() }
    await observability.evaluateGate()
    expect(lastEvaluation().input.moodFactor).toBe(1)
  })

  it.each([
    ['notepad.exe', 'notepad.exe', 'notepad'],
    ['Mystery Notes.app', '  mystery notes.app  ', 'mystery notes'],
    ['Mystery Notes.APP', 'MYSTERY*.APP', 'mystery notes'],
    ['Mystery Notes.app', 'mystery notes', 'mystery notes'],
  ])('matches quiet-app glob %s through the foreground sample and gate', async (exeName, pattern, appId) => {
    vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
    vi.stubGlobal('window', { electron: {}, platform: 'darwin' })
    const { store, chat, observability } = startQuietLeader({
      foreground: () => foregroundSample({ exePath: `/Applications/${exeName}`, exeName, title: 'Draft' }),
    })
    await useCharacterBehaviorSettings().update({ speaking: { quietApps: [pattern] } })
    offerTopic()

    const evaluation = await observability.evaluateGate()

    expect(store.state.activity).toMatchObject({ appId, category: 'other' })
    expect(evaluation).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'quiet-app' } })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
    await useCharacterBehaviorSettings().update({ speaking: { quietApps: [] } })
    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
  })

  it('stops suppressing for a game once its foreground samples go stale', async () => {
    const game = { exePath: 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe', exeName: 'Hades.exe', title: 'Hades' }
    let producing = true
    const { store, chat, observability } = startQuietLeader({ foreground: () => producing ? foregroundSample(game) : null })
    await useCharacterBehaviorSettings().update({ speaking: { speakDuringGames: false } })
    offerTopic()
    await nextGateTick()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'busy-game' })

    producing = false
    await vi.advanceTimersByTimeAsync(FOREGROUND_SAMPLE_STALE_VISIBLE_MS + GATE_INTERVAL_MS)

    // The reducer keeps the game as the session's last activity, but the stale sample that expired the category also
    // holds the gate as stale, before any check of the activity, so the old game never suppresses on its own.
    expect(store.state.activity?.category).toBe('game')
    expect(store.foregroundCategory).toBeNull()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'stale-signal' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('holds as stale while foreground sharing is off, even when a sample is still fresh', async () => {
    const { chat, observability } = startQuietLeader()
    const settings = useSituationSettings()
    offerUrgentTopic()

    await settings.update({ shareForegroundWindow: false })
    await nextGateTick()

    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: false, reason: 'stale-signal' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()

    await settings.update({ shareForegroundWindow: true })
    await nextGateTick()

    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true })
    expect(chat.submitUnprompted).toHaveBeenCalledTimes(1)
  })

  it('stops the gate on demotion and drops the result of a turn from the earlier leadership', async () => {
    const { leadership, chat, observability } = startQuietLeader()
    let finish!: (result: ChatUnpromptedResult) => void
    chat.submitUnprompted.mockImplementation(() => new Promise<ChatUnpromptedResult>((resolve) => {
      finish = resolve
    }))
    await observability.evaluateGate()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    leadership.set(false)
    finish({ status: 'spoken', text: 'Still at it?' })
    leadership.set(true)
    await nextGateTick()

    // The new leadership starts from promotion memory with the saved social slice; the old spoken result is in neither.
    expect(lastEvaluation().memoryBefore).toMatchObject({ pending: null, fires: [], unanswered: 0, lastSpokenAtMs: null })
    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
    expect(lastEvaluation().memory.fires).toHaveLength(1)
  })

  it('evaluates now through the leader, skipping only the timing guards', async () => {
    const { chat, observability } = startQuietLeader()
    const topicKey = offerTopic()
    await nextGateTick()
    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'urge' })

    const evaluation = await observability.evaluateGate()

    expect(evaluation).toMatchObject({ status: 'evaluated', decision: { fire: true, reason: 'forced', topicKey, trace: { forceTiming: true } } })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect(chat.submitUnprompted.mock.calls[0][0]).toMatchObject({ topicKey, reason: { kind: 'notify', category: 'open' } })
    expect((await observability.inspect()).urge.history[0]).toMatchObject({ fire: true, reason: 'forced', topicKey, count: 1 })
  })

  it('keeps every hard suppressor when evaluating now', async () => {
    const { chat, observability } = startQuietLeader()
    offerTopic()
    await useCharacterBehaviorSettings().update({ speaking: { dontDisturb: true } })

    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'dont-disturb', trace: { forceTiming: true } } })
    chat.state.sending = true
    await useCharacterBehaviorSettings().update({ speaking: { dontDisturb: false } })
    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'generating' } })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('reports an evaluation as skipped while an unprompted turn is pending, and publishes memory changes between ticks', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    let finish!: (result: ChatUnpromptedResult) => void
    chat.submitUnprompted.mockImplementation(async (payload) => {
      await unpromptedTurnSpeaks(hooks, payload.messageId!, triggerOf(payload))
      return new Promise<ChatUnpromptedResult>((resolve) => {
        finish = resolve
      })
    })
    offerUrgentTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    expect(await observability.evaluateGate()).toEqual({ status: 'skipped', reason: 'unprompted-pending' })
    // The fire was spoken after the decision was recorded; the current memory says so, the decision's does not.
    expect(lastEvaluation().memory.pending?.spokenAtMs).toBeNull()
    expect((await observability.inspect()).urge.memory?.pending?.spokenAtMs).toEqual(expect.any(Number))
    finish({ status: 'spoken', text: 'Still at it?' })
  })

  it('answers evaluation as skipped once the gate stops on demotion', async () => {
    const { leadership, observability } = startQuietLeader()
    leadership.set(false)

    expect(await observability.evaluateGate()).toEqual({ status: 'skipped', reason: 'gate-not-running' })
  })
  // Pinned before the urge rewrite. Covered by name elsewhere: the leader-only loop ("never runs in a host without
  // the unprompted capability, nor in a follower"), one pending turn ("starts no second turn while one is pending"),
  // and the widget turn, driven through the real chat store in chat.contract.test.ts.

  it('restores the memory from before the fire when the unprompted turn loses the busy race', async () => {
    const { chat, observability } = startQuietLeader()
    chat.submitUnprompted.mockResolvedValueOnce({ status: 'failed', error: 'Another unprompted turn is still pending' })
    offerTopic()
    const before = (await observability.inspect()).urge.memory

    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
    await vi.advanceTimersByTimeAsync(0)

    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect((await observability.inspect()).urge.decision).toMatchObject({ fire: true })
    // The decision recorded the fire; the rollback took back its floor slot, its cap slot, and its pending entry.
    expect(before).not.toBeNull()
    expect((await observability.inspect()).urge.memory).toMatchObject({ lastFireAtMs: before?.lastFireAtMs, fires: before?.fires, pending: null })
  })

  it('restores the urge, its threshold, and the random state when the turn loses the busy race', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    // One spoken opening, then five minutes of continuation hazard, so the urge and the reply clock both run.
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    const before = lastEvaluation().memory
    expect(before).toMatchObject({ unanswered: 1, damp: null })
    expect(before.urge).toBeGreaterThan(0)
    // His reply lands while her follow-up waits for the chat; the rollback must keep it.
    chat.submitUnprompted.mockImplementationOnce(async () => {
      await userTurn(hooks, 'user-reply')
      return { status: 'failed', error: 'Another unprompted turn is still pending' }
    })

    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: true } })
    expect(lastEvaluation().memory).toMatchObject({ urge: 0, lastFireAtMs: Date.now() })
    const restored = await memoryAtNextTick()

    expect(restored).toMatchObject({
      urge: before.urge,
      urgeThreshold: before.urgeThreshold,
      lastFireAtMs: before.lastFireAtMs,
      fires: before.fires,
      pending: before.pending,
      doubleText: before.doubleText,
      unanswered: 0,
      damp: { depth: 0.5 },
    })
  })

  it('starts the floor after a widget line speaks, without counting it as an unanswered opening', async () => {
    const { store, hooks, chat } = startQuietLeader()
    await nextGateTick()
    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'urge' })
    chat.submitUnprompted.mockImplementationOnce(async (payload) => {
      await unpromptedTurnIsSpoken(hooks, payload)
      return { status: 'spoken', text: 'Nice move' }
    })

    // A widget reaction is a line the mind let through, not a fire of the gate.
    const result = await store.requestVoice({ turnId: 'spark:widget-1', topicKey: 'notify:plugin:widget:evt-1', topicText: 'Nice move', supplement: null, timeoutMs: 30_000 })
    const spokeAtMs = Date.now()
    expect(result).toEqual({ status: 'spoken', text: 'Nice move' })
    expect(chat.submitUnprompted.mock.calls[0][0]).toMatchObject({ widget: true, messageId: 'spark:widget-1', topicKey: 'notify:plugin:widget:evt-1' })
    await nextGateTick()

    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'floor' })
    expect(lastEvaluation().memoryBefore).toMatchObject({ lastFireAtMs: spokeAtMs, lastSpokenAtMs: spokeAtMs, unanswered: 0, pending: null })
    expect(useSituationInnerState().read().gate).toEqual({ lastFireAtMs: spokeAtMs, day: expect.any(Object) })

    await vi.advanceTimersByTimeAsync(FLOOR_MS)
    expect(lastEvaluation().decision).toMatchObject({ fire: false, reason: 'urge' })
  })

  it.each([
    ['declined', 'declined'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['busy-rejected', 'busy'],
  ] as const)('leaves a thread eligible after a %s attempt, and raises it exactly once when a later turn speaks', async (_label, outcome) => {
    const thread = saveRipeQuestion()
    const { hooks, chat, observability } = startQuietLeader({ slow: ownDayJustNow() })
    chat.submitUnprompted.mockImplementationOnce(async (payload) => {
      if (outcome === 'declined') {
        await unpromptedTurnIsDeclined(hooks, payload)
        return { status: 'declined' }
      }
      if (outcome === 'busy')
        return { status: 'failed', error: 'Another unprompted turn is still pending' }
      return outcome === 'failed' ? { status: 'failed', error: 'provider down' } : { status: 'cancelled' }
    })

    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(chat.submitUnprompted.mock.calls[0][0].topicKey).toBe(thread.topicKey)
    expect(useSituationInnerState().read().threads).toEqual([thread])

    chat.submitUnprompted.mockImplementationOnce(async (payload) => {
      await unpromptedTurnIsSpoken(hooks, payload)
      return { status: 'spoken', text: 'How did it go?' }
    })
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)

    expect(chat.submitUnprompted.mock.calls[1][0].topicKey).toBe(thread.topicKey)
    // Raised once, the thread leaves the store; his reply ends the continuation window, so nothing is left to open with.
    expect(useSituationInnerState().read().threads).toEqual([])
    await userTurn(hooks, 'user-reply')
    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'no-topic' } })
    expect(chat.submitUnprompted).toHaveBeenCalledTimes(2)
  })

  it('records the urge decision, the open threads, and the outcome per reason kind in the inspector', async () => {
    const thread = saveRipeQuestion()
    const { hooks, chat, observability } = startQuietLeader({ slow: ownDayJustNow() })
    chat.submitUnprompted.mockImplementationOnce(async (payload) => {
      await unpromptedTurnIsDeclined(hooks, payload)
      return { status: 'declined' }
    })

    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)

    const declined = await observability.inspect()
    expect(declined.urge.decision).toMatchObject({ fire: true, reason: 'forced', topicKey: thread.topicKey })
    expect(declined.urge.trace?.pick).toMatchObject({ reasonKey: thread.topicKey })
    expect(declined.reasons.map(reason => reason.key)).toContain(thread.topicKey)
    expect(declined.threads).toEqual([thread])
    expect(declined.outcomes['thread-question']).toMatchObject({ spoken: 0, declined: 1 })

    chat.submitUnprompted.mockImplementationOnce(async (payload) => {
      await unpromptedTurnIsSpoken(hooks, payload)
      return { status: 'spoken', text: 'How did it go?' }
    })
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    await userTurn(hooks, 'user-reply')

    const spoken = await observability.inspect()
    // Spoken once, counted when her first literal arrived, and engaged by his reply.
    expect(spoken.outcomes['thread-question']).toEqual({ spoken: 1, declined: 1, cancelled: 0, failed: 0, engaged: 1, ignored: 0 })
    expect(spoken.threads).toEqual([])
    expect(spoken.urge.memory).toMatchObject({ unanswered: 0 })
  })

  it('restores the ritual day and the threads after a reload of the leader window, and her pacing from the mind\'s slow state', async () => {
    vi.setSystemTime(MORNING)
    const thread = saveRipeQuestion()
    const first = startQuietLeader()
    // At her first sight of him this morning the only reason is the greeting: she says good morning.
    await first.observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(first.chat.submitUnprompted.mock.calls[0][0]).toMatchObject({ topicKey: 'ritual:greeting', reason: { kind: 'ritual-greeting', category: 'ritual' } })
    first.leadership.set(false)

    // The reloaded window has its own Pinia but the same localStorage; its mind loads her pacing from the card's record.
    const { slow } = first.mind.state
    setActivePinia(createPinia())
    const reloaded = startQuietLeader({ slow })
    await nextGateTick()

    const { memoryBefore, input, decision } = lastEvaluation()
    expect(memoryBefore).toMatchObject({ unanswered: 1, lastSpokenAtMs: MORNING, day: { dayKey: '2026-10-20', states: { greeting: 'done' } } })
    expect(input.reasons.threads.threads).toEqual([thread])
    expect(decision.trace.reasons.map(reason => reason.key)).not.toContain('ritual:greeting')
    // One unanswered opening allows only a short continuation; a second greeting never comes.
    await reloaded.observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(reloaded.chat.submitUnprompted.mock.calls.map(([payload]) => payload.topicKey)).not.toContain('ritual:greeting')
  })

  it('does not greet twice when the leader stops and starts again on the same storage', async () => {
    vi.setSystemTime(MORNING)
    const { leadership, chat, observability } = startQuietLeader()
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(chat.submitUnprompted.mock.calls.map(([payload]) => payload.topicKey)).toEqual(['ritual:greeting'])

    leadership.set(false)
    leadership.set(true)
    await nextGateTick()

    expect(lastEvaluation().decision.trace.rituals?.states.greeting).toBe('done')
    for (let attempt = 0; attempt < 3; attempt++) {
      await observability.evaluateGate()
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(chat.submitUnprompted.mock.calls.filter(([payload]) => payload.topicKey === 'ritual:greeting')).toHaveLength(1)
  })

  it('starts a new ritual day at the logical day rollover', async () => {
    vi.setSystemTime(MORNING)
    const { observability } = startQuietLeader()
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    await nextGateTick()
    expect(lastEvaluation().decision.trace.rituals).toMatchObject({ dayKey: '2026-10-20', states: { greeting: 'done' } })

    vi.setSystemTime(MORNING + 24 * HOUR_MS)
    await nextGateTick()

    expect(lastEvaluation().decision.trace.rituals).toMatchObject({ dayKey: '2026-10-21', states: { 'greeting': 'open', 'sign-off': 'open', 'welcome-back': 'open' } })
    expect(useSituationInnerState().read().gate?.day).toMatchObject({ dayKey: '2026-10-21', states: { greeting: 'open' } })
  })

  it('drops a tick while no mind is connected, and answers "Evaluate now" with no-mind', async () => {
    const { chat, observability, disconnect } = startQuietLeader()
    disconnect()
    vi.mocked(evaluateUrgeGate).mockClear()
    offerUrgentTopic()
    const saved = localStorage.getItem('settings/situation-inner')
    const decision = (await observability.inspect()).urge.decision

    await vi.advanceTimersByTimeAsync(5 * GATE_INTERVAL_MS)

    expect(await observability.evaluateGate()).toEqual({ status: 'skipped', reason: 'no-mind' })
    expect(evaluateUrgeGate).not.toHaveBeenCalled()
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
    expect(localStorage.getItem('settings/situation-inner')).toBe(saved)
    expect((await observability.inspect()).urge.decision).toBe(decision)
  })

  it('lets a reconnecting mind keep the fires of the run, and the newest connection win', async () => {
    const { store, chat, observability, mind, disconnect } = startQuietLeader()
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    const fires = mind.state.voice.gate?.fires
    expect(fires).toHaveLength(1)

    // A remount: the old stage disconnects after the new one connected, which keeps the new connection.
    const remounted = connectMind(store, SEED + 1)
    disconnect()
    await nextGateTick()

    expect(remounted.mind.state.voice.gate?.fires).toEqual(fires)
    expect(remounted.mind.state.voice.gate?.pending).toBeNull()
    expect(mind.state.voice.gate?.fires).toEqual(fires)
    expect(lastEvaluation().memoryBefore.fires).toEqual(fires)
  })

  it('sends a user turn that arrived without a mind once the next mind restored its gate memory', async () => {
    const { store, hooks, observability, mind, disconnect } = startQuietLeader()
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    expect(mind.state.voice.gate).toMatchObject({ unanswered: 1, damp: null })
    disconnect()

    await userTurn(hooks, 'user-reply')
    // A reloaded mind carries her pacing in its slow state.
    const remounted = connectMind(store, SEED, mind.state.slow)
    await nextGateTick()

    expect(remounted.mind.state.voice.gate).toMatchObject({ unanswered: 0, damp: { depth: 0.5 } })
  })

  it('keeps the next mind\'s ease-in from its restore when it receives a user turn held from minutes before', async () => {
    const { store, hooks, disconnect } = startQuietLeader()
    disconnect()
    await userTurn(hooks, 'user-reply')

    await vi.advanceTimersByTimeAsync(3 * 60 * 1_000)
    const connectedAtMs = Date.now()
    const next = connectMind(store, SEED)

    expect(next.mind.state.voice.gate).toMatchObject({ lastHardHoldAtMs: connectedAtMs, lastEvalAtMs: connectedAtMs })
  })

  it('starts a new run at "Delete all data": the mind forgets the user\'s floor, fires, and saved slice', async () => {
    const { store, observability, mind } = startQuietLeader()
    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(useSituationInnerState().read().gate).toMatchObject({ lastFireAtMs: T0 })

    store.forget({ scope: 'everything' })
    await nextGateTick()

    // Her pacing goes with the character state, whose reset reloads the mind (see the character mind store).
    expect(mind.state.voice.gate).toMatchObject({ fires: [], lastFireAtMs: null, pending: null })
    expect(useSituationInnerState().read().gate).toMatchObject({ lastFireAtMs: null })
  })

  it('seeds the run\'s user slice from the saved one without fires at promotion, and follows each publish', async () => {
    const inner = useSituationInnerState()
    inner.claim(-1)
    inner.read()
    inner.write({ gate: { lastFireAtMs: T0 - HOUR_MS, day: null } }, -1)
    // The gate starts once this test's mind is connected, so the mind sees the promotion's run.
    const { store, observability, disconnect } = startQuietLeader({ capable: false })
    disconnect()
    const mind = new CharacterMind({ seed: SEED })
    const voice = new MindVoice(mind, () => store, () => {})
    const runs: VoiceRun[] = []
    store.connect((stimulus) => {
      if (stimulus.kind === 'voice-tick')
        runs.push(stimulus.view.run)
      voice.answer(stimulus)
    })
    store.setHostCapabilities({ unprompted: true })
    expect(runs[0].user).toEqual({ lastFireAtMs: T0 - HOUR_MS, fires: [], day: null })

    await observability.evaluateGate()
    await vi.advanceTimersByTimeAsync(0)
    await nextGateTick()

    expect(runs.at(-1)?.user?.fires).toHaveLength(1)
    expect(runs.at(-1)?.user).toEqual(userGateMemoryOf(mind.state.voice.gate!))
  })

  function poke(): TouchObservation {
    return { kind: 'touch', gesture: 'poke', region: 'head', atMs: Date.now() }
  }

  /** Pokes `count` times, one second apart, as the stage reports them, and returns the view of the last poke. */
  async function pokeTimes(store: ReturnType<typeof useSituationStore>, count: number) {
    let view = store.observeTouch(poke())
    for (let index = 1; index < count; index++) {
      await vi.advanceTimersByTimeAsync(1_000)
      view = store.observeTouch(poke())
    }
    return view
  }

  /** Pokes three times and returns the protest line the mind would decide about the burst. */
  async function protest(store: ReturnType<typeof useSituationStore>) {
    const view = await pokeTimes(store, 3)
    const eventId = view?.eventId ?? ''
    return { turnId: reactionTurnId(eventId), line: { kind: 'reaction', reaction: 'poke-protest', eventId } satisfies VoiceLine }
  }

  function touchEvent(store: ReturnType<typeof useSituationStore>) {
    return store.state.events.find(event => event.topicKey === TOUCH_TOPIC_KEY)
  }

  async function reactionOutcomes(observability: ReturnType<typeof useSituationObservabilityStore>) {
    return (await observability.inspect()).reactions.outcomes['poke-protest']
  }

  /** The hook context of a reaction turn, as the chat store starts it. */
  function reactionContext(payload: ChatReactionPayload): ChatStreamEventContext {
    const turnId = `reaction:${payload.eventId}`
    const trigger = { topicKey: TOUCH_TOPIC_KEY, text: payload.topicText, kind: payload.kind === 'poke-protest' ? 'touch-poke' : 'touch-pet' }
    return { sessionId: 'session-1', turnId, origin: 'unprompted', message: { role: 'user', content: `(Just now, on the stage: they ${payload.topicText})`, createdAt: Date.now(), id: turnId, trigger }, contexts: {}, composedMessage: [] }
  }

  it('records each touch and returns the voice view of a 3-poke burst', async () => {
    const { store } = startQuietLeader()

    const view = await pokeTimes(store, 3)

    expect(view).toEqual({
      sessionId: 'session-1',
      eventId: touchEvent(store)?.id,
      pet: null,
      pokeTimesMs: [Date.now() - 2_000, Date.now() - 1_000, Date.now()],
      lastCharacterLineAtMs: null,
      held: null,
    })
  })

  it('reports in the view why the voice channel cannot take a line', async () => {
    const { store, chat } = startQuietLeader()
    chat.state.sending = true

    expect(await pokeTimes(store, 3)).toMatchObject({ held: 'generating' })
  })

  it('speaks a reaction about the touch event and marks the event shown', async () => {
    const { store, chat, observability } = startQuietLeader()
    const { turnId, line } = await protest(store)

    await expect(store.speak(turnId, line)).resolves.toBe('spoken')

    expect(chat.submitReaction).toHaveBeenCalledOnce()
    expect(chat.submitReaction).toHaveBeenCalledWith({ kind: 'poke-protest', topicText: 'poked you 3 times in a few seconds', eventId: line.eventId })
    // The trigger message carries the touch, so the block of the reaction's own request does not list it again.
    expect(touchEvent(store)?.shownAtMs).toBe(Date.now())
    expect(await reactionOutcomes(observability)).toEqual({ spoken: 1, declined: 0, cancelled: 0, failed: 0, refused: 0 })
  })

  it('refuses a reaction while another unprompted turn is pending, without sending or showing the touch', async () => {
    const { store, chat, observability } = startQuietLeader()
    const { turnId, line } = await protest(store)
    // Another unprompted turn is pending, so the store does not even submit.
    chat.state.unpromptedPending = true

    await expect(store.speak(turnId, line)).resolves.toBe('refused')

    expect(chat.submitReaction).not.toHaveBeenCalled()
    expect(touchEvent(store)?.shownAtMs).toBeNull()

    // The chat's own pending guard refuses the next attempt.
    chat.state.unpromptedPending = false
    chat.submitReaction.mockResolvedValueOnce({ status: 'failed', error: 'Another unprompted turn is still pending' })

    await expect(store.speak(turnId, line)).resolves.toBe('refused')

    expect(chat.submitReaction).toHaveBeenCalledOnce()
    expect(await reactionOutcomes(observability)).toEqual({ spoken: 0, declined: 0, cancelled: 0, failed: 0, refused: 2 })
  })

  it('starts the gate floor on a spoken reaction without an unanswered opening or a fire outcome', async () => {
    const { store, hooks, chat, observability, voice } = startQuietLeader()
    chat.submitReaction.mockImplementationOnce(async (payload) => {
      const context = reactionContext(payload)
      const output = { role: 'assistant' as const, content: 'Hey, quit it!', slices: [], tool_results: [] }
      await hooks.emitBeforeSendHooks('(Just now, on the stage)', context)
      await hooks.emitTokenLiteralHooks('Hey, quit it!', context)
      await hooks.emitAssistantMessageHooks(output, 'Hey, quit it!', context)
      await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Hey, quit it!', toolCalls: [] }, context)
      return { status: 'spoken', text: 'Hey, quit it!' }
    })
    const { turnId, line } = await protest(store)
    const spokenAtMs = Date.now()

    // The mind speaks the line and hears its outcome.
    await voice.speak({ id: 'touch-speak', cause: 0, channel: 'voice', kind: 'speak', turnId, line })

    expect(await memoryAtNextTick()).toMatchObject({ lastFireAtMs: spokenAtMs, lastSpokenAtMs: spokenAtMs, unanswered: 0 })
    expect(recordUrgeFireOutcome).not.toHaveBeenCalled()
    // Her line counts only as her last line: it is no unprompted remark, and the touch is never addressed.
    expect(store.state.conversation).toMatchObject({ lastCharacterAtMs: spokenAtMs, lastUnpromptedAtMs: null })
    expect(store.state.tracking.addressedTopic).toBeNull()
    expect(await reactionOutcomes(observability)).toEqual({ spoken: 1, declined: 0, cancelled: 0, failed: 0, refused: 0 })
  })

  it('starts the gate floor and the touch refractory for a reaction that speaks after the store stopped tracking it', async () => {
    const { store, hooks, mind } = startQuietLeader()
    const { line } = await protest(store)
    const spokenAtMs = Date.now()

    // The turn started under an earlier leadership of this window, so no line of this store runs it.
    await hooks.emitTokenLiteralHooks('Hey, quit it!', reactionContext({ kind: line.reaction, topicText: 'poked her', eventId: line.eventId }))

    expect(await memoryAtNextTick()).toMatchObject({ lastFireAtMs: spokenAtMs, lastSpokenAtMs: spokenAtMs, unanswered: 0 })
    expect(mind.state.voice.reaction.lastLineAtMs).toBe(spokenAtMs)
  })

  it('resolves a reaction at its first literal, before the submit result arrives', async () => {
    const { store, hooks, chat } = startQuietLeader()
    chat.submitReaction.mockImplementationOnce(() => new Promise<ChatUnpromptedResult>(() => {}))
    const { turnId, line } = await protest(store)
    const spoken = store.speak(turnId, line)
    const context = reactionContext(chat.submitReaction.mock.calls[0][0])
    await hooks.emitBeforeSendHooks('(Just now, on the stage)', context)

    await hooks.emitTokenLiteralHooks('Hey, quit it!', context)

    await expect(spoken).resolves.toBe('spoken')
  })

  it('resolves a declined reaction at its stream end, before the submit result arrives', async () => {
    const { store, hooks, chat, observability } = startQuietLeader()
    let finish!: (result: ChatUnpromptedResult) => void
    chat.submitReaction.mockImplementationOnce(() => new Promise<ChatUnpromptedResult>((resolve) => {
      finish = resolve
    }))
    const { turnId, line } = await protest(store)
    const declined = store.speak(turnId, line)
    const context = reactionContext(chat.submitReaction.mock.calls[0][0])
    await hooks.emitBeforeSendHooks('(Just now, on the stage)', context)

    await hooks.emitStreamEndHooks({ ...context, cueStats: { act: 0, recovered: 0, rejected: 0, origin: 'unprompted', declined: true, silent: false, wordless: false, breaks: 0, breaksIgnored: 0 } })

    await expect(declined).resolves.toBe('declined')
    expect(await reactionOutcomes(observability)).toEqual({ spoken: 0, declined: 1, cancelled: 0, failed: 0, refused: 0 })
    expect(recordUrgeFireOutcome).not.toHaveBeenCalled()
    expect(store.state.tracking.addressedTopic).toBeNull()

    // The result that arrives afterwards counts no second outcome.
    finish({ status: 'declined' })
    await vi.advanceTimersByTimeAsync(0)

    expect(await reactionOutcomes(observability)).toEqual({ spoken: 0, declined: 1, cancelled: 0, failed: 0, refused: 0 })
  })

  it('lists a touch once in the situation block and omits it from the next render', () => {
    const { store } = startQuietLeader({ capable: false })
    store.ingest({ kind: 'touch', gesture: 'pet', region: 'head', atMs: Date.now(), durationMs: 4_000 })

    expect(store.renderForRequest(Date.now())).toContain('New: petted your head for about 4 s (just now)')
    expect(touchEvent(store)?.shownAtMs).toBe(Date.now())
    expect(store.renderForRequest(Date.now())).not.toContain('petted your head')
  })

  it('offers no voice view and speaks no reaction in a follower window', async () => {
    const { store, chat } = startQuietLeader({ leader: false })

    expect(await pokeTimes(store, 3)).toBeNull()

    expect(store.state).toEqual(initialSituationState)
    await expect(store.speak(reactionTurnId('touch-1'), { kind: 'reaction', reaction: 'poke-protest', eventId: 'touch-1' })).resolves.toBe('failed')
    expect(chat.submitReaction).not.toHaveBeenCalled()
  })

  it('records the touch but offers no voice view while the gate does not run', () => {
    const { store } = startQuietLeader({ capable: false })

    expect(store.observeTouch(poke())).toBeNull()
    expect(touchEvent(store)).toBeDefined()
  })
})
