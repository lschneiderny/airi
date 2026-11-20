import type { Pinia } from 'pinia'

import { modelScopedStorageKey } from '@proj-airi/stage-shared/composables'
import { useSettingsScreenAmbientLight } from '@proj-airi/stage-shared/stores/screen-ambient-light'
import { useLive2DNaturalSettings, useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useLive2dParams } from '@proj-airi/stage-ui-live2d/stores/model-parameters'
import { useMMD } from '@proj-airi/stage-ui-mmd/stores/mmd'
import { useMMDNaturalSettings } from '@proj-airi/stage-ui-mmd/stores/natural-settings'
import { useSpine } from '@proj-airi/stage-ui-spine/stores/spine'
import { useTachie } from '@proj-airi/stage-ui-tachie/stores/tachie'
import { useModelStore } from '@proj-airi/stage-ui-three/stores/model-store'

import { useConversationSettings } from '../features/conversation/settings'
import { useHostNoticeSettings } from '../features/host-capabilities/notice-settings'
import { useLive2DMotionMagicSettings } from '../features/motions/live2d'
import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { useSituationSettings } from '../features/situation/settings'
import { clearSherpawModelAssets } from '../libs/providers/providers/sherpaw/model-assets'
import { useCharacterStateStore } from '../stores/character-state'
import { useChatStore } from '../stores/chat'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useDisplayModelsStore } from '../stores/display-models'
import { useMcpStore } from '../stores/mcp'
import { useMemoryStore } from '../stores/memory'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useArtistryStore } from '../stores/modules/artistry'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useConsciousnessSettingsStore } from '../stores/modules/consciousness-settings'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useMinecraftStore } from '../stores/modules/gaming-minecraft'
import { useHearingStore } from '../stores/modules/hearing'
import { useHomeAssistantStore } from '../stores/modules/home-assistant'
import { useSpeechStore } from '../stores/modules/speech'
import { useVisionProcessingStore, useVisionStore } from '../stores/modules/vision'
import { useWebSearchStore } from '../stores/modules/web-search'
import { useOnboardingStore } from '../stores/onboarding'
import { useProviderStore } from '../stores/providers/provider'
import { useRecipesStore } from '../stores/recipes'
import {
  useSettingsAnalytics,
  useSettingsAudioDevice,
  useSettingsBeatSync,
  useSettingsControlsIsland,
  useSettingsDeveloper,
  useSettingsGeneral,
  useSettingsSpine,
  useSettingsStageModel,
  useSettingsTheme,
} from '../stores/settings'
import { useSituationStore } from '../stores/situation'
import { useToolCardsStore } from '../stores/tool-cards'
import { useVoiceprintStore } from '../stores/voiceprint'

/** The tiers of `docs/ai/context/state-persistence.md`, the closed plain-ref tier, and caches the app can rebuild. */
export type PersistenceTier = 1 | 2 | 3 | 4 | 'plain' | 'cache'

interface LocationFlags {
  /** Only an older release or a `// NOTICE:` move wrote it. The sweep removes it; a write to it fails the focused test. */
  legacy?: true
  /** The owner reset writes it and the sweep leaves it. Only the voiceprint deletion time, which an enrollment started before the deletion must still see. */
  kept?: true
}

export type StorageLocation
  = | (LocationFlags & { area: 'localStorage', key: string })
    | (LocationFlags & { area: 'localStorage', prefix: string })
  /**
   * A per-model display setting, declared with its unscoped key such as `settings/live2d/scale`. It matches that key
   * and `modelScopedStorageKey(id, key)` of every model id, so the sweep reaches models that are not active.
   */
    | { area: 'localStorage', perModel: string }
    | { area: 'sessionStorage', key: string }
  /** Records of one IndexedDB object store, all of them or those whose key starts with `prefix`. */
    | (LocationFlags & { area: 'indexedDB', database: string, store: string, prefix?: string })
  /** A whole database that only an older release wrote. */
    | { area: 'indexedDB', database: string, legacy: true }
    | { area: 'opfs', directory: string }
  /** The OPFS root directories that the Live2D and MMD model caches name by display model id. */
    | { area: 'opfs', displayModelCaches: true }
    | { area: 'cacheStorage', cache: string }

export interface ResetContext {
  /** The Pinia instance of the window that runs the reset. Owner stores are taken from it, never from the active Pinia. */
  pinia: Pinia
}

export interface StateRegistration {
  /** Stable kebab-case id. Test failures and the partial resets name it. */
  readonly id: string
  /** The store, repository, composable, or component that owns the state. */
  readonly owner: string
  /** Repository paths of every file that writes a location. The static scan fails on a write from any other file. */
  readonly writers: readonly string[]
  readonly tier: PersistenceTier
  /** The heading of a named exception in `state-persistence.md`, when the state is one. */
  readonly exception?: string
  readonly locations: readonly StorageLocation[]
  /**
   * Resets the owner before the sweep: leader-routed actions, in-memory refs in this window, and side effects such as
   * cancelling a pending send. Without it the sweep alone resets the state.
   */
  readonly reset?: (context: ResetContext) => Promise<void> | void
}

/** Keeps the ids as literal types, so the partial resets name registrations that exist. */
export function defineStateRegistry<const T extends readonly StateRegistration[]>(registrations: T): T {
  return registrations
}

/**
 * Every piece of persisted renderer state, in reset order.
 *
 * - The voiceprints go first, so a failed step below cannot keep a voiceprint.
 * - The expression documents go before the display models: removing the models switches the stage to the default
 *   model, which must load without a stored catalog.
 * - The chat sessions go before the situation's inner state, because deleting the sessions forgets their threads.
 * - A store whose creation connects or loads (the mods server channel, the sticker library, the background stores)
 *   has no owner reset; the sweep alone resets it.
 *
 * Not registered, and named in `docs/ai/context/state-persistence.md`: the main-process files that
 * `storedDataDeleteActivity` deletes (session logs, IO traces, the computer-use store), the perf records with their own
 * retention, and the storage that the analytics SDKs keep when a build loads them.
 */
