import type { LeadershipMode } from 'pinia-plugin-synced'

import type { StorageLocation } from '../persistence/state-registry'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { modelScopedStorageKey } from '@proj-airi/stage-shared/composables'
import { useLive2DNaturalSettings } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useMMD } from '@proj-airi/stage-ui-mmd/stores/mmd'
import { useMMDNaturalSettings } from '@proj-airi/stage-ui-mmd/stores/natural-settings'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, toRaw } from 'vue'
import { createI18n } from 'vue-i18n'

import { characterStateRepo } from '../database/repos/character-state.repo'
import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { stickersRepo } from '../database/repos/stickers.repo'
import { storage } from '../database/storage'
import { useHostNoticeSettings } from '../features/host-capabilities/notice-settings'
import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { useSituationSettings } from '../features/situation/settings'
import { importData } from '../libs/data-transfer'
import { injectKeyPiniaSynced } from '../libs/pinia/synced-context'
import { toStoredVoiceprint } from '../libs/voice/voiceprint'
import { stateRegistry } from '../persistence/state-registry'
import { useCharacterStateStore } from '../stores/character-state'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useDisplayModelsStore } from '../stores/display-models'
import { useMemoryStore } from '../stores/memory'
import { useModsServerChannelStore } from '../stores/mods/api/channel-server'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useConsciousnessSettingsStore } from '../stores/modules/consciousness-settings'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useMinecraftStore } from '../stores/modules/gaming-minecraft'
import { useHearingStore } from '../stores/modules/hearing'
import { useHomeAssistantStore } from '../stores/modules/home-assistant'
import { useSpeechStore } from '../stores/modules/speech'
import { useVisionStore } from '../stores/modules/vision'
import { useWebSearchStore } from '../stores/modules/web-search'
import { useProviderConfigStore } from '../stores/providers/config'
import { useProviderStore } from '../stores/providers/provider'
import { useRecipesStore } from '../stores/recipes'
import { useVoiceprintStore } from '../stores/voiceprint'
import { useDataMaintenance } from './use-data-maintenance'

// Keep the model runtime outside this store regression. Voice selection needs no model download.
vi.mock('../libs/inference/adapters/kokoro', () => ({
  getKokoroAdapter: async () => ({
    state: 'ready',
    loadModel: vi.fn(async () => undefined),
    getVoices: () => ({ af_heart: { language: 'en-us', name: 'Heart', gender: 'Female' } }),
  }),
}))

const cleanups: Array<() => void | Promise<void>> = []

