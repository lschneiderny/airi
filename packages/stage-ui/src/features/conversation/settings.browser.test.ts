import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { defaultConversationSettings, useConversationSettings } from './settings'

const key = 'settings/conversation'
const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime?: SyncedPiniaRuntime }> = []

function createContext(namespace?: string, leadership?: LeadershipMode) {
  const pinia = createPinia()
  const runtime = namespace ? createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 }) : undefined
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: useConversationSettings(pinia), runtime }
}

function coordinated(runtime: SyncedPiniaRuntime, predicate: () => boolean) {
  if (predicate())
    return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined
    const timeout = setTimeout(() => {
      stop?.()
      reject(new Error('Coordination timed out'))
    }, 5000)
    stop = runtime.onCoordinationChange(() => {
      if (predicate()) {
        clearTimeout(timeout)
        stop?.()
        resolve()
      }
    })
  })
}

describe('conversation settings', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    for (const { pinia, runtime } of contexts.splice(0)) {
      runtime?.dispose()
      disposePinia(pinia)
    }
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loads defaults without writing them and persists updates and resets as one document', async () => {
    const { store } = createContext()
    expect(store.document).toEqual({ register: 'talking', textingFlavor: 'plain' })
    expect(localStorage.getItem(key)).toBeNull()
    expect(await store.update({ register: 'texting', textingFlavor: 'discord' })).toEqual({ success: true })
    expect(store.document).toEqual({ register: 'texting', textingFlavor: 'discord' })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(store.document)
    await store.reset()
    expect(store.document).toEqual(defaultConversationSettings())
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaultConversationSettings())
  })

  it('restores a stored document', () => {
    localStorage.setItem(key, JSON.stringify({ register: 'texting', textingFlavor: 'discord' }))
    expect(createContext().store.document).toEqual({ register: 'texting', textingFlavor: 'discord' })
  })

  it.each([
    { stored: { register: 'TALKING', textingFlavor: 'discord' }, expected: { register: 'talking', textingFlavor: 'discord' }, invalid: 'register' },
    { stored: { register: 'texting', textingFlavor: 'slack' }, expected: { register: 'texting', textingFlavor: 'plain' }, invalid: 'textingFlavor' },
    { stored: { register: 'TEXTING', textingFlavor: 1 }, expected: { register: 'talking', textingFlavor: 'plain' }, invalid: 'register, textingFlavor' },
  ])('falls back per field when the stored document is $stored', ({ stored, expected, invalid }) => {
    localStorage.setItem(key, JSON.stringify(stored))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createContext().store.document).toEqual(expected)
    expect(warning).toHaveBeenCalledExactlyOnceWith('[conversation-settings] Invalid stored fields reset to defaults:', invalid)
  })

  it.each(['{corrupt', '[]', 'null', '"texting"'])('replaces a stored document that is not an object (%s) with defaults', (value) => {
    localStorage.setItem(key, value)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createContext().store.document).toEqual(defaultConversationSettings())
    expect(warning).toHaveBeenCalledOnce()
  })

  it('drops unknown stored fields', () => {
    localStorage.setItem(key, JSON.stringify({ register: 'texting', extra: true }))
    expect(createContext().store.document).toEqual({ register: 'texting', textingFlavor: 'plain' })
  })

  it.each([{ register: 'TALKING' }, { register: 'whispering' }, { textingFlavor: 'slack' }, { extra: true }, [], null])('rejects invalid patches without changing state or storage: %j', async (patch) => {
    const { store } = createContext()
    await store.update({ register: 'texting' })
    const before = structuredClone(store.document)
    const stored = localStorage.getItem(key)
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const result = await store.update(patch)
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.issues.length).toBeGreaterThan(0)
    expect(store.document).toEqual(before)
    expect(localStorage.getItem(key)).toBe(stored)
  })

  it('replicates leader-owned updates without follower proposals or persistence', async () => {
    const namespace = `conversation:${crypto.randomUUID()}`
    const leader = createContext(namespace, 'leader-only')
    await coordinated(leader.runtime!, () => leader.runtime!.isLeader())
    const follower = createContext(namespace, 'follower-only')
    await coordinated(follower.runtime!, () => follower.runtime!.getLeaderId() === leader.runtime!.participantId)
    const persist = vi.spyOn(Storage.prototype, 'setItem')
    const leaderAction = vi.fn()
    leader.store.$onAction(leaderAction)
    let mutations = 0
    leader.store.$subscribe(() => mutations++, { flush: 'sync' })
    const snapshot = new Promise<void>((resolve) => {
      const stop = follower.store.$subscribe(() => {
        if (follower.store.document.register === 'texting') {
          stop()
          resolve()
        }
      }, { flush: 'sync' })
    })
    expect(await follower.store.update({ register: 'texting', textingFlavor: 'discord' })).toEqual({ success: true })
    await snapshot
    // A second leader-routed command is a transport barrier, not a timing wait.
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const rejected = await follower.store.update({ register: 'TEXTING' })
    expect(rejected.success).toBe(false)
    expect(leader.store.document).toEqual(follower.store.document)
    expect(leader.store.document).toEqual({ register: 'texting', textingFlavor: 'discord' })
    expect(mutations).toBe(1)
    expect(leaderAction).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(1)
    await follower.store.reset()
    expect(leader.store.document).toEqual(defaultConversationSettings())
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaultConversationSettings())
  })
})
