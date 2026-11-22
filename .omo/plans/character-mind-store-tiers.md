# character-mind-store-tiers - Work Plan

Status: implementation complete on 2026-11-22; worker checks passed and orchestrator rendered/gate acceptance remains explicitly pending. Started from `6e223c22b` plus plan commit `819043291`, against adopted upstream `bd4f30391`. The owner's standing preference is to take the recommended options. This is slice **S2**, paired with [character-mind-notify-touch.md](character-mind-notify-touch.md); roadmap row S2 records implementation completion and the remaining orchestrator acceptance.

Implementation branch: **`luke/refactor/character-mind-store-tiers`**. Depends on completed roadmap S and the upstream sync. It does not depend on CM8's upstream-driver decision. Coordinate shared MMD consumers with CM7a/c, but do not implement their capability or behavior-document work.

## TL;DR (For humans)

State persistence Target rule 3 says to migrate plain refs **where the fork owns them**, while upstream stores keep their keys and registrations. The inventory confirms that all seven named replicated-plain-ref stores and the direct-write onboarding/consciousness/tool-card/active-card cases already exist upstream. They remain registered exceptions; moving them all to tier 1 would contradict the rule.

Migrate the fork's analytics consent to a validated tier 1 document and make its main-process mirror explicit. Move the five durable fork MMD settings out of the upstream `useMMD` store into one tier 1 realisation document, and move derived clip metadata into tier 5 memory. Keep upstream settings, model files, device keys, and already-correct fork documents where they are. Strengthen the registry's ownership declaration so a new fork plain ref cannot enter under an upstream prefix unnoticed.

This slice closes rule 3 **for fork-owned state**. It does not make upstream's replicated persistence safe by renaming its tier. The remaining upstream limitation stays visible in current policy.

## 1. Upstream first

The sync through `bd4f30391` is in this branch's ancestry. Source provenance was checked with `git show bd4f30391:<writer>` for the registry's localStorage writers and compared with current source call sites. The inventory includes component/composable refs and mixed tier 4 registrations, not only `stores/`.

| Upstream has | Treatment |
| --- | --- |
| `useLocalStorageManualReset`, `useModelScopedLocalStorage`, and versioned plain refs | Keep their semantics for upstream callers. Do not convert a shared helper globally. |
| Seven synced stores whose committed snapshots update persisted refs | Keep their keys and persistence behavior as upstream; declare the precise exception. `listenToStorageChanges: false` does not stop each replica's storage watcher from writing. |
| Direct commands for onboarding, active card id, consciousness options, and saved tool cards | Keep their upstream formats/actions. Leader routing alone does not make them tier 1 or tier 2. |
| Per-model display settings in five renderer scopes | Keep every upstream key and the existing first-model carry-over. These remain plain, not tier 3. |
| Analytics `settings/analytics/enabled`, default true | The fork already replaced it with consent-only `settings/analytics/opted-in`, default false. That fork-owned departure is the part migrated here. Never import the old enabled=true as consent. |
| MMD display/physics/lighting/clip-file settings | Keep upstream values and keys. Only fork additions named in section 3 move. |

The seven upstream stores live in supported packages, but Target rule 3 explicitly excludes rewriting their persistence. The README's kept projects are additionally out of scope. This plan changes no service/backend/kept-agent project.

## 2. Today's code and findings

### 2.1 Inventory convention

The tables below are exhaustive by existing `stateRegistry` owner/location family at the evidence revision. A comma-separated suffix list enumerates keys under the shown prefix. `perModel(K)` means both old unscoped `K` and `settings/models/<model id>/` plus `K` without `settings/`, exactly as `modelScopedStorageKey` implements it. Existing registry `legacy`/`kept` flags remain unless a row explicitly changes them.

For every row marked **U**, the target is the **existing registered upstream exception**, not a new tier. Keys and serialized bytes stay unchanged, and **there is no S2 carry-over** because the same owner continues reading them. Existing upstream migrations keep running as shipped. This is the storage-key and migration decision for each U row, not deferred investigation.

For **F**, the fork owns the listed state; section 3 gives its target, key, carry-over, and registry entry. **Mixed** means ownership is determined per field/key, not by whether the file has any fork edits. A changed default, privacy filter, or account-removal edit does not turn the rest of an upstream store into fork-owned state.

### 2.2 The seven synced plain-ref stores, verified in code

| Registry id / owner / writer | Existing keys | Ownership, target, and carry-over |
| --- | --- | --- |
| `airi-cards` / `useAiriCardStore` / `packages/stage-ui/src/stores/modules/airi-card.ts` | `airi-cards` is a persisted Map with `listenToStorageChanges: false`; `airi-card-active-id` is a direct command write. Legacy `airi-card-module-defaults`, `settings/stage/model`. | U, keep `plain`. `synced.state: true` replicates cards. Do not move to IndexedDB or duplicate the active id. Keep existing module-default/model migration. |
| `consciousness` / `useConsciousnessStore` / `packages/stage-ui/src/stores/modules/consciousness.ts` | `settings/consciousness/{active-provider,active-model,active-custom-model,active-temperature,active-top-p}` | U, keep `plain`; persisted refs plus `synced.state: true`. |
| `hearing` / `useHearingStore` / `packages/stage-ui/src/stores/modules/hearing.ts` | `settings/hearing/{enabled,active-provider,active-model,active-custom-model,input-mode,auto-send-enabled,auto-send-delay,confidence-threshold,rephrase-enabled,end-judge-enabled,speaker-recognition-enabled,rephrase-provider,rephrase-model}` | U, keep `plain`; `clearUnavailableProviderSelection` is routed, but the replicated refs still persist. The shortcut keys belong to another row. |
| `speech` / `useSpeechStore` / `packages/stage-ui/src/stores/modules/speech.ts` | `settings/speech/{active-provider,active-model,voice,enabled,ssml-enabled,pitch,rate}` | U, keep `plain`; multiple routed selection/catalog actions do not remove replica writes. Separate voice-catalog runtime store is tier 5 and stays so. |
| `provider-settings` / `useProviderConfigStore` / `packages/stage-ui/src/stores/providers/config.ts` | `settings/providers/{configured,added}`, `settings/credentials/providers` | U with existing account-free departure, keep `plain`. Do not restore upstream `pending-deletes` or account sync. `opencode-go-migration.ts` remains a registered existing migration writer. |
| `vision` / `useVisionStore` / `packages/stage-ui/src/stores/modules/vision/store.ts` | `settings/vision/{enabled,active-provider,active-model,active-custom-model,ollama-thinking-enabled,use-for-chat,use-for-tool-images}` | U, keep `plain`; `selectProvider` routes, `state: true` still persists replicated refs. |
| `artistry` / `useArtistryStore` / `packages/stage-ui/src/stores/modules/artistry.ts` | `artistry-{provider,model,prompt-prefix,provider-options,comfyui-server-url,comfyui-saved-workflows,comfyui-active-workflow,replicate-api-key,replicate-default-model,replicate-aspect-ratio,replicate-inference-steps,nanobanana-api-key,nanobanana-model,nanobanana-resolution}` | U, keep `plain`, including credentials. Transient active overrides stay runtime. Do not rewrite its provider contracts as part of persistence. |

Each uses plain refs and `synced.state: true`. None is repaired merely by setting `listenToStorageChanges: false`, which most already do. The plan intentionally does not promise zero follower writes for these U rows.

