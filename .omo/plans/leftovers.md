# leftovers - Work Plan

## Status and links

Status: Part L1 done on 2026-11-20 on `luke/refactor/leftovers` (see [Commits](#commits)); its PR awaits the owner. Part L2, the macOS confirmation of the observer hashes, is open: an owner action, planned in outline below.

- Roadmap row: step L in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Done when: "Each is removed, merged, confirmed, or recorded as kept."
- Ruling on the web leftovers (owner, 2026-11-17: remove): the last paragraph of [Support scope](../../README.md#support-scope), recorded in `c3016c7ec`, and the status line of the [host capability contract ADR](../../docs/ai/adr/2026-11-08-host-capability-contract.md).
- Upstream rules: decision 14 of the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md#scope-and-order) (a change to an upstream file is named here with its reason) and the [upstream policy ledger](../../docs/ai/context/upstream-policy.md), including its [Decisions to revisit](../../docs/ai/context/upstream-policy.md#decisions-to-revisit).
- Checks: [Testing and QA](../../docs/ai/context/testing.md) and the [verify section of the dev-tools README](../../scripts/dev-tools/README.md#pnpm-verify).
- Branch: `luke/refactor/leftovers`, cut from `origin/luke/refactor/lab-tools` at `98f9bb93c`. That branch is PR #55 (research tooling moves to `@proj-airi/lab-tools`), stacked on PR #54 (`luke/refactor/testing-redesign`, which removes the cpu-slots broker and changes `pnpm verify`). The L1 PR targets `luke/refactor/lab-tools`.
- The owner is away and ruled "go without plan review". Every fork below takes the recommended option and is listed under [Decisions](#decisions), open to veto.

## The problem

Retiring the web app, removing the Live2D statistical runners, and the upstream sync left code and open questions behind. None of it is a feature. Each item either still costs something (dead branches in upstream files that every sync merges, a 2,400-line scorer that nothing runs, four copies of one enum that must change together) or is a question nobody has closed (the macOS run of the observer pins, the sync decisions, the analytics endpoints). Step L closes each one with one of four outcomes: removed, merged, confirmed, or recorded as kept.

## Upstream first

Read from the tree at `98f9bb93c`, which contains upstream `moeru-ai/airi` through `b3a6d6071`.

| Upstream has | Fork today | Step L |
| --- | --- | --- |
| `isStageWeb()` in `packages/stage-shared/src/environment.ts` and branches on it in nine files, including a browser beat sync detector that captures audio with `getDisplayMedia` | The same; `apps/stage-web` is retired (2026-11-16) | Removes the function and every branch (D2 to D4). Adds a ledger row, so a sync keeps them removed (D12) |
| Four `Emotion` enums, nine values each, in `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd`, and `stage-ui-spine` | The same four, each with the fork's `love`, `flustered`, and `sleepy` | One enum in `stage-shared`; the four files re-export it (D7). Adds a ledger row (D12) |
| No host capability contract, no Live2D emotion scorer, no process listings in QA tooling | Fork-only code | Changes them freely; no ledger row |

Upstream files this step changes, and why:

| Upstream file | Why | Item |
| --- | --- | --- |
| `packages/stage-ui/src/components/scenarios/chat/components/action-menu/index.vue` | Its dropdown is disabled only on the web app on mobile | 4 |
| `packages/stage-ui/src/components/scenarios/chat/components/assistant-item.vue`, `error-item.vue`, `user-item.vue` | A `select-none` class applies only on the web app's mobile variant | 4 |
| `packages/stage-ui/src/composables/use-build-info.ts` | The version carries the commit only on the web app | 4 |
| `packages/stage-ui/src/stores/mods/api/channel-server.ts` and its test | The server channel names the client `stage-web` when `isStageWeb()` | 4 |
| `packages/stage-ui/src/stores/mods/api/context-bridge.ts` and its contract browser test | The chat output events write `'stage-web': isStageWeb()` | 4 |
| `packages/stage-ui-live2d/src/composables/live2d/fit-model.ts` | The web app frames the model lower on narrow screens | 4 |
| `packages/stage-pages/src/vite/settings-search.ts` | A JSDoc example names `isStageWeb()` | 4 |
| `packages/stage-shared/src/beat-sync/detector.ts` | The browser detector and every web branch of the beat sync API | 5 |
| `packages/stage-shared/src/environment.ts` | `isStageWeb`, `getStage` (no caller), and `StageEnvironment.Web` | 5 |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` | It listens to beat signals off Electron, which only the browser detector served (D3) | 5 |
| `packages/stage-ui/src/constants/emotions.ts`, `packages/stage-ui-live2d/src/constants/emotions.ts`, `packages/stage-ui-mmd/src/constants/emotions.ts`, `packages/stage-ui-spine/src/constants/emotions.ts` | Each declares the same enum | 3 |

No Kept project calls `isStageWeb()` or declares an `Emotion` enum, so every change is in a Supported project (`packages/*`, `apps/stage-tamagotchi`). `apps/stage-web` is Retired, not Kept, and no longer exists.

## Inventory

Each leftover with its files and its decided outcome.

### 1. The `isStageWeb()` branches: removed

`isStageWeb()` returns true when `RUNTIME_ENVIRONMENT` is unset or `browser`. The Electron build sets it to `electron` (`apps/stage-tamagotchi/electron.vite.config.ts`), so in the desktop app every branch below is dead. It is true in Vitest browser tests and stories, where `RUNTIME_ENVIRONMENT` is unset.

| File | Branch | After L |
| --- | --- | --- |
| `packages/stage-shared/src/environment.ts` | `isStageWeb`, `getStage`, `StageEnvironment.Web` | Removed. `isStageTamagotchi`, `IS_DEV`, `isUrlMode`, and `StageEnvironment.Tamagotchi` stay |
| `packages/stage-shared/src/beat-sync/detector.ts` | The `StageEnvironment.Web` detector variant and its `getDisplayMedia` case; `getDetector`; the web branch of `toggleBeatSync`, `getBeatSyncState`, `updateBeatSyncParameters`, `listenBeatSyncStateChange`, `listenBeatSyncBeatSignal`, `getBeatSyncInputByteFrequencyData`; `isBeatSyncSupported` | Removed. `isBeatSyncSupported()` returns `isStageTamagotchi()`; the Electron path and the "Unknown environment" errors stay as upstream wrote them |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` | `onMounted` calls `listenBeatSyncBeatSignal` unconditionally | Listens only when `isBeatSyncSupported()`, as `packages/stage-ui/src/composables/use-modules-list.ts` already does (D3) |
| `packages/stage-ui-live2d/src/composables/live2d/fit-model.ts` | `startingOffsetY` is 0.75 on a narrow web viewport | The constant 1 |
| `packages/stage-ui/src/components/scenarios/chat/components/action-menu/index.vue` | `shouldDisableDropdownMenu` | Removed with its template condition |
| `packages/stage-ui/src/components/scenarios/chat/components/{assistant,error,user}-item.vue` | `isStageWeb() && props.variant === 'mobile' ? 'select-none sm:select-auto' : ''` | The class entry removed |
| `packages/stage-ui/src/composables/use-build-info.ts` | `version` with the commit on web | `version` |
| `packages/stage-ui/src/stores/mods/api/channel-server.ts` | Client name `StageWeb` on web | `WebSocketEventSource.StageTamagotchi` (D4) |
| `packages/stage-ui/src/stores/mods/api/context-bridge.ts` | `'stage-web': isStageWeb()` twice | `'stage-web': false` (D4) |
| `packages/stage-ui/src/stores/mods/api/channel-server.test.ts`, `context-bridge.contract.browser.test.ts` | Mock `isStageWeb` | The mock entry removed |
| `packages/stage-pages/src/vite/settings-search.ts` | JSDoc example | Names `isStageTamagotchi()` |

`packages/plugin-protocol` keeps its `'stage-web'` input-source field and `WebSocketEventSource.StageWeb` (D4).

### 2. The `web` host profile: removed

| File | What names `web` | After L |
| --- | --- | --- |
| `packages/stage-shared/src/host-capabilities/index.ts` | `'web'` in `HOST_IDS`, `HostFacts.platform`, the `'web'` case of `resolveHostCapabilities`, the `platforms` map of `capabilitiesForHost` | Removed |
| `packages/stage-shared/src/host-capabilities/reasons.ts` | `WebSandbox`, `WebPagePointerOnly` | Removed |
| `packages/i18n/src/locales/en/tamagotchi/settings.yaml` | `web-sandbox`, `web-page-pointer-only` | Removed. No other locale has them |
| `packages/stage-shared/src/host-capabilities/index.test.ts` | The `web` row and the `'web'` filter entry | Removed |
| `packages/stage-shared/src/host-capabilities/accept-cursor-reading.test.ts` | A degraded cursor with `web-page-pointer-only` | Another degraded reason code |
| `packages/stage-shared/src/host-capabilities/linux-desktop.test.ts` | `'web'` in a non-Linux host list | Removed |
| `apps/stage-tamagotchi/src/main/services/linux-desktop/geometry/ownership.test.ts` | `'web'` in two host lists | Removed |
| `apps/stage-tamagotchi/src/main/services/electron/screen.test.ts` | `capabilitiesForHost('web')` as the source of a degraded cursor | A `macos` profile with a degraded `cursorScreenPoint` |
| `docs/ai/adr/2026-11-08-host-capability-contract.md` | The `web` column of the parity matrix | Status line only: the `web` host id was removed in step L. The body stays (D5) |
| `packages/stage-shared/README.md` | Points at the ADR matrix | One sentence: the matrix's `web` column is history |

`HOST_IDS` also feeds the motion scenario schema (`packages/stage-shared/src/motion-scenario/schema.ts`, `bridge.ts`); no scenario or fixture names `web`. The presence notice stores dismissal keys as plain strings, and the desktop app never produced a `web:` key, so no stored data changes.

### 3. The three process-listing modules: one removed by #54, two kept and recorded

| Module | Users | What it does | After L |
| --- | --- | --- | --- |
| `packages/cpu-slots/src/processes.ts` | The cpu-slots broker | Liveness of slot holders | Already deleted with the broker in `170b69eb9` (#54) |
| `packages/qa-tools/src/env/processes.ts` | `doctor`, `host/run`, `mcp/session`, `session/app-session`, `stage/measure`, `t3/launch`, `t3/teardown` | Lists processes with command line and creation time for owned-process teardown. On Linux it reads only the current `qa:display` session's cgroups and the caller's descendants, and refuses without a session | Kept |
| `scripts/dev-tools/lib/processes.ts` | `pnpm dev:top` (`top.ts`), `pnpm wt` (`wt.ts`) | Snapshots every host process with CPU and memory and attributes it to a worktree | Kept |

The two remaining modules share little: the QA listing must never read the user's processes on Linux, and `dev:top` exists to read all of them. A merged module would carry both scopes and put a host-wide listing one import away from agent QA (D8). The reason goes into the qa-tools README's process discovery paragraph, so a later cleanup does not merge them.

### 4. The Live2D emotion gate code: removed, except one script kept

Everything below is in `packages/stage-ui-live2d`; PR #55 did not move it. `packages/qa-tools/src/stage/gates.ts` is a different file (desktop stage gates for MMD), which `lab-tools` uses, and is out of scope.

| Code | Used by | After L |
| --- | --- | --- |
| `emotionGate` (`natural-emotion`), `EmotionT3Gate`, `naturalEmotionT3Gate` (`natural-emotion-t3`), `unscoredRecipeEntries`, `buildEmotionChecks` and its helpers, in `src/composables/live2d/natural-motion/gates.ts` | `gates.test.ts`, `emotion-score.test.ts` | Removed |
| `src/composables/live2d/natural-motion/gates.test.ts` (83 lines) | Tests only `buildEmotionChecks` and `unscoredRecipeEntries` | Deleted |
| `src/composables/live2d/natural-motion/emotion-score.ts` (1,695 lines) and `emotion-score.test.ts` (645 lines) | `gates.ts` (`scoredChannels`) and the tests; nothing outside the package | Deleted |
| `scripts/score-natural-captures.ts` | Scores three rendered liveliness captures; the T3 capture harness that produced them was removed on 2026-11-17 | Deleted |
| `scripts/extract-natural-reference.ts` | Regenerates `reference-stats.ts` from exported desk recordings (`scripts/export-riggold-trace.py`); the idle liveliness test reads that file | Kept and recorded (D6): its input never came from a removed runner |
| `naturalIdleLivelinessGate`, `naturalTalkingGate`, `liveliness.ts`, `reference-stats.ts`, `liveliness-gate.test.ts`, `liveliness.test.ts`, `scripts/score-natural-trace.ts` | The idle liveliness test, which still runs | Unchanged |

The README's "Natural QA" section loses the emotion gate rows, the `score-natural-captures.ts` usage, and the emotion scorer paragraphs. The guide's line in `packages/stage-ui-live2d/AGENTS.md` keeps the idle liveliness rule and drops the rest. Git history keeps the scorer; the qa-tools README already says that Live2D gates return on `lab:motion3d`'s gate pattern when needed.

### 5. The `Emotion` enum in four packages: merged

| Copy | Also holds | Importers |
| --- | --- | --- |
| `packages/stage-ui/src/constants/emotions.ts` | `EMOTION_VALUES`, motion name map, VRM and Spine maps, `EmotionPayload` | `Stage.vue`, `queues.ts`, the motion QA bridge, the performance conductor, `stage-emotion-routing.browser.test.ts`; re-exported by `src/constants/index.ts` |
| `packages/stage-ui-live2d/src/constants/emotions.ts` | `EMOTION_VALUES`, motion name map, a VRM map | `live2d/Model.vue`, two natural-motion tests, `stage-ui`'s `emotion-pulses.vue` (through the `./constants/emotions` export); package barrel |
| `packages/stage-ui-mmd/src/constants/emotions.ts` | `EMOTION_VALUES` | `MMD.vue`, `expression.ts`, `actions.ts`, `morphs.ts`, `morphs.test.ts`, `stores/mmd.ts`; package barrel |
| `packages/stage-ui-spine/src/constants/emotions.ts` | `EMOTION_VALUES`, Spine tracks and animation map | `Spine.vue`, `spine/Model.vue`; package barrel |

All four declare the same twelve values, which equal `PERFORMANCE_EMOTIONS` in `packages/stage-shared/src/expression-performance/types.ts`, the vocabulary of the expression performance layer. After L, `packages/stage-shared/src/expression-performance/emotion.ts` declares `Emotion` and `EMOTION_VALUES` once, the expression-performance index exports them, a test pins `EMOTION_VALUES` to `PERFORMANCE_EMOTIONS`, and each `constants/emotions.ts` re-exports both and keeps its own maps (D7). No value changes, so the change is behavior-neutral: the observer pins and the rig hash must not move.

### 6. macOS confirmation of the observer golden hashes: not done here; owner action (L2)

`packages/stage-ui-live2d/src/composables/live2d/natural-motion/observer.test.ts` pins three idle and three emotion SHA-256 hashes over frames rounded to four decimals (`6f625cf30`). Its comment and the package guide say the macOS confirmation is pending. On this branch, on Linux x86_64, the test passes (24 tests) and `pnpm qa:live2d-rig` prints `4853812851e60da048e340407e481f9a14209df2f7aadd1548f48d4c67d1ed36`. This host is not a Mac, so L1 records the confirmation as not done, and [Part L2](#part-l2-macos-confirmation-outline) gives the owner the commands.

### 7. The ledger's sync decisions and the analytics question: recorded as kept

| Item | On this base | After L |
| --- | --- | --- |
| Automatic updates (off unless a build sets `AIRI_UPDATE_FEED_URL` and `AIRI_UPDATE_PUBLIC_KEY`) | Owner kept on 2026-11-18, recorded in the ledger | Kept; owner question 1 |
| Error reports (off unless a build sets `AIRI_ERROR_REPORT_DSN`) | Owner kept on 2026-11-18, recorded in the ledger | Kept; owner question 2 |
| Touch on Live2D (`touchGesturesActive`) | Open on this base; settled by CM1 on the unmerged branch `luke/feat/character-mind-touch` | Not in L (D10) |
| Beat sync layer (`isBeatSyncLayered`) | Open on this base; settled by CM5 on the unmerged branch `luke/feat/character-mind-music` | Not in L (D10) |
| Analytics endpoints (OpenPanel in `packages/stage-shared/src/analytics/openpanel.ts`, PostHog in `packages/stage-shared/src/analytics/posthog.ts`) | Used only when a build sets `VITE_ENABLE_ANALYTICS` and the user opts in; no fork build script sets it | Kept as upstream ships them; owner question 3 (D11) |

L changes no code for these items and does not edit the ledger's Decisions to revisit section (D10). The roadmap's L row records the outcome.

## Decisions

The owner ruled "go without plan review". Each fork takes the recommended option and stays open to veto. The ones most likely to be vetoed are marked **veto risk**.

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | One PR or a split | One PR; L1 (this PR) and L2 (the macOS run) | L1 and L2 | Everything except the macOS run fits one PR of nine commits. The macOS run needs the owner's machine and must not hold the rest |
| D2 | Where `isStageWeb` goes | Remove it everywhere; only in fork-only code | Everywhere | Owner ruling 2026-11-17. Every caller is in a Supported package, and decision 14 allows upstream file changes that this plan names |
| D3 | Beat sync off Electron after the browser detector goes | Guard the one unguarded caller (`live2d/Model.vue`) with `isBeatSyncSupported()`; make every beat sync function a no-op off Electron | Guard the caller | `use-modules-list.ts` already guards this way; the API keeps upstream's errors. Without a guard, the Live2D browser tests that mount `Model.vue` throw in `onMounted` |
| D4 | Protocol fields that name the web stage | Keep `plugin-protocol`'s `'stage-web'` field and `WebSocketEventSource.StageWeb`, write `false` and name the client `StageTamagotchi`; remove them from the protocol | Keep the protocol, write the desktop values | `plugin-protocol` is the contract the server channel and the Kept integrations read. **Veto risk:** off Electron (tests, stories) the client now also calls itself the desktop stage |
| D5 | The host capability ADR's `web` column | Edit the matrix; status line only | Status line only | ADR bodies are history. The README of `stage-shared` says the column is history |
| D6 | `extract-natural-reference.ts` | Remove it with the emotion gate code, as the roadmap row lists it; keep it | Keep and record | It regenerates `reference-stats.ts`, which the still-running idle liveliness test reads, from desk recordings; no removed runner fed it. **Veto risk:** this departs from the roadmap row's list |
| D7 | Where the one `Emotion` lives, and how importers reach it | In `stage-shared` with re-exports from the four `constants/emotions.ts`; in `stage-shared` with every importer rewritten and the four declarations deleted; derive `PERFORMANCE_EMOTIONS` from the enum | Re-exports, with a test tying the enum to `PERFORMANCE_EMOTIONS` | `stage-shared` is the one dependency the four share. Re-exports change four upstream files instead of about twenty-five, keep each package's public `./constants/emotions` export and barrel, and keep each renderer's maps beside it (decision 14). **Veto risk:** the root rule against compatibility shims could be read to forbid the re-exports |
| D8 | The two remaining process listings | Merge them; keep them and record why | Keep and record | Opposite scopes: session-only for agent QA on Linux, host-wide for `dev:top`. The shared part (parsing `ps`, walking descendants) is small |
| D9 | The macOS confirmation | Plan it as an owner action; skip it | Owner action in L2 with exact commands | It needs a Mac. L1 records it as not done |
| D10 | The four sync decisions in the ledger | Edit the ledger's Decisions to revisit section; leave it as is | Leave it | Updates and error reports are already recorded as kept by the owner on 2026-11-18. Touch and beat sync belong to CM1 and CM5, whose unmerged branches rewrite that section; an edit here would conflict with both |
| D11 | Upstream's analytics endpoints | Keep as upstream ships them; turn them off unless a build sets its own endpoints, as the sync did for error reports | Keep | The owner's privacy alignment: match upstream's data handling. No fork build sets `VITE_ENABLE_ANALYTICS`, so nothing is sent today. Owner question 3 |
| D12 | Recording the departures from upstream | Ledger rows with the code; only the roadmap | Two ledger rows, each in the commit that makes the departure | The ledger says a departure without a row is a sync bug. Rows: "Web stage branches" under Desktop app structure (item 5) and "Emotion enum" under Character, motion, and prompt (item 3) |
| D13 | A new ADR | Write `docs/ai/adr/2026-11-20-leftovers.md`; none | None | No lasting design is decided. The ledger rows, the README, the ADR status line, and the roadmap row hold every record |
| D14 | Rendered checks | A `qa:app` session; the smoke only | The smoke only: the window smoke that the gate runs, and the desktop-stage smoke by hand once | No change alters what the desktop app does: the removed branches never ran in Electron, and the enum keeps every value. The roadmap asks for `qa:app` only for a behavior a slice moves |
| D15 | Where the brief's "last items" docs go | Every doc in the closing commit; policy docs with their code, the roadmap row last | Ledger rows, READMEs, and the ADR status line with their code; the roadmap row in the closing commit | Root rule: a policy doc changes in the commit that makes its statement false |

## Work items

Part L1. Each item is one commit for one low-effort worker. Each commit must pass:

```bash
pnpm verify --gate --base origin/luke/refactor/lab-tools
```

The base form was checked with `--dry-run` on 2026-11-20: verify takes the merge base `98f9bb93c` with `origin/luke/refactor/lab-tools`. The gate runs the clean-start smoke in a `qa:display` session when app runtime paths changed, and `pnpm qa:test:model` when Natural or Live2D motion paths changed; do not run either again by hand. No item moves a tracked file, so no `git mv` commit is needed. Order: 1 and 2 first, then 3, then 4 before 5, then 6, 7, 8, 9.

1. **`refactor(stage-ui-live2d): remove the Live2D emotion gates that lost their runners`**
   - Files: `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts` (keep `LivelinessGate`, `TalkingGate`, `naturalIdleLivelinessGate`, `naturalTalkingGate`, and the imports they use); delete `gates.test.ts`, `emotion-score.ts`, `emotion-score.test.ts`, and `packages/stage-ui-live2d/scripts/score-natural-captures.ts`; `packages/stage-ui-live2d/README.md` "Natural QA" (gate table without the two emotion rows, the paragraph's gate ids, no capture-scoring block, no emotion scorer paragraphs).
   - Tests: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion` passes, including `liveliness-gate.test.ts` and `observer.test.ts`. `pnpm qa:live2d-rig` prints the hash `4853812851e6…` above.
   - Acceptance: `git grep -n -E "naturalEmotionT3Gate|natural-emotion-t3|'natural-emotion'|buildEmotionChecks|unscoredRecipeEntries|emotion-score|score-natural-captures" -- packages scripts ':!**/AGENTS.md'` prints nothing.

2. **`chore(agents): drop the removed Live2D emotion gates from the stage-ui-live2d guide`**
   - Files: `packages/stage-ui-live2d/AGENTS.md` only. The liveliness line keeps "`natural-motion/liveliness-gate.test.ts` scores idle liveliness against `reference-stats.ts`; desk recordings are valid for idle liveliness only." and drops the sentences about the emotion gates and the two scripts. The observer line stays, including "Confirmation of the pins on macOS is pending."
   - Acceptance: `git grep -n -E "natural-emotion|score-natural-captures|later cleanup" -- '*AGENTS.md'` prints nothing.

3. **`refactor(stage-shared,stage-ui,stage-ui-live2d,stage-ui-mmd,stage-ui-spine): define the Emotion enum once in stage-shared`**
   - Files: new `packages/stage-shared/src/expression-performance/emotion.ts` (`Emotion`, `EMOTION_VALUES`) and `emotion.test.ts`; `packages/stage-shared/src/expression-performance/index.ts` exports it; each of the four `constants/emotions.ts` imports and re-exports `Emotion` and `EMOTION_VALUES` from `@proj-airi/stage-shared/expression-performance` and keeps its own maps; the stage-ui-mmd header comment goes. Casts between the formerly distinct enums that lint or typecheck now reports as unnecessary are removed. Ledger: a row "Emotion enum" under Character, motion, and prompt (upstream: four copies; fork: one in `stage-shared`, re-exported; reason: one vocabulary with `PERFORMANCE_EMOTIONS`; revisit: when upstream merges its copies).
   - Tests: `emotion.test.ts` asserts `EMOTION_VALUES` equals `PERFORMANCE_EMOTIONS`, in order (`pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance/emotion.test.ts`); `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/constants/morphs.test.ts`; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/observer.test.ts` with unchanged pins; `pnpm qa:live2d-rig` hash unchanged. The gate runs `qa:motion3d affected`; unless it prints NOT AFFECTED, run each affected scenario with `pnpm qa:motion3d run` at the parent commit and at this commit, and require `pnpm qa:motion3d diff` to print `IDENTICAL` for each.
   - Acceptance: `git grep -n "export enum Emotion\b" -- packages` prints exactly one line, in `packages/stage-shared/src/expression-performance/emotion.ts`.

4. **`refactor(stage-ui,stage-ui-live2d,stage-pages): remove the web stage branches from shared components`**
   - Files: the item-1 table rows for `action-menu/index.vue`, the three chat items, `use-build-info.ts`, `channel-server.ts` and its test, `context-bridge.ts` and its contract browser test, `fit-model.ts`, and `settings-search.ts`. `isStageWeb` itself stays exported until item 5. Group UnoCSS classes only in the markup you change.
   - Tests: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/mods/api/channel-server.test.ts`; `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/stores/mods/api/context-bridge.contract.browser.test.ts`; `pnpm qa:live2d-rig` hash unchanged.
   - Acceptance: `git grep -n "isStageWeb" -- packages/stage-ui packages/stage-ui-live2d packages/stage-pages` prints nothing.

5. **`refactor(stage-shared,stage-ui-live2d): remove the browser beat sync detector and isStageWeb`**
   - Files: `packages/stage-shared/src/beat-sync/detector.ts` and `packages/stage-shared/src/environment.ts` per the inventory; `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` listens only when `isBeatSyncSupported()` (D3). Ledger: a row "Web stage branches" under Desktop app structure (upstream: `isStageWeb()` branches in the files of [Upstream first](#upstream-first) and a browser beat sync detector; fork: removed, the plugin protocol's `stage-web` field written `false`; reason: `apps/stage-web` retired, owner ruling 2026-11-17; revisit: if a web app returns).
   - Tests: the Live2D browser tests that mount `Model.vue` off Electron pass: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/live2d-blink-ownership.browser.test.ts src/components/scenes/stage-emotion-routing.browser.test.ts src/components/scenarios/settings/model-settings/live2d.browser.test.ts`.
   - Acceptance: `git grep -n -E "isStageWeb|StageEnvironment\.Web|getStage\(" -- packages apps scripts` prints nothing.

6. **`refactor(stage-shared,stage-tamagotchi,i18n): remove the web host profile`**
   - Files: the inventory table of leftover 2; the README's Support scope paragraph says step L removed both web leftovers (owner ruling 2026-11-17) and points at the ledger row; the host capability ADR's status line says the `web` host id was removed in step L.
   - Tests: `pnpm -F @proj-airi/stage-shared exec vitest run src/host-capabilities`; `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/electron/screen.test.ts src/main/services/linux-desktop/geometry/ownership.test.ts`; `pnpm i18n:check` reports nothing new.
   - Acceptance: `git grep -n -E "'web'|web-sandbox|web-page-pointer-only|WebSandbox|WebPagePointerOnly" -- packages/stage-shared/src/host-capabilities packages/i18n/src/locales/en apps/stage-tamagotchi/src/main` prints nothing.
   - After this item, once: the desktop-stage smoke (see [Checks](#checks)).

7. **`docs(qa-tools): record why the QA and dev-tools process listings stay separate`**
   - Files: `packages/qa-tools/README.md`, the process discovery paragraph: `pnpm dev:top` and `pnpm wt` list every host process through `scripts/dev-tools/lib/processes.ts`, and the two listings stay separate because agent QA must not read the user's processes on Linux.
   - Acceptance: `git grep -n "scripts/dev-tools/lib/processes.ts" -- packages/qa-tools/README.md` prints one line.

8. **`docs(ai): close roadmap step L except the macOS hash confirmation`**
   - Files: `docs/ai/context/character-mind-roadmap.md`, the L row's Status only: "Partly done on `luke/refactor/leftovers`: the web branches and host profile are removed, the four `Emotion` enums are one, the Live2D emotion gate code is removed (`extract-natural-reference.ts` is kept: it regenerates the idle liveliness reference), the two remaining process listings are kept, and the update, error-report, and analytics questions stay with the owner, recorded as kept. Touch and beat sync are CM1's and CM5's. Left: the macOS confirmation of the observer hashes (L2)." Leave the row's "What lands" text as it is, so the CM branches' wording merges cleanly.
   - Acceptance: the policy-docs test passes (see [Checks](#checks)).

9. **`docs(plan): mark part L1 of the roadmap leftovers plan done`**
   - Files: this plan: Status, Checks run, Commits, and any departures during implementation.

### Part L2: macOS confirmation (outline)

The owner runs this on a Mac, after L1 has merged or on the L1 branch. The commands assume a clean checkout at the commit to confirm, with `.tool-versions`' Node:

```bash
pnpm install
pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/observer.test.ts
uname -m
node --version
```

Optional, and not part of the roadmap row: with `AIRI_QA_RIG_FORBOOTH` set in `.env.qa`, `pnpm qa:live2d-rig` should print `4853812851e60da048e340407e481f9a14209df2f7aadd1548f48d4c67d1ed36`, as it does on Linux.

- **If the test passes,** a worker lands three commits, each through the gate against the then-current base (`origin/main` once L1 has merged):
  - `test(stage-ui-live2d): record the macOS confirmation of the observer hashes`: the pin comment in `observer.test.ts` drops "Mac confirmation is pending." and names the confirmed platforms;
  - `chore(agents): drop the pending macOS confirmation from the stage-ui-live2d guide`: the observer line of `packages/stage-ui-live2d/AGENTS.md`;
  - `docs(ai): close roadmap step L`: the L row's Status becomes Done.
- **If it fails,** do not re-pin. The four-decimal quantization was meant to hold on every platform, so a macOS difference is a finding: record which pins differ, and the owner decides between a coarser quantization and per-platform pins.

## Checks

- **Each commit:** `pnpm verify --gate --base origin/luke/refactor/lab-tools`, plus the item's tests as the inner loop. The gate already runs the window smoke (`pnpm qa:display run --name verify-<pid> -- pnpm --silent qa:smoke`) for app runtime paths and `pnpm qa:test:model` for Live2D and Natural paths, and `qa:motion3d affected` for MMD paths. Do not run them again by hand.
- **Policy docs:** after items 3, 5, 6, and 8, stage the files first (the test runs `git grep`, which sees only tracked files), then run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts`.
- **Headless Live2D rig:** after items 1, 3, and 4, `pnpm qa:live2d-rig` must print `4853812851e60da048e340407e481f9a14209df2f7aadd1548f48d4c67d1ed36`. If it moves, stop and find why; no item changes Natural output on purpose.
- **Observer pins:** after items 1 and 3, `observer.test.ts` passes without re-pinning.
- **MMD identity:** after item 3, only if `qa:motion3d affected` does not print NOT AFFECTED: `pnpm qa:motion3d run` for each affected scenario at the parent and at the tip, and `pnpm qa:motion3d diff` printing `IDENTICAL` for each.
- **Desktop-stage smoke:** once, after item 6, because the gate runs only the classic window: `pnpm qa:display run -- pnpm --silent qa:smoke --model "$AIRI_QA_MMD_MODEL" --stage-host desktop`, with the variable from `.env.qa`.
- **i18n:** after item 6, `pnpm i18n:check`.
- **Whole suites:** once at the end, `pnpm test:run --filter=@proj-airi/stage-ui-live2d` and `pnpm test:run --filter=@proj-airi/stage-shared`, because items 1, 3, and 5 delete or move exports that a test could reach through `fs` or a wildcard export.
- Record every command and result in [Checks run](#checks-run). Run at most three heavy checks at once.

## Records

Where each outcome is written down when L1 lands:

| Record | Holds | Item |
| --- | --- | --- |
| Roadmap L row, Status | Each leftover's outcome; L2 left | 8 |
| Ledger, Character, motion, and prompt | "Emotion enum" row | 3 |
| Ledger, Desktop app structure | "Web stage branches" row | 5 |
| README, Support scope | Both web leftovers removed | 6 |
| Host capability ADR, status line | The `web` host id was removed | 6 |
| `packages/stage-shared/README.md`, Host capabilities | The ADR matrix's `web` column is history | 6 |
| `packages/stage-ui-live2d/README.md`, Natural QA | Liveliness and talking gates only; `extract-natural-reference.ts` still documented | 1 |
| `packages/stage-ui-live2d/AGENTS.md` | Idle liveliness rule only; macOS confirmation still pending | 2 |
| `packages/qa-tools/README.md`, process discovery | Why the two listings stay separate | 7 |
| This plan | Decisions, owner questions, checks run, commits | 9 |

The ledger's Decisions to revisit section is not edited (D10).

## Risks

| Risk | Mitigation |
| --- | --- |
| Code that runs off Electron (browser tests, stories) took the web branches, so removing them changes what those environments do: Live2D framing, the beat sync listener, the client name | D3 guards the only beat sync caller that would throw. The item tests mount `Model.vue` off Electron. The desktop app never took these branches |
| The stacked character mind branches touch the same files: `context-bridge.ts` (music), `live2d/Model.vue` (music), `stage-ui-live2d/README.md` and `AGENTS.md` (music), the roadmap L row (touch, music), the ledger (touch, music), and `expression-performance/types.ts` (music) | L puts the enum in a new file instead of `types.ts`, does not edit the ledger's Decisions to revisit section, and edits only the L row's Status. Whichever lands second resolves the rest by keeping both changes |
| The enum merge makes four nominal types one, so casts between them become unnecessary or a mismatch surfaces | Typecheck and lint in the gate; remove only casts that the tools report |
| `qa:motion3d affected` reports AFFECTED or CANNOT TELL for the enum commit, which costs identity runs | The runs are the documented proof of a behavior-neutral MMD change; the enum keeps every value, so they should be `IDENTICAL` |
| Deleting `emotion-score.ts` removes the only statistical emotion scorer | Nothing runs it. Git history keeps it, and the qa-tools README names `lab:motion3d`'s gate pattern for a future Live2D gate |
| The macOS run finds a pin difference | L2 stops without re-pinning and hands the owner the choice |
| A removed i18n key is still read by a key built at run time | The reason keys are built from `HostReasons`, which loses the same two codes in the same commit; `pnpm i18n:check` runs |

## Owner questions

1. **Automatic updates.** Bring back updates from the fork's own releases, and with which feed and key? Recorded as kept (off unless a build sets both variables).
2. **Error reports.** Does the fork get its own error-report project? Recorded as kept (off unless a build sets its own DSN).
3. **Analytics endpoints.** Keep upstream's OpenPanel and PostHog endpoints as upstream ships them, or turn them off unless a build sets its own, as the sync did for error reports? Recorded as kept (D11); no fork build enables analytics today.
4. **macOS confirmation.** Run [Part L2](#part-l2-macos-confirmation-outline) on a Mac and report the result.
5. **Vetoes.** D4 (the client calls itself the desktop stage everywhere), D6 (keep `extract-natural-reference.ts`), and D7 (re-exports rather than rewritten importers) are the decisions most likely to be wrong for you.

## Must not do

- Do not change Kept projects, `packages/plugin-protocol`'s `'stage-web'` field, or `WebSocketEventSource.StageWeb`.
- Do not touch touch handling, `touchGesturesActive`, `isBeatSyncLayered`, the beat sync plugins, or anything else CM1 or CM5 settles.
- Do not change the update feed, the error-report switch, or the analytics code and configuration.
- Do not merge the two process listings, and do not make the QA listing read host processes on Linux.
- Do not delete `extract-natural-reference.ts`, `score-natural-trace.ts`, `export-riggold-trace.py`, the liveliness and talking gates, `liveliness.ts`, or `reference-stats.ts`.
- Do not re-pin the observer hashes or accept a new rig hash. A moved hash stops the item.
- Do not add an `isStageWeb` alias, a web fallback, or any other compatibility guard.
- Do not edit an ADR body; only the host capability ADR's status line changes.
- Do not edit a locale other than English.
- Do not edit the ledger's Decisions to revisit section.
- Do not claim the macOS confirmation on Linux.
- Do not commit a model path, host name, local path, or email; use the `AIRI_QA_*` variables.
- Do not force-push, and do not merge the PR; the owner merges.

## Done when

**L1:** every acceptance grep in items 1 to 7 prints what it should; the one `Emotion` enum is in `stage-shared` and its test passes; the web host profile and every `isStageWeb()` branch are gone; the two process listings are recorded as kept; the update, error-report, and analytics questions are recorded as kept with owner questions; every commit passed `pnpm verify --gate --base origin/luke/refactor/lab-tools`; the policy-docs test, the desktop-stage smoke, and the whole-suite runs passed; `pnpm qa:live2d-rig` still prints `4853812851e6…`; the observer pins pass on Linux unchanged; and the roadmap L row says what is left.

**L2:** the observer test passes on macOS, the pin comment and the package guide no longer say the confirmation is pending, and the roadmap L row is Done.

## Departures during implementation

1. **An added commit, `e7f091830`** (`test(stage-tamagotchi): import the caption page before the window bounds test starts`). The item 3 gate failed on `window-bounds-readiness.browser.test.ts`, at the parent commit as well. Root cause: the test imported `pages/caption.vue` dynamically inside its body; in a batch where every file builds its module graph from one fresh Vite server, that import took about 17 s against the 15 s timeout. Fix: a static import. Evidence: the 19-file related batch failed 4 of 4 before and passed 5 of 5 after; the whole stage-tamagotchi browser suite passed 2 of 2; no failing pair exists (all 18 pairs passed). It settles the T plan's owner question 3 for this test; `app.browser.test.ts` under load was not looked at.
2. **Item 1:** the README's limitation sentence uses the liveliness wording from `gates.ts`.
3. **Item 3:** all four packages re-export the shared enum with a plain `export { Emotion, EMOTION_VALUES } from '@proj-airi/stage-shared/expression-performance'`, because each package exposes `Emotion` in its public API.
4. **Item 4** also changed three chat-history browser tests, folded in by amend:
   - The short-error test checks that the "Show details" toggle is absent, instead of no `button[aria-expanded]`: the action menu's dropdown trigger now renders on mobile in browser tests.
   - The mobile bottom-align test waits for alignment.
   - The break-follow test moves the pointer away from the history before each test. A pointer left by an earlier file set `isPointerOrFocusOnOlderMessage` and stopped the follow.
   - Evidence: the stage-ui browser project passed 3 of 3 with the parent's chat components, failed 2 of 3 with item 4 before the fix, and passed 9 of 9 after.
5. **Item 5:** `getStage()` and `StageEnvironment.Web` stay, because the analytics code (`product-signals/surface.ts`, `openpanel.ts`, `posthog.ts`, `events/interaction.ts`) reads them and analytics is out of scope (D11). Only the detector's Web variant went. The ledger row says so. Item 5's acceptance grep therefore prints those lines.
6. **Item 6:** the plugin `runtimes: ['electron', 'web']` lines stay, because they are the plugin-host contract (`stage-shared/src/plugin-host.ts`), not the host profile. `system-audio-lipsync.browser.test.ts` dropped the `web` host from its host list.
7. **The `isStageWeb` grep** prints two intended lines: the ledger row (D12) and the roadmap L row's "What lands" text.
8. **Item 8:** the roadmap L Status also names departures 3, 5, and 6.

## Checks run

All on Linux x86_64.

- Every commit passed `pnpm verify --gate --base origin/luke/refactor/lab-tools`, which runs lint, typecheck, related tests, the window `qa:smoke`, and `qa:test:model`. For the docs-only items 7 and 8 the gate skipped `qa:motion3d affected` because the change was staged, not committed; neither touches MMD paths.
- `pnpm qa:live2d-rig` printed `4853812851e60da048e340407e481f9a14209df2f7aadd1548f48d4c67d1ed36` after items 1, 3, and 4.
- `qa:motion3d affected` printed AFFECTED for item 3; all nine scenarios at seed 1 were IDENTICAL between `e7f091830` and `25029dffa`.
- `pnpm i18n:check` exited 0 after item 6, with no change in warnings.
- The desktop-stage `qa:smoke` after item 6: `ok: true`.
- The policy-docs test passed 11 of 11 after each policy doc edit (items 3, 5, 6, 7, and 8).
- Whole suites at the end (item 8): `pnpm test:run --filter=@proj-airi/stage-ui-live2d` passed 52 files, 821 tests; `pnpm test:run --filter=@proj-airi/stage-shared` passed 94 files, 1847 tests.

Grounding runs on 2026-11-20 at `98f9bb93c`:

| Command | Result |
| --- | --- |
| `pnpm verify --gate --base origin/luke/refactor/lab-tools --dry-run` | Merge base `98f9bb93c`; the form is accepted |
| `pnpm qa:live2d-rig` | `sha256` `4853812851e60da048e340407e481f9a14209df2f7aadd1548f48d4c67d1ed36`, 301 samples, 18 moving channels |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/observer.test.ts` | 1 file, 24 tests passed |

## Commits

Part L1, on `luke/refactor/leftovers`:

- `97a4ef179` plan
- `b83beb80b` item 1
- `7df099e2c` item 2
- `e7f091830` an added fix (departure 1)
- `25029dffa` item 3
- `54e624d86` item 4
- `f67ce5d47` item 5
- `d49ffda29` item 6
- `689ffddc9` item 7
- `146ae8298` item 8
- item 9 is the commit that marks this plan done
