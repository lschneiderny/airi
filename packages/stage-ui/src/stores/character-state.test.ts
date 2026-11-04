import type { CharacterEvent, CharacterProfile, CharacterStateRecordV1 } from '@proj-airi/stage-shared/character-state'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { CharacterStateSnapshot } from './character-state'
import type { AiriCard } from './modules/airi-card'

import { advance, applyEvent, DEFAULT_CHARACTER_PROFILE, initialCharacterState, readCharacter } from '@proj-airi/stage-shared/character-state'
import { createPinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import { characterStateRepo } from '../database/repos/character-state.repo'
import { CHARACTER_STATE_ADVANCE_INTERVAL_MS, CHARACTER_STATE_SAVE_DEBOUNCE_MS, characterStateContext, useCharacterStateStore } from './character-state'
import { useAiriCardStore } from './modules/airi-card'

vi.mock('../database/repos/character-state.repo')

// The store reads only the active card id and the cards' profiles from the card store, whose real setup needs an i18n
// application context.
vi.mock('./modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', {
      state: () => ({ activeCardId: 'default', cards: new Map<string, unknown>() }),
    }),
  }
})

// 8 pm local time, away from the 04:00 rollover.
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
const HOUR_MS = 60 * 60_000
const profile = DEFAULT_CHARACTER_PROFILE

/** A synced runtime whose leadership the test flips. It reports the current role on subscribe, like the plugin. */
function createLeadership(initiallyLeader: boolean) {
  let isLeader = initiallyLeader
  const listeners = new Set<(isLeader: boolean) => void>()
  const runtime: SyncedPiniaRuntime = {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listeners.add(listener)
      listener(isLeader)
      return () => listeners.delete(listener)
    }),
    participantId: 'character-state-test',
    plugin: vi.fn(),
  }
  return {
    runtime,
    set(next: boolean) {
      isLeader = next
      for (const listener of listeners)
        listener(next)
    },
  }
}

/** A minimal card whose profile field is `character`; the store reads nothing else of it. */
function cardWith(character: CharacterProfile | Record<string, unknown>): AiriCard {
  const inherit = { provider: '', model: '' }
  return {
    name: 'Luna',
    version: '1.0.0',
    extensions: {
      airi: {
        // The field is read through the schema, so an invalid value is as plain data as a valid one.
        modules: { character: character as CharacterProfile, consciousness: inherit, vision: inherit, speech: { ...inherit, voice_id: '' } },
        agents: {},
      },
    },
  }
}

function significant(id: string, atMs: number): CharacterEvent {
  return { kind: 'significant-positive', id, atMs, reason: 'shared a good moment' }
}

/** A store in a fresh Pinia, as after a window reload. */
function freshStore() {
  setActivePinia(createPinia())
  return useCharacterStateStore()
}

const stores: Array<ReturnType<typeof useCharacterStateStore>> = []

function leaderStore() {
  const store = freshStore()
  const leadership = createLeadership(true)
  store.initialize(leadership.runtime)
  stores.push(store)
  return { store, leadership }
}

/** How far a mood sits from the resting disposition, summed over the axes. */
function distanceFromRest(mood: { valence: number, energy: number, tension: number }) {
  return Math.abs(mood.valence - profile.resting.valence) + Math.abs(mood.energy - profile.resting.energy) + Math.abs(mood.tension - profile.resting.tension)
}