### 2.3 Other upstream module, feature, and component refs

All rows here are **U** with the no-migration decision in section 2.1. Registry ids are stable and continue owning the exact current locations.

| Registry id / owner | Writer path | Existing key plan / target |
| --- | --- | --- |
| `voiceprints` / `useVoiceprintStore` | `packages/stage-ui/src/stores/voiceprint.ts` | Keep `settings/voice/voiceprints`, kept deletion timestamp `settings/voice/voiceprint-deleted-at`, and legacy `settings/voice/voiceprint`; `plain`, named Voiceprints exception, first in reset order. |
| `home-assistant` / `useHomeAssistantStore` | `packages/stage-ui/src/stores/modules/home-assistant.ts` | Keep `settings/home-assistant/{enabled,has-credentials,exposure-mode,allowed-entities,denied-entities}` under its registered prefix; `plain`. Main credentials stay main-owned. |
| `web-search` / `useWebSearchStore` | `packages/stage-ui/src/stores/modules/web-search.ts` | Keep `settings/web-search/{enabled,api-key,provider,deepseek-api-key}`; `plain`. |
| `discord` / `useDiscordStore` | `packages/stage-ui/src/stores/modules/discord.ts` | Keep `settings/discord/{enabled,token}`; `plain`. Do not edit the kept Discord integration. |
| `factorio` / `useFactorioStore` | `packages/stage-ui/src/stores/modules/gaming-module-factory.ts`, invoked by `gaming-factorio.ts` | Keep `settings/factorio/{enabled,server-address,server-port,username}`; `plain`. Factory remains an explicit dynamic scan site. |
| `consciousness-settings` / `useConsciousnessSettingsStore` | `packages/stage-ui/src/stores/modules/consciousness-settings.ts` | Keep direct-write `settings/consciousness/{reasoning,temperature-enabled,top-p-enabled}`; `plain`. Routed commands, no leadership token; do not relabel tier 2. |
| `onboarding` / `useOnboardingStore` | `packages/stage-ui/src/stores/onboarding.ts` | Keep `onboarding/steps`; `plain`. Preserve one-time upstream imports/removal of `onboarding/completed` and `onboarding/skipped`. |
| `tool-cards`, `tool-card-settings` / `useToolCardsStore` and inner `useToolCardsStateStore` | `packages/stage-ui/src/stores/tool-cards.ts` | Keep direct-write `tool-cards/cards`, plain refs `settings/tool-cards/{enabled,reply-cards}`; `plain`. Saved results remain separately tier 4 under `tool-card-data`. |
| `vision-processing` / `useVisionProcessingStore` | `packages/stage-ui/src/stores/modules/vision/processing-store.ts` | Keep `settings/vision/capture-interval-ms`; `plain`. Capture status is runtime, not another persisted setting. |
| `settings-general` / `useSettingsGeneral` | `packages/stage-ui/src/stores/settings/general.ts` | Keep `settings/{language,streamer-mode,disable-transitions,use-page-specific-transitions}` and `settings/websocket/secure-enabled`; `plain`. |
| `settings-theme` / `useSettingsTheme` | `packages/stage-ui/src/stores/settings/theme.ts` | Keep `settings/theme/colors/{hue,hue-dynamic}`; `plain`. |
| `settings-controls-island` / `useSettingsControlsIsland` | `packages/stage-ui/src/stores/settings/controls-island.ts` | Keep `settings/{allow-visible-on-all-workspaces,always-on-top}` and `settings/controls-island/icon-size`; `plain`. |
| `settings-developer` / `useSettingsDeveloper` | `packages/stage-ui/src/stores/settings/developer.ts` | Keep `settings/developer/{inspect-updater-diagnostics,show-tool-payloads-as-json}`; `plain`. |
| `audio-device` / `useSettingsAudioDevice` | `packages/stage-ui/src/stores/settings/audio-device.ts` | Keep `settings/audio/input`, `settings/audio/input/{enabled,off}`; `plain`. Device runtime is not moved into synced state. |
| `screen-ambient-light` / `useSettingsScreenAmbientLight` | `packages/stage-shared/src/stores/screen-ambient-light.ts` | Keep `settings/screen-ambient-light/{enabled,source,forced-color,mode,strength,squint,capture-interval-ms,sample-width,response-ms,neutral-color-weight,dark-base,base-curve,local-share,tint,color-boost,wrap-intensity,wrap-saturation,wrap-diffuse,backlight,translucent-wrap}`; `plain`. Source comparison confirms this is upstream, despite its apparent relationship to fork behavior. |
| `mcp` / `useMcpStore` | `packages/stage-ui/src/stores/mcp.ts` | Keep `settings/mcp/{server-cmd,server-args}` and persisted runtime-looking `mcp/connected`; `plain` upstream exception. Do not silently turn the latter into tier 5 here. |
| `settings-beat-sync` / `useSettingsBeatSync` | `packages/stage-ui/src/stores/settings/beat-sync.ts` | Keep `settings/beat-sync/{parameters,spectrum-scale}`; `plain`. CM5/CM7 do not make this upstream store fork-owned. |
| `mods-server-channel` / `useModsServerChannelStore` | `packages/stage-ui/src/stores/mods/api/channel-server.ts` | Keep `settings/connection/{websocket-url,websocket-auth-token}`; `plain`. |
| `speech-output-control` / `useSpeechOutputControlStore` | `packages/stage-ui/src/stores/speech-output-control.ts` | Keep `settings/speech/{output-muted,output-volume,output-volume-last-audible}`; `plain`. Existing full-volume reset remains. |
| `wake-words` / `useWakeWordsStore` | `packages/stage-ui/src/stores/wake-words.ts` | Keep `settings/voice/pronunciation-owners`; `plain`. |
| `feature-flags` / `useFeatureFlagsStore` | `packages/stage-ui/src/stores/feature-flags.ts` | Keep `settings/feature-flags`, `settings/feature-flag-variants`; `plain`. Fork flag values reuse this upstream preference contract. |
| `color-scheme` / `useTheme` | `packages/ui/src/composables/use-theme.ts` | Keep VueUse `vueuse-color-scheme`; `plain`. Do not replace the upstream UI theme composable. |
| `danmaku-feed` / `useDanmakuFeedSettings`, folded composer | `packages/stage-ui/src/composables/use-danmaku-feed-settings.ts`; `apps/stage-tamagotchi/src/renderer/pages/chat-floating.vue` | Keep `chat-window/danmaku/{hide-read-messages,characters-per-second,minimum-seconds,composer-folded}`; `plain`. |
| `settings-needs-attention` / `useSettingsNeedsAttention` | `packages/stage-ui/src/composables/use-settings-needs-attention.ts` | Keep `settings/needs-attention/dismissed`; `plain`. |
| `live2d-runtime-motion` / `useLive2dModelSettings` | `packages/stage-ui/src/components/scenarios/settings/model-settings/use-live2d-model-settings.ts` | Keep direct writes `selected-runtime-motion`, `selected-runtime-motion-group`, `selected-runtime-motion-index`; `plain`. |
| `chat-voice-mode` | `packages/stage-ui/src/components/scenarios/chat/components/voice-input-button.vue` | Keep `ui/chat/voice-mode`; `plain`. |
| `chat-composer-voice-mode` | `packages/stage-ui/src/components/scenarios/chat/components/composer-voice-input.vue` | Keep `ui/chat/composer-voice-mode`; `plain`. The two component modes are distinct upstream contracts. |
| `chat-send-mode` | `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue`; `packages/stage-layouts/src/components/Widgets/{ChatArea,ChatActionButtons}.vue` | Keep shared `ui/chat/settings/send-mode`; `plain`, same registered three writers. |
| `io-tracer-label-width` | `packages/ui-trace/src/components/timeline/trace-timeline.vue` | Keep `ui/devtools/io-tracer/label-width`; `plain`. |
| `controls-island` / `useControlsIslandStore` | `apps/stage-tamagotchi/src/renderer/stores/controls-island.ts` | Keep `controls-island/fade-on-hover-enabled`, `preferences/dont-show-it-again/notice/fade-on-hover`; `plain`. |
| `server-channel` / `useServerChannelSettingsStore` | `apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts` | Keep `settings/server-channel/{websocket-tls-config,hostname,auth-token}`; `plain`. The existing main config mirror does not become tier 1 in this slice. |
| `push-to-talk-shortcut` / `usePushToTalkShortcutSettings` | `apps/stage-tamagotchi/src/renderer/composables/use-push-to-talk-shortcut.ts` | Keep `settings/hearing/{push-to-talk-shortcut,push-to-talk-shortcut-error}`; `plain`, including the upstream persisted error field. |
| `fullscreen-layout` / `useFullscreenLayout` | `apps/stage-tamagotchi/src/renderer/composables/use-fullscreen-layout.ts` | Keep `fullscreen/surface-width`; `plain`. |

