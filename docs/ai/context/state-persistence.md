# State persistence

This file describes the code on `main`. A change that makes a statement here false updates this file in the same commit. These rules state where client state lives and how to place new state. These rules win over the ADRs in `docs/ai/adr/`; the ADRs record the history behind them.

Terms follow the [domain glossary](glossary.md), in particular [Leader and follower windows](glossary.md#leader-and-follower-windows) and [Synced settings document](glossary.md#synced-settings-document). Code is cited by repository path and exported symbol.

## Choosing a tier

Choose the first [tier](glossary.md#persistence-tier) that fits the state. A store that persists anything registers in the [state registry](#state-registry) in the same commit; "Delete all data" then reaches it.

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

**Caches.** A copy that the app can download or rebuild again is not a tier: the copies of imported Live2D and MMD models in the origin private file system, the Sherpaw model assets, and the Transformers.js Cache Storage `transformers-cache`. Each registers in the state registry with the tier `cache`. A cache does not hold the user's only copy: the imported model files stay in IndexedDB, and the other caches download again.

## Runtime replicated state

Tier 5 stores register with `pinia-plugin-synced` when they are created. They have
no persisted locations and do not register in `stateRegistry`, which owns
persisted renderer state.

`useStageExpressionCatalogStore` (`packages/stage-ui/src/stores/stage-expression-catalog.ts`,
store id `stage-expression-catalog`) holds the loaded display model id and mapped
expression entries (id, label, mappings), or `null` when no model is loaded.
`useStagePerformanceConductor` publishes the local Live2D or MMD catalog when it
changes and clears it on model unload or conductor disposal. Card editors in
other windows read the snapshot without loading a renderer or publishing it back.
No derived catalog is written to storage.

## State registry

`stateRegistry` (`packages/stage-ui/src/persistence/state-registry.ts`) declares every piece of persisted renderer state. Each `StateRegistration` names its owner, the files that write it, its tier, its locations, and an optional owner reset. A location is a localStorage key, key prefix, or per-model key; a sessionStorage key; an IndexedDB object store, optionally narrowed by a key prefix; an OPFS directory; or a Cache Storage cache. `resetRegisteredState` runs the owner reset of each registration in registry order, then removes everything its locations match. A registration marked `sweepFirst` is swept before its owner reset, because that reset saves a record the owner keeps using: the chat sessions' reset saves a new empty session and the chat index.

**One registration point.** "Delete all data" resets exactly the registered set. `useDataMaintenance().deleteAllData` (`packages/stage-ui/src/composables/use-data-maintenance.ts`) runs `resetRegisteredState` over every registration. Every registration runs even when an earlier one failed, and the first failure is thrown after the last one ran. Afterwards no registered location holds data, except two locations marked `kept`: the voiceprint deletion time, so that an enrollment started before the deletion still sees it, and the sticker library's copy marker (`migrated-from:airi-stickers`). The old `airi-stickers` database is deleted before the library is emptied; a connection that another copy left open can delay that deletion until it closes, and the kept marker stops the next read from copying the old stickers back or waiting behind the deletion meanwhile. The narrower actions of the Data settings page run fixed id lists: `deleteAllModels` runs `display-models`, which also clears the stage model selection; `deleteAllChatSessions` runs `chat-sessions` and `chat-assets`; `resetProvidersSettings` runs `provider-settings`; `resetModulesSettings` runs `modulesRegistrations`; and the desktop reset runs the settings and module registrations after it clears the stage model selection.

**Order.** Registry order is reset order. The voiceprints go first, so a failed step cannot keep them; the expression documents go before the display models, because removing the models loads the default model, which must start without a stored catalog; the chat sessions go before the situation's inner state; caches go last.

**One owner per key.** No two registrations claim the same storage. A store reads a key that another store owns without writing it. A file that writes a location is listed in the `writers` of its registration.

**Closed-tier enforcement.** The source scanner reads the literal `tier`, `upstream`, and `exception` from this same registration point. Active upstream plain state needs a pinned revision and exact keys or per-model keys; a broad prefix cannot grant permission to add another setting. Fork plain state is rejected, apart from the explicitly temporary S2 migration entries below. The scanner also rejects overlapping owners. A `perModel` location can be `legacy`: both its unscoped and model-scoped writes then fail, while removal remains legal. The two declared dynamic sites for consciousness options and the Factorio factory do not authorize an extra literal key; factory suffixes must match a declared member.

**A test enforces it.** Two focused tests fail when the client writes storage that no registration owns. `state-registry.browser.test.ts` watches every write while it creates and resets every owner, so it sees keys built at run time and the defaults that VueUse writes. `scripts/dev-tools/storage-writes.test.ts` reads the renderer source (`packages/*/src` and `apps/stage-tamagotchi/src/renderer`, without tests, stories, and the QA drivers) and checks every storage call site, so it sees writes in actions and components that no reset runs. The scan fails when a site's key matches no location, when a write matches a `legacy` location, and when the site's file is not among the `writers` of the registration that owns the key. It resolves a key through literals, template literals up to their first unresolved part, constants that the name's scope reaches or that a relative import names, loops over a key list, and arguments of a helper in the same file. A key that it cannot resolve needs an entry in the test's dynamic sites, which names the file, the registration, and the reason. An OPFS site is owned when its file writes a registration with an OPFS location. Neither test sees writes inside Web Workers or by libraries, cookies, or main-process files; the registrations of those are declared by hand.

To add persisted state:

1. Choose a tier with [Choosing a tier](#choosing-a-tier).
2. Add a registration to `stateRegistry` in the same commit. Write its locations and writers as literals. Use a prefix only for a key family that one owner holds whole; list exact keys when another owner writes under the same path. Mark a key that only an older release wrote as `legacy`.
3. Give it a `reset` when the owner keeps the state in memory: a synced store, which routes the reset to the leader, or a store with a `resetState`. Removing a localStorage key fires no `storage` event in the window that removes it, so without a reset that window keeps the old values and a later write saves them back. Leave it out when creating the store connects or loads; the sweep alone then resets the state. Mark it `sweepFirst` when the reset saves a record that the owner keeps using, so the sweep does not remove it.
4. Run `state-registry.browser.test.ts`, `use-data-maintenance.browser.test.ts`, and `pnpm exec vitest run --project dev-tools scripts/dev-tools/storage-writes.test.ts`. The first creates and resets every owner in a leader and a follower window, and fails on a write that no registration owns and on two registrations that claim the same storage. The second puts a marker into every registered location, runs "Delete all data", and fails on a location that still holds one.

The registry covers renderer storage only. Main-process files stay with `storedDataDeleteActivity`; see [Main-process files](#main-process-files).

## Members

`stateRegistry` is the list of members: each registration names its owner, tier, writers, and locations. A registration whose state is a named exception carries the heading in `exception`.

Plain upstream state declares `upstream: 'bd4f30391'`, the adopted revision that supplies its storage contract. The declaration covers only the listed writers and exact keys, including explicitly listed per-model keys. A changed fork default does not transfer ownership of the upstream storage contract. These declarations do not make replicated plain refs single-writer: upstream's seven synced plain-ref stores still persist snapshots in every window.

Mixed owners have separate registrations for their repositories and settings: `memory-settings`, `recipe-settings`, `layout-background-settings`, `sticker-settings`, and `mmd-motion-files`. Memory and recipes reset their live toggles with their preceding repository reset; the settings registrations only sweep. MMD runs its upstream reset once before the motion-file and derived-metadata sweeps. Its realisation document has its own leader-routed reset. Background and sticker settings remain sweep-only because constructing those owners loads their libraries. Partial module and desktop resets include the corresponding split registrations.

### Per-model display settings

Upstream stores the display-model settings of five renderers once for each model. The fork follows it. The fork's MMD motion driver now lives in its leader-owned realisation document; derived clip metadata still uses the old per-model ref until the next S2 increment.

- `useModelScopedLocalStorage` and `useModelScopedLocalStorageManualReset` (`packages/stage-shared/src/composables/use-model-scoped-local-storage/index.ts`) declare a setting with a scope (`DisplayModelSettingsScope`: `live2d`, `three`, `mmd`, `spine`, or `tachie`) and the key that older releases used.
- `modelScopedStorageKey` in the same file builds the stored key: `settings/models/<model id>/` followed by the old key without its `settings/` prefix. `settings/live2d/scale` of model `m1` is stored at `settings/models/m1/live2d/scale`.
- `useSettingsStageModel` calls `setActiveDisplayModelForSettings` before a renderer receives a model. While a scope has no active model, its settings read and write the old unscoped key.
- The first model that becomes active takes the value stored at the unscoped key, and that key is removed. Each later model starts from the default, which is written at once. The `// NOTICE:` block in the helper states when this move can be removed.
- `removeDisplayModelSettings` removes every key of one model. `useDisplayModelsStore` calls it when a model is deleted and for every imported model in `resetDisplayModels`.
- A `reset()` or `resetState()` of a per-model ref resets the value of the active model only. The registry declares each per-model setting as a `perModel` location, so "Delete all data" removes its value for every model.

Upstream device settings stay global: frame-rate limits, render scales, multisampling, and the two Live2D auto-blink keys. The fork's MMD realisation document holds stage character height and roam mode globally, and explicit model-id maps for drivers, stance slots, and clip curation.

### Writers outside the stores

Writers that only move or remove old keys sit outside the stores. `migrateGoCredentials` (`apps/stage-tamagotchi/src/renderer/bridges/opencode-go-migration.ts`) rewrites provider keys once. `removeRetiredAccountCredentials` (`packages/stage-ui/src/libs/retired-account.ts`) removes the `auth/v1/*` keys of the retired account service. `useModelStore().resetModelStore` deletes a legacy model-source key. Five stores move data that an older release stored elsewhere, each under a `// NOTICE:` block with its removal condition: `useOnboardingStore` replaces `onboarding/completed` and `onboarding/skipped` with step records, `useAiriCardStore` moves `airi-card-module-defaults` into the module stores and `settings/stage/model` into the active card, `useMemoryStore` moves `memory/entries` and `useRecipesStore` moves `recipes/custom` from localStorage to IndexedDB, and `useVoiceprintStore` moves `settings/voice/voiceprint` into the list at `settings/voice/voiceprints`.

A [character state](glossary.md#character-state) record (`CharacterStateRecordV1` in `packages/stage-shared/src/character-state/types.ts`) holds one card's mood, temperament, relationship, daily history, applied event ids, and her pacing memory (`pacing`: last-spoke time, unanswered openings, the reply wait, the damping, and the own-day mark). `useCharacterStateStore` loads and saves it in the leader. Its `recordPacing` writes `pacing` and drops a write whose card or `leaderEpoch` is stale.

### The mind's slow state

The [character mind](glossary.md#character-mind)'s slow state is the per-card character state. The tier 4 record holds mood, energy, learned temperament, relationship, and her own pacing memory (last-spoke time, unanswered openings, the reply wait, the damping, the own-day mark). The floor after any spoken line, the hourly cap, and the ritual day are per user across characters and stay in the user's gate state. Fast state is not persisted.

- Only the leader reads and writes the record. The leader advances the record on load, and the mind normalizes her pacing at its first tick (`restoreGateMemory` in `packages/stage-shared/src/situation/urge-gate.ts`).
- `useCharacterMindStore` (`packages/stage-ui/src/stores/character-mind.ts`) resets the mind to the record's `pacing` at each promotion and whenever `leaderEpoch` changes: a card switch, an import over the active card, a forget, and "Delete all data". It writes `MindState.slow.pacing` back with `recordPacing` whenever the mind replaces that object. The store persists nothing itself and is not registered.
- A mind that never spoke as a card keeps `pacing` `null`, so a record that "Delete all data" reset stays unsaved.
- The user's slice (`SavedGateMemory`: the floor's last fire and the ritual day) is saved in the gate's inner state, and the hourly cap's fires restart at each launch. A card switch carries the floor, the fires, and the ritual day to the reloaded mind through the situation store's `VoiceRun.user`.

A card leaves the device in one of two packages (`exportAiriCardPackage` in `packages/stage-ui/src/services/airi-card-import-export.ts`). A share carries the card and its profile (`CharacterProfile`) and its display model only; it never carries the card's memories or its character-state record, and its import starts the record fresh from the profile. A backup carries the card, its own memories, and the whole record, pacing included, and its import restores them.

A chat session record stores no system message: each request composes it. A session record names one character, and `characterMembersOfMeta` (`packages/stage-ui/src/stores/chat/session-members.ts`) derives the session's character members from it.

### Main-process files

The desktop app's main process writes files under the Electron user data directory, outside the renderer stores. The state registry does not register them. The Data settings page (`apps/stage-tamagotchi/src/renderer/pages/settings/data/index.vue`) passes `deleteHostData` to the shared danger section, which runs it after `deleteAllData`, also when `deleteAllData` failed, and then reports the first failure. It clears the Home Assistant address and token through `homeAssistantSetConfig`, resets the desktop server channel's address and TLS switch and replaces its token through `electronApplyServerChannelConfig` (an empty token makes the main process generate a new one, and the window's `useServerChannelSettingsStore` then reads the new config), removes every OpenCode Go key through `goClearConfigurations`, which deletes `opencode-go-v1.json`, and invokes `storedDataDeleteActivity`, whose handler `setupStoredData` (`apps/stage-tamagotchi/src/main/services/airi/stored-data/index.ts`) removes earlier session logs, empties the open one, removes the IO traces, and clears the computer-use store through its owner.

- Session logs older than `LOG_RETENTION_MS` (14 days) are removed at every start (`pruneExpiredLogs` in `apps/stage-tamagotchi/src/main/app/file-logger.ts`).
- Main-process settings files stay: window state, the image-generation options, `mcp.json`, and the app options file of `createGlobalAppConfig` (`apps/stage-tamagotchi/src/main/configs/global.ts`), which holds the update channel and `errorReportingEnabled`. The renderer mirrors its analytics opt-in into `errorReportingEnabled` through `electronErrorReportingSet`, and an absent value means off.
- The `sherpaw-model-assets` registration's reset calls `clearSherpawModelAssets` (`packages/stage-ui/src/libs/providers/providers/sherpaw/model-assets.ts`), which in the desktop app also reaches the downloaded Sherpaw model assets that the main process keeps.

## Settings documents

Eight tier 1 stores and one helper exist:

- `useLive2DNaturalSettings` and `useMMDNaturalSettings` are built on `useSettingsDocument`. Each starts from the old per-setting [Natural](glossary.md#natural) keys while no document is stored, and its first leader-routed `update` or `reset` writes the document and deletes those keys. Each store's `// NOTICE:` block states when that import can be removed.
- `useSituationSettings`, `useConversationSettings`, and `useHostNoticeSettings` are built on `useSettingsDocument` with their original keys and stored shapes. `useHostNoticeSettings` declares the leader-routed actions `dismiss` and `reset`.
- `useExpressionPerformanceSettings` is built on `useSettingsDocument` with its original key and stored shape. Its `update` merges a patch at every depth, with arrays replaced, before the helper validates it. Its `upgrade` option strips removed stored fields under `// NOTICE:` blocks that state their removal conditions.
- `useSettingsAnalytics` owns `settings/analytics`, with validated `optedIn` defaulting to false. The leader's startup `initialize`, `update`, and `reset` actions await the main-process consent mirror even in builds without an analytics SDK or DSN. The mirror is a derived copy for reporting before renderer startup, not another user setting. Followers neither save nor mirror snapshots. The one-time import reads only explicit `settings/analytics/opted-in`; upstream's old `settings/analytics/enabled` never counts as consent. A new document wins, and both old keys are removed only after an acknowledged document save. Reset writes false and removes the old keys.

- `useMMDPerformanceSettings` owns `settings/mmd/performance`: per-model drivers, stance slots and clip curation, plus stage character height and roam mode. The leader initializes the document before the stage loads. It imports every old model driver, including inactive models, and the four old global fields; a new document always wins. A valid old unscoped driver is saved as `unassignedMotionDriver` until `selectModel` claims it for the first model without a scoped choice. The claim and old-key cleanup follow acknowledged saves. Curation and stance edits merge into the leader's current model maps, and curation actions reject duplicate labels and clear permissions for stance/unusable kinds. Model deletion removes only that model's entries. Reset ignores imports and clears every old key. These are realisation settings; CM7c still owns the character-behavior document.

All eight stores are built on `useSettingsDocument`, and new tier 1 stores use it too. The helper observes VueUse's synchronous persistence error callback and rejects a failed save before publishing the document; a migration must await that acknowledgment before removing old keys. `upgrade` rewrites a stored document before its fields are validated; use it only for a `// NOTICE:` fallback that removes or renames stored fields.

## Named exceptions

- **Legacy sweep only.** Retired account credentials and old Minecraft settings have no current durable writer. Their plain registration exists only to delete old data.
- **Session diagnostics.** The OpenPanel device id and IO trace source id live in sessionStorage for one window lifetime. They are registered for deletion and are not durable settings or pure memory.
- **Fork state awaiting S2 migration.** Derived MMD clip metadata retains its current keys until S2 replaces it with runtime memory. This is the last temporary plain-state exception.

- **[Long-term memory](glossary.md#long-term-memory).** `useMemoryStore` is tier 4 data that any window may write, without leader routing. `memoryRepo` serializes writes with the `airi:memory` Web Lock, and a write invalidates the other windows over the `airi:memory` BroadcastChannel. This is safe while only the leader runs chat turns, which are the only writers besides Settings. A chat turn's write never stores a window or page title that the situation holds, unless the user stated it in the same turn, and never a credential shape (`memoryWriteRefusal` in `packages/stage-ui/src/tools/memory.ts`).
- **The [gate](glossary.md#gate)'s inner state.** `settings/situation-inner` is the only tier 2 member. It holds the user's slice of the urge-gate memory (the floor's last fire and the ritual day, `SavedGateMemory`) and the conversation threads that the [situation](glossary.md#situation) extracts. It holds no pacing of hers; that is in the card's character-state record (see [The mind's slow state](#the-minds-slow-state)). The leader writes the user's slice from what the [character mind](glossary.md#character-mind) publishes (`publishVoice`), without the mind's random state. Both are personal and grow with every save, so the slice never replicates. A thread whose text repeats a window or page title that the situation holds is dropped before it is stored (`createThreadExtractor` in `packages/stage-ui/src/features/situation/thread-extraction.ts`). `useSituationStore().forget` clears it in the leader. The slice holds no pacing of spoken [touch reactions](glossary.md#touch-reaction): `SavedInnerState` has no `reaction` field. That pacing is state of the [character mind](glossary.md#character-mind) (`voice` in `MindState`, `packages/character-mind/src/types.ts`), which is not saved and starts over at each launch.
- **[Recipes](glossary.md#recipe).** `useRecipesStore` follows the long-term memory pattern: tier 4 data that any window may write, with the `airi:recipes` Web Lock in `recipesRepo` and the `airi:recipes` BroadcastChannel. A model proposal is stored unapproved and disabled until the owner approves it.
- **Voiceprints.** `useVoiceprintStore` keeps voiceprints in plain localStorage, because upstream ships it so. A voiceprint identifies a person, so the `voiceprints` registration runs first in "Delete all data".
- **Expression documents.** The Live2D and MMD expression stores write `expression-catalog:<id>` and `expression-rest:<id>` from the stage window, outside any Pinia store. The `expression-documents` registration sweeps them by prefix, including documents of models that are not loaded.
- **Perf records.** The desktop app's perf records keep their own 14-day retention in the main process, and "Delete all data" does not delete them.
- **Analytics SDK storage.** PostHog and OpenPanel keep their own localStorage entries and cookies when an analytics build loads them. The registry does not register them: their keys are not in the fork's source, and no default build loads them.
- **Chat assets.** `chatAssetsRepo` has no reset of its own. `chatSessionsRepo` releases a session's assets when it deletes the session, and the `chat-assets` registration sweeps the store with the chat sessions.

## Target

This section states the design that refactors move toward. It does not describe the code. The [character mind ADR](../adr/2026-11-17-character-mind-direction.md) records the decision. When a refactor lands a rule, the rule moves into the sections above and the gaps it closes leave the list below.

3. **Every store fits a tier.** Plain localStorage refs and synced stores that persist replicated plain refs migrate to a tier where the fork owns them. Upstream's stores keep upstream's keys and are registered as they are. The closed tiers stay closed.
4. **Behavior settings form one document.** The character-behavior settings that the [character mind](glossary.md#character-mind) reads are one tier 1 document. Renderer settings documents hold only realisation settings.

| Known gap | Closed by |
| --- | --- |
| Synced stores that persist plain refs as replicated state | Rule 3 |

## Known gaps

These are observations, not fixes. Each needs either a registration, a move to the right tier, or an amendment to this document.

**Stores outside the tiers:**

- Synced stores that persist plain refs as replicated state (`useAiriCardStore`, `useConsciousnessStore`, `useHearingStore`, `useSpeechStore`, `useProviderConfigStore`, `useVisionStore`, and `useArtistryStore`) write storage from every window that receives a committed snapshot. Tier 1 forbids this for settings documents. These stores predate the tiers and are upstream code.
- The stage-layouts `useBackgroundStore` (`packages/stage-layouts/src/stores/background.ts`) shares the `device` mount with `useDisplayModelsStore` and the stage-ui `useBackgroundStore`, and `useMMD` opens the same database through its own unstorage instance. The records are separated only by key prefix. The desktop app does not render the stage-layouts background components that use it.
- The unstorage `outbox` mount (`keyval-store`, keys prefixed `airi-sync-queue:`) in `storage` has no reader or writer in the client. The `outbox` registration sweeps it.
- Onboarding step records, the active card id, the consciousness request settings, and the saved tool cards are written with direct `localStorage` calls from synced actions. The leader is the only writer, but none of them is a tier 1 document or carries the tier 2 leadership token.
- Per-model display settings are plain refs keyed by model id that any window writes, so they are not tier 3.

**Data that leaves the device:**

- Fork source still names upstream's analytics services: `OPENPANEL_CONFIG` (`packages/stage-shared/src/analytics/openpanel.ts`) and `DEFAULT_POSTHOG_CONFIG` with `POSTHOG_PROJECT_KEY` (`packages/stage-shared/src/analytics/posthog.ts`). Capture needs a build with `VITE_ENABLE_ANALYTICS` set and the opt-in, which defaults to off; such a fork build would send product events to upstream's projects. Error reports are already off unless the build sets its own DSN (`errorReportSourceFromEnv`).

## References

- [Persistence tiers ADR](../adr/2026-11-01-persistence-tiers.md)
- [Layered character state ADR](../adr/2026-11-03-layered-character-state.md)
- [Long-term memory adoption ADR](../adr/2026-10-30-long-term-memory-adoption.md)
- [Unprompted reach-out cadence ADR](../adr/2026-10-29-unprompted-reach-out-cadence.md), which records the inner-state exception
- `packages/stage-ui/src/persistence/state-registry.ts` `stateRegistry`, `resetRegisteredState`
- `packages/stage-ui/src/composables/use-data-maintenance.ts` `useDataMaintenance`
- `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument`
