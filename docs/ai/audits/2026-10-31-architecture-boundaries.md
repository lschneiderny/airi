# Architecture and boundary audit (2026-10-31)

Scope: the architectural decisions and ownership models of every system the fork built since the fork point `f3e6a244e` (2026-10-14), checked against the code on `main` at `b82a863dc`. The question was not "does it work" but "do the boundaries we set still make sense, and does the code still respect them". The host-support question (which apps, servers, and integrations the fork keeps) was in scope by the owner's choice.

Method: seven lenses, each run as stated rule (ADR or package guide) -> code evidence (file:line) -> verdict -> decision candidate. Lenses 1 and 6 were run by the orchestrator with scripted scans. Lenses 2, 3, 4, 5, and 7 were run read-only by independent auditors; the orchestrator re-verified the five findings marked **(re-verified)** against the source. Per-lens evidence with every citation lives in `.omo/evidence/arch-audit-2026-10-31/` (git-ignored). Line numbers in this document refer to `main` at audit time.

Status update (2026-10-31, after the audit): the owner retired Kirie (H4) in `5c850be74` and `9f020c5b8`. `docs/ai/upstream-watch.md` records when to port it back. Lens 4 still shows Kirie as it stood at `b82a863dc`.

Verdict vocabulary: **holds** means the code implements the stated rule; **drifted** means the code differs from it; **undocumented** means the code has a rule no ADR states; **stale-doc** means an ADR states a rule the code no longer has; **never stated** means no rule exists where one is needed.

## Executive summary

- **The package layering holds.** `core-agent` imports nothing from `stage-*`; `stage-ui-live2d` imports nothing from `stage-ui`; no package depends on `qa-tools`; the pure cores in `stage-shared` contain zero `Math.random`, zero clock reads, and zero Vue or Pinia imports. The three-layer split (pure core -> store integration -> renderer) is the fork's best decision and should stay.
- **`stage-shared` is misdescribed.** 73 of its ~140 source files are fork domain logic (situation 25, expression-performance 28, motion-scenario 12, plus contract, placement, and performance-state). Its guide still calls it "stage contracts and runtime-neutral helpers". The pure-core invariant is true per module but not per subpath: the `expression-performance` barrel re-exports a `BroadcastChannel` transport that pulls `@moeru/eventa` through a devDependency.
- **Every fork system converges on two files with no stated limit.** `stores/chat.ts` (+378 lines since the fork point) imports situation, memory, memory tools, the stage contract, and two observability stores. `chat-orchestrator-runtime.ts` grew from 1,337 to 1,619 lines for unprompted handling. Neither has a responsibility boundary in writing.
- **The LLM prompt has no owner.** `composeSystemPrompt` fixes only four segments. Everything after them is ordered by eight separate concatenation sites across four packages. The offline eval composes a different prompt from production, the Spark Notify agent has a third assembly, and `chat.ingest` sends no memory prompt and no output cap. Only five budgets are enforced in code; the card, the memory index, toolset prompts, the sticker list, and conversation history are unbounded.
- **`core-agent` is no longer pure chat coordination.** With clean imports it still hardcodes the ACT/DELAY recovery names, the `<|SILENT|>` decline marker, the English sticker prompt, the ACT compliance buckets, and the Spark instruction. The stage contract's semantics live in two packages.
- **The Natural ownership contract is spread across six ADRs with 18 supersession edges, two of them edited in place.** Most per-channel rules hold in code. Three do not: posture is an absolute overwrite at full weight (erasing expression tilts and the beat-sync bob), the SDK breath pass is deleted for every driver against the v2 non-goal, and the 0.7 s speech-mouth window is defined twice on two clocks.
- **"Delete all data" does not delete the extracted conversation threads and social memory.** `settings/situation-inner` has a `reset()` with no caller, and delete-all also leaves the presence settings, the expression-performance settings, and the per-model expression catalogs. This is the one finding that is a user-facing privacy gap rather than an architecture question.
- **Ten persistence tiers exist and no rule says how to pick one.** Four use localStorage and differ only in who may write.
- **The foreground sampler runs eight synchronous koffi calls plus `app.getAppMetrics()` on the Electron main thread once per second, also while the stage is hidden.** The v2 ADR non-goal "no new main-process polling" holds by the letter and not in spirit; the presence ADR states the hidden polling without reconciling the two.
- **Only Electron runs every fork system.** stage-web and Pocket initialize the situation store and send a mostly empty situation block on every turn; Kirie excludes presence entirely. The non-Electron surfaces total about 1,790 tracked files and 266 tests, cost ten root vitest projects and two verify configs, and took 13 keep-alive fixes in three weeks. The Godot engine in `engines/` is not part of Kirie: it is a separate VRM sidecar that Electron launches from settings and packages. `server/` is still type-linked from `stage-ui`.