### 2.4 Display-model plain refs

All upstream per-model values and device values below remain **U/plain**, with unchanged registry ids and no S2 import. Preserve the upstream carry-over: the first activated model takes an unscoped value and removes the old key; later models get independent defaults. A reset of an active model is not a reset of all models; registry sweeping still reaches every model.

| Registration / writers | Per-model keys, written as unscoped keys | Global keys and exceptions |
| --- | --- | --- |
| `live2d-params`; `packages/stage-ui-live2d/src/stores/{model-parameters,view-control}.ts` | `settings/live2d/{current-motion,available-motions,motion-map,parameters,position,scale}` | None. |
| `live2d-settings`; `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` | `settings/live2d/{motion-driver,eye-tracking,model-eye-offset,idle-animation-enabled,idle-eye-animation-enabled,expression-enabled,shadow-enabled}` | `settings/live2d/{auto-blink-enabled,force-auto-blink-enabled,max-fps,render-scale}`. Both blink values use versioned storage; preserve their envelopes. Natural default and expression/FPS defaults remain the existing ledger departure. |
| `live2d-motion-magic`; `packages/stage-ui/src/features/motions/live2d/settings.ts` | `settings/live2d/magic/{idle-profile,speaking-profile,follow-speech,skip-mouth-open,force-view-target}` | None. |
| `settings-spine`; `packages/stage-ui/src/stores/settings/spine.ts` | `settings/spine/{premultiplied-alpha,default-mix,idle-enabled}` | `settings/spine/{max-fps,render-scale}`. |
| `spine`; `packages/stage-ui-spine/src/stores/{spine,view-control}.ts` | `settings/spine/{current-animation,available-animations,available-skins,current-skin,available-variants,current-variant,animation-speed,position,scale}` | None. |
| `tachie`; `packages/stage-ui-tachie/src/stores/tachie.ts` | `settings/tachie/{position,scale,shadow-enabled}` | `settings/tachie/render-scale`. |
| `three`; `packages/stage-ui-three/src/stores/{model-store,view-control,camera}.ts` | `settings/stage-ui-three/{modelRotationY,trackingMode,lastModelId,modelSize,modelOrigin,eyeHeight,lookAtTarget,envEnabled,skyBoxUrl,skyBoxIntensity,modelOffset,cameraFOV,cameraDistance,camera-position}`; `settings/stage-ui-three/scenes/scene/directional-light/{position,target,rotation,intensity,color}`; `.../hemisphere-light/{sky-color,ground-color,intensity}`; `.../ambient-light/{color,intensity}` | `settings/stage-ui-three/{max-fps,last-committed-model-id,renderScale,multisampling}`; legacy `settings/stage-ui-three/lastModelSrc` remains sweep-only. |
| Upstream part of `mmd`; `packages/stage-ui-mmd/src/stores/{mmd,view-control}.ts` | `settings/mmd/{physics-enabled,ik-enabled,grant-enabled,physics-gravity,gaze-mode,camera-fov,ambient-color,ambient-intensity,directional-color,directional-intensity,directional-position,albedo-glow,idle-motion,motions,emotion-action-map,morph-overrides,available-morphs,available-materials,material-opacity,position,scale,rotationY}` | `settings/mmd/render-scale`; imported `mmd-motion-` records stay in IndexedDB. The six fork additions are separately inventoried in section 3.2. |

A misleading persisted runtime-looking upstream field remains an upstream exception; this slice does not convert `available-morphs`, `available-materials`, Live2D available motions, or Spine catalogs merely because derived MMD **fork** clip metadata moves.

### 2.5 Mixed registrations and already-correct state

| Registration / owner | Verified state and decision |
| --- | --- |
| `memory` / `useMemoryStore` | U: tier 4 `airi-memory/entries` plus plain `memory/enabled`; legacy `memory/entries` import stays. Split registry declaration of the toggle from the repository to express its plain upstream tier, without changing code/keys. Existing Web Lock/BroadcastChannel exception stays. |
| `recipes` / `useRecipesStore` | U: tier 4 `airi-recipes/recipes` plus plain `recipes/proposals-enabled`; legacy `recipes/custom` import stays. Split only the mixed registration; preserve approved/enabled semantics. |
| `layout-backgrounds` / stage-layouts `useBackgroundStore` | U: tier 4 `background-` records in the shared `device` mount plus plain `settings/theme/background/{gallery-active,gallery-options,sampled-color}`. Split registration metadata. The desktop does not mount these background components; no store rewrite or mount consolidation. |
| `stickers` / `useStickersStore` | U: tier 4 library records and plain `settings/stickers/{enabled,frequency}`. Split toggle registration metadata; keep old database deletion first and the kept `migrated-from:` marker. |
| Imported MMD motion records | U tier 4, inside current mixed `mmd` registration. Split `mmd-motion-files` metadata from display refs; same database/store/prefix and reset ordering. Do not move blobs. |
| `expression-documents` | F, already tier 3: `expression-catalog:<id>` and `expression-rest:<id>`, stage-written explicit commands. No move or carry-over. Keep sweep prefixes and stage ownership. |
| Six settings documents | F, already tier 1: `situation-settings` (`settings/situation`), `expression-performance-settings` (`settings/expression-performance`), `host-notice-settings` (`settings/host-notice`), `conversation-settings` (`settings/conversation`), `live2d-natural-settings` (`settings/live2d/natural`), `mmd-natural-settings` (`settings/mmd/natural`). No S2 move. Existing Natural legacy imports stay; CM7c alone redistributes behavior fields. |
| `situation-inner-state` | F, tier 2 `settings/situation-inner`; explicit leadership token and stale-save rejection already exist. No move or import. Per-user floor stays here. |
| `character-state` | F, tier 4 card records in `airi-character-state/cards`; no move or import. Per-card pacing stays here. |
| `chat-sessions`, `chat-assets`, `tool-card-data`, `characters`, `backgrounds`, `display-models` | Existing tier 4 stores/records stay at their registry locations; no migration. Chat reset remains `sweepFirst`. Background/display records share a physical database by disjoint prefixes; do not confuse physical mount with logical owner. |
| `outbox` | U, tier 4 sweep-only `airi-sync-queue:` mount, verified in `database/storage.ts` with no client reader/writer. Keep sweep coverage; do not invent a producer or migration. |
| `minecraft` | Current fork store keeps runtime context only; `settings/minecraft/` is legacy sweep coverage from the old upstream factory. No current plain ref to migrate. Keep legacy location. |
| `retired-account-credentials` | F sweep-only `auth/v1/{token,refresh-token,oidc-id-token,oidc-client-id,oidc-token-expiry,oidc-flow-state,oidc-flow-params}`. No current writer or carry-over; keep the removal owner and legacy flags. |
| `openpanel-device-id`, `trace-source-id` | SessionStorage identities, `airi:openpanel-device-id` and `airi:trace-source-id`, not durable localStorage settings. Keep registered session-lifetime diagnostic exceptions with no migration; do not mislabel persisted session ids as tier 6 pure memory. |
| Model/Sherpaw/Transformers caches | Already registered `cache`; no migration. Keep OPFS and Cache Storage deletion, including main-owned Sherpaw assets via its existing reset. |
| Main-process files, perf, analytics SDK storage | Preserve named exclusions and existing host deletion boundaries. S2 changes only the consent mirror in section 3.1. It does not choose analytics endpoints or delete diagnostic retention. |

