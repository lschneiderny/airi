# Upstream policy ledger

This ledger lists every place where the fork does not take upstream `moeru-ai/airi` as shipped: the upstream rule or behavior, the fork's rule or behavior, the reason, and the condition for another look. It is current as of the sync that ended on 2026-11-18 at upstream `b3a6d6071`. The fork point is `f3e6a244e`.

Update this ledger in the same sync that changes a row. A departure that has no row here is a bug in the sync.

## Files the fork owns

At a sync these files keep the fork's version. Review upstream's diff of each one and port the rules that fit.

| File | Note |
| --- | --- |
| Root `AGENTS.md` | Upstream's rules that the fork accepts are rewritten in the fork's style |
| Every nested `AGENTS.md` and `CLAUDE.md` | Includes guides under paths kept from upstream (`server/**`, `services/computer-use-mcp/**`) |
| `README.md`, `.github/CONTRIBUTING.md` | |
| `.agents/skills/README.md` | Holds the fork's notes on upstream skills |
| Skills `enforce-rules-for-typescript`, `enforce-rules-for-vitest`, `xsai` | Fork rewrites |
| Fork-only skills: `motion-qa`, `idea`, `triage`, `vault-sync` | No upstream counterpart |
| Fork-only skill references: `use-agent-browser-for-airi/references/{input-file,attached-input,detached-input,native-file-chooser,verify-upload}.md`, `use-vishot/references/{airi,electron,input-file,web}.md` | Merged copies of upstream skills the fork deleted |
| `docs/ai/context/` policy docs that upstream does not have | This ledger, `testing.md`, `upstream-watch.md`, the roadmaps, the glossary, and the domain policy docs |
| Root `package.json` scripts, the root `vitest.config.ts`, `scripts/dev-tools/**` | The fork's check tooling |

Every other policy file that exists upstream takes upstream's bytes, including every other file under `.agents/skills`. Upstream skills can therefore name retired hosts (stage-web, stage-pocket, Kirie) and upstream skills the fork merged or deleted. `.agents/skills/README.md` maps those names to fork files.

Three upstream policy files still carry fork edits and are not yet at upstream's bytes: `DESIGN.md` (scope retargeted to the desktop app), `docs/ai/context/ui-components.md` (two fork sections), and `docs/ai/context/design-implementation.md` (rows for deleted skills removed). Revisit: move the fork content to fork files, then restore upstream's bytes.

## Upstream files that stay deleted

A sync resolves a change to any of these as deleted.

