import en from '@proj-airi/i18n/locales/en'
import localforage from 'localforage'

import { CHARACTER_CARD_SYNC_FLAG } from '@proj-airi/stage-ui/libs/feature-flags'
import { exportAiriCardPackage } from '@proj-airi/stage-ui/services/airi-card-import-export'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useFeatureFlagsStore } from '@proj-airi/stage-ui/stores/feature-flags'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import CardDetailDialog from './CardDetailDialog.vue'

import 'virtual:uno.css'

vi.mock('@proj-airi/stage-ui/services/airi-card-import-export', () => ({
  exportAiriCardPackage: vi.fn(async () => new Blob(['card'])),
}))
vi.mock('@proj-airi/stage-ui/composables/download', () => ({
  useDownload: () => ({ download: vi.fn() }),
}))

const records = localforage.createInstance({ name: 'airi-memory', storeName: 'entries' })

function signIn(auth: ReturnType<typeof useAuthStore>) {
  const user = { id: 'alice', name: 'Alice', email: 'alice@example.com', emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) }
  const session = { id: 'session-alice', userId: 'alice', token: 'test-token', expiresAt: new Date('2099-01-01'), createdAt: new Date(0), updatedAt: new Date(0) }
  auth.$patch({ user, session })
}

describe('card detail dialog history tab', () => {
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
  // mounted. Mounting the dialog on a placeholder id before the card exists
  // gives the store that context, and `rerender` then points it at the card.
  async function renderDialog() {
    const screen = await render(CardDetailDialog, {
      props: { modelValue: true, cardId: 'placeholder', initialTab: 'history' },
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      },
    })
    const cardId = await useAiriCardStore(pinia).addCard({ name: 'Luna', version: '1.0.0' }, 'scratch')
    await screen.rerender({ cardId })
    return { screen, cardId }
  }

  it('exports only the card own persisted memories from a fresh store', async () => {
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

    const screen = await render(CardDetailDialog, {
      props: { modelValue: true, cardId },
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
      expect((await exported).memories).toEqual([own])
      expect(exportAiriCardPackage).toHaveBeenCalledTimes(1)
    }
    finally {
      clearTimeout(timeout)
    }
  })

  it('does not offer a history tab for a user who is not signed in', async () => {
    const { screen } = await renderDialog()

    expect(screen.getByText('History').elements()).toHaveLength(0)
  })

  it('shows the past revisions of a card and restores one', async () => {
    const { screen, cardId } = await renderDialog()
    signIn(useAuthStore(pinia))
    useFeatureFlagsStore(pinia).setPreference(CHARACTER_CARD_SYNC_FLAG.key, true)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/${encodeURIComponent(cardId)}/history/1`)) {
        return Response.json({ revision: 1, at: '2026-01-01T00:00:00.000Z', fields: [{ key: '/name', value: 'Nova' }, { key: '/version', value: '1.0.0' }] })
      }
      if (url.includes(`/${encodeURIComponent(cardId)}/history`)) {
        return Response.json({
          history: [{ revision: 2, at: '2026-01-02T00:00:00.000Z', changed: ['/name'], removed: [] }, { revision: 1, at: '2026-01-01T00:00:00.000Z', changed: ['/name'], removed: [] }],
        })
      }
      if (url.includes('/api/v1/character-cards'))
        return Response.json({ documents: [] })

      // The signed-in app also runs unrelated background requests, such as the
      // Flux balance and card asset preloading. The history tab does not
      // depend on them, so a generic empty response keeps the test focused.
      return new Response(null, { status: 404 })
    })
    // Signing in changes the available tabs. Force the dialog to read them again.
    await screen.rerender({ cardId })
    await screen.getByRole('button', { name: 'History' }).click()

    // The newest entry is the current content, so it carries a badge and no restore button.
    await expect.element(screen.getByText('Current')).toBeVisible()
    await expect.element(screen.getByText('Changed').first()).toBeVisible()
    await expect.element(screen.getByText('Name').first()).toBeVisible()

    // Only the older revision offers a restore, and it asks through a dialog.
    await screen.getByRole('button', { name: 'Restore this version' }).click()
    await expect.element(screen.getByText('Restore this version?')).toBeVisible()
    await screen.getByRole('button', { name: 'Restore', exact: true }).click()

    await expect.poll(() => useAiriCardStore(pinia).cards.get(cardId)?.name).toBe('Nova')
  })

  it('does not offer a history tab for a signed-in user who has not turned cloud sync on', async () => {
    const { screen, cardId } = await renderDialog()

    signIn(useAuthStore(pinia))
    await screen.rerender({ cardId })

    expect(screen.getByText('History').elements()).toHaveLength(0)
  })
})