### 2.6 Findings from the Known gaps list

All seven replicated-plain-ref stores and all four direct-command cases are upstream, verified individually above. Per-model upstream refs remain exceptions, not tier 3. The stage-layouts background mount, MMD's own unstorage instance, and outbox are registered already; their database arrangement is not missing reset coverage.

The two actionable fork gaps are narrower: consent is a fork-owned plain ref with an SDK-dependent main mirror, and six MMD additions use upstream's plain-ref conventions. The registry currently calls whole mixed owners tier 4 or plain even when different locations have different lifecycles. There is also no ownership distinction that prevents adding a fork key under an already registered upstream prefix.

## 3. Design

### 3.1 Analytics consent (S3)

Move `useSettingsAnalytics` to `useSettingsDocument` with one boolean field, `optedIn`, default false, in **`settings/analytics`**. Keep the store's public read projection where callers need it, but convert all writes to awaited leader-routed `update`/`reset` actions. Do not expose a mutable computed setter that starts an unawaited RPC.

The one-time import reads **only** `settings/analytics/opted-in`. A valid stored false stays false; valid true stays true. Missing/malformed values use false. Ignore the older `settings/analytics/enabled` even if it says true, because it was an upstream default rather than consent. Existing new document wins over every old key. After a successful leader save, remove both old keys; retain both as legacy registry locations for deletion.

`settings-analytics` becomes tier 1 and owns the new key plus legacy keys and the migration writer. Its reset updates the document, then the normal registry sweep removes storage. The main app's `errorReportingEnabled` remains a **derived main-process mirror** required for reporting before renderer startup, not a second user setting. A leader-owned app bridge mirrors validated consent on startup/update/reset through the existing `electronErrorReportingSet`, even when no SDK or DSN is loaded; follower snapshots never issue mirror commands. Remove the duplicate mirror side effect from SDK `setEnabled`; it controls capture only.

Initialization and reset await the mirror result where their contract requires completion. Failure is surfaced, not hidden behind a retry loop. S2 does not enable telemetry or change endpoints. Document the derived mirror in State persistence and the upstream ledger.

### 3.2 Fork MMD settings and derived metadata (S4, S5)

| Current fork field/key | Target / storage key | Carry-over | Registry entry |
| --- | --- | --- | --- |
| `motionDriver`, `perModel(settings/mmd/motion-driver)` | Tier 1 `settings/mmd/performance`, `motionDrivers[modelId]` | Enumerate all matching old model keys, including inactive models; validate `natural`/`classic`; preserve every model's value. Old unscoped value is reserved for the first MMD model without a scoped value, never applied to every model. | New `mmd-performance-settings`; remove these active locations from `mmd`, retain them as legacy under the new owner. |
| `stageCharacterHeight`, `settings/mmd/stage-character-height` | Same tier 1 document, `stageCharacterHeight` | Preserve valid stored value; missing/invalid uses current default and existing valid range. | `mmd-performance-settings`, old key legacy. |
| `roamMode`, `settings/mmd/roam-mode` | Same tier 1 document, `roamMode` | Preserve current valid enum, including `stay`; do not make motion more active. | Same. |
| `stanceSlots`, `settings/mmd/stance-slots` | Same tier 1 document, `stanceSlots` map | Import all model entries, preserving slot names and values; validate by existing domain constraints. | Same. |
| `clipCuration`, `settings/mmd/clip-curation` | Same tier 1 document, `clipCuration` map | Import all model/clip entries, preserving labels, kind overrides, exposure, idle permission, and loop values. Keep duplicate-label and kind/exposure invariants in explicit actions. | Same. |
| `availableClipMeta`, `perModel(settings/mmd/available-clip-meta)` | Tier 5 synced Pinia memory, no durable key | Do not import derived values. The stage rebuilds them from loaded clips. Clear/sweep old global and all model keys; no user curation lives here. | New sweep-only `mmd-clip-metadata-legacy` for old locations. Runtime store has no persisted-state registration. |

One feature document is enough: these are MMD **realisation** settings, including display-model driver choices, not CM7c's character behavior. Keep per-model meaning by retaining explicit model-id maps. Do not alter upstream's Live2D driver key or the other MMD display keys.

Use a dedicated fork store `packages/stage-ui-mmd/src/stores/performance-settings.ts`; no one-off storage framework. The upstream `mmd.ts` loses only these refs and fork methods whose actual ownership moves with them. Consumers read the new store directly. Keep shared MMD domain contracts in the module that owns them; do not duplicate types to avoid an import.

Expose explicit async actions for curation, stance slots, driver selection, and model removal, validating cross-field invariants before one commit. Every UI action awaits its result. Snapshot watchers may update local projections but never repair or persist synced state. A curation edit must not overwrite another model's newer settings with a stale full-map proposal.

The runtime clip-metadata store publishes a serializable `{ modelId, loadEpoch, clips }` from the stage. Reject a result from an older model/load epoch, clear on model removal/reset, and show no old clip inventory while a replacement model loads. Another window reads the snapshot but never writes it back or saves it. No timers, Three objects, clips, promises, or clients enter synced state.

### 3.3 One-time migration and failure behavior (S6)

Reuse `useSettingsDocument`'s private persistence, field validation, `listenToStorageChanges: false`, and `writeDefaults: false`. It reads `initial()` but saves only through an action. The owning new store therefore has one idempotent leader-routed migration action, called from the existing owner initialization after leadership is established. It commits the new document before removing old keys. Follower construction reads a projection but never migrates, writes defaults, or deletes keys.

New document presence is the migration completion marker; do not add a global migration flag. Existing documents always win, including explicitly false/zero/empty values. A failed write must leave old keys intact and report failure. Cleanup after a successful commit is safe to repeat. If the helper currently cannot expose save failure, fix that persistence boundary and cover it for existing callers before using it for destructive cleanup; do not infer success merely from assigning a Vue ref.

