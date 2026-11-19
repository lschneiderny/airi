# state-registry - Work Plan

Status: not started. The plan was written on 2026-11-19. Roadmap row: step S in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: decision 13 of the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) and the [persistence tiers ADR](../../docs/ai/adr/2026-11-01-persistence-tiers.md). Policy: [`docs/ai/context/state-persistence.md`](../../docs/ai/context/state-persistence.md). Branch: `luke/refactor/state-registry`, cut from `origin/main` at `e36bfc903`, which contains upstream `moeru-ai/airi` through `b3a6d6071`. One PR against `lschneiderny/airi` with base `main` (D1). S must land before CM4, which keeps the mind's slow state in a registered location. S is independent of the stacked character mind PRs (#47, #51, #52, #53); section 3.9 says how they meet.

The owner is away and runs these steps without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#10-decisions-open-to-the-owners-veto).

## TL;DR (For humans)

**What changes:** One state registry in `packages/stage-ui` declares every piece of renderer storage: each registration names its owner, the files that write it, its tier, its locations (localStorage keys, key prefixes, per-model keys, sessionStorage keys, IndexedDB stores, OPFS directories, Cache Storage caches), and an optional owner reset. "Delete all data" runs the owner reset of every registration and then removes every registered location. A focused test in two halves fails when the client writes storage that no registration owns: a browser test watches every write while the stores are created and reset, and a static scan of the renderer source checks every storage call site. The four settings documents that still hand-roll their persistence move onto `useSettingsDocument` with the same keys and shapes.

**Why:** The member list of persisted state lives only in a hand-kept doc table, and nothing checks it. "Delete all data" resets a fixed list of stores and misses more than thirty owners, among them three stored credentials (the Artistry API keys, the mods server channel token, and the desktop server channel token), uploaded background and sticker images, saved tool-card results, and the copies of imported models in the origin private file system. Two keys have two writers each (`settings/language` and `vueuse-color-scheme`).

**What does not change:** No storage key, value shape, IndexedDB database, object store, unstorage mount, or tier changes, so existing profiles keep every setting. No store moves to another tier (Target rule 3), no behavior settings merge (rule 4, CM7), and nothing moves into the per-card record (rule 5, CM4). The main process keeps its own deletion through `storedDataDeleteActivity`, and perf records stay a named exception.

**Effort:** L. **Risk:** Medium. "Delete all data" now reaches every owner; a reset that misbehaves would lose data that the user asked to delete anyway, but an owner reset that throws must not stop the rest.

## 1. Upstream first

Read from the tree at `e36bfc903`. Upstream is `b3a6d6071`.

