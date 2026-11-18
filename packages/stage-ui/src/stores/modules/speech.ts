import type { SpeechOutput, TurnRef } from '@proj-airi/core-agent'
import type { SpeechProvider, SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type {} from 'pinia-plugin-synced'

import type { AiriExtension } from '../../types/airiCard'
import type { VoiceCatalogConfiguration, VoiceCatalogIdentity, VoiceInfo } from '../providers/provider'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset } from '@vueuse/core'
import { generateSpeech } from '@xsai/generate-speech'
import { isEqual } from 'es-toolkit'
import { defineStore, getActivePinia, storeToRefs } from 'pinia'
import { computed, hasInjectionContext, inject, onScopeDispose, toRaw, watch } from 'vue'
import { toXml } from 'xast-util-to-xml'
import { x } from 'xastscript'

import { speechStorageKeys } from '../../constants/settings-storage'
import { injectKeyPiniaSynced } from '../../libs/pinia/synced-context'
import { getDefinedProvider } from '../../libs/providers/providers'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'

export function toSignedPercent(value: number): string {
  if (value > 0)
    return `+${value}%`
  if (value < 0)
    return `-${Math.abs(value)}%`
  return '0%'
}

/** A field that a speech selection needs before it can speak. */
export type MissingSpeechField = 'model' | 'voice'

/**
 * Resolves the model and the voice that a speech selection speaks with.
 * The provider config can supply them, for example for an OpenAI-compatible provider.
 * A streaming provider needs a model with a resource path. Without one, it uses `defaultModel`, the default model of the provider.
 */
function resolveSpeechSelection(selection: AiriExtension['modules']['speech'], config: Record<string, unknown>, defaultModel: () => string | null | undefined) {
  const model = selection.model || (typeof config.model === 'string' ? config.model : '')
  const voiceId = selection.voice_id || (typeof config.voice === 'string' ? config.voice : '')
  const streaming = getDefinedProvider(selection.provider)?.capabilities?.speech?.transport === 'bidirectional-ws'
  const streamingModel = streaming ? (model.includes('/') ? model : defaultModel()) : undefined
  return { model, voiceId, streaming, streamingModel }
}

/** The empty fields of a speech selection. */
export interface SpeechFieldStatus {
  /** Fields that the speech lacks. Without them, `createOutput` of the speech store cannot speak, so the replies stay text only. */
  missing: MissingSpeechField[]
  /** Empty fields that a catalog fills after it loads. Until then, it is unknown if the speech can speak. */
  pending: MissingSpeechField[]
}

/**
 * Tells which fields a speech selection lacks before it can speak. Both lists are empty when speech is off, or when it can speak.
 * A streaming provider uses the default model of its model catalog. While that catalog loads, an empty model is pending, not missing.
 * A catalog that failed, that came back empty, or that nobody requested fills nothing, so its empty fields are missing.
 * This fork has no hosted provider that picks a voice from its catalog, so an empty voice is always missing.
 *
 * @param config The config of the selected provider.
 * @param defaultModel Gives the default model of the selected provider. It gives `null` when there is none, and `undefined` while the model catalog loads.
 */
export function speechFieldStatus(
  selection: AiriExtension['modules']['speech'],
  config: Record<string, unknown>,
  defaultModel: () => string | null | undefined,
): SpeechFieldStatus {
  const status: SpeechFieldStatus = { missing: [], pending: [] }
  if (!selection.provider || selection.provider === 'speech-noop')
    return status
  const { model, voiceId, streaming, streamingModel } = resolveSpeechSelection(selection, config, defaultModel)
  if (streaming ? !streamingModel?.includes('/') : !model)
    status[streaming && streamingModel === undefined ? 'pending' : 'missing'].push('model')
  if (!voiceId)
    status.missing.push('voice')
  return status
}

/** One key for a set of speech fields, for the strings that name them. It is `undefined` for no fields. */
export function speechFieldsKeyOf(fields: readonly MissingSpeechField[]): 'model' | 'voice' | 'model-voice' | undefined {
  const model = fields.includes('model')
  const voice = fields.includes('voice')
  if (model && voice)
    return 'model-voice'
  if (model)
    return 'model'
  if (voice)
    return 'voice'
  return undefined
}