/** Mounts the maintenance composable with real stores and a separate synchronization runtime. */
function mountMaintenance(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  pinia.use(runtime.plugin)
  const pendingActions = new Set<symbol>()
  pinia.use(({ store }) => {
    store.$onAction(({ after, onError }) => {
      const action = Symbol('pending action')
      pendingActions.add(action)
      const settled = () => {
        pendingActions.delete(action)
      }
      after(settled)
      onError(settled)
    })
  })
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
  cleanups.push(async () => {
    // Imported settings wake asynchronous store watchers. Finish their actions before the transport closes.
    await nextTick()
    await vi.waitFor(() => expect(pendingActions.size).toBe(0))
    app.unmount()
    channel.dispose()
    disposePinia(pinia)
    runtime.dispose()
  })
  if (!maintenance)
    throw new Error('Maintenance composable did not initialize')
  return { pinia, runtime, maintenance }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

// https://github.com/moeru-ai/airi/issues/3154
// ROOT CAUSE:
// Reset removed provider settings but kept module defaults and card overrides.
// Clear unavailable selections in leader actions, including inactive cards, without changing consciousness.
it.each(['leader-only', 'follower-only'] as const)('clears unavailable module providers on every card from %s (Issue #3154)', async (leadership) => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [], data: [] })))
  const namespace = `maintenance:${crypto.randomUUID()}`
  const leader = mountMaintenance(namespace, 'leader-only')
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  const { pinia } = leader
  const providers = useProviderConfigStore(pinia)
  for (const definitionId of ['openai', 'openai-audio-speech', 'openai-audio-transcription']) {
    providers.providers[definitionId] = {
      id: definitionId,
      definitionId,
      config: { apiKey: 'test-key' },
      status: 'configured',
      configuredBy: 'user',
    }
  }
  const consciousness = useConsciousnessStore(pinia)
  consciousness.activeProvider = 'openai'
  consciousness.activeModel = 'chat-model'
  const vision = useVisionStore(pinia)
  vision.activeProvider = 'vision-openai'
  vision.activeModel = 'vision-model'
  vision.customModelName = 'custom-vision-model'
  const speech = useSpeechStore(pinia)
  await speech.selectProviderModel('openai-audio-speech', 'tts-1', 'alloy')
  speech.pitch = 2
  const hearing = useHearingStore(pinia)
  hearing.activeTranscriptionProvider = 'openai-audio-transcription'
  hearing.activeTranscriptionModel = 'whisper-1'
  hearing.activeCustomModelName = 'custom-transcription-model'
  hearing.autoSendDelay = 1234
  const cards = useAiriCardStore(pinia)
  await cards.initialize()
  const inheritedId = await cards.addCard(structuredClone(toRaw(cards.activeCard!)), 'duplicate')
  const partial = structuredClone(toRaw(cards.activeCard!))
  partial.extensions.airi.modules.vision.model = 'card-vision-model'
  partial.extensions.airi.modules.speech.model = 'tts-1'
  partial.extensions.airi.modules.speech.voice_id = 'echo'
  const partialId = await cards.addCard(partial, 'duplicate')
  const explicit = structuredClone(toRaw(cards.activeCard!))
  explicit.extensions.airi.modules = {
    ...explicit.extensions.airi.modules,
    consciousness: { provider: 'openai', model: 'card-chat-model' },
    vision: { provider: 'vision-openai', model: 'card-vision-model' },
    speech: { provider: 'openai-audio-speech', model: 'tts-1', voice_id: 'echo' },
  }
  const inactiveId = await cards.addCard(explicit, 'duplicate')
  const activeId = await cards.addCard(explicit, 'duplicate')
  await cards.activateCard(activeId)
  const caller = leadership === 'leader-only' ? leader : mountMaintenance(namespace, leadership)
  await vi.waitFor(() => expect(caller.runtime.getLeaderId()).toBe(leader.runtime.participantId))
  await vi.waitFor(() => expect(useAiriCardStore(caller.pinia).activeCardId).toBe(activeId))
  const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')

  await caller.maintenance.resetProvidersSettings()

  expect(providers.providers.openai).toBeUndefined()
  expect(vision.activeProvider).toBe('')
  expect(vision.activeModel).toBe('')
  expect(vision.customModelName).toBe('')
  expect(speech.activeSpeechProvider).toBe('speech-noop')
  expect(speech.activeSpeechModel).toBe('')
  expect(speech.activeSpeechVoiceId).toBe('')
  expect(hearing.activeTranscriptionProvider).toBe('')
  expect(hearing.activeTranscriptionModel).toBe('')
  expect(hearing.activeCustomModelName).toBe('')
  expect(hearing.autoSendDelay).toBe(1234)
  expect(speech.pitch).toBe(2)
  expect(consciousness.activeProvider).toBe('openai')
  expect(consciousness.activeModel).toBe('chat-model')
  expect(cards.getModules(activeId).consciousness).toEqual({ provider: 'openai', model: 'card-chat-model' })
  for (const id of [activeId, inactiveId, inheritedId, partialId]) {
    expect(cards.getModules(id)?.vision).toEqual({ provider: '', model: '' })
    expect(cards.getModules(id)?.speech).toEqual({ provider: 'speech-noop', model: '', voice_id: '' })
  }
  expect(cards.getCard(inactiveId)?.extensions.airi.modules.consciousness).toEqual({ provider: 'openai', model: 'card-chat-model' })
  expect(cards.getCard(partialId)?.extensions.airi.modules.speech).toEqual({ provider: '', model: '', voice_id: '' })
  await cards.activateCard(inactiveId)
  expect(speech.activeSpeechProvider).toBe('speech-noop')
  await cards.activateCard(inheritedId)
  expect(vision.activeProvider).toBe('')
  expect(consciousness.activeModel).toBe('chat-model')
  await vi.waitFor(() => expect(useHearingStore(caller.pinia).activeTranscriptionProvider).toBe(''))
  await vi.waitFor(() => expect(useSpeechStore(caller.pinia).activeSpeechProvider).toBe('speech-noop'))
  await nextTick()
  expect(traffic.mock.calls.filter(([message]) => JSON.stringify(message).includes('replaceState'))).toHaveLength(0)
})

