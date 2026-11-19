import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useHostNoticeSettings } from './notice-settings'

const key = 'settings/host-notice'
const pinias: Array<ReturnType<typeof createPinia>> = []

function createStore() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  pinias.push(pinia)
  return useHostNoticeSettings(pinia)
}

describe('host notice settings', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    for (const pinia of pinias.splice(0))
      disposePinia(pinia)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('restores a stored document', () => {
    localStorage.setItem(key, JSON.stringify({ dismissedKeys: ['electron:a', 'electron:b'] }))
    expect(createStore().document).toEqual({ dismissedKeys: ['electron:a', 'electron:b'] })
  })

  it('keeps the dismissed keys when the stored document has an unknown field', () => {
    localStorage.setItem(key, JSON.stringify({ dismissedKeys: ['electron:a'], extra: true }))
    expect(createStore().document).toEqual({ dismissedKeys: ['electron:a'] })
  })

  it('dismisses a key once however often it is asked', async () => {
    const store = createStore()
    await store.dismiss('electron:a')
    await store.dismiss('electron:a')
    expect(store.document).toEqual({ dismissedKeys: ['electron:a'] })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ dismissedKeys: ['electron:a'] })
  })
})
