import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import AlibabaCloudModelStudioPage from './alibaba-cloud-model-studio.vue'
import DeepgramTtsPage from './deepgram-tts.vue'
import ElevenLabsPage from './elevenlabs.vue'
import VolcenginePage from './volcengine.vue'

const piniaInstances: ReturnType<typeof createPinia>[] = []

afterEach(() => {
  piniaInstances.splice(0).forEach(disposePinia)
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

it.each([
  ['alibaba-cloud-model-studio', AlibabaCloudModelStudioPage],
  ['deepgram-tts', DeepgramTtsPage],
  ['elevenlabs', ElevenLabsPage],
  ['volcengine', VolcenginePage],
] as const)('handles missing %s credentials without logging an error on page visit', async (providerId, component) => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const errors = vi.spyOn(console, 'error')
  const initialized = Promise.withResolvers<void>()
  const validationFinished = Promise.withResolvers<{ valid: boolean }>()
  const pinia = createPinia()
  piniaInstances.push(pinia)
  pinia.use(({ store }) => {
    if (store.$id !== 'provider')
      return
    store.$onAction(({ name, args, after }) => {
      if (name === 'initializeProvider' && args[0] === providerId)
        after(() => initialized.resolve())
      if (name === 'validateProviderConfig' && args[0] === providerId)
        after((result: { valid: boolean }) => validationFinished.resolve(result))
    })
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  await render(component, {
    global: {
      plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      directives: { motion: {} },
    },
  })

  await initialized.promise
  await vi.advanceTimersByTimeAsync(500)
  expect((await validationFinished.promise).valid).toBe(false)
  expect(errors.mock.calls.filter(args => String(args[0]).includes('Failed to validate provider config'))).toEqual([])
})
