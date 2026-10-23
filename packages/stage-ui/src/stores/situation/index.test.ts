import type { ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { ActivityObservation, ContextObservation, NotifyObservation, WakeObservation } from '@proj-airi/stage-shared/situation'
import type { ForegroundWindowSample } from '@proj-airi/stage-shared/stores/foreground-window'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { SituationChatControls } from '.'
import type { ChatUnpromptedPayload, ChatUnpromptedResult } from '../chat'

import { createChatHooks } from '@proj-airi/core-agent'
import { initialSituationState, SETTLE_MS } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GATE_INTERVAL_MS, useSituationStore } from '.'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useSituationSettings } from '../../features/situation/settings'
import { chatComposerActivityChangedEvent, getSpeechBusContext, speechInputUserSpeakingChangedEvent, voiceSnapshotChanged, voiceTurnsChanged } from '../../services/speech/bus'
import { useSituationObservabilityStore } from '../devtools/situation-observability'
import { DESKTOP_SAMPLE_STALE_MS } from './sensors/desktop'
import { FOREGROUND_SAMPLE_STALE_HIDDEN_MS, FOREGROUND_SAMPLE_STALE_VISIBLE_MS } from './sensors/foreground'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

/** A synced runtime whose leadership the test flips. It reports the current role on subscribe, like the plugin. */
function createLeadership(initiallyLeader: boolean) {
  let isLeader = initiallyLeader
  const listeners = new Set<(isLeader: boolean) => void>()
  const unsubscribe = vi.fn()
  const runtime: SyncedPiniaRuntime = {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
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
  return { kind: 'wake', cause: 'unlock', atMs }
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
  return { exePath: 'C:\\Windows\\notepad.exe', exeName: 'notepad.exe', title: 'notes.txt - Notepad', pid: 7, ownProcess: false, notificationState: 'accepts', sampledAtMs: Date.now(), ...overrides }
}

/** Fake chat controls: a quiet chat whose unprompted turns are spoken, unless a test replaces `submitUnprompted`. */
function createChatControls() {
  const state = { sending: false, queued: 0, unpromptedPending: false }
  const submitUnprompted = vi.fn(async (_payload: ChatUnpromptedPayload): Promise<ChatUnpromptedResult> => ({ status: 'spoken', text: 'Still at it?' }))
  const controls: SituationChatControls = {
    sending: () => state.sending,
    pendingQueuedSendCount: () => state.queued,
    unpromptedPending: () => state.unpromptedPending,
    submitUnprompted: payload => submitUnprompted(payload),
  }
  return { state, controls, submitUnprompted }
}

/** Emits the hooks of one finished user turn, as the chat runtime does. */
async function userTurn(hooks: ChatHookRegistry, turnId: string) {
  const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, message: { role: 'user', content: 'hi', createdAt: Date.now(), id: turnId }, contexts: {}, composedMessage: [] }
  const output = { role: 'assistant' as const, content: 'Hi!', slices: [], tool_results: [] }
  await hooks.emitBeforeSendHooks('hi', context)
  await hooks.emitAssistantMessageHooks(output, 'Hi!', context)
  await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Hi!', toolCalls: [] }, context)
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
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    store.initialize(leadership.runtime)

    useDesktopActivityStore().setSnapshot(desktopSample())
    await userTurn(hooks, 'turn-1')

    expect(store.state.presence).toEqual({ state: 'here', reason: null, sinceMs: T0 })
    expect(store.state.conversation).toMatchObject({ lastUserAtMs: T0, lastCharacterAtMs: T0, lastUnpromptedAtMs: null })
    expect(store.renderForRequest(T0)).toMatch(/^\[Situation \d\d:\d\d\]\n- The user is at the desk, active for less than a minute\n- You two last talked just now\.\n- Stage - on stage: face: smile$/)
  })

  it('reports a wake from an unlocked sample after a 6 min lock, next to the unchanged presence and came-back lines', () => {
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

    const block = store.renderForRequest(Date.now())
    expect(block).toContain('- The user is at the desk, active for less than a minute')
    expect(block).toContain('- New: unlocked the computer (just now)')
    expect(block).toContain('- New: came back after 6 min away (just now)')
  })

  it('adds no wake or stepped-away topic for a 1 s lock, and adds the stepped-away topic once a lock lasts 5 min', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const desktop = useDesktopActivityStore()
    const topics = () => store.state.events.map(event => event.topicKey)

    desktop.setSnapshot(desktopSample({ locked: true }))
    vi.advanceTimersByTime(1_000)
    desktop.setSnapshot(desktopSample({ unlockedAtMs: Date.now() }))
    expect(topics()).not.toContain('wake')
    vi.advanceTimersByTime(10 * 60 * 1_000)
    expect(topics()).not.toContain('presence:away')
    expect(topics()).not.toContain('wake')
    expect(store.renderForRequest(Date.now())).not.toContain('stepped away')
    expect(store.renderForRequest(Date.now())).not.toContain('unlocked the computer')

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
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
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

  it('ignores the web extension while browser sharing is off, and forgets what it already shared', async () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const settings = useSituationSettings()
    // The extension's source keys name its module inside the extension: `<extension id>:<module id>`.
    const browsing = (text: string): ContextObservation => ({ kind: 'context', sourceKey: 'proj-airi:plugin-web-extension:module-a', text, atMs: Date.now() })
    const watching = (eventId: string, headline: string): NotifyObservation => ({ kind: 'notify', sourceKey: 'proj-airi:plugin-web-extension:module-b', eventId, headline, urgency: 'soon', reminder: false, critical: false, atMs: Date.now() })
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
  /** Promotion holds the gate for the minimum gap; at the default Chattiness 0.5 that is 10 minutes. */
  const GAP_MS = 10 * 60 * 1_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useSituationStore().dispose()
    vi.useRealTimers()
  })

  /**
   * A leader in a host that supports unprompted turns, with a visible stage, an attentive user, and desktop and
   * foreground samples that its producers keep fresh, so only the gate's own rules decide.
   */
  function startQuietLeader(options: { capable?: boolean, leader?: boolean, foreground?: () => ForegroundWindowSample | null } = {}) {
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
    return { store, hooks, chat, leadership, observability: useSituationObservabilityStore() }
  }

  /** A new topic the gate can bring up: an unlock right now. */
  function offerTopic() {
    useSituationStore().ingest(wake(Date.now()))
  }

  async function nextGateTick() {
    await vi.advanceTimersByTimeAsync(GATE_INTERVAL_MS)
  }

  /** Emits the hooks the runtime emits for an unprompted turn that starts speaking. */
  async function unpromptedTurnSpeaks(hooks: ChatHookRegistry, turnId: string) {
    const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, origin: 'unprompted', message: { role: 'user', content: '(No one spoke to you.)', createdAt: Date.now(), id: turnId }, contexts: {}, composedMessage: [] }
    await hooks.emitBeforeSendHooks('(No one spoke to you.)', context)
    await hooks.emitTokenLiteralHooks(' Still at it?', context)
  }

  /** Emits every hook the runtime emits for an unprompted turn that is spoken to the end. */
  async function unpromptedTurnIsSpoken(hooks: ChatHookRegistry, turnId: string) {
    const context: ChatStreamEventContext = { sessionId: 'session-1', turnId, origin: 'unprompted', message: { role: 'user', content: '(No one spoke to you.)', createdAt: Date.now(), id: turnId }, contexts: {}, composedMessage: [] }
    const output = { role: 'assistant' as const, content: 'Still at it?', slices: [], tool_results: [] }
    await unpromptedTurnSpeaks(hooks, turnId)
    await hooks.emitAssistantMessageHooks(output, 'Still at it?', context)
    await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Still at it?', toolCalls: [] }, context)
  }

  it('names a web extension page topic by its kind in the unprompted trigger, never by its title or link', async () => {
    const { store, chat, observability } = startQuietLeader()
    // A plain context is a weaker topic than a notify; the most talkative setting lets it through.
    await useSituationSettings().update({ chattiness: 1 })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    store.ingest({ kind: 'context', sourceKey: 'proj-airi:plugin-web-extension:module-a', text: 'User is browsing: Secret page (https://example.test/secret).', atMs: Date.now() })

    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: true, topicKey: 'context:proj-airi:plugin-web-extension:module-a' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    const payload = chat.submitUnprompted.mock.calls[0][0]
    expect(payload.topicKey).toBe('context:proj-airi:plugin-web-extension:module-a')
    expect(payload.topicText.trim()).not.toBe('')
    expect(payload.topicText).not.toMatch(/secret|example\.test/iu)
  })

  it('fires once when the user is quiet, after marking the topic addressed', async () => {
    const { store, chat, observability } = startQuietLeader()
    let addressedBeforeSubmit: number | null | undefined
    chat.submitUnprompted.mockImplementation(async () => {
      addressedBeforeSubmit = store.state.events.find(event => event.topicKey === 'wake')?.addressedAtMs
      return { status: 'spoken', text: 'Still at it?' }
    })

    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: true, reason: 'ready', topicKey: 'wake', topicText: 'unlocked the computer' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect(chat.submitUnprompted.mock.calls[0][0]).toMatchObject({ topicKey: 'wake', topicText: 'unlocked the computer', messageId: expect.any(String) })
    expect(addressedBeforeSubmit).toEqual(expect.any(Number))

    // The gap now holds every later topic.
    await vi.advanceTimersByTimeAsync(60 * 1_000)
    offerTopic()
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'gap' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
  })

  it('holds while a chat turn is sending', async () => {
    const { chat, observability } = startQuietLeader()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    chat.state.sending = true
    offerTopic()

    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'generating' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('never runs in a host without the unprompted capability, nor in a follower', async () => {
    const { chat, observability } = startQuietLeader({ capable: false })
    offerTopic()
    await vi.advanceTimersByTimeAsync(GAP_MS + GATE_INTERVAL_MS)
    expect(observability.gate).toBeNull()
    expect(chat.submitUnprompted).not.toHaveBeenCalled()

    useSituationStore().dispose()
    setActivePinia(createPinia())
    const follower = startQuietLeader({ leader: false })
    await vi.advanceTimersByTimeAsync(GAP_MS + GATE_INTERVAL_MS)
    expect(follower.observability.gate).toBeNull()
    expect(follower.chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('holds right after promotion, so a new leader does not speak up at once', async () => {
    const { chat, observability } = startQuietLeader()
    offerTopic()

    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'gap' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('starts no second turn while one is pending, even before sending turns true', async () => {
    const { chat, observability } = startQuietLeader()
    // The turn is still in preparation: `sending` stays false and no result arrives.
    chat.submitUnprompted.mockImplementation(() => new Promise<ChatUnpromptedResult>(() => {}))
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    const firstDecision = observability.gate

    // Far past the gap, with new topics: nothing is evaluated while the turn is pending.
    for (let minute = 0; minute < 30; minute++) {
      offerTopic()
      await vi.advanceTimersByTimeAsync(60 * 1_000)
    }
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect(observability.gate).toBe(firstDecision)
  })

  it('evaluates nothing while another caller\'s unprompted turn is pending', async () => {
    const { chat, observability } = startQuietLeader()
    chat.state.unpromptedPending = true
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()

    await nextGateTick()

    expect(observability.gate).toBeNull()
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('treats a busy result as no fire, so the next topic can go at once', async () => {
    const { chat, observability } = startQuietLeader()
    chat.submitUnprompted.mockResolvedValueOnce({ status: 'failed', error: 'Another unprompted turn is still pending' })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    offerTopic()
    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: true, reason: 'ready' })
    expect(observability.gate?.memory.fires).toHaveLength(1)
    expect(chat.submitUnprompted).toHaveBeenCalledTimes(2)
  })

  it('names her previous spoken remark in the block, not the topic she is raising now', async () => {
    const { store, hooks, chat } = startQuietLeader()
    const blocks: string[] = []
    chat.submitUnprompted.mockImplementation(async (payload) => {
      // The chat store renders the situation block while it builds the unprompted request.
      blocks.push(store.renderForRequest(Date.now()) ?? '')
      await unpromptedTurnIsSpoken(hooks, payload.messageId!)
      return { status: 'spoken', text: 'Still at it?' }
    })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    store.ingest({ kind: 'context', sourceKey: 'game', text: 'in a dungeon', salience: 1, atMs: Date.now() })
    await nextGateTick()

    expect(chat.submitUnprompted.mock.calls.map(([payload]) => payload.topicKey)).toEqual(['wake', 'context:game'])
    expect(blocks[0]).not.toContain('You last spoke up on your own')
    expect(blocks[1]).toContain('You last spoke up on your own 10 min ago, about unlocked the computer.')
    expect(blocks[1]).not.toContain('about in a dungeon')
  })

  it('fires nothing about a 1 s lock and unlock', async () => {
    const { store, chat, observability } = startQuietLeader()
    const desktop = useDesktopActivityStore()
    await vi.advanceTimersByTimeAsync(GAP_MS)

    desktop.setSnapshot(desktopSample({ locked: true }))
    expect(store.state.presence).toMatchObject({ state: 'away', reason: 'locked' })
    // The producer's own 1 s sample reports the return before the unlock time arrives, as in a live run.
    await vi.advanceTimersByTimeAsync(1_000)
    desktop.setSnapshot(desktopSample({ unlockedAtMs: Date.now() }))
    for (let tick = 0; tick < 3; tick++)
      await nextGateTick()

    expect(store.state.events.map(event => event.topicKey)).toEqual([])
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('never names a declined topic as her last remark', async () => {
    const { store, hooks, chat } = startQuietLeader()
    const blocks: string[] = []
    chat.submitUnprompted.mockImplementation(async (payload) => {
      blocks.push(store.renderForRequest(Date.now()) ?? '')
      if (payload.topicKey === 'context:game') {
        // A declined turn emits only the before-send and stream-end hooks, as the runtime's decline contract pins.
        const context: ChatStreamEventContext = { sessionId: 'session-1', turnId: payload.messageId!, origin: 'unprompted', message: { role: 'user', content: '(No one spoke to you.)', createdAt: Date.now(), id: payload.messageId! }, contexts: {}, composedMessage: [] }
        await hooks.emitBeforeSendHooks('(No one spoke to you.)', context)
        await hooks.emitStreamEndHooks(context)
        return { status: 'declined' }
      }
      await unpromptedTurnIsSpoken(hooks, payload.messageId!)
      return { status: 'spoken', text: 'Still at it?' }
    })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    store.ingest({ kind: 'context', sourceKey: 'game', text: 'in a dungeon', salience: 1, atMs: Date.now() })
    await nextGateTick()
    // Offer the third topic each minute until the gate takes it.
    for (let minute = 0; minute < 60 && chat.submitUnprompted.mock.calls.length < 3; minute++) {
      await vi.advanceTimersByTimeAsync(60 * 1_000)
      if (!store.state.events.some(event => event.topicKey === 'context:vision'))
        store.ingest({ kind: 'context', sourceKey: 'vision', text: 'a cat on screen', salience: 1, atMs: Date.now() })
    }

    expect(chat.submitUnprompted.mock.calls.map(([payload]) => payload.topicKey)).toEqual(['wake', 'context:game', 'context:vision'])
    expect(blocks[1]).toContain('about unlocked the computer.')
    expect(blocks[2]).toContain('You last spoke up on your own')
    expect(blocks[2]).toContain('about unlocked the computer.')
    expect(blocks[2]).not.toContain('about in a dungeon')
    expect(store.state.conversation.lastUnpromptedTopic).toBe('a cat on screen')
  })

  it('does not count an unprompted turn as the user engaging', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    chat.submitUnprompted.mockImplementation(async (payload) => {
      await unpromptedTurnSpeaks(hooks, payload.messageId!)
      return { status: 'spoken', text: 'Still at it?' }
    })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    // The runtime emits onBeforeSend for unprompted turns too; this one must not clear the pending fire.
    await unpromptedTurnSpeaks(hooks, 'another-unprompted-turn')
    await nextGateTick()
    expect(observability.gate?.memory.pending).toMatchObject({ topicKey: 'wake', spokenAtMs: expect.any(Number) })
    expect(observability.gate?.memory).toMatchObject({ ignoreStreak: 0, backoffLevel: 0 })

    await userTurn(hooks, 'user-reply')
    await nextGateTick()
    expect(observability.gate?.memory.pending).toBeNull()
  })

  it('records a fire as spoken at its first literal, so a reply during her turn earns engagement', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    // The first fire is ignored: its ignore window passes without a user turn.
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    // The second fire starts speaking, the user answers mid-reply, and that user send cancels the rest of the turn.
    chat.submitUnprompted.mockImplementation(async (payload) => {
      await unpromptedTurnSpeaks(hooks, payload.messageId!)
      await userTurn(hooks, 'user-reply')
      return { status: 'cancelled' }
    })
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledTimes(2)

    await nextGateTick()

    // Engagement reset the streak that the ignored first fire left; a cancelled outcome alone would have kept it.
    expect(observability.gate?.memory).toMatchObject({ pending: null, ignoreStreak: 0 })
  })

  it('keeps the streak of an ignored fire when a turn is only cancelled', async () => {
    const { chat, observability } = startQuietLeader()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    chat.submitUnprompted.mockResolvedValueOnce({ status: 'cancelled' })
    await nextGateTick()

    await nextGateTick()

    expect(observability.gate?.memory).toMatchObject({ pending: null, ignoreStreak: 1 })
  })

  it('holds while the user speaks, the character speaks, or a composer reports writing in any window', async () => {
    const { chat, observability } = startQuietLeader()
    const bus = getSpeechBusContext()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()

    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: true })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'user-speaking' })
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: false })

    // Speech-to-text still finishes the message that the user just spoke.
    bus.emit(voiceSnapshotChanged, { connected: true, drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase: 'finalizing', text: 'hello', segments: [] } })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'user-speaking' })
    bus.emit(voiceSnapshotChanged, { connected: true, drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase: 'settled', text: 'hello', segments: [] } })

    bus.emit(voiceTurnsChanged, [{ sessionId: 'session-1', turnId: 'reply-1' }])
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'character-speaking' })
    bus.emit(voiceTurnsChanged, [])

    bus.emit(chatComposerActivityChangedEvent, { sourceId: 'chat-window', hasDraft: true, lastInputAtMs: Date.now() })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'user-typing' })

    // A composer that stops reporting (its window closed) expires after 15 s.
    await vi.advanceTimersByTimeAsync(16_000)
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
  })

  it('stops counting a voice input once its host ends without reporting, as a crashed window does', async () => {
    const { store, chat, observability } = startQuietLeader()
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
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()

    bus.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', lock, drafts: [], input: { requestId: 'mic', sessionId: 'session-1', phase: 'capturing', text: '', segments: [] } })
    bus.emit(speechInputUserSpeakingChangedEvent, { speaking: true })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'user-speaking' })

    // The host's renderer crashes mid-capture: no snapshot and no speaking change arrives, only the lock is released.
    crashed.resolve()
    // Lock requests are granted in order, so this one runs after every window that waited for the host to end.
    await navigator.locks.request(lock, () => {})
    expect(store.userMidInput()).toBe(false)
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: true, reason: 'ready' })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
  })

  it('holds while the stage is hidden and waits a full gap after it is shown again', async () => {
    const { store, chat, observability } = startQuietLeader()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    store.setStageVisible(false)
    offerTopic()
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'stage-hidden' })

    store.setStageVisible(true)
    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'gap' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('stays quiet when presence settings say so', async () => {
    const { chat, observability } = startQuietLeader()
    const settings = useSituationSettings()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()

    settings.update({ unpromptedEnabled: false })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'disabled' })

    settings.update({ unpromptedEnabled: true, dontDisturb: true })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'dont-disturb' })

    settings.update({ dontDisturb: false, quietApps: ['notepad.exe'] })
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'quiet-app' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('stops suppressing for a game once its foreground samples go stale', async () => {
    const game = { exePath: 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe', exeName: 'Hades.exe', title: 'Hades' }
    let producing = true
    const { store, chat, observability } = startQuietLeader({ foreground: () => producing ? foregroundSample(game) : null })
    useSituationSettings().update({ speakDuringGames: false })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'busy-game' })

    producing = false
    await vi.advanceTimersByTimeAsync(FOREGROUND_SAMPLE_STALE_VISIBLE_MS + GATE_INTERVAL_MS)

    // The reducer keeps the game as the session's last activity, but the stale sample that expired the category also
    // holds the gate as stale, before any check of the activity, so the old game never suppresses on its own.
    expect(store.state.activity?.category).toBe('game')
    expect(store.foregroundCategory).toBeNull()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'stale-signal' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('holds as stale while foreground sharing is off, even when a sample is still fresh', async () => {
    const { chat, observability } = startQuietLeader()
    const settings = useSituationSettings()
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()

    await settings.update({ shareForegroundWindow: false })
    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'stale-signal' })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()

    await settings.update({ shareForegroundWindow: true })
    await nextGateTick()

    expect(observability.gate?.decision).toMatchObject({ fire: true })
    expect(chat.submitUnprompted).toHaveBeenCalledTimes(1)
  })

  it('stops the gate on demotion and drops the result of a turn from the earlier leadership', async () => {
    const { leadership, chat, observability } = startQuietLeader()
    let finish!: (result: ChatUnpromptedResult) => void
    chat.submitUnprompted.mockImplementation(() => new Promise<ChatUnpromptedResult>((resolve) => {
      finish = resolve
    }))
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    leadership.set(false)
    finish({ status: 'spoken', text: 'Still at it?' })
    leadership.set(true)
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()

    // The new leadership starts from promotion memory; the old fire is not in it.
    expect(observability.gate?.decision).toMatchObject({ fire: true })
    expect(observability.gate?.memory.fires).toHaveLength(1)
  })
  it('evaluates now through the leader, skipping only the timing guards', async () => {
    const { chat, observability } = startQuietLeader()
    offerTopic()
    await nextGateTick()
    expect(observability.gate?.decision).toMatchObject({ fire: false, reason: 'gap' })

    const evaluation = await observability.evaluateGate()

    expect(evaluation).toMatchObject({ status: 'evaluated', decision: { fire: true, reason: 'forced', topicKey: 'wake', trace: { forceTiming: true } } })
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()
    expect(observability.gateHistory[0]).toMatchObject({ fire: true, reason: 'forced', forced: true, count: 1 })
  })

  it('keeps every hard suppressor when evaluating now', async () => {
    const { chat, observability } = startQuietLeader()
    offerTopic()
    await useSituationSettings().update({ dontDisturb: true })

    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'dont-disturb', trace: { forceTiming: true } } })
    chat.state.sending = true
    await useSituationSettings().update({ dontDisturb: false })
    expect(await observability.evaluateGate()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'generating' } })
    expect(chat.submitUnprompted).not.toHaveBeenCalled()
  })

  it('reports an evaluation as skipped while an unprompted turn is pending, and publishes memory changes between ticks', async () => {
    const { hooks, chat, observability } = startQuietLeader()
    let finish!: (result: ChatUnpromptedResult) => void
    chat.submitUnprompted.mockImplementation(async (payload) => {
      await unpromptedTurnSpeaks(hooks, payload.messageId!)
      return new Promise<ChatUnpromptedResult>((resolve) => {
        finish = resolve
      })
    })
    await vi.advanceTimersByTimeAsync(GAP_MS)
    offerTopic()
    await nextGateTick()
    expect(chat.submitUnprompted).toHaveBeenCalledOnce()

    expect(await observability.evaluateGate()).toEqual({ status: 'skipped', reason: 'unprompted-pending' })
    // The fire was spoken after the decision was recorded; the current memory says so, the decision's does not.
    expect(observability.gate?.memory.pending?.spokenAtMs).toBeNull()
    expect(observability.gateMemory.pending?.spokenAtMs).toEqual(expect.any(Number))
    finish({ status: 'spoken', text: 'Still at it?' })
  })

  it('answers evaluation as skipped once the gate stops on demotion', async () => {
    const { leadership, observability } = startQuietLeader()
    leadership.set(false)

    expect(await observability.evaluateGate()).toEqual({ status: 'skipped', reason: 'gate-not-running' })
  })
})