// https://github.com/moeru-ai/airi/issues/3154
// ROOT CAUSE:
// Clearing every selection also removes usable local providers. Clear only providers that need removed settings.
// An unavailable explicit override becomes None instead of inheriting a different voice.
it('preserves usable local selections and disables unavailable card overrides (Issue #3154)', async () => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [], data: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const speech = useSpeechStore(pinia)
  await speech.selectProviderModel('kokoro-local', 'fp32', 'af_heart')
  const hearing = useHearingStore(pinia)
  hearing.activeTranscriptionProvider = 'browser-web-speech-api'
  hearing.activeTranscriptionModel = 'web-speech-api'
  const cards = useAiriCardStore(pinia)
  await cards.initialize()
  await vi.waitFor(() => expect(useProviderStore(pinia).moduleSpeechProvidersMetadata.some(provider => provider.id === 'kokoro-local')).toBe(true))
  const explicit = structuredClone(toRaw(cards.activeCard!))
  explicit.extensions.airi.modules.speech = { provider: 'openai-audio-speech', model: 'tts-1', voice_id: 'alloy' }
  const unavailableId = await cards.addCard(explicit, 'duplicate')

  await maintenance.resetProvidersSettings()

  expect(speech.activeSpeechProvider).toBe('kokoro-local')
  expect(speech.activeSpeechModel).toBe('fp32')
  expect(speech.activeSpeechVoiceId).toBe('af_heart')
  expect(hearing.activeTranscriptionProvider).toBe('browser-web-speech-api')
  expect(hearing.activeTranscriptionModel).toBe('web-speech-api')
  expect(cards.getModules(unavailableId)?.speech).toEqual({ provider: 'speech-noop', model: '', voice_id: '' })
  const snapshot = structuredClone(toRaw(cards.cards))
  await maintenance.resetProvidersSettings()
  await nextTick()
  expect(toRaw(cards.cards)).toEqual(snapshot)
  expect(speech.activeSpeechVoiceId).toBe('af_heart')
})