For the old unscoped MMD driver when no model can yet claim it, keep a narrowly documented optional import field in the new document containing that validated value. The first eligible model-selection action consumes it and commits its driver with removal of that field. The import field is not a user setting or a recurring fallback. Its `NOTICE` names the old key, why model identity is not yet available, and the removal condition. An already scoped model keeps its scoped value and does not overwrite another model's value with the unassigned one.

Reset ignores imports, writes defaults to the live document, clears transient derived state, and removes all legacy locations. "Delete all data" must not trigger an import again from a retained old key. Model deletion removes its entries from `motionDrivers`, `stanceSlots`, and `clipCuration`, and invalidates the matching metadata epoch; follow existing deletion semantics for absent references.

Legacy per-model locations need `legacy: true` in the registry schema and matching static/browser readers. Add this flag consistently rather than claiming a broad `settings/models/` prefix, which overlaps every upstream renderer. The scanner must distinguish a removal from a write and must fail on a surviving write to a legacy location.

Each one-time reader carries the root `NOTICE` format and an explicit removal condition: no supported release still writes the old fork keys. Do not add a compatibility writer, a two-way mirror of old/new renderer keys, or repeated fallback reads after the new document exists.

### 3.4 Registry ownership and honest tiers (S1, S2)

Keep the registry as the single registration point. Add a literal ownership marker for locations that are intentionally upstream plain state, with a pinned source note; mixed registrations split where tier or ownership differs. The registry/static scanner should reject:

- A new active fork-owned registration with tier `plain`.
- A new writer or exact key that tries to fit under an upstream prefix without an explicit upstream declaration.
- Writes to a retired fork key marked legacy.
- Overlapping owners introduced by splitting mixed registrations.

Prefer explicit key sets for upstream prefix families that currently allow accidental expansion, using the existing source scanner and registry parser. Do not add a second manually maintained ownership list elsewhere. Preserve the existing two justified dynamic sites for consciousness options and Factorio, with exact declared members.

Split mixed registrations into `memory-settings`, `recipe-settings`, `layout-background-settings`, `sticker-settings`, and `mmd-motion-files` as appropriate, leaving repository ids/keys unchanged. Existing repository registrations remain tier 4. Give split owners one reset orchestration: do not run a side-effectful owner reset twice. A settings-only split may be sweep-only when the preceding owner reset already resets its live refs; state that ordering and test it. Keep voiceprints first, expressions before display models, chat sweep-first behavior, stickers' marker, and caches last.

Keep sweep-only legacy and sessionStorage diagnostic registrations as explicit exceptions. They are not new durable plain state and do not provide permission to add such state. The `PersistenceTier` type need not pretend tier 5/6 values are persisted; runtime metadata is described in its owning store/docs, not a fake storage location.

## 4. Where the code lives