export const stateRegistry = defineStateRegistry([
  {
    id: 'voiceprints',
    owner: 'useVoiceprintStore',
    writers: ['packages/stage-ui/src/stores/voiceprint.ts'],
    tier: 'plain',
    exception: 'Voiceprints',
    locations: [
      { area: 'localStorage', key: 'settings/voice/voiceprints' },
      { area: 'localStorage', key: 'settings/voice/voiceprint-deleted-at', kept: true },
      { area: 'localStorage', key: 'settings/voice/voiceprint', legacy: true },
    ],
    reset: ({ pinia }) => useVoiceprintStore(pinia).removeAll(),
  },
  {
    id: 'expression-documents',
    owner: 'useExpressionStore, useMMDExpressionStore',
    writers: [
      'packages/stage-ui-live2d/src/stores/expression-store.ts',
      'packages/stage-ui-live2d/src/stores/expression-catalog-persistence.ts',
      'packages/stage-ui-mmd/src/stores/expression-store.ts',
    ],
    tier: 3,
    exception: 'Expression documents',
    locations: [
      { area: 'localStorage', prefix: 'expression-catalog:' },
      { area: 'localStorage', prefix: 'expression-rest:' },
    ],
  },
  {
    id: 'display-models',
    owner: 'useDisplayModelsStore',
    writers: ['packages/stage-ui/src/database/repos/display-models.repo.ts'],
    tier: 4,
    locations: [
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'display-model-' },
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'transfer-task-' },
    ],
    reset: async ({ pinia }) => {
      await useDisplayModelsStore(pinia).resetDisplayModels()
      // Clears the selection that only lives in memory, then loads the default model.
      await useSettingsStageModel(pinia).resetState()
    },
  },
  {
    id: 'provider-settings',
    owner: 'useProviderConfigStore',
    writers: [
      'packages/stage-ui/src/stores/providers/config.ts',
      'apps/stage-tamagotchi/src/renderer/bridges/opencode-go-migration.ts',
    ],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/providers/configured' },
      { area: 'localStorage', key: 'settings/providers/added' },
      { area: 'localStorage', key: 'settings/credentials/providers' },
    ],
    reset: async ({ pinia }) => {
      await useProviderStore(pinia).resetProviderSettings()
      await useAiriCardStore(pinia).clearUnavailableProviderSelections()
      await useHearingStore(pinia).clearUnavailableProviderSelection()
    },
  },
  {
    id: 'hearing',
    owner: 'useHearingStore',
    writers: ['packages/stage-ui/src/stores/modules/hearing.ts'],
    tier: 'plain',
    // Exact keys: the app owns the two push-to-talk keys under the same path.
    locations: [
      { area: 'localStorage', key: 'settings/hearing/enabled' },
      { area: 'localStorage', key: 'settings/hearing/active-provider' },
      { area: 'localStorage', key: 'settings/hearing/active-model' },
      { area: 'localStorage', key: 'settings/hearing/active-custom-model' },
      { area: 'localStorage', key: 'settings/hearing/input-mode' },
      { area: 'localStorage', key: 'settings/hearing/auto-send-enabled' },
      { area: 'localStorage', key: 'settings/hearing/auto-send-delay' },
      { area: 'localStorage', key: 'settings/hearing/confidence-threshold' },
      { area: 'localStorage', key: 'settings/hearing/rephrase-enabled' },
      { area: 'localStorage', key: 'settings/hearing/end-judge-enabled' },
      { area: 'localStorage', key: 'settings/hearing/speaker-recognition-enabled' },
      { area: 'localStorage', key: 'settings/hearing/rephrase-provider' },
      { area: 'localStorage', key: 'settings/hearing/rephrase-model' },
    ],
    reset: ({ pinia }) => useHearingStore(pinia).resetState(),
  },
  {
    id: 'home-assistant',
    owner: 'useHomeAssistantStore',
    writers: ['packages/stage-ui/src/stores/modules/home-assistant.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', prefix: 'settings/home-assistant/' }],
    reset: ({ pinia }) => useHomeAssistantStore(pinia).resetState(),
  },
  {
    id: 'speech',
    owner: 'useSpeechStore',
    writers: ['packages/stage-ui/src/stores/modules/speech.ts'],
    tier: 'plain',
    // Exact keys: `useSpeechOutputControlStore` owns `settings/speech/output-*`.
    locations: [
      { area: 'localStorage', key: 'settings/speech/active-provider' },
      { area: 'localStorage', key: 'settings/speech/active-model' },
      { area: 'localStorage', key: 'settings/speech/voice' },
      { area: 'localStorage', key: 'settings/speech/enabled' },
      { area: 'localStorage', key: 'settings/speech/ssml-enabled' },
      { area: 'localStorage', key: 'settings/speech/pitch' },
      { area: 'localStorage', key: 'settings/speech/rate' },
    ],
    reset: ({ pinia }) => useSpeechStore(pinia).resetState(),
  },
  {
    id: 'character-state',
    owner: 'useCharacterStateStore',
    writers: ['packages/stage-ui/src/database/repos/character-state.repo.ts'],
    tier: 4,
    locations: [{ area: 'indexedDB', database: 'airi-character-state', store: 'cards' }],
    // Her mood, temperament, relationship with the owner, and pacing memory, for every card.
    reset: ({ pinia }) => useCharacterStateStore(pinia).resetState(),
  },
  {
    id: 'consciousness',
    owner: 'useConsciousnessStore',
    writers: ['packages/stage-ui/src/stores/modules/consciousness.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/consciousness/active-provider' },
      { area: 'localStorage', key: 'settings/consciousness/active-model' },
      { area: 'localStorage', key: 'settings/consciousness/active-custom-model' },
      { area: 'localStorage', key: 'settings/consciousness/active-temperature' },
      { area: 'localStorage', key: 'settings/consciousness/active-top-p' },
    ],
    reset: ({ pinia }) => useConsciousnessStore(pinia).resetState(),
  },
  {
    id: 'consciousness-settings',
    owner: 'useConsciousnessSettingsStore',
    writers: ['packages/stage-ui/src/stores/modules/consciousness-settings.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/consciousness/reasoning' },
      { area: 'localStorage', key: 'settings/consciousness/temperature-enabled' },
      { area: 'localStorage', key: 'settings/consciousness/top-p-enabled' },
    ],
    reset: ({ pinia }) => useConsciousnessSettingsStore(pinia).resetState(),
  },
  {
    id: 'web-search',
    owner: 'useWebSearchStore',
    writers: ['packages/stage-ui/src/stores/modules/web-search.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', prefix: 'settings/web-search/' }],
    reset: ({ pinia }) => useWebSearchStore(pinia).resetState(),
  },
  {
    id: 'discord',
    owner: 'useDiscordStore',
    writers: ['packages/stage-ui/src/stores/modules/discord.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', prefix: 'settings/discord/' }],
    reset: ({ pinia }) => useDiscordStore(pinia).resetState(),
  },
  {
    id: 'factorio',
    owner: 'useFactorioStore',
    writers: ['packages/stage-ui/src/stores/modules/gaming-module-factory.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', prefix: 'settings/factorio/' }],
    reset: ({ pinia }) => useFactorioStore(pinia).resetState(),
  },
  {
    id: 'minecraft',
    owner: 'useMinecraftStore',
    writers: ['packages/stage-ui/src/stores/modules/gaming-minecraft.ts'],
    tier: 'plain',
    // The store keeps its runtime context in memory only. Releases that built it with `createGamingModuleStore` wrote
    // these keys.
    locations: [{ area: 'localStorage', prefix: 'settings/minecraft/', legacy: true }],
    reset: ({ pinia }) => useMinecraftStore(pinia).resetState(),
  },
  {
    id: 'memory',
    owner: 'useMemoryStore',
    writers: ['packages/stage-ui/src/database/repos/memory.repo.ts', 'packages/stage-ui/src/stores/memory.ts'],
    tier: 4,
    exception: 'Long-term memory',
    locations: [
      { area: 'indexedDB', database: 'airi-memory', store: 'entries' },
      { area: 'localStorage', key: 'memory/enabled' },
      { area: 'localStorage', key: 'memory/entries', legacy: true },
    ],
    reset: ({ pinia }) => useMemoryStore(pinia).resetState(),
  },
  {
    id: 'recipes',
    owner: 'useRecipesStore',
    writers: ['packages/stage-ui/src/database/repos/recipes.repo.ts', 'packages/stage-ui/src/stores/recipes.ts'],
    tier: 4,
    exception: 'Recipes',
    locations: [
      { area: 'indexedDB', database: 'airi-recipes', store: 'recipes' },
      { area: 'localStorage', key: 'recipes/proposals-enabled' },
      { area: 'localStorage', key: 'recipes/custom', legacy: true },
    ],
    reset: ({ pinia }) => useRecipesStore(pinia).resetState(),
  },
  {
    id: 'chat-sessions',
    owner: 'useChatSessionStore',
    writers: ['packages/stage-ui/src/database/repos/chat-sessions.repo.ts'],
    tier: 4,
    // The `local` mount writes idb-keyval's default database under its `airi-local` base.
    locations: [{ area: 'indexedDB', database: 'keyval-store', store: 'keyval', prefix: 'airi-local:chat:' }],
    reset: async ({ pinia }) => {
      await useChatStore(pinia).cancelPendingSends()
      await useChatSessionStore(pinia).resetAllSessions()
      // The threads extracted from the sessions are derived from their messages, so they go with them.
      useSituationStore(pinia).forget({ scope: 'threads' })
    },
  },
  {
    id: 'chat-assets',
    owner: 'chatAssetsRepo',
    writers: ['packages/stage-ui/src/database/repos/chat-assets.repo.ts'],
    tier: 4,
    exception: 'Chat assets',
    locations: [{ area: 'indexedDB', database: 'airi-chat-assets', store: 'assets' }],
  },
  {
    id: 'settings-general',
    owner: 'useSettingsGeneral',
    writers: ['packages/stage-ui/src/stores/settings/general.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/language' },
      { area: 'localStorage', key: 'settings/streamer-mode' },
      { area: 'localStorage', key: 'settings/disable-transitions' },
      { area: 'localStorage', key: 'settings/use-page-specific-transitions' },
      { area: 'localStorage', key: 'settings/websocket/secure-enabled' },
    ],
    reset: ({ pinia }) => useSettingsGeneral(pinia).resetState(),
  },
  {
    id: 'settings-analytics',
    owner: 'useSettingsAnalytics',
    writers: ['packages/stage-ui/src/stores/settings/analytics.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/analytics/opted-in' },
      { area: 'localStorage', key: 'settings/analytics/enabled', legacy: true },
    ],
    reset: ({ pinia }) => useSettingsAnalytics(pinia).resetState(),
  },
  {
    id: 'settings-spine',
    owner: 'useSettingsSpine',
    writers: ['packages/stage-ui/src/stores/settings/spine.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/spine/premultiplied-alpha' },
      { area: 'localStorage', perModel: 'settings/spine/default-mix' },
      { area: 'localStorage', perModel: 'settings/spine/idle-enabled' },
      { area: 'localStorage', key: 'settings/spine/max-fps' },
      { area: 'localStorage', key: 'settings/spine/render-scale' },
    ],
    reset: ({ pinia }) => useSettingsSpine(pinia).resetState(),
  },
  {
    id: 'tachie',
    owner: 'useTachie',
    writers: ['packages/stage-ui-tachie/src/stores/tachie.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/tachie/position' },
      { area: 'localStorage', perModel: 'settings/tachie/scale' },
      { area: 'localStorage', perModel: 'settings/tachie/shadow-enabled' },
      { area: 'localStorage', key: 'settings/tachie/render-scale' },
    ],
    reset: ({ pinia }) => useTachie(pinia).resetState(),
  },
  {
    id: 'settings-theme',
    owner: 'useSettingsTheme',
    writers: ['packages/stage-ui/src/stores/settings/theme.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/theme/colors/hue' },
      { area: 'localStorage', key: 'settings/theme/colors/hue-dynamic' },
    ],
    reset: ({ pinia }) => useSettingsTheme(pinia).resetState(),
  },
  {
    id: 'settings-controls-island',
    owner: 'useSettingsControlsIsland',
    writers: ['packages/stage-ui/src/stores/settings/controls-island.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/allow-visible-on-all-workspaces' },
      { area: 'localStorage', key: 'settings/always-on-top' },
      { area: 'localStorage', key: 'settings/controls-island/icon-size' },
    ],
    reset: ({ pinia }) => useSettingsControlsIsland(pinia).resetState(),
  },
  {
    id: 'settings-developer',
    owner: 'useSettingsDeveloper',
    writers: ['packages/stage-ui/src/stores/settings/developer.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/developer/inspect-updater-diagnostics' },
      { area: 'localStorage', key: 'settings/developer/show-tool-payloads-as-json' },
    ],
    reset: ({ pinia }) => useSettingsDeveloper(pinia).resetState(),
  },
  {
    id: 'audio-device',
    owner: 'useSettingsAudioDevice',
    writers: ['packages/stage-ui/src/stores/settings/audio-device.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/audio/input' },
      { area: 'localStorage', key: 'settings/audio/input/enabled' },
      { area: 'localStorage', key: 'settings/audio/input/off' },
    ],
    reset: ({ pinia }) => useSettingsAudioDevice(pinia).resetState(),
  },
  {
    id: 'live2d-params',
    owner: 'useLive2dParams, useL2dViewControl',
    writers: [
      'packages/stage-ui-live2d/src/stores/model-parameters.ts',
      'packages/stage-ui-live2d/src/stores/view-control.ts',
    ],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/live2d/current-motion' },
      { area: 'localStorage', perModel: 'settings/live2d/available-motions' },
      { area: 'localStorage', perModel: 'settings/live2d/motion-map' },
      { area: 'localStorage', perModel: 'settings/live2d/parameters' },
      { area: 'localStorage', perModel: 'settings/live2d/position' },
      { area: 'localStorage', perModel: 'settings/live2d/scale' },
    ],
    reset: ({ pinia }) => useLive2dParams(pinia).resetState(),
  },
  {
    id: 'live2d-settings',
    owner: 'useSettingsLive2d',
    writers: ['packages/stage-ui-live2d/src/composables/live2d/live2d.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/live2d/motion-driver' },
      { area: 'localStorage', perModel: 'settings/live2d/eye-tracking' },
      { area: 'localStorage', perModel: 'settings/live2d/model-eye-offset' },
      { area: 'localStorage', perModel: 'settings/live2d/idle-animation-enabled' },
      { area: 'localStorage', perModel: 'settings/live2d/idle-eye-animation-enabled' },
      { area: 'localStorage', perModel: 'settings/live2d/expression-enabled' },
      { area: 'localStorage', perModel: 'settings/live2d/shadow-enabled' },
      { area: 'localStorage', key: 'settings/live2d/auto-blink-enabled' },
      { area: 'localStorage', key: 'settings/live2d/force-auto-blink-enabled' },
      { area: 'localStorage', key: 'settings/live2d/max-fps' },
      { area: 'localStorage', key: 'settings/live2d/render-scale' },
    ],
    reset: ({ pinia }) => useSettingsLive2d(pinia).resetState(),
  },
  {
    id: 'live2d-motion-magic',
    owner: 'useLive2DMotionMagicSettings',
    writers: ['packages/stage-ui/src/features/motions/live2d/settings.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/live2d/magic/idle-profile' },
      { area: 'localStorage', perModel: 'settings/live2d/magic/speaking-profile' },
      { area: 'localStorage', perModel: 'settings/live2d/magic/follow-speech' },
      { area: 'localStorage', perModel: 'settings/live2d/magic/skip-mouth-open' },
      { area: 'localStorage', perModel: 'settings/live2d/magic/force-view-target' },
    ],
    reset: ({ pinia }) => useLive2DMotionMagicSettings(pinia).resetState(),
  },
  {
    id: 'screen-ambient-light',
    owner: 'useSettingsScreenAmbientLight',
    writers: ['packages/stage-shared/src/stores/screen-ambient-light.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', prefix: 'settings/screen-ambient-light/' }],
    reset: ({ pinia }) => useSettingsScreenAmbientLight(pinia).resetState(),
  },
  {
    id: 'three',
    owner: 'useModelStore, useThreeViewControl, useThreeCamera',
    writers: [
      'packages/stage-ui-three/src/stores/model-store.ts',
      'packages/stage-ui-three/src/stores/view-control.ts',
      'packages/stage-ui-three/src/stores/camera.ts',
    ],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/stage-ui-three/modelRotationY' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/trackingMode' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/lastModelId' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/modelSize' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/modelOrigin' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/eyeHeight' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/lookAtTarget' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/directional-light/position' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/directional-light/target' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/directional-light/rotation' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/directional-light/intensity' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/directional-light/color' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/hemisphere-light/sky-color' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/hemisphere-light/ground-color' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/hemisphere-light/intensity' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/ambient-light/color' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/scenes/scene/ambient-light/intensity' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/envEnabled' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/skyBoxUrl' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/skyBoxIntensity' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/modelOffset' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/cameraFOV' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/cameraDistance' },
      { area: 'localStorage', perModel: 'settings/stage-ui-three/camera-position' },
      { area: 'localStorage', key: 'settings/stage-ui-three/max-fps' },
      { area: 'localStorage', key: 'settings/stage-ui-three/last-committed-model-id' },
      { area: 'localStorage', key: 'settings/stage-ui-three/renderScale' },
      { area: 'localStorage', key: 'settings/stage-ui-three/multisampling' },
      { area: 'localStorage', key: 'settings/stage-ui-three/lastModelSrc', legacy: true },
    ],
    reset: ({ pinia }) => useModelStore(pinia).resetModelStore(),
  },
  {
    id: 'mmd',
    owner: 'useMMD, useMMDViewControl',
    writers: ['packages/stage-ui-mmd/src/stores/mmd.ts', 'packages/stage-ui-mmd/src/stores/view-control.ts'],
    tier: 'plain',
    // Exact keys: `useMMDNaturalSettings` owns `settings/mmd/natural`.
    locations: [
      { area: 'localStorage', perModel: 'settings/mmd/physics-enabled' },
      { area: 'localStorage', perModel: 'settings/mmd/ik-enabled' },
      { area: 'localStorage', perModel: 'settings/mmd/grant-enabled' },
      { area: 'localStorage', perModel: 'settings/mmd/physics-gravity' },
      { area: 'localStorage', perModel: 'settings/mmd/gaze-mode' },
      { area: 'localStorage', perModel: 'settings/mmd/motion-driver' },
      { area: 'localStorage', perModel: 'settings/mmd/camera-fov' },
      { area: 'localStorage', perModel: 'settings/mmd/ambient-color' },
      { area: 'localStorage', perModel: 'settings/mmd/ambient-intensity' },
      { area: 'localStorage', perModel: 'settings/mmd/directional-color' },
      { area: 'localStorage', perModel: 'settings/mmd/directional-intensity' },
      { area: 'localStorage', perModel: 'settings/mmd/directional-position' },
      { area: 'localStorage', perModel: 'settings/mmd/albedo-glow' },
      { area: 'localStorage', perModel: 'settings/mmd/idle-motion' },
      { area: 'localStorage', perModel: 'settings/mmd/motions' },
      { area: 'localStorage', perModel: 'settings/mmd/available-clip-meta' },
      { area: 'localStorage', perModel: 'settings/mmd/emotion-action-map' },
      { area: 'localStorage', perModel: 'settings/mmd/morph-overrides' },
      { area: 'localStorage', perModel: 'settings/mmd/available-morphs' },
      { area: 'localStorage', perModel: 'settings/mmd/available-materials' },
      { area: 'localStorage', perModel: 'settings/mmd/material-opacity' },
      { area: 'localStorage', perModel: 'settings/mmd/position' },
      { area: 'localStorage', perModel: 'settings/mmd/scale' },
      { area: 'localStorage', perModel: 'settings/mmd/rotationY' },
      { area: 'localStorage', key: 'settings/mmd/render-scale' },
      { area: 'localStorage', key: 'settings/mmd/stage-character-height' },
      { area: 'localStorage', key: 'settings/mmd/roam-mode' },
      { area: 'localStorage', key: 'settings/mmd/stance-slots' },
      { area: 'localStorage', key: 'settings/mmd/clip-curation' },
      // Imported motions, in the database of the `device` mount through the store's own unstorage instance.
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'mmd-motion-' },
    ],
    reset: ({ pinia }) => useMMD(pinia).resetState(),
  },
  {
    id: 'situation-settings',
    owner: 'useSituationSettings',
    writers: ['packages/stage-ui/src/features/situation/settings.ts'],
    tier: 1,
    locations: [{ area: 'localStorage', key: 'settings/situation' }],
    reset: ({ pinia }) => useSituationSettings(pinia).reset(),
  },
  {
    id: 'expression-performance-settings',
    owner: 'useExpressionPerformanceSettings',
    writers: ['packages/stage-ui/src/features/performance/settings.ts'],
    tier: 1,
    locations: [{ area: 'localStorage', key: 'settings/expression-performance' }],
    reset: ({ pinia }) => useExpressionPerformanceSettings(pinia).reset(),
  },
  {
    id: 'host-notice-settings',
    owner: 'useHostNoticeSettings',
    writers: ['packages/stage-ui/src/features/host-capabilities/notice-settings.ts'],
    tier: 1,
    locations: [{ area: 'localStorage', key: 'settings/host-notice' }],
    reset: ({ pinia }) => useHostNoticeSettings(pinia).reset(),
  },
  {
    id: 'live2d-natural-settings',
    owner: 'useLive2DNaturalSettings',
    writers: ['packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts'],
    tier: 1,
    locations: [
      { area: 'localStorage', key: 'settings/live2d/natural' },
      { area: 'localStorage', prefix: 'settings/live2d/natural-', legacy: true },
    ],
    reset: ({ pinia }) => useLive2DNaturalSettings(pinia).reset(),
  },
  {
    id: 'mmd-natural-settings',
    owner: 'useMMDNaturalSettings',
    writers: ['packages/stage-ui-mmd/src/stores/natural-settings.ts'],
    tier: 1,
    locations: [
      { area: 'localStorage', key: 'settings/mmd/natural' },
      { area: 'localStorage', prefix: 'settings/mmd/natural-', legacy: true },
    ],
    reset: ({ pinia }) => useMMDNaturalSettings(pinia).reset(),
  },
  {
    id: 'mcp',
    owner: 'useMcpStore',
    writers: ['packages/stage-ui/src/stores/mcp.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/mcp/server-cmd' },
      { area: 'localStorage', key: 'settings/mcp/server-args' },
      { area: 'localStorage', key: 'mcp/connected' },
    ],
    reset: ({ pinia }) => useMcpStore(pinia).resetState(),
  },
  {
    id: 'onboarding',
    owner: 'useOnboardingStore',
    writers: ['packages/stage-ui/src/stores/onboarding.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'onboarding/steps' },
      { area: 'localStorage', key: 'onboarding/completed', legacy: true },
      { area: 'localStorage', key: 'onboarding/skipped', legacy: true },
    ],
    // A follower routes this synced action to the leader; await it so the reset commits before the sweep.
    reset: ({ pinia }) => useOnboardingStore(pinia).resetSetupState(),
  },
  {
    id: 'airi-cards',
    owner: 'useAiriCardStore',
    writers: ['packages/stage-ui/src/stores/modules/airi-card.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'airi-cards' },
      { area: 'localStorage', key: 'airi-card-active-id' },
      { area: 'localStorage', key: 'airi-card-module-defaults', legacy: true },
      { area: 'localStorage', key: 'settings/stage/model', legacy: true },
    ],
    reset: ({ pinia }) => useAiriCardStore(pinia).resetState(),
  },
  {
    id: 'sherpaw-model-assets',
    owner: 'sherpawModelAssets',
    writers: [
      'packages/stage-ui/src/libs/providers/providers/sherpaw/model-assets.ts',
      'packages/stage-ui/src/libs/inference/model-assets-opfs.ts',
    ],
    tier: 'cache',
    locations: [{ area: 'opfs', directory: 'airi-model-assets' }],
    // In the desktop app the main process keeps the assets, and only this call reaches them.
    reset: () => clearSherpawModelAssets(),
  },
  {
    id: 'situation-inner-state',
    owner: 'useSituationStore',
    writers: ['packages/stage-ui/src/features/situation/inner-state.ts'],
    tier: 2,
    exception: 'The gate\'s inner state',
    locations: [{ area: 'localStorage', key: 'settings/situation-inner' }],
    reset: ({ pinia }) => useSituationStore(pinia).forget({ scope: 'everything' }),
  },

  // Registrations that "Delete all data" did not reach before the state registry.

  {
    id: 'conversation-settings',
    owner: 'useConversationSettings',
    writers: ['packages/stage-ui/src/features/conversation/settings.ts'],
    tier: 1,
    locations: [{ area: 'localStorage', key: 'settings/conversation' }],
    reset: ({ pinia }) => useConversationSettings(pinia).reset(),
  },
  {
    id: 'vision',
    owner: 'useVisionStore',
    writers: ['packages/stage-ui/src/stores/modules/vision/store.ts'],
    tier: 'plain',
    // Exact keys: `useVisionProcessingStore` owns `settings/vision/capture-interval-ms`.
    locations: [
      { area: 'localStorage', key: 'settings/vision/enabled' },
      { area: 'localStorage', key: 'settings/vision/active-provider' },
      { area: 'localStorage', key: 'settings/vision/active-model' },
      { area: 'localStorage', key: 'settings/vision/active-custom-model' },
      { area: 'localStorage', key: 'settings/vision/ollama-thinking-enabled' },
      { area: 'localStorage', key: 'settings/vision/use-for-chat' },
      { area: 'localStorage', key: 'settings/vision/use-for-tool-images' },
    ],
    reset: ({ pinia }) => useVisionStore(pinia).resetState(),
  },
  {
    id: 'vision-processing',
    owner: 'useVisionProcessingStore',
    writers: ['packages/stage-ui/src/stores/modules/vision/processing-store.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'settings/vision/capture-interval-ms' }],
    reset: ({ pinia }) => useVisionProcessingStore(pinia).resetState(),
  },
  {
    id: 'artistry',
    owner: 'useArtistryStore',
    writers: ['packages/stage-ui/src/stores/modules/artistry.ts'],
    tier: 'plain',
    // Holds the Replicate and Nano Banana API keys.
    locations: [{ area: 'localStorage', prefix: 'artistry-' }],
    reset: ({ pinia }) => useArtistryStore(pinia).resetState(),
  },
  {
    id: 'tool-cards',
    owner: 'useToolCardsStore',
    writers: ['packages/stage-ui/src/stores/tool-cards.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'tool-cards/cards' }],
    // Each removal is leader-routed and also forgets the saved result of the card.
    reset: async ({ pinia }) => {
      const toolCards = useToolCardsStore(pinia)
      for (const card of toolCards.cards)
        await toolCards.remove(card.key)
    },
  },
  {
    id: 'tool-card-data',
    owner: 'toolCardDataRepo',
    writers: ['packages/stage-ui/src/database/repos/tool-card-data.repo.ts'],
    tier: 4,
    locations: [{ area: 'indexedDB', database: 'keyval-store', store: 'keyval', prefix: 'airi-local:tool-cards:' }],
  },
  {
    id: 'tool-card-settings',
    owner: 'useToolCardsStore',
    writers: ['packages/stage-ui/src/stores/tool-cards.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/tool-cards/enabled' },
      { area: 'localStorage', key: 'settings/tool-cards/reply-cards' },
    ],
  },
  {
    id: 'characters',
    owner: 'useCharacterStore',
    writers: ['packages/stage-ui/src/models/characters.ts'],
    tier: 4,
    locations: [{ area: 'indexedDB', database: 'keyval-store', store: 'keyval', prefix: 'airi-local:characters' }],
  },
  {
    id: 'outbox',
    owner: 'storage (the `outbox` mount)',
    writers: ['packages/stage-ui/src/database/storage.ts'],
    tier: 4,
    // Upstream's mount; nothing in the client reads or writes it.
    locations: [{ area: 'indexedDB', database: 'keyval-store', store: 'keyval', prefix: 'airi-sync-queue:' }],
  },
  {
    id: 'backgrounds',
    owner: 'useBackgroundStore (stage-ui)',
    writers: ['packages/stage-ui/src/stores/background.ts'],
    tier: 4,
    locations: [
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'bg-' },
      // The built-in backgrounds, which the store seeds on its first load.
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'builtin:' },
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'image-journal-', legacy: true },
    ],
  },
  {
    id: 'layout-backgrounds',
    owner: 'useBackgroundStore (stage-layouts)',
    writers: ['packages/stage-layouts/src/stores/background.ts'],
    tier: 4,
    locations: [
      { area: 'indexedDB', database: 'localforage', store: 'keyvaluepairs', prefix: 'background-' },
      { area: 'localStorage', key: 'settings/theme/background/gallery-active' },
      { area: 'localStorage', key: 'settings/theme/background/gallery-options' },
      { area: 'localStorage', key: 'settings/theme/background/sampled-color' },
    ],
  },
  {
    id: 'stickers',
    owner: 'useStickersStore',
    writers: ['packages/stage-ui/src/database/repos/stickers.repo.ts', 'packages/stage-ui/src/stores/modules/stickers.ts'],
    tier: 4,
    locations: [
      { area: 'indexedDB', database: 'airi-sticker-library', store: 'records' },
      { area: 'localStorage', key: 'settings/stickers/enabled' },
      { area: 'localStorage', key: 'settings/stickers/frequency' },
      { area: 'indexedDB', database: 'airi-stickers', legacy: true },
    ],
  },
  {
    id: 'settings-beat-sync',
    owner: 'useSettingsBeatSync',
    writers: ['packages/stage-ui/src/stores/settings/beat-sync.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/beat-sync/parameters' },
      { area: 'localStorage', key: 'settings/beat-sync/spectrum-scale' },
    ],
    reset: ({ pinia }) => useSettingsBeatSync(pinia).resetState(),
  },
  {
    id: 'spine',
    owner: 'useSpine, useSpineViewControl',
    writers: ['packages/stage-ui-spine/src/stores/spine.ts', 'packages/stage-ui-spine/src/stores/view-control.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', perModel: 'settings/spine/current-animation' },
      { area: 'localStorage', perModel: 'settings/spine/available-animations' },
      { area: 'localStorage', perModel: 'settings/spine/available-skins' },
      { area: 'localStorage', perModel: 'settings/spine/current-skin' },
      { area: 'localStorage', perModel: 'settings/spine/available-variants' },
      { area: 'localStorage', perModel: 'settings/spine/current-variant' },
      { area: 'localStorage', perModel: 'settings/spine/animation-speed' },
      { area: 'localStorage', perModel: 'settings/spine/position' },
      { area: 'localStorage', perModel: 'settings/spine/scale' },
    ],
    reset: ({ pinia }) => useSpine(pinia).resetState(),
  },
  {
    id: 'mods-server-channel',
    owner: 'useModsServerChannelStore',
    writers: ['packages/stage-ui/src/stores/mods/api/channel-server.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/connection/websocket-url' },
      { area: 'localStorage', key: 'settings/connection/websocket-auth-token' },
    ],
  },
  {
    id: 'speech-output-control',
    owner: 'useSpeechOutputControlStore',
    writers: ['packages/stage-ui/src/stores/speech-output-control.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/speech/output-muted' },
      { area: 'localStorage', key: 'settings/speech/output-volume' },
      { area: 'localStorage', key: 'settings/speech/output-volume-last-audible' },
    ],
  },
  {
    id: 'wake-words',
    owner: 'useWakeWordsStore',
    writers: ['packages/stage-ui/src/stores/wake-words.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'settings/voice/pronunciation-owners' }],
  },
  {
    id: 'feature-flags',
    owner: 'useFeatureFlagsStore',
    writers: ['packages/stage-ui/src/stores/feature-flags.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/feature-flags' },
      { area: 'localStorage', key: 'settings/feature-flag-variants' },
    ],
  },
  {
    id: 'color-scheme',
    owner: 'useTheme',
    writers: ['packages/ui/src/composables/use-theme.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'vueuse-color-scheme' }],
  },
  {
    id: 'danmaku-feed',
    owner: 'useDanmakuFeedSettings, chat-floating.vue',
    writers: [
      'packages/stage-ui/src/composables/use-danmaku-feed-settings.ts',
      'apps/stage-tamagotchi/src/renderer/pages/chat-floating.vue',
    ],
    tier: 'plain',
    locations: [{ area: 'localStorage', prefix: 'chat-window/danmaku/' }],
  },
  {
    id: 'settings-needs-attention',
    owner: 'useSettingsNeedsAttention',
    writers: ['packages/stage-ui/src/composables/use-settings-needs-attention.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'settings/needs-attention/dismissed' }],
  },
  {
    id: 'live2d-runtime-motion',
    owner: 'useLive2dModelSettings',
    writers: ['packages/stage-ui/src/components/scenarios/settings/model-settings/use-live2d-model-settings.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'selected-runtime-motion' },
      { area: 'localStorage', key: 'selected-runtime-motion-group' },
      { area: 'localStorage', key: 'selected-runtime-motion-index' },
    ],
  },
  {
    id: 'chat-voice-mode',
    owner: 'voice-input-button.vue',
    writers: ['packages/stage-ui/src/components/scenarios/chat/components/voice-input-button.vue'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'ui/chat/voice-mode' }],
  },
  {
    id: 'chat-composer-voice-mode',
    owner: 'composer-voice-input.vue',
    writers: ['packages/stage-ui/src/components/scenarios/chat/components/composer-voice-input.vue'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'ui/chat/composer-voice-mode' }],
  },
  {
    id: 'chat-send-mode',
    owner: 'InteractiveArea.vue, ChatArea.vue, ChatActionButtons.vue',
    writers: [
      'apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue',
      'packages/stage-layouts/src/components/Widgets/ChatArea.vue',
      'packages/stage-layouts/src/components/Widgets/ChatActionButtons.vue',
    ],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'ui/chat/settings/send-mode' }],
  },
  {
    id: 'io-tracer-label-width',
    owner: 'trace-timeline.vue',
    writers: ['packages/ui-trace/src/components/timeline/trace-timeline.vue'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'ui/devtools/io-tracer/label-width' }],
  },
  {
    id: 'controls-island',
    owner: 'useControlsIslandStore',
    writers: ['apps/stage-tamagotchi/src/renderer/stores/controls-island.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'controls-island/fade-on-hover-enabled' },
      { area: 'localStorage', key: 'preferences/dont-show-it-again/notice/fade-on-hover' },
    ],
  },
  {
    id: 'server-channel',
    owner: 'useServerChannelSettingsStore',
    writers: ['apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts'],
    tier: 'plain',
    // Holds the desktop server channel token.
    locations: [{ area: 'localStorage', prefix: 'settings/server-channel/' }],
  },
  {
    id: 'push-to-talk-shortcut',
    owner: 'usePushToTalkShortcutSettings',
    writers: ['apps/stage-tamagotchi/src/renderer/composables/use-push-to-talk-shortcut.ts'],
    tier: 'plain',
    locations: [
      { area: 'localStorage', key: 'settings/hearing/push-to-talk-shortcut' },
      { area: 'localStorage', key: 'settings/hearing/push-to-talk-shortcut-error' },
    ],
  },
  {
    id: 'fullscreen-layout',
    owner: 'useFullscreenLayout',
    writers: ['apps/stage-tamagotchi/src/renderer/composables/use-fullscreen-layout.ts'],
    tier: 'plain',
    locations: [{ area: 'localStorage', key: 'fullscreen/surface-width' }],
  },
  {
    id: 'openpanel-device-id',
    owner: 'the OpenPanel client',
    writers: ['packages/stage-ui/src/libs/product-signals/openpanel.ts'],
    tier: 'plain',
    locations: [{ area: 'sessionStorage', key: 'airi:openpanel-device-id' }],
  },
  {
    id: 'trace-source-id',
    owner: 'the IO trace bridge',
    writers: ['apps/stage-tamagotchi/src/renderer/bridges/io-trace-hub.ts'],
    tier: 'plain',
    locations: [{ area: 'sessionStorage', key: 'airi:trace-source-id' }],
  },
  {
    id: 'retired-account-credentials',
    owner: 'removeRetiredAccountCredentials',
    writers: ['packages/stage-ui/src/libs/retired-account.ts'],
    tier: 'plain',
    // Tokens of the retired AIRI account service, which releases before the account-free fork wrote.
    locations: [
      { area: 'localStorage', key: 'auth/v1/token', legacy: true },
      { area: 'localStorage', key: 'auth/v1/refresh-token', legacy: true },
      { area: 'localStorage', key: 'auth/v1/oidc-id-token', legacy: true },
      { area: 'localStorage', key: 'auth/v1/oidc-client-id', legacy: true },
      { area: 'localStorage', key: 'auth/v1/oidc-token-expiry', legacy: true },
      { area: 'localStorage', key: 'auth/v1/oidc-flow-state', legacy: true },
      { area: 'localStorage', key: 'auth/v1/oidc-flow-params', legacy: true },
    ],
  },

  // Caches go last.

  {
    id: 'display-model-caches',
    owner: 'OPFSCache (Live2D and MMD)',
    writers: ['packages/stage-ui-live2d/src/utils/opfs-loader.ts', 'packages/stage-ui-mmd/src/utils/opfs-loader.ts'],
    tier: 'cache',
    // Copies of the imported model files, one directory per display model id.
    locations: [{ area: 'opfs', displayModelCaches: true }],
  },
  {
    id: 'transformers-cache',
    owner: 'Transformers.js in the Kokoro, VAD, and background-removal workers',
    writers: [
      'packages/stage-ui/src/workers/kokoro/worker.ts',
      'packages/stage-ui/src/workers/vad/silero-vad-model.ts',
      'packages/stage-ui/src/workers/background-removal/worker.ts',
      // `caches.open` creates the cache when it measures or checks it.
      'packages/stage-ui/src/libs/inference/transformers-cache.ts',
    ],
    tier: 'cache',
    locations: [{ area: 'cacheStorage', cache: 'transformers-cache' }],
  },
])