// https://github.com/moeru-ai/airi/issues/3154
// ROOT CAUSE:
// Custom provider IDs lose their definitions after reset. Account-owned providers also lose settings despite needing no API key.
// Clear both selections before a card initializes, and keep consciousness unchanged.
it('clears removed custom IDs and account-owned providers before card initialization (Issue #3154)', async () => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [], data: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const providers = useProviderConfigStore(pinia)
  providers.providers['custom-speech'] = {
    id: 'custom-speech',
    definitionId: 'openai-audio-speech',
    config: { apiKey: 'test-key' },
    status: 'configured',
    configuredBy: 'user',
  }
  providers.providers['custom-vision'] = {
    id: 'custom-vision',
    definitionId: 'openai',
    config: { apiKey: 'test-key' },
    status: 'configured',
    configuredBy: 'user',
  }
  const consciousness = useConsciousnessStore(pinia)
  consciousness.activeProvider = 'openai'
  consciousness.activeModel = 'chat-model'
  const speech = useSpeechStore(pinia)
  await speech.selectProviderModel('custom-speech', 'tts-1', 'alloy')
  const vision = useVisionStore(pinia)
  vision.activeProvider = 'custom-vision'
  vision.activeModel = 'vision-model'
  const hearing = useHearingStore(pinia)
  hearing.activeTranscriptionProvider = 'official-provider-transcription'
  hearing.activeTranscriptionModel = 'auto'
  expect(useAiriCardStore(pinia).activeCard).toBeUndefined()

  await maintenance.resetProvidersSettings()

  expect(speech.activeSpeechProvider).toBe('speech-noop')
  expect(speech.activeSpeechVoiceId).toBe('')
  expect(vision.activeProvider).toBe('')
  expect(vision.activeModel).toBe('')
  expect(hearing.activeTranscriptionProvider).toBe('')
  expect(hearing.activeTranscriptionModel).toBe('')
  expect(consciousness.activeProvider).toBe('openai')
  expect(consciousness.activeModel).toBe('chat-model')
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

// ROOT CAUSE:
// Deleting all data kept long-term memories and recipes, so the character still knew facts about the owner.
it('forgets memories and recipes when modules reset', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const memory = useMemoryStore(pinia)
  const recipes = useRecipesStore(pinia)
  await memory.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'default')
  await recipes.add({ name: 'Check in', description: '', instructions: 'Greet softly.', keywords: [], enabled: true })

  await maintenance.resetModulesSettings()

  expect(memory.entries).toEqual([])
  expect(recipes.recipes.filter(recipe => recipe.source === 'user')).toEqual([])
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

it('forgets derived conversation state, presence, expression, host notice, Natural, and MMD settings when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  localStorage.setItem('settings/situation-inner', JSON.stringify({ v: 1, threads: [], savedAtMs: 1 }))
  // Documents of a model that is not loaded must go too.
  localStorage.setItem('expression-catalog:unloaded-model', JSON.stringify({ version: 1, overrides: [] }))
  localStorage.setItem('expression-rest:unloaded-model', JSON.stringify({ version: 1, active: [] }))
  // A key that a profile saved before the Natural settings documents; deletion must not leave it to be read back.
  localStorage.setItem('settings/mmd/natural-energy', '0.9')
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const situationSettings = useSituationSettings(pinia)
  const expressionSettings = useExpressionPerformanceSettings(pinia)
  const hostNotice = useHostNoticeSettings(pinia)
  const mmd = useMMD(pinia)
  const live2dNatural = useLive2DNaturalSettings(pinia)
  const mmdNatural = useMMDNaturalSettings(pinia)
  expect(mmdNatural.document.energy).toBe(0.9)
  await live2dNatural.update({ energy: 0.9, touchHeadScale: { shuka: 1.5 } })
  await situationSettings.update({ shareForegroundWindow: false })
  await expressionSettings.update({ bands: false })
  await hostNotice.dismiss('linux-wayland:wayland-cursor-unreported')
  expect(JSON.parse(localStorage.getItem('settings/host-notice')!).dismissedKeys).toEqual(['linux-wayland:wayland-cursor-unreported'])
  mmd.physicsEnabled = false

  await maintenance.deleteAllData()

  expect(localStorage.getItem('settings/situation-inner')).toBeNull()
  expect(Object.keys(localStorage).filter(key => key.startsWith('expression-'))).toEqual([])
  expect(situationSettings.document.shareForegroundWindow).toBe(true)
  expect(expressionSettings.document.bands).toBe(true)
  expect(hostNotice.document.dismissedKeys).toEqual([])
  expect(localStorage.getItem('settings/host-notice')).toBeNull()
  expect(mmd.physicsEnabled).toBe(true)
  expect(live2dNatural.document).toMatchObject({ energy: 0.5, touchHeadScale: {} })
  expect(mmdNatural.document.energy).toBe(0.5)
  // The sweep after each owner reset removes the stored documents and the keys from before them.
  expect(Object.keys(localStorage).filter(key => /^settings\/(?:live2d|mmd)\/natural/.test(key))).toEqual([])
})

