import type { StoreGeneric } from 'pinia'

import type { DataExportAdapter, DataImportAdapter } from '../libs/data-transfer'
import type { StateRegistrationId } from '../persistence/state-registry'
import type { HostDataDeletion } from './host-data-deletion'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useLive2DNaturalSettings } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useMMDNaturalSettings } from '@proj-airi/stage-ui-mmd/stores/natural-settings'
import { pick } from 'es-toolkit'
import { getActivePinia } from 'pinia'

import * as v from 'valibot'

import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { createJsonDataExportAdapter, decodeJsonFile } from '../libs/data-transfer'
import { resetRegisteredState } from '../persistence/state-registry'
import { useChatStore } from '../stores/chat'
import { useMemoryStore } from '../stores/memory'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useConsciousnessSettingsStore } from '../stores/modules/consciousness-settings'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useHearingStore } from '../stores/modules/hearing'
import { useHomeAssistantStore } from '../stores/modules/home-assistant'
import { useSpeechStore } from '../stores/modules/speech'
import { useWebSearchStore } from '../stores/modules/web-search'
import { useOnboardingStore } from '../stores/onboarding'
import { useProviderStore } from '../stores/providers/provider'
import { useRecipesStore } from '../stores/recipes'
import { useSettingsAudioDevice, useSettingsGeneral, useSettingsStageModel } from '../stores/settings'
import { moduleSettingsSchema, moduleSettingsSchemas } from './data-maintenance-schemas'

interface StoreStateOwner {
  state: () => Record<string, unknown>
  restore: (state: unknown) => void | Promise<void>
}

type StoreBundleSchema = typeof moduleSettingsSchema
type ExportStoreBundle = Record<string, Record<string, unknown>>
type ValidatedStoreBundle = Record<string, Record<string, unknown>>

const serializedStoreStateSchema = v.pipe(
  v.unknown(),
  v.stringifyJson({
    replacer: (_key, value) => {
      if (value instanceof Map)
        return [...value.entries()]
      if (value instanceof Set)
        return [...value.values()]
      return value
    },
  }),
  v.parseJson(),
  v.record(v.string(), v.unknown()),
)

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function moduleBundleContainsCredentials(bundle: ExportStoreBundle): boolean {
  return [
    bundle.webSearch?.apiKey,
    bundle.discord?.token,
  ].some(isNonEmptyString)
}

/**
 * Uses declared backup fields for capture, including writable computed settings outside Pinia state.
 *
 * @param store - Concrete TStore that supplies every field declared by TSchema.
 * @param schema - TSchema that selects the backup fields.
 */
function bindStoreFromSchema<
  TSchema extends v.StrictObjectSchema<v.ObjectEntries, undefined>,
  TStore extends StoreGeneric & Record<keyof TSchema['entries'], unknown>,
>(store: TStore, schema: TSchema) {
  return {
    state: () => pick<TStore, keyof TSchema['entries']>(store, v.keyof(schema).options),
    restore: (state: unknown) => store.$patch(current => Object.assign(current, state)),
  }
}

async function restoreStoreBundle(bundle: ValidatedStoreBundle, owners: Record<string, StoreStateOwner>): Promise<void> {
  for (const [key, owner] of Object.entries(owners)) {
    await owner.restore(bundle[key])
  }
}

/** Today's members of "Reset modules": the module stores and what the character learned about the owner. */
export const modulesRegistrations = [
  'hearing',
  'home-assistant',
  'speech',
  'character-state',
  'consciousness',
  'consciousness-settings',
  'web-search',
  'discord',
  'factorio',
  'minecraft',
  'memory',
  'recipes',
] as const satisfies readonly StateRegistrationId[]