export type StateRegistrationId = (typeof stateRegistry)[number]['id']

/** One write, as the browser test observes it and as the sweep enumerates storage. */
export type StorageEntry
  = | { area: 'localStorage' | 'sessionStorage', key: string }
    | { area: 'indexedDB', database: string, store: string, key: string }

/** Whether `key` is `modelScopedStorageKey(id, unscopedKey)` of some model id. */
function isModelScopedKey(key: string, unscopedKey: string): boolean {
  const [head, tail] = modelScopedStorageKey('\0', unscopedKey).split('\0')
  if (!key.startsWith(head) || !key.endsWith(tail))
    return false
  const modelId = key.slice(head.length, key.length - tail.length)
  return modelId.length > 0 && !modelId.includes('/')
}

export function locationMatches(location: StorageLocation, entry: StorageEntry): boolean {
  if (location.area === 'localStorage') {
    if (entry.area !== 'localStorage')
      return false
    if ('key' in location)
      return entry.key === location.key
    if ('prefix' in location)
      return entry.key.startsWith(location.prefix)
    return entry.key === location.perModel || isModelScopedKey(entry.key, location.perModel)
  }
  if (location.area === 'sessionStorage')
    return entry.area === 'sessionStorage' && entry.key === location.key
  if (location.area === 'indexedDB') {
    if (entry.area !== 'indexedDB' || entry.database !== location.database)
      return false
    if (!('store' in location))
      return true
    return entry.store === location.store && entry.key.startsWith(location.prefix ?? '')
  }
  // OPFS directories and caches are not keyed entries.
  return false
}