| Path | Change |
| --- | --- |
| `packages/stage-ui/src/persistence/state-registry.ts`, registry tests | Ownership metadata, honest mixed-tier entries, new fork documents/legacy locations |
| `scripts/dev-tools/lib/storage-writes.ts`, its tests, `scripts/dev-tools/storage-writes.test.ts` | Parse/check the new ownership and legacy per-model metadata using the existing scanner |
| `packages/stage-ui/src/stores/settings/analytics.ts`, its tests | Tier 1 consent and one-time import |
| `apps/stage-tamagotchi/src/renderer/modules/sentry.ts`, renderer initialization/consent bridge, focused tests | One leader-owned main mirror independent of SDK creation |
| `packages/stage-pages/src/components/settings-general-fields.vue`; `packages/stage-ui/src/stores/settings/index.ts` | Replace the analytics toggle's direct assignment with an awaited leader action; preserve visual controls and the public read projection. Existing read-only analytics consumers keep that projection. |
| `packages/stage-ui-mmd/src/stores/performance-settings.ts` and tests (new); `stores/clip-metadata.ts` and tests (new) | Durable realisation document and runtime derived catalog |
| `packages/stage-ui-mmd/src/stores/mmd.ts` | Remove the six fork storage additions and move their cohesive fork methods; keep upstream fields and motion file storage |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue`; `packages/stage-ui/src/components/scenarios/settings/model-settings/mmd.vue`; `packages/stage-ui/src/components/scenes/Stage.vue`; `apps/stage-tamagotchi/src/renderer/pages/stage.vue`; `apps/stage-tamagotchi/src/renderer/bridges/perf-recording.ts` | Read the owning document, await explicit updates, publish derived metadata, and preserve the existing perf tag values. Director/debug snapshot consumers keep their current contracts. |
| `packages/stage-ui/src/stores/display-models.ts`, data maintenance/reset paths where needed | Coordinate model deletion and complete reset of the new fork state without altering upstream model-key behavior |
| `packages/stage-shared/src/composables/use-settings-document/index.ts` and tests, only if needed | Make commit failure observable before migration cleanup; preserve all existing document semantics |

The upstream-origin files changed are named above because they contain the existing fork fields or the consent integration. All U inventory rows otherwise keep their implementation. No change to `useLocalStorageManualReset` or `useModelScopedLocalStorage` is needed.

## 5. Work items and commit titles

1. **`refactor(stage-ui): declare upstream persistence exceptions by owner`**. Add registry ownership and split mixed registrations without changing storage. Update the current Members/Named exceptions policy and glossary in this commit.
2. **`test(stage-ui): reject new fork state in the plain persistence tier`**. Extend the existing static/registry checks to enforce the declarations and legacy per-model handling. Keep fixtures synthetic. Registry contract docs move here. Root scanner code has no workspace package of its own; `stage-ui` is the scope because it enforces that package's registry.
3. **`refactor(stage-ui,stage-pages,stage-tamagotchi): persist analytics consent through one leader document`**. Section 3.1, import and mirror lifecycle tests, awaited consumers. Update State persistence and ledger in the same commit.
4. **`refactor(stage-ui-mmd,stage-ui,stage-tamagotchi): persist MMD realisation settings through leader actions`**. Five durable settings, complete import/reset/model deletion, all consumers, and registry changes in one buildable increment. Update State persistence, MMD/stage-ui READMEs, and ledger together.
5. **`refactor(stage-ui-mmd,stage-ui): keep derived clip metadata in synced memory`**. Remove disk writes, publish epoch-scoped runtime state, retire old keys, and test two-window behavior. Update State persistence and MMD component API/story documentation if its public contract changes.
6. **`docs(stage-ui): record the store tier decisions and close S2`**. Add `docs/ai/adr/<implementation-date>-character-mind-store-tiers.md`; update proposed roadmap row S2 to done after all checks. Move Target rule 3 into current policy with its upstream exception explicit; leave Target rule 4 to CM7c.

Add S2 as planned/in progress at implementation start. Each product commit passes `pnpm verify`; the PR passes `pnpm verify --gate`. No product edits or these implementation checks run during the planning delivery.

## 6. Tests (Node first, deterministic)

- **Inventory/ownership:** The existing source scanner finds every current writer and rejects a synthetic new fork plain ref, an undeclared extra key under an upstream family, a new writer, overlap, and a write to a legacy per-model key. A removal remains legal. Registry split preserves the same owned set before adding new document keys.
- **Consent import:** Old opted-in true/false, absent, malformed, old enabled=true alone, and new-plus-old conflicts. False stays false; no old default becomes consent. New document wins. A failed save preserves old keys. Follower initialization writes nothing.
- **MMD import:** Two inactive models with different drivers; legacy unscoped driver with/without an active model; scoped value wins; absent model deferred claim; invalid driver only resets that field. Stance and curation entries for all models survive, including false exposure flags, null labels, and empty maps. One corrupt field does not discard valid siblings.
- **Actions/invariants:** Two windows edit different fields/models through awaited actions and converge. Duplicate labels are rejected before commit. Stance/unusable kinds cannot retain incompatible exposure. A model removal drops its fork settings/metadata while another model survives.
- **Persistence ownership:** Real synced Pinia runtimes with a controlled transport, without mounting business UI. Leader update writes once. Applying a remote snapshot writes no storage and emits no local full-state proposal. Repeated invariant actions converge without repeated side effects. Assert on actual transport/persistence observations, not a mocked action that bypasses replication.
- **Derived metadata:** Load A, switch to B, finish A late: B never receives A's metadata. Reload recomputes; no save/default write happens. A follower reads the new snapshot. Delete/reset clears the snapshot and legacy keys; stale loader completion cannot resurrect it.
- **Mirror:** Startup, follower snapshot, consent update, reset, failed Eventa call, and a build without the SDK/DSN. Only the leader writes main consent; reset does not require an analytics page to be open. Do not execute a real analytics upload.
- **Reset:** New and legacy keys across all models are swept. No watcher/import writes them back. Owner reset runs once despite mixed registry splits. Voiceprint deletion time and sticker migration marker remain the only existing kept locations.

Use Node for pure migration/schema/epoch/admission logic. Existing required `state-registry.browser.test.ts` and `use-data-maintenance.browser.test.ts` are storage/platform integration tests, not DOM-heavy page tests: keep and run them. They catch dynamic keys and real browser storage behavior that a Node fake cannot prove. Add no new whole-page browser suite.

Focused commands: `pnpm exec vitest run --project dev-tools scripts/dev-tools/storage-writes.test.ts`; `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts`; Node tests from each changed package's declared project/config. Run the context-policy guard when policy docs change.

## 7. Headless and rendered checks on macOS

Use the host directly, **no QA display**, with a disposable profile and synthetic imported settings. Give the owner notice before moving the cursor. Never copy their settings, credentials, model paths, or saved conversation into fixtures.

**Headless:** Run the focused Node/storage tests, `pnpm verify`, `qa:doctor`, and branch `pnpm verify --gate` with its clean-start smoke. Run `qa:motion3d affected` to document whether any loaded motion path changed. If it is affected by the scene wiring, compare `idle` and `touch` with fixed seed 1 and the same imported settings against pre-change evidence; expect identical motion. A storage-only slice does not retune the rig or add a motion score.

**Rendered:**

1. Start a disposable old-format profile with two synthetic model ids, opposite driver choices, non-default height/roam, and different stance/curation records. Open stage and follower Settings. Confirm the new controls reflect the old values and changes in Settings reach the stage once; no default flashes or stale derived catalog.
2. Change one MMD setting from the follower, another from the leader, then reload and switch models. Each saved field retains its value, each model retains its driver/curation, and no upstream display setting changes. Observe zero follower storage writes for the migrated documents.
3. Show a model/clip load transition, an empty library, invalid label rejection, and a valid edit; inspect at full and narrow settings-window widths. Capture the rendered state rather than asserting its DOM layout.
4. With a test Eventa boundary that records consent commands and no telemetry transport, verify old consent imports, toggle off, reset, and relaunch. Main's mirror follows false even without the SDK. Existing upstream plain refs are not claimed to be single-writer.
5. Run "Delete all data" from a follower. Verify all new keys, all migrated old per-model keys, and the new runtime snapshot are gone/reset; reload both windows to prove no old value returns. Check the existing kept markers and repository resets.
6. Reopen a profile containing only unchanged upstream keys. Provider selection, audio settings, Live2D/Spine/VRM/Tachie per-model views, and card selection still read the same data. A targeted store observation suffices for renderers not changed visually; do not claim a platform not exercised.

Each launch has zero unexpected renderer/main-process errors. Stop all sessions. Preserve private evidence locally. No app, headless model, or storage migration is run by the planning-only commit.

## 8. Docs that move with the code

- Items 1 and 2: `state-persistence.md` registry metadata, upstream exception, mixed records, and closed-tier enforcement; `glossary.md` persistence terminology. Preserve the observed upstream replica-write limitation rather than deleting it as fixed.
- Item 3: consent document/current settings membership, derived main mirror and reset; ledger analytics consent departure. Do not decide upstream analytics endpoints.
- Items 4 and 5: State persistence per-model and settings sections; MMD/stage-ui READMEs; upstream ledger Per-model settings row; component API docs/stories only where public contracts change.
- Item 6: new dated ADR records S1 to S7 and the exact import/removal policy; new roadmap row S2 names the narrowed fork-owned completion condition and links the ADR.
- No agent guidance edits are expected. If a changed contract makes a guide false, put the minimal guidance change in its own commit in the same PR.
- Do not edit frozen ADR bodies or CM7c's behavior-document design. Rule 4 remains CM7c's responsibility.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Inventory silently treats every edited file as fork-owned | Provenance is per key and compared with adopted upstream. Preserve all U rows. |
| A prefix grants unlimited upstream exceptions | Exact key ownership and scanner enforcement in the existing registration point. |
| Migration loses data when a private persistence ref swallows a save error | Commit acknowledgment must precede cleanup; fix the owning helper boundary if required and test failure. |
| Unscoped driver is applied to every model or discarded before a model exists | One deferred first-model claim, explicit precedence, no repeated fallback. |
| New settings map breaks upstream model deletion | Coordinate the existing delete boundary and clear only the removed model's entries. |
| Derived metadata is mistaken for curation | Separate runtime rebuilt metadata from durable labels/permissions; preserve all curation. |
| Consent resets only when an analytics SDK loads | Leader mirror independent of SDK and tested without a DSN. |
| Split registry runs expensive resets twice or changes reset order | One reset owner per logical lifecycle, explicit ordering tests. |

## 10. Follow-ups

- Upstream may later replace its plain refs; adopt that storage design at a sync and retire the matching exceptions. Do not implement speculative migrations now.
- Main-process settings outside the consent mirror, the analytics endpoint decision, unused outbox retirement, and background mount consolidation remain separate work.
- CM7c owns the character-behavior document and its carry-over. S2 does not merge behavior into the MMD realisation document.
- No secret-encryption or secure-storage redesign is implied by the tier inventory.

## Must not do

- Do not migrate the seven upstream replicated-ref stores or change their keys under the claim that rule 3 requires it.
- Do not relabel plain refs tier 1/2/3 without implementing that tier's ownership contract.
- Do not put runtime clip objects or transient metadata on disk, import stale derived metadata, or lose durable clip curation.
- Do not expand an upstream prefix to hide a new fork writer, disable the registry tests, or add a second registry.
- Do not import `settings/analytics/enabled` as consent, enable telemetry, or copy private values into test data.
- Do not repair replicated state from watchers, save from follower snapshots, keep old/new keys in a two-way mirror, or remove old keys before acknowledged save.
- Do not change upstream storage helpers globally, add a new dependency, edit kept projects, or rewrite ADR bodies.

## Done when

**S2:** Every current persisted plain-ref owner has a declared, reviewed disposition. All unchanged upstream owners keep their existing keys and registered exception; their replica-write limitation remains accurately documented. Fork analytics consent and the five durable MMD additions are tier 1 with one persistence owner, valid existing values carried over once, and complete reset/model deletion. Fork clip metadata is tier 5 memory with stale-load isolation and no storage writes. Registry/scanner tests reject a new fork plain key and cover legacy per-model cleanup. Required Node, real-storage, headless-as-applicable, and macOS rendered checks pass. State persistence Target rule 3 moves to current policy with its precise upstream qualification, and the new ADR and S2 roadmap row land.

## Decisions for the owner

The standing preference covers the recommendations below. None requires overriding an existing product ruling; S3 preserves consent semantics and S5 removes only reproducible derived data.

| # | Fork | Options | Trade-off | Recommendation |
| --- | --- | --- | --- | --- |
| S1 | What "every store fits a tier" means | (a) Migrate every upstream store; (b) migrate fork-owned keys and retain explicit upstream exceptions; (c) call all plain refs tier 1 | (a) contradicts Target rule 3 and creates large sync conflicts. (c) hides the ownership defect. (b) closes the actual fork target and preserves upstream intake. | (b). |
| S2 | Enforcing the exception | (a) Documentation only; (b) literal ownership in the existing registry plus scanner checks and honest mixed-tier splits; (c) a second migration/ownership registry | (a) permits new fork keys under old prefixes; (c) duplicates ownership. (b) adds small metadata/parser work in the existing enforcement point. | (b). |
| S3 | Analytics key and mirror | (a) Keep plain consent and SDK-dependent mirror; (b) new tier 1 `settings/analytics`, import only opted-in, leader-owned mirror independent of SDK; (c) make main the sole settings owner | (a) leaves the fork gap. (c) changes the shared settings boundary and host contract. (b) follows the existing tier while keeping main's required early-start cache. | (b). |
| S4 | Durable MMD additions | (a) One tier 1 feature document with model-id maps; (b) separate document/store per model; (c) keep plain refs or move them all to stage-only tier 3 | (b) creates dynamic store lifecycles for a few settings. (c) either leaves the defect or bypasses tier 1's first-fit rule for user settings. (a) reuses the existing helper and explicit leader commands. | (a), `settings/mmd/performance`, distinct from CM7 behavior. |
| S5 | Derived clip metadata | (a) Keep disk cache; (b) tier 5 epoch-scoped synced memory; (c) recompute independently in every window | (a) stores stale derived state. (c) loads models/clips in windows that only show settings. (b) keeps one producer and the existing follower reader. | (b), no carry-over of derived values. |
| S6 | Migration cutover | (a) Remove old keys before saving; (b) leader command, new-document precedence, successful save before cleanup, explicit deferred first-model claim; (c) dual write indefinitely | (a) loses data on failure. (c) creates competing ownership and compatibility maintenance. (b) needs focused failure/lifecycle tests but has one durable owner. | (b). |
| S7 | Relationship to CM7 and CM8 | (a) Bundle all refactors; (b) independent S2 PR, coordinate MMD consumers on rebase; (c) wait for all character-mind work | (a) mixes review concerns; (c) delays independent persistence fixes. (b) uses separate keys/responsibilities and keeps CM7c's scope intact. | (b). |

The recommendations above were implemented. Departures and verification evidence follow; rendered and gate results remain reserved for the orchestrator.

## Departures during implementation

- Item 1 splits the fork MMD locations immediately so that the upstream MMD registration describes upstream locations only. Until items 3 to 5 migrate them, consent and the split MMD locations carry the explicit temporary exception "Fork state awaiting S2 migration".
- Splitting registrations also requires updating the partial reset id lists in `use-data-maintenance.ts`; otherwise a module or desktop reset would stop sweeping the moved locations. The underlying owner reset still runs once.
- The implementation assignment replaces per-commit `pnpm verify` with explicit package suites, dependent typechecks, lint, and policy guards. Rendered, Electron, QA, and branch gate checks belong to the orchestrator.
- Item 2 resolves same-file template parameters to their literal callers and keeps unresolved factory suffixes. Without that refinement, the existing dynamic-site exemption would admit a new undeclared literal or factory member. The two existing dynamic declarations remain; no new ownership list was added.
- Item 3 confirmed that VueUse catches synchronous storage failures: the added update/reset regressions first failed because both promises resolved. `useSettingsDocument` now observes `onError` with `flush: 'sync'` and publishes only after a successful save; all existing document callers share that fix.
- The desktop consent boundary is injected into the settings owner. The startup bridge creates the store in every window and awaits `initialize` only in the leader host; synced routing waits for actual leadership. Updates and resets await that same boundary, so no watcher or SDK performs a second mirror write.
- `stage-pages` declares only a browser suite, so its full `vitest run` is used instead of a nonexistent Node project.
- The app's first jsdom storage test exposed Node 26's own undefined `localStorage` shadowing jsdom. Its Node project now uses the existing `domStorageExecArgv` configuration, already included in Turbo test inputs. No global replacement or new workaround was added.
- The touched renderer startup function no longer needs its old double assertion of `autoAnimatePlugin`; the direct plugin value passes the dependent typechecks.
- Item 3 confirmed that VueUse catches synchronous storage failures: the added update/reset regressions first failed because both promises resolved. `useSettingsDocument` now observes `onError` with `flush: 'sync'` and publishes only after a successful save; all existing document callers share that fix.
- The desktop consent boundary is injected into the settings owner. The startup bridge creates the store in every window and awaits `initialize` only in the leader host; synced routing waits for actual leadership. Updates and resets await that same boundary, so no watcher or SDK performs a second mirror write.
- `stage-pages` declares only a browser suite, so its full `vitest run` is used instead of a nonexistent Node project.

- Item 4 adds the required claim at `useSettingsStageModel.loadStageModel`, the actual model-publication boundary, and initializes the new owner in renderer startup. Type-only MMD action/diagnostic consumers and the scene-routing regression now import the owning contract.
- Package manifests cannot change in this assignment, so new MMD stores are exposed through the existing supported `stores` barrel.
- The MMD Node integration tests now use jsdom and the existing `domStorageExecArgv` instead of replacing Node globals and dynamically importing the store. The unchanged transient BroadcastChannel regression moved to the focused real-browser store suite.

- The existing MMD settings browser suite also consumed the moved fields. Its assertions now use the owning actions and new document shape; its synthetic model fixture explicitly selects the MMD settings scope. No new page suite was added.
- The inventory's "caches last" statement differed from the registry: Sherpaw assets were interleaved before situation state. Item 4 moves that registration to the existing cache tail and adds an ordering regression, preserving its owner and locations.

- Item 5 scopes epochs to library loads as well as model loads. The old scene checked only model generation, so a removed or re-imported clip could finish late within the same model. A library epoch now rejects that completion before registration and republishes already loaded clips from their cached masks.
- The runtime catalog is reset through the realisation owner's lifecycle. Its legacy registration is sweep-only; no fake persisted location was added for tier 5 state. The temporary S2 plain-tier admission is removed.
- Item 5 regression tests exposed inherited-property lookups for valid clip names such as `constructor`: one returned the Object constructor as curation, and another offered an unloaded clip. Owner projections now require own dictionary keys; the same valid clip is still offered after its metadata is published.

- The assignment explicitly names a 2026-11-21 ADR filename, so the final ADR keeps that decision date and separately records implementation on 2026-11-22. The roadmap marks implementation done while leaving rendered and branch-gate acceptance pending, as those runs are forbidden to this worker.

## Checks run

- Item 1: `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts scripts/dev-tools/storage-writes.test.ts` passed 2 files / 12 tests.
- Item 1: `pnpm -F @proj-airi/stage-ui exec vitest run --project node` passed 194 files / 1885 tests.
- Item 1: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts` passed 2 files / 32 tests.
- Item 1: `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` passed all 7 selected projects.
- Item 1: ESLint over the seven changed files and `git diff --check` passed after correcting list formatting.
- Item 2: `pnpm exec vitest run --project dev-tools scripts/dev-tools/lib/storage-writes.test.ts scripts/dev-tools/storage-writes.test.ts` passed 2 files / 17 tests.
- Item 2: `pnpm -F @proj-airi/stage-ui exec vitest run --project node` passed 194 files / 1885 tests.
- Item 2: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts` passed 2 files / 32 tests.
- Item 2: `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` passed all 7 selected projects.
- Item 2: `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` passed 1 file / 11 tests; changed-file ESLint and `git diff --check` passed.
- Item 3: the helper regression first reproduced 2 failed / 16 passed tests; after the fix, `pnpm -F @proj-airi/stage-shared exec vitest run src/composables/use-settings-document/index.test.ts` passed all 18.
- Item 3: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/settings/analytics.test.ts src/stores/modules/hearing.analytics.test.ts` passed 2 files / 13 tests.
- Item 3: `pnpm -F @proj-airi/stage-shared exec vitest run` passed 96 files / 1880 tests.
- Item 3: `pnpm -F @proj-airi/stage-ui exec vitest run --project node` passed 195 files / 1896 tests.
- Item 3: `pnpm -F @proj-airi/stage-pages exec vitest run` passed 33 browser files / 102 tests.
- Item 3: the app suite initially failed only the 3 new bridge tests because Node's storage global shadowed jsdom. After applying the existing worker flag, `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/renderer/bridges/analytics-consent.test.ts` passed 1 file / 3 tests, and the full `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node` passed 195 files / 2169 tests, with 3 files / 8 existing environment-gated tests skipped.
- Item 3: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/stores/settings/analytics.browser.test.ts src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts src/features/conversation/settings.browser.test.ts src/features/performance/settings.browser.test.ts src/features/situation/settings.browser.test.ts src/features/host-capabilities/notice-settings.browser.test.ts` passed 7 files / 124 tests.
- Item 3: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser src/stores/natural-settings.browser.test.ts` and `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser src/composables/live2d/natural-settings.browser.test.ts` each passed 1 file / 13 tests.
- Item 3: `pnpm --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/stage-pages" --filter "...@proj-airi/stage-tamagotchi" --workspace-concurrency=2 typecheck` passed all 28 selected projects.
- Item 3: after the app test-config fix, `pnpm --filter "...@proj-airi/stage-tamagotchi" --workspace-concurrency=2 typecheck` passed. The initial focused `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/stores/settings/analytics.browser.test.ts` also passed 1 file / 1 test before the complete browser run above.
- Item 3: changed-file ESLint and the policy/storage guard command passed (2 files / 12 tests). Vite still reports the pre-existing extensionless import in the app's `uno.config.ts`; no warning was suppressed.

