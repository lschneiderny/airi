import type { Card, ccv3 } from '@proj-airi/ccc'

import type { CardModuleDefaults, CardProviderModule } from '../../services/airi-card-modules'
import type { AiriCard, AiriExtension } from '../../types/airiCard'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { PerformanceProfileSchema } from '@proj-airi/stage-shared/expression-performance'
import { StorageSerializers } from '@vueuse/core'
import { isEqual } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { defineStore, getActivePinia } from 'pinia'
import { array, parse } from 'valibot'
import { computed, getCurrentScope, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { DEFAULT_ARTISTRY_WIDGET_SPAWNING_PROMPT } from '../../constants/prompts/character-defaults'
import { captureAnalyticsEvent } from '../../libs/product-signals'
import { wakeWordSchema } from '../../libs/voice/wake-words'
import { clearModuleSelections, resolveModuleSelection } from '../../services/airi-card-modules'
import { normalizeContextWindow } from '../../types/airiCard'
import { useMemoryStore } from '../memory'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useSettingsStageModel } from '../settings/stage-model'
import { useArtistryStore } from './artistry'
import { useConsciousnessStore } from './consciousness'
import { initialize as initializeModules, retiredProviderIds } from './default'
import { useSpeechStore } from './speech'
import { useVisionStore } from './vision'

export type { AiriCard, AiriExtension } from '../../types/airiCard'

function resolveSystemPrompt(card: AiriCard | undefined): string {
  if (!card)
    return ''

  // Position-sensitive CCv3 fields are deliberately excluded until provider
  // message assembly owns their ordering and role semantics.
  const systemPromptParts = [
    card.systemPrompt,
    card.description,
    card.personality,
    card.scenario,
    card.extensions.airi.modules.artistry?.widgetInstruction,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)

  return systemPromptParts.join('\n\n')
}