function isKept(location: StorageLocation): boolean {
  return 'kept' in location && location.kept === true
}

function sweepWebStorage(area: 'localStorage' | 'sessionStorage', locations: readonly StorageLocation[]) {
  const store = area === 'localStorage' ? localStorage : sessionStorage
  const swept = locations.filter(location => location.area === area && !isKept(location))
  if (swept.length === 0)
    return
  for (const key of Object.keys(store)) {
    if (swept.some(location => locationMatches(location, { area, key })))
      store.removeItem(key)
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function databaseExists(name: string): Promise<boolean> {
  const databases = await indexedDB.databases()
  return databases.some(database => database.name === name)
}

/** Deletes the matching records of one object store. Opens only a database that exists, and never creates a store. */
async function sweepObjectStore(database: string, storeName: string, prefix: string | undefined) {
  if (!await databaseExists(database))
    return
  const db = await requestResult(indexedDB.open(database))
  try {
    if (!db.objectStoreNames.contains(storeName))
      return
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    if (prefix === undefined) {
      store.clear()
    }
    else {
      const keys = await requestResult(store.getAllKeys())
      for (const key of keys) {
        if (typeof key === 'string' && key.startsWith(prefix))
          store.delete(key)
      }
    }
    await done
  }
  finally {
    db.close()
  }
}

async function deleteDatabase(name: string) {
  if (!await databaseExists(name))
    return
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    // An open connection delays the deletion until it closes. The deletion stays queued, so do not wait for it.
    request.onblocked = () => resolve()
  })
}

