import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App, WritableComputedRef } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import { useProviderConfigStore } from '../stores/providers/config'
import { useProviderStore } from '../stores/providers/provider'
import { useProviderValidation } from './use-provider-validation'

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function createContext(namespace: string, leadership: LeadershipMode, providerId?: string) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ callTimeout: 1000, leadership, namespace })
  pinia.use(runtime.plugin)
  let providerConfigStore: ReturnType<typeof useProviderConfigStore> | undefined
  let validation: ReturnType<typeof useProviderValidation> | undefined
  const app = createApp({
    setup() {
      useProviderStore()
      providerConfigStore = useProviderConfigStore()
      if (providerId)
        validation = useProviderValidation(providerId)
      return () => null
    },
  })
  app
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    .use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }))
    .use(pinia)
  contexts.push({ app, pinia, runtime })
  return { app, providerConfigStore: () => providerConfigStore!, validation: () => validation!, runtime }
}

describe('useProviderValidation', () => {
  beforeEach(() => {
    localStorage.clear()
    // Anthropic rejects the OpenAI-style models probe; connectivity still passes.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 })))
  })

  afterEach(() => {
    for (const context of contexts.splice(0)) {
      context.app.unmount()
      context.runtime.dispose()
      disposePinia(context.pinia)
    }
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // ROOT CAUSE:
  //
  // Provider settings pages wrote the key through the `configs` computed
  // projection. In the follower-only Electron settings window that write never
  // reached the leader-owned provider snapshot, so the key vanished and
  // validation never ran.
  it('saves a key entered in a follower window through the leader and validates it', async () => {
    const namespace = `provider-validation:${crypto.randomUUID()}`
    const leader = createContext(namespace, 'leader-only')
    leader.app.mount(document.createElement('div'))
    await expect.poll(() => leader.runtime.isLeader()).toBe(true)

    const follower = createContext(namespace, 'follower-only', 'anthropic')
    await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
    follower.app.mount(document.createElement('div'))

    const setProviderStatus = vi.spyOn(follower.providerConfigStore(), 'setProviderStatus')
    const markProviderAdded = vi.spyOn(follower.providerConfigStore(), 'markProviderAdded')
    const apiKey: WritableComputedRef<string> = follower.validation().apiKey
    apiKey.value = 'sk-ant-test'
    expect(apiKey.value).toBe('sk-ant-test')

    await expect.poll(() => leader.providerConfigStore().getProviderConfig('anthropic')?.apiKey, { timeout: 3000 })
      .toBe('sk-ant-test')
    await expect.poll(() => leader.providerConfigStore().providers.anthropic?.status, { timeout: 3000 })
      .toBe('configured')
    expect(follower.validation().isValid.value).toBe(true)
    expect(apiKey.value).toBe('sk-ant-test')

    // A committed snapshot can arrive before the follower's RPC replies.
    // Settle both validation follow-up actions before disposing their runtime.
    expect(setProviderStatus).toHaveBeenCalledWith('anthropic', 'configured')
    expect(markProviderAdded).toHaveBeenCalledWith('anthropic')
    await Promise.all([
      ...setProviderStatus.mock.results.map(result => result.value),
      ...markProviderAdded.mock.results.map(result => result.value),
    ])
  })
})