interface SpeechInputOptions {
  text: string
  voice: VoiceInfo
  providerConfig?: Record<string, unknown>
  forceSSML?: boolean
  supportsSSML?: boolean
}

interface SpeechInput {
  input: string
  providerConfig: Record<string, unknown>
}

// Request status belongs to this renderer's RPC wait, not to replicated speech settings.
const useSpeechCatalogRequests = defineStore('speech-catalog-requests', () => {
  const status = refManualReset<Record<string, { loading: boolean, error: string | null }>>(() => ({}))
  return { status }
})

// Only speech's leader actions write this store. Settings proposals cannot
// replace catalogs or roll back the reset generation. A new leader inherits both.
const useSpeechCatalog = defineStore('speech-catalog', () => {
  const availableVoices = refManualReset<Record<string, VoiceInfo[]>>(() => ({}))
  const voiceCatalogIdentities = refManualReset<Record<string, VoiceCatalogIdentity>>(() => ({}))
  const resetGeneration = refManualReset(0)
  return { availableVoices, voiceCatalogIdentities, resetGeneration }
}, { synced: { state: true } })

export const useSpeechStore = defineStore('speech', () => {
  const pinia = getActivePinia()
  const runtime = hasInjectionContext() ? inject(injectKeyPiniaSynced, undefined) : undefined
  const catalog = useSpeechCatalog()
  const { availableVoices, voiceCatalogIdentities, resetGeneration } = storeToRefs(catalog)
  const catalogRequests = useSpeechCatalogRequests()
  const { status: voiceCatalogStatus } = storeToRefs(catalogRequests)
  const providersStore = useProviderStore()
  const providerStore = useProviderConfigStore()
  const { allAudioSpeechProvidersMetadata } = storeToRefs(providersStore)

  // Pinia synchronization owns live cross-window state. localStorage only
  // loads and saves durable values for this synchronized store.
  const persistenceOptions = { listenToStorageChanges: false }

  // State
  const activeSpeechProvider = useLocalStorageManualReset<string>(speechStorageKeys.provider, 'speech-noop', persistenceOptions)
  const enabled = useLocalStorageManualReset(speechStorageKeys.enabled, true, persistenceOptions)
  // Disabling invalidates synthesis captured by an open response, including requests that have not started yet.
  let synthesis = new AbortController()
  watch(enabled, (value) => {
    if (value)
      synthesis = new AbortController()
    else
      synthesis.abort(new DOMException('Speech is disabled', 'AbortError'))
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => synthesis.abort())
  const activeSpeechModel = useLocalStorageManualReset<string>(speechStorageKeys.model, '', persistenceOptions)
  const activeSpeechVoiceId = useLocalStorageManualReset<string>(speechStorageKeys.voice, '', persistenceOptions)
  const activeSpeechVoice = refManualReset<VoiceInfo | undefined>(undefined)

  const pitch = useLocalStorageManualReset<number>('settings/speech/pitch', 0, persistenceOptions)
  const rate = useLocalStorageManualReset<number>('settings/speech/rate', 1, persistenceOptions)
  const ssmlEnabled = useLocalStorageManualReset<boolean>(speechStorageKeys.ssml, false, persistenceOptions)
  // Each provider owns its latest request status. Settings for the active
  // provider and background provider editors must not consume each other's IO.
  const isLoadingSpeechProviderVoices = computed(() => voiceCatalogStatus.value[activeSpeechProvider.value]?.loading ?? false)
  const speechProviderError = computed(() => voiceCatalogStatus.value[activeSpeechProvider.value]?.error ?? null)
  const modelSearchQuery = refManualReset<string>('')

  // Computed properties
  const availableSpeechProvidersMetadata = computed(() => allAudioSpeechProvidersMetadata.value)

  // Computed properties
  const supportsModelListing = computed(() => {
    return providersStore.supportsModelListing(activeSpeechProvider.value)
  })

  const providerModels = computed(() => {
    return providersStore.getModelsForProvider(activeSpeechProvider.value)
  })

  const isLoadingActiveProviderModels = computed(() => {
    return providersStore.isLoadingModels[activeSpeechProvider.value] || false
  })

  const activeProviderModelError = computed(() => {
    return providersStore.modelLoadError[activeSpeechProvider.value] || null
  })

  const filteredModels = computed(() => {
    if (!modelSearchQuery.value.trim()) {
      return providerModels.value
    }

    const query = modelSearchQuery.value.toLowerCase().trim()
    return providerModels.value.filter(model =>
      model.name.toLowerCase().includes(query)
      || model.id.toLowerCase().includes(query)
      || (model.description && model.description.toLowerCase().includes(query)),
    )
  })

  const supportsSSML = computed(() => {
    // Currently only ElevenLabs and some other providers support SSML
    // only part voices are support SSML in cosyvoice-v2 which is provided by alibaba
    if (activeSpeechProvider.value === 'alibaba-cloud-model-studio' && activeSpeechModel.value === 'cosyvoice-v2') {
      return true
    }
    return ['elevenlabs', 'microsoft-speech', 'azure-speech'].includes(activeSpeechProvider.value)
  })

  // Only leader loads own these counters. Older responses for a provider cannot
  // replace its newer catalog. Caller request status has separate local ownership.
  let voiceLoadSequence = 0
  const latestVoiceLoads = new Map<string, number>()

  let localRequestSequence = 0
  let disposed = false
  const localRequests = new Map<string, { sequence: number, model?: string }>()
  const cancelPending = new Set<() => void>()

  /** Captures configuration and tracks this renderer's cancelable RPC wait. */
  async function loadVoicesForProvider(provider: string, model?: string): Promise<VoiceInfo[]> {
    if (!provider || disposed)
      return []
    const sequence = ++localRequestSequence
    localRequests.set(provider, { sequence, model })
    voiceCatalogStatus.value = { ...voiceCatalogStatus.value, [provider]: { loading: true, error: null } }
    let cancel!: () => void
    const interrupted = new Promise<VoiceInfo[]>((resolve) => {
      cancel = () => resolve([])
    })
    cancelPending.add(cancel)
    let errorMessage: string | null = null
    try {
      const configuration = providersStore.getVoiceCatalogConfiguration(provider)
      return await Promise.race([
        useSpeechStore(pinia).loadVoiceCatalog(provider, model, configuration, resetGeneration.value),
        interrupted,
      ])
    }
    catch (error) {
      if (localRequests.get(provider)?.sequence === sequence) {
        errorMessage = errorMessageFrom(error) ?? 'Unknown error'
        console.error('Failed to load speech voice catalog:', errorMessage)
      }
      return []
    }
    finally {
      cancelPending.delete(cancel)
      if (localRequests.get(provider)?.sequence === sequence) {
        localRequests.delete(provider)
        voiceCatalogStatus.value = { ...voiceCatalogStatus.value, [provider]: { loading: false, error: errorMessage } }
      }
    }
  }

  /** Releases local waiters and invalidates results owned by the outgoing leader. */
  function cancelCatalogRequests() {
    localRequests.clear()
    latestVoiceLoads.clear()
    for (const cancel of cancelPending)
      cancel()
    cancelPending.clear()
    voiceCatalogStatus.value = {}
  }

  // Reset snapshots release local RPC waits in every renderer, including
  // windows that did not initiate the reset. This watcher writes no shared state.
  watch(resetGeneration, cancelCatalogRequests, { flush: 'sync' })

  let observedLeader = runtime?.getLeaderId()
  const stopCoordination = runtime?.onCoordinationChange(({ leaderId }) => {
    // Participant heartbeats do not change request ownership. Wait for an
    // elected replacement before restarting; a gap in election is not a leader.
    if (!leaderId || leaderId === observedLeader)
      return
    if (!observedLeader) {
      // Initial election routes the startup watchers' pending calls normally.
      observedLeader = leaderId
      return
    }
    observedLeader = leaderId
    const reloads = new Map(Array.from(localRequests, ([provider, request]) => [provider, request.model]))
    // The current selection takes precedence over an interrupted preview model.
    if (activeSpeechProvider.value)
      reloads.set(activeSpeechProvider.value, activeSpeechModel.value || undefined)
    cancelCatalogRequests()
    // Let the election callback finish before routing replacement RPCs.
    // Each renderer restarts its own active queries.
    void Promise.resolve().then(() => {
      if (disposed || observedLeader !== leaderId)
        return
      for (const [provider, model] of reloads)
        void loadVoicesForProvider(provider, model)
    })
  })
  onScopeDispose(() => {
    disposed = true
    stopCoordination?.()
    cancelCatalogRequests()
  })

  /**
   * The voices of the speech selections of characters, by provider and model. Speech output reads the metadata of a
   * character voice from it, for example the language.
   *
   * It is apart from `availableVoices`, which holds one catalog for each provider and belongs to the selection of
   * this store: a load for another model there discards the catalog and clears the selected voice.
   * Each window keeps its own copy. It is not synchronized, and it does not validate a selection.
   */
  const characterVoices = new Map<string, VoiceInfo[]>()
  const latestCharacterVoiceLoads = new Map<string, number>()
  let characterVoiceLoadSequence = 0

  // A reset replaces the provider sessions and settings. The voices of characters go with them.
  watch(resetGeneration, () => {
    characterVoices.clear()
    latestCharacterVoiceLoads.clear()
  }, { flush: 'sync' })

  function characterVoicesKey(provider: string, model: string | undefined) {
    return JSON.stringify([provider, model ?? ''])
  }

  /**
   * Loads the voices of a character's speech selection, so that {@link createOutput} can read the metadata of its voice.
   *
   * A selection equal to the selection of this store needs no load, because `availableVoices` already has its catalog.
   * A failed load keeps the voices of an earlier load. An expired provider session removes them.
   */
  async function loadVoicesForCharacter(provider: string, model?: string): Promise<void> {
    if (!provider || provider === 'speech-noop' || disposed)
      return
    if (provider === activeSpeechProvider.value && (model ?? '') === activeSpeechModel.value)
      return

    const key = characterVoicesKey(provider, model)
    const sequence = ++characterVoiceLoadSequence
    latestCharacterVoiceLoads.set(key, sequence)
    try {
      const voices = await providersStore.listProviderVoices(provider, model, providersStore.getVoiceCatalogConfiguration(provider))
      // A newer load for the same selection owns the result.
      if (latestCharacterVoiceLoads.get(key) !== sequence)
        return
      if (voices === undefined)
        characterVoices.delete(key)
      else
        characterVoices.set(key, voices)
    }
    catch (error) {
      console.error('Failed to load the voices of a character:', errorMessageFrom(error) ?? 'Unknown error')
    }
  }

  /** Executes a caller's immutable catalog request in the synchronization leader. */
  async function loadVoiceCatalog(provider: string, model: string | undefined, configuration: VoiceCatalogConfiguration, generation = resetGeneration.value): Promise<VoiceInfo[]> {
    // A queued caller request from before reset cannot start new leader work.
    if (!provider || disposed || generation !== resetGeneration.value) {
      return []
    }

    if (provider === activeSpeechProvider.value) {
      ensureActiveSpeechModel()
      model ??= activeSpeechModel.value || undefined
    }

    const loadSequence = ++voiceLoadSequence
    latestVoiceLoads.set(provider, loadSequence)
    if (voiceCatalogIdentities.value[provider]?.model !== model) {
      discardVoiceCatalog(provider)
    }
    const identity = await providersStore.getVoiceCatalogIdentity(model, configuration)
    // Hashing yields. Reset or a newer request during that work must not
    // clear or replace a newer catalog.
    if (latestVoiceLoads.get(provider) !== loadSequence)
      return []
    // Keep valid choices during a refresh. A model or configuration change
    // invalidates them before consumers can select from the previous catalog.
    if (!isEqual(voiceCatalogIdentities.value[provider], identity)) {
      discardVoiceCatalog(provider)
    }

    const voices = await providersStore.listProviderVoices(provider, model, configuration)
    if (latestVoiceLoads.get(provider) !== loadSequence)
      return []
    voiceCatalogIdentities.value = { ...voiceCatalogIdentities.value, [provider]: identity }
    availableVoices.value = { ...availableVoices.value, [provider]: voices }
    return voices
  }

  // Get voices for a specific provider
  function getVoicesForProvider(provider: string) {
    return availableVoices.value[provider] || []
  }

  function clearVoiceSelection() {
    activeSpeechVoiceId.value = ''
    activeSpeechVoice.value = undefined
  }

  /** Drops catalog metadata and its selected voice together; initial discovery preserves unverified persisted choices. */
  function discardVoiceCatalog(provider: string) {
    if (voiceCatalogIdentities.value[provider] && activeSpeechProvider.value === provider)
      clearVoiceSelection()
    delete voiceCatalogIdentities.value[provider]
    availableVoices.value = { ...availableVoices.value, [provider]: [] }
  }

  /** Invalidates cached catalogs and requests in the leader without changing saved selections. */
  async function invalidateVoiceCatalogs() {
    cancelCatalogRequests()
    catalog.$patch((state) => {
      state.availableVoices = {}
      state.voiceCatalogIdentities = {}
      state.resetGeneration++
    })
  }

  // A provider that publishes one model publishes no choice. An empty selection
  // keeps `configured` false until the user opens the dropdown and picks that
  // one entry, and the provider looks broken until then. This applies to every
  // single-model speech provider, not only to the VOICEVOX family.
  //
  // The voice selection stays as it is. Voices belong to the provider, not to
  // this model, and a provider switch clears both before this runs.
  function ensureActiveSpeechModel() {
    // An explicit model can be a valid custom endpoint name absent from discovery.
    if (activeSpeechModel.value)
      return
    const models = providersStore.getModelsForProvider(activeSpeechProvider.value)
    if (models.length !== 1)
      return

    const onlyModelId = models[0]?.id ?? ''
    if (!onlyModelId || activeSpeechModel.value === onlyModelId)
      return

    activeSpeechModel.value = onlyModelId
  }

  /** Selects a source in the leader. None disables speech, and selecting the saved source restores its model and voice. */
  async function selectSource(provider: string) {
    enabled.value = provider !== 'speech-noop'
    if (!enabled.value)
      return
    if (activeSpeechProvider.value !== provider)
      await selectProviderModel(provider, '')
    return { provider: activeSpeechProvider.value, model: activeSpeechModel.value, voice_id: activeSpeechVoiceId.value }
  }
  /** Commits an explicit selection in the leader before watchers request its catalog. An omitted voice preserves an unchanged selection. */
  async function selectProviderModel(provider: string, model: string, voiceId?: string) {
    if (disposed)
      return
    const changed = activeSpeechProvider.value !== provider || activeSpeechModel.value !== model
    activeSpeechProvider.value = provider
    activeSpeechModel.value = model
    if (changed)
      clearVoiceSelection()
    ensureActiveSpeechModel()
    // Discard the previous model before applying an explicit card voice. The
    // loader must not treat that new choice as a selection from the old catalog.
    if (voiceCatalogIdentities.value[provider]?.model !== (activeSpeechModel.value || undefined))
      discardVoiceCatalog(provider)
    if (voiceId !== undefined)
      activeSpeechVoiceId.value = voiceId
    // Watchers run after this synchronous state commit. They route discovery
    // through the exposed action without publishing a follower snapshot.
    return { provider: activeSpeechProvider.value, model: activeSpeechModel.value }
  }

  // Provider and model form the catalog identity, including changes made by cards.
  // Watch both here so loading does not depend on an open settings page.
  watch([activeSpeechProvider, activeSpeechModel], async ([newProvider, newModel], _, onCleanup) => {
    if (!newProvider)
      return
    let stale = false
    onCleanup(() => {
      stale = true
    })
    // Immediate watchers run before Pinia installs action wrappers. Wait for
    // setup, then use this store's Pinia instance, even if another app is active.
    await Promise.resolve()
    if (stale)
      return
    await useSpeechStore(pinia).loadVoicesForProvider(newProvider, newModel || undefined)
    // Don't reset voice settings when changing providers to allow for persistence
  }, {
    // REVIEW: should we always load voices on init? What will happen when network is not available?
    immediate: true,
  })

  if (!activeSpeechProvider.value) {
    activeSpeechProvider.value = 'speech-noop'
  }

  // Snapshots may wake every renderer. Only the leader may apply the selection
  // and its derived voice object; the action is idempotent for repeated calls.
  watch([activeSpeechProvider, activeSpeechVoiceId, availableVoices], async () => {
    await Promise.resolve()
    try {
      await useSpeechStore(pinia).ensureActiveSpeechVoice()
    }
    catch (error) {
      console.error('Failed to route speech voice selection:', errorMessageFrom(error))
    }
  }, { immediate: true, deep: true })

  /** Applies the matching voice object in the leader. */
  async function ensureActiveSpeechVoice() {
    if (disposed)
      return
    const voiceId = activeSpeechVoiceId.value
    const voices = availableVoices.value
    if (!voiceId)
      return

    let nextVoice: VoiceInfo | undefined
    if (activeSpeechProvider.value === 'openai-compatible-audio-speech') {
      nextVoice = {
        id: voiceId,
        name: voiceId,
        description: voiceId,
        previewURL: '',
        languages: [{ code: 'en', title: 'English' }],
        provider: activeSpeechProvider.value,
        gender: 'neutral',
      }
    }
    else {
      nextVoice = voices[activeSpeechProvider.value]?.find(voice => voice.id === voiceId)
    }

    if (!nextVoice || isEqual(activeSpeechVoice.value, nextVoice))
      return

    activeSpeechVoice.value = nextVoice
  }

  /**
   * Generate speech using the specified provider and settings
   *
   * @param provider The speech provider instance
   * @param model The model to use
   * @param input The text input to convert to speech
   * @param voice The voice ID to use
   * @param providerConfig Additional provider configuration
   * @returns ArrayBuffer containing the audio data
   */
  async function speech(
    provider: SpeechProvider | SpeechProviderWithExtraOptions<string, Record<string, unknown>>,
    model: string,
    input: string,
    voice: string,
    providerConfig: Record<string, unknown> = {},
  ): Promise<ArrayBuffer> {
    const signal = synthesis.signal
    signal.throwIfAborted()
    const response = await generateSpeech({
      ...provider.speech(model, providerConfig),
      input,
      voice,
      abortSignal: signal,
    })

    signal.throwIfAborted()
    return response
  }

  /** Captures one response's provider, voice, model, and settings before any asynchronous work. */
  function createOutput(_turn: TurnRef, selection: AiriExtension['modules']['speech'], output: Pick<SpeechOutput, 'playback' | 'onPlaybackStart' | 'onPlaybackEnd' | 'onSpecial' | 'onDisplayText'>, _audioContext: AudioContext): SpeechOutput {
    if (!enabled.value)
      return { ...output, synthesize: async () => null }
    const synthesisSignal = synthesis.signal
    const providerId = selection.provider
    const config = structuredClone(toRaw(providerStore.getProviderConfig(providerId) ?? {}))
    // The catalog of the store is the current one for the selection of the store. For another selection, the voices
    // of that exact selection come first, because the catalog of the provider can belong to another model.
    const isStoreSelection = providerId === activeSpeechProvider.value && (selection.model || '') === activeSpeechModel.value
    const characterVoice = isStoreSelection
      ? undefined
      : characterVoices.get(characterVoicesKey(providerId, selection.model || undefined))?.find(voice => voice.id === selection.voice_id)
    const selectedVoice = characterVoice ?? availableVoices.value[providerId]?.find(voice => voice.id === selection.voice_id)
    const voice = selectedVoice ? structuredClone(toRaw(selectedVoice)) : undefined
    const { model, voiceId } = resolveSpeechSelection(selection, config, () => providersStore.getDefaultModelForProvider(providerId))
    const useSSML = ssmlEnabled.value
    const canUseSSML = ['elevenlabs', 'microsoft-speech', 'azure-speech'].includes(providerId) || (providerId === 'alibaba-cloud-model-studio' && model === 'cosyvoice-v2')
    const pitchValue = pitch.value
    const language = voice?.languages[0]?.code
    if (!providerId || providerId === 'speech-noop')
      return { ...output, synthesize: async () => null }
    if (!model || !voiceId)
      throw new Error('Speech requires a model and voice')
    const provider = providersStore.getProviderInstance<SpeechProviderWithExtraOptions<string, Record<string, unknown>>>(providerId)
    return { ...output, language, synthesize: async (request, signal) => {
      signal = AbortSignal.any([signal, synthesisSignal])
      signal.throwIfAborted()
      const client = await provider
      signal.throwIfAborted()
      const input = voice && useSSML && canUseSSML ? generateSSML(request.text, voice, { ...config, pitch: pitchValue }) : request.text
      const audio = await generateSpeech({ ...client.speech(model, config), input, voice: voiceId, abortSignal: signal })
      signal.throwIfAborted()
      return new Blob([audio])
    } }
  }

  function generateSSML(
    text: string,
    voice: VoiceInfo,
    providerConfig?: Record<string, unknown>,
  ): string {
    const pitch = providerConfig?.pitch
    const speed = providerConfig?.speed
    const volume = providerConfig?.volume

    const prosody = {
      pitch: typeof pitch === 'number'
        ? toSignedPercent(pitch)
        : undefined,
      rate: typeof speed === 'number'
        ? speed !== 1.0
          ? `${speed}`
          : '1'
        : undefined,
      volume: typeof volume === 'number'
        ? toSignedPercent(volume)
        : undefined,
    }

    const hasProsody = Object.values(prosody).some(value => value != null)

    const ssmlXast = x('speak', { 'version': '1.0', 'xmlns': 'http://www.w3.org/2001/10/synthesis', 'xml:lang': voice.languages[0]?.code || 'en-US' }, [
      x('voice', { name: voice.id, gender: voice.gender || 'neutral' }, [
        hasProsody
          ? x('prosody', {
              pitch: prosody.pitch,
              rate: prosody.rate,
              volume: prosody.volume,
            }, [
              text,
            ])
          : text,
      ]),
    ])

    return toXml(ssmlXast)
  }

  function resolveSpeechInput(options: SpeechInputOptions): SpeechInput {
    const providerConfig = { ...options.providerConfig }
    const canUseSSML = options.supportsSSML === true

    return {
      input: options.forceSSML === true && canUseSSML
        ? generateSSML(options.text, options.voice, providerConfig)
        : options.text,
      providerConfig,
    }
  }

  const configured = computed(() => {
    if (!enabled.value)
      return false
    if (activeSpeechProvider.value === 'speech-noop')
      return false

    if (!activeSpeechProvider.value)
      return false

    let hasModel = !!activeSpeechModel.value
    let hasVoice = !!activeSpeechVoiceId.value

    // For OpenAI Compatible providers, check provider config as fallback
    if (activeSpeechProvider.value === 'openai-compatible-audio-speech') {
      const providerConfig = providerStore.getProviderConfig(activeSpeechProvider.value)
      hasModel ||= !!providerConfig?.model
      hasVoice ||= !!providerConfig?.voice
    }

    return hasModel && hasVoice
  })

  /** Releases this caller's waits, then awaits the leader's shared reset. Transport failures propagate to the caller. */
  async function resetState() {
    cancelCatalogRequests()
    await useSpeechStore(pinia).resetSettings()
  }

  /** Resets shared settings in the leader and rejects catalog results started before this reset. */
  async function resetSettings() {
    enabled.reset()
    // Invalidate request ownership before the reset publishes new settings.
    await invalidateVoiceCatalogs()
    activeSpeechProvider.reset()
    activeSpeechModel.reset()
    activeSpeechVoiceId.reset()
    activeSpeechVoice.reset()
    pitch.reset()
    rate.reset()
    ssmlEnabled.reset()
    modelSearchQuery.reset()
  }

  return {
    // State
    configured,
    enabled,
    activeSpeechProvider,
    activeSpeechModel,
    activeSpeechVoice,
    activeSpeechVoiceId,
    pitch,
    rate,
    ssmlEnabled,
    voiceCatalogStatus: computed(() => voiceCatalogStatus.value),
    isLoadingSpeechProviderVoices,
    speechProviderError,
    availableVoices: computed(() => availableVoices.value),
    voiceCatalogIdentities: computed(() => voiceCatalogIdentities.value),
    modelSearchQuery,

    // Computed
    availableSpeechProvidersMetadata,
    supportsSSML,
    supportsModelListing,
    providerModels,
    isLoadingActiveProviderModels,
    activeProviderModelError,
    filteredModels,

    // Actions
    speech,
    loadVoicesForProvider,
    loadVoicesForCharacter,
    loadVoiceCatalog,
    invalidateVoiceCatalogs,
    selectProviderModel,
    selectSource,
    ensureActiveSpeechVoice,
    getVoicesForProvider,
    ensureActiveSpeechModel,
    generateSSML,
    resolveSpeechInput,
    createOutput,
    resetState,
    resetSettings,
  }
}, {
  synced: {
    actions: ['loadVoiceCatalog', 'invalidateVoiceCatalogs', 'selectProviderModel', 'selectSource', 'ensureActiveSpeechVoice', 'resetSettings'],
    state: true,
  },
})