it('empties the character state of every card when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const characterState = useCharacterStateStore(pinia)
  characterState.initialize(runtime)
  cleanups.push(() => characterState.dispose())
  await characterState.ready()
  await characterState.importRecord('default', null)
  await characterState.importRecord('another-card', null)
  await expect(characterStateRepo.loadAll()).resolves.toHaveLength(2)

  await maintenance.deleteAllData()

  await expect(characterStateRepo.loadAll()).resolves.toEqual([])
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
  await expect(storage.getKeys('memory')).resolves.toEqual([])
})

it('removes the voiceprints when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  localStorage.setItem('settings/voice/voiceprints', JSON.stringify([toStoredVoiceprint({ embedding: new Float32Array([1, 0]), seconds: 8 }, { id: 'voiceprint-1', label: '', createdAt: Date.now() })]))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  expect(useVoiceprintStore(pinia).records).toHaveLength(1)

  await maintenance.deleteAllData()

  expect(useVoiceprintStore(pinia).records).toEqual([])
  expect(JSON.parse(localStorage.getItem('settings/voice/voiceprints') ?? '[]')).toEqual([])
})

it('runs every later deletion when an owner reset fails, and still rejects', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  localStorage.setItem('settings/voice/voiceprints', JSON.stringify([toStoredVoiceprint({ embedding: new Float32Array([1, 0]), seconds: 8 }, { id: 'voiceprint-1', label: '', createdAt: Date.now() })]))
  await storage.setItemRaw('local:chat/sessions/orphan', { messages: [] })
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  vi.spyOn(useDisplayModelsStore(pinia), 'resetDisplayModels').mockRejectedValue(new Error('Model storage unavailable'))

  await expect(maintenance.deleteAllData()).rejects.toThrow('Model storage unavailable')

  expect(JSON.parse(localStorage.getItem('settings/voice/voiceprints') ?? '[]')).toEqual([])
  // The chat sessions come after the display models in the registry.
  await expect(storage.getItemRaw('local:chat/sessions/orphan')).resolves.toBeNull()
})

it('runs the host step after a failed registry run and rejects with the registry failure', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  vi.spyOn(useDisplayModelsStore(pinia), 'resetDisplayModels').mockRejectedValue(new Error('Model storage unavailable'))
  const deleteHostData = vi.fn<() => Promise<void>>(async () => {
    throw new Error('Host unavailable')
  })

  await expect(maintenance.deleteAllDataWithHost(deleteHostData)).rejects.toThrow('Model storage unavailable')

  expect(deleteHostData).toHaveBeenCalledOnce()
})

const marker = 'delete-all-data-marker'
/** Valid JSON, so the owners that read the marker before the deletion do not log parse errors. */
const storedMarker = JSON.stringify(marker)
/** A record that the display model list can read. */
const recordMarker = { name: marker }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Opens a database that holds `store`, adding the store when the database lacks it. */
async function openWithStore(database: string, store: string): Promise<IDBDatabase> {
  const db = await requestResult(indexedDB.open(database))
  if (db.objectStoreNames.contains(store))
    return db
  db.close()
  const upgrade = indexedDB.open(database, db.version + 1)
  upgrade.onupgradeneeded = () => upgrade.result.createObjectStore(store)
  return await requestResult(upgrade)
}

async function withStore<T>(database: string, store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openWithStore(database, store)
  try {
    return await requestResult(run(db.transaction(store, mode).objectStore(store)))
  }
  finally {
    db.close()
  }
}