- Item 4: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/stores/mmd.test.ts src/stores/performance-settings.test.ts` passed 2 files / 18 tests. `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser src/stores/performance-settings.browser.test.ts` passed 2 tests; its transient-request fixture was then changed to plain Pinia contexts to avoid disposing an unrelated pending synchronization RPC. The complete browser suite below passed after that fix.
- Item 4: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node` passed 48 files / 403 tests.
- Item 4: `pnpm -F @proj-airi/stage-ui exec vitest run --project node` passed 195 files / 1896 tests, including a complete rerun after making the model-selection watcher await its claim.
- Item 4: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node` passed 195 files / 2169 tests, with the same 3 files / 8 existing gated skips.
- Item 4: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser` passed 7 files / 33 tests.
- Item 4: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/mmd.browser.test.ts` passed 1 file / 20 tests.
- Item 4: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts src/components/scenes/stage-emotion-routing.browser.test.ts` passed 3 files / 74 tests.
- Item 4: `pnpm --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/stage-tamagotchi" --workspace-concurrency=2 typecheck` passed MMD, then exposed the old API references in the existing settings browser test. After updating that consumer, `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` passed all 7 remaining projects and passed again after the awaited watcher change.
- Item 4: policy/storage guards passed 2 files / 12 tests. The first policy run could not see the new untracked owner; staging that file made it visible to the guard's existing tracked-source search. ESLint has no errors; five unchanged warnings remain in untouched functions/comments of `Stage.vue` and `display-models.ts`.