| Path | Reason |
| --- | --- |
| Every path in the README's Retired table | Retired projects |
| `.github/workflows/**`, `.github/scripts/**`, `.github/aw/**`, `.github/rulesets/**`, `.github/slash-command-dispatch.json`, `.github/agents/**` | The fork has no GitHub workflows |
| `.github/labeling.md`, `.github/category-labeling.md`, `.github/labels.yml`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODE_OF_CONDUCT.md`, `.github/SECURITY.md`, `.github/FUNDING.yml` | Community and labeling files of a public project |
| `.github/copilot-instructions.md`, root `CLAUDE.md`, `.cursor/**`, `.vscode/**` | Agent guidance targets Claude Code through `AGENTS.md` only (plan decision D6) |
| `crowdin.yml`, `docs/README.*.md` | No Crowdin sync; translated READMEs are not maintained |
| `flake.nix`, `flake.lock`, `nix/**` | No Nix packaging |
| `apps/stage-tamagotchi/scripts/utils.ts`, `collect-installer-files.ts`, and their tests | Release CI helpers |
| `plugins/airi-plugin-game-chess` | A stub without source |
| Account settings pages, account-only routes and pages | Account-free fork (`a291588c0`) |
| Skills `create-pr`, `release-note-writer`, `upload-github-attachment`, `enforce-rules-for-i18n`, `simple-english`, `web-design-guidelines`, `use-vishot-with-capacitor` | They serve PR publishing, releases, Crowdin, upstream's prose style, or the mobile host |
| Vendored skills `pinia`, `pnpm`, `tsdown`, `unocss`, `vue`, `vue-best-practices`, `vue-testing-best-practices`, `vueuse-functions` | Generic tutorials; the fork reads installed types and official docs |
| Skills `use-agent-browser-with-input-file`, `use-vishot-for-airi`, `use-vishot-with-electron`, `use-vishot-with-web`, `use-vishot-with-input-file` | Merged into the fork-only references listed above |

Revisit any row when the fork gains the thing the row says it lacks.

## Rule overrides

The fork states a different rule than upstream.

| Area | Upstream | Fork | Reason | Revisit |
| --- | --- | --- | --- | --- |
| Checks after a task | Typecheck and test each changed workspace; root `pnpm typecheck` after a shared change; `pnpm lint` before finishing | `pnpm verify`, as the root COMMANDS section and `testing.md` state | One incremental command covers lint, typecheck of dependents, and related tests | When `testing.md` changes |
| Branch tests and CI | Run the branch tests before a PR; confirm CI tested the PR head | `pnpm verify --gate` before landing; no CI | The fork has no workflows | If workflows are added |
| Source control | Branch and PR for every change | Small changes go directly to `main` after `pnpm verify`; plan-sized work uses a branch and a rebase-merged PR against the fork | One maintainer | Not planned |
| Upstream intake | Not applicable | Merge on a sync branch, land by fast-forward, never rebase or cherry-pick | A rebase merge would re-create upstream commits under new hashes | Not planned |
| Agent attribution | No `Co-authored-by` for an agent; add `Assisted-by: <harness>:<model>` | Agent commits end with a `Co-Authored-By` trailer that names the model | Owner requirement; it matches the harness default | If the owner changes it |
| Agent-written PR and issue text | State the request, scenario, harness, and model in the `create-pr` format | No rule | The fork's PRs are the owner's own; the skill is deleted | If outside contributors appear |
| Releases | `release-note-writer` skill and release workflows | `pnpm release` builds by hand and uploads to a draft GitHub release | No workflows | Not planned |
| Prose style | `simple-english`: no "should", "may", or "might"; no semicolons; short sentences | Clear, complete sentences; distinguish requirements, recommendations, and uncertainty | Owner preference (plan decision D8) | Not planned |
| Guidance shape | The root guide opens with a Project Map and lists standard commands | No overviews, trees, code maps, or standard-shape commands | The root AGENTS.md policy | Not planned |
| Vendored tutorial skills | Vendored Vue, Pinia, VueUse, UnoCSS, pnpm, and tsdown skills | Not vendored | The same policy | Not planned |
| JSDoc | JSDoc on every public export, `@param` for generics, `@default` on every default, a call-stack diagram on every runner, `@example` on every exported normalizer | Document what types cannot express; examples and diagrams only when they clarify | Plan decision D8 keeps the fork's JSDoc rules | Not planned |
| UnoCSS legacy classes | Refactor a touched component's legacy classes into grouped arrays | Group only the markup you change | Keeps diffs in scope; stated in the root guide | Not planned |
| Electron in tests | Mock Electron IPC; never require a real Electron runtime | Mock IPC in unit tests; use the real runtime when an integration test or live reproduction needs its lifecycle | The fork's window lifecycle bugs reproduce only live | Not planned |
| Pinia and components in tests | Do not mock Pinia or Vue components | Stub unrelated child components or stores when their behavior is outside the assertion | Plan decision D8 keeps the fork's test strictness | Not planned |
| UI tests | No DOM-driven page or component tests outside the cases `enforce-rules-for-ui-tests` allows | The same, plus the fork's visual baselines for deterministic component states | The baselines are a fork check; see the Vitest skill | If the baselines are dropped |
| Bug reproduction format | Tracker id in the test name, report URL, and a `ROOT CAUSE` comment block | Reproduce first when practical; keep a concise reference when it explains the regression | Most fork bugs have no tracker entry | Not planned |
| Stage-tamagotchi build | `build` runs the typecheck and `electron-vite build` | `build` runs `electron-vite build` only | `pnpm verify` owns the typecheck | Not planned |
| Other locales | Crowdin manages them | Frozen copies of upstream's Crowdin exports; each sync brings upstream's version | No Crowdin sync | Not planned |
| x18n baseline | The autofix.ci workflow updates `.x18n/check-baseline.json` | Nobody updates it in the fork; each sync brings upstream's file | No workflows | If the baseline hides fork errors |
| Settings layout registration | Register a route in the target app's layout | Register in both settings layouts | The desktop app resolves both | Not planned |
| Electron main Eventa context | Call the adapter's `createContext` per service | `createWindowContext` and `createAppContext` from `window-context.ts`; one shared context per window | The IPC and window listener ADR (2026-11-10) | Not planned |
| `agent-browser` version | Unpinned | `agent-browser@0.41.2`, stated in the skills README | The version tested on the workstation | When the pin moves |

## Upstream rules the fork leaves out

| Upstream rule | Reason | Revisit |
| --- | --- | --- |
| Project Map; providers in `stores/providers/`, orchestration in `stores/modules/`; the list of directories with their own guide | The code shows it; no-overview policy | Not planned |
| Comment ordering (why before how); no JSDoc on `describe` and `it`; the review checklist for complex modules | Compressed out of the TypeScript skill | Not planned |
| Crowdin review through `enforce-rules-for-i18n`; the i18n code review rules about `autofix-ci[bot]` | No Crowdin, no workflows | If either is added |
| `create-pr` for pull requests; the upstream fork, clone, and PR flow in CONTRIBUTING | The fork's PRs follow the root source control rules | Not planned |
| Routing lines for `simple-english`, `create-pr`, `enforce-rules-for-i18n`, `release-note-writer` | The skills are deleted | With the skill |
| ESLint ignores for Crowdin, flatpak, and stage-pocket | Those paths do not exist | Not planned |

Plan decision D8 restored six rules the fork had dropped by accident. They are in force again: no nested ternaries for a non-obvious fallback chain; cohesive modules of about 200 to 400 lines with no `=====` separators; a why-comment on constants and `@moeru/std` merging for option defaults (TypeScript skill); single-page components in `components/scenarios/` (stage-ui guide); one assertion per line; no smoke-only tests (Vitest skill).

## Upstream rules added since the fork point

Decided on 2026-11-18 for upstream `f3e6a244e..b3a6d6071`. "Adopt" names the fork file that now holds the rule.

| Upstream rule | Decision | Where or why |
| --- | --- | --- |
| Private Data (7 rules) | Adopt, condensed | Root `AGENTS.md`, PRIVATE DATA. The fork's public repository name stays in guidance |
| Use `date-fns`, `@date-fns/utc`, `@date-fns/tz`; ask before another date library | Adopt | Root CONVENTIONS; details in the TypeScript skill |
| No millisecond-constant date arithmetic; no hand-formatted dates; UTC and named-zone types; locale from `packages/i18n` | Adopt | TypeScript skill |
| Replace hand-written date code in each function you change; list the rest as PR follow-up | Leave out | The root rule on touched code already covers it |
| Render-loop clocks and `performance.now()` are not date code | Adopt | Root CONVENTIONS |
| Search before writing a unit helper; move a helper to a shared module at its second copy; name the unit in identifiers | Adopt | TypeScript skill |
| The list of known shared unit helpers | Leave out | A code map; the search rule finds them |
| `packages/plugin-sdk` uses `injeca` as its lifecycle runtime | Adopt | `packages/plugin-sdk/AGENTS.md` |
| Agent configuration in its own commit, inside the PR whose code it describes | Adopt | Root CONVENTIONS |
| `Assisted-by` trailer; no `Co-authored-by` for agents | Override | See Rule overrides |
| Agent-written PR and issue text names the request, harness, and model | Leave out | See Rule overrides |
| Test one file through `pnpm -F <package> exec vitest run`, with the path relative to the package; `test:root` for the tests that belong to no package | Adopt | Root COMMANDS section |
| Test a branch with `turbo run test:run --affected` | Override | `pnpm verify` runs the tests related to the changed files, in each changed package and its dependents |
| Run the branch tests before a PR; confirm CI tested the PR head | Leave out | No CI; `pnpm verify --gate` |
| A UI change reviews its browser tests and is verified with stories, Vishot, and `agent-browser` | Adopt | Routing line for `enforce-rules-for-ui-tests`; pointer in the Vitest skill |
| Do not delete an assertion only to pass; run the related tests on the final commit | Leave out | `testing.md` already forbids weakening tests, and `pnpm verify` runs per commit |
| Routing: `enforce-rules-for-ui-tests`, `enforce-rules-for-fonts`, `enforce-rules-for-ui-components`, `enforce-rules-for-render-loops`, `design-audio-visualizations` | Adopt | Root TASK ROUTING; the five skills are upstream's bytes |
| Routing: `release-note-writer`; the wider `create-pr` line | Leave out | The skills are deleted |
| Install-script ban for workspace packages (`62d2f1cf5`) | Nothing to decide | Upstream reverted it in `e677264de` |
| i18n: run `pnpm i18n:check` after a key change; search the parent key before deleting an unused key; do not edit the baseline | Adopt | `packages/i18n/AGENTS.md` |
| i18n code review rules for `autofix-ci[bot]` commits | Leave out | No workflows |
| Server HTTP response conventions (7 rules) | Adopt | `server/AGENTS.md`, taken in step 1.1 |
| API: `ApiError` from `@proj-airi/http-error-shared`; a Redis Stream publish failure fails the request | Adopt | `server/apps/api/AGENTS.md`, taken in step 1.1 |
| CONTRIBUTING: `NODE_OPTIONS=--no-experimental-webstorage` for `test:run` on Node 26 | Leave out of guidance | The fork's `vitest.dom-storage.ts` sets the flag |
| DESIGN: Alert palette, Borders table, loading, empty and error states, fonts, DockButton, TransitionBud | Adopt | `DESIGN.md` took upstream's text in the merge |
| Copilot instructions change | Leave out | The file is deleted |
| ESLint: `ts/no-explicit-any` as an error; bans on `@better-fetch/fetch`, `awilix`, `colorjs.io`, `debug`, `localforage` | Adopt in config only | `eslint.config.ts`; lint reports them, so guidance does not repeat them. Four fork tests that prove old `localforage` records still read are exempt |
| TypeScript skill description and routing text name date, time, and unit helpers | Adopt | Root TASK ROUTING |

## Code and tooling departures

Each row is behavior where the merged tree differs from upstream.

### Product and accounts

| Area | Upstream | Fork | Reason | Revisit |
| --- | --- | --- | --- | --- |
| Account features | Notifications inbox, display-model cloud sync and store, card sync and history, sync preferences and runner, the account sync section, sign-in in the provider callout | None | The fork removed the hosted account client (`a291588c0`) | If accounts are added |
| Controls menu | Account, Flux, sign-in, and notifications rows | None of those rows | Account-free fork | If accounts are added |
| Provider pages | Amazon Bedrock, CometAPI, Gemini audio speech, MiMo, the official provider | None | Removed from the fork's catalog (`898455bd5`, `9af37b7a5`) | Not planned |
| Speech field status | Four arguments, with a catalog-loading flag | Three arguments | No fork provider picks a voice from a catalog | If one is added |
| Hearing analytics | `useAnalytics()` inside the hearing store | A direct consent-gated `capture` | The store can be created outside a component | Not planned |
| Anthropic chat endpoint | The OpenAI compatibility endpoint, `/v1/chat/completions` (#1503); a native Messages PR (#2098) closed unmerged | The same endpoint by default; the provider's API setting adds the native Messages API through `createAnthropicMessagesFetch` at the provider's `fetch` boundary. Core-agent is unchanged | Prompt caching, effort control, and proxies that serve only the native API, as an option ([ADR](../adr/2026-11-18-anthropic-messages-translator.md)) | When upstream ships native Anthropic support (#1565): take upstream's and delete the translator |

### Updates, releases, and reporting

| Area | Upstream | Fork | Reason | Revisit |
| --- | --- | --- | --- | --- |
| Update feed | The updater reads `release-updates.airi.build` with upstream's key | Off unless the build sets `AIRI_UPDATE_FEED_URL` and `AIRI_UPDATE_PUBLIC_KEY`; About links to the fork's releases | A fork build must never take upstream's bundles. Replaces the fork's update from GitHub releases (`2cd360ca2`). See [Decisions to revisit](#decisions-to-revisit) | When the fork hosts a feed |
| Update switch | The main service and the launcher each decide | The launcher alone decides, macOS included | The two could disagree about health | Not planned |
| Error reporting | Sentry reports to upstream's project (#3458) | Off unless the build sets its own DSN, and an unset switch means off | A fork build must not report to upstream. See [Decisions to revisit](#decisions-to-revisit) | When the fork has its own project |
| Release notes | Read from `moeru-ai/airi` | Read from the fork's repository | The fork publishes its own releases | Not planned |
| Linux packaging | `pacman` and `AppImage` targets | `deb` and `rpm` | The fork dropped AppImage packaging | Not planned |

### Character, motion, and prompt

| Area | Upstream | Fork | Reason | Revisit |
| --- | --- | --- | --- | --- |
| Live2D expressions | Card-owned controls and a Live2D context; the store and controller are deleted (`c4048b6fa`) | The fork's store, controller, panel, and string ACT label, with upstream's context beside them | Reactions, combos, the rest look, and MMD expression commands build on the store, which is the asset system of the Natural performer. Upstream's context stays as upstream ships it, and a preview through it wins while it lasts (owner ruling 2026-11-17; [character mind core ADR](../adr/2026-11-18-character-mind-core.md)) | Not planned |
| Touch on Live2D | A touch module under every driver (`259b6188a`) | Upstream's module under Universal and MAGIC; under Natural one response that the character mind decides | One touch gets one response, and Universal and MAGIC stay as upstream ships them (decision 7 of the character mind ADR; [character mind core ADR](../adr/2026-11-18-character-mind-core.md)) | Not planned |
| Beat sync layer | Runs under every driver (`543d8dfe3`) | Inactive under Natural | Nothing new writes head angles under Natural before the mind owns music. See [Decisions to revisit](#decisions-to-revisit) | Slice CM5 |
| Live2D model cache | The OPFS loader checks the cache and saves without serializing loads | A load holds a Web Lock per model id from its cache check to the end of its save (`c4c357ab8`, `packages/stage-ui-live2d/src/utils/opfs-loader.ts`) | Two loads of one model raced, and the later save removed the files under the earlier load | When upstream serializes the cache, or offer the fix upstream |
| Display model defaults | `universal` driver, expressions off, max FPS 0 | `natural`, expressions on, 60 FPS, on upstream's per-model stores | The fork's defaults | Not planned |
| System prompt | `sessionSystemPrompt` composes it | `buildChatPromptSegments` and `composePrompt`; recipe steps ride in the `card` segment and card guidance in `toolset` | One composer (prompt composition ADR) | Roadmap step P |
| Memory index | Lines grouped under "Your own:" and "General:" | The `(general)` marker and oldest-first order | The composer drops the oldest lines | Roadmap step P |
| Background task, scene, and notice turns | Count as ordinary turns | Do not count as the owner or the character speaking in the situation sensors, character state, or presence record | They are not conversation | The owner's question on overlap 12 of [Autonomous behavior](autonomous-behavior.md#known-overlaps): whether a notice turn counts as the owner's own turn or as unasked speech |
| Widget reactions | The widget bridge (`use-bridge-spark.ts`, `extension-ui-host.vue`, and the message shapes); any window that is not a widget window serves a reaction, and the orchestrator answers it with an agent run (`handleSparkNotifyWithReaction`) | Upstream's bridge is adopted unchanged. The fork's serving path in `context-bridge.ts` changed: only the leader serves, and the character mind decides when the turn speaks, the model may decline it, and a turn not spoken by the caller's deadline is cancelled | The mind's voice channel is the only decider for unasked speech, and the mind runs only in the leader ([character mind widget turns ADR](../adr/2026-11-19-character-mind-widget-turns.md)) | Not planned |
| Web extension video notify | `data.destinations: ['proj-airi:stage-*']` (#3433) | `['character']` plus the envelope route | The stage reads it as a situation topic and starts no agent run | Slice CM3 |
| Automations (auto-run recipes) | A settings tab marked as in development; no trigger | The same; a trigger that makes her speak unasked stays out | The mind's voice channel is the only decider for unasked speech | When upstream ships a trigger |

### Desktop app structure

| Area | Upstream | Fork | Reason | Revisit |
| --- | --- | --- | --- | --- |
| Window context (main process) | `createWindowContext` returns `{ context, dispose }` | One shared context per window, `{ context }` only, with `onWindowClosed`; upstream's workspace window, controls menu window, and backdrop service are adapted to it | The IPC and window listener ADR (2026-11-10) | Not planned |
| Desktop stage window | No such window | Reads its preload and renderer root through `getPreloadPath` and `getRendererRoot`, reports that it mounted, opens the controls menu on a right-click, and preloads the menu window | The fork's desktop stage host follows upstream's window conventions | Not planned |
| Fork-only repositories | Not present | On unstorage mounts over the same database and store as before; old records still read | Follows upstream's unstorage migration | Not planned |
| Per-model settings | Five renderers' keys under `settings/models/<model id>/<renderer>/` | The same, plus the fork's MMD motion driver and clip metadata; stance slots, clip curation, stage character height, and roam mode stay global | Those four are properties of the stage, not of a model | Not planned. Step S registered the keys as upstream ships them |
| "Delete all data" | `useDataMaintenance` resets a fixed list of stores, and a failure stops the later deletions | `deleteAllData` runs every registration of the [state registry](state-persistence.md#state-registry), including upstream-owned credentials, images, tool cards, and caches that upstream's list keeps; every registration and the host step run after a failure ([state registry ADR](../adr/2026-11-19-state-registry.md)) | State persistence Target rule 1; the deletion must keep no personal data. The owner may veto deleting the upstream-owned credentials | Not planned |
| Language and theme readers | `useLanguage` opens a second storage ref on `settings/language`; `fade-on-hover.vue` and `LoadingSciFiCircle` call `useDark` | `useLanguage` reads the key with `localStorage.getItem`; both components read `useTheme().isDark`, and the notice has no theme transition | One owner per key (State persistence rule 6) | Not planned |

### Tooling and configuration

| Area | Upstream | Fork | Reason | Revisit |
| --- | --- | --- | --- | --- |
| Test model | Per-package `test:run` scripts and `vitest.config.ts` files; Turbo runs the whole suites two packages at a time, and CI runs every project | The same scripts and configs, in upstream's shape (`c0205bf27`), with four differences. Every Vitest config is wrapped in `withCpuSlots`. `pnpm test:run` runs `turbo run test:run` under one CPU slot lease, one package at a time, with Turbo's cache. There is no CI, and `pnpm verify` runs the tests related to a change per package, not whole suites. A test gated on an environment variable never runs under `pnpm test:run`, and `XDG_CURRENT_DESKTOP` is a hashed input of the stage-ui test task | The shared CPU budget; whole suites are too slow for the commit loop; a cached result must not depend on a local model; the visual baselines depend on the desktop session's font rendering | Roadmap step T |
| Root `package.json` scripts | Upstream's set, with `lint:swift`, `open:ios`, `sponsors:generate`, `nolyfill`, `up` | The fork's set, plus `test:root`, `lint:prune-suppressions`, and `i18n:check` as upstream has them. `test:run` is the fork's wrapper around upstream's Turbo run | The dropped scripts serve retired or removed things | Every sync |
| `eslint.config.ts` | Upstream's rules | The union of the fork's rule blocks and upstream's rules | The fork's blocks guard motion-driver neutrality, lazy 3D renderers, and host capabilities | Every sync |
| `eslint-suppressions.json` | Upstream's baseline | The same file pruned of entries for files the fork lacks; no entry for fork code | ESLint fails on stale entries | Every sync |
| `turbo.json` | Upstream's tasks | Upstream's `transit` dependency for `typecheck`, plus the fork's cpu-slots build dependency and quiet logs. The `test:run` task declares its inputs and environment, and three packages whose tests read files outside the package have their own task | The fork's CPU budget; Turbo's cache must see every file and variable a test reads | Roadmap step T |
| Catalog (`pnpm-workspace.yaml`) | Upstream's entries | Merged per entry: no `@capacitor/*`, `@grammyjs/files`, or `@gd-kirie/*` exception; Electron at the fork's `^43.8.7` | Retired projects; the fork's Electron is newer | Every sync |
| `.tool-versions` | Node 26.12.1 | Node 26.11.1 | The bump needs that Node on the owner's machines first | When it is installed |
| `.gitignore` | Lines for the Twitter service and Nix | The fork's lines | Retired paths | Not planned |
| Visual baselines | Not present | The alert and checkbox baselines were regenerated for upstream's new component and palette | Fork check | Not planned |

## Decisions to revisit

The sync made four decisions while the owner was away. On 2026-11-18 the owner kept all four and asked for them to be recorded for a later decision. Slice CM1 settled one of them, touch on Live2D, in the [character mind core ADR](../adr/2026-11-18-character-mind-core.md). These three remain.

| Decision | Before the sync | What the sync decided | Left to decide | Where |
| --- | --- | --- | --- | --- |
| Automatic updates | The fork updated from its own GitHub releases (`2cd360ca2`) | Off in a fork build unless the build sets both `AIRI_UPDATE_FEED_URL` and `AIRI_UPDATE_PUBLIC_KEY` | Whether to bring back updates from the fork's releases, and with which feed and key | `apps/stage-tamagotchi/src/shared/update-source.ts` |
| Error reports | Not present; upstream's Sentry reporting (#3458) arrived with the sync | Off unless the build sets `AIRI_ERROR_REPORT_DSN` | Whether the fork gets its own error-report project | `apps/stage-tamagotchi/src/shared/error-report-source.ts` |
| Beat sync layer | Not present; upstream's layer (`543d8dfe3`) arrived with the sync | Inactive under Natural | Roadmap slice CM5 settles music under Natural | `isBeatSyncLayered` in `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` |

Open question, not one of the three: fork source still names upstream's analytics endpoints, OpenPanel in `packages/stage-shared/src/analytics/openpanel.ts` and PostHog in `packages/stage-shared/src/analytics/posthog.ts`. They are used only when a build sets `VITE_ENABLE_ANALYTICS` and the user opts in. The owner has not decided on them.

## At each sync

1. Fetch upstream and work on `<username>/chore/upstream-sync`, in a worktree. Merge in steps of about 100 first-parent upstream commits, each a real merge of the last upstream commit of a day. Finish each step before the next.
2. Resolve by rule first:
   - A path in "Upstream files that stay deleted" stays deleted, including files upstream added under it.
   - A file in "Files the fork owns" keeps the fork's version.
   - Every other policy file takes upstream's bytes: `git checkout <upstream commit> -- <path>`.
   - Root `package.json` keeps the fork's scripts and takes upstream's new ones only when they serve a kept project.
   - `eslint.config.ts` and `turbo.json` are unions, as the tooling table states.
3. Merge the catalog in `pnpm-workspace.yaml` per entry. Take upstream's version unless the fork's is newer, and drop entries that only retired projects use.
4. Resolve the remaining conflicts by hand. Client stage code follows the character mind ADR's decision 14: take upstream's version, and keep fork behavior beside it.
5. Run `pnpm install`, then `pnpm lint:prune-suppressions`. Add no suppression for fork code. Wrap each Vitest config that upstream added in `withCpuSlots`, give each new package with tests a `test:run` script, and add a file that a package test reads outside its package to that package's `test:run` inputs in `turbo.json`.
6. Review upstream's policy diff: `git diff <previous upstream commit> <new upstream commit> -- AGENTS.md '*/AGENTS.md' DESIGN.md .github/CONTRIBUTING.md .agents/skills eslint.config.ts`. Decide each new rule, add the accepted ones to the fork's guidance in agent-configuration commits, and record every decision in "Upstream rules added since the fork point".
7. Compare the fork-owned skills with upstream's changes, and compare every other skill with upstream's bytes: `git diff <new upstream commit> HEAD -- .agents/skills`. Only fork-owned and fork-only files may differ.
8. Add a row here for every new departure, remove the rows the sync closed, and update `upstream-watch.md`, the README's Support scope tables, and the nested guides the sync made false.
9. After each step, run `pnpm verify --gate`, `pnpm test:run`, `pnpm test:root`, and `pnpm qa:display run -- pnpm qa:smoke`. `pnpm verify` runs only related tests, and a merge changes more than they reach. Record notable resolutions in each merge commit message.
10. Land with `git switch main && git merge --ff-only <branch> && git push`, never through a GitHub pull request.
