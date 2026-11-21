import type { ElectronServerChannelConfig } from '../../shared/eventa'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { electronApplyServerChannelConfig, electronGetServerChannelConfig } from '../../shared/eventa'
import { useServerChannelSettingsStore } from '../stores/settings/server-channel'
import { createMainProcessDataDeletion } from './main-process-data-deletion'

/** The main process's server channel config, which applying an empty token gives a new one. */
const main = vi.hoisted(() => ({ config: { authToken: 'old-token', hostname: '192.0.2.10', tlsConfig: null } as ElectronServerChannelConfig }))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: unknown) => {
    if (event === electronGetServerChannelConfig)
      return async () => main.config
    if (event === electronApplyServerChannelConfig) {
      return async (config: Partial<ElectronServerChannelConfig>) => {
        main.config = { hostname: config.hostname ?? main.config.hostname, tlsConfig: config.tlsConfig ?? null, authToken: config.authToken || 'new-token' }
        return main.config
      }
    }
    return async () => {}
  },
}))

// The node project has no localStorage; the settings keep their values in memory.
vi.mock('@vueuse/core', () => ({ useLocalStorage: <T>(_key: string, initialValue: T) => ref(initialValue) }))

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn() } }))

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  disposePinia(pinia)
})

// ROOT CAUSE:
// "Delete all data" removed the renderer's copy of the desktop server channel token, but the main process kept the
// token, and this window's settings kept it in memory, so the old token still opened the channel.
it('replaces the desktop server channel token and shows the new one in this window', async () => {
  const settings = useServerChannelSettingsStore()
  await vi.waitFor(() => expect(settings.authToken).toBe('old-token'))

  await createMainProcessDataDeletion()()

  expect(main.config).toEqual({ authToken: 'new-token', hostname: '127.0.0.1', tlsConfig: null })
  expect(settings.authToken).toBe('new-token')
  expect(settings.hostname).toBe('127.0.0.1')
})