- Item 5: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/stores/clip-metadata.test.ts src/stores/mmd.test.ts src/stores/performance-settings.test.ts` passed 3 files / 24 tests initially, then 3 files / 26 tests after the dictionary regressions were added and fixed. The isolated `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/stores/performance-settings.test.ts` first reproduced 2 failed / 10 passed tests for inherited-property lookups.
- Item 5: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser src/stores/performance-settings.browser.test.ts` passed 1 file / 3 tests, including real follower metadata replication without storage writes or proposals.
- Item 5: `pnpm exec vitest run --project dev-tools scripts/dev-tools/lib/storage-writes.test.ts scripts/dev-tools/storage-writes.test.ts scripts/dev-tools/policy-docs.test.ts` passed 3 files / 28 tests.
- Item 5: `pnpm --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` passed all 8 projects. An earlier run correctly rejected mutation of a readonly test input; the test now spreads it into its own mutable input before proving that publication copies it.
- Item 5: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node` passed 49 files / 411 tests.
- Item 5: `pnpm -F @proj-airi/stage-ui exec vitest run --project node` passed 195 files / 1896 tests.
- Item 5: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser` passed 7 files / 34 tests.
- Item 5: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts src/components/scenarios/settings/model-settings/mmd.browser.test.ts src/components/scenes/stage-emotion-routing.browser.test.ts` passed 4 files / 94 tests. The existing browser fixtures also log missing/invalid Live2D archive errors; these are not a rendered app acceptance result.
- Item 5: changed-file ESLint passed with no errors or warnings.

- Item 6: ESLint passed for the ADR, current policy, roadmap, and plan. `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` passed 1 file / 11 tests. This commit changes documentation only; the product checks are recorded under item 5.

**Orchestrator placeholder:** rendered scenarios, applicable motion checks, and `pnpm verify --gate` results are not run by this worker.

## Commits

- `623bfe20d` - `refactor(stage-ui): declare upstream persistence exceptions by owner`.
- `dcfaebb3a` - `test(stage-ui): reject new fork state in the plain persistence tier`.
- `64f7f2530` - `refactor(stage-ui,stage-pages,stage-tamagotchi): persist analytics consent through one leader document`.
- `e8d5082c2` - `refactor(stage-ui-mmd,stage-ui,stage-tamagotchi): persist MMD realisation settings through leader actions`.
- `252e09c93` - `refactor(stage-ui-mmd,stage-ui): keep derived clip metadata in synced memory`.
- This final record commit - `docs(stage-ui): record the store tier decisions and close S2`. Its hash is included in the worker handoff.
- `dcfaebb3a` - `test(stage-ui): reject new fork state in the plain persistence tier`.
