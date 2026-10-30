import en from '@proj-airi/i18n/locales/en'

import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import MemoriesPage from './memory-long-term-memories.vue'

import 'virtual:uno.css'

/** Empties the memory records that the repo keeps in IndexedDB, so each case starts with no entries. */
async function clearMemories() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('airi-memory')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  if (database.objectStoreNames.contains('entries')) {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('entries', 'readwrite')
      transaction.objectStore('entries').clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }
  database.close()
}

let pinia: ReturnType<typeof createPinia>

beforeEach(async () => {
  localStorage.clear()
  await clearMemories()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(async () => {
  cleanup()
  disposePinia(pinia)
  localStorage.clear()
  await clearMemories()
})

async function renderMemories() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/settings/modules/memory-long-term-memories')

  return render(MemoriesPage, {
    global: {
      plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })],
    },
  })
}

describe('long-term memories page', () => {
  it('lists shared memories apart from each card, and only a card memory can be shared', async () => {
    const memory = useMemoryStore(pinia)
    const shared = (await memory.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'default'))!
    await memory.makeGeneral(shared)
    await memory.write({ description: 'What the owner plays.', body: 'Minecraft.' }, 'default')

    const screen = await renderMemories()

    await expect.element(screen.getByRole('heading', { name: /Shared memories/ })).toBeVisible()
    const general = screen.getByRole('heading', { name: /Shared memories/ }).element().closest('section')!
    expect(general.textContent).toContain('Yumeka.')
    expect(general.querySelector('[aria-label^="Share"]')).toBeNull()

    // No card store is seeded here, so the card group shows the card id.
    const card = screen.getByRole('heading', { name: /default/ }).element().closest('section')!
    expect(card.textContent).toContain('Minecraft.')
    await expect.element(screen.getByRole('button', { name: 'Share What the owner plays. with every character' })).toBeVisible()
  })

  it('forgets a memory from its card', async () => {
    const memory = useMemoryStore(pinia)
    await memory.write({ description: 'What the owner plays.', body: 'Minecraft.' }, 'default')
    const screen = await renderMemories()
    await expect.element(screen.getByText('Minecraft.')).toBeVisible()

    await screen.getByRole('button', { name: 'Forget What the owner plays.' }).click()

    await expect.element(screen.getByText('Minecraft.')).not.toBeInTheDocument()
    await expect.element(screen.getByText('No memories yet.').first()).toBeVisible()
  })
})
