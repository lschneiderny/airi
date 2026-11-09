import type { InvokeEventa } from '@moeru/eventa'
import type { LeadershipMode } from '@proj-airi/stage-ui/libs/pinia/setup-synced'

import en from '@proj-airi/i18n/locales/en'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { PiniaColada } from '@pinia/colada'
import { capabilitiesForHost, presenceNoticeKey } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { useHostNoticeSettings } from '@proj-airi/stage-ui/features/host-capabilities/notice-settings'
import { setupSynced, usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia/setup-synced'
import { useModsServerChannelStore } from '@proj-airi/stage-ui/stores/mods/api/channel-server'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { toast, Toaster } from 'vue-sonner'

import { electronOpenSettings, electronStageGetState } from '../../shared/eventa'
import { usePresenceNotice } from './use-presence-notice'

const context = createContext()
vi.mock('@proj-airi/electron-vueuse', async () => {
  const { defineInvoke } = await import('@moeru/eventa')
  return {
    useElectronEventaContext: () => shallowRef(context),
    useElectronEventaInvoke: <Res, Req>(event: InvokeEventa<Res, Req>) => defineInvoke(context, event),
  }
})
// Data maintenance needs voice metadata, not a downloaded model runtime.
vi.mock('@proj-airi/stage-ui/libs/inference/adapters/kokoro', () => ({
  getKokoroAdapter: async () => ({
    state: 'ready',
    loadModel: vi.fn(async () => undefined),
    getVoices: () => ({}),
  }),
}))
defineInvokeHandler(context, electronStageGetState, () => ({ running: 'window' }))
defineInvokeHandler(context, electronOpenSettings, () => undefined)

const cleanups: Array<() => void> = []
const capabilities = capabilitiesForHost('linux-wayland')
const key = presenceNoticeKey(capabilities)

function mountWindow(leadership: LeadershipMode) {
  const pinia = createPinia()
  const synced = setupSynced({ leadership })
  pinia.use(synced.pinia)
  useHostCapabilitiesStore(pinia).set(capabilities)
  const channel = useModsServerChannelStore(pinia)
  void channel.initialize({ connector: () => ({
    connect: () => ({ send: vi.fn(), close: vi.fn() }),
  }) })
  let maintenance: ReturnType<typeof useDataMaintenance> | undefined
  let runtime: ReturnType<typeof usePiniaSynced> | undefined
  const view = render(defineComponent({
    setup() {
      runtime = usePiniaSynced()
      maintenance = useDataMaintenance()
      usePresenceNotice('index')
      // Both simulated windows share this JS realm's Sonner registry.
      // A single toaster renders the two owners' independently created notices.
      return () => leadership === 'leader-only' ? h(Toaster) : null
    },
  }), {
    global: {
      plugins: [pinia, synced.vue, PiniaColada, createI18n({ legacy: false, locale: 'en', messages: { en } })],
    },
  })
  cleanups.push(() => {
    view.unmount()
    channel.dispose()
    disposePinia(pinia)
  })
  if (!maintenance || !runtime)
    throw new Error('Window did not initialize')
  return { view, runtime, maintenance, settings: useHostNoticeSettings(pinia) }
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  toast.dismiss()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('replicates follower dismissal without proposals or persistence and restores both notices after Delete all data', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const leader = mountWindow('leader-only')
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  const follower = mountWindow('follower-only')
  await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
  await vi.waitFor(() => expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(2))
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  const actions: string[] = []
  leader.settings.$onAction(({ name }) => actions.push(name))
  let mutations = 0
  leader.settings.$subscribe(() => mutations++, { flush: 'sync' })

  // The follower was mounted last, so its notice is first in Sonner's list.
  await leader.view.getByRole('button', { name: 'Details' }).first().click()
  await vi.waitFor(() => {
    expect(leader.settings.document.dismissedKeys).toEqual([key])
    expect(follower.settings.document.dismissedKeys).toEqual([key])
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0)
  })
  expect(mutations).toBe(1)
  expect(actions).toEqual(['dismiss'])
  expect(persist.mock.calls.filter(([storageKey]) => storageKey === 'settings/host-notice')).toHaveLength(1)

  // This leader-routed reset also serves as a transport barrier for snapshot echoes.
  await follower.maintenance.deleteAllData()

  await vi.waitFor(() => {
    expect(leader.settings.document.dismissedKeys).toEqual([])
    expect(follower.settings.document.dismissedKeys).toEqual([])
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(2)
  })
  expect(mutations).toBe(2)
  expect(actions).toEqual(['dismiss', 'reset'])
  expect(persist.mock.calls.filter(([storageKey]) => storageKey === 'settings/host-notice')).toHaveLength(2)
  expect(JSON.parse(localStorage.getItem('settings/host-notice')!).dismissedKeys).toEqual([])
})
