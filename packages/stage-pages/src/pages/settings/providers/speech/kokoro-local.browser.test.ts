import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { setupSynced, usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import KokoroLocalPage from './kokoro-local.vue'

vi.mock('@proj-airi/stage-shared/webgpu', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/stage-shared/webgpu')>(),
  getCachedWebGPUCapabilities: () => ({ supported: true, fp16Supported: false }),
}))

// Keep provider creation, validation, model selection and RPC real. Only the
// model-weight runtime is outside this page's initialization contract.
vi.mock('@proj-airi/stage-ui/libs/inference/adapters/kokoro', () => ({
  getKokoroAdapter: async () => ({
    state: 'ready',
    loadModel: async () => ({}),
    getVoices: () => ({ af_heart: { name: 'Heart', gender: 'Female', language: 'en-us' } }),
  }),
}))

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  localStorage.clear()
})

it('loads Kokoro voices in a fresh follower without sending an absent model configuration', async () => {
  localStorage.clear()
  const errors = vi.spyOn(console, 'error')
  const leaderSync = setupSynced({ leadership: 'leader-only' })
  const leaderPinia = createPinia().use(leaderSync.pinia)
  let leaderRuntime: ReturnType<typeof usePiniaSynced> | undefined
  const leader = createApp({
    setup() {
      leaderRuntime = usePiniaSynced()
      useSpeechStore()
      return () => null
    },
  })
  leader.use(leaderPinia).use(leaderSync.vue).use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
  leader.mount(document.createElement('div'))
  cleanups.push(() => {
    leader.unmount()
    disposePinia(leaderPinia)
  })
  await vi.waitFor(() => expect(leaderRuntime?.isLeader()).toBe(true))

  const followerSync = setupSynced({ leadership: 'follower-only' })
  const followerPinia = createPinia().use(followerSync.pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  const screen = await render(KokoroLocalPage, {
    global: {
      plugins: [followerPinia, followerSync.vue, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      directives: { motion: {} },
    },
  })
  cleanups.push(() => {
    screen.unmount()
    disposePinia(followerPinia)
  })

  await expect.poll(() => useSpeechStore(followerPinia).availableVoices['kokoro-local']?.map(voice => voice.id)).toEqual(['af_heart'])
  expect(errors.mock.calls.filter(args => String(args[0]).includes('[Kokoro Settings]'))).toEqual([])
})
