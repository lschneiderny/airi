import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from './auth'
import { useFeatureFlagsStore } from './feature-flags'

describe('account-free feature policies', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.stubEnv('VITE_CLOUD_URL', 'https://cloud.example.test')
  })

  afterEach(() => {
    disposePinia(pinia)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('keeps signed-out startup and explicit policy refresh offline', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ flags: [] }))
    const store = useFeatureFlagsStore()

    await useAuthStore().initialize()
    await store.refresh()

    expect(network).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
    expect(store.error).toBeUndefined()
  })
})