/** The settings stores that the desktop reset clears with the modules. The stage model selection is reset apart. */
const settingsRegistrations = [
  'settings-general',
  'settings-analytics',
  'settings-spine',
  'tachie',
  'settings-theme',
  'settings-controls-island',
  'settings-developer',
  'audio-device',
  'live2d-params',
  'live2d-settings',
  'live2d-motion-magic',
  'screen-ambient-light',
  'three',
  'mmd',
  'situation-settings',
  'expression-performance-settings',
  'host-notice-settings',
  'live2d-natural-settings',
  'mmd-natural-settings',
  'mcp',
  'onboarding',
  'airi-cards',
] as const satisfies readonly StateRegistrationId[]

export function useDataMaintenance() {
  // Owners that need a component context when they are created. Create them here, so that the registry's owner
  // resets find them already created.
  useChatStore()
  useProviderStore()
  useSettingsGeneral()
  useSettingsAudioDevice()
  useAiriCardStore()
  const speechStore = useSpeechStore()
  const hearingStore = useHearingStore()
  const homeAssistantStore = useHomeAssistantStore()
  const memoryStore = useMemoryStore()
  const consciousnessStore = useConsciousnessStore()
  const consciousnessSettingsStore = useConsciousnessSettingsStore()
  const webSearchStore = useWebSearchStore()
  const discordStore = useDiscordStore()
  const factorioStore = useFactorioStore()
  const recipesStore = useRecipesStore()
  // A leader-routed reset fails when the leader has not created its store. Nothing else creates these four in every
  // window, so create them wherever maintenance is mounted, as before the registry.
  useExpressionPerformanceSettings()
  useLive2DNaturalSettings()
  useMMDNaturalSettings()
  useOnboardingStore()
  // The stores above set the Pinia instance of this component's app as the active one.
  const pinia = getActivePinia()
  if (!pinia)
    throw new Error('useDataMaintenance needs an installed Pinia instance')
  const context = { pinia }

  async function deleteAllModels() {
    await resetRegisteredState(context, ['display-models'])
  }

  async function resetProvidersSettings() {
    await resetRegisteredState(context, ['provider-settings'])
  }

  /** Runs every module reset and reports the first failure only after all of them ran. */
  async function resetModulesSettings() {
    await resetRegisteredState(context, modulesRegistrations)
  }

  async function deleteAllChatSessions() {
    await resetRegisteredState(context, ['chat-sessions', 'chat-assets'])
  }

  /** Runs every registration of the state registry and reports the first failure only after all of them ran. */
  async function deleteAllData() {
    await resetRegisteredState(context)
  }

  /**
   * "Delete all data" as the user runs it: the registry, then the host step. A renderer failure must not keep the
   * host's data, so the host step runs anyway; the first failure is thrown after both ran.
   */
  async function deleteAllDataWithHost(deleteHostData?: HostDataDeletion) {
    const failures: unknown[] = []
    for (const step of [deleteAllData, async () => deleteHostData?.()]) {
      try {
        await step()
      }
      catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0)
      throw failures[0]
  }

  async function resetDesktopApplicationState() {
    if (!isStageTamagotchi())
      return

    // The selection is a setting; the display models it points to are not, so their registration does not run here.
    await useSettingsStageModel(pinia).resetState()
    await resetRegisteredState(context, [...settingsRegistrations, ...modulesRegistrations])
  }

  const moduleSettingsOwners = {
    hearing: bindStoreFromSchema(hearingStore, moduleSettingsSchemas.hearing),
    homeAssistant: {
      ...bindStoreFromSchema(homeAssistantStore, moduleSettingsSchemas.homeAssistant),
      restore: (state) => {
        const settings = state as v.InferOutput<typeof moduleSettingsSchemas.homeAssistant>
        homeAssistantStore.exposureMode = settings.exposureMode
        homeAssistantStore.$patch({
          enabled: settings.enabled,
          allowedEntities: settings.allowedEntities,
          deniedEntities: settings.deniedEntities,
        })
      },
    },
    speech: bindStoreFromSchema(speechStore, moduleSettingsSchemas.speech),
    consciousness: bindStoreFromSchema(consciousnessStore, moduleSettingsSchemas.consciousness),
    consciousnessSettings: {
      ...bindStoreFromSchema(consciousnessSettingsStore, moduleSettingsSchemas.consciousnessSettings),
      restore: async (state) => {
        const settings = state as v.InferOutput<typeof moduleSettingsSchemas.consciousnessSettings>
        await consciousnessSettingsStore.setReasoning(settings.reasoning)
        await consciousnessSettingsStore.setTemperatureEnabled(settings.temperatureEnabled)
        await consciousnessSettingsStore.setTopPEnabled(settings.topPEnabled)
      },
    },
    webSearch: bindStoreFromSchema(webSearchStore, moduleSettingsSchemas.webSearch),
    discord: bindStoreFromSchema(discordStore, moduleSettingsSchemas.discord),
    factorio: bindStoreFromSchema(factorioStore, moduleSettingsSchemas.factorio),
    recipes: bindStoreFromSchema(recipesStore, moduleSettingsSchemas.recipes),
    memory: {
      ...bindStoreFromSchema(memoryStore, moduleSettingsSchemas.memory),
      restore: (state) => {
        memoryStore.restoreState(state as v.InferOutput<typeof moduleSettingsSchemas.memory>)
      },
    },
  } satisfies Record<keyof typeof moduleSettingsSchemas, StoreStateOwner>

  function createStoreExportAdapter(
    schema: StoreBundleSchema,
    owners: Record<string, StoreStateOwner>,
    containsSensitiveInformation?: (bundle: ExportStoreBundle) => boolean,
  ): DataExportAdapter<ExportStoreBundle> {
    const read = async () => {
      await memoryStore.ready()
      return Object.fromEntries(Object.entries(owners).map(([key, owner]) => [key, v.parse(serializedStoreStateSchema, owner.state())]))
    }
    const format = schema.entries.format.literal
    const adapter = createJsonDataExportAdapter(format, read, containsSensitiveInformation)
    return {
      ...adapter,
      encode: async (data, onProgress) => {
        v.parse(schema, { format, version: 1, data })
        return adapter.encode(data, onProgress)
      },
    }
  }

  function createStoreImportAdapter(
    schema: StoreBundleSchema,
    owners: Record<string, StoreStateOwner>,
    afterApply?: () => void | Promise<void>,
  ): DataImportAdapter<ValidatedStoreBundle, unknown, Blob> {
    const exporter = createStoreExportAdapter(schema, owners)
    const validate = async (value: unknown) => v.parse(schema, value).data
    const apply = async (value: ValidatedStoreBundle) => {
      await restoreStoreBundle(value, owners)
      await afterApply?.()
    }

    return {
      decode: decodeJsonFile,
      validate,
      apply,
      rollback: {
        capture: async (_value, onProgress) => {
          return await exporter.encode(await exporter.read(), onProgress)
        },
        restore: async (snapshot) => {
          const file = new File([snapshot], 'settings-rollback.json', { type: 'application/json' })
          const previous = await validate(await decodeJsonFile(file))
          await apply(previous)
        },
      },
    }
  }

  function createModuleSettingsExportAdapter() {
    return createStoreExportAdapter(moduleSettingsSchema, moduleSettingsOwners, moduleBundleContainsCredentials)
  }

  function createModuleSettingsImportAdapter() {
    return createStoreImportAdapter(moduleSettingsSchema, moduleSettingsOwners, () => {
      discordStore.saveSettings()
      factorioStore.saveSettings()
    })
  }

  return {
    deleteAllModels,
    resetProvidersSettings,
    resetModulesSettings,
    deleteAllChatSessions,
    createModuleSettingsExportAdapter,
    createModuleSettingsImportAdapter,
    deleteAllData,
    deleteAllDataWithHost,
    resetDesktopApplicationState,
  }
}
