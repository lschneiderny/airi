import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { PiniaColada } from '@pinia/colada'
import { DEFAULT_CHARACTER_PROFILE, initialCharacterState } from '@proj-airi/stage-shared/character-state'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { characterStateRepo } from '../../database/repos/character-state.repo'
import { characterStateContext, useCharacterStateStore } from '../character-state'
import { useAiriCardStore } from './airi-card'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en' }, t: (key: string) => key }),
}))

const runtimes: SyncedPiniaRuntime[] = []
const piniaInstances: ReturnType<typeof createPinia>[] = []
const characterStates: Array<ReturnType<typeof useCharacterStateStore>> = []

/** One window: its card store, and its character state store bound to the window's leadership as the apps bind it. */
function createWindow(namespace: string, leadership: 'leader-only' | 'follower-only') {
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  runtimes.push(runtime)
  const pinia = createPinia()
  pinia.use(runtime.plugin)
  createApp({}).use(pinia).use(PiniaColada)
  setActivePinia(pinia)
  piniaInstances.push(pinia)
  const cards = useAiriCardStore(pinia)
  const characterState = useCharacterStateStore(pinia)
  characterState.initialize(runtime)
  characterStates.push(characterState)
  return { runtime, cards, characterState }
}

describe('card deletion across windows', () => {
  beforeEach(async () => {
    localStorage.clear()
    await characterStateRepo.clear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ voices: [], recommended: {}, data: [] }))))
  })

  afterEach(async () => {
    for (const characterState of characterStates.splice(0))
      characterState.dispose()
    for (const runtime of runtimes.splice(0))
      runtime.dispose()
    for (const pinia of piniaInstances.splice(0))
      disposePinia(pinia)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    await characterStateRepo.clear()
  })

  it('forgets the character state in the leader before a follower\'s deletion resolves', async () => {
    const namespace = `card-removal-${crypto.randomUUID()}`
    const leader = createWindow(namespace, 'leader-only')
    await expect.poll(() => leader.runtime.isLeader()).toBe(true)
    await leader.cards.initialize()
    const cardId = await leader.cards.addCard({ name: 'Luna', version: '1.0.0' }, 'scratch')
    const kept = await leader.cards.addCard({ name: 'Mira', version: '1.0.0' }, 'scratch')
    const context = characterStateContext(Date.now())
    await characterStateRepo.save(initialCharacterState(cardId, DEFAULT_CHARACTER_PROFILE, context))
    await characterStateRepo.save(initialCharacterState(kept, DEFAULT_CHARACTER_PROFILE, context))

    const follower = createWindow(namespace, 'follower-only')
    await expect.poll(() => follower.cards.cards.has(cardId)).toBe(true)
    const leaderListener = vi.fn()
    const followerListener = vi.fn()
    leader.cards.onCardRemoval(leaderListener)
    follower.cards.onCardRemoval(followerListener)
    const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')

    await expect(follower.cards.removeCard(cardId)).resolves.toBe(true)

    // The leader awaited its character state store, so the record is gone once the routed call returns.
    expect(await characterStateRepo.load(cardId)).toBeNull()
    expect(await characterStateRepo.load(kept)).not.toBeNull()
    expect(leaderListener).toHaveBeenCalledExactlyOnceWith(cardId)
    await expect.poll(() => follower.cards.cards.has(cardId)).toBe(false)
    // Deletion runs in the leader. The follower's listeners and its character state store are not asked, and neither
    // the listener nor the received snapshot makes the follower propose state (`replaceState` is that RPC).
    expect(followerListener).not.toHaveBeenCalled()
    expect(follower.characterState.leading).toBe(false)
    const proposals = traffic.mock.calls.filter(([message]) => JSON.stringify(message).includes('replaceState'))
    expect(proposals).toHaveLength(0)
  })
})