## Lens 1 and 6: package layering and pure-core purity

Source: `.omo/evidence/arch-audit-2026-10-31/lens1-6-layering-purity.md`.

| Rule | Where stated | Evidence | Verdict |
| --- | --- | --- | --- |
| `core-agent` does not depend on stage packages | `core-agent/AGENTS.md` ("hosts own persistence and UI") | `package.json` deps: provider-inference, pipelines-audio, plugin-protocol, server-sdk, server-shared, stream-kit. Grep of `src` for `@proj-airi/stage-`: 0 matches. | holds |
| `stage-ui-live2d` does not depend on `stage-ui` | performer/conductor split, expression ADR | deps: stage-shared, model-driver-magic-live2d, ui. Grep: 0 matches. | holds |
| No product package depends on `qa-tools` | root `AGENTS.md` | `"@proj-airi/qa-tools"` appears only in its own `package.json`. | holds |
| Deciders and resolvers never read clocks, randomness, or stores | `stage-shared/AGENTS.md`, expression ADR §Decision seam | 0 `Math.random` in all of `stage-shared/src`; 0 `Date.now`/`performance.now` in the six fork core dirs; 0 `vue`/`pinia`/`@vueuse` imports in them; 0 timers. `situation/render.ts:44` formats `new Date(nowMs).getHours()`, so the block's `HH:MM` depends on the host time zone (intended: user-local time). `situation/reasons/rituals.ts:17` uses UTC arithmetic explicitly to avoid that. | holds |
| "Keep feature UI state in `stage-ui`" | `stage-shared/AGENTS.md` anti-patterns | The fork added Pinia holder stores `stores/foreground-window.ts` and `stores/desktop-activity.ts`, following the upstream `screen-ambient-light` store precedent. The natural motion v2 ADR sanctions the desktop-activity holder. `vue`, `pinia`, and `@vueuse/core` are runtime deps of stage-shared. | documented bend; the guide and the ADR disagree on where a host-written holder belongs |
| The decider subpath is pure | expression ADR §Decision seam | `expression-performance/index.ts:1` re-exports `affect-trace-diagnostics`, which imports `@moeru/eventa` and `@moeru/eventa/adapters/broadcast-channel` and takes a DOM `BroadcastChannel` (`:45`). `@moeru/eventa` is only a devDependency of stage-shared. `motion-scenario/bridge.ts` carries a window-local `EventTarget` context beside the scenario schema. | drifted at the barrel; the functions are pure, the entry point is not |
| Package purpose | `stage-shared/AGENTS.md` overview: "Stage contracts and runtime-neutral helpers" | Fork-added files per dir: expression-performance 28, situation 25, motion-scenario 12, performance-state 2, stage-contract 2, stage-placement 2, stores 2. | stale-doc: the package is the client domain layer |

Convergence (orchestrator measurement, `git diff --numstat f3e6a244e..HEAD`):

| File | Lines at fork point -> now | Fork-relevant imports |
| --- | --- | --- |
| `packages/stage-ui/src/stores/chat.ts` | 1,179 -> 1,315 (+378/-79) | core-agent, stage-shared/situation, stage-shared/stage-contract, ./situation, ./memory, ../tools/memory, ./devtools/situation-observability, ./devtools/memory-observability |
| `packages/stage-ui/src/stores/chat/session-store.ts` | 1,686 (+115/-28) | stage-shared/stage-contract |
| `packages/stage-ui/src/stores/situation/index.ts` | 0 -> 961 (+1,023) | all fork |
| `packages/stage-ui/src/stores/mods/api/context-bridge.ts` | 1,191 (+195/-17) | notify routing, holds, widget reactions |
| `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` | 1,337 -> 1,619 (+367/-85) | origin, trigger, decline, read-only tools |

## Lens 7: the LLM-facing surface

Source: `.omo/evidence/arch-audit-2026-10-31/lens7-llm-surface.md`. Abbreviations: `rt` = `core-agent/src/runtime/chat-orchestrator-runtime.ts`, `chat` = `stage-ui/src/stores/chat.ts`, `sc` = `stage-shared/src/stage-contract/index.ts`.

What the model receives on an Electron leader turn, in order:

| # | Segment | Composer | Budget | Enforced? |
| --- | --- | --- | --- | --- |
| S1-S2 | Code-block and math formatting rules | `composeSystemPrompt` sc:43-46 | fixed text | n/a |
| S3 | Persona / card prompt | `getSessionSystemPrompt` session-store:231-235 | none | no |
| S4 | Stage contract, reply-shape rules last | `renderStageContract` sc:28-31; pinned by `STAGE_CONTRACT_EN_SHA256` sc:49 | none | hash-tested, not size-capped |
| S5 | Memory rules and index | `composeMemoryPrompt` tools/memory.ts:33-45; joined only in `resolveStep` chat:1055 | 150 chars per entry description | yes per entry; no cap on count or total |
| S6-S9 | Supplement: toolset prompts, account context, voice context, unprompted instruction and plugin text | chat:1010-1021 (a second builder at chat:891 for `ingest`) | none | no |
| S10 | Sticker catalog, English text hardcoded | rt:1110-1118; random inclusion `stickers.ts:113-114` | none | no |
| S11 | Supplement appended to the system prompt | rt:1120-1126 onto the stored system turn **and** rt:1178-1183 onto the resolved step **(re-verified)** | n/a | the adapter replaces the composed message with the resolved one per step (`chat-completions.ts:90-95`), so the two copies agree only because one is discarded |
| H | Conversation history | `buildContext` rt:635-647 | none; `compactConversationEntries` has no production caller | no |
| T | Unprompted trigger `(No one spoke to you. You may speak up about: <topic>)` | chat:1186; topic text `unpromptedTopicText` situation:108-112 | none | committed only when spoken |
| R | Situation block on the last user turn | provider chat:331-345; attached rt:1128-1133; rendered `render.ts:199-280` | 6 lines / 500 chars | yes |
| TL1-TL5 | Tools: MCP, debug, spark, Tavily, custom, memory, expression, hosted web_search; unprompted turns get only `builtIn_readMemory` (chat:1084) | `tool-resolver.ts:151-181`; `use-stage-performance-conductor.ts:542-569` | none | no |
| O | Output cap `REPLY_MAX_TOKENS = 320` | sc:25, chat:1059 | 320 tokens | yes, provider-side |

Findings:

| Finding | Evidence | Verdict |
| --- | --- | --- |
| No single composer orders the prompt | eight concatenation sites: session-store:201-203, chat:1055, chat:1010-1021, chat:891-893, rt:1119, rt:1120-1126 and rt:1182, `tool-resolver.ts:167-177`, `orchestrator/store.ts:185-189` | never stated |
| The eval prompt is not the production prompt | `qa-tools/src/model/stage-contract.ts:36-41` composes card + contract only; S5-S11, R, and tools are absent | drifted from the model-eval ADR's "runtime oracle" intent |
| Spark Notify assembles its own system prompt | `character/orchestrator/store.ts:185-189` joins card + contract + memory without `composeSystemPrompt` (S1-S2 missing), reads the **active** card's memory, passes no `maxTokens` | drifted |
| `chat.ingest` bypasses `resolveStep` | chat:873-912: no memory prompt, no 320-token cap | undocumented |
| Cache layout | stable prefix S1-S4 holds; S5 changes on every memory write; S8-S10 change per request at the tail of the system message | holds for the prefix; the tail is per-request |
| Memory privacy rule is prompt text only | "no window titles or secrets" at tools/memory.ts:40-41 has no code filter | stated rule, no enforcement |
| Forced plugin reactions use the raw notify headline as trigger text | `context-bridge.ts:409` **(re-verified)**: `topicText = headline + note`, bypassing `unpromptedTopicText`, which hides web-extension titles for gate-fired topics. The web extension's notifies route as character-only and go through the gate, so this reaches local history only for plugins that request widget reactions. | undocumented gap |
| Plugin `appendSystemInstructions` enter the system message | `context-bridge.ts:418` -> chat:1019 | never stated: plugin text has system authority |
| Window-title privacy | block never stored; trigger and reply excluded from cloud sync `wire-message.ts:80-82`; browser sharing gated | holds |
| Presence ADR says unprompted turns carry no tools | ADR:123 vs `builtIn_readMemory` chat:1084 | stale-doc |
| `core-agent` holds stage semantics | `recoverCueNames: ['ACT','DELAY']` rt:1075; `<\|SILENT\|>` rt:29; sticker prompt rt:1110-1117; `cue-compliance.ts:7-38`; `cue-contract-fixtures.ts:5`; Spark "life pod" instruction `spark-notify/agent.ts:87-94`. The emotion vocabulary that defines a valid ACT lives in `stage-shared` sc:3-16. | drifted from "runtime orchestration, conversation projection" |

Hosts: S1-S5 and the tools reach every host through the shared chat store. Unprompted turns run only where `setHostCapabilities({ unprompted: true })` is called, which is `apps/stage-tamagotchi/src/renderer/App.vue:385` and nowhere else. stage-web (`App.vue:148`) and Pocket (`App.vue:120`) initialize the situation store, so they lead and send a block that `renderSituation` always starts with the `[Situation HH:MM]` header; without desktop or foreground readers it holds little else (inferred from code, not run). Kirie never initializes the store and sends no block.

## Lens 5: the Natural motion and expression ownership contract