describe('useCharacterStateStore', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: T0 })
    await characterStateRepo.clear()
  })

  afterEach(() => {
    for (const store of stores.splice(0))
      store.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('updates the reading and the revision when the leader applies an event', async () => {
    const { store } = leaderStore()
    await store.ready()
    expect(store.cardId).toBe('default')
    expect(store.reading).not.toBeNull()
    const before = store.revision

    vi.advanceTimersByTime(1_000)
    const atMs = Date.now()
    await expect(store.apply({ kind: 'touch-pleasant', id: 'touch-1', atMs })).resolves.toBe(true)

    expect(store.revision).toBeGreaterThan(before)
    expect(store.reading?.lastInteractionAtMs).toBe(atMs)
    // A replay is a no-op and publishes nothing.
    const afterApply = store.revision
    await expect(store.apply({ kind: 'touch-pleasant', id: 'touch-1', atMs })).resolves.toBe(false)
    expect(store.revision).toBe(afterApply)
    // The replicated state carries the reading, never the record or its events.
    expect(Object.keys(store.$state)).toEqual(['replicated'])
    expect(Object.keys(store.replicated).sort()).toEqual(['cardId', 'reading', 'revision', 'updatedAtMs'])
  })

  it('saves after the debounce and refreshes the reading on the advance tick', async () => {
    const { store } = leaderStore()
    await store.ready()
    await store.apply(significant('moment-1', Date.now()))
    expect(await characterStateRepo.load('default')).toBeNull()

    vi.advanceTimersByTime(CHARACTER_STATE_SAVE_DEBOUNCE_MS)
    await store.ready()
    expect((await characterStateRepo.load('default') as CharacterStateRecordV1).appliedEvents.recent.map(event => event.id)).toEqual(['moment-1'])

    // Time words move without events, so the tick publishes a new reading.
    const revision = store.revision
    const mood = store.reading?.mood
    vi.advanceTimersByTime(CHARACTER_STATE_ADVANCE_INTERVAL_MS)
    expect(store.revision).toBeGreaterThan(revision)
    expect(store.reading?.mood).not.toEqual(mood)
  })

  it('restores the record on reload and applies the elapsed decay', async () => {
    const first = leaderStore().store
    await first.ready()
    const event = significant('moment-1', T0)
    await first.apply(event)
    const moodAfterEvent = first.reading!.mood
    first.dispose()
    // Disposing saves at once, without waiting for the debounce.
    await first.ready()
    expect(await characterStateRepo.load('default')).not.toBeNull()

    vi.setSystemTime(T0 + 6 * HOUR_MS)
    const reloaded = leaderStore().store
    await reloaded.ready()

    const expected = readCharacter(
      advance(applyEvent(initialCharacterState('default', profile, characterStateContext(T0)), event, profile, characterStateContext(T0)), profile, characterStateContext(T0 + 6 * HOUR_MS)),
      profile,
      null,
      characterStateContext(T0 + 6 * HOUR_MS),
    )
    expect(reloaded.reading?.mood).toEqual(expected.mood)
    expect(reloaded.reading?.reasons).toEqual(expected.reasons)
    expect(distanceFromRest(reloaded.reading!.mood)).toBeLessThan(distanceFromRest(moodAfterEvent))
    expect(reloaded.leaderRecord?.appliedEvents.recent.map(applied => applied.id)).toEqual(['moment-1'])
  })

  it('ignores a replicated snapshot older than the one it holds', () => {
    const store = freshStore()
    store.initialize(createLeadership(false).runtime)
    stores.push(store)
    const context = characterStateContext(T0)
    const calm = readCharacter(initialCharacterState('default', profile, context), profile, null, context)
    const moved = readCharacter(applyEvent(initialCharacterState('default', profile, context), significant('moment-1', T0), profile, context), profile, null, context)

    // The plugin applies a remote snapshot through `$patch` with a function that replaces each top-level key.
    const receive = (snapshot: CharacterStateSnapshot) => store.$patch((state) => {
      state.replicated = snapshot
    })
    receive({ cardId: 'default', reading: moved, revision: 10, updatedAtMs: T0 })
    expect(store.reading).toEqual(moved)
    receive({ cardId: 'default', reading: calm, revision: 9, updatedAtMs: T0 })
    expect(store.reading).toEqual(moved)
    expect(store.revision).toBe(10)
    receive({ cardId: 'default', reading: calm, revision: 11, updatedAtMs: T0 })
    expect(store.reading).toEqual(calm)
  })

  it('never writes storage from a follower', async () => {
    const seeded = initialCharacterState('default', profile, characterStateContext(T0 - HOUR_MS))
    await characterStateRepo.save(seeded)
    const store = freshStore()
    store.initialize(createLeadership(false).runtime)
    stores.push(store)

    await expect(store.apply(significant('moment-1', T0))).resolves.toBe(false)
    await store.importRecord('other', null)
    await store.forget('default')
    await store.resetState()
    await store.devtoolsJump(HOUR_MS)
    vi.advanceTimersByTime(CHARACTER_STATE_SAVE_DEBOUNCE_MS + CHARACTER_STATE_ADVANCE_INTERVAL_MS)

    expect(await characterStateRepo.loadAll()).toEqual([seeded])
    expect(store.reading).toBeNull()
  })

  it('drops an apply whose leadership ended before it ran, and applies its redelivery once', async () => {
    const { store, leadership } = leaderStore()
    const event = significant('moment-1', T0)
    // The load is still queued, so the apply waits behind it when leadership moves away.
    const pending = store.apply(event)
    leadership.set(false)
    await expect(pending).resolves.toBe(false)
    vi.advanceTimersByTime(CHARACTER_STATE_SAVE_DEBOUNCE_MS)
    expect(await characterStateRepo.load('default')).toBeNull()

    // The plugin delivers a pending call again to the next leader.
    leadership.set(true)
    await expect(store.apply(event)).resolves.toBe(true)
    await expect(store.apply(event)).resolves.toBe(false)
    vi.advanceTimersByTime(CHARACTER_STATE_SAVE_DEBOUNCE_MS)
    await store.ready()
    expect((await characterStateRepo.load('default') as CharacterStateRecordV1).appliedEvents.recent.map(applied => applied.id)).toEqual(['moment-1'])
  })

  it('falls back per field when the stored record is damaged', async () => {
    const valid = initialCharacterState('default', profile, characterStateContext(T0 - 24 * HOUR_MS))
    // The repo returns stored values as `unknown`, so a damaged one needs no record type.
    vi.spyOn(characterStateRepo, 'load').mockResolvedValueOnce({ ...valid, mood: 'damaged' })

    const { store } = leaderStore()
    await store.ready()

    expect(store.reading).not.toBeNull()
    expect(store.leaderRecord?.createdAtMs).toBe(valid.createdAtMs)
    expect(store.leaderRecord?.mood.contributions).toEqual([])
  })

  it('loads the other card\'s record when the active card switches', async () => {
    const other = applyEvent(initialCharacterState('other', profile, characterStateContext(T0 - HOUR_MS)), significant('other-moment', T0 - HOUR_MS), profile, characterStateContext(T0 - HOUR_MS))
    await characterStateRepo.save(other)
    const { store } = leaderStore()
    await store.ready()
    await store.apply(significant('moment-1', T0))

    useAiriCardStore().activeCardId = 'other'
    // The card watcher runs before the next render tick and queues the load.
    await nextTick()
    await store.ready()
    expect(store.cardId).toBe('other')

    expect(store.leaderRecord?.appliedEvents.recent.map(applied => applied.id)).toEqual(['other-moment'])
    // Switching saved the previous card's record at once.
    expect((await characterStateRepo.load('default') as CharacterStateRecordV1).appliedEvents.recent.map(applied => applied.id)).toEqual(['moment-1'])
  })

  it('starts a fresh state from the profile of the card and ignores an invalid one', async () => {
    const cardProfile = { resting: { valence: -0.3, energy: 0.2, tension: 0.4 }, startingStage: 'close' }
    const { store } = leaderStore()
    await store.ready()
    // The mocked card store holds only what the character-state store reads of a card.
    const cards: Map<string, unknown> = useAiriCardStore().cards
    const cardWith = (character: unknown) => ({ extensions: { airi: { modules: { character } } } })
    cards.set('profiled', cardWith(cardProfile))
    cards.set('invalid', cardWith({ ...cardProfile, startingStage: 'intimate' }))

    await store.importRecord('profiled', null)
    await store.importRecord('invalid', null)

    const profiled = await characterStateRepo.load('profiled') as CharacterStateRecordV1
    expect(profiled.temperament.axes).toEqual(cardProfile.resting)
    expect(profiled.relationship.stages.closeness).toBe('close')
    const invalid = await characterStateRepo.load('invalid') as CharacterStateRecordV1
    expect(invalid.temperament.axes).toEqual(DEFAULT_CHARACTER_PROFILE.resting)
    expect(invalid.relationship.stages.closeness).toBe('stranger')
  })

  it('imports a record, exports it, and forgets everything', async () => {
    const { store } = leaderStore()
    await store.ready()
    const imported = applyEvent(initialCharacterState('source-card', profile, characterStateContext(T0)), significant('imported', T0), profile, characterStateContext(T0))

    await store.importRecord('default', imported)
    expect(store.leaderRecord?.cardId).toBe('default')
    expect((await store.exportRecord('default'))?.appliedEvents.recent.map(applied => applied.id)).toEqual(['imported'])
    await store.importRecord('fresh-card', null)
    expect((await characterStateRepo.load('fresh-card') as CharacterStateRecordV1).cardId).toBe('fresh-card')

    await store.forget('everything')
    expect(await characterStateRepo.loadAll()).toEqual([])
    const context = characterStateContext(T0)
    expect(store.reading).toEqual(readCharacter(initialCharacterState('default', profile, context), profile, null, context))
    vi.advanceTimersByTime(CHARACTER_STATE_SAVE_DEBOUNCE_MS)
    await store.ready()
    expect(await characterStateRepo.loadAll()).toEqual([])
  })
})

