import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { defaultSituationSettings, useSituationSettings } from './settings'

const key = 'settings/situation'
const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime?: SyncedPiniaRuntime }> = []

function createContext(namespace?: string, leadership?: LeadershipMode) {
  const pinia = createPinia()
  const runtime = namespace ? createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 }) : undefined
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: useSituationSettings(pinia), runtime }
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

describe('situation settings', () => {
  beforeEach(() => localStorage.clear())
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
    expect(store.document).toEqual({
      unpromptedEnabled: true,
      chattiness: 0.5,
      dontDisturb: false,
      shareForegroundWindow: true,
      shareBrowserActivity: true,
      quietApps: ['zoom.exe', 'ms-teams.exe', 'teams.exe', 'webex*.exe'],
      titleDenylist: ['1password*.exe', 'keepass*.exe', 'bitwarden.exe', 'keepassxc.exe'],
      showUnpromptedCue: true,
      speakDuringGames: true,
    })
    expect(localStorage.getItem(key)).toBeNull()
    expect(await store.update({ chattiness: 0.8, quietApps: ['zoom.exe', 'notepad.exe'] })).toEqual({ success: true })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(store.document)
    expect(store.document.chattiness).toBe(0.8)
    expect(Object.keys(localStorage).filter(storageKey => storageKey.startsWith('settings/situation'))).toEqual([key])
    await store.reset()
    expect(store.document).toEqual(defaultSituationSettings())
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaultSituationSettings())
  })

  it('falls back per field when a stored field is invalid', () => {
    localStorage.setItem(key, JSON.stringify({ chattiness: 'banana', quietApps: ['notepad.exe'], dontDisturb: true }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = createContext()
    expect(store.document).toEqual({ ...defaultSituationSettings(), quietApps: ['notepad.exe'], dontDisturb: true })
    expect(warning).toHaveBeenCalledExactlyOnceWith('[situation-settings] Invalid stored fields reset to defaults:', 'chattiness')
  })

  it.each(['{corrupt', '[]', 'null', '"banana"'])('replaces a stored document that is not an object (%s) with defaults', (value) => {
    localStorage.setItem(key, value)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createContext().store.document).toEqual(defaultSituationSettings())
    expect(warning).toHaveBeenCalledOnce()
  })

  it.each([
    { stored: 7, expected: 1 },
    { stored: -2, expected: 0 },
    { stored: 0.35, expected: 0.35 },
  ])('clamps a stored chattiness of $stored to $expected', ({ stored, expected }) => {
    localStorage.setItem(key, JSON.stringify({ chattiness: stored }))
    const warning = vi.spyOn(console, 'warn')
    expect(createContext().store.document).toEqual({ ...defaultSituationSettings(), chattiness: expected })
    expect(warning).not.toHaveBeenCalled()
  })

  it('drops unknown fields, blank and repeated app entries from storage', () => {
    localStorage.setItem(key, JSON.stringify({ extra: true, quietApps: ['  notepad.exe ', '', '   ', 'notepad.exe', 'zoom.exe'], titleDenylist: [] }))
    const { store } = createContext()
    expect(store.document).toEqual({ ...defaultSituationSettings(), quietApps: ['notepad.exe', 'zoom.exe'], titleDenylist: [] })
  })

  it('clamps and normalizes valid patches', async () => {
    const { store } = createContext()
    expect(await store.update({ chattiness: 2, titleDenylist: [' keepass*.exe', '', 'keepass*.exe'] })).toEqual({ success: true })
    expect(store.document.chattiness).toBe(1)
    expect(store.document.titleDenylist).toEqual(['keepass*.exe'])
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(store.document)
  })

  it.each([{ chattiness: 'banana' }, { chattiness: Number.NaN }, { quietApps: 'zoom.exe' }, { quietApps: [1] }, { extra: true }, [], null])('rejects invalid patches without changing state or storage: %j', async (patch) => {
    const { store } = createContext()
    await store.update({ dontDisturb: true })
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
    const namespace = `situation:${crypto.randomUUID()}`
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
        if (follower.store.document.chattiness === 0.8) {
          stop()
          resolve()
        }
      }, { flush: 'sync' })
    })
    expect(await follower.store.update({ chattiness: 0.8, quietApps: ['notepad.exe'], shareForegroundWindow: false })).toEqual({ success: true })
    await snapshot
    // A second leader-routed command is a transport barrier, not a timing wait.
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const rejected = await follower.store.update({ chattiness: 'banana' })
    expect(rejected.success).toBe(false)
    expect(leader.store.document).toEqual(follower.store.document)
    expect(leader.store.document.quietApps).toEqual(['notepad.exe'])
    expect(leader.store.document.shareForegroundWindow).toBe(false)
    expect(mutations).toBe(1)
    expect(leaderAction).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(1)
    await follower.store.reset()
    expect(leader.store.document).toEqual(defaultSituationSettings())
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaultSituationSettings())
  })
})