/** Puts a marker into one location and returns a check that reads whether the marker is still there. */
async function seedMarker(location: StorageLocation): Promise<Array<() => Promise<string | undefined>>> {
  const left = (description: string, present: boolean) => present ? description : undefined
  switch (location.area) {
    case 'localStorage':
    case 'sessionStorage': {
      const area = location.area === 'localStorage' ? localStorage : sessionStorage
      const keys = 'key' in location
        ? [location.key]
        : 'prefix' in location
          ? [`${location.prefix}${marker}`]
          : [modelScopedStorageKey('model-a', location.perModel), modelScopedStorageKey('model-b', location.perModel)]
      keys.forEach(key => area.setItem(key, storedMarker))
      return keys.map(key => async () => left(`${location.area} ${key}`, area.getItem(key) === storedMarker))
    }
    case 'indexedDB': {
      const store = 'store' in location ? location.store : 'records'
      const key = 'store' in location ? `${location.prefix ?? ''}${marker}` : marker
      await withStore(location.database, store, 'readwrite', target => target.put(recordMarker, key))
      if (!('store' in location)) {
        return [async () => left(`indexedDB ${location.database}`, (await indexedDB.databases()).some(database => database.name === location.database))]
      }
      return [async () => left(`indexedDB ${location.database}/${store} ${key}`, await withStore(location.database, store, 'readonly', target => target.get(key)) !== undefined)]
    }
    case 'opfs': {
      const name = 'directory' in location ? location.directory : `display-model-${marker}`
      const root = await navigator.storage.getDirectory()
      await (await root.getDirectoryHandle(name, { create: true })).getFileHandle(marker, { create: true })
      return [async () => left(`opfs ${name}`, (await Array.fromAsync(root.keys())).includes(name))]
    }
    case 'cacheStorage':
      await (await caches.open(location.cache)).put(`https://example.com/${marker}`, new Response(marker))
      return [async () => left(`cacheStorage ${location.cache}`, await caches.has(location.cache))]
  }
}

// Step 5 of the state registry's focused test: "Delete all data" resets exactly the registered set.
it('leaves no registered location holding data when all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const checks: Array<() => Promise<string | undefined>> = []
  for (const registration of stateRegistry) {
    for (const location of registration.locations) {
      if (!('kept' in location) || !location.kept)
        checks.push(...await seedMarker(location))
    }
  }

  await maintenance.deleteAllData()

  const remaining = (await Promise.all(checks.map(check => check()))).filter(Boolean)
  expect(remaining).toEqual([])
  // An enrollment that started before the deletion must still see when it happened.
  expect(localStorage.getItem('settings/voice/voiceprint-deleted-at')).not.toBeNull()
})

// ROOT CAUSE:
// The chat sessions' reset saves a new empty session and the chat index, and the sweep after it removed both, so the
// session existed only in memory.
it('keeps the new empty chat session in storage after all data is deleted', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))

  await maintenance.deleteAllData()

  const sessions = useChatSessionStore(pinia)
  expect(sessions.activeSessionId).not.toBe('')
  expect(await chatSessionsRepo.getSession(sessions.activeSessionId)).not.toBeNull()
  expect(Object.values((await chatSessionsRepo.getIndex('local'))?.characters ?? {}).flatMap(character => Object.keys(character.sessions))).toContain(sessions.activeSessionId)
})

// ROOT CAUSE:
// The sweep emptied the sticker library, the copy's marker included, before it deleted the old sticker database, whose
// deletion an open connection delayed. The next read ran the copy again and waited behind that deletion, holding the
// sticker write lock.
it('reads the sticker library at once after all data is deleted while a connection delays the old database\'s deletion', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  // The copy runs while no old database exists, and writes its marker.
  await stickersRepo.read()
  await withStore('airi-stickers', 'entries', 'readwrite', target => target.put({ id: 'old-sticker' }, 'old-sticker'))
  // Another window that copied from the old database keeps its connection open.
  const copyConnection = await requestResult(indexedDB.open('airi-stickers'))
  const { runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  try {
    await maintenance.deleteAllData()

    expect((await stickersRepo.read()).records).toEqual([])
  }
  finally {
    copyConnection.close()
  }
})

// ROOT CAUSE:
// Current voice values defined the schema. Fixed optional fields let backups cross different selections.
it.each([true, false])('restores speech voices independently of the destination selection (selected: %s)', async (selected) => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const speech = useSpeechStore(pinia)
  const voice = { id: 'backup-voice', name: 'Backup voice', provider: 'speech-noop', languages: [{ code: 'en', title: 'English' }], previewURL: '' }
  speech.activeSpeechVoice = selected ? voice : undefined
  const adapter = maintenance.createModuleSettingsExportAdapter()
  const file = new File([await adapter.encode(await adapter.read())], 'modules.json')
  speech.activeSpeechVoice = selected ? undefined : voice
  const importer = maintenance.createModuleSettingsImportAdapter()

  await importer.apply(await importer.validate(await importer.decode(file)))

  expect(speech.activeSpeechVoice).toEqual(selected ? voice : undefined)
})

