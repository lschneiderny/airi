import type { ActivityObservation, WakeObservation } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { initialSituationState, SETTLE_MS } from '@proj-airi/stage-shared/situation'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSituationStore } from '.'

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
})
