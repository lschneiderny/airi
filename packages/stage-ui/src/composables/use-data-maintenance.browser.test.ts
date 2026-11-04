import type { LeadershipMode } from 'pinia-plugin-synced'

import en from '@proj-airi/i18n/locales/en'
import localforage from 'localforage'

import { PiniaColada } from '@pinia/colada'
import { useMMD } from '@proj-airi/stage-ui-mmd/stores/mmd'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { useSituationSettings } from '../features/situation/settings'
import { injectKeyPiniaSynced } from '../libs/pinia/synced-context'
import { useCharacterStateStore } from '../stores/character-state'
import { useMemoryStore } from '../stores/memory'
import { useModsServerChannelStore } from '../stores/mods/api/channel-server'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useConsciousnessSettingsStore } from '../stores/modules/consciousness-settings'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useMinecraftStore } from '../stores/modules/gaming-minecraft'
import { useHearingStore } from '../stores/modules/hearing'
import { useHomeAssistantStore } from '../stores/modules/home-assistant'
import { useSpeechStore } from '../stores/modules/speech'
import { useTwitterStore } from '../stores/modules/twitter'
import { useWebSearchStore } from '../stores/modules/web-search'
import { useDataMaintenance } from './use-data-maintenance'

const cleanups: Array<() => void> = []

/** Mounts the maintenance composable with real stores and a separate synchronization runtime. */
function mountMaintenance(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  pinia.use(runtime.plugin)
  // https://github.com/moeru-ai/airi/pull/2477
  // ROOT CAUSE:
  // Maintenance initializes the module channel. A local server can send events
  // after this test destroys Pinia. Isolate the transport and close it before teardown.
  const channel = useModsServerChannelStore(pinia)
  void channel.initialize({ connector: () => ({
    connect: () => ({ send: vi.fn(), close: vi.fn() }),
  }) })
  let maintenance: ReturnType<typeof useDataMaintenance> | undefined
  const app = createApp({
    setup() {
      maintenance = useDataMaintenance()
      return () => null
    },
  })
  app.provide(injectKeyPiniaSynced, runtime)
    .use(pinia)
    .use(PiniaColada)
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    .mount(document.createElement('div'))
  cleanups.push(() => {
    app.unmount()
    channel.dispose()
    disposePinia(pinia)
    runtime.dispose()
  })
  if (!maintenance)
    throw new Error('Maintenance composable did not initialize')
  return { pinia, runtime, maintenance }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

// https://github.com/moeru-ai/airi/pull/2490#discussion_r3968502055
// ROOT CAUSE: Sequential awaits stopped independent module cleanup after one
// leader RPC failed. Every reset must settle before the caller receives the error.
it.each(['resetSettings', 'resetState'])('continues independent module resets when the %s RPC fails', async (action) => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const namespace = `maintenance:${crypto.randomUUID()}`
  const leader = mountMaintenance(namespace, 'leader-only')
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  const follower = mountMaintenance(namespace, 'follower-only')
  await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
  const { pinia } = follower
  await useConsciousnessSettingsStore(pinia).setReasoning(true)
  useMinecraftStore(pinia).latestRuntimeContextText = 'previous context'
  // A policy that a module reset must clear, so the picker cannot restore it.
  const homeAssistant = useHomeAssistantStore(pinia)
  homeAssistant.exposureMode = 'deny'
  homeAssistant.deniedEntities = ['lock.front_door']
  const modules = [
    useHearingStore(pinia),
    homeAssistant,
    useSpeechStore(pinia),
    useConsciousnessStore(pinia),
    useTwitterStore(pinia),
    useWebSearchStore(pinia),
    useDiscordStore(pinia),
    useFactorioStore(pinia),
    useMinecraftStore(pinia),
  ]
  const resetModules: string[] = []
  for (const module of modules) {
    module.$onAction(({ name }) => {
      if (name === 'resetState')
        resetModules.push(module.$id)
    })
  }
  const postMessage = BroadcastChannel.prototype.postMessage
  vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(function (this: BroadcastChannel, message) {
    if (JSON.stringify(message).includes(`"${action}"`))
      throw new Error('Reset transport unavailable')
    postMessage.call(this, message)
  })
  await expect(follower.maintenance.resetModulesSettings()).rejects.toThrow('Reset transport unavailable')
  expect(resetModules).toEqual(modules.map(module => module.$id))
  expect(useMinecraftStore(pinia).latestRuntimeContextText).toBe('')
  expect(homeAssistant.exposureMode).toBe('all')
  expect(homeAssistant.deniedEntities).toEqual([])
  expect(useConsciousnessSettingsStore(leader.pinia).reasoning).toBe(action === 'resetState')
})

it('removes downloaded speech models when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const origin = await navigator.storage.getDirectory()
  const root = await origin.getDirectoryHandle('airi-model-assets', { create: true })
  const stored = await (await root.getDirectoryHandle('speech', { create: true }))
    .getDirectoryHandle('v1', { create: true })
  const writable = await (await stored.getFileHandle('data', { create: true })).createWritable()
  await writable.write('model data')
  await writable.close()
  const { runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))

  await maintenance.deleteAllData()

  await expect(origin.getDirectoryHandle('airi-model-assets')).rejects.toThrow()
})

it('forgets derived conversation state, presence, expression, and MMD settings when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  localStorage.setItem('settings/situation-inner', JSON.stringify({ v: 1, threads: [], savedAtMs: 1 }))
  // Documents of a model that is not loaded must go too.
  localStorage.setItem('expression-catalog:unloaded-model', JSON.stringify({ version: 1, overrides: [] }))
  localStorage.setItem('expression-rest:unloaded-model', JSON.stringify({ version: 1, active: [] }))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const situationSettings = useSituationSettings(pinia)
  const expressionSettings = useExpressionPerformanceSettings(pinia)
  const mmd = useMMD(pinia)
  await situationSettings.update({ shareForegroundWindow: false })
  await expressionSettings.update({ bands: false })
  mmd.physicsEnabled = false

  await maintenance.deleteAllData()

  expect(localStorage.getItem('settings/situation-inner')).toBeNull()
  expect(Object.keys(localStorage).filter(key => key.startsWith('expression-'))).toEqual([])
  expect(situationSettings.document.shareForegroundWindow).toBe(true)
  expect(expressionSettings.document.bands).toBe(true)
  expect(mmd.physicsEnabled).toBe(true)
})

it('empties the character state of every card when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const records = localforage.createInstance({ name: 'airi-character-state', storeName: 'cards' })
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const characterState = useCharacterStateStore(pinia)
  characterState.initialize(runtime)
  cleanups.push(() => characterState.dispose())
  await characterState.ready()
  await characterState.importRecord('default', null)
  await characterState.importRecord('another-card', null)
  await expect(records.length()).resolves.toBe(2)

  await maintenance.deleteAllData()

  await expect(records.length()).resolves.toBe(0)
  expect(characterState.reading?.reasons).toEqual([])
})

it('forgets what the character learned when modules reset', async () => {
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const memory = useMemoryStore(pinia)
  await memory.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'default')
  memory.enabled = false

  await maintenance.resetModulesSettings()

  expect(memory.entries).toEqual([])
  expect(memory.enabled).toBe(true)
  await expect(localforage.createInstance({ name: 'airi-memory', storeName: 'entries' }).length()).resolves.toBe(0)
})
