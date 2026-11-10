import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useMMDNaturalSettings } from './natural-settings'

const key = 'settings/mmd/natural'
const defaults = {
  energy: 0.5,
  touch: true,
  touchPetRequiresHold: false,
  emotionStrength: {},
}
const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime?: SyncedPiniaRuntime }> = []

function createContext(namespace?: string, leadership?: LeadershipMode) {
  const pinia = createPinia()
  const runtime = namespace ? createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 }) : undefined
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: useMMDNaturalSettings(pinia), runtime }
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

function naturalKeys() {
  return Object.keys(localStorage).filter(storageKey => storageKey.startsWith('settings/mmd/natural')).sort()
}

describe('mmd natural settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    for (const { pinia, runtime } of contexts.splice(0)) {
      runtime?.dispose()
      disposePinia(pinia)
    }
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loads defaults and persists updates and resets as one document', async () => {
    const { store } = createContext()
    expect(store.document).toEqual(defaults)
    expect(localStorage.getItem(key)).toBeNull()

    expect(await store.update({ energy: 0.8, touchPetRequiresHold: true })).toEqual({ success: true })
    expect(store.document).toEqual({ ...defaults, energy: 0.8, touchPetRequiresHold: true })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(store.document)
    expect(naturalKeys()).toEqual([key])

    await store.reset()
    expect(store.document).toEqual(defaults)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaults)
  })

  it('clamps energy and emotion strengths and drops invalid strength entries', async () => {
    const { store } = createContext()
    // @ts-expect-error Deliberately exercise malformed runtime input inside a valid record.
    expect(await store.update({ energy: 3, emotionStrength: { shuka: { happy: 5, sad: 'x' }, empty: { love: null } } })).toEqual({ success: true })
    expect(store.document.energy).toBe(1)
    expect(store.document.emotionStrength).toEqual({ shuka: { happy: 2 } })
  })

  it.each([{ energy: 'banana' }, { energy: Number.NaN }, { touch: 'yes' }, { cursorAttention: false }, { extra: true }, [], null])('rejects invalid patches without changing state or storage: %j', async (patch) => {
    const { store } = createContext()
    await store.update({ touch: false })
    const before = structuredClone(store.document)
    const stored = localStorage.getItem(key)
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const result = await store.update(patch)
    expect(result.success).toBe(false)
    expect(store.document).toEqual(before)
    expect(localStorage.getItem(key)).toBe(stored)
  })

  it('falls back per field when a stored field is invalid', () => {
    localStorage.setItem(key, JSON.stringify({ energy: 'banana', touch: false, extra: 1 }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createContext().store.document).toEqual({ ...defaults, touch: false })
    expect(warning).toHaveBeenCalledExactlyOnceWith('[mmd-natural-settings] Invalid stored fields reset to defaults:', 'energy')
  })

  // ROOT CAUSE:
  //
  // Before the settings document, each Natural setting was its own localStorage key that any window wrote. A profile
  // saved by that version has no document, so reading only the document would silently reset every Natural setting.
  //
  // The store starts from the old keys while no document is stored, and the first committed change writes the
  // document and deletes them.
  it('starts from the settings of a profile saved before the document, then replaces its keys', async () => {
    localStorage.setItem('settings/mmd/natural-energy', '0.85')
    localStorage.setItem('settings/mmd/natural-touch-pet-requires-hold', 'true')
    localStorage.setItem('settings/mmd/natural-emotion-strength', JSON.stringify({ ellen: { happy: 1.5, sad: 9 } }))
    localStorage.setItem('settings/mmd/natural-touch', '{corrupt')

    const { store } = createContext()

    expect(store.document).toEqual({
      ...defaults,
      energy: 0.85,
      touchPetRequiresHold: true,
      emotionStrength: { ellen: { happy: 1.5, sad: 2 } },
    })
    // Reading alone writes nothing: a follower may be the first window to read.
    expect(localStorage.getItem(key)).toBeNull()

    await store.update({ touch: false })

    expect(naturalKeys()).toEqual([key])
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ ...store.document, touch: false })
    expect(store.document.energy).toBe(0.85)
  })

  it('prefers a stored document over leftover keys and resets to defaults, not to the old keys', async () => {
    localStorage.setItem('settings/mmd/natural-energy', '0.85')
    localStorage.setItem(key, JSON.stringify({ energy: 0.2 }))
    const { store } = createContext()
    expect(store.document.energy).toBe(0.2)

    await store.reset()

    expect(store.document).toEqual(defaults)
    expect(naturalKeys()).toEqual([key])
  })

  it('replicates leader-owned updates without follower proposals or persistence', async () => {
    const namespace = `mmd-natural:${crypto.randomUUID()}`
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
        if (follower.store.document.energy === 0.8) {
          stop()
          resolve()
        }
      }, { flush: 'sync' })
    })

    expect(await follower.store.update({ energy: 0.8, touch: false })).toEqual({ success: true })
    await snapshot
    // A second leader-routed command is a transport barrier, not a timing wait.
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const rejected = await follower.store.update({ energy: 'banana' })

    expect(rejected.success).toBe(false)
    expect(leader.store.document).toEqual(follower.store.document)
    expect(leader.store.document.touch).toBe(false)
    expect(mutations).toBe(1)
    expect(leaderAction).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(1)

    await follower.store.reset()
    expect(leader.store.document).toEqual(defaults)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaults)
  })
})
