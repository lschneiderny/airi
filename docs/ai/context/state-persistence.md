# State persistence

This file describes the code on `main`. A change that makes a statement here false updates this file in the same commit. These rules state where client state lives and how to place new state. These rules win over the ADRs in `docs/ai/adr/`; the ADRs record the history behind them.

Terms follow the [domain glossary](glossary.md), in particular [Leader and follower windows](glossary.md#leader-and-follower-windows) and [Synced settings document](glossary.md#synced-settings-document). Code is cited by repository path and exported symbol.

## Choosing a tier

Choose the first [tier](glossary.md#persistence-tier) that fits the state. A store that persists anything is registered with `useDataMaintenance` (`packages/stage-ui/src/composables/use-data-maintenance.ts`) in the same commit, so "Delete all data" reaches it.

| # | State | Tier |
| --- | --- | --- |
| 1 | A user-facing settings document for one feature | **Synced settings document.** One Valibot-validated document in a synced Pinia store, persisted privately with `listenToStorageChanges: false` and `writeDefaults: false`. Its `update` and `reset` actions are leader-routed, so follower windows never write storage. Build new documents on `useSettingsDocument` (`packages/stage-shared/src/composables/use-settings-document/index.ts`). |
| 2 | Leader-only state that must survive a reload but must not replicate, because it holds personal content or grows with every save | **localStorage by explicit command with a leadership token.** The leader claims a token, and every write carries it; a write over a newer save is refused. Clearing it is leader-routed. |
| 3 | A document per display model that the stage writes | **localStorage keyed by model id.** The stage window writes; other windows send commands. "Delete all data" removes the keys by prefix. |
| 4 | Many records or large records | **IndexedDB**, behind a synced store with leader-routed actions when other windows need the records. |
| 5 | Runtime state that another window reads, not persisted | **Synced Pinia memory.** Replicate values, never events, because an event stored in replicated state is replayed with every snapshot. Do not replicate a value that a producer samples periodically unless another window consumes it. |
| 6 | Sensor samples and the leader's observations | **Per-window memory**, unsynced and not persisted. |

Two tiers are closed to new state:

- **Plain localStorage refs** (`useLocalStorageManualReset` or `useLocalStorage` from `@vueuse/core`). This is the upstream convention, and most stores in [Members](#members) still use it. New settings use tier 1.
- **A main-process ring with disk recording.** It stays specific to the IO trace hub. Use it only for diagnostics that must outlive a renderer.

A store that fits no tier needs an amendment to this document before it lands.

## Members

The table lists every persisting store and component found in the `src` directories of the workspace packages and in `apps/stage-tamagotchi/src` with the inventory search under [Uses of the search terms that persist nothing](#uses-of-the-search-terms-that-persist-nothing).

Column meanings:

- **Tier**: a number from [Choosing a tier](#choosing-a-tier), or "plain" for the closed plain-ref tier.
- **Writer**: "leader" means only leader-routed actions write storage. "Any window (replicated)" means the persisted refs are synced store state, so every window that holds the store writes the committed value it receives. "Any window" means the store is not synced, and each window writes its own copy.
- **Registered**: whether `useDataMaintenance` resets the store. "Partly" means some of its keys survive.

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
| `chatAssetsRepo` (`packages/stage-ui/src/database/repos/chat-assets.repo.ts`), written by `storeChatAsset` (`packages/stage-ui/src/libs/chat-assets.ts`) | localforage `airi-chat-assets` / `assets` | 4 | the window saving a chat session | yes, released with each deleted session |
| `useMemoryStore` (`packages/stage-ui/src/stores/memory.ts`) through `memoryRepo` (`packages/stage-ui/src/database/repos/memory.repo.ts`) | localforage `airi-memory` / `entries`; key `memory/enabled` | 4 (named exception); plain for `memory/enabled` | any window | yes |
| `useCharacterStateStore` (`packages/stage-ui/src/stores/character-state.ts`) through `characterStateRepo` (`packages/stage-ui/src/database/repos/character-state.repo.ts`) | localforage `airi-character-state` / `cards` | 4 | leader | yes |
| `useDisplayModelsStore` (`packages/stage-ui/src/stores/display-models.ts`) | default localforage database, one item per model id | 4 | any window | yes |
| `useBackgroundStore` (`packages/stage-ui/src/stores/background.ts`) | default localforage database, items prefixed `bg-` | 4 | any window | no |
| `useStickersStore` (`packages/stage-ui/src/stores/modules/stickers.ts`) through `stickersRepo` (`packages/stage-ui/src/database/repos/stickers.repo.ts`) | localforage `airi-stickers` / `entries` and `images`; keys `settings/stickers/*` | 4; plain for the settings keys | any window | no |

### Synced stores with plain refs

| Store | Keys | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useOnboardingStore` (`packages/stage-ui/src/stores/onboarding.ts`) | `onboarding/completed`, `onboarding/skipped` | plain | leader | yes |
| `useConsciousnessSettingsStore` (`packages/stage-ui/src/stores/modules/consciousness-settings.ts`) | `settings/consciousness/<setting>` | plain | leader | yes |
| `useProviderConfigStore` (`packages/stage-ui/src/stores/providers/config.ts`), reset through `useProviderStore` (`packages/stage-ui/src/stores/providers/provider.ts`) | `settings/providers/configured`, `settings/providers/added`, `settings/credentials/providers` | plain | any window (replicated) | yes |
| `useAiriCardStore` (`packages/stage-ui/src/stores/modules/airi-card.ts`) | `airi-cards`, `airi-card-active-id`, `airi-card-module-defaults` | plain | any window (replicated) | yes |
| `useConsciousnessStore` (`packages/stage-ui/src/stores/modules/consciousness.ts`) | `settings/consciousness/active-*`, temperature, top-p | plain | any window (replicated) | yes |
| `useHearingStore` (`packages/stage-ui/src/stores/modules/hearing.ts`) | `settings/hearing/*` | plain | any window (replicated) | yes |
| `useSpeechStore` (`packages/stage-ui/src/stores/modules/speech.ts`) | `settings/speech/*` except `output-muted` | plain | any window (replicated) | yes |
| `useSettingsStageModel` (`packages/stage-ui/src/stores/settings/stage-model.ts`) | `settings/stage/model` | plain | any window (replicated) | yes |
| `useVisionStore` (`packages/stage-ui/src/stores/modules/vision/store.ts`) | `settings/vision/*` except `capture-interval-ms` | plain | any window (replicated) | no |
| `useArtistryStore` (`packages/stage-ui/src/stores/modules/artistry.ts`) | `artistry-*` | plain | any window (replicated) | no |

### Unsynced stores with plain refs

| Store | Keys | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useSettingsGeneral` (`packages/stage-ui/src/stores/settings/general.ts`) | `settings/language`, `settings/streamer-mode`, `settings/disable-transitions`, `settings/use-page-specific-transitions`, `settings/websocket/secure-enabled` | plain | any window | yes, through `useSettings` |
| `useSettingsAnalytics` (`packages/stage-ui/src/stores/settings/analytics.ts`) | `settings/analytics/enabled` | plain | any window | yes, through `useSettings` |
| `useSettingsControlsIsland` (`packages/stage-ui/src/stores/settings/controls-island.ts`) | `settings/allow-visible-on-all-workspaces`, `settings/always-on-top`, `settings/controls-island/icon-size` | plain | any window | yes, through `useSettings` |
| `useSettingsDeveloper` (`packages/stage-ui/src/stores/settings/developer.ts`) | `settings/developer/inspect-updater-diagnostics` | plain | any window | yes, through `useSettings` |
| `useSettingsTheme` (`packages/stage-ui/src/stores/settings/theme.ts`) | `settings/theme/colors/*` | plain | any window | yes, through `useSettings` |
| `useSettingsSpine` (`packages/stage-ui/src/stores/settings/spine.ts`) | `settings/spine/premultiplied-alpha`, `default-mix`, `idle-enabled`, `max-fps`, `render-scale` | plain | any window | yes, through `useSettings` |
| `useTachie` (`packages/stage-ui-tachie/src/stores/tachie.ts`) | `settings/tachie/*` | plain | any window | yes, through `useSettings` |
| `useSettingsAudioDevice` (`packages/stage-ui/src/stores/settings/audio-device.ts`) | `settings/audio/input*` | plain | any window | yes |
| `useSettingsBeatSync` (`packages/stage-ui/src/stores/settings/beat-sync.ts`) | `settings/beat-sync/parameters`, `settings/beat-sync/spectrum-scale` | plain | any window | no |
| `useSettingsScreenAmbientLight` (`packages/stage-shared/src/stores/screen-ambient-light.ts`) | `settings/screen-ambient-light/*` | plain | any window | yes |
| `useSettingsLive2d` (`packages/stage-ui-live2d/src/composables/live2d/live2d.ts`) | `settings/live2d/*` driver, tracking, idle, blink, expression, shadow, FPS, and render-scale keys | plain | any window | yes |
| `useLive2dParams` (`packages/stage-ui-live2d/src/stores/model-parameters.ts`) | `settings/live2d/current-motion`, `available-motions`, `motion-map`, `parameters` | plain | any window | yes |
| `useL2dViewControl` (`packages/stage-ui-live2d/src/stores/view-control.ts`) | `settings/live2d/scale`, `settings/live2d/position` | plain | any window | no |
| `useLive2DMotionMagicSettings` (`packages/stage-ui/src/features/motions/live2d/settings.ts`) | `settings/live2d/magic/*` | plain | any window | yes |
| `useMMD` (`packages/stage-ui-mmd/src/stores/mmd.ts`) | `settings/mmd/*`; imported motions as items in the default localforage database | plain; 4 for motions | any window | yes |
| `useMMDViewControl` (`packages/stage-ui-mmd/src/stores/view-control.ts`) | `settings/mmd/scale`, `settings/mmd/rotationY`, `settings/mmd/position` | plain | any window | yes, through `useMMD` |
| `useModelStore` (`packages/stage-ui-three/src/stores/model-store.ts`) | `settings/stage-ui-three/*` model, tracking, lighting, and render keys | plain | any window | partly |
| `useThreeCamera` (`packages/stage-ui-three/src/stores/camera.ts`) | `settings/stage-ui-three/cameraFOV`, `cameraDistance`, `camera-position` | plain | any window | partly, position only |
| `useThreeViewControl` (`packages/stage-ui-three/src/stores/view-control.ts`) | `settings/stage-ui-three/modelOffset` | plain | any window | yes, through `useModelStore` |
| `useSpine` (`packages/stage-ui-spine/src/stores/spine.ts`) | `settings/spine/*` animation, skin, variant, and speed keys | plain | any window | no |
| `useSpineViewControl` (`packages/stage-ui-spine/src/stores/view-control.ts`) | `settings/spine/scale`, `settings/spine/position` | plain | any window | no |
| `useHomeAssistantStore` (`packages/stage-ui/src/stores/modules/home-assistant.ts`) | `settings/home-assistant/*` | plain | any window | yes |
| `useWebSearchStore` (`packages/stage-ui/src/stores/modules/web-search.ts`) | `settings/web-search/*` | plain | any window | yes |
| `useDiscordStore` (`packages/stage-ui/src/stores/modules/discord.ts`) | `settings/discord/*` | plain | any window | yes |
| `createGamingModuleStore` (`packages/stage-ui/src/stores/modules/gaming-module-factory.ts`), used by `useMinecraftStore` and `useFactorioStore` | `settings/<module>/*` | plain | any window | yes |
| `useMcpStore` (`packages/stage-ui/src/stores/mcp.ts`) | `settings/mcp/*`, `mcp/connected` | plain | any window | yes |
| `useVisionProcessingStore` (`packages/stage-ui/src/stores/modules/vision/processing-store.ts`) | `settings/vision/capture-interval-ms` | plain | any window | no |
| `useModsServerChannelStore` (`packages/stage-ui/src/stores/mods/api/channel-server.ts`) | `settings/connection/websocket-url`, `settings/connection/websocket-auth-token` | plain | any window | no |
| `useSpeechOutputControlStore` (`packages/stage-ui/src/stores/speech-output-control.ts`) | `settings/speech/output-muted` | plain | any window | no |
| `useWakeWordsStore` (`packages/stage-ui/src/stores/wake-words.ts`) | `settings/voice/pronunciation-owners` | plain | any window | no |
| `useBackgroundStore` (`packages/stage-layouts/src/stores/background.ts`) | default localforage database, items prefixed `background-`; `settings/theme/background/*` | plain; 4 for images | any window | no |

### Desktop app stores and components

| Store or component | Keys | Tier | Writer | Registered |
| --- | --- | --- | --- | --- |
| `useLanguage` (`apps/stage-tamagotchi/src/renderer/composables/use-language.ts`) | `settings/language`, shared with `useSettingsGeneral` | plain | any window | yes, through the shared key |
| `useDanmakuFeedSettings` (`apps/stage-tamagotchi/src/renderer/composables/use-danmaku-feed-settings.ts`) | `chat-window/danmaku/*` | plain | any window | no |
| `apps/stage-tamagotchi/src/renderer/pages/chat-floating.vue` | `chat-window/danmaku/composer-folded` | plain | any window | no |
| `useControlsIslandStore` (`apps/stage-tamagotchi/src/renderer/stores/controls-island.ts`) | `controls-island/fade-on-hover-enabled`, `preferences/dont-show-it-again/notice/fade-on-hover` | plain | any window | no |
| `useServerChannelSettingsStore` (`apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts`) | `settings/server-channel/*` | plain | any window | no |
| `usePushToTalkShortcutSettings` (`apps/stage-tamagotchi/src/renderer/composables/use-push-to-talk-shortcut.ts`) | `settings/hearing/push-to-talk-shortcut`, `settings/hearing/push-to-talk-shortcut-error` | plain | any window | no |
| `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue`, `packages/stage-layouts/src/components/Widgets/ChatArea.vue`, `packages/stage-layouts/src/components/Widgets/ChatActionButtons.vue` | `ui/chat/settings/send-mode` | plain | any window | no |
| `packages/stage-ui/src/components/scenarios/chat/components/voice-composer.vue`, `packages/stage-ui/src/components/scenarios/chat/components/voice-input-button.vue` | `ui/chat/voice-mode` | plain | any window | no |
| `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` | `selected-runtime-motion`, `selected-runtime-motion-group`, `selected-runtime-motion-index` | plain | any window | no |

### Uses of the search terms that persist nothing

The inventory search was `git grep -nE 'useLocalStorageManualReset|useLocalStorage\(|useSettingsDocument|localforage|createStorage' -- 'packages/*/src/*' 'apps/stage-tamagotchi/src' ':!*.test.ts'`. The pathspec needs the trailing `/*`, because git matches a wildcard pathspec against the whole path. The following hits are not members:

- `useLocalStorageManualReset` (`packages/stage-shared/src/composables/use-local-storage-manual-reset/index.ts`) and `useSettingsDocument` (`packages/stage-shared/src/composables/use-settings-document/index.ts`) define the helpers.
- `storage` (`packages/stage-ui/src/database/storage.ts`) creates the unstorage instance. Its `local` mount backs the chat-session row above. Its `outbox` mount is listed under [Known gaps](#known-gaps).
- `packages/stage-ui/src/components/modules/WebSearch.vue` mentions the helper in a comment, and `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` holds commented-out localforage code.
- `packages/scenarios-stage-tamagotchi-electron/src/scenarios/display-model-from-file.ts` seeds the default localforage database of a test profile in a QA scenario.

Three other writers sit outside the stores. `migrateGoCredentials` (`apps/stage-tamagotchi/src/renderer/bridges/opencode-go-migration.ts`) rewrites provider keys once. The OpenPanel client (`packages/stage-ui/src/libs/product-signals/openpanel.ts`) keeps a device id in `sessionStorage`, which ends with the session. `useModelStore().resetModelStore` deletes a legacy model-source key.

## Settings documents

Six tier 1 stores and one helper exist:

- `useLive2DNaturalSettings` and `useMMDNaturalSettings` are built on `useSettingsDocument`. Each starts from the old per-setting [Natural](glossary.md#natural) keys while no document is stored, and its first leader-routed `update` or `reset` writes the document and deletes those keys. Each store's `// NOTICE:` block states when that import can be removed.
- `useSituationSettings`, `useExpressionPerformanceSettings`, `useHostNoticeSettings`, and `useConversationSettings` hand-roll the same code. Each calls `useLocalStorageManualReset` directly with `listenToStorageChanges: false` and `writeDefaults: false`, validates the document itself, and declares leader-routed `update` and `reset` actions. They can adopt `useSettingsDocument` without changing their keys.

New tier 1 stores use `useSettingsDocument`.

## Named exceptions

- **[Long-term memory](glossary.md#long-term-memory).** `useMemoryStore` is tier 4 data that any window may write, without leader routing or a lock. A write invalidates the other windows over the `airi:memory` BroadcastChannel. This is safe while only the leader runs chat turns, which are the only writers besides Settings.
- **The [gate](glossary.md#gate)'s inner state.** `settings/situation-inner` is the only tier 2 member. It holds the urge-gate memory and the conversation threads that the [situation](glossary.md#situation) extracts, which are personal and grow with every save, so it never replicates. `useSituationStore().forget` clears it in the leader.
- **Expression documents.** The Live2D and MMD expression stores write `expression-catalog:<id>` and `expression-rest:<id>` from the stage window, outside any store registration. `useDataMaintenance` clears them by prefix, including documents of models that are not loaded.
- **Chat assets.** `chatAssetsRepo` has no reset of its own. `chatSessionsRepo` releases a session's assets when it deletes the session, so deleting all chat sessions removes them.

## Known gaps

These are observations, not fixes. Each needs either a registration, a move to the right tier, or an amendment to this document.

**Persisting stores that `useDataMaintenance` does not reset:**

- Tier 1: `useConversationSettings`. It is also missing from the tier 1 member list in the persistence-tiers ADR.
- Tier 4: `useBackgroundStore` in stage-ui and `useStickersStore`, including their IndexedDB records.
- Synced plain refs: `useVisionStore` and `useArtistryStore`.
- Unsynced plain refs: `useSettingsBeatSync`, `useL2dViewControl`, `useSpine`, `useSpineViewControl`, `useVisionProcessingStore`, `useModsServerChannelStore`, `useSpeechOutputControlStore`, and `useWakeWordsStore`.
- Desktop app: `useDanmakuFeedSettings`, `useControlsIslandStore`, `useServerChannelSettingsStore`, `usePushToTalkShortcutSettings`, and the component-level keys `chat-window/danmaku/composer-folded`, `ui/chat/settings/send-mode`, `ui/chat/voice-mode`, and `selected-runtime-motion*`.
- Partial resets: `useModelStore().resetModelStore` resets the model, camera position, view offset, and tracking keys, but leaves the lighting, environment, render-scale, multisampling, and FPS keys and the `useThreeCamera` field of view and distance.

**Stores outside the tiers:**

- Synced stores that persist plain refs as replicated state (`useAiriCardStore`, `useConsciousnessStore`, `useHearingStore`, `useSpeechStore`, `useSettingsStageModel`, `useProviderConfigStore`, `useVisionStore`, and `useArtistryStore`) write storage from every window that receives a committed snapshot. Tier 1 forbids this for settings documents. These stores predate the tiers and are upstream code.
- The stage-layouts `useBackgroundStore` (`packages/stage-layouts/src/stores/background.ts`) shares the default localforage database with `useDisplayModelsStore`, the stage-ui `useBackgroundStore`, and `useMMD`, and separates its records only by key prefix. The desktop app does not render the stage-layouts background components that use it.
- The unstorage `outbox` mount (IndexedDB `airi-sync-queue`) in `storage` has no reader or writer in the client.
- `useLanguage` and `useSettingsGeneral` both own `settings/language`.

## References

- [Persistence tiers ADR](../adr/2026-11-01-persistence-tiers.md)
- [Layered character state ADR](../adr/2026-11-03-layered-character-state.md)
- [Long-term memory adoption ADR](../adr/2026-10-30-long-term-memory-adoption.md)
- [Unprompted reach-out cadence ADR](../adr/2026-10-29-unprompted-reach-out-cadence.md), which records the inner-state exception
- `packages/stage-ui/src/composables/use-data-maintenance.ts` `useDataMaintenance`
- `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument`
