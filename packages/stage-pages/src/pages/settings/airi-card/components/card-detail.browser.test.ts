import en from '@proj-airi/i18n/locales/en'
import localforage from 'localforage'

import { DEFAULT_CHARACTER_PROFILE, initialCharacterState } from '@proj-airi/stage-shared/character-state'
import { exportAiriCardPackage } from '@proj-airi/stage-ui/services/airi-card-import-export'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { characterStateContext, useCharacterStateStore } from '@proj-airi/stage-ui/stores/character-state'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import CardDetail from './card-detail.vue'

import 'virtual:uno.css'

vi.mock('@proj-airi/stage-ui/services/airi-card-import-export', () => ({
  exportAiriCardPackage: vi.fn(async () => new Blob(['card'])),
}))
vi.mock('@proj-airi/stage-ui/composables/download', () => ({
  useDownload: () => ({ download: vi.fn() }),
}))

const records = localforage.createInstance({ name: 'airi-memory', storeName: 'entries' })

describe('card detail', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(async () => {
    await records.clear()
    vi.mocked(exportAiriCardPackage).mockClear()
    localStorage.clear()
    pinia = createPinia()
  })

  afterEach(async () => {
    cleanup()
    disposePinia(pinia)
    vi.unstubAllGlobals()
    localStorage.clear()
    await records.clear()
  })

  // The store calls `useI18n()` at its own setup, so the first call to
  // `useAiriCardStore` must happen while a component with the i18n plugin is
  // mounted. Mounting the detail on a placeholder id before the card exists
  // gives the store that context, and `rerender` then points it at the card.
  async function renderDetail() {
    const screen = await render(CardDetail, {
      props: { cardId: 'placeholder' },
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      },
    })
    const cardId = await useAiriCardStore(pinia).addCard({ name: 'Luna', version: '1.0.0' }, 'scratch')
    await screen.rerender({ cardId })
    return { screen, cardId }
  }

  it('exports only the card own persisted memories and its character state from a fresh store', async () => {
    const global = {
      plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
    }
    const host = await render(defineComponent({
      setup() {
        useAiriCardStore()
        return () => null
      },
    }), { global })
    const cardId = await useAiriCardStore(pinia).addCard({ name: 'Luna', version: '1.0.0' }, 'scratch')
    host.unmount()
    const own = { description: 'Favorite game', body: 'Minecraft.' }
    await records.setItem('own', { id: 'own', persona: cardId, updatedAt: 1, ...own })
    await records.setItem('general', { id: 'general', updatedAt: 2, description: 'Shared', body: 'Do not export.' })
    // The leader owns the record; this window only asks for it.
    const characterState = initialCharacterState(cardId, DEFAULT_CHARACTER_PROFILE, characterStateContext(Date.now()))
    const exportRecord = vi.spyOn(useCharacterStateStore(pinia), 'exportRecord').mockResolvedValue(characterState)

    const screen = await render(CardDetail, {
      props: { cardId },
      global,
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const exported = new Promise<Parameters<typeof exportAiriCardPackage>[0]>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Export did not start')), 5000)
      vi.mocked(exportAiriCardPackage).mockImplementationOnce(async (args) => {
        resolve(args)
        return new Blob(['card'])
      })
    })
    try {
      await screen.getByRole('button', { name: 'Export', exact: true }).click()
      const args = await exported
      expect(args.memories).toEqual([own])
      expect(exportRecord).toHaveBeenCalledWith(cardId)
      expect(args.characterState).toEqual(characterState)
      expect(exportAiriCardPackage).toHaveBeenCalledTimes(1)
    }
    finally {
      clearTimeout(timeout)
    }
  })

  it('pins a background to the card', async () => {
    const { screen, cardId } = await renderDetail()
    const backgroundStore = useBackgroundStore(pinia)
    const backgroundId = 'bg-test'
    await expect.poll(() => backgroundStore.loading).toBe(false)
    backgroundStore.entries = new Map([[backgroundId, {
      id: backgroundId,
      type: 'journal',
      characterId: cardId,
      title: 'Test image',
      blob: new Blob(['image'], { type: 'image/png' }),
      createdAt: 0,
    }]])
    await screen.rerender({ cardId })

    await expect.element(screen.getByRole('img', { name: 'Test image' })).toBeVisible()
    await screen.getByRole('button', { name: 'Set as background' }).click()

    await expect.poll(() => useAiriCardStore(pinia).cards.get(cardId)?.extensions.airi.modules.activeBackgroundId).toBe(backgroundId)
    backgroundStore.entries = new Map()
  })
})
