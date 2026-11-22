import type { App } from 'vue'

import { defineStore, disposePinia, getActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'

import { mountRenderer } from './startup'

const main = vi.hoisted(() => ({ consent: vi.fn<(enabled: boolean) => Promise<void>>() }))
vi.mock('@proj-airi/electron-vueuse', () => ({ useElectronEventaInvoke: () => main.consent }))

// Minimal owners keep chat/provider work outside this test. The actual Pinia registration and RPC runtime run.
const useSessionOwner = defineStore('startup-session-owner', () => {
  const calls = ref(0)
  async function ensureCurrentSession() {
    calls.value++
    return calls.value
  }
  return { calls, ensureCurrentSession }
}, { synced: { state: true, actions: ['ensureCurrentSession'] } })
const useSpeechOwner = defineStore('startup-speech-owner', () => {
  const calls = ref(0)
  async function loadVoiceCatalog() {
    calls.value++
    return calls.value
  }
  return { calls, loadVoiceCatalog }
}, { synced: { state: true, actions: ['loadVoiceCatalog'] } })

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
  localStorage.clear()
  main.consent.mockReset()
  vi.unstubAllEnvs()
})

it('registers every owner before followers can call the elected leader, even while main consent is pending', async () => {
  vi.stubEnv('AIRI_ERROR_REPORT_DSN', '')
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  main.consent.mockImplementation(async () => {
    entered.resolve()
    await release.promise
  })
  const apps: App[] = []
  const starts: Promise<void>[] = []
  const start = (leadership: 'leader-only' | 'follower-only') => {
    const app = createApp({
      setup() {
        useSessionOwner()
        useSpeechOwner()
        return () => null
      },
    })
    apps.push(app)
    const ready = mountRenderer(app, leadership, () => {}, document.createElement('div'))
    starts.push(ready)
    return { app, ready }
  }
  cleanups.push(async () => {
    release.resolve()
    await Promise.all(starts)
    for (const app of apps.reverse()) {
      const pinia = app.runWithContext(getActivePinia)
      app.unmount()
      if (pinia)
        disposePinia(pinia)
    }
  })
  const leader = start('leader-only')
  let initialized = false
  const initialization = leader.ready.then(() => {
    initialized = true
  })
  await entered.promise
  const follower = start('follower-only')
  await follower.ready
  expect(await follower.app.runWithContext(() => useSessionOwner().ensureCurrentSession())).toBe(1)
  expect(await follower.app.runWithContext(() => useSpeechOwner().loadVoiceCatalog())).toBe(1)
  expect(main.consent).toHaveBeenCalledTimes(1)
  expect(initialized).toBe(false)
  release.resolve()
  await initialization
})
