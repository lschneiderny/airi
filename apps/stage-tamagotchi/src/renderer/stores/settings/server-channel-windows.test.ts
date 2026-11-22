import type { Ref } from 'vue'

import type { ElectronServerChannelConfig } from '../../../shared/eventa'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref, watch } from 'vue'

import { electronApplyServerChannelConfig, electronGetServerChannelConfig } from '../../../shared/eventa'
import { createMainProcessDataDeletion } from '../../composables/main-process-data-deletion'
import { useServerChannelSettingsStore } from './server-channel'

/**
 * Stands in for the main process: the server channel config and the number of times a window applied one. An empty
 * token gets a new one, as the real main process does, and a changed config restarts the server channel.
 */
const main = vi.hoisted(() => ({
  config: { authToken: 'old-token', hostname: '127.0.0.1', tlsConfig: null } as ElectronServerChannelConfig,
  applies: 0,
  restarts: 0,
  tokens: 0,
}))

/** More applies than this mean that the windows keep applying each other's values. */
const applyLimit = 60

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: unknown) => {
    if (event === electronGetServerChannelConfig)
      return async () => ({ ...main.config })
    if (event === electronApplyServerChannelConfig) {
      return async (config: Partial<ElectronServerChannelConfig>) => {
        // An IPC round trip ends in a later task than the one that sent it.
        await new Promise(resolve => setTimeout(resolve, 0))
        if (++main.applies > applyLimit)
          throw new Error('The windows apply the server channel config without end')
        const next = { hostname: config.hostname ?? main.config.hostname, tlsConfig: config.tlsConfig ?? null, authToken: config.authToken || `new-token-${++main.tokens}` }
        if (next.authToken !== main.config.authToken || next.hostname !== main.config.hostname)
          main.restarts++
        main.config = next
        return { ...next }
      }
    }
    return async () => {}
  },
}))

interface StorageCopy {
  value: Ref<unknown>
  initialValue: unknown
  listens: boolean
}

/** The localStorage values of the app's windows, and each window's reactive copy of one key. */
const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  copies: new Map<string, Set<StorageCopy>>(),
}))

// The node project has no localStorage. Like VueUse, a copy follows the writes of other windows unless it opts out.
vi.mock('@vueuse/core', () => ({
  useLocalStorage: <T>(key: string, initialValue: T, options?: { listenToStorageChanges?: boolean }) => {
    const copy: StorageCopy = {
      value: ref(storage.values.has(key) ? storage.values.get(key) as T : initialValue) as Ref<unknown>,
      initialValue,
      listens: options?.listenToStorageChanges ?? true,
    }
    const copies = storage.copies.get(key) ?? new Set()
    storage.copies.set(key, copies)
    copies.add(copy)
    watch(copy.value, (value) => {
      storage.values.set(key, value)
      // A storage event reaches the other windows in a later task.
      setTimeout(() => {
        for (const other of copies) {
          if (other !== copy && other.listens && other.value.value !== value)
            other.value.value = value
        }
      }, 0)
    })
    return copy.value
  },
}))

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn() } }))

const piniaOfWindows: ReturnType<typeof createPinia>[] = []

beforeEach(() => {
  // The simulated storage events and IPC answers are timers, so running them all ends the exchange of the windows.
  vi.useFakeTimers()
  main.config = { authToken: 'old-token', hostname: '127.0.0.1', tlsConfig: null }
  main.applies = 0
  main.restarts = 0
  main.tokens = 0
  storage.values.clear()
  storage.copies.clear()
})

afterEach(() => {
  vi.useRealTimers()
  for (const pinia of piniaOfWindows.splice(0))
    disposePinia(pinia)
})

function openWindow() {
  const pinia = createPinia()
  piniaOfWindows.push(pinia)
  setActivePinia(pinia)
  return { pinia, settings: useServerChannelSettingsStore(pinia) }
}

/** The state registry removes a key in the deleting window; the other windows get a storage event with no value. */
function removeStoredKey(key: string) {
  storage.values.delete(key)
  setTimeout(() => {
    for (const copy of storage.copies.get(key) ?? []) {
      if (copy.listens)
        copy.value.value = copy.initialValue
    }
  }, 0)
}

/** Runs the pending storage events and IPC answers until the windows stop exchanging them, or until `steps` ran. */
async function settle(steps = 500) {
  await vi.advanceTimersByTimeAsync(0)
  for (let step = 0; step < steps && vi.getTimerCount() > 0; step++)
    await vi.advanceTimersToNextTimerAsync()
  expect(vi.getTimerCount()).toBe(0)
}

// ROOT CAUSE:
// Every window applied each change of the stored server channel config, also one that another window made. "Delete all
// data" removes the stored token, so each window applied an empty token, the main process gave each one a new token, and
// each window then applied the token that it read from another one, which restarted the server channel without end.
it('restarts the server channel once when "Delete all data" runs with several windows open', async () => {
  const stage = openWindow()
  const settings = openWindow()
  const onboarding = openWindow()
  await settle()
  expect(stage.settings.authToken).toBe('old-token')
  expect(settings.settings.authToken).toBe('old-token')
  expect(onboarding.settings.authToken).toBe('old-token')

  removeStoredKey('settings/server-channel/auth-token')
  setActivePinia(stage.pinia)
  const deletion = createMainProcessDataDeletion()()
  await settle()
  await deletion

  expect(main.applies).toBe(1)
  expect(main.restarts).toBe(1)
  expect(main.config.authToken).toBe('new-token-1')
})
