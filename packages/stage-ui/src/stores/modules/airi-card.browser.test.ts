import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useAiriCardStore } from './airi-card'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en' }, t: (key: string) => key }),
}))

// ROOT CAUSE:
//
// `initialize()` looked up the module stores after an `await`, through the active Pinia.
// A stray action of a disposed Pinia could make that one active, so tests failed with `Pinia destroyed`.
//
// We fixed this by passing the card store's own Pinia to these lookups (upstream #3201).
describe('airi card store keeps to its own Pinia', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('initializes while another Pinia becomes active', async () => {
    const stale = createPinia()
    createApp({}).use(stale)
    disposePinia(stale)

    const pinia = createPinia()
    // Stands in for that stray action: every action of this Pinia hands the active Pinia back to the stale one.
    pinia.use(({ store }) => {
      store.$onAction(({ after, onError }) => {
        after(() => setActivePinia(stale))
        onError(() => setActivePinia(stale))
      })
    })
    createApp({}).use(pinia).use(PiniaColada)
    setActivePinia(pinia)
    const cardStore = useAiriCardStore()
    const initialized = cardStore.initialize()
    setActivePinia(stale)

    await expect(initialized).resolves.toBeUndefined()
    expect(cardStore.cards.has('default')).toBe(true)
    disposePinia(pinia)
  })
})