Source: `.omo/evidence/arch-audit-2026-10-31/lens5-natural-expression-contract.md`, which holds the full 15-row per-channel table and the 18-edge supersession chain. Abbreviations: ADP = `stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, MV = `components/scenes/live2d/Model.vue`, MM = `composables/live2d/motion-manager.ts`, RIG = `natural-motion/rig-profile.ts`.

Per-frame order as the code runs it (one Natural-driven frame, expression system on):

> restore expression bases -> beat sync / idle disable -> motion clip -> (idle focus) -> **expression composer -> blink -> light squint -> manual control -> lipsync -> manual breath** -> `saveParameters` -> **Natural overlay inside `updateFocus`** -> physics -> pose -> trace sample -> `loadParameters`

No document lists this order. The v2 ADR and the expression ADR each describe half of it, and the five non-Natural final plugins (blink, squint, manual, lipsync, breath) appear in no ownership ADR.

| Channel | Rule as the ADRs state it now | Verdict | Note |
| --- | --- | --- | --- |
| Head XYZ, body XYZ, eyes XY | Natural owns posture; clip-owned axes keep a 10% residual; physics outputs are never written | holds, with one **undocumented** precedence: at full weight the adapter **overwrites** (`written = this.weight === 1 ? natural : ...`, ADP:395 **(re-verified)**) while face channels compose additively (ADP:410-419). Expression-authored head tilts and eyeball moves and the beat-sync head bob are erased under Natural. MV:573-585 also renames idle `ParamEyeBall*` curves with a FIXME. | decide and write down the precedence |
| Eyelids | Natural composes on what motion and plugins leave; 0.15 closed threshold, 0.2 floor; blink only with auto-blink on | holds; **undocumented**: three other eyelid writers run before Natural (light squint MV:615-621, manual control, the masked blink plugin) and no ownership ADR names them | |
| Brows, eye smile, mouth form | Natural micro-offsets plus hints, pet, held face | holds; a rig with a single `ParamEyeSmile` gets no Natural eye smile (RIG:41-42 vs MV:774) | |
| Mouth open | lipsync owns it while speaking and for 0.7 s after | holds; **undocumented coupling**: the 0.7 s window is defined twice, ADP:104 on SDK seconds from `speechEndedAtSeconds` and MM:757/762 on accumulated `timeDelta` | the only channel where two writers coordinate by a coincidence of constants |
| Cheek | pet and held emotion only | holds; **stale-doc**: the touch ADR (:81) describes v2 text that was rewritten in place at v2:120, and the emotion revamp never lists its held-cheek change | |
| Breath | Natural writes unless manual breath is active | holds; **undocumented**: the write is absolute (ADP:418-419), and `disableLive2DSdkBreath` (MV:531) runs for every driver, against the v2 non-goal "no change to Universal or MAGIC" | check against the breath-control ADR before changing |
| Physics outputs | never written by Natural | holds (RIG:129-131, ADP:223-227) | |
| Expression-owned params | composer from the frame base, max-of-owners strength, masked claims | holds; **drifted**: expression ADR:184 calls `applyExpressions` "the final" plugin; it is the first of six final-stage plugins (MV:609-624). `stage-ui-live2d/AGENTS.md:30` says expressions layer over blink; blink runs after them. `AGENTS.md:32` says additive expressions use model defaults; the composer uses the frame base. | |
| Blink ownership | Natural blink replaces the SDK and plugin blink | holds through an indirect two-path mechanism (`markHandled()` MM:388-393 makes the SDK skip `eyeBlink`) that no ADR describes | |

Supersession chain: 18 edges. Two accepted ADRs were edited in place (v2:120, expression:117). One pointer dangles (expression:136 names an energy overlay the band table never had), one is mislabelled (emotion-revamp:139), and the auto-setup ADR cites expression ADR line numbers that have moved (:20-23). The eligibility rule is split across the auto-setup and combos ADRs with no single statement. Four settings commands (`create-combo`, `update-combo`, `update-custom`, `delete-custom`) appear in the README and never in an ADR command table.

Boundary: the conductor imports the performer's Pinia stores directly (`use-stage-performance-conductor.ts:12-13`) and reads `expressions.catalog` and `modelId` from them, so the catalog's source of truth is the performer package, not stage-shared or the conductor.

## Lens 2: state ownership

Source: `.omo/evidence/arch-audit-2026-10-31/lens2-3-state-and-process.md`, which holds the 14-row store matrix.

Persistence tiers in use:

| Tier | Members | Deliberate? |
| --- | --- | --- |
| Leader-only memory, unsynced | `useSituationStore` | yes (presence ADR:66-67) |
| Per-window memory, unsynced | desktop-activity and foreground-window holders, IO tracer view | yes for sensors; the tracer has no ADR |
| Synced Pinia memory, not persisted | `usePerformanceRuntimeState`, `useNaturalPerformanceOverride` | runtime state yes (expression ADR:354); override has a doc comment only |
| Synced settings document, leader-routed `update`/`reset`, Valibot | `settings/situation`, `settings/expression-performance` | yes (expression ADR:399-401); the presence ADR reuses it without saying so. **The fork's best-specified pattern.** |
| Plain `useLocalStorageManualReset` refs, any window | Natural `settings/live2d/natural-*`, `memory/enabled` | no; upstream convention carried forward |
| localStorage by explicit command with a leadership token | `settings/situation-inner` (threads, rituals, social memory, extraction ledger) | yes (cadence ADR:63-65, :200-203) |
| localStorage per model, stage writes, followers send commands | `expression-catalog:<id>`, `expression-rest:<id>` | yes (expression ADR:214-254) |
| IndexedDB (localforage), any-window writes, BroadcastChannel invalidation | `airi-memory` | storage choice yes (memory ADR:24); the any-window write model with no lock or leader routing is not stated |
| IndexedDB (unstorage) behind a synced store with leader-routed actions | chat sessions, control records | upstream; the fork bounded control records |
| Main-process ring plus disk recording | IO trace hub | commit-level design only |

Ten tiers. Four use localStorage and differ only in who may write and how the write is guarded. No ADR gives a rule for choosing.

| Finding | Evidence | Verdict |
| --- | --- | --- |
| **Delete-all leaves derived personal state behind** | `use-data-maintenance.ts:127-134` resets the memory store (`:77`) and chat sessions (`:84-87`) but not `settings/situation-inner`, `settings/situation`, `settings/expression-performance`, `expression-catalog:*`, or `expression-rest:*`. `useSituationInnerState.reset` (`features/situation/inner-state.ts:215`) has no caller in `stage-ui/src` **(re-verified)**. Deleting chat sessions also leaves the threads extracted from them. | drifted from the intent of "Delete all data" |
| The presence ADR says nothing survives a restart | presence ADR:67 vs cadence ADR:63-65, which persisted gate memory, threads, and rituals; the store doc (`situation/index.ts:217`) reconciles them, the ADR was not amended | stale-doc |
| `usePerformanceRuntimeState` replicates a value sampled every 2 s | `runtime-state.ts:63-64` `state: true`; mood sampled at `use-stage-performance-conductor.ts:640, :688`; JSON diffing in `publish` limits traffic | soft violation of the pinia-synced skill's transient-state rule, accepted by the expression ADR |
| `emotionPulse` is an event stored in replicated state | `natural-performance-override.ts:33-35`; the devtools follower writes it directly, the stage watches it; a snapshot replay can re-deliver the last pulse; no multi-window convergence test was found | the replay hazard the skill's test rule targets |
| Memory writes come from any window with no lock or leader routing | `memory.ts:77-109`, `memory.repo.ts` | low risk today because only the leader runs chat; not stated in the memory ADR |
| Pinia-synced skill: watchers, leadership modes, caps on control records and the tracer | `situation/index.ts:294-305`, `session-store.ts:60, :66`, `io-tracer.ts:14`, `window-context.ts:54` | holds |

## Lens 3: the Electron main/renderer boundary

Eventa contracts added since the fork point (6 files, +127/-4), grouped:

| Group | Contract | Driver and cadence | Runs while the stage is hidden? |
| --- | --- | --- | --- |
| Idle time | `electron.powerMonitor.getSystemIdleTime` | stage renderer polls at 1 s (`renderer/stores/desktop-activity.ts:156-164`) | no (`:195-199`) |
| Foreground window | `electron.foregroundWindow.sample` | stage renderer polls at 1 s while `shareForegroundWindow` (`pages/index.vue:131-135`) | **yes**, on purpose (presence ADR:87) |
| Chat attention target | `electronGetChatAttentionTarget` invoke, `electronChatAttentionTargetChanged` event | main pushes on chat window events, deduplicated | push-only |
| IO trace hub | `ioTraceHubPublish`, `ioTraceHubSpan`, get/set/subscribe/unsubscribe, recording changed/get/set | every window publishes each ended span; viewers subscribe on demand | yes while collecting |
| Other | `electronAppGetVersion`; opencode-go configuration, open, read-chunk, cancel | on demand; one invoke per streamed chunk | n/a |

| Finding | Evidence | Verdict |
| --- | --- | --- |
| Synchronous FFI on the main thread at 1 Hz, also while hidden | Windows sampler `foreground-window-win32.ts:44-56`: `GetForegroundWindow`, `GetWindowTextLengthW`, `GetWindowTextW`, `GetWindowThreadProcessId`, `OpenProcess`, `QueryFullProcessImageNameW`, `CloseHandle`, `SHQueryUserNotificationState`, plus `app.getAppMetrics()` in `isOwnProcess`. macOS: NSWorkspace, CoreGraphics, and AX reads that can block on a hung app. | the one fork contract that can stall the UI process |
| "No new main-process polling. The renderer polls idle time only while the stage is visible." | natural motion v2 ADR:96, :179 vs presence ADR:87 | holds by the letter (main never polls; a renderer invoke drives it); not in spirit since `1232e71fa`. Neither ADR names the other. |
| The desktop-activity contract | polling stops while hidden | holds |

## Lens 4: host matrix and surface cost

Source: `.omo/evidence/arch-audit-2026-10-31/lens4-host-matrix.md`, which holds the full matrix and per-surface cost table. E = Electron main window, W = stage-web, P = Pocket, K = Kirie.

| System | E | W | P | K |
| --- | --- | --- | --- | --- |
| Natural motion | wired | degraded: no desktop activity, no chat target, no screen placement | degraded, also no `cursor-position` | wired on the Live2D path; the Godot path is unverified |
| Expression performance | wired | wired | wired | wired on Live2D |
| Situational presence | wired | degraded: store initialized (`App.vue:148`), Presence page excluded (`vite.config.ts:173`), no producers | degraded, same | excluded: no init, page excluded (`kirie.config.ts:153`) |
| Unprompted turns | wired: the only `setHostCapabilities` call (`App.vue:385`) | excluded | excluded | excluded |
| Long-term memory | wired | wired | wired for chat | wired for chat |
| Stage contract / composer | wired | wired | wired | wired |
| IO trace hub | wired | degraded: BroadcastChannel only, no hub, no recording | degraded | degraded |
| Touch / cursor attention | wired | in-window only | focus only | wired on Live2D |

Host gating lives in three route-exclude lists (`stage-web/vite.config.ts:167-175`, `stage-pocket/vite.config.ts:156-171`, `kirie.config.ts:147-158`), one capability flag, four Electron-only producers, and 73 runtime host checks in 34 files under `packages/` (17 of them in `stage-shared/src/beat-sync/detector.ts`).

Per-surface cost, from `git ls-files` and `git log --since=2026-10-10`:

| Surface | Tracked / tests | Root wiring | Keep-alive fixes in three weeks | Electron depends on it? |
| --- | --- | --- | --- | --- |
| `apps/stage-web` | 78 / 6 | default `pnpm dev`; `test:run` suite; verify extra config; fakemic audio tests need its build | 1 | no; only W uses `model-driver-mediapipe` |
| `apps/stage-pocket` + `packages/cap-vite` | 184 / 5 | 4 root scripts, Swift/Kotlin lint, one root vitest project | 0, but every shared-routing feature added a Pocket exclude or init | no |
| `apps/stage-tamagotchi-kirie` | 302 / 49 | own `test:run` suite and verify config | 5 (the most of any surface) | no workspace edge; `godot-view-patch-queue.ts` is duplicated in both apps |
| `engines/stage-tamagotchi-godot` | 172 / 0 | `build:engines`, `typecheck:engines` | 0 | **yes**: `main/index.ts:234` spawns it, `electron-builder.config.ts:158` packages it |
| `apps/ui-server-auth` | 54 / 7 | root vitest project | 1 | no |
| `server/**` | 416 / 100 | `./server/**` in build, typecheck, verify; 2 root vitest projects | 2 | **partly**: `stage-ui` type-imports `api-server` (`composables/api.ts:1`, used by `stores/auth.ts`, `characters.ts`, `providers/config.ts`, `flux.vue`) and depends on `server-sdk-shared` in production (`libs/chat-sync/*`, `session-store.ts:1`) |
| `services/computer-use-mcp` | 208 / 54 | typecheck filter, verify, root vitest project | 1 | no workspace edge; Electron computer use runs `@auv-js/cli`; a user `mcp.json` may name it |
| `integrations/minecraft` | 167 / 30 | root vitest project | 4 | no package edge; runtime link through the server channel and the presence Minecraft sensor |
| `integrations/{telegram,twitter,satori,discord,vscode}` | 166 / 2 | 2 inline root projects | 1 | no |
| `plugins/airi-plugin-web-extension` | 39 / 1 | inline root project | 1 | no package edge; **runtime input to Electron presence** |
| other plugins, `apps/component-calling` | 33 / 0 | build/typecheck via `./apps/*` | 0 | no |

Packages with zero dependents: `input-playstation-dualsense-5` (root vitest project), `memory-pgvector`, `unocss-preset-fonts` (check `uno.config.ts` loads it by path before removing). `cap-vite` serves only Pocket; `model-driver-mediapipe` only W. Keep `scenarios-stage-tamagotchi-browser` (`capture:tamagotchi` writes into it) and `qa-tools`.

Not established by this audit: whether Natural runs on Kirie's Godot renderer path; whether `context-bridge.ts:413` fires on W and P without the capability; whether the owner uses computer-use-mcp, Minecraft, or the web extension at runtime.

## Decisions to revisit

Each row is a decision candidate with the orchestrator's recommendation. Sizes: S (under 1 h), M (a day or less), L (needs a plan). "Doc" means the change is to an ADR, README, or guide only.

### Keep

| # | Decision | Rationale |
| --- | --- | --- |
| K1 | The three-layer split: pure core in `stage-shared`, store integration in `stage-ui`, renderer in `stage-ui-live2d` | The imports prove it holds and the pure cores are pure. Nothing here needs to move. |
| K2 | Leader-only in-memory situation observations | Titles must not replicate (cadence ADR:202). Keep the observation model; fix the documentation (R7) and the reset coverage (R1). |
| K3 | The prompt cache layout: stable S1-S4 prefix, situation block on the last user turn | Matches the presence ADR intent. Fix only the per-request tail (R3). |
| K4 | The `updateFocus` wrapper and the clip-curve mask | Correctly documented `NOTICE` workarounds that match the SDK order. |
| K5 | The synced settings-document tier (`settings/situation`, `settings/expression-performance`) | The fork's best-specified pattern; make it the default (R6). |
| K6 | The engine `engines/stage-tamagotchi-godot`, only while Godot Stage is in use | It is a VRM-only sidecar that Electron starts from settings, unrelated to Kirie. Packaging requires it only because of the fork's `8f59615d1`. If Godot Stage is never used, it, its settings entry, and that packaging rule can be retired together. |

### Revise

| # | Decision | Size | Rationale |
| --- | --- | --- | --- |
| R1 | **Register every persisting fork store with `useDataMaintenance`**: `settings/situation-inner`, `settings/situation`, `settings/expression-performance`, `expression-catalog:*`, `expression-rest:*`; also drop extracted threads when their sessions are deleted | S | "Delete all data" currently keeps derived conversation state. Privacy and correctness, not style. |
| R2 | **One prompt composer with declared per-segment budgets**, used by chat, `ingest`, Spark Notify, and `qa-tools` | L | Eight concatenation sites, an eval prompt that is not the production prompt, an `ingest` path with no memory and no cap, and a double supplement append. Put it in `stage-shared` beside `composeSystemPrompt`, or in one `stage-ui` module that the others call. |
| R3 | Move the per-request supplement parts (voice context, unprompted instruction, random sticker catalog) behind the stable prefix in a fixed order, or onto the trailing user turn; make the supplement attach once | S | The tail of the system message changes per request for no cache benefit, and correctness of the double append depends on the adapter discarding one copy. |
| R4 | **Pull stage semantics out of `core-agent`** behind host-supplied config: cue recovery names, decline marker, sticker prompt text, Spark instruction; move the compliance buckets to `stage-shared` or keep them with a stated exception for the eval oracle | M | `core-agent` imports cleanly but owns half of the stage contract. `qa-tools` can still replay the real runtime with the config injected. |
| R5 | Rename or split `stage-shared`: either describe it as the client domain layer in its guide, or split `situation` and `expression-performance` into their own packages; move `affect-trace-diagnostics` out of the decider barrel and declare `@moeru/eventa` as a dependency where it stays | M (doc S) | 73 fork files of domain logic under "runtime-neutral helpers"; the decider entry point drags in a transport through a devDependency. |
| R6 | **Write a tier-selection rule** (short ADR) and fold `settings/live2d/natural-*` into a synced settings document; record `settings/situation-inner` as the named unsynced exception; record the memory write model (any window, BroadcastChannel invalidation, no lock) in the memory ADR | M | Ten tiers, four of them localStorage with different guards, and no rule. New features keep inventing one. |
| R7 | **One living Live2D parameter-ownership document** (per-channel table and per-frame order) that the ADRs link to; stop editing accepted ADRs in place; fix the dangling pointers (expression:136, emotion-revamp:139, auto-setup:20-23), the "final plugin" sentence (expression:184), and `stage-ui-live2d/AGENTS.md:30, :32` | M (doc) | The effective rule for one channel needs five documents today, and two were rewritten in place. |
| R8 | Decide Natural's precedence over expressions and beat sync on posture channels, and write it down: either "Natural owns posture absolutely under Natural" or compose additively like the face | S (doc) or M (code) | ADP:395 overwrites at full weight and nothing says so. The absolute rule is cheaper and probably right. |
| R9 | Give the speech-mouth handoff one owner: lipsync publishes "owned this frame", the adapter reads it | S | Two copies of 0.7 s on two clocks. |
| R10 | Document or gate `disableLive2DSdkBreath` to Natural | S | It runs for every driver against the v2 non-goal; check the breath-control ADR first. |
| R11 | Give `chat.ts` and `chat-orchestrator-runtime.ts` a stated responsibility boundary: either move presence/unprompted/memory integration into a module that calls chat actions, or name them the integration hubs in the guides and accept it | M (doc S) | Every fork system converges there with no limit, and the next one (touch observations) will too. |
| R12 | Reconcile the two polling rules in writing, back off foreground sampling while the stage is hidden, and plan `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` for push-based sampling later | S now, M later | Eight synchronous koffi calls plus `getAppMetrics()` on the main thread at 1 Hz while hidden; freshness is already relaxed to 20 s while hidden (presence ADR:93). |
| R13 | Move `mood` out of `usePerformanceRuntimeState` or publish it only when consumed | S | The only periodic producer in a `state: true` store. |
| R14 | Back the prompt-only privacy rules with code: a memory write filter for titles and secrets; route `context-bridge.ts:409` topic text through `unpromptedTopicText`; state whether plugin `appendSystemInstructions` may carry system authority | S each | Stated rules with no enforcement. |
| R15 | Update stale ADR statements: presence ADR:123 (unprompted turns now carry `builtIn_readMemory`), presence ADR:67 (inner state persists), rt:678-681 comment about a system-prompt date anchor that does not exist | S (doc) | |

### Retire

| # | Decision | Size | Rationale |
| --- | --- | --- | --- |
| T1 | Spark Notify's private prompt assembly (`orchestrator/store.ts:185-189`) in favor of the shared composer | S after R2 | Missing S1-S2, wrong card's memory, no output cap. |
| T2 | `emotionPulse` as replicated event-state; replace with an Eventa or BroadcastChannel event from devtools to the stage | S | Replay hazard; the inspector bus already uses the right mechanism. |
| T3 | The expression-system-off path under Natural | M | Default-on since the auto-setup ADR; the off path doubles every eyelid and expression ownership argument for a configuration new profiles never use. |
| T4 | The conductor's direct import of the performer's Pinia stores (`use-stage-performance-conductor.ts:12-13`) | M | The catalog's source of truth should sit behind the scene interface, not in the performer package. |

### Host scope (product decisions, ordered by cost saved relative to risk)

These are product calls, not code findings. The recommendation column is the orchestrator's.

| # | Surface | Recommendation | Prerequisite or risk |
| --- | --- | --- | --- |
| H1 | Dead leaves: `input-playstation-dualsense-5`, `memory-pgvector`, `unocss-preset-fonts`, `apps/component-calling`, `integrations/{satori,discord,telegram,twitter,vscode}`, `plugins/{claude-code,bilibili-laplace}`; the stage-ui Discord and Twitter settings stores and pages | **Retire** | About 250 tracked files, 3 root vitest projects, no Electron edge. Check `uno.config.ts` for the font preset. |
| H2 | Pocket + `cap-vite` | **Retire** | About 184 files, 4 root scripts, Swift/Kotlin lint; every shared-routing feature had to add a Pocket exclude. No Electron edge. |
| H3 | `server/**` + `apps/ui-server-auth` | **Retire, after a prerequisite** | About 470 files, 107 tests, `./server/**` in build/typecheck/verify. First remove the hosted client code in `stage-ui` (auth store, characters sync, flux page, chat-sync) or move `server-sdk-shared` into `packages/`. |
| H4 | Kirie app (keep the engine) | **Done: retired 2026-10-31** (`5c850be74`) | 302 files, 49 tests, 5 keep-alive fixes in three weeks, excludes presence and unprompted turns, migration still in progress. A freeze means no feature parity work and removal from `test:run` and verify extras. |
| H5 | `services/computer-use-mcp`, `integrations/minecraft` | **Freeze, then retire each one not in use** | Together about 375 files, 84 tests, 2 root vitest projects, 4 keep-alive fixes. Possible runtime links (user `mcp.json`; the presence Minecraft sensor). Only the owner knows whether they are used. |
| H6 | stage-web; keep `airi-plugin-web-extension` | **Freeze** as a browser preview: no feature parity, Presence stays excluded, `pnpm dev` moves to Electron | Small (78 files) but every shared-routing feature must handle it, and the multi-tab leader caveat in `upstream-watch.md` exists only because of it. Retiring it later needs the fakemic and `testing-audio` runners reworked. The extension stays because it feeds Electron presence. |

## What this audit did not do

- No build, test, or install ran. Every finding is from reading the source and git history.
- The auditor's line numbers were spot-checked for five findings; the rest are cited as reported in the evidence files.
- Whether Natural runs on Kirie's Godot renderer, whether web and Pocket ever call `submitUnprompted` through widget reactions, and whether the owner uses computer-use-mcp or Minecraft were not established.
- `qa-tools`, `cpu-slots`, and the dev launcher were checked only for dependency direction. Their internal design was audited on 2026-10-22 and is not repeated here.