describe('useCharacterStateStore across windows', () => {
  const runtimes: SyncedPiniaRuntime[] = []

  afterEach(async () => {
    for (const store of stores.splice(0))
      store.dispose()
    for (const runtime of runtimes.splice(0))
      runtime.dispose()
    await characterStateRepo.clear()
  })

  function mountWindow(namespace: string, leadership: 'leader-only' | 'follower-only') {
    const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 5_000 })
    runtimes.push(runtime)
    const pinia = createPinia()
    pinia.use(runtime.plugin)
    // Pinia applies plugins only once it is installed on an application.
    createApp({}).use(pinia)
    setActivePinia(pinia)
    const store = useCharacterStateStore(pinia)
    store.initialize(runtime)
    stores.push(store)
    return { runtime, store }
  }

  it('forwards a follower apply to the leader, which publishes the reading', async () => {
    const namespace = `character-state:${crypto.randomUUID()}`
    const leader = mountWindow(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    await leader.store.ready()
    const follower = mountWindow(namespace, 'follower-only')
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    const proposals: string[] = []
    follower.store.$subscribe((mutation) => {
      proposals.push(mutation.type)
    })

    const atMs = Date.now()
    await expect(follower.store.apply({ kind: 'touch-pleasant', id: 'touch-1', atMs })).resolves.toBe(true)

    expect(leader.store.leaderRecord?.appliedEvents.recent.map(applied => applied.id)).toEqual(['touch-1'])
    await vi.waitFor(() => expect(follower.store.reading?.lastInteractionAtMs).toBe(atMs))
    expect(follower.store.leaderRecord).toBeNull()
    // The follower only received snapshots; it never mutated the replicated state itself.
    expect(proposals.every(type => type === 'patch function')).toBe(true)
  })

  it('reads the active card profile again when its card field changes', async () => {
    const { store } = leaderStore()
    await store.ready()
    expect(store.reading?.resting).toEqual(profile.resting)
    const revision = store.revision
    const cards = useAiriCardStore()

    // The card editor saves the active card; the card store replaces the card object.
    const edited = { resting: { valence: -0.6, energy: 0.4, tension: 0.7 }, startingStage: 'friendly' as const }
    cards.cards.set('default', cardWith(edited))
    await nextTick()
    await store.ready()
    expect(store.reading?.resting).toEqual(edited.resting)
    expect(store.revision).toBeGreaterThan(revision)

    // A field outside the schema is not a profile; the default one applies.
    cards.cards.set('default', cardWith({ ...edited, resting: { ...edited.resting, valence: 5 } }))
    await nextTick()
    await store.ready()
    expect(store.reading?.resting).toEqual(profile.resting)

    // Another card's field does not touch the active reading.
    const afterReset = store.revision
    cards.cards.set('other', cardWith(edited))
    await nextTick()
    await store.ready()
    expect(store.revision).toBe(afterReset)
  })
})
