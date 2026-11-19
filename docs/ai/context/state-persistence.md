# State persistence

This file describes the code on `main`. A change that makes a statement here false updates this file in the same commit. These rules state where client state lives and how to place new state. These rules win over the ADRs in `docs/ai/adr/`; the ADRs record the history behind them.

Terms follow the [domain glossary](glossary.md), in particular [Leader and follower windows](glossary.md#leader-and-follower-windows) and [Synced settings document](glossary.md#synced-settings-document). Code is cited by repository path and exported symbol.

## Choosing a tier

Choose the first [tier](glossary.md#persistence-tier) that fits the state. A store that persists anything is registered with `useDataMaintenance` (`packages/stage-ui/src/composables/use-data-maintenance.ts`) in the same commit, so "Delete all data" reaches it.

| # | State | Tier |
| --- | --- | --- |
| 1 | A user-facing settings document for one feature | **Synced settings document.** One Valibot-validated document in a synced Pinia store, persisted privately with `listenToStorageChanges: false` and `writeDefaults: false`. Its `update` and `reset` actions are leader-routed, so follower windows never write storage. Build new documents on `useSettingsDocument` (`packages/stage-shared/src/composables/use-settings-document/index.ts`). |
| 2 | Leader-only state that must survive a reload but must not replicate, because it holds personal content or grows with every save | **localStorage by explicit command with a leadership token.** The leader claims a token, and every write carries it; a write over a newer save is refused. Clearing it is leader-routed. |
| 3 | A document per display model that the stage writes | **localStorage keyed by model id.** The stage window writes; other windows send commands. "Delete all data" removes the keys by prefix. Upstream's per-model plain refs are not this tier; see [Per-model display settings](#per-model-display-settings). |
| 4 | Many records or large records | **IndexedDB**, behind a synced store with leader-routed actions when other windows need the records. |
| 5 | Runtime state that another window reads, not persisted | **Synced Pinia memory.** Replicate values, never events, because an event stored in replicated state is replayed with every snapshot. Do not replicate a value that a producer samples periodically unless another window consumes it. |
| 6 | Sensor samples and the leader's observations | **Per-window memory**, unsynced and not persisted. |

Two tiers are closed to new state:

- **Plain localStorage refs** (`useLocalStorageManualReset`, `useModelScopedLocalStorage`, or `useLocalStorage` from `@vueuse/core`), and direct `localStorage` writes from a store action. This is the upstream convention, and most stores in [Members](#members) still use it. New settings use tier 1.
- **A main-process ring with disk recording.** It stays specific to the IO trace hub. Use it only for diagnostics that must outlive a renderer.

A store that fits no tier needs an amendment to this document before it lands.

## Members

The table lists every persisting store and component found in the `src` directories of the workspace packages and in `apps/stage-tamagotchi/src` with the inventory search under [Uses of the search terms that persist nothing](#uses-of-the-search-terms-that-persist-nothing).

Column meanings:

- **Tier**: a number from [Choosing a tier](#choosing-a-tier), or "plain" for the closed plain-ref tier.
- **Writer**: "leader" means only leader-routed actions write storage. "Any window (replicated)" means the persisted refs are synced store state, so every window that holds the store writes the committed value it receives. "Any window" means the store is not synced, and each window writes its own copy.
- **Registered**: whether `useDataMaintenance` resets the store. "Partly" means some of its keys survive.
- **Per model**: a key marked "per model" is declared with its old name, for example `settings/live2d/scale`, and stored once for each display model. See [Per-model display settings](#per-model-display-settings).

### Per-model display settings

Upstream stores the display-model settings of five renderers once for each model. The fork follows it, and its MMD motion driver and clip metadata moved the same way.

- `useModelScopedLocalStorage` and `useModelScopedLocalStorageManualReset` (`packages/stage-shared/src/composables/use-model-scoped-local-storage/index.ts`) declare a setting with a scope (`DisplayModelSettingsScope`: `live2d`, `three`, `mmd`, `spine`, or `tachie`) and the key that older releases used.
- `modelScopedStorageKey` in the same file builds the stored key: `settings/models/<model id>/` followed by the old key without its `settings/` prefix. `settings/live2d/scale` of model `m1` is stored at `settings/models/m1/live2d/scale`.
- `useSettingsStageModel` calls `setActiveDisplayModelForSettings` before a renderer receives a model. While a scope has no active model, its settings read and write the old unscoped key.
- The first model that becomes active takes the value stored at the unscoped key, and that key is removed. Each later model starts from the default, which is written at once. The `// NOTICE:` block in the helper states when this move can be removed.
- `removeDisplayModelSettings` removes every key of one model. `useDisplayModelsStore` calls it when a model is deleted and for every imported model in `resetDisplayModels`.
- A `reset()` or `resetState()` of a per-model ref resets the value of the active model only.

Settings of the device stay global: the frame-rate limits, render scales, and multisampling of each renderer, the two Live2D auto-blink keys, and the fork's MMD stance slots, clip curation, stage character height, and roam mode.

### Tier 1: synced settings documents

| Store | Key | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useSituationSettings` (`packages/stage-ui/src/features/situation/settings.ts`) | `settings/situation` | 1 | leader | yes |
| `useExpressionPerformanceSettings` (`packages/stage-ui/src/features/performance/settings.ts`) | `settings/expression-performance` | 1 | leader | yes |
| `useHostNoticeSettings` (`packages/stage-ui/src/features/host-capabilities/notice-settings.ts`) | `settings/host-notice` | 1 | leader | yes |
| `useConversationSettings` (`packages/stage-ui/src/features/conversation/settings.ts`) | `settings/conversation` | 1 | leader | no |
| `useLive2DNaturalSettings` (`packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts`) | `settings/live2d/natural` | 1 | leader | yes |
| `useMMDNaturalSettings` (`packages/stage-ui-mmd/src/stores/natural-settings.ts`) | `settings/mmd/natural` | 1 | leader | yes |

### Tiers 2 and 3: leader and stage documents

| Store | Key | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useSituationInnerState` (`packages/stage-ui/src/features/situation/inner-state.ts`), owned by `useSituationStore` | `settings/situation-inner` | 2 | leader | yes, through `forget({ scope: 'everything' })` |
| `useExpressionStore` (`packages/stage-ui-live2d/src/stores/expression-store.ts`) with `createCatalogPersistence` (`packages/stage-ui-live2d/src/stores/expression-catalog-persistence.ts`) | `expression-catalog:<id>`, `expression-rest:<id>` | 3 | stage window | yes, by prefix |
| `useMMDExpressionStore` (`packages/stage-ui-mmd/src/stores/expression-store.ts`) | `expression-catalog:<id>`, `expression-rest:<id>` | 3 | stage window | yes, by prefix |

### Tier 4: IndexedDB

| Store | Database | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useChatSessionStore` (`packages/stage-ui/src/stores/chat/session-store.ts`) through `chatSessionsRepo` (`packages/stage-ui/src/database/repos/chat-sessions.repo.ts`) | unstorage mount `local`, IndexedDB `airi-local` (`storage` in `packages/stage-ui/src/database/storage.ts`) | 4 | leader | yes |
| `chatAssetsRepo` (`packages/stage-ui/src/database/repos/chat-assets.repo.ts`), written by `storeChatAsset` (`packages/stage-ui/src/libs/chat-assets.ts`) | mount `chat-assets`, IndexedDB `airi-chat-assets` / `assets` | 4 | the window saving a chat session | yes, released with each deleted session |
| `useMemoryStore` (`packages/stage-ui/src/stores/memory.ts`) through `memoryRepo` (`packages/stage-ui/src/database/repos/memory.repo.ts`) | mount `memory`, IndexedDB `airi-memory` / `entries`, one record per entry id; key `memory/enabled` | 4 (named exception); plain for `memory/enabled` | any window | yes |
| `useRecipesStore` (`packages/stage-ui/src/stores/recipes.ts`) through `recipesRepo` (`packages/stage-ui/src/database/repos/recipes.repo.ts`) | mount `recipes`, IndexedDB `airi-recipes` / `recipes`, one record per recipe id; key `recipes/proposals-enabled` | 4 (named exception); plain for `recipes/proposals-enabled` | any window | yes |
| `useCharacterStateStore` (`packages/stage-ui/src/stores/character-state.ts`) through `characterStateRepo` (`packages/stage-ui/src/database/repos/character-state.repo.ts`) | mount `character-state`, IndexedDB `airi-character-state` / `cards` | 4 | leader | yes |
| `useDisplayModelsStore` (`packages/stage-ui/src/stores/display-models.ts`) through `displayModelsRepo` (`packages/stage-ui/src/database/repos/display-models.repo.ts`) | mount `device`, IndexedDB `localforage` / `keyvaluepairs`, one item per model id | 4 | any window | yes |
| `useBackgroundStore` (`packages/stage-ui/src/stores/background.ts`) | mount `device`, items prefixed `bg-` | 4 | any window | no |
| `useStickersStore` (`packages/stage-ui/src/stores/modules/stickers.ts`) through `stickersRepo` (`packages/stage-ui/src/database/repos/stickers.repo.ts`) | mount `stickers`, IndexedDB `airi-sticker-library` / `records`, with the prefixes `entries` and `images`; keys `settings/stickers/*` | 4; plain for the settings keys | any window | no |
| `toolCardDataRepo` (`packages/stage-ui/src/database/repos/tool-card-data.repo.ts`), written by the tool-card store below | mount `local`, keys `tool-cards/latest/<tool>/<card version>` | 4 | leader | no |
| `useCharacterStore` (`packages/stage-ui/src/stores/characters.ts`) through `createCharactersModel` (`packages/stage-ui/src/models/characters.ts`) | mount `local`, key `characters` | 4 | any window | no |

Every repository reads and writes through a mount of `storage` (`packages/stage-ui/src/database/storage.ts`), an unstorage instance on IndexedDB. The `device`, `chat-assets`, `memory`, `recipes`, and `character-state` mounts open the databases and stores that localforage created, so records written before the move still read.

### Synced stores with plain refs

| Store | Keys | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useOnboardingStore` (`packages/stage-ui/src/stores/onboarding.ts`) | `onboarding/steps`, written by a synced action | plain | leader | yes |
| `useConsciousnessSettingsStore` (`packages/stage-ui/src/stores/modules/consciousness-settings.ts`) | `settings/consciousness/<setting>` | plain | leader | yes |
| `useProviderConfigStore` (`packages/stage-ui/src/stores/providers/config.ts`), reset through `useProviderStore` (`packages/stage-ui/src/stores/providers/provider.ts`) | `settings/providers/configured`, `settings/providers/added`, `settings/credentials/providers` | plain | any window (replicated) | yes |
| `useAiriCardStore` (`packages/stage-ui/src/stores/modules/airi-card.ts`) | `airi-cards`; `airi-card-active-id`, written by its synced actions | plain | any window (replicated) for `airi-cards`; leader for the active id | yes |
| The tool-card state store behind `useToolCardsStore` (`packages/stage-ui/src/stores/tool-cards.ts`) | `tool-cards/cards`, written by its synced actions | plain | leader | no |
| `useConsciousnessStore` (`packages/stage-ui/src/stores/modules/consciousness.ts`) | `settings/consciousness/active-*`, temperature, top-p | plain | any window (replicated) | yes |
| `useHearingStore` (`packages/stage-ui/src/stores/modules/hearing.ts`) | `settings/hearing/*` | plain | any window (replicated) | yes |
| `useSpeechStore` (`packages/stage-ui/src/stores/modules/speech.ts`) | `settings/speech/*` except `output-muted` | plain | any window (replicated) | yes |
| `useVisionStore` (`packages/stage-ui/src/stores/modules/vision/store.ts`) | `settings/vision/*` except `capture-interval-ms` | plain | any window (replicated) | no |
| `useArtistryStore` (`packages/stage-ui/src/stores/modules/artistry.ts`) | `artistry-*` | plain | any window (replicated) | no |

### Unsynced stores with plain refs

| Store | Keys | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useSettingsGeneral` (`packages/stage-ui/src/stores/settings/general.ts`) | `settings/language`, `settings/streamer-mode`, `settings/disable-transitions`, `settings/use-page-specific-transitions`, `settings/websocket/secure-enabled` | plain | any window | yes, through `useSettings` |
| `useSettingsAnalytics` (`packages/stage-ui/src/stores/settings/analytics.ts`) | `settings/analytics/opted-in` | plain | any window | yes, through `useSettings` |
| `useSettingsControlsIsland` (`packages/stage-ui/src/stores/settings/controls-island.ts`) | `settings/allow-visible-on-all-workspaces`, `settings/always-on-top`, `settings/controls-island/icon-size` | plain | any window | yes, through `useSettings` |
| `useSettingsDeveloper` (`packages/stage-ui/src/stores/settings/developer.ts`) | `settings/developer/inspect-updater-diagnostics`, `settings/developer/show-tool-payloads-as-json` | plain | any window | yes, through `useSettings` |
| `useSettingsTheme` (`packages/stage-ui/src/stores/settings/theme.ts`) | `settings/theme/colors/*` | plain | any window | yes, through `useSettings` |
| `useTheme` (`packages/ui/src/composables/use-theme.ts`) | `vueuse-color-scheme` | plain | any window | no |
| `useSettingsSpine` (`packages/stage-ui/src/stores/settings/spine.ts`) | per model: `settings/spine/premultiplied-alpha`, `default-mix`, `idle-enabled`; global: `settings/spine/max-fps`, `render-scale` | plain | any window | yes, through `useSettings` |
| `useTachie` (`packages/stage-ui-tachie/src/stores/tachie.ts`) | per model: `settings/tachie/position`, `scale`, `shadow-enabled`; global: `settings/tachie/render-scale` | plain | any window | yes, through `useSettings` |
| `useSettingsAudioDevice` (`packages/stage-ui/src/stores/settings/audio-device.ts`) | `settings/audio/input*` | plain | any window | yes |
| `useSettingsBeatSync` (`packages/stage-ui/src/stores/settings/beat-sync.ts`) | `settings/beat-sync/parameters`, `settings/beat-sync/spectrum-scale` | plain | any window | no |
| `useSettingsScreenAmbientLight` (`packages/stage-shared/src/stores/screen-ambient-light.ts`) | `settings/screen-ambient-light/*` | plain | any window | yes |
| `useSettingsLive2d` (`packages/stage-ui-live2d/src/composables/live2d/live2d.ts`) | per model: `settings/live2d/*` driver, tracking, eye-offset, idle, expression, and shadow keys; global: `settings/live2d/auto-blink-enabled`, `force-auto-blink-enabled`, `max-fps`, `render-scale` | plain | any window | yes |
| `useLive2dParams` (`packages/stage-ui-live2d/src/stores/model-parameters.ts`) | per model: `settings/live2d/current-motion`, `available-motions`, `motion-map`, `parameters` | plain | any window | yes |
| `useL2dViewControl` (`packages/stage-ui-live2d/src/stores/view-control.ts`) | per model: `settings/live2d/scale`, `settings/live2d/position` | plain | any window | yes, through `useLive2dParams` |
| `useLive2DMotionMagicSettings` (`packages/stage-ui/src/features/motions/live2d/settings.ts`) | per model: `settings/live2d/magic/*` | plain | any window | yes |
| `useMMD` (`packages/stage-ui-mmd/src/stores/mmd.ts`) | per model: `settings/mmd/*` physics, gaze, motion-driver, camera, light, idle-motion, motion, clip-metadata, emotion, morph, and material keys; global: `settings/mmd/render-scale`, `stage-character-height`, `roam-mode`, `stance-slots`, `clip-curation`; imported motions as items in IndexedDB `localforage` / `keyvaluepairs`, through the store's own unstorage instance | plain; 4 for motions | any window | yes |
| `useMMDViewControl` (`packages/stage-ui-mmd/src/stores/view-control.ts`) | per model: `settings/mmd/scale`, `settings/mmd/rotationY`, `settings/mmd/position` | plain | any window | yes, through `useMMD` |
| `useModelStore` (`packages/stage-ui-three/src/stores/model-store.ts`) | per model: `settings/stage-ui-three/*` model, tracking, lighting, and environment keys; global: `settings/stage-ui-three/max-fps`, `last-committed-model-id`, `renderScale`, `multisampling` | plain | any window | partly |
| `useThreeCamera` (`packages/stage-ui-three/src/stores/camera.ts`) | per model: `settings/stage-ui-three/cameraFOV`, `cameraDistance`, `camera-position` | plain | any window | partly, position only |
| `useThreeViewControl` (`packages/stage-ui-three/src/stores/view-control.ts`) | per model: `settings/stage-ui-three/modelOffset` | plain | any window | yes, through `useModelStore` |
| `useSpine` (`packages/stage-ui-spine/src/stores/spine.ts`) | per model: `settings/spine/*` animation, skin, variant, and speed keys | plain | any window | no |
| `useSpineViewControl` (`packages/stage-ui-spine/src/stores/view-control.ts`) | per model: `settings/spine/scale`, `settings/spine/position` | plain | any window | no |
| `useHomeAssistantStore` (`packages/stage-ui/src/stores/modules/home-assistant.ts`) | `settings/home-assistant/*` | plain | any window | yes |
| `useWebSearchStore` (`packages/stage-ui/src/stores/modules/web-search.ts`) | `settings/web-search/*` | plain | any window | yes |
| `useDiscordStore` (`packages/stage-ui/src/stores/modules/discord.ts`) | `settings/discord/*` | plain | any window | yes |
| `createGamingModuleStore` (`packages/stage-ui/src/stores/modules/gaming-module-factory.ts`), used by `useMinecraftStore` and `useFactorioStore` | `settings/<module>/*` | plain | any window | yes |
| `useMcpStore` (`packages/stage-ui/src/stores/mcp.ts`) | `settings/mcp/*`, `mcp/connected` | plain | any window | yes |
| `useVisionProcessingStore` (`packages/stage-ui/src/stores/modules/vision/processing-store.ts`) | `settings/vision/capture-interval-ms` | plain | any window | no |
| `useModsServerChannelStore` (`packages/stage-ui/src/stores/mods/api/channel-server.ts`) | `settings/connection/websocket-url`, `settings/connection/websocket-auth-token` | plain | any window | no |
| `useSpeechOutputControlStore` (`packages/stage-ui/src/stores/speech-output-control.ts`) | `settings/speech/output-muted`, `settings/speech/output-volume`, `settings/speech/output-volume-last-audible` | plain | any window | no |
| `useWakeWordsStore` (`packages/stage-ui/src/stores/wake-words.ts`) | `settings/voice/pronunciation-owners` | plain | any window | no |
| `useVoiceprintStore` (`packages/stage-ui/src/stores/voiceprint.ts`) | `settings/voice/voiceprints`, `settings/voice/voiceprint-deleted-at` | plain | any window | yes, through `removeAll`, which also stamps the deletion time |
| `useToolCardsStore` (`packages/stage-ui/src/stores/tool-cards.ts`) | `settings/tool-cards/enabled`, `settings/tool-cards/reply-cards` | plain | any window | no |
| `useFeatureFlagsStore` (`packages/stage-ui/src/stores/feature-flags.ts`) | `settings/feature-flags`, `settings/feature-flag-variants` | plain | any window | no |
| `useBackgroundStore` (`packages/stage-layouts/src/stores/background.ts`) | mount `device`, items prefixed `background-`; `settings/theme/background/*` | plain; 4 for images | any window | no |

### Desktop app stores and components

| Store or component | Keys | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useDanmakuFeedSettings` (`packages/stage-ui/src/composables/use-danmaku-feed-settings.ts`) | `chat-window/danmaku/*` | plain | any window | no |
| `apps/stage-tamagotchi/src/renderer/pages/chat-floating.vue` | `chat-window/danmaku/composer-folded` | plain | any window | no |
| `useControlsIslandStore` (`apps/stage-tamagotchi/src/renderer/stores/controls-island.ts`) | `controls-island/fade-on-hover-enabled`, `preferences/dont-show-it-again/notice/fade-on-hover` | plain | any window | no |
| `useServerChannelSettingsStore` (`apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts`) | `settings/server-channel/*` | plain | any window | no |
| `usePushToTalkShortcutSettings` (`apps/stage-tamagotchi/src/renderer/composables/use-push-to-talk-shortcut.ts`) | `settings/hearing/push-to-talk-shortcut`, `settings/hearing/push-to-talk-shortcut-error` | plain | any window | no |
| `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue`, `packages/stage-layouts/src/components/Widgets/ChatArea.vue`, `packages/stage-layouts/src/components/Widgets/ChatActionButtons.vue` | `ui/chat/settings/send-mode` | plain | any window | no |
| `packages/stage-ui/src/components/scenarios/chat/components/voice-input-button.vue` | `ui/chat/voice-mode` | plain | any window | no |
| `packages/stage-ui/src/components/scenarios/chat/components/composer-voice-input.vue` | `ui/chat/composer-voice-mode` | plain | any window | no |
| `packages/stage-ui/src/components/scenarios/settings/model-settings/use-live2d-model-settings.ts` | `selected-runtime-motion`, `selected-runtime-motion-group`, `selected-runtime-motion-index` | plain | any window | no |
| `useSettingsNeedsAttention` (`packages/stage-ui/src/composables/use-settings-needs-attention.ts`) | `settings/needs-attention/dismissed` | plain | any window | no |
| `useFullscreenLayout` (`apps/stage-tamagotchi/src/renderer/composables/use-fullscreen-layout.ts`) | `fullscreen/surface-width` | plain | any window | no |
| `packages/ui-trace/src/components/timeline/trace-timeline.vue` | `ui/devtools/io-tracer/label-width` | plain | any window | no |

### Uses of the search terms that persist nothing

The inventory search was `git grep -nE 'LocalStorageManualReset|useLocalStorage[<(]|useModelScopedLocalStorage|useSettingsDocument|localforage|createStorage|prefixStorage|localStorage\.setItem|storage\.setItem' -- 'packages/*/src/*' 'apps/stage-tamagotchi/src' ':!*.test.ts'`. The pathspec needs the trailing `/*`, because git matches a wildcard pathspec against the whole path. The search before the upstream sync had no term for the per-model helpers, the typed `useLocalStorage<T>` form, or direct writes, so it missed stores that persist only through them. The following hits are not members:

- `useLocalStorageManualReset` (`packages/stage-shared/src/composables/use-local-storage-manual-reset/index.ts`), `useVersionedLocalStorageManualReset` (`packages/stage-shared/src/composables/use-versioned-local-storage-manual-reset/index.ts`), `useModelScopedLocalStorage` (`packages/stage-shared/src/composables/use-model-scoped-local-storage/index.ts`), and `useSettingsDocument` (`packages/stage-shared/src/composables/use-settings-document/index.ts`) define the helpers.
- `storage` (`packages/stage-ui/src/database/storage.ts`) creates the unstorage instance and its mounts. Its `outbox` mount is listed under [Known gaps](#known-gaps).
- `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` holds commented-out localforage code.
- `packages/scenarios-stage-tamagotchi-electron/src/scenarios/display-model-from-file.ts` seeds the `localforage` database and the old onboarding keys of a test profile in a QA scenario, and the qa-tools runners under `packages/qa-tools/src` seed localStorage keys of a test profile.

Writers that only move or remove old keys sit outside the stores. `migrateGoCredentials` (`apps/stage-tamagotchi/src/renderer/bridges/opencode-go-migration.ts`) rewrites provider keys once. `removeRetiredAccountCredentials` (`packages/stage-ui/src/libs/retired-account.ts`) removes the `auth/v1/*` keys of the retired account service. `useModelStore().resetModelStore` deletes a legacy model-source key. Five stores move data that an older release stored elsewhere, each under a `// NOTICE:` block with its removal condition: `useOnboardingStore` replaces `onboarding/completed` and `onboarding/skipped` with step records, `useAiriCardStore` moves `airi-card-module-defaults` into the module stores and `settings/stage/model` into the active card, `useMemoryStore` moves `memory/entries` and `useRecipesStore` moves `recipes/custom` from localStorage to IndexedDB, and `useVoiceprintStore` moves `settings/voice/voiceprint` into the list at `settings/voice/voiceprints`.

Two clients keep an id in `sessionStorage`, which ends with the session: the OpenPanel client (`packages/stage-ui/src/libs/product-signals/openpanel.ts`) keeps a device id, and the IO trace bridge (`apps/stage-tamagotchi/src/renderer/bridges/io-trace-hub.ts`) keeps a source id.

A chat session record stores no system message: each request composes it. A session record names one character, and `characterMembersOfMeta` (`packages/stage-ui/src/stores/chat/session-members.ts`) derives the session's character members from it.

### Main-process files

The desktop app's main process writes files under the Electron user data directory, outside the renderer stores and outside `useDataMaintenance`. The Data settings page (`apps/stage-tamagotchi/src/renderer/pages/settings/data/index.vue`) passes `deleteHostData` to the shared danger section, which runs it after `deleteAllData`. It clears the Home Assistant address and token through `homeAssistantSetConfig` and invokes `storedDataDeleteActivity`, whose handler `setupStoredData` (`apps/stage-tamagotchi/src/main/services/airi/stored-data/index.ts`) removes earlier session logs, empties the open one, removes the IO traces, and clears the computer-use store through its owner.

- Session logs older than `LOG_RETENTION_MS` (14 days) are removed at every start (`pruneExpiredLogs` in `apps/stage-tamagotchi/src/main/app/file-logger.ts`).
- Perf records keep their own 14-day retention and are not deleted with all data.
- Main-process settings files stay: window state, the image-generation options, `mcp.json`, the OpenCode Go key, which its own settings page clears, and the app options file of `createGlobalAppConfig` (`apps/stage-tamagotchi/src/main/configs/global.ts`), which holds the update channel and `errorReportingEnabled`. The renderer mirrors its analytics opt-in into `errorReportingEnabled` through `electronErrorReportingSet`, and an absent value means off.
- `deleteAllData` also calls `clearSherpawModelAssets` (`packages/stage-ui/src/libs/providers/providers/sherpaw/model-assets.ts`) for the downloaded Sherpaw model assets.

## Settings documents

Six tier 1 stores and one helper exist:

- `useLive2DNaturalSettings` and `useMMDNaturalSettings` are built on `useSettingsDocument`. Each starts from the old per-setting [Natural](glossary.md#natural) keys while no document is stored, and its first leader-routed `update` or `reset` writes the document and deletes those keys. Each store's `// NOTICE:` block states when that import can be removed.
- `useSituationSettings`, `useConversationSettings`, and `useHostNoticeSettings` are built on `useSettingsDocument` with their original keys and stored shapes. `useHostNoticeSettings` declares the leader-routed actions `dismiss` and `reset`.
- `useExpressionPerformanceSettings` is built on `useSettingsDocument` with its original key and stored shape. Its `update` merges a patch at every depth, with arrays replaced, before the helper validates it. Its `upgrade` option strips removed stored fields under `// NOTICE:` blocks that state their removal conditions.

All six stores are built on `useSettingsDocument`, and new tier 1 stores use it too. `upgrade` rewrites a stored document before its fields are validated; use it only for a `// NOTICE:` fallback that removes or renames stored fields.

## Named exceptions

- **[Long-term memory](glossary.md#long-term-memory).** `useMemoryStore` is tier 4 data that any window may write, without leader routing. `memoryRepo` serializes writes with the `airi:memory` Web Lock, and a write invalidates the other windows over the `airi:memory` BroadcastChannel. This is safe while only the leader runs chat turns, which are the only writers besides Settings. A chat turn's write never stores a window or page title that the situation holds, unless the user stated it in the same turn, and never a credential shape (`memoryWriteRefusal` in `packages/stage-ui/src/tools/memory.ts`).
- **The [gate](glossary.md#gate)'s inner state.** `settings/situation-inner` is the only tier 2 member. It holds the urge-gate memory and the conversation threads that the [situation](glossary.md#situation) extracts. The leader writes the urge-gate memory from what the [character mind](glossary.md#character-mind) publishes (`publishVoice`), without the mind's random state. Both are personal and grow with every save, so the slice never replicates. A thread whose text repeats a window or page title that the situation holds is dropped before it is stored (`createThreadExtractor` in `packages/stage-ui/src/features/situation/thread-extraction.ts`). `useSituationStore().forget` clears it in the leader. The slice holds no pacing of spoken [touch reactions](glossary.md#touch-reaction): `SavedInnerState` has no `reaction` field. That pacing is state of the [character mind](glossary.md#character-mind) (`voice` in `MindState`, `packages/character-mind/src/types.ts`), which is not saved and starts over at each launch.
- **[Recipes](glossary.md#recipe).** `useRecipesStore` follows the long-term memory pattern: tier 4 data that any window may write, with the `airi:recipes` Web Lock in `recipesRepo` and the `airi:recipes` BroadcastChannel. A model proposal is stored unapproved and disabled until the owner approves it.
- **Voiceprints.** `useVoiceprintStore` keeps voiceprints in plain localStorage, because upstream ships it so. A voiceprint identifies a person, so `deleteAllData` removes them first, before any step that can fail.
- **Expression documents.** The Live2D and MMD expression stores write `expression-catalog:<id>` and `expression-rest:<id>` from the stage window, outside any store registration. `useDataMaintenance` clears them by prefix, including documents of models that are not loaded.
- **Chat assets.** `chatAssetsRepo` has no reset of its own. `chatSessionsRepo` releases a session's assets when it deletes the session, so deleting all chat sessions removes them.

## Target

This section states the design that refactors move toward. It does not describe the code. The [character mind ADR](../adr/2026-11-17-character-mind-direction.md) records the decision. When a refactor lands a rule, the rule moves into the sections above and the gaps it closes leave the list below.

1. **One registration point.** Every piece of persisted client state is declared in one place with its tier, its keys or key prefix, and its reset. "Delete all data" resets exactly the registered set.
2. **A test enforces it.** A focused test fails when the client writes storage under a key that no registration owns.
3. **Every store fits a tier.** Plain localStorage refs and synced stores that persist replicated plain refs migrate to a tier where the fork owns them. Upstream's stores keep upstream's keys and are registered as they are. The closed tiers stay closed.
4. **Behavior settings form one document.** The character-behavior settings that the [character mind](glossary.md#character-mind) reads are one tier 1 document. Renderer settings documents hold only realisation settings.
5. **The mind's slow state is the per-card character state.** The per-card record in tier 4 holds mood, energy, learned temperament, relationship, and her own pacing memory (urge memory, last-spoke times, own-day weight). The floor after any spoken line and the hourly cap are per user across characters and stay in the user's gate state. Only the leader reads and writes the record, and the mind applies decay for the time away on load. Sharing a card carries its profile only; a separate backup carries the whole record. Fast state is not persisted.
6. **One owner per key.** No two stores own the same storage key.

| Known gap | Closed by |
| --- | --- |
| Persisting stores that `useDataMaintenance` does not reset | Rules 1 and 2 |
| Partial reset of `useModelStore` | Rule 1 |
| Synced stores that persist plain refs as replicated state | Rule 3 |
| The stage-layouts `useBackgroundStore` sharing the default localforage database | Rule 1, or deletion if the desktop app keeps not rendering it |
| The unstorage `outbox` mount with no reader or writer | Rule 1, or deletion |
| The gate's inner state as the only tier 2 member | Rule 5 moves her own pacing memory into the per-card record, while the floor and hourly-cap state stays here, per user; the extracted conversation threads stay leader-only personal content, and a thread that repeats a held title is dropped before it is stored |

## Known gaps

These are observations, not fixes. Each needs either a registration, a move to the right tier, or an amendment to this document.

**Persisting stores that `useDataMaintenance` does not reset:**

- Tier 1: `useConversationSettings`. It is also missing from the tier 1 member list in the persistence-tiers ADR.
- Tier 4: `useBackgroundStore` in stage-ui, `useStickersStore`, `toolCardDataRepo`, and `useCharacterStore`, including their IndexedDB records.
- Synced plain refs: `useVisionStore`, `useArtistryStore`, and the saved tool cards at `tool-cards/cards`.
- Unsynced plain refs: `useSettingsBeatSync`, `useSpine`, `useSpineViewControl`, `useVisionProcessingStore`, `useModsServerChannelStore`, `useSpeechOutputControlStore`, `useWakeWordsStore`, `useToolCardsStore`, and `useFeatureFlagsStore`.
- Desktop app: `useDanmakuFeedSettings`, `useControlsIslandStore`, `useServerChannelSettingsStore`, `usePushToTalkShortcutSettings`, `useSettingsNeedsAttention`, `useFullscreenLayout`, and the component-level keys `chat-window/danmaku/composer-folded`, `ui/chat/settings/send-mode`, `ui/chat/voice-mode`, `ui/chat/composer-voice-mode`, `ui/devtools/io-tracer/label-width`, and `selected-runtime-motion*`.
- Partial resets: `useModelStore().resetModelStore` resets the model, camera position, view offset, and tracking keys, but leaves the lighting, environment, render-scale, multisampling, and FPS keys and the `useThreeCamera` field of view and distance.
- Per-model settings: a store reset reaches the value of the active model only, and `resetDisplayModels` removes the settings of imported models only. The settings of a built-in model that is not active survive "Delete all data".
- The sticker library's earlier database, `airi-stickers`, is copied into the `stickers` mount and kept for rollback. Nothing deletes it, so "Delete all data" leaves the copy.

**Stores outside the tiers:**

- Synced stores that persist plain refs as replicated state (`useAiriCardStore`, `useConsciousnessStore`, `useHearingStore`, `useSpeechStore`, `useProviderConfigStore`, `useVisionStore`, and `useArtistryStore`) write storage from every window that receives a committed snapshot. Tier 1 forbids this for settings documents. These stores predate the tiers and are upstream code.
- The stage-layouts `useBackgroundStore` (`packages/stage-layouts/src/stores/background.ts`) shares the `device` mount with `useDisplayModelsStore` and the stage-ui `useBackgroundStore`, and `useMMD` opens the same database through its own unstorage instance. The records are separated only by key prefix. The desktop app does not render the stage-layouts background components that use it.
- The unstorage `outbox` mount (IndexedDB `airi-sync-queue`) in `storage` has no reader or writer in the client.
- `useSettingsAnalytics` moved from `settings/analytics/enabled` to `settings/analytics/opted-in`. The old key stays in storage with no owner, so "Delete all data" does not remove it.
- The analytics opt-in has two stored copies: `settings/analytics/opted-in` in the renderer and `errorReportingEnabled` in the main process's app options file. "Delete all data" resets the first, and the second follows only through the renderer's mirror.
- Onboarding step records, the active card id, the consciousness request settings, and the saved tool cards are written with direct `localStorage` calls from synced actions. The leader is the only writer, but none of them is a tier 1 document or carries the tier 2 leadership token.
- Per-model display settings are plain refs keyed by model id that any window writes, so they are not tier 3.

**Data that leaves the device:**

- Fork source still names upstream's analytics services: `OPENPANEL_CONFIG` (`packages/stage-shared/src/analytics/openpanel.ts`) and `DEFAULT_POSTHOG_CONFIG` with `POSTHOG_PROJECT_KEY` (`packages/stage-shared/src/analytics/posthog.ts`). Capture needs a build with `VITE_ENABLE_ANALYTICS` set and the opt-in, which defaults to off; such a fork build would send product events to upstream's projects. Error reports are already off unless the build sets its own DSN (`errorReportSourceFromEnv`).

## References

- [Persistence tiers ADR](../adr/2026-11-01-persistence-tiers.md)
- [Layered character state ADR](../adr/2026-11-03-layered-character-state.md)
- [Long-term memory adoption ADR](../adr/2026-10-30-long-term-memory-adoption.md)
- [Unprompted reach-out cadence ADR](../adr/2026-10-29-unprompted-reach-out-cadence.md), which records the inner-state exception
- `packages/stage-ui/src/composables/use-data-maintenance.ts` `useDataMaintenance`
- `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument`
