import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import IndexTtsVllmPage from './index-tts-vllm.vue'

const pinia = createPinia()

afterEach(() => {
  disposePinia(pinia)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('loads IndexTTS voices on mount without an invalid watch source', async () => {
  localStorage.clear()
  const warnings = vi.spyOn(console, 'warn')
  vi.stubGlobal('fetch', async () => Response.json({ Narrator: {} }))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')

  await render(IndexTtsVllmPage, {
    global: {
      plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      directives: { motion: {} },
    },
  })

  await expect.poll(() => useSpeechStore(pinia).availableVoices['index-tts-vllm']?.map(voice => voice.id)).toEqual(['Narrator'])
  expect(warnings.mock.calls.filter(args => String(args[0]).includes('Invalid watch source'))).toEqual([])
})
