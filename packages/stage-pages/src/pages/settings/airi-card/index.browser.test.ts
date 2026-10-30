import en from '@proj-airi/i18n/locales/en'
import localforage from 'localforage'

import { exportToJSON } from '@proj-airi/ccc'
import { importAiriCardPackage } from '@proj-airi/stage-ui/services/airi-card-import-export'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import AiriCards from './index.vue'

import 'virtual:uno.css'

vi.mock('@proj-airi/stage-ui/services/airi-card-import-export', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/stage-ui/services/airi-card-import-export')>(),
  importAiriCardPackage: vi.fn(),
}))
vi.mock('vue-sonner', async importOriginal => ({
  ...await importOriginal<typeof import('vue-sonner')>(),
  toast: vi.fn(),
}))

const records = localforage.createInstance({ name: 'airi-memory', storeName: 'entries' })
const InputFileCardStub = defineComponent({
  emits: ['update:modelValue'],
  setup: (_, { emit }) => () => h('button', { onClick: () => emit('update:modelValue', [new File(['zip'], 'card.zip')]) }, 'Import fixture'),
})
let pinia: ReturnType<typeof createPinia>

beforeEach(async () => {
  localStorage.clear()
  await records.clear()
  pinia = createPinia()
  let now = 1
  vi.spyOn(Date, 'now').mockImplementation(() => now++)
})

afterEach(async () => {
  cleanup()
  disposePinia(pinia)
  vi.restoreAllMocks()
  localStorage.clear()
  await records.clear()
})

it('restores imported memories in order under the newly created card id', async () => {
  const memories = [{ description: 'First', body: 'Tea.' }, { description: 'Second', body: 'Minecraft.' }]
  vi.mocked(importAiriCardPackage).mockResolvedValue({ card: exportToJSON({ name: 'Imported Luna', version: '1.0.0' }), memories })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: AiriCards }] })
  await router.push('/')
  const screen = await render(AiriCards, {
    global: {
      plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: { InputFileCard: InputFileCardStub },
    },
  })
  const cards = useAiriCardStore(pinia)
  const memory = useMemoryStore(pinia)
  let newCardId = ''
  cards.$onAction(({ name, after }) => {
    if (name === 'addCard')
      after((id) => { newCardId = id })
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  const imported = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Import did not finish')), 5000)
    vi.mocked(toast).mockImplementationOnce(() => {
      resolve()
      return 'imported'
    })
  })
  try {
    await screen.getByRole('button', { name: 'Import fixture' }).click()
    await imported
    expect(cards.getCard(newCardId)?.name).toBe('Imported Luna')
    expect(memory.entries.map(({ description, body, persona }) => ({ description, body, persona }))).toEqual(memories.map(entry => ({ ...entry, persona: newCardId })))
  }
  finally {
    clearTimeout(timeout)
  }
})