// ROOT CAUSE:
// Pinia state omitted the computed exposure mode. The backup contract now captures it and restores its persisted setter.
it.each(['allow', 'deny'] as const)('preserves the Home Assistant %s policy through a backup', async (mode) => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const homeAssistant = useHomeAssistantStore(pinia)
  homeAssistant.enabled = true
  homeAssistant.exposureMode = mode
  homeAssistant.allowedEntities = ['light.living_room']
  homeAssistant.deniedEntities = ['lock.front_door']
  const adapter = maintenance.createModuleSettingsExportAdapter()
  const file = new File([await adapter.encode(await adapter.read())], 'modules.json')
  homeAssistant.resetState()
  const importer = maintenance.createModuleSettingsImportAdapter()

  await importer.apply(await importer.validate(await importer.decode(file)))

  expect(homeAssistant.exposureMode).toBe(mode)
  expect(homeAssistant.exposure).toEqual({ mode, entityIds: mode === 'allow' ? ['light.living_room'] : ['lock.front_door'] })
  expect(localStorage.getItem('settings/home-assistant/exposure-mode')).toBe(mode)
  expect(homeAssistant.enabled).toBe(true)
})

it('persists restored consciousness policies', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const settings = useConsciousnessSettingsStore(pinia)
  await settings.setReasoning(true)
  await settings.setTemperatureEnabled(true)
  await settings.setTopPEnabled(true)
  const exporter = maintenance.createModuleSettingsExportAdapter()
  const file = new File([await exporter.encode(await exporter.read())], 'modules.json')
  await settings.resetState()
  const importer = maintenance.createModuleSettingsImportAdapter()

  await importer.apply(await importer.validate(await importer.decode(file)))

  const reopened = useConsciousnessSettingsStore(createPinia())
  expect(reopened.reasoning).toBe(true)
  expect(reopened.temperatureEnabled).toBe(true)
  expect(reopened.topPEnabled).toBe(true)
})

it('restores previous module settings when applying an import fails', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const settings = useConsciousnessSettingsStore(pinia)
  await settings.setReasoning(true)
  await settings.setTemperatureEnabled(true)
  await settings.setTopPEnabled(true)

  const exporter = maintenance.createModuleSettingsExportAdapter()
  const target = await exporter.read()
  target.consciousnessSettings.reasoning = false
  target.consciousnessSettings.temperatureEnabled = false
  target.consciousnessSettings.topPEnabled = false
  const file = new File([await exporter.encode(target)], 'modules.json')
  const importer = maintenance.createModuleSettingsImportAdapter()
  vi.spyOn(settings, 'setTopPEnabled').mockRejectedValueOnce(new Error('Module setting apply failed'))

  await expect(importData(importer, file)).rejects.toThrow('Module setting apply failed')

  expect(settings.reasoning).toBe(true)
  expect(settings.temperatureEnabled).toBe(true)
  expect(settings.topPEnabled).toBe(true)
})

it('uses the same fixed contract for export and import validation', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [] })))
  const { pinia, runtime, maintenance } = mountMaintenance(`maintenance:${crypto.randomUUID()}`, 'leader-only')
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  const exporter = maintenance.createModuleSettingsExportAdapter()
  const importer = maintenance.createModuleSettingsImportAdapter()
  const data = await exporter.read()
  delete data.homeAssistant.exposureMode

  await expect(exporter.encode(data)).rejects.toThrow()
  await expect(importer.validate({ format: 'airi-module-settings', version: 1, data })).rejects.toThrow()

  useSpeechStore(pinia).pitch = Number.NaN

  await expect(exporter.encode(await exporter.read())).rejects.toThrow()
})