export const useAiriCardStore = defineStore('airi-card', () => {
  // A watcher or an await runs outside the setup of this store. The active
  // Pinia can then be another one, so keep the Pinia that owns this store.
  const pinia = getActivePinia()
  const { t } = useI18n()
  // Pinia synchronization owns cross-window updates. Local storage only loads
  // and saves this renderer's durable copy; listening to storage events here
  // would create a second cross-window state channel and echo cloned maps.
  const cards = useLocalStorageManualReset<Map<string, AiriCard>>('airi-cards', new Map(), { listenToStorageChanges: false })
  const activeCardId = useLocalStorageManualReset<string>('airi-card-active-id', 'default', { listenToStorageChanges: false })
  let initialized = false

  // Only leader-owned commands change defaults or apply card overrides. Runtime
  // module stores contain the effective selections, not another source of defaults.
  // Existing installations seed this snapshot once from their current settings.
  const moduleDefaults = useLocalStorageManualReset<CardModuleDefaults | null>('airi-card-module-defaults', null, {
    listenToStorageChanges: false,
    serializer: StorageSerializers.object,
  })
  let appliedModules: AiriExtension['modules'] | undefined
  let followingInheritedSettings = false
  const storeScope = getCurrentScope()
  /** Run before a card is deleted; see {@link onCardRemoval}. */
  const cardRemovalListeners = new Set<(cardId: string) => Promise<void> | void>()

  const activeCard = computed(() => cards.value.get(activeCardId.value))
  function useRuntimeModuleStores() {
    return {
      artistry: useArtistryStore(pinia),
      consciousness: useConsciousnessStore(pinia),
      speech: useSpeechStore(pinia),
      stageModel: useSettingsStageModel(pinia),
      vision: useVisionStore(pinia),
    }
  }

  function readRuntimeModules(): CardModuleDefaults {
    const { consciousness, vision, speech, stageModel } = useRuntimeModuleStores()
    return {
      consciousness: { provider: consciousness.activeProvider, model: consciousness.activeModel },
      vision: { provider: vision.activeProvider, model: vision.activeModel },
      speech: { provider: speech.activeSpeechProvider, model: speech.activeSpeechModel, voice_id: speech.activeSpeechVoiceId },
      displayModelId: stageModel.stageModelSelected,
    }
  }

  function rememberInheritedSettings() {
    const runtime = readRuntimeModules()
    const defaults = moduleDefaults.value
    if (!defaults) {
      moduleDefaults.value = runtime
      return
    }
    if (!appliedModules)
      return

    // A user can change an inherited setting through a module surface. Retain
    // those changes, but never promote the previous card's overrides to defaults.
    const next = structuredClone(toRaw(defaults))
    for (const module of ['consciousness', 'vision', 'speech'] as const) {
      const previous = appliedModules[module]
      if (previous.provider)
        continue
      if (next[module].provider !== runtime[module].provider)
        next[module].model = ''
      next[module].provider = runtime[module].provider
      if (!previous.model)
        next[module].model = runtime[module].model
    }
    if (!appliedModules.speech.provider && !appliedModules.speech.model && !appliedModules.speech.voice_id)
      next.speech.voice_id = runtime.speech.voice_id
    if (!appliedModules.displayModelId)
      next.displayModelId = runtime.displayModelId
    if (!isEqual(next, toRaw(defaults)))
      moduleDefaults.value = next
  }

  /**
   * Keeps inherited defaults in step with the runtime modules after a card applies.
   * A module store can change an inherited selection later, for example when a voice catalog picks a voice.
   * Replies resolve speech from the card and the defaults, so the defaults must follow.
   * The watcher starts at the first application, which runs only in leader-routed actions, because
   * metadata-only consumers must not create the module stores.
   */
  function followInheritedSettings() {
    if (followingInheritedSettings)
      return
    followingInheritedSettings = true
    // An action runs outside the store scope. Run the watcher in it, so the store disposal stops it.
    storeScope?.run(() => watch(readRuntimeModules, () => {
      // An application clears `appliedModules` while the runtime holds a mix of two cards.
      if (appliedModules)
        rememberInheritedSettings()
    }, { deep: true }))
  }

  /** Applies card speech through the leader command so catalog invalidation precedes its saved voice. */
  async function writeRuntimeModules(modules: CardModuleDefaults) {
    const { consciousness, vision, speech, stageModel } = useRuntimeModuleStores()
    // Provider changes synchronously clear dependent selections. Assign the
    // resolved model and voice afterwards, including empty values.
    consciousness.activeProvider = modules.consciousness.provider
    consciousness.activeModel = modules.consciousness.model
    // The vision store keeps a custom model name per selection. It does not clear that name when the provider changes.
    if (vision.activeProvider !== modules.vision.provider)
      vision.resetModelSelection()
    vision.activeProvider = modules.vision.provider
    vision.activeModel = modules.vision.model
    await speech.selectProviderModel(modules.speech.provider, modules.speech.model, modules.speech.voice_id)
    if (modules.displayModelId !== undefined)
      stageModel.stageModelSelected = modules.displayModelId
  }

  /**
   * `source` feeds the `card_created` analytics event: `scratch` = built in
   * the creation dialog, `import` = ccv3 JSON upload, `duplicate` = cloned
   * from an existing card (profile switcher). Required so a new call site
   * can't silently degrade creation attribution.
   */
  const addCard = async (card: AiriCard | Card | ccv3.CharacterCardV3, source: 'scratch' | 'import' | 'duplicate') => {
    const newCardId = nanoid()
    cards.value.set(newCardId, newAiriCard(card))
    captureAnalyticsEvent('card_created', { card_id: newCardId, source })
    return newCardId
  }

  const removeCard = async (id: string) => {
    // The built-in card is the guaranteed fallback for every runtime profile.
    if (id === 'default')
      return false

    // The memory store starts empty and reads IndexedDB asynchronously. Wait for
    // that read so a fresh window cannot delete the card before its memories are
    // known. General entries have no persona and stay.
    const memory = useMemoryStore(pinia)
    await memory.ready()
    await Promise.all(memory.entries.filter(entry => entry.persona === id).map(entry => memory.remove(entry)))
    // A listener that rejects keeps the card, so its data and the card stay together.
    await Promise.all(Array.from(cardRemovalListeners, listener => listener(id)))

    const removed = cards.value.delete(id)
    if (!removed)
      return false

    // The active id is persisted independently from the card map. Reset it
    // before consumers observe a dangling runtime profile after deletion.
    if (activeCardId.value === id) {
      activeCardId.value = 'default'
      await applyActiveCardSettings()
    }

    captureAnalyticsEvent('character_deleted', { character_id: id })
    return true
  }

  const updateCard = async (id: string, updates: AiriCard | Card | ccv3.CharacterCardV3) => {
    const existingCard = cards.value.get(id)
    if (!existingCard)
      return false

    const updatedCard = {
      ...existingCard,
      ...updates,
    }

    const card = newAiriCard(updatedCard)
    cards.value.set(id, card)
    if (id === activeCardId.value)
      await applyActiveCardSettings(card)

    return true
  }

  /**
   * Calls `listener` with the id of a card that {@link removeCard} is about to delete, so a store that keeps data per
   * card drops it with the card. The card store knows none of those stores; they depend on it, never the reverse.
   *
   * `removeCard` awaits every listener before it drops the card. It runs in the synchronization leader, so only the
   * listeners of the leader window are called. The listeners are this window's memory and never replicate.
   *
   * @returns A function that removes the listener.
   */
  function onCardRemoval(listener: (cardId: string) => Promise<void> | void): () => void {
    cardRemovalListeners.add(listener)
    return () => cardRemovalListeners.delete(listener)
  }

  const getCard = (id: string) => {
    return cards.value.get(id)
  }

  function updateActiveCardModules(patch: (extension: AiriExtension) => Partial<AiriExtension['modules']>) {
    const cardId = activeCardId.value
    const card = cards.value.get(cardId)
    if (!card)
      return false

    const extension = resolveAiriExtension(card)
    cards.value.set(cardId, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...extension,
          modules: {
            ...extension.modules,
            ...patch(extension),
          },
        },
      },
    })

    return true
  }

  async function updateActiveCardDisplayModel(displayModelId: string | undefined) {
    const updated = updateActiveCardModules(() => ({ displayModelId }))
    if (updated)
      await applyActiveCardSettings()
    return updated
  }

  async function updateActiveCardConsciousness(consciousness: AiriExtension['modules']['consciousness']) {
    const updated = updateActiveCardModules(() => ({ consciousness }))
    if (updated)
      await applyActiveCardSettings()
    return updated
  }

  async function updateActiveCardVision(vision: AiriExtension['modules']['vision']) {
    const updated = updateActiveCardModules(() => ({ vision }))
    if (updated)
      await applyActiveCardSettings()
    return updated
  }

  /**
   * Selects a vision provider for the active card with its catalog default.
   *
   * Only this explicit selection applies the default, and the card stores it,
   * so the runtime and the card keep the same model. A provider without a
   * default keeps an empty model until the user selects one.
   */
  async function selectActiveCardVisionProvider(provider: string) {
    const vision = useVisionStore(pinia)
    vision.enabled = true
    if (vision.activeProvider === provider)
      return true
    vision.activeProvider = provider
    vision.resetModelSelection()
    await vision.loadModelsForProvider(provider)
    const model = useProviderStore(pinia).getDefaultModelForProvider(provider) ?? ''
    return await updateActiveCardVision({ provider, model })
  }

  async function updateActiveCardSpeech(speech: Pick<AiriExtension['modules']['speech'], 'provider' | 'model' | 'voice_id'>) {
    const updated = updateActiveCardModules(({ modules }) => ({
      speech: {
        ...modules.speech,
        ...speech,
      },
    }))
    if (updated)
      await applyActiveCardSettings()
    return updated
  }

  /** Clears matching selections from defaults and every card, then reapplies the active card. */
  async function clearModuleProviders(modules: readonly CardProviderModule[], shouldClear: (providerId: string) => boolean) {
    rememberInheritedSettings()
    const defaults = moduleDefaults.value
    if (defaults) {
      const next = clearModuleSelections(defaults, modules, shouldClear)
      if (next !== defaults)
        moduleDefaults.value = next
    }
    for (const [id, storedCard] of cards.value) {
      const card = toRaw(storedCard)
      const extension = card.extensions.airi
      const next = clearModuleSelections(extension.modules, modules, shouldClear, defaults ?? undefined)
      if (next === extension.modules)
        continue
      cards.value.set(id, { ...card, extensions: { ...card.extensions, airi: { ...extension, modules: next } } })
    }

    appliedModules = undefined
    if (activeCard.value)
      await applyActiveCardSettings()
    // A reset can run before the cards initialize. The runtime modules still hold the removed providers.
    else if (moduleDefaults.value)
      await writeRuntimeModules(moduleDefaults.value)
  }

  /** Clears a deleted provider from defaults and every card. */
  async function clearProviderSelections(providerId: string) {
    await clearModuleProviders(['consciousness', 'vision', 'speech'], id => id === providerId)
  }

  /** Clears vision and speech selections whose provider lost its settings in a reset. Consciousness stays unchanged. */
  async function clearUnavailableProviderSelections() {
    const providers = useProviderStore(pinia)
    await clearModuleProviders(['vision', 'speech'], id => !providers.isProviderAvailableWithoutConfiguration(id))
  }

  function resolveAiriExtension(card: Card | ccv3.CharacterCardV3): AiriExtension {
    // Get existing extension if available
    const existingExtension = ('data' in card
      ? card.data?.extensions?.airi
      : card.extensions?.airi) as AiriExtension

    // Create default modules config
    const defaultModules = {
      consciousness: { provider: '', model: '' },
      vision: { provider: '', model: '' },
      speech: { provider: '', model: '', voice_id: '' },
      displayModelId: '',
      artistry: {
        enabled: false,
        provider: '',
        model: '',
        promptPrefix: '',
        widgetInstruction: DEFAULT_ARTISTRY_WIDGET_SPAWNING_PROMPT,
        spawnMode: 'bg_widget' as const,
        options: undefined,
        autonomousEnabled: false,
        autonomousThreshold: 70,
        autonomousTarget: 'assistant' as const,
      },
    } as const

    // Return default if no extension exists
    if (!existingExtension) {
      return {
        contextWindow: -1,
        modules: defaultModules,
        agents: {},
      }
    }

    // Fill known fields without discarding settings owned by imported extensions.
    return {
      ...existingExtension,
      contextWindow: normalizeContextWindow(existingExtension.contextWindow),
      ...(existingExtension.wakeWords === undefined ? {} : { wakeWords: parse(array(wakeWordSchema), existingExtension.wakeWords) }),
      modules: {
        ...existingExtension.modules,
        ...(existingExtension.modules?.performance === undefined ? {} : { performance: parse(PerformanceProfileSchema, existingExtension.modules.performance) }),
        consciousness: {
          ...existingExtension.modules?.consciousness,
          provider: existingExtension.modules?.consciousness?.provider ?? defaultModules.consciousness.provider,
          model: existingExtension.modules?.consciousness?.model ?? defaultModules.consciousness.model,
        },
        vision: {
          ...existingExtension.modules?.vision,
          provider: existingExtension.modules?.vision?.provider ?? defaultModules.vision.provider,
          model: existingExtension.modules?.vision?.model ?? defaultModules.vision.model,
        },
        speech: {
          ...existingExtension.modules?.speech,
          provider: existingExtension.modules?.speech?.provider ?? defaultModules.speech.provider,
          model: existingExtension.modules?.speech?.model ?? defaultModules.speech.model,
          voice_id: existingExtension.modules?.speech?.voice_id ?? defaultModules.speech.voice_id,
          pitch: existingExtension.modules?.speech?.pitch,
          rate: existingExtension.modules?.speech?.rate,
          ssml: existingExtension.modules?.speech?.ssml,
          language: existingExtension.modules?.speech?.language,
        },
        vrm: existingExtension.modules?.vrm,
        live2d: existingExtension.modules?.live2d,
        displayModelId: existingExtension.modules?.displayModelId ?? defaultModules.displayModelId,
        activeBackgroundId: existingExtension.modules?.activeBackgroundId,
        artistry: {
          ...existingExtension.modules?.artistry,
          enabled: existingExtension.modules?.artistry?.enabled ?? (existingExtension as any).artistry?.enabled ?? defaultModules.artistry.enabled,
          provider: existingExtension.modules?.artistry?.provider ?? (existingExtension as any).artistry?.provider ?? defaultModules.artistry.provider,
          model: existingExtension.modules?.artistry?.model ?? (existingExtension as any).artistry?.model ?? defaultModules.artistry.model,
          promptPrefix: existingExtension.modules?.artistry?.promptPrefix ?? (existingExtension as any).artistry?.promptPrefix ?? (existingExtension as any).artistry?.prompt_prefix ?? defaultModules.artistry.promptPrefix,
          workflowId: existingExtension.modules?.artistry?.workflowId ?? (existingExtension as any).artistry?.workflowId ?? (existingExtension as any).artistry?.remixId,
          widgetInstruction: existingExtension.modules?.artistry?.widgetInstruction ?? (existingExtension as any).artistry?.widgetInstruction ?? defaultModules.artistry.widgetInstruction,
          spawnMode: existingExtension.modules?.artistry?.spawnMode ?? (existingExtension as any).artistry?.spawnMode ?? defaultModules.artistry.spawnMode,
          options: existingExtension.modules?.artistry?.options ?? (existingExtension as any).artistry?.options ?? defaultModules.artistry.options,
          autonomousEnabled: existingExtension.modules?.artistry?.autonomousEnabled ?? (existingExtension as any).artistry?.autonomousEnabled ?? defaultModules.artistry.autonomousEnabled,
          autonomousThreshold: existingExtension.modules?.artistry?.autonomousThreshold ?? (existingExtension as any).artistry?.autonomousThreshold ?? defaultModules.artistry.autonomousThreshold,
          autonomousTarget: existingExtension.modules?.artistry?.autonomousTarget ?? (existingExtension as any).artistry?.autonomousTarget ?? defaultModules.artistry.autonomousTarget,
        },
      },
      agents: existingExtension.agents ?? {},
    }
  }

  function newAiriCard(card: Card | ccv3.CharacterCardV3): AiriCard {
    // Handle ccv3 format if needed
    if ('data' in card) {
      const ccv3Card = card as ccv3.CharacterCardV3
      return {
        name: ccv3Card.data.name,
        version: ccv3Card.data.character_version ?? '1.0.0',
        description: ccv3Card.data.description ?? '',
        creator: ccv3Card.data.creator ?? '',
        notes: ccv3Card.data.creator_notes ?? '',
        notesMultilingual: ccv3Card.data.creator_notes_multilingual,
        personality: ccv3Card.data.personality ?? '',
        scenario: ccv3Card.data.scenario ?? '',
        greetings: [
          ccv3Card.data.first_mes,
          ...(ccv3Card.data.alternate_greetings ?? []),
        ],
        greetingsGroupOnly: ccv3Card.data.group_only_greetings ?? [],
        systemPrompt: ccv3Card.data.system_prompt ?? '',
        postHistoryInstructions: ccv3Card.data.post_history_instructions ?? '',
        messageExample: ccv3Card.data.mes_example
          ? ccv3Card.data.mes_example
              .split('<START>\n')
              .filter(Boolean)
              .map(example => example.split('\n')
                .map((line) => {
                  if (line.startsWith('{{char}}:') || line.startsWith('{{user}}:'))
                    return line as `{{char}}: ${string}` | `{{user}}: ${string}`
                  throw new Error(`Invalid message example format: ${line}`)
                }))
          : [],
        tags: ccv3Card.data.tags ?? [],
        extensions: {
          ...ccv3Card.data.extensions,
          airi: resolveAiriExtension(ccv3Card),
        },
      }
    }

    return {
      ...card,
      extensions: {
        ...card.extensions,
        airi: resolveAiriExtension(card),
      },
    }
  }

  /**
   * The `default` card before the user edits it. Each device creates this card
   * with the same id, so synchronization compares a device's card with it to
   * find the edits of the user.
   */
  const builtInCard = computed(() => newAiriCard({
    name: 'ReLU',
    version: '1.0.0',
    description: t('base.prompt.prefix'),
    extensions: {
      airi: {
        modules: {
          consciousness: { provider: '', model: '' },
          speech: { provider: '', model: '', voice_id: '' },
          vision: { provider: '', model: '' },
        },
        agents: {},
      },
    },
  }))

  /** Applies local defaults and the initial card in the synchronization leader. */
  async function initialize() {
    // This synchronized action executes in the leader. Each window calls it,
    // but only the first call can apply persisted card settings to the runtime.
    if (initialized)
      return

    initialized = true
    const retiredSelections = new Set(retiredProviderIds)
    for (const provider of Object.values(useProviderConfigStore().providers)) {
      if (retiredProviderIds.has(provider.definitionId))
        retiredSelections.add(provider.id)
    }
    // Clear retired instance references before their records disappear. Other card fields remain device-local.
    for (const card of cards.value.values()) {
      for (const module of ['consciousness', 'vision', 'speech'] as const) {
        const selection = card.extensions.airi.modules[module]
        if (!retiredSelections.has(selection.provider))
          continue
        selection.provider = ''
        selection.model = ''
        if (module === 'speech')
          card.extensions.airi.modules.speech.voice_id = ''
      }
    }
    await initializeModules()
    if (moduleDefaults.value) {
      const defaults = structuredClone(toRaw(moduleDefaults.value))
      const runtime = readRuntimeModules()
      for (const module of ['consciousness', 'vision', 'speech'] as const) {
        if (retiredSelections.has(defaults[module].provider))
          Object.assign(defaults[module], runtime[module])
      }
      moduleDefaults.value = defaults
    }
    if (!cards.value.has('default'))
      cards.value.set('default', structuredClone(toRaw(builtInCard.value)))

    // Stored speech-noop can mean an intentional mute. Only the editor may
    // replace it with inheritance; the old placeholder has no provenance marker.
    // The active id and card map are persisted separately. Older versions
    // could delete the selected card without repairing its stored id.
    if (!cards.value.has(activeCardId.value))
      activeCardId.value = 'default'

    await applyActiveCardSettings()
  }

  /**
   * Selects a card and applies its module settings in the synchronization
   * leader. Replicated state snapshots never invoke this command.
   */
  async function activateCard(id: string) {
    if (!cards.value.has(id))
      return false

    activeCardId.value = id
    await applyActiveCardSettings()
    return true
  }

  /** Resolve the named character without changing the character selected by any window. */
  function getModules(characterId: string): CardModuleDefaults & Pick<AiriExtension['modules'], 'performance'> {
    const card = cards.value.get(characterId)
    if (!card)
      throw new Error('The session character is unavailable')
    const defaults = moduleDefaults.value
    if (!defaults)
      throw new Error('Character defaults are not initialized')
    return {
      ...resolveModules(card.extensions.airi.modules, defaults),
      performance: card.extensions.airi.modules.performance,
    }
  }

  function resolveModules(modules: AiriExtension['modules'], defaults: CardModuleDefaults): CardModuleDefaults {
    const speechSelection = resolveModuleSelection(modules.speech, defaults.speech)
    const resolved: CardModuleDefaults = {
      consciousness: resolveModuleSelection(modules.consciousness, defaults.consciousness),
      vision: resolveModuleSelection(modules.vision, defaults.vision),
      speech: {
        ...speechSelection,
        voice_id: modules.speech.voice_id || (
          speechSelection.provider === defaults.speech.provider && speechSelection.model === defaults.speech.model
            ? defaults.speech.voice_id
            : ''
        ),
      },
      displayModelId: modules.displayModelId || defaults.displayModelId,
    }
    for (const module of ['consciousness', 'vision', 'speech'] as const) {
      // Retired hosted selections never instantiate a removed provider. Other card overrides stay intact.
      if (retiredProviderIds.has(resolved[module].provider))
        Object.assign(resolved[module], defaults[module])
    }
    return resolved
  }

  function getSystemPrompt(characterId: string) {
    return resolveSystemPrompt(cards.value.get(characterId))
  }

  async function applyActiveCardSettings(newCard = activeCard.value) {
    rememberInheritedSettings()
    // The runtime holds a mix of two cards until the write completes. See followInheritedSettings.
    appliedModules = undefined
    const artistry = useArtistryStore(pinia)

    artistry.resetToGlobal()

    if (!newCard)
      return

    // TODO: Minecraft Agent, etc
    const extension = resolveAiriExtension(newCard)
    if (!extension)
      return

    const defaults = moduleDefaults.value
    if (!defaults)
      return
    const modules = extension.modules
    const resolved = resolveModules(modules, defaults)
    await writeRuntimeModules(resolved)
    appliedModules = modules
    followInheritedSettings()

    if (extension.modules?.artistry) {
      const selection = resolveModuleSelection({
        provider: extension.modules.artistry.provider ?? '',
        model: extension.modules.artistry.model ?? '',
      }, { provider: artistry.globalProvider, model: artistry.globalModel })
      artistry.activeProvider = selection.provider
      artistry.activeModel = selection.model
      if (selection.provider !== artistry.globalProvider)
        artistry.providerOptions = undefined
      if (extension.modules.artistry.promptPrefix)
        artistry.defaultPromptPrefix = extension.modules.artistry.promptPrefix
      if (extension.modules.artistry.options)
        artistry.providerOptions = extension.modules.artistry.options
    }
  }

  function resetState() {
    initialized = false
    appliedModules = undefined
    moduleDefaults.reset()
    cards.reset()
    activeCardId.reset()
  }

  return {
    cards,
    moduleDefaults,
    activeCard,
    activeCardId,
    builtInCard,
    addCard,
    removeCard,
    onCardRemoval,
    updateCard,
    updateActiveCardConsciousness,
    updateActiveCardDisplayModel,
    updateActiveCardSpeech,
    updateActiveCardVision,
    selectActiveCardVisionProvider,
    getCard,
    getModules,
    getSystemPrompt,
    resetState,
    initialize,
    activateCard,
    clearProviderSelections,
    clearUnavailableProviderSelections,

    currentModels: computed(() => {
      const {
        consciousness,
        speech,
        stageModel,
        vision,
      } = useRuntimeModuleStores()

      return {
        consciousness: {
          provider: consciousness.activeProvider,
          model: consciousness.activeModel,
        },
        vision: {
          provider: vision.activeProvider,
          model: vision.activeModel,
        },
        speech: {
          provider: speech.activeSpeechProvider,
          model: speech.activeSpeechModel,
          voice_id: speech.activeSpeechVoiceId,
        },
        displayModelId: stageModel.stageModelSelected,
        activeBackgroundId: activeCard.value?.extensions?.airi?.modules?.activeBackgroundId,
      } satisfies AiriExtension['modules']
    }),
    systemPrompt: computed(() => resolveSystemPrompt(activeCard.value)),
  }
}, {
  synced: {
    actions: [
      'activateCard',
      'addCard',
      'initialize',
      'clearProviderSelections',
      'clearUnavailableProviderSelections',
      'removeCard',
      'updateActiveCardConsciousness',
      'updateActiveCardDisplayModel',
      'updateActiveCardSpeech',
      'updateActiveCardVision',
      'selectActiveCardVisionProvider',
      'updateCard',
    ],
    state: true,
  },
})
