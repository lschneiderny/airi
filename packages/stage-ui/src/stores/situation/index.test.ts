import type { ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { ActivityObservation, WakeObservation } from '@proj-airi/stage-shared/situation'
import type { ForegroundWindowSample } from '@proj-airi/stage-shared/stores/foreground-window'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createChatHooks } from '@proj-airi/core-agent'
import { initialSituationState, SETTLE_MS } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSituationStore } from '.'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
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
    store.observeChat(hooks)
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    store.initialize(leadership.runtime)

    useDesktopActivityStore().setSnapshot(desktopSample())
    await userTurn(hooks, 'turn-1')

    expect(store.state.presence).toEqual({ state: 'here', reason: null, sinceMs: T0 })
    expect(store.state.conversation).toMatchObject({ lastUserAtMs: T0, lastCharacterAtMs: T0, lastUnpromptedAtMs: null })
    expect(store.renderForRequest(T0)).toMatch(/^\[Situation \d\d:\d\d\]\n- The user is at the desk, active for less than a minute\n- You two last talked just now\.\n- Stage - on stage: face: smile$/)
  })

  it('reports a wake from an unlocked sample after a locked one', () => {
    const leadership = createLeadership(true)
    const store = useSituationStore()
    store.initialize(leadership.runtime)
    const desktop = useDesktopActivityStore()

    desktop.setSnapshot(desktopSample({ locked: true }))
    expect(store.state.presence).toMatchObject({ state: 'away', reason: 'locked' })
    vi.advanceTimersByTime(10_000)
    desktop.setSnapshot(desktopSample({ unlockedAtMs: Date.now() }))

    expect(store.renderForRequest(Date.now())).toContain('- New: unlocked the computer (just now)')
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
    store.observeChat(hooks)
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
    store.observeChat(hooks)
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

    store.observeChat(first)
    store.observeChat(second)
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

  it('stores stage visibility, which starts hidden', () => {
    const store = useSituationStore()
    expect(store.stageVisible).toBe(false)

    store.setStageVisible(true)

    expect(store.stageVisible).toBe(true)
    expect(store.$state).toEqual({})
  })
})