| Upstream has | Code | Who uses it | Fork difference |
| --- | --- | --- | --- |
| Plain localStorage refs with a reset | `packages/stage-shared/src/composables/use-local-storage-manual-reset/index.ts` `useLocalStorageManualReset`; `use-versioned-local-storage/index.ts` and `use-versioned-local-storage-manual-reset/index.ts` | Almost every settings store | The fork uses the same helpers; tier 1 documents pass `listenToStorageChanges: false` and `writeDefaults: false` |
| Per-model display settings | `packages/stage-shared/src/composables/use-model-scoped-local-storage/index.ts` `useModelScopedLocalStorage`, `modelScopedStorageKey`, `removeDisplayModelSettings` (#3544) | Five renderers' settings stores | The fork also scopes the MMD motion driver and clip metadata (ledger row "Per-model settings", Revisit "Roadmap step S") |
| One unstorage instance on IndexedDB with mounts `local`, `outbox`, `device`, `chat-assets`, `memory`, `recipes`, `stickers` | `packages/stage-ui/src/database/storage.ts` `storage` | The repositories under `packages/stage-ui/src/database/repos` | The fork adds the `character-state` mount (ledger row "Fork-only repositories") |
| "Delete all data" and the partial resets | `packages/stage-ui/src/composables/use-data-maintenance.ts` `useDataMaintenance` (`deleteAllData`, `resetProvidersSettings`, `resetModulesSettings`, `deleteAllChatSessions`, `deleteAllModels`, `resetDesktopApplicationState`) | The Data settings page (`packages/stage-pages/src/pages/settings/data/components/danger-section.vue`, the app's `desktop-reset-section.vue`) | The fork adds the character state, memory, recipes, the situation, the expression documents, and its tier 1 documents to the hand-written list |
| Synced Pinia stores | `packages/stage-ui/src/libs/pinia/setup-synced.ts` `setupSynced`, `pinia-plugin-synced` | Every synced store | The plugin replicates and routes actions; it persists nothing |
| Nothing for one settings document, a registry of storage keys, or a test of storage keys | | | Fork-only: `useSettingsDocument` (`packages/stage-shared/src/composables/use-settings-document/index.ts`), the key constants in `packages/stage-ui/src/constants/settings-storage.ts` |

For this step:

- **Adopts unchanged:** every upstream store and repository with its keys, the storage helpers, the unstorage mounts including the unused `outbox` (D14), and the Kept files `packages/stage-ui/src/stores/modules/artistry.ts`, `packages/stage-ui/src/stores/modules/home-assistant.ts`, and `packages/ui-trace/src/components/timeline/trace-timeline.vue`, which the registry registers from outside.
- **Builds beside upstream:** the registry (`packages/stage-ui/src/persistence/state-registry.ts`), its browser test, and the static scan in `scripts/dev-tools`.
- **Changes these upstream files:**

| Upstream file | Why | Item |
| --- | --- | --- |
| `apps/stage-tamagotchi/src/renderer/composables/use-language.ts` | It opens a second storage ref on `settings/language` only to read it, and that ref writes the default; it reads the key with `localStorage.getItem` instead (rule 6) | A3 |
| `apps/stage-tamagotchi/src/renderer/pages/notice/fade-on-hover.vue` | Its `useDark` is a second writer of `vueuse-color-scheme`, which `useTheme` owns; it reads `useTheme().isDark` instead (rule 6) | A3 |
| `packages/ui-loading-screens/src/components/LoadingSciFiCircle/index.vue` | The same second writer, in a component the app does not render today | A3 |
| `packages/stage-ui/src/composables/use-data-maintenance.ts` | `deleteAllData` and the partial resets run registrations; the store list moves into the registry | A5 |
| `packages/stage-ui/src/composables/use-data-maintenance.browser.test.ts` | Cases for the closed gaps; the existing assertions stay | A5 |
| `packages/stage-pages/src/pages/settings/data/components/danger-section.vue` | The host data step runs after a renderer failure too, then the first failure is reported (D5) | A5 |

## 2. Today's persisted state

**Method.** `git grep` over `packages/*/src` and `apps/stage-tamagotchi/src/renderer`, without tests, for `useLocalStorage`, `useLocalStorageManualReset`, `useVersionedLocalStorage*`, `useModelScopedLocalStorage*`, `useSettingsDocument`, `useStorage`, `useSessionStorage`, `useDark`, `useColorMode`, `localStorage.setItem`, `sessionStorage.setItem`, `setItem` and `setItemRaw` on unstorage instances, `createStorage`, `prefixStorage`, `indexedDbDriver`, `indexedDB`, `navigator.storage.getDirectory`, and `caches.open`, then each hit read in its file. `packages/stage-ui-*` covers Live2D, MMD, Three, Spine, and Tachie. `apps/stage-web` and `apps/stage-pocket` are retired and no longer exist. The web extension (`plugins/airi-plugin-web-extension`) stores its popup state in the extension's own origin, not in the app's, and stays outside the registry.

**Columns.** *Tier* follows `state-persistence.md`; "plain" is the closed plain-ref tier, and "cache" is a copy that the app can download or rebuild (D8). *Delete all data* says whether `deleteAllData` clears it today: "partly" means some keys or some models survive. *Doc* says whether the Members table of `state-persistence.md` lists it: "missing" and "wrong" are the doc's misses. Per-model keys are written with their unscoped key, as the doc does; each is stored at `settings/models/<model id>/...` and, while no model is active, at the unscoped key.

### 2.1 Tier 1, 2, and 3

| Owner and write site | Keys | Tier | Reset today | Delete all data | Doc |
| --- | --- | --- | --- | --- | --- |
| `useSituationSettings` (`packages/stage-ui/src/features/situation/settings.ts`) | `settings/situation` | 1 | `reset()`, leader | yes | listed |
| `useExpressionPerformanceSettings` (`packages/stage-ui/src/features/performance/settings.ts`) | `settings/expression-performance` | 1 | `reset()`, leader | yes | listed |
| `useHostNoticeSettings` (`packages/stage-ui/src/features/host-capabilities/notice-settings.ts`) | `settings/host-notice` | 1 | `reset()`, leader | yes | listed |
| `useConversationSettings` (`packages/stage-ui/src/features/conversation/settings.ts`) | `settings/conversation` | 1 | `reset()`, leader | **no** | listed |
| `useLive2DNaturalSettings` (`packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts`) | `settings/live2d/natural`; legacy `settings/live2d/natural-*` | 1 | `reset()`, which also deletes the legacy keys | yes | listed |
| `useMMDNaturalSettings` (`packages/stage-ui-mmd/src/stores/natural-settings.ts`) | `settings/mmd/natural`; legacy per-setting keys | 1 | `reset()`, as above | yes | listed |
| `useSituationInnerState` through `useSituationStore` (`packages/stage-ui/src/features/situation/inner-state.ts`) | `settings/situation-inner` | 2 | `forget({ scope: 'everything' })` | yes | listed |
| Live2D and MMD expression stores (`packages/stage-ui-live2d/src/stores/expression-store.ts`, `expression-catalog-persistence.ts`, `packages/stage-ui-mmd/src/stores/expression-store.ts`) | prefixes `expression-catalog:`, `expression-rest:` | 3 | `clearExpressionDocuments` | yes | listed |

### 2.2 IndexedDB, OPFS, and Cache Storage

The `local` and `outbox` mounts pass only `base` to the unstorage IndexedDB driver, so both write idb-keyval's default database `keyval-store`, object store `keyval`, under the key prefixes `airi-local:` and `airi-sync-queue:`. unstorage turns `/` in a key into `:`, so `local:chat/index/<user>` is stored as `airi-local:chat:index:<user>`. The doc names an IndexedDB database `airi-local`, which does not exist (**wrong**).

| Owner and write site | Location | Tier | Reset today | Delete all data | Doc |
| --- | --- | --- | --- | --- | --- |
| `chatSessionsRepo` (`packages/stage-ui/src/database/repos/chat-sessions.repo.ts`) | `keyval-store` / `keyval`, prefix `airi-local:chat:` | 4 | `resetAllSessions`, which deletes the sessions in the index only | yes | wrong database |
| `chatAssetsRepo` (`packages/stage-ui/src/database/repos/chat-assets.repo.ts`) | `airi-chat-assets` / `assets` | 4 | released with each deleted session | yes | listed |
| `toolCardDataRepo` (`packages/stage-ui/src/database/repos/tool-card-data.repo.ts`) | `keyval-store` / `keyval`, prefix `airi-local:tool-cards:` | 4 | none | **no** | wrong database |
| `useCharacterStore` (`packages/stage-ui/src/models/characters.ts`) | `keyval-store` / `keyval`, key `airi-local:characters` | 4 | none | **no** | wrong database |
| The `outbox` mount (`packages/stage-ui/src/database/storage.ts`) | `keyval-store` / `keyval`, prefix `airi-sync-queue:` | 4 | none; no reader or writer | no | wrong database |
| `memoryRepo` and `useMemoryStore` (`packages/stage-ui/src/database/repos/memory.repo.ts`, `packages/stage-ui/src/stores/memory.ts`) | `airi-memory` / `entries`; key `memory/enabled`; legacy `memory/entries` | 4, plain | `resetState` | yes | listed |
| `recipesRepo` and `useRecipesStore` | `airi-recipes` / `recipes`; key `recipes/proposals-enabled`; legacy `recipes/custom` | 4, plain | `resetState` | yes | listed |
| `characterStateRepo` (`packages/stage-ui/src/database/repos/character-state.repo.ts`) | `airi-character-state` / `cards` | 4 | `resetState` | yes | listed |
| `displayModelsRepo` (`packages/stage-ui/src/database/repos/display-models.repo.ts`) | `localforage` / `keyvaluepairs`, prefixes `display-model-`, `transfer-task-` | 4 | `resetDisplayModels`, imported models only | yes | listed |
| `useMMD` motions (`packages/stage-ui-mmd/src/stores/mmd.ts`, its own unstorage instance) | `localforage` / `keyvaluepairs`, prefix `mmd-motion-` | 4 | `resetState` | yes | listed |
| `useBackgroundStore` in stage-ui (`packages/stage-ui/src/stores/background.ts`) | `localforage` / `keyvaluepairs`, prefix `bg-`; legacy `image-journal-` | 4 | none | **no** | listed |
| `useBackgroundStore` in stage-layouts (`packages/stage-layouts/src/stores/background.ts`) | `localforage` / `keyvaluepairs`, prefix `background-`; keys `settings/theme/background/gallery-active`, `gallery-options`, `sampled-color` | 4, plain | none | **no** | listed |
| `stickersRepo` and `useStickersStore` (`packages/stage-ui/src/database/repos/stickers.repo.ts`, `packages/stage-ui/src/stores/modules/stickers.ts`) | `airi-sticker-library` / `records`, prefixes `entries:`, `images:`, `migrated-from:`; keys `settings/stickers/enabled`, `frequency`; legacy database `airi-stickers` | 4, plain | `resetState` for the two keys, never called | **no** | listed |
| Live2D and MMD `OPFSCache` (`packages/stage-ui-live2d/src/utils/opfs-loader.ts`, `packages/stage-ui-mmd/src/utils/opfs-loader.ts`) | OPFS root directories named by display model id: copies of imported model files | cache | `OPFSCache.clearAll` from the Live2D model settings button | **no** | **missing** |
| Sherpaw model assets (`packages/stage-ui/src/libs/providers/providers/sherpaw/model-assets.ts`) | the main process through the host in the desktop app; OPFS directory `airi-model-assets` without a host | cache | `clearSherpawModelAssets` | yes | listed |
| Transformers.js in the Kokoro, VAD, and background-removal workers (`packages/stage-ui/src/workers`), read by `packages/stage-ui/src/libs/inference/transformers-cache.ts` | Cache Storage `transformers-cache` | cache | `clearModelCache` from the model cache manager | **no** | **missing** |

### 2.3 Synced stores with plain refs

| Owner and write site | Keys | Reset today | Delete all data | Doc |
| --- | --- | --- | --- | --- |
| `useOnboardingStore` (`packages/stage-ui/src/stores/onboarding.ts`) | `onboarding/steps`; legacy `onboarding/completed`, `onboarding/skipped` | `resetSetupState`, leader | yes | listed |
| `useConsciousnessSettingsStore` (`packages/stage-ui/src/stores/modules/consciousness-settings.ts`) | `settings/consciousness/reasoning`, `temperature-enabled`, `top-p-enabled` | `resetState` | yes | listed |
| `useProviderConfigStore` through `useProviderStore` (`packages/stage-ui/src/stores/providers/config.ts`); also written once by `migrateGoCredentials` (`apps/stage-tamagotchi/src/renderer/bridges/opencode-go-migration.ts`) | `settings/providers/configured`, `settings/providers/added`, `settings/credentials/providers` | `resetProviderSettings` | yes | listed |
| `useAiriCardStore` (`packages/stage-ui/src/stores/modules/airi-card.ts`) | `airi-cards`, `airi-card-active-id`; legacy `airi-card-module-defaults`, `settings/stage/model` | `resetState` | yes | listed |
| The tool-card state store behind `useToolCardsStore` (`packages/stage-ui/src/stores/tool-cards.ts`) | `tool-cards/cards` | none; `deleteCard` per card, leader | **no** | listed |
| `useConsciousnessStore` (`packages/stage-ui/src/stores/modules/consciousness.ts`) | `settings/consciousness/active-provider`, `active-model`, `active-custom-model`, `active-temperature`, `active-top-p` | `resetState` | yes | listed |
| `useHearingStore` (`packages/stage-ui/src/stores/modules/hearing.ts`) | `settings/hearing/*`, except the two push-to-talk keys | `resetState` | yes | listed |
| `useSpeechStore` (`packages/stage-ui/src/stores/modules/speech.ts`) | `settings/speech/*`, except `output-*` | `resetState` | yes | listed |
| `useVisionStore` (`packages/stage-ui/src/stores/modules/vision/store.ts`) | `settings/vision/*`, except `capture-interval-ms` | `resetState` | **no** | listed |
| `useArtistryStore` (Kept, `packages/stage-ui/src/stores/modules/artistry.ts`) | `artistry-model`, `artistry-provider`, `artistry-provider-options`, `artistry-prompt-prefix`, and the credentials `artistry-replicate-api-key`, `artistry-nanobanana-api-key` | `resetState` | **no** | listed |

### 2.4 Unsynced stores and components with plain refs

| Owner and write site | Keys | Reset today | Delete all data | Doc |
| --- | --- | --- | --- | --- |
| `useSettingsGeneral` (`packages/stage-ui/src/stores/settings/general.ts`); `settings/language` is also written by `useLanguage` (`apps/stage-tamagotchi/src/renderer/composables/use-language.ts`) | `settings/language`, `streamer-mode`, `disable-transitions`, `use-page-specific-transitions`, `websocket/secure-enabled` | `useSettings().resetState` | yes | listed |
| `useSettingsAnalytics` (`packages/stage-ui/src/stores/settings/analytics.ts`) | `settings/analytics/opted-in`; orphan `settings/analytics/enabled` from upstream's key | `useSettings().resetState` | partly: the orphan stays | listed |
| `useSettingsControlsIsland`, `useSettingsDeveloper`, `useSettingsTheme` (`packages/stage-ui/src/stores/settings/`) | `settings/allow-visible-on-all-workspaces`, `always-on-top`, `controls-island/icon-size`; `settings/developer/*`; `settings/theme/colors/hue`, `hue-dynamic` | `useSettings().resetState` | yes | listed |
| `useTheme` (`packages/ui/src/composables/use-theme.ts`); also written by `useDark` in `fade-on-hover.vue` and `LoadingSciFiCircle` | `vueuse-color-scheme` | none | **no** | **missing** |
| `useSettingsSpine` (`packages/stage-ui/src/stores/settings/spine.ts`) | per model `settings/spine/premultiplied-alpha`, `default-mix`, `idle-enabled`; global `max-fps`, `render-scale` | `useSettings().resetState` | partly: active model only | listed |
| `useTachie` (`packages/stage-ui-tachie/src/stores/tachie.ts`) | per model `settings/tachie/position`, `scale`, `shadow-enabled`; global `render-scale` | `useSettings().resetState` | partly: active model only | listed |
| `useSettingsAudioDevice` (`packages/stage-ui/src/stores/settings/audio-device.ts`) | `settings/audio/input`, `input/enabled`, `input/off` | `resetState` | yes | listed |
| `useSettingsBeatSync` (`packages/stage-ui/src/stores/settings/beat-sync.ts`) | `settings/beat-sync/parameters`, `spectrum-scale` | `resetState` | **no** | listed |
| `useSettingsScreenAmbientLight` (`packages/stage-shared/src/stores/screen-ambient-light.ts`) | prefix `settings/screen-ambient-light/` | `resetState` | yes | listed |
| `useSettingsLive2d` (`packages/stage-ui-live2d/src/composables/live2d/live2d.ts`) | per model driver, tracking, eye-offset, idle, expression, and shadow keys; global `auto-blink-enabled`, `force-auto-blink-enabled` (versioned), `max-fps`, `render-scale` | `resetState` | partly: active model only | listed |
| `useLive2dParams` and `useL2dViewControl` (`packages/stage-ui-live2d/src/stores/`) | per model `current-motion`, `available-motions`, `motion-map`, `parameters`, `scale`, `position` | `resetState` | partly | listed |
| `useLive2DMotionMagicSettings` (`packages/stage-ui/src/features/motions/live2d/settings.ts`) | per model `settings/live2d/magic/*` | `resetState` | partly | listed |
| `useMMD` and `useMMDViewControl` (`packages/stage-ui-mmd/src/stores/`) | per model physics, gaze, driver, camera, light, idle, motion, clip-metadata, morph, material, `scale`, `rotationY`, `position`; global `render-scale`, `stage-character-height`, `roam-mode`, `stance-slots`, `clip-curation` | `resetState` | partly | listed |
| `useModelStore`, `useThreeViewControl`, `useThreeCamera` (`packages/stage-ui-three/src/stores/`) | per model model, tracking, lighting, environment, `modelOffset`, `cameraFOV`, `cameraDistance`, `camera-position`; global `max-fps`, `last-committed-model-id`, `renderScale`, `multisampling`; legacy `lastModelSrc` | `resetModelStore` | partly: lighting, environment, render scale, multisampling, FPS, field of view, and distance stay | listed |
| `useSpine` and `useSpineViewControl` (`packages/stage-ui-spine/src/stores/`) | per model animation, skin, variant, speed, `scale`, `position` | `resetState` on `useSpine` only | **no** | listed |
| `useHomeAssistantStore` (Kept), `useWebSearchStore`, `useDiscordStore`, gaming stores from `createGamingModuleStore` | prefixes `settings/home-assistant/`, `settings/web-search/`, `settings/discord/`, `settings/minecraft/`, `settings/factorio/` | `resetState` | yes | listed |
| `useMcpStore` (`packages/stage-ui/src/stores/mcp.ts`) | `settings/mcp/server-cmd`, `server-args`, `mcp/connected` | `resetState` | yes | listed |
| `useVoiceprintStore` (`packages/stage-ui/src/stores/voiceprint.ts`) | `settings/voice/voiceprints`, `settings/voice/voiceprint-deleted-at`; legacy `settings/voice/voiceprint` | `removeAll`, which stamps the deletion time | yes, first | listed |
| `useVisionProcessingStore` (`packages/stage-ui/src/stores/modules/vision/processing-store.ts`) | `settings/vision/capture-interval-ms` | `resetState` | **no** | listed |
| `useModsServerChannelStore` (`packages/stage-ui/src/stores/mods/api/channel-server.ts`) | `settings/connection/websocket-url`, and the credential `settings/connection/websocket-auth-token` | none | **no** | listed |
| `useSpeechOutputControlStore`, `useWakeWordsStore`, `useToolCardsStore`, `useFeatureFlagsStore` (`packages/stage-ui/src/stores/`) | `settings/speech/output-muted`, `output-volume`, `output-volume-last-audible`; `settings/voice/pronunciation-owners`; `settings/tool-cards/enabled`, `reply-cards`; `settings/feature-flags`, `settings/feature-flag-variants` | none | **no** | listed |
| `useDanmakuFeedSettings` (`packages/stage-ui/src/composables/use-danmaku-feed-settings.ts`) and `apps/stage-tamagotchi/src/renderer/pages/chat-floating.vue` | `chat-window/danmaku/hide-read-messages`, `chat-window/danmaku/composer-folded` | none | **no** | listed |
| `useSettingsNeedsAttention` (`packages/stage-ui/src/composables/use-settings-needs-attention.ts`) | `settings/needs-attention/dismissed` | none | **no** | listed |
| `use-live2d-model-settings.ts` (`packages/stage-ui/src/components/scenarios/settings/model-settings/`) | `selected-runtime-motion`, `selected-runtime-motion-group`, `selected-runtime-motion-index` | none | **no** | listed |
| `voice-input-button.vue`, `composer-voice-input.vue` (`packages/stage-ui/src/components/scenarios/chat/components/`) | `ui/chat/voice-mode`, `ui/chat/composer-voice-mode` | none | **no** | listed |
| `InteractiveArea.vue` (app), `ChatArea.vue`, `ChatActionButtons.vue` (`packages/stage-layouts/src/components/Widgets/`) | `ui/chat/settings/send-mode` | none | **no** | listed |
| `trace-timeline.vue` (Kept, `packages/ui-trace`) | `ui/devtools/io-tracer/label-width` | none | **no** | listed |

### 2.5 Desktop app stores and sessionStorage

| Owner and write site | Keys | Reset today | Delete all data | Doc |
| --- | --- | --- | --- | --- |
| `useControlsIslandStore` (`apps/stage-tamagotchi/src/renderer/stores/controls-island.ts`) | `controls-island/fade-on-hover-enabled`, `preferences/dont-show-it-again/notice/fade-on-hover` | none | **no** | listed |
| `useServerChannelSettingsStore` (`apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts`) | `settings/server-channel/hostname`, `websocket-tls-config`, and the credential `settings/server-channel/auth-token` | none | **no** | listed |
| `usePushToTalkShortcutSettings` (`apps/stage-tamagotchi/src/renderer/composables/use-push-to-talk-shortcut.ts`) | `settings/hearing/push-to-talk-shortcut`, `push-to-talk-shortcut-error` | none | **no** | listed |
| `useFullscreenLayout` (`apps/stage-tamagotchi/src/renderer/composables/use-fullscreen-layout.ts`) | `fullscreen/surface-width` | none | **no** | listed |
| The OpenPanel client (`packages/stage-ui/src/libs/product-signals/openpanel.ts`) | sessionStorage `airi:openpanel-device-id` | none | **no** | not a member |
| The IO trace bridge (`apps/stage-tamagotchi/src/renderer/bridges/io-trace-hub.ts`) | sessionStorage `airi:trace-source-id` | none | **no** | not a member |

### 2.6 Not members

- **Read, never written by the client:** `airi:debug:pinia-tracing`, which a developer sets by hand (`packages/stage-ui/src/libs/pinia/pinia-plugin-tracing.ts`); `settings/language`, read by the Sherpaw provider.
- **Removed at startup or on first use:** `auth/v1/*` (`removeRetiredAccountCredentials`), the Cache Storage `sherpaw-models` (deleted when `model-assets.ts` loads), and the unscoped per-model keys, which move to the first active model.
- **Constants without a reader or writer:** `CHAT_STORAGE_KEY` and `ACTIVE_SESSION_STORAGE_KEY` in `packages/stage-ui/src/stores/chat/constants.ts`. Mentioned, not changed.
- **Outside the client:** the QA seeders in `packages/qa-tools/src` and `packages/scenarios-stage-tamagotchi-electron/src`, which write a test profile from outside.
- **Library storage the step cannot enumerate:** the PostHog and OpenPanel SDKs keep their own storage when an analytics build loads them; see [Blocked](#blocked-needs-the-owner).

### 2.7 The doc's misses, summed up

`vueuse-color-scheme`, the OPFS model copies, and the Transformers.js cache are missing; the `local` and `outbox` database is wrong; the sessionStorage ids are named but not members. Two keys have two writers: `settings/language` (listed as a known gap) and `vueuse-color-scheme` (not listed). The Known gaps list is otherwise accurate on `e36bfc903`.

## 3. The design

### 3.1 Terms

- **State registry**: the one array of registrations in `packages/stage-ui/src/persistence/state-registry.ts`. New glossary term.
- **Registration**: one owner's persisted state: its locations, the files that write them, its tier, and an optional owner reset.
- **Location**: one place in browser storage that a registration owns: a localStorage key, key prefix, or per-model key; a sessionStorage key; an IndexedDB object store, optionally narrowed by a key prefix; an OPFS directory; or a Cache Storage cache.
- **Sweep**: removing everything a location matches.

Target rules, as `state-persistence.md` states them:

1. **One registration point.** "Every piece of persisted client state is declared in one place with its tier, its keys or key prefix, and its reset. 'Delete all data' resets exactly the registered set." The registry is runtime code, and `deleteAllData` runs it (D2). "Exactly the registered set": `deleteAllData` touches no location outside the registry, and leaves no registered location holding data, except the one location marked `kept`.
2. **A test enforces it.** "A focused test fails when the client writes storage under a key that no registration owns." Section 3.5.
6. **One owner per key.** "No two stores own the same storage key." No two registrations have overlapping locations, and the static scan fails on a write from a file that the owning registration does not list as a writer. A3 removes the two second writers.

### 3.2 Shapes

```ts
/** packages/stage-ui/src/persistence/state-registry.ts */
import type { Pinia } from 'pinia'

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
    | { area: 'indexedDB', database: string, store: string, prefix?: string }
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
export declare function defineStateRegistry<const T extends readonly StateRegistration[]>(registrations: T): T

export declare const stateRegistry: readonly StateRegistration[]
export type StateRegistrationId = (typeof stateRegistry)[number]['id']

/** One write, as the browser test observes it and as the sweep enumerates storage. */
export type StorageEntry
  = | { area: 'localStorage' | 'sessionStorage', key: string }
    | { area: 'indexedDB', database: string, store: string, key: string }

export declare function locationMatches(location: StorageLocation, entry: StorageEntry): boolean

/**
 * Runs the owner reset of each registration in registry order, then sweeps its locations. A failure does not stop the
 * rest; after every registration ran, the first failure is thrown. Without `ids` it runs every registration.
 */
export declare function resetRegisteredState(context: ResetContext, ids?: readonly StateRegistrationId[]): Promise<void>
```

Two registrations, as they read in the registry. Locations and writers are literals, because the static scan reads them from the source (section 3.5).

```ts
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
    // First, so a failed step below cannot keep a voiceprint.
    reset: ({ pinia }) => useVoiceprintStore(pinia).removeAll(),
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
])
```

**Granularity.** One registration per owner reset. Stores that one reset reaches share a registration: `useMMD` with `useMMDViewControl`, `useModelStore` with `useThreeViewControl` and `useThreeCamera`, the three send-mode components. Every other row of section 2 is its own registration. Prefixes are used only for families that one owner holds whole (`expression-catalog:`, `settings/screen-ambient-light/`, `artistry-`, `settings/home-assistant/`, and the like); a store whose keys share a path with another owner lists exact keys (`useHearingStore`, because the app owns the two push-to-talk keys; `useMMD`, because `useMMDNaturalSettings` owns `settings/mmd/natural`).

**Where owner resets come from.** A registration has a `reset` when the owner keeps the state in memory in some window, so a sweep alone would leave a stale copy that the owner writes back: every synced store (routed to the leader), every store with a `resetState` today, and the tool-card state store (`deleteCard` for each card, leader-routed). A registration without one is swept only; other windows learn of the removal through the `storage` event, and VueUse resets each listening ref to its default. The window that ran the sweep keeps its own in-memory copy of an unsynced plain ref until it reloads (risk table).

### 3.3 Ownership rules the registry test checks

- Ids are unique, and every registration has at least one location and one writer.
- No two locations of different registrations overlap. Two locations overlap when one key matches both: an exact key inside another prefix, two prefixes where one starts with the other, a per-model key that equals another location's key, or IndexedDB locations on one store whose prefixes overlap.
- `kept` appears only on the voiceprint deletion time.
- Each unstorage mount of `storage` (`storage.getMounts()`) matches an IndexedDB location.

### 3.4 "Delete all data"

```ts
/** packages/stage-ui/src/composables/use-data-maintenance.ts, the parts that change */
import type { StateRegistrationId } from '../persistence/state-registry'

/** The partial resets keep today's membership. */
export declare const modulesRegistrations: readonly StateRegistrationId[]

export declare function useDataMaintenance(): {
  /** `resetRegisteredState({ pinia })` with every registration. */
  deleteAllData: () => Promise<void>
  resetProvidersSettings: () => Promise<void>
  resetModulesSettings: () => Promise<void>
  deleteAllChatSessions: () => Promise<void>
  deleteAllModels: () => Promise<void>
  resetDesktopApplicationState: () => Promise<void>
}
```

`useDataMaintenance` takes the Pinia instance of its window at setup and hands it to every reset. The partial resets call `resetRegisteredState` with typed id lists that keep today's membership (D12): providers is `provider-settings`; modules is hearing, Home Assistant, speech, character state, consciousness, consciousness settings, web search, Discord, Factorio, Minecraft, memory, and recipes; chats is `chat-sessions` and `chat-assets`; models is `display-models`; the desktop reset is settings and modules, as today.

**Order.** Registry order is reset order. Today's order constrains it in three places, and the registry keeps all three: the voiceprints first; the expression documents before the display models, because removing the models switches the stage to the default model, which must load without a stored catalog; and the chat sessions before the situation's inner state, because deleting the sessions forgets their threads. The registrations that S adds go after today's members of their group, and the caches go last.

**Failures.** Every registration runs even when an earlier one failed, and the first failure is thrown at the end (D5). Today only the module resets settle together; a failure anywhere else stops every later deletion. In the danger section, the host data step (`deleteHostData`, which the app passes) also runs after a renderer failure, and the section then reports the first failure.

**Proof that it clears what it cleared before.** Every reset that `deleteAllData` calls today becomes the owner reset of one registration, with the same call:

| Today | Registration |
| --- | --- |
| `voiceprintStore.removeAll()` | `voiceprints` |
| `clearExpressionDocuments()` | `expression-documents`: the prefix sweep replaces the function |
| `deleteAllModels()`: `resetDisplayModels`, `updateStageModel` | `display-models` |
| `resetProvidersSettings()` | `provider-settings` |
| `resetModulesSettings()`: twelve stores | one registration each |
| `deleteAllChatSessions()`: `cancelPendingSends`, `resetAllSessions`, `forget({ scope: 'threads' })` | `chat-sessions` |
| `resetSettingsState()`: `useSettings().resetState` and seventeen other resets | one registration per store; `useSettings().resetState` splits into its eight stores |
| `clearSherpawModelAssets()` | `sherpaw-model-assets` |
| `situationStore.forget({ scope: 'everything' })` | `situation-inner-state` |

The sweep after each owner reset adds what the owner resets miss: records outside the session index, per-model keys of models that are not active, and legacy keys.

**Gaps it closes.** Every row marked **no** or partly in section 2. The ones that hold personal data or credentials: the three credentials, the background and sticker images, the saved tool cards and their call results, the pronunciation owners, the OpenPanel device id, and the OPFS copies of imported models. A newly found gap is a privacy fix, so S closes it (D6), including the two caches (D7).

**Scope of the registry.** Renderer storage only. The main-process records stay with `storedDataDeleteActivity` (section 3.8).

### 3.5 The focused test

Two halves, because each sees what the other cannot (D4).

**Runtime half:** `packages/stage-ui/src/persistence/state-registry.browser.test.ts`, in the stage-ui browser project, with real localStorage, IndexedDB, OPFS, and Cache Storage.

1. Spies on `Storage.prototype.setItem` (localStorage and sessionStorage) and on `IDBObjectStore.prototype.put` and `add`, which record the database name, the object store name, and the key of each write.
2. Mounts a leader window and a follower window with real stores and separate synced runtimes, as `use-data-maintenance.browser.test.ts` does, and selects a display model in each `DisplayModelSettingsScope`.
3. Runs `resetRegisteredState` in the follower. This creates every owner store, writes its defaults, and exercises every owner reset, leader-routed ones included.
4. Fails on each observed write that no non-legacy location matches, naming the key and the area.
5. Then seeds a marker into every location (an exact key, one key under each prefix, two model ids for each per-model key, an IndexedDB record under each prefix, an OPFS directory, a Cache Storage cache), runs `resetRegisteredState` again, and fails on any location that still holds a marker, except the `kept` one. This is rule 1's "resets exactly the registered set".
6. Checks the ownership rules of section 3.3.

```ts
/** packages/stage-ui/src/persistence/state-registry.browser.test.ts */
import type { StorageEntry } from './state-registry'

interface ObservedWrite {
  entry: StorageEntry
  /** The first stack frame outside the test and the spies, for the failure message. */
  site: string
}

export declare function captureWrites(run: () => Promise<void>): Promise<ObservedWrite[]>
```

It sees writes by the stores that stage-ui and its dependencies own, including keys built at run time: per-model keys, the gaming stores' `settings/<module>/` keys, defaults that VueUse writes on creation, and the exact IndexedDB keys that the repositories write.

**Static half:** `scripts/dev-tools/storage-writes.test.ts` with `scripts/dev-tools/lib/storage-writes.ts`, in the root `dev-tools` project, built on the TypeScript parser as `scripts/dev-tools/lib/gated-tests.ts` is. It reads files, never imports them.

```ts
/** scripts/dev-tools/lib/storage-writes.ts */
export interface StorageWriteSite {
  /** Repository path with `/` separators. */
  file: string
  line: number
  area: 'localStorage' | 'sessionStorage' | 'indexedDB' | 'opfs' | 'cacheStorage'
  key:
    | { exact: string }
    | { prefix: string }
    | { perModel: string }
    /** A key the scan cannot resolve; `source` is the key expression. */
    | { unresolved: string }
}

/** The write sites of one source file. A `.vue` file is scanned through its script blocks. */
export declare function findStorageWrites(file: string, source: string): StorageWriteSite[]

export interface RegistrySource {
  id: string
  writers: string[]
  locations: Array<Record<string, string | boolean>>
}

/** Reads the registrations from the registry source; fails when a location or a writer is not a literal. */
export declare function readStateRegistry(source: string): RegistrySource[]
```

- **Scanned:** `packages/*/src/**/*.{ts,vue}` and `apps/stage-tamagotchi/src/renderer/**/*.{ts,vue}`, without test files, `src/test/`, and stories. Packages that never touch browser storage produce no sites.
- **Write sites:** calls of `useLocalStorage`, `useSessionStorage`, `useStorage`, `useLocalStorageManualReset`, `useVersionedLocalStorage`, `useVersionedLocalStorageManualReset`, `useModelScopedLocalStorage`, `useModelScopedLocalStorageManualReset` (a `perModel` key), `useSettingsDocument`, `useDark` and `useColorMode` (their `storageKey` option, else `vueuse-color-scheme`), and `setItem` on `localStorage`, `sessionStorage`, `window.localStorage`, or `globalThis.localStorage`; `indexedDbDriver({ dbName, storeName, base })` options and the mount names of `storage.mount`; `navigator.storage.getDirectory` and `caches.open` calls.
- **Key resolution:** a string literal is exact; a template literal is a prefix up to its first substitution; an identifier resolves through a `const` in the same file, and a member of an `as const` object resolves through the file that exports it (`packages/stage-ui/src/constants/settings-storage.ts`). The helper definitions under `packages/stage-shared/src/composables/use-*storage*` and `use-settings-document` are not sites.
- **It fails closed:** a site whose key it cannot resolve, or whose prefix no single location covers, must appear in the test's table of dynamic sites with the registration it belongs to. Today the table has three: `consciousness-settings.ts` (`settings/consciousness/${key}`), `gaming-module-factory.ts` (`settings/${moduleName}/...`), and `opencode-go-migration.ts` (a `Storage` parameter). OPFS and Cache Storage sites are mapped by file the same way.
- **It fails** when a resolved key matches no location, when it matches a `legacy` location, or when the site's file is not a writer of the registration that owns the key (rule 6).

`pnpm verify` runs the static half whenever a file under the scanned roots or the registry changes: `docGuards` in `scripts/dev-tools/verify-plan.ts` becomes `fileGuards` and gains that entry, beside the policy docs entry.

**What neither half sees.** Writes inside Web Workers and by libraries (the Transformers.js cache, analytics SDKs), which are registered by hand and swept but not observed; OPFS directory and cache names, which are mapped by file only; cookies; keys whose writer is reached only through a function the scan does not know and that no registration reset runs; and main-process files, which are outside the registry.

### 3.6 The four settings documents

`useSituationSettings`, `useConversationSettings`, `useHostNoticeSettings`, and `useExpressionPerformanceSettings` move onto `useSettingsDocument`. Each keeps its store id, its key, its stored shape, its exported types and default functions, its `synced` options, and its action names.

`useSettingsDocument` already gives what the hand-rolled code does: one Valibot-validated document, private persistence with `listenToStorageChanges: false` and `writeDefaults: false`, per-field validation of the stored document (an invalid field falls back to its default while valid siblings survive, unknown fields are dropped), a one-level merge in `update`, `reset` to the schema defaults, and `initial` for a document that is not stored yet. It has no versioning and no sync of its own: the synced store replicates, and the store lists `update` and `reset` under `synced.actions`. It gains one option:

```ts
/** packages/stage-shared/src/composables/use-settings-document/index.ts */
export interface UseSettingsDocumentOptions {
  /** Names the document in console warnings, for example `live2d-natural-settings`. */
  label: string
  /** Raw field values to start from while nothing is stored under the key. */
  initial?: () => unknown
  /**
   * Rewrites a stored document before its fields are validated. Only for a `// NOTICE:` fallback that removes or
   * renames stored fields, with that block's removal condition. Not applied to `initial`.
   */
  upgrade?: (stored: Record<string, unknown>) => Record<string, unknown>
}
```

| Document | Move | Behavior change |
| --- | --- | --- |
| Situation | `situationSettingsEntries` into `useSettingsDocument('settings/situation', ...)`; `defaultSituationSettings` parses `{}` with the same entries | None: it already validated each field |
| Conversation | The same | None |
| Host notice | `dismissedKeys` becomes `optional(array(string()), () => [])`; `dismiss(key)` calls `update` with the merged list | A stored document with an unknown field keeps its dismissed keys instead of resetting |
| Expression performance | `packages/stage-shared/src/expression-performance/settings.ts` exports `createExpressionPerformanceSettingsEntries(mood)`, and the schema is built from it. The two `// NOTICE:` strips move unchanged into `upgrade`. The store keeps its deep-merge `update` (arrays replace) and passes the merged document to the helper's `update` | An invalid or unknown top-level section now resets alone instead of the whole document (D9) |

```ts
/** packages/stage-ui/src/features/performance/settings.ts, after the move */
export const useExpressionPerformanceSettings = defineStore('expression-performance-settings', () => {
  const settings = useSettingsDocument('settings/expression-performance', expressionPerformanceSettingsEntries, {
    label: 'expression-performance',
    upgrade: dropRemovedExpressionPerformanceFields,
  })

  async function update(patch: SettingsPatch<ExpressionPerformanceSettings>) {
    return settings.update(mergeExpressionPerformancePatch(settings.document.value, patch))
  }

  return { document: settings.document, update, reset: settings.reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
```

No key or shape changes, so no compatibility code is added. The two existing `// NOTICE:` blocks keep their text and removal conditions.

### 3.7 One writer per key (A3)

- `useLanguage` reads whether a language was saved with `localStorage.getItem('settings/language')`. It stops opening a second storage ref, which wrote `''` on a first launch. `useSettingsGeneral` stays the owner, and `use-language.browser.test.ts` keeps its eight cases.
- `fade-on-hover.vue` and `LoadingSciFiCircle` read `useTheme().isDark` instead of calling `useDark`, which wrote `vueuse-color-scheme` beside `useTheme` and also set the root class. `packages/ui-loading-screens` already depends on `@proj-airi/ui`.
- `migrateGoCredentials` keeps writing the provider keys once; it is listed as a writer of `provider-settings`. It is a move under a `// NOTICE:` block, not a second owner.

### 3.8 Main-process records and perf records

The registry declares renderer storage only. `state-persistence.md` keeps a "Main-process files" section, now stating that boundary in one sentence:

- **Session logs, IO traces, and the computer-use store** are declared by `setupStoredData` (`apps/stage-tamagotchi/src/main/services/airi/stored-data/index.ts`), which handles `storedDataDeleteActivity`. The Data settings page (`apps/stage-tamagotchi/src/renderer/pages/settings/data/index.vue`) passes `deleteMainProcessData` as `deleteHostData`; it also clears the Home Assistant address and token. Unchanged.
- **Perf records** move from that section's bullet list into Named exceptions: they keep their own 14-day retention (`apps/stage-tamagotchi/src/main/services/airi/perf-recording/retention.ts`) and are not deleted with all data, because they hold timings and no personal content.
- Main-process settings files stay as listed.

### 3.9 The stacked character mind branches

The stacked branches sit on `872b74cb5`, and `main` is 20 commits further. `git diff origin/main luke/feat/character-mind-widget-turns -- <path>` therefore also shows those 20 commits reversed; the table below uses the three-dot form, which shows only what the slices change.

**Storage changes in the slices.** None adds a storage key, database, mount, or OPFS or cache location. CM1 removed the `reaction` field from the `settings/situation-inner` document, and CM3a removed `rngState` from its `gate` field; the key, tier 2, the leader-only writer, and `forget` stay. The mind persists nothing (CM1 D8). The registration `situation-inner-state` names only the key, so neither change touches it. When a slice branch rebases onto S, the focused test runs on its tree: a slice that writes a new key fails until it adds a registration in the same commit.

**Files both touch, and how the later rebase resolves each:**

| File | The slices change | S changes | Resolution |
| --- | --- | --- | --- |
| `docs/ai/context/state-persistence.md` | The "gate's inner state" named exception (written from the mind's published memory, no `reaction` field) | Members tables, Named exceptions, Known gaps, Target | Keep S's structure and carry the slices' exception text over |
| `docs/ai/context/glossary.md` | New and changed character mind terms | "State registry" added; "Persistence tier" and "Synced settings document" changed | Different entries; keep both in alphabetical order |
| `docs/ai/context/character-mind-roadmap.md` | The CM rows, CM3 split into CM3a and CM3b | The S row | Adjacent rows; keep both |
| `docs/ai/context/upstream-policy.md` | Widget and notice rows | The "Per-model settings" Revisit and two new rows | Different rows |
| `packages/stage-shared/src/motion-scenario/bridge.ts`, `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts` and its test, `packages/qa-tools/README.md` | The `voiceEvaluate` verb and voice QA notes | The `deleteAllData` verb | Adjacent additions; keep both verbs |
| `packages/stage-ui/README.md`, `packages/stage-shared/README.md` | Character mind and gate sections | A "Persisted state" section; the expression performance exports | Different sections |

S does not change `inner-state.ts`, `stores/situation/index.ts`, `chat.ts`, `App.vue`, or the stage-ui guide, which the slices change.

### 3.10 Rendered QA

S changes persistence, so the rendered check proves three things in the real app: settings that the current release saved survive the upgrade to S and a restart, "Delete all data" clears them, and nothing comes back after another restart.

**`AppSession` cannot restart with the same profile.** `AppSession.start` creates a new run directory and a fresh profile in it, and `stop` tears the run down with `AppSessionCore.teardown`, which removes the profile. The check therefore uses `AppSessionCore` (`packages/qa-tools/src/session/app-session.ts`), which `AppSession` wraps: the driver owns the profile directory, passes a `removeDir` that keeps it to `teardown`, and starts the next launch on the same `profileDir` with `onboarding: false`. Because a core takes its `repoRoot`, the first launch can run the base build.

**"Delete all data" in the running app** goes through a new motion QA bridge verb, `deleteAllData`, which runs `useDataMaintenance().deleteAllData()` in the stage window (A7, D13). The bridge is dev-only.

**The driver** is `.temp/s/driver.ts`, which is not committed. It runs inside `pnpm qa:display run --name s -- ...` and is stopped with `pnpm qa:display down --name s`. `.env.qa` holds `AIRI_QA_RIG_FORBOOTH`.

1. **Base.** `pnpm wt new s-base` checks out `origin/main`. A core on that tree starts with a fresh profile, seeded with the replay LLM (`buildSeedEntries`). The driver imports the Live2D rig (`AIRI_QA_RIG_FORBOOTH`), which also fills its OPFS copy, sends one replayed chat turn, and changes settings through the real stores, reached in the stage window through the Vue app's Pinia: each of the four documents (`chattiness` 0.8, `register` `texting`, one dismissed host notice, `heldEmotions` false), one plain ref that is a gap today (`settings/feature-flags`), and the theme. It records a census: every localStorage key with its value, every IndexedDB database and object store with its record keys, the OPFS root entries, and the Cache Storage names. It stops and keeps the profile.
2. **Upgrade and restart.** A core on the S worktree starts on the same profile. Pass: every census entry from step 1 is unchanged, the bridge `state` reports `heldEmotions: false`, the four stores return step 1's documents, and the chat session and the model are present.
3. **Delete all data.** The driver calls `deleteAllData` and records a second census. Pass: no registered location holds a value from step 1, except the voiceprint deletion time; the OPFS root has no model directory; the `localforage` store has no `display-model-` record; the `keyval-store` database has no `airi-local:chat:` record; and the session has no renderer error.
4. **Restart again.** A third launch on the profile. Pass: the census still has none of step 1's values, the app starts at onboarding, and there is no renderer or main-process error.
5. Remove the base worktree with `pnpm wt rm s-base`, and record the census diffs, keys only, in the PR description.

## 4. Where the code lives

The registry, its location matcher, and `resetRegisteredState` are `packages/stage-ui/src/persistence/state-registry.ts`, beside its browser test. `packages/stage-ui` already depends on every renderer package whose stores it resets (stage-shared, `ui`, Live2D, MMD, Three, Spine, Tachie). It does not import stage-layouts or the app; their locations are declared as data, swept without an owner reset, and named by path in `writers` (D3). `useDataMaintenance` stays in `packages/stage-ui/src/composables/use-data-maintenance.ts` and calls the registry. The static scan is `scripts/dev-tools/lib/storage-writes.ts` and its test. No package is added, and no package imports an app.

## 5. What is deleted

| Removed | Item | Proof that nothing else used it |
| --- | --- | --- |
| The hand-rolled stored-document readers `readStoredSituationSettings`, `readStoredConversationSettings`, `readStoredHostNoticeSettings`, and the expression performance serializer | A1, A2 | Private to their files |
| `clearExpressionDocuments` and `expressionDocumentPrefixes` | A5 | Private to `use-data-maintenance.ts`; the `expression-documents` registration replaces them |
| The store list in `useDataMaintenance`, `resetSettingsState`, and the bodies of the partial resets | A5 | The returned API of `useDataMaintenance` keeps its names; `git grep -n useDataMaintenance` finds the danger section, the desktop reset section, and the test |
| The second `settings/language` ref in `useLanguage`; `useDark` in `fade-on-hover.vue` and `LoadingSciFiCircle` | A3 | Local to those files |

After A6, `git grep -nE "readStored(Situation\|Conversation\|HostNotice)Settings\|clearExpressionDocuments" -- packages apps` must print nothing.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false. The work item is named in brackets.

- **`docs/ai/context/state-persistence.md`:** "Settings documents": three documents on the helper [A1], all six [A2]. The `useLanguage` known gap and the theme's second writer [A3]. A new "State registry" section that states rule 6 and how to add a registration; "Choosing a tier" says a store registers in the state registry, not with `useDataMaintenance`; the doc gets a "Caches" paragraph and the corrected `keyval-store` naming [A4]. Rule 1 into the current sections; the Members tables replaced by a pointer to the registry, keeping "Per-model display settings" (D11); the closed gaps leave Known gaps; Target table rows for rules 1 and 6 go; perf records become a named exception; the "Main-process files" boundary sentence [A5]. Rule 2 into the current sections and its Target row [A6]. Target rules 3, 4, and 5 and their rows stay.
- **`docs/ai/context/glossary.md`:** add **State registry** [A4]; "Persistence tier" names `PersistenceTier` and the registry instead of `useDataMaintenance` [A4]; "Synced settings document" examples [A2].
- **`docs/ai/context/testing.md`:** the storage-write scan in "Checks and what they prove", and "A new storage key" in "Checks by change type" [A6].
- **`docs/ai/context/upstream-policy.md`** [A8]: "Per-model settings" Revisit settled (registered as upstream ships them); a row for "Delete all data" (upstream resets a fixed list; the fork runs every registration); a row for the language and theme readers.
- **`docs/ai/context/character-mind-roadmap.md`** [A8]: the S row done.
- **`docs/ai/audits/2026-10-31-architecture-boundaries.md`** [A8]: the current-status note of R1 points to the registry.
- **READMEs:** `packages/stage-ui/README.md` gains "Persisted state" (the registry, how to register, what "Delete all data" does) [A4, A5]; `packages/stage-shared/README.md` names `createExpressionPerformanceSettingsEntries` [A2]; `packages/qa-tools/README.md` names the `deleteAllData` verb [A7]; `scripts/dev-tools/README.md` names the new guard of `pnpm verify` [A6].
- **Guides:** none. `git grep` finds `useDataMaintenance` in no `AGENTS.md` or skill. A missing registration fails a test, so no rule is added.
- **New ADR:** `docs/ai/adr/<date written>-state-registry.md` [A8]. ADR bodies already written are not edited.

## 7. Work items

Each item is one commit that passes `pnpm verify`.

1. **A1 `refactor(stage-ui): build three settings documents on useSettingsDocument`.** Situation, conversation, and host notice (section 3.6). Docs as marked `[A1]`. Tests: the situation and conversation browser tests pass unchanged; a new `notice-settings.browser.test.ts` restores a stored document written by the old code, keeps its dismissed keys when it has an unknown field, and `dismiss` is idempotent.
2. **A2 `refactor(stage-shared,stage-ui): build the expression performance settings on useSettingsDocument`.** The `upgrade` option, `createExpressionPerformanceSettingsEntries`, and the store (section 3.6). Docs as marked `[A2]`. Tests: `use-settings-document/index.test.ts` applies `upgrade` to a stored document before per-field validation and never to `initial`; `features/performance/settings.browser.test.ts` keeps every case, including the energy-key and slot-key strips and the deep merge, and gains one: an invalid `naturalBands` resets alone while `picker` survives.
3. **A3 `fix(stage-tamagotchi,ui-loading-screens): read the language and theme without writing them`.** Section 3.7. Docs as marked `[A3]`. Tests: `use-language.browser.test.ts` keeps its cases and gains one: a first launch writes nothing to `settings/language`.
4. **A4 `feat(stage-ui): declare persisted client state in a state registry`.** The module of section 3.2 with every registration of section 2, the ownership checks, and the runtime half of the test, steps 1 to 4 and 6. `useDataMaintenance` does not use it yet. Docs as marked `[A4]`.
5. **A5 `fix(stage-ui,stage-pages): delete every registered piece of state with "Delete all data"`.** `useDataMaintenance` runs the registry (section 3.4); the danger section runs the host step after a failure. Step 5 of the runtime test. `use-data-maintenance.browser.test.ts` keeps its assertions and gains: an Artistry API key, the mods server channel token, a background image record, a tool-card call record, and an OPFS model directory are gone after `deleteAllData`; a throwing owner reset does not stop the voiceprint and chat deletions, and the call still rejects; the voiceprint deletion time survives. Docs as marked `[A5]`.
6. **A6 `test(dev-tools): fail when renderer code writes storage that no registration owns`.** The static half and the `fileGuards` entry (section 3.5). Docs as marked `[A6]`. Tests: `storage-writes.test.ts` runs the scan on the tree, and `lib/storage-writes` cases cover literal, template, constant, and imported-constant keys, a per-model call, a `.vue` script block, an unresolved site that fails, a legacy write that fails, and a write from a file outside `writers` that fails. `verify-plan.test.ts` maps a renderer file change to the test.
7. **A7 `feat(stage-shared,stage-ui,qa-tools): let QA delete all data in a running app`.** The `deleteAllData` verb in `MotionQaCommandSchema` and its handler in `use-motion-qa-bridge.ts`. Docs as marked `[A7]`. Tests: `use-motion-qa-bridge.test.ts` serves the verb through a stubbed maintenance call.
8. **A8 `docs(ai): record the state registry decisions and close step S`.** The ADR, the roadmap, the ledger, and the audit note. Last, after the checks pass.

**Order.** A1 and A2 are independent of the rest. A3 comes before A4 and A6. A5 needs A4; A6 needs A3 and A4; A7 needs A5 for the rendered check. A8 is last.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loop:
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts`
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/composables/use-data-maintenance.browser.test.ts`
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/features` for the settings documents
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/composables/use-settings-document`
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser src/renderer/composables/use-language.browser.test.ts`
  - `pnpm exec vitest run --project dev-tools scripts/dev-tools/storage-writes.test.ts scripts/dev-tools/verify-plan.test.ts`
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after A1 to A6 and A8.
- **The branch:** `pnpm verify --gate`, and `pnpm test:root` once, because the static half reads files through `fs`.
- **Smoke:** `pnpm qa:display run -- pnpm qa:smoke`.
- **Rendered:** the upgrade, restart, and delete check of section 3.10, after A7.
- Record the results in [Checks run](#checks-run).

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| An owner reset that S adds throws, or creating its store starts I/O (the mods server channel, MCP, stickers) | Every registration still runs, and the first failure is reported. A store whose creation connects or loads gets no owner reset; the sweep alone resets it |
| The window that runs "Delete all data" keeps in-memory copies of unsynced plain refs that it only swept, until it reloads, and may write one back on its next change | Synced stores and every store with a `resetState` get an owner reset. The rest are app and component preferences; step 4 of the rendered check proves that nothing comes back after a restart |
| The sweep removes an OPFS model directory while the Live2D cache saves into it | The sweep takes the `airi:live2d-opfs:<id>` Web Lock of each directory that the Live2D cache uses before removing it |
| Clearing the caches makes the next Kokoro voice or model load download again (D7) | As Sherpaw model assets already do today |
| A per-field reset of the expression performance document hides a schema mistake that the whole-document reset showed | The warning names each reset field, as the other documents do |
| The static scan's dynamic-site table grows | A new entry needs the registration it belongs to and a reason; a site that a constant can express should use one |
| The upgrade check needs a second worktree and build | It runs once, at the end; without it the browser tests still read documents in the old shape |

**Found and not fixed in S:**

- Deleting one display model leaves its OPFS copy (`removeDisplayModel` does not clear it). "Delete all data" now clears it. A one-line follow-up outside S.
- `CHAT_STORAGE_KEY` and `ACTIVE_SESSION_STORAGE_KEY` have no reader.
- Target rule 3 (replicated plain refs and the closed tier) stays for a later step.

**Left for later steps:** CM4 keeps the mind's slow state in the `character-state` registration, with "Delete all data" reaching it from its first commit; CM7's behavior document will be one tier 1 registration.

## 10. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | One PR or two | One PR of 8 commits; the documents (A1, A2) first in a PR of their own, then the registry | One PR | Each commit passes `pnpm verify`; the documents are two small refactors, and one rendered check covers both parts |
| D2 | What the registry is | Runtime code that "Delete all data" runs; a declaration that only the test reads | Runtime code | Rule 1 makes "Delete all data" reset exactly the registered set; a second list would drift from the first |
| D3 | Where app and stage-layouts state is declared | In stage-ui's registry as data, swept only; a registry per package composed by the app | In stage-ui | One registration point; no package imports the app, and these owners have no reset to call |
| D4 | The focused test | A runtime write capture; a static scan; both | Both | The capture sees keys built at run time and default writes; the scan sees writes in actions and components that no reset runs, in the app too |
| D5 | Failure policy | Stop at the first failure, as today outside the modules; run every reset and report the first failure | Run every reset, also the host data step | A failed step must not keep later personal data |
| D6 | Gaps found | Fix them in S; record them for later | Fix in S | Each holds data that "Delete all data" promises to delete, three of them credentials |
| D7 | Caches | Clear the OPFS model copies and the Transformers.js cache; keep caches | Clear both | The OPFS copies are the user's imported files; the Transformers.js cache follows the Sherpaw assets that are already cleared |
| D8 | A tier for caches | A `cache` tier value and a "Caches" paragraph; fold into tier 4 | `cache` | Tier 4 is IndexedDB records; a cache is a copy the app can rebuild |
| D9 | Expression performance validation | Per-field through `useSettingsDocument`; keep whole-document validation | Per field | The other five documents already do it; one bad section no longer resets the rest |
| D10 | The second writers | Readers that do not write; register them as co-writers | Readers | Rule 6 |
| D11 | The Members tables | Replace them with a pointer to the registry; keep them in sync by hand | Replace | The registry holds the same facts and is checked |
| D12 | Partial resets | Typed id lists with today's membership; sections in the registry; unchanged code | Id lists | No behavior change, and no second copy of a reset |
| D13 | Triggering "Delete all data" in QA | A bridge verb; importing the module in the stage window; clicking the Data page | A bridge verb | Reliable, dev-only, and CM4 will need the same check |
| D14 | The `outbox` mount | Register it; delete it | Register | It is upstream's mount; deleting it is a sync conflict for no gain |
| D15 | Legacy keys | Register and sweep them, and fail on a write to one; ignore them | Register | The orphan analytics key and the old sticker database survive "Delete all data" today |
| D16 | Home of the static scan | `scripts/dev-tools` with a verify guard; a stage-ui Node test with wider Turbo inputs | `dev-tools` | Root tooling may read the whole repository; the verify guard already exists for docs |
| D17 | Record the decisions | An ADR; the plan only | An ADR | The registry is a lasting design; the plan is history |

## Blocked: needs the owner

- **Analytics SDK storage.** PostHog and OpenPanel keep their own localStorage entries and cookies when an analytics build loads them. S does not register them: their keys are not visible in the fork's source, no default build loads them, and the ledger's open question on the analytics endpoints decides whether they stay. Done-when reads "every persisted renderer key is registered" with this exception named in `state-persistence.md`.

## Must not do

- Do not change any storage key, stored shape, IndexedDB database or object store name, unstorage mount, or OPFS layout.
- Do not move a store to another tier (Target rule 3), merge behavior settings (rule 4, CM7), or move pacing memory into the per-card record (rule 5, CM4).
- Do not edit the Kept files `artistry.ts`, `home-assistant.ts`, or `trace-timeline.vue`; register them from the registry.
- Do not call `clear()` on the `device` mount or the root storage; sweep by prefix.
- Do not register main-process files, and do not change `storedDataDeleteActivity` or the perf retention.
- Do not add a compatibility guard. The existing `// NOTICE:` moves stay as they are.
- Do not edit `inner-state.ts`, `stores/situation/index.ts`, or `chat.ts`.
- Do not edit the body of an existing ADR, or any locale.
- Do not commit a model path or any other local path; use the `AIRI_QA_*` variables.

## Done when

State persistence Target rules 1, 2, and 6 are in the current sections of `state-persistence.md`; every persisted renderer key that the client writes is registered, with the exceptions of section 3.5 and [Blocked](#blocked-needs-the-owner) named in the doc; "Delete all data" runs every registration, and the runtime test proves that it leaves no registered location holding data; the static scan fails on an unregistered write and on a second writer; the four documents are built on `useSettingsDocument` with unchanged keys; the main-process records stay with `storedDataDeleteActivity`, and perf records are a named exception; and every check in section 8 passes.

## Departures during implementation

## Checks run

## Commits