function isMissing(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

async function removeOpfsDirectory(root: FileSystemDirectoryHandle, name: string) {
  try {
    await root.removeEntry(name, { recursive: true })
  }
  catch (error) {
    if (!isMissing(error))
      throw error
  }
}

/** OPFS directories that a registration names. Every other root entry is a display model cache. */
const namedOpfsDirectories = new Set<string>(stateRegistry.flatMap(registration => registration.locations.flatMap(
  location => location.area === 'opfs' && 'directory' in location ? [location.directory] : [],
)))

async function sweepLocation(location: StorageLocation) {
  if (location.area === 'indexedDB') {
    if ('store' in location)
      await sweepObjectStore(location.database, location.store, location.prefix)
    else
      await deleteDatabase(location.database)
    return
  }
  if (location.area === 'opfs') {
    const root = await navigator.storage.getDirectory()
    if ('directory' in location) {
      await removeOpfsDirectory(root, location.directory)
      return
    }
    for await (const name of root.keys()) {
      if (namedOpfsDirectories.has(name))
        continue
      // The Live2D cache holds this lock while it saves into the directory.
      await navigator.locks.request(`airi:live2d-opfs:${name}`, () => removeOpfsDirectory(root, name))
    }
    return
  }
  if (location.area === 'cacheStorage')
    await caches.delete(location.cache)
}

async function sweep(locations: readonly StorageLocation[]) {
  sweepWebStorage('localStorage', locations)
  sweepWebStorage('sessionStorage', locations)
  for (const location of locations)
    await sweepLocation(location)
}

/**
 * Runs the owner reset of each registration in registry order, then sweeps its locations. A failure does not stop the
 * rest; after every registration ran, the first failure is thrown. Without `ids` it runs every registration.
 */
export async function resetRegisteredState(context: ResetContext, ids?: readonly StateRegistrationId[]): Promise<void> {
  const failures: unknown[] = []
  const selected = ids && new Set<string>(ids)
  const registrations: readonly StateRegistration[] = stateRegistry.filter(registration => !selected || selected.has(registration.id))
  for (const registration of registrations) {
    try {
      await registration.reset?.(context)
    }
    catch (error) {
      failures.push(error)
    }
    try {
      await sweep(registration.locations)
    }
    catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0)
    throw failures[0]
}
