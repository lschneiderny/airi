# qa-tooling - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** The agents that check motion work, and you as the final visual reviewer. Instead of slow, hand-built recording sessions judged by rules that flip like a coin on still footage, an agent runs one command and gets a verdict that already accounts for the character's own idle fidgeting, plus a single review page for you.

**What you'll get:** A fast simulated test that runs the real emotion pipeline many times and says whether each emotion shows up clearly, in the right direction, at the right size, and lets go properly. You also get a scripted way to drive the real app for short rendered checks, a test of whether the real model can be run without the app at all, a readable report page, and general helpers that stop agent test runs failing for setup reasons or re-arguing which failures were already there.

**Why this approach:** Most of the slowness came from answering a statistics question with the most expensive tool, real-time app recordings. Running the same scripted scenario in simulation first, many times, compared against the character's own idle motion, makes verdicts both fast and trustworthy. The app is then used only to confirm the result carries over to the real screen.

**What it will NOT do:** It will not change how the character moves or retune any emotion, even where the new checks fail; failures come to you as findings. It will not judge whether motion looks natural, which stays your call. Its remote-control hook cannot exist in a shipped build.

**Effort:** XL
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - running the real model outside the app is unproven, and the bridge touches the desktop app's startup.
**Decisions to sanity-check:** One new internal tools package holds all the QA commands. The full emotion check is a separate command, not part of the everyday test run. Rendered runs prove only that results carry over to the screen; the statistics live in simulation. The old pre-registration step is replaced by gate settings kept in version control.

Your next move: read the review result below, then start execution with `/ulw-execute qa-tooling` when you're ready. Full execution detail follows below.

---

> TL;DR (machine): XL, Medium risk; 17 todos in 6 waves + F1-F4: qa-tools package (pnpm pin, doctor, known-failures, run dirs), stage-shared motion-scenario contract + bridge schemas, Natural observer + NaturalTrace v2, T2 spike, T1 runner on real conductor, idle-noise-relative emotion scorer + committed gates, dev-only Eventa bridge over remote debug, T3 harness, gate CLI, scorer validation, T2 runner/fallback, HTML report, T3 gates, docs + motion-qa skill.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected users:**
- U1 QA/verifier agents running motion acceptance. Today they rebuild a CDP harness per checkpoint (148 one-off scripts under `.omo/evidence/emotion-expression-performance/*-scripts`, `cdp.ts` copied 10x), run one real-time 7 s Electron capture per emotion cell, and score with rules that fail 34-99% (release) and ~50% (head sign) on emotion-free idle data. After: one command per level, a scored report in minutes, verdicts calibrated against idle noise.
- U2 Implementing agents tuning motion. Today: unit tests plus the idle liveliness gate only; emotion feedback needs Electron. After: a deterministic T1 scenario run plus the emotion scorer in seconds-to-minutes.
- U3 Luke (owner, visual QA). Today: reads raw evidence JSON and partial verdicts. After: one self-contained HTML review page per run with plots, screenshots, verdicts and the limitations statement; naturalness stays his call.
- U4 Agents doing QA in any package. Today: pnpm shim regeneration kills runs (exit 127), cold Vite optimizer reloads fail first browser runs, baselines are re-derived every plan, evidence gets lost on worktree removal. After: resolved pnpm, a doctor preflight, a known-failures registry with new-failures-only output, and an evidence convention.
- U5 End users of the app. Nothing changes: idle motion is bit-identical, no new random draws, no frame-cost change, and the QA bridge cannot exist in a production build.
- U6 Plan orchestrators and F-wave verifiers. After: gates are committed code with ids and versions, and a skill plus AGENTS.md routing says which level proves what.

Test levels used throughout: **T0** unit tests; **T1** deterministic controller simulation (real decider, conductor, hold performer, Natural controller and adapter, no rig); **T2** headless real rig (moc3 + Cubism core + physics in Node, fixed timestep; exists only if the spike says GO); **T3** rendered Electron run through the dev-only bridge; **T4** Luke's visual review of the HTML report.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | An agent answers "does this motion change meet its standard" at T1 with one command, without Electron, in minutes | U1/U2 speed |
| GAP-1 | No scenario runner; T1 exists only as idle/talking fixtures inside `liveliness-gate.test.ts` | emotion feedback needs Electron today |
| IS-2 | Emotion verdicts are idle-noise relative: false-positive rate on emotion-free runs within bounds, real recipe effects detected, weakened or sign-flipped recipes caught | U1/U3 trust; Luke's decision |
| GAP-2 | No emotion scorer in the repo; checkpoint-12 rules lived in a prereg JSON and per-task scripts; rules 2/3 noise-limited | verdicts were coin flips |
| IS-3 | One scenario file runs unchanged on T1/T2/T3 and yields event-stamped traces that one scorer reads | U1 consistency |
| GAP-3 | `NaturalTrace` has no events or sides; no shared scenario format; T1 and T3 use different entry points | alignment by wall clock today |
| IS-4 | Gate definitions (metrics, thresholds, trials, seeds) are committed code with ids and versions; reports record the gate file's git SHA | anti-tuning without ritual |
| GAP-4 | `score-natural-captures.ts:35-38` enforces preregistration through file mtimes | not reviewable in git |
| IS-5 | T2 is decided by a recorded go/no-go spike; on GO, post-physics scoring runs on the real rig at >=10x real time with no GPU; on NO-GO, a documented fallback | Luke's decision |
| GAP-5 | No headless rig runner; feasibility unproven (`cubism4.es.js:5322,5350` builds a WebGL renderer; core-in-Node unverified; EULA fit unverified) | spike needed |
| IS-6 | Rendered T3 runs go through typed dev-only bridge commands and one CLI with an isolated profile, parked cursor and guaranteed teardown | U1; Luke's decision |
| GAP-6 | Rendered QA uses copied CDP/DOM scripts with fixed sleeps, hardcoded ports and lane names | slow and fragile |
| IS-7 | The bridge cannot be enabled or reached in a production build, and opens no new port | U5 safety |
| GAP-7 | No bridge exists; any bridge is a new control surface | must be provably dev-only |
| IS-8 | Luke gets one self-contained HTML review page per run: verdicts, plots, screenshots, limitations statement | U3 |
| GAP-8 | No review artifact | he reads raw evidence |
| IS-9 | QA commands do not fail for environment reasons: pnpm resolved from the pinned version, doctor preflight, Vite warm-up | U4 |
| GAP-9 | Global pnpm shim regeneration broke 11 jobs (exit 127); cold Vite reload; no preflight | wasted runs |
| IS-10 | Test runs report new failures only, against a committed known-failures registry; fixed known failures are flagged for removal | U4 |
| GAP-10 | Baselines re-derived per plan (stage-shared 6 localStorage failures, stage-ui node 24-33); `.omo/slop/report.md` missing | repeated cost |
| IS-11 | QA output has one run-directory convention with a manifest, and plan evidence is archived to the main checkout before worktree removal | U4/U6 |
| GAP-11 | The natural-emotion-revamp evidence folder is missing from both the main checkout and its worktree | no convention |
| IS-12 | Agents find the tooling through a `motion-qa` skill, AGENTS.md routing, package READMEs and an ADR | U6 |
| GAP-12 | No skill, routing, or ADR for motion QA levels | agents rediscover it |
| IS-13 | Runtime unchanged for end users: idle path bit-identical, no new random draws, stream indices unchanged, lab capture still works | U5 |
| GAP-13 | New seams (observer, trace events, bridge handlers, subpath exports) touch runtime files | must stay inert |
| IS-14 | The idle liveliness gate keeps its exact meaning after moving into the gate framework | regression safety |
| GAP-14 | Gated metrics live as a literal list in `liveliness-gate.test.ts`; bands in `reference-stats.ts` | migration risk |

### Must have
- A new private, Node-only workspace package `packages/qa-tools` (`@proj-airi/qa-tools`) that owns runners, harness, CLIs, report, doctor, pnpm resolution, known-failures registry and run directories.
- A pure scenario contract `@proj-airi/stage-shared/motion-scenario` (schema, player, emotion stripping, gate scenario builders, bridge command schemas and Eventa contracts).
- A read-only Natural observer, `NaturalTrace` version 2 with events and sides, and explicit `stage-ui-live2d` subpath exports so Node never loads the Pixi barrel.
- A pure emotion scorer and committed gate definitions in `stage-ui-live2d/src/composables/live2d/natural-motion/`, with the idle liveliness gate migrated and the preregistration CLI replaced by gate ids.
- A T1 runner that uses the real `StagePerformanceConductor`, `EmotionHoldPerformer`, `Live2DNaturalMotion` and `Live2DNaturalMotionAdapter`.
- A T2 spike with a recorded verdict, then either a T2 runner (GO) or a documented fallback (NO-GO).
- A dev-only Eventa bridge reached over remote debug, gated three ways, and a T3 harness/CLI that drives it.
- A self-contained HTML review report.
- A doctor command, pnpm resolution, a known-failures registry with new-failures-only reporting, and a run-directory/evidence convention.
- A `motion-qa` skill, AGENTS.md routing and command lines, package READMEs, and an ADR.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No change to Natural, expression, decider or conductor runtime behavior: idle path bit-identical, no new random draws, no changed draw order, stream indices 0-12 unchanged, no recipe or settings-default retuning. Scorer verdicts that fail are reported, never "fixed" by retuning in this plan.
- No bridge code reachable in a production renderer bundle; no new listening port or server; no bridge registration unless all three gates hold.
- No new third-party dependencies. `package.json` changes are limited to: the new `packages/qa-tools/package.json` (catalog/workspace deps only), root `qa:*` scripts, new subpath exports in `stage-ui-live2d`, `stage-shared` and `scenarios-stage-tamagotchi-electron`, and the matching `pnpm-lock.yaml` importer entries.
- No rig files, Cubism core files, zipped rigs, captured traces or screenshots committed.
- No skipped, deleted, or weakened tests; pre-existing failures go into the registry only.
- No edits to non-English locales, Kirie (`apps/stage-tamagotchi-kirie/**`), or `.omo/plans/*` except checkbox updates by the orchestrator.
- No naturalness claims from any scorer or report.
- No reuse of Luke's real Electron profile; every T3 run uses a temporary `APP_USER_DATA_PATH`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after (Luke, 2026-10-20), Vitest. Every todo ships its code and its tests in the same commit. Tests follow `.agents/skills/enforce-rules-for-vitest/SKILL.md`: no fixed sleeps, seeded randomness, real stores (pinia `createPinia()` + `setActivePinia`), no private-field reads, no prose pinning. Agent-executed QA is always included.
- Evidence: `.omo/evidence/qa-tooling/task-<N>-<name>.<ext>` in the integration worktree; tool run output goes to `.temp/qa/<runId>/` (gitignored, `.gitignore:18`). Before any worktree is removed, evidence is archived to the main checkout with the todo-4 `evidence archive` command. Every receipt records the exact command, exit code and pass/fail counts.
- Package commands (run from the worktree root):
  - `pnpm -F @proj-airi/stage-shared exec vitest run`
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` (projects `node` and `browser`)
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node <path>` / `--project browser <path>`
  - `pnpm -F @proj-airi/qa-tools exec vitest run` (default project `node`; the `gate` project only through the CLI)
  - `pnpm -F @proj-airi/scenarios-stage-tamagotchi-electron exec vitest run`
  - typecheck: `pnpm -F <pkg> typecheck`
  - Root `pnpm typecheck` and `pnpm lint` run only in todo 17 and the final wave (memory pressure: never two heavyweight checks at once).
- Gitignored references: `.omo/evidence/**` and `.omo/ulw-execute/**` are gitignored (`.gitignore:24,26`) and do not exist in a fresh worktree; read every reference under those paths from the main checkout, `C:/Users/Luke/projects/dtuber/.omo/...`.
- Golden idle hash: before todo 1, compute the sha256 of 600 s of `Live2DNaturalMotion.advance()` frames at 120 Hz (JSON of `{ pose, fixation, face, blink, breath }`, seeds 1-3, desk home) on the base commit and record it in `task-0-baseline.txt`; todos 6, 8, 9 and 10 each re-run it and must match (todo 6 commits it as a test).
- Baseline: before todo 1, run the stage-shared, stage-ui-live2d, stage-ui (node and browser), scenarios-stage-tamagotchi-electron and pipelines-audio suites on the base commit and save `task-0-baseline.txt` (command, exit, failing test ids with first error line). A failure present at base is pre-existing; it is never fixed by deletion or skip, and todo 3 moves it into the registry.
- Worktree prerequisites: `pnpm install --frozen-lockfile`, then `pnpm run build:packages`. If install rewrites `integrations/vscode/vscode-airi/package.json` line endings, restore it with `git checkout -- integrations/vscode/vscode-airi/package.json`. Any `pnpm` script run after a root `package.json` edit auto-runs install; call binaries through `node_modules/.bin/` when that matters.
- Rendered runs (todos 7, 11, 16, F3): temporary profile via `APP_USER_DATA_PATH=<run dir>/profile`, `APP_REMOTE_DEBUG=true`, a free `APP_REMOTE_DEBUG_PORT`, `APP_REMOTE_DEBUG_NO_OPEN=true`, `APP_MOTION_QA_BRIDGE=true`. Rigs come from `AIRI_QA_RIG_FORBOOTH=C:/Users/Luke/Documents/Live2d Models/ForBOOTH-231-Holder-only@Do-not-share-or-resell` (and `AIRI_QA_RIG_BEAR=C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1`, unused unless asked); never copied into git. Bear inherits ForBOOTH results (Luke, 2026-10-18). Never run a T3 capture while a heavyweight check runs.
- Reporting limitation (Luke, 2026-10-19): every QA report and verdict states that scores prove direction, size relative to the recipe, release and detectability above the rig's idle noise, not naturalness; the desk VTS recordings are valid for idle liveliness only.

## Execution strategy
Integration branch `luke/feat/qa-tooling` in worktree `C:/Users/Luke/projects/dtuber-wt/qa-tooling`, created from the current `main` tip (must contain the commit that adds `.omo/plans/qa-tooling.md`): `git -C C:/Users/Luke/projects/dtuber worktree add -b luke/feat/qa-tooling C:/Users/Luke/projects/dtuber-wt/qa-tooling main`. Record the base SHA in `task-0-baseline.txt`. Parallel todos run in per-todo worktrees branched from the integration tip and land by fast-forward or cherry-pick after an independent gate. Delivery is direct: no push, no PR.

Worker routing note: if a category fails at dispatch because its provider is unavailable, re-route to `deep-low` or `unspecified-high`; that is a harness failure, not an attempt.

### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- **Wave 0 (foundation):** todo 1 (the package every later qa-tools todo lives in).
- **Wave 1 (parallel, isolated lanes):** todos 2, 3, 4 (qa-tools `src/env`, `src/known-failures`, `src/evidence`), 5 (stage-shared), 6 (stage-ui-live2d), 7 (T2 spike; evidence plus `packages/qa-tools/docs/`).
- **Wave 2 (parallel):** todos 8 (T1 runner), 9 (scorer and gates), 10 (bridge).
- **Wave 3 (parallel):** todos 11 (T3 harness), 12 (emotion gate CLI), 14 (T2 runner or fallback).
- **Wave 4:** todos 13 (scorer validation) and 15 (HTML report) in parallel; then 16 (T3 gates on ForBOOTH) after 15, per the dependency matrix.
- **Wave 5:** todo 17 (docs, skill, routing, root checks).
- **Final:** F1-F4 in parallel; F3 waits until F2's heavyweight checks finish.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2, 3, 4, 7, 8, 11, 12, 14 | - |
| 2 | 1 | 17 | 3, 4, 5, 6, 7 |
| 3 | 1 | 17 | 2, 4, 5, 6, 7 |
| 4 | 1 | 11, 12, 15 | 2, 3, 5, 6, 7 |
| 5 | - | 8, 10, 12 | 2, 3, 4, 6, 7 |
| 6 | - | 8, 9, 10 | 2, 3, 4, 5, 7 |
| 7 | 1 | 14 | 2, 3, 4, 5, 6 |
| 8 | 1, 5, 6 | 11, 12, 14 | 9, 10 |
| 9 | 6 | 12, 13, 14 | 8, 10 |
| 10 | 5, 6 | 11 | 8, 9 |
| 11 | 1, 4, 8, 10 | 15, 16 | 12, 14 |
| 12 | 4, 5, 8, 9 | 13, 15, 16 | 11, 14 |
| 13 | 12 | 17 | 15, 16 |
| 14 | 7, 8, 9 | 17 | 11, 12 |
| 15 | 4, 11, 12 | 16, 17 | 13 |
| 16 | 11, 12, 15 | 17 | 13 |
| 17 | 2, 3, 13, 14, 16 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Create the `@proj-airi/qa-tools` package with pinned pnpm resolution
  What to do:
  - Create `packages/qa-tools/` as a private ESM workspace package: `package.json` (`name: @proj-airi/qa-tools`, `private: true`, `type: module`; scripts `typecheck: tsc --noEmit`, `doctor`, `test:qa`, `motion`, `report`, `evidence` added by later todos; deps only `catalog:`/`workspace:` entries: `@moeru/std`, `valibot`, `@proj-airi/stage-shared`, `@proj-airi/stage-ui-live2d`, `@proj-airi/stage-ui`, `@proj-airi/scenarios-stage-tamagotchi-electron`, `jszip`, `pinia`, `vue`; devDeps `vitest`, `@vitejs/plugin-vue`, `typescript`, `tsx`, `@types/node`), `tsconfig.json` (model it on `packages/scenarios-stage-tamagotchi-electron/tsconfig.json`; Node types; include `src`, `bin`, `gates`), `vitest.config.ts` (projects: `node` = `src/**/*.test.ts`; `gate` = `gates/**/*.gate.ts`, `pool: 'forks'`, `testTimeout: 0`; both with `@vitejs/plugin-vue` so transitive stage-ui imports resolve the way `packages/stage-ui/vitest.config.ts:33-50` does), `README.md` (structured: Purpose, Usage, When to use, When not to use), and `src/env/pnpm.ts`.
  - `src/env/pnpm.ts`: `readPinnedPnpmVersion(repoRoot)` parses root `package.json` `packageManager` (`package.json:6`, `pnpm@11.24.0`); `resolvePnpm({ repoRoot, env })` returns `{ version, node: process.execPath, entry }` where `entry` is the pnpm JS entry inside `<PNPM_HOME>/.tools/pnpm/<version>/` (inspect `C:/Users/Luke/AppData/Local/pnpm/.tools/pnpm/11.24.0/` to find the exact entry file, ignore `*_tmp_*` dirs), falling back to `npm_execpath` only when it is a JS file of the same version; otherwise throw an error naming the expected path and the fix (`corepack`/`pnpm self-update` is NOT run automatically). `spawnPnpm(args, options)` spawns `[node, entry, ...args]` with `shell: false` and writes one line `qa-tools: pnpm <version> via <entry>` to stderr. `resolveVitestEntry()` resolves the Vitest CLI file via `import.meta.resolve('vitest/package.json')` + its `bin` field, so later CLIs never go through a `.cmd` shim.
  - Run `pnpm install` once so `pnpm-lock.yaml` gets the new importer (CI runs `pnpm install --frozen-lockfile`, `.github/workflows/ci.yml:44,104,153,177`); restore any unrelated line-ending churn (`integrations/vscode/vscode-airi/package.json`).
  - Add `packages/qa-tools/vitest.node.config.ts` (the `node` project only, mirroring `packages/stage-ui-live2d/vitest.node.config.ts`) to the root `vitest.config.ts` `projects` list, which lists projects by config path, so CI's `pnpm run test:run` covers it; the `gate` project is never included there.
  - Conductor smoke test `packages/qa-tools/src/motion/conductor-smoke.test.ts`: construct `StagePerformanceConductor` from `@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor` with a fake clock and fake timers (pattern `use-stage-performance-conductor.test.ts:203`), call `emotion('angry', 0.9, 'devtools')`, assert the scene received one episode and one hold; it must pass under `pool: 'forks'` with 4 workers. If it cannot load, move only the `StagePerformanceConductor` class (no behavior change) into `packages/stage-ui/src/composables/performance/stage-performance-conductor.ts` with just the imports it uses, re-export it from the composable module, rerun the stage-ui conductor tests, and record the move in evidence.
  Must NOT do: add any non-catalog dependency; add scripts that shell out through `pnpm.cmd`; touch other packages.
  Closes: GAP-9 (pnpm part), groundwork for GAP-1/6/8/10/11
  Parallelization: Wave 0 | Blocked by: none | Blocks: 2, 3, 4, 7, 8, 11, 12, 14
  References: root `package.json:6`; `.tool-versions` (nodejs 26.7.0, pnpm 11.24.0); exit-127 incident in `.omo/ulw-execute/ledger.jsonl` (event `final-gate-rerun`, root cause: PNPM_HOME shims regenerated mid-run); `C:/Users/Luke/projects/dtuber-dev-launcher/scripts/dev-launcher.mjs:26-37` (`parseCmdShim`, `resolveCommand` - read-only pattern for avoiding `.cmd` wrappers); `packages/stage-ui/vitest.config.ts:15-90`; root AGENTS.md conventions (kebab-case, no `any`, structured README).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools typecheck` exits 0; `pnpm -F @proj-airi/qa-tools exec vitest run --project node` passes `src/env/pnpm.test.ts`, which covers: version parse; resolution from a temp fake `PNPM_HOME/.tools/pnpm/<v>/` layout; `_tmp_` dirs ignored; missing version throws an error containing the expected path; `npm_execpath` of a different version rejected. `git diff --stat` shows only `packages/qa-tools/**`, root `vitest.config.ts`, the `pnpm-lock.yaml` importer block, and - only if the conductor-move fallback was needed - `packages/stage-ui/src/composables/performance/stage-performance-conductor.ts` plus the re-export in `use-stage-performance-conductor.ts`.
  QA scenarios: happy - `node --import tsx -e "import('./packages/qa-tools/src/env/pnpm.ts').then(m=>console.log(JSON.stringify(m.resolvePnpm({repoRoot: process.cwd(), env: process.env}))))"` prints version 11.24.0 and an existing entry path; Evidence `.omo/evidence/qa-tooling/task-1-pnpm-resolve.txt`. Failure - same with `PNPM_HOME` set to an empty temp dir exits non-zero with the expected-path message; Evidence `.omo/evidence/qa-tooling/task-1-pnpm-missing.txt`.
  Commit: Y | feat(qa-tools): add qa-tools package with pinned pnpm resolution
  Recommended task executor category: unspecified-low - one new package with a small, well-specified module.

- [x] 2. Add the `doctor` preflight command and Vite warm-up
  What to do:
  - `packages/qa-tools/src/env/doctor.ts` exports `runDoctor(probes)` returning rows `{ id, status: 'ok' | 'warn' | 'fail', detail, fix }`; every probe is injectable for tests. Checks, in order:
    1. `node-version`: `process.version` major.minor equals `.tool-versions` `nodejs` (fail otherwise).
    2. `pnpm`: `resolvePnpm` (todo 1) succeeds (fail otherwise).
    3. `install`: `node_modules/.modules.yaml` exists (fail; fix `pnpm install --frozen-lockfile`).
    4. `built-packages`: for every `packages/*/package.json` whose `exports` values point into `./dist/`, the referenced files exist; `packages/i18n/dist` is newer than the newest `packages/i18n/src/locales/en/**/*.yaml` (fail; fix `pnpm run build:packages` or `pnpm -F @proj-airi/i18n build`).
    5. `cubism-core`: `apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js` and the `apps/stage-web` copy exist (fail; the fix text names the command that downloads it - find it by grepping the app Vite configs/plugins for `CubismSdkForWeb` and record it in the row).
    6. `playwright`: Chromium executable from `playwright-core` exists (warn; fix `pnpm exec playwright install chromium`).
    7. `rigs`: `AIRI_QA_RIG_FORBOOTH` / `AIRI_QA_RIG_BEAR` each point to a directory containing a `*.model3.json` at depth <= 2 (warn when unset; fail when set but invalid).
    8. `stray-electron`: no running process whose command line contains `stage-tamagotchi` and `electron` (win32: `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select ProcessId,CommandLine | ConvertTo-Json"`; posix: `ps -eo pid,args`) (warn with PIDs).
  - `--warm` flag: runs `packages/stage-ui/src/components/scenes/live2d-blink-ownership.browser.test.ts` through the Vitest entry from todo 1 with `--project browser`; if the first run fails with `optimized dependencies changed`, run it once more and report `warm: ok after reload`; any other failure is reported verbatim.
  - `packages/qa-tools/bin/doctor.ts` prints a table (or JSON with `--json`), exits 1 on any `fail`, 0 otherwise. Add package script `doctor: tsx bin/doctor.ts` and root script `qa:doctor: pnpm -F @proj-airi/qa-tools run doctor`.
  Must NOT do: auto-fix anything (doctor only reports); kill processes; read rig file contents beyond listing names.
  Closes: GAP-9
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 17
  References: `.tool-versions`; `.github/workflows/ci.yml:20-23` (CI Node pin, informational); `packages/i18n/tsdown.config.ts`; memory of i18n staleness: browser tests pass vacuously when i18n dist is stale (`t(key)` returns the key); cold optimizer reload symptom "optimized dependencies changed. reloading" on first stage-ui browser run; `apps/stage-tamagotchi/src/renderer/index.html:18`, `apps/stage-web/index.html:88` (core path); `.omo/evidence/emotion-expression-performance/task-26-scripts/teardown.ps1` (process-listing pattern).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/env/doctor.test.ts` passes, covering each check's ok/warn/fail with injected probes (no real process listing, no real filesystem outside temp dirs). `pnpm -F @proj-airi/qa-tools typecheck` exits 0.
  QA scenarios: happy - `pnpm qa:doctor --json` in the worktree exits 0 with only ok/warn rows; Evidence `.omo/evidence/qa-tooling/task-2-doctor.json`. Failure - `AIRI_QA_RIG_FORBOOTH=C:/nonexistent pnpm qa:doctor` exits 1 with a `rigs` fail row naming the path; Evidence `.omo/evidence/qa-tooling/task-2-doctor-fail.txt`. Warm - `pnpm qa:doctor --warm` reports `warm: ok` or `warm: ok after reload`; Evidence `.omo/evidence/qa-tooling/task-2-warm.txt`.
  Commit: Y | feat(qa-tools): add doctor preflight for QA runs
  Recommended task executor category: unspecified-high - many independent checks across the repo layout with injectable probes.

- [x] 3. Add the known-failures registry and the new-failures-only test runner
  What to do:
  - `packages/qa-tools/known-failures.json` plus `src/known-failures/schema.ts` (valibot `strictObject`): `{ version: 1, entries: Array<{ package: string, project: 'node' | 'browser' | 'default', file: string, name: string, reason: string, since: string (YYYY-MM-DD), removeWhen: string, flaky?: true }> }`.
  - `src/known-failures/diff.ts`: `diffFailures(results, registry)` -> `{ newFailures, knownFailing, fixedKnown, flakyPassed }`; matching key is `package + project + file + full test name`.
  - `bin/test.ts` (package script `test:qa`, root script `qa:test: pnpm -F @proj-airi/qa-tools run test:qa`): `--package <name>` (repeatable) `[--project node|browser]` `[--all]` where `--all` = stage-shared, stage-ui-live2d, stage-ui (node + browser), qa-tools, scenarios-stage-tamagotchi-electron, pipelines-audio. For each target it runs the Vitest entry (todo 1) with `--config packages/<pkg>/vitest.config.ts --project <p> --reporter=json --outputFile=<runDir>/vitest-<pkg>-<project>.json` (run directory from todo 4 if landed; otherwise `.temp/qa/<timestamp>-test/`), parses the JSON, and prints NEW failures (exit 1), KNOWN failing (exit 0), FIXED known failures ("remove from registry", exit 0), and flaky entries that passed.
  - Seed the registry on the integration base: run `pnpm qa:test --all`, and for each failing test run it alone once to capture the first error line; write a concrete `reason` (for example "localStorage is undefined in the node project") and `removeWhen`. Include the stage-ui sessions-dialog test that hangs on the delete click on "Second chat" as `flaky: true` if it reproduces. For every package in `task-0-baseline.txt` the registry must match it exactly (any extra failure means the base is not what the baseline recorded, so stop and report); `@proj-airi/qa-tools`, which did not exist at base, must have zero failures and zero registry entries.
  Must NOT do: skip, delete, or edit any test; add entries without a concrete reason; treat a timeout of the runner itself as a known failure.
  Closes: GAP-10
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 17
  References: `.omo/ulw-execute/ledger.jsonl` events `setup-done-claim-and-gate-dispatch` (stage-shared 6 failed/333 passed; stage-ui 33 failed/1616 passed) and `root-observation` task 12 (stage-ui node 24 = baseline); `.omo/drafts/natural-emotion-revamp.md:90` (missing `.omo/slop/report.md`); per-package `vitest.config.ts` projects (`packages/stage-ui/vitest.config.ts:53-90`, `packages/stage-ui-live2d/vitest.config.ts:7-29`); `packages/stage-ui/src/libs/providers/providers/aliyun-nls/token.test.ts:75` (env-gated skip, not a quarantine).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/known-failures` passes (diff logic: new, known, fixed, flaky, key matching, schema rejects missing reason). `pnpm qa:test --package @proj-airi/stage-shared` exits 0 and prints 0 new failures with the known count equal to the baseline.
  QA scenarios: happy - `pnpm qa:test --all`; Evidence `.omo/evidence/qa-tooling/task-3-qa-test-all.txt`. Failure - copy the registry to a temp file, remove one stage-shared entry, run `pnpm qa:test --package @proj-airi/stage-shared --registry <temp>`: exits 1 and lists exactly that test as NEW; Evidence `.omo/evidence/qa-tooling/task-3-new-failure.txt`.
  Commit: Y | feat(qa-tools): add known-failures registry and new-failures-only test runner
  Recommended task executor category: unspecified-high - runner plus careful seeding from real suite runs.

- [x] 4. Add the run-directory convention and evidence archiving
  What to do:
  - `packages/qa-tools/src/evidence/run.ts`: `createRun({ tool, label, repoRoot })` creates `.temp/qa/<YYYYMMDD-HHmmss>-<tool>-<label>/` and returns a handle with `path(name)`, `addArtifact(relPath, kind)` (records sha256) and `finish(result)`. It writes `run.json` = `{ runId, tool, label, gitSha, dirty, startedAt, endedAt, command: process.argv, env: subset of APP_* and AIRI_QA_* keys, gate?: { id, version, fileSha }, artifacts: [{ path, kind, sha256 }], result: { exitCode, summary } }`. `gitSha`/`dirty` come from `git rev-parse HEAD` / `git status --porcelain` (injectable for tests).
  - `bin/evidence.ts archive --plan <slug> --from <worktree-path>` (package script `evidence`): resolves the main checkout as the first `worktree` entry of `git worktree list --porcelain`, copies `<worktree>/.omo/evidence/<slug>/` into `<main>/.omo/evidence/<slug>/` through a temp dir then rename, refuses (exit 1, nothing copied) when a same-named file with different bytes exists, and writes/updates `<main>/.omo/evidence/<slug>/manifest.json` with sha256 per file.
  - Document both in the qa-tools README section "Evidence".
  Must NOT do: delete anything at source; commit evidence.
  Closes: GAP-11
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 11, 12, 15
  References: `.gitignore:18,24` (`.temp`, `.omo/evidence/`); `apps/stage-tamagotchi/scripts/desktop-overlay-live-window-smoke.ts:44-46` (`.temp/<tool>-<runId>` precedent); ledger events `lane-worktree-removed` and `gate-worktree-removed` ("evidence archived" without a location).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/evidence` passes: run dir naming, manifest fields, sha256, archive copy, conflict refusal leaves destination untouched, manifest update is idempotent.
  QA scenarios: happy - create a temp git worktree fixture with `.omo/evidence/demo/a.txt`, run `pnpm -F @proj-airi/qa-tools run evidence archive --plan demo --from <fixture>`; manifest lists `a.txt`; Evidence `.omo/evidence/qa-tooling/task-4-archive.txt`. Failure - rerun after changing `a.txt` at the destination: exit 1, destination unchanged; Evidence `.omo/evidence/qa-tooling/task-4-conflict.txt`.
  Commit: Y | feat(qa-tools): add QA run directories and evidence archiving
  Recommended task executor category: unspecified-low - small filesystem utilities with tests.

- [x] 5. Add the motion scenario contract to `stage-shared`
  What to do:
  - New folder `packages/stage-shared/src/motion-scenario/` with `schema.ts`, `player.ts`, `strip.ts`, `builders.ts`, `bridge.ts`, `index.ts` and tests; add subpath export `"./motion-scenario": "./src/motion-scenario/index.ts"` to `packages/stage-shared/package.json`.
  - `schema.ts` (valibot `strictObject`, `version: literal(1)`): `MotionScenario = { version, id, seed (uint32), durationSeconds, home?: PostureHome value used by Natural, levels: ('t1'|'t2'|'t3')[], settings?: { heldEmotions?: boolean, cursorAttention?: boolean, expressionEnabled?: boolean, performance?: unknown (validated later with parseExpressionPerformanceSettings) }, screenshotsAt?: number[], events: ScenarioEvent[] }`. `ScenarioEvent` (each with `at` seconds >= 0, events sorted by `at`): `emotion { emotion: PerformanceEmotion, band: Band, source: 'devtools' | 'act', trialId? }`, `act { marker: string, trialId? }` (raw `<|ACT {...}|>` text), `mode { mode: PerformanceMode, energy? }`, `speech { turnId, seconds, envelopeSeed }` (T1/T2 only), `cursor { x, y } | { clear: true }` (T1/T2 only), `expression { expressionId, on: boolean }`, `placebo { trialId }`, `noop { replaced: 'emotion' | 'act', trialId? }`, `marker { label }`. A scenario whose `levels` includes `t3` must not contain `speech` or `cursor` events (schema refinement with a clear message).
  - `player.ts`: `createScenarioPlayer(scenario).eventsBetween(t0, t1)` returns events with `t0 < at <= t1` in array order; pure; no clocks or timers.
  - `strip.ts`: `stripEmotions(scenario)` replaces every `emotion`/`act` event by `noop` with the same `at` and `trialId`, keeping array length and every other event unchanged (paired null runs keep identical timelines).
  - `builders.ts`: `buildEmotionTrial({ emotion, band, variant: 'full' | 'held-only', seed, warmup = 20, hold = 4, post = 6 })` (pulse at `warmup`, `trialId` = `${emotion}-${band}-${variant}-${seed}`); `buildIdleWithPlacebos({ seed, warmup = 20, placebos = 10, spacing = 6 })`; `buildLongHold({ emotion, band, seed, seconds = 60 })`, which sets `settings.performance` so the turnless hold lasts `seconds` (find the exact field - README says `held.turnlessSeconds`, see `packages/stage-shared/src/expression-performance/settings.ts:150-220`). `variant: 'held-only'` sets the band head/face gains to 0 (field names at `settings.ts:70-80`; the ultrabrain design cites `settings.ts:78` as the neutral value). Each builder's output passes the schema.
  - `bridge.ts`: valibot schemas and `defineInvokeEventa` contracts (ids `eventa:invoke:motion-qa:<name>`) for: `state` -> `{ modelId, modelLoaded, driver, cursorAttention, expressionEnabled, heldEmotions, naturalActive, hold: { emotion, strength } | null, captureActive }`; `configure` `{ driver?: 'natural', cursorAttention?, expressionEnabled?, heldEmotions? }`; `importModelFromInput` `{ inputId }` -> `{ modelId }`; `startCapture` `{ durationSeconds (1-600), extraParameterIds?: string[], label }` -> `{ captureId }`; `runScenario` `{ scenario }` -> `{ dispatched: number, rejected: { at, kind, reason }[] }`; `awaitCapture` `{ captureId }` -> `{ trace: NaturalTrace v2 JSON }`. Export `createMotionQaContext()` (a lazily created window-local Eventa context on a dedicated `EventTarget` via `@moeru/eventa/adapters/event-target`) and `isMotionQaBridgeEnabled()` = `globalThis.__airiMotionQaEnabled === true`.
  Must NOT do: import Vue/Pinia/DOM types into `motion-scenario`; read clocks or randomness.
  Closes: GAP-3 (contract), groundwork for GAP-1/6/7
  Parallelization: Wave 1 | Blocked by: none | Blocks: 8, 10, 12
  References: `packages/stage-shared/src/expression-performance/types.ts:4-80` (`PerformanceEmotion`, `Band`, `AffectSignal`, `Decider`); `packages/stage-shared/src/expression-performance/trace.ts:33-87` (valibot strict schema style); `packages/stage-shared/src/expression-performance/affect-trace-diagnostics.ts:6,34-48` (Eventa contracts in stage-shared); `packages/stage-shared/src/beat-sync/eventa.ts:7-29`; `packages/stage-shared/src/performance-state/index.ts:30` (`PerformanceState`, modes); `.agents/skills/eventa/SKILL.md`; `node_modules/.pnpm/@moeru+eventa@1.0.2*/node_modules/@moeru/eventa/package.json` exports (`./adapters/event-target`); `packages/stage-shared/AGENTS.md`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/motion-scenario` passes: schema accepts builder outputs and rejects unsorted events, unknown kinds, `t3` with speech; player half-open windows and order; `stripEmotions` keeps length/timestamps and only swaps emotion/act; builders deterministic; bridge schemas round-trip. `pnpm -F @proj-airi/stage-shared typecheck` exits 0. Full stage-shared suite shows no new failures versus the registry/baseline.
  QA scenarios: happy - `node --import tsx -e` script that builds `buildEmotionTrial({emotion:'angry',band:'strong',variant:'full',seed:1})`, validates it, and prints `eventsBetween(19.9, 20.1)`; Evidence `.omo/evidence/qa-tooling/task-5-scenario.txt`. Failure - validating a `t3` scenario with a `speech` event prints the refinement error; Evidence `.omo/evidence/qa-tooling/task-5-reject.txt`.
  Commit: Y | feat(stage-shared): add motion scenario contract and QA bridge schemas
  Recommended task executor category: deep-low - several pure modules plus exact settings field lookups the worker can settle from the code.

- [x] 6. Add the Natural observer, NaturalTrace v2 events, a recipe-table seam, and Node-safe subpath exports
  What to do:
  - In `Live2DNaturalMotion` (`packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts:70`): add `setObserver(observer: NaturalMotionObserver | null)`. Observer events (types in `natural-motion/frame-types.ts`): `impulse { at, emotion, band, intensity, side }` when an episode is consumed (`impulses.ts`, side drawn at `:143`), `hold { at, emotion | null, strength, side }` whenever the held emotion or its side changes (`natural-motion/hold.ts:62-68,96`), `gesture { at, gesture, side }` when a gesture clip starts (`gestures.ts:54`). The observer receives values that are already computed; when it is `null`, no extra object is allocated. No random draw is added or moved.
  - Add constructor option `emotionTable?: typeof naturalEmotions` (default the existing table from `natural-motion/emotions.ts`) used wherever the table is read; it exists for scorer mutation tests and is documented as a QA seam.
  - Export the read-only Natural instance from `Live2DNaturalMotionAdapter` (`natural-motion-adapter.ts:126`) as `get natural()` if it is not already reachable.
  - `natural-motion/trace.ts`: `NaturalTrace` gains `version: 2` and `events: NaturalTraceEvent[]` (`{ t, source: 'natural' | 'scenario', event }`), plus optional constructor option `extraParameterIds` on `NaturalTraceRecorder` so rig-specific switches (for example ForBOOTH `Param60`) are recorded; `mark(nowSeconds, source, event)` stores `t` on the same origin as `sample` (`trace.ts:86-150`). `LivelinessTrace` and `scoreLiveliness` ignore events.
  - `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts`: add `markCaptureEvent(event)` (in-window only, used by the bridge) and make the `Model.vue` capture (`Model.vue:1102-1146`) attach the observer for the capture's duration and mark both observer and scenario events into the recorder; detach in `stop()`.
  - Move `syllableFixture` from `liveliness-gate.test.ts` into `natural-motion/speech-fixture.ts` (exported) and import it back in the test unchanged.
  - `packages/stage-ui-live2d/package.json` exports: add `"./composables/live2d/natural-motion": "./src/composables/live2d/natural-motion.ts"`, `"./composables/live2d/natural-motion/*": "./src/composables/live2d/natural-motion/*.ts"`, `"./composables/live2d/natural-motion-adapter": "./src/composables/live2d/natural-motion-adapter.ts"`, `"./composables/live2d/expression/hold": "./src/composables/live2d/expression/hold.ts"`.
  - Tests: (a) bit-identity - BEFORE editing, compute a sha256 over 600 s of `advance()` frames at 120 Hz for seeds 1-3 (idle, desk home) and over a fixed emotion timeline (angry strong at 20 s, happy clear at 40 s) and commit the hashes as constants in `natural-motion/observer.test.ts`; after the change the same hashes must hold with no observer AND with an observer attached; (b) observer emits impulse/hold/gesture events at the expected times with sides; (c) `node-import.test.ts` in the node project imports each new subpath and asserts that no `pixi` module and no `window` access is needed (the node project has no `window`).
  Must NOT do: change any draw order, stream index (`natural-motion.ts:40`), default value, or recipe; change lab capture behavior other than adding events.
  Closes: GAP-3, GAP-13 (observer and exports part)
  Parallelization: Wave 1 | Blocked by: none | Blocks: 8, 9, 10
  References: `natural-motion.ts:40,45,70,110-127,133-276,306-326`; `natural-motion/frame-types.ts`; `natural-motion/impulses.ts:57-66,143`; `natural-motion/hold.ts:43,62-68,96`; `natural-motion/gestures.ts:54`; `natural-motion/emotions.ts`; `natural-motion/trace.ts:9-150`; `natural-motion-adapter.ts:18-21,126,174-180,298-308`; `components/scenes/live2d/Model.vue:160,1102-1146`; `stores/natural-motion-diagnostics.ts:103-298`; `natural-motion/liveliness-gate.test.ts` (`syllableFixture`); `packages/stage-ui-live2d/README.md` ("What Natural owns" and "Natural motion lab").
  - Frame cost: a micro-benchmark script (`packages/stage-ui-live2d/scripts/bench-natural.ts`: 10k frames of `advance` + adapter compose on a stub core, median of 5) run at base and after; the after/base ratio is recorded in evidence and must be <= 1.05 (not a Vitest assertion).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` shows no new failures (node and browser), including the unchanged `liveliness-gate.test.ts` and the new hash tests; benchmark ratio <= 1.05; `pnpm -F @proj-airi/stage-ui-live2d typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0.
  QA scenarios: happy - the hash test output (both observer states equal to the pre-change hashes); Evidence `.omo/evidence/qa-tooling/task-6-bit-identity.txt`. Failure - temporarily add one extra `random()` call in the observer path, rerun the hash test, confirm it fails, revert; Evidence `.omo/evidence/qa-tooling/task-6-mutation.txt`.
  Commit: Y | feat(stage-ui-live2d): add Natural observer and event-stamped traces
  Recommended task executor category: deep-high - runtime controller seam whose correctness rests on determinism invariants.

- [x] 7. Run the T2 headless-rig spike and record a GO/NO-GO verdict
  What to do:
  - Spike code lives in `packages/qa-tools/spikes/t2/` (excluded from `tsconfig` include and from Vitest `node`), report in `packages/qa-tools/docs/t2-spike.md`, verdict JSON in evidence. Steps, in order, each recorded with its outcome:
    1. EULA: read the license URL in the core header (`live2dcubismcore.min.js` lines 2-7, Live2D Proprietary Software License, "Redistributable Code"), quote the clauses about use and redistribution in the report, and record Luke's decision (2026-10-20): running the core in Node for local, non-distributed QA is allowed. The verdict is technical only.
    2. Load the core in Node with `vm.runInThisContext(readFileSync(corePath))` and no `window`; call `Live2DCubismCore.Version.csmGetVersion()`. The core has a Node branch (`process.versions.node`, `require('fs')`) and stubs `WebAssembly` (asm.js); record any global shim actually needed.
    3. Load ForBOOTH's `.moc3` from `AIRI_QA_RIG_FORBOOTH` (nested folder layout: `<root>/ForBOOTH-0231-Holder-only@Do-not-share-or-resell.8192/` holds textures; the `.moc3`, `.model3.json`, `.physics3.json` sit beside it - verify by listing) into a core model.
    4. Try A: import `pixi-live2d-display/cubism4` model/physics/motion classes in Node and build a `Cubism4InternalModel` without a GL context (`cubism4.es.js:5317-5352` creates `CubismRenderer_WebGL` and calls `renderer.initialize(coreModel)`; check whether that needs GL). If A fails, try B: use only the framework pieces (core model wrapper, `CubismPhysics` at `cubism4.es.js:2397-2404`, eye blink, pose) and replicate `update()` (`cubism4.es.js:5416-5437`) by hand. Record which path works.
    5. Run AIRI's ordering: Natural adapter `compose()` at the `updateFocus` point (`natural-motion-adapter.ts:174-180`), SDK breath disabled as `Model.vue` does, then physics, pose, `model.update()`; sample with `NaturalTraceRecorder` on a fixed `dt = 1/60` for 600 frames with seed 1.
    6. Parity: run the same fixed-dt loop in headless Chromium (a spike-only Vitest browser config under `spikes/t2/`, real core loaded like `apps/stage-web/src/test/setup-live2d.browser.ts:1-5`, rig bytes delivered through Vitest browser `commands` from the Node side) and diff every post-physics parameter per frame.
    7. Speed: time 600 simulated seconds of Natural + adapter + physics at 60 Hz in Node.
  - Verdict GO only if all hold: (a) Node run needs no GPU and at most a documented minimal global shim; (b) max absolute per-parameter difference vs Chromium <= 1e-5 over 600 frames; (c) >= 10x real time (600 s simulated in <= 60 s wall). Otherwise NO-GO with the failing criterion named.
  Must NOT do: edit rig files; commit rig bytes, the core, or traces; ship spike code outside `spikes/t2/`.
  Closes: GAP-5 (decision)
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 14
  References: `node_modules/.pnpm/pixi-live2d-display@0.4.0_*/node_modules/pixi-live2d-display/dist/cubism4.es.js:2397-2404,4291-4376,5317-5470`; `apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js` (lines 1-9); `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:118-184`; `natural-motion-adapter.ts:18-21,174-180,298-308`; `natural-motion/rig-profile.ts` (`readLive2DRigProfile`, physics ownership); `Model.vue:542-641` (plugin order, SDK breath disabling); `natural-motion/trace.ts:86-150`.
  Acceptance criteria: `packages/qa-tools/docs/t2-spike.md` exists with each step's outcome, the EULA quote and Luke's recorded decision (allowed for local, non-distributed QA), measured parity and speed numbers, and the verdict; `.omo/evidence/qa-tooling/task-7-verdict.json` = `{ verdict: 'GO' | 'NO-GO', criteria: { noGpu, parityMaxAbs, speedMultiple }, path: 'A' | 'B' | null }` and agrees with the report.
  QA scenarios: happy - the spike's Node run log and parity diff; Evidence `.omo/evidence/qa-tooling/task-7-node-run.txt`, `task-7-parity.json`. Failure - rerun the parity diff with physics disabled on the Node side only; it must report a difference above 1e-5 (proves the diff can fail); Evidence `.omo/evidence/qa-tooling/task-7-parity-negative.json`.
  Commit: Y | docs(qa-tools): record T2 headless rig spike verdict
  Recommended task executor category: deep-high - a mechanism with no in-repo precedent and an uncertain SDK seam.

- [x] 8. Build the T1 scenario runner on the real conductor, hold performer and Natural controller
  What to do:
  - `packages/qa-tools/src/motion/t1/runner.ts`: `runT1(scenario, options?: { simHz = 120, sampleHz = 30, catalog?: CatalogEntry[] })` returns a `NaturalTrace` v2. Pipeline per run (fresh instances every call):
    - Settings: `defaultExpressionPerformanceSettings` merged with `scenario.settings.performance` through `parseExpressionPerformanceSettings`; `heldEmotions` from `scenario.settings.heldEmotions ?? true`.
    - `StagePerformanceConductor` (`use-stage-performance-conductor.ts:162`) with `scene` = an in-runner scene implementing `StagePerformanceScene` (`:68-75`) exactly like `Model.vue:1393-1404` (`setEmotion` pushes to a pending array; `applyHolds` -> `EmotionHoldPerformer.applyHolds`; `onSpeech` -> `holdPerformer.onSpeech`; `setMuted`), `driver: () => 'natural'`, `playMotion: () => {}`, `settings`, `catalog: () => options.catalog ?? []`, `seed: scenario.seed`, `clock: () => simTime`, and fake `timers` (a min-heap of due callbacks fired by the sim loop before each step). Create a pinia with `createPinia()` + `setActivePinia` before constructing it (the class reads stores through imports; see the pinia setup in `use-stage-performance-conductor.test.ts:203`).
    - `Live2DNaturalMotion({ seed: scenario.seed, home: scenario.home ?? 'desk' })` wrapped by `Live2DNaturalMotionAdapter` on a stub `FocusModel` (`natural-motion-adapter.ts:18-21`) whose core is a `Float32Array` parameter table built from `naturalTraceParameterIds` (`trace.ts:9-30`) with ranges from `referenceStats.ranges` plus defaults for ids it lacks (`ParamEyeLSmile`/`RSmile` 0..1, `ParamBrowLAngle`/`RAngle` -1..1, `ParamBrowRY` -1..1, `ParamCheek` 0..1); no physics outputs. Attention provider fields as `Model.vue:595-620` supplies them (`pendingEmotions`, `heldEmotion: holdPerformer.current(t)`, `voice`, `performance`, `cursor`).
    - Scenario events through `createScenarioPlayer`: `emotion` -> `conductor.emotion(name, bandNominal, source)` where `bandNominal` = the band's nominal from settings (`settings.ts:39-50`); `act` -> parse with the same parser Stage uses (`packages/stage-ui/src/composables/queues.ts:23-60`) and call `conductor.emotion`/`expression` exactly as `Stage.vue:406` and the queue handler do; `mode` -> `PerformanceState` via `natural.setPerformance` the way the adapter does; `speech` -> conductor speech events plus `natural.setVoice` levels from `speechFixture` (todo 6); `cursor` -> `setCursor`; `expression` -> conductor expression signal (requires `options.catalog`); `placebo`/`noop`/`marker` -> only marked. Every scenario event is marked into the trace with `source: 'scenario'`; the observer (todo 6) marks Natural events.
    - Sampling: step at `1/simHz`, call the adapter frame/compose the way `Model.vue` does once per step, record with `NaturalTraceRecorder` (30 Hz grid).
  - `packages/qa-tools/fixtures/forbooth-catalog.json`: the six checkpoint-12 mappings only (ids and labels, no rig content): `expression1` Angry -> angry (kind effect, minBand strong), `expression2` Crying Eyes -> sad, `expression7` Hearts 1 -> love, `脸红2` Blush -> flustered, `expression13` Sleepy -> sleepy, `expression5` Star Eyes -> happy (kind effect), in the `CatalogEntry` shape from `packages/stage-shared/src/expression-performance/catalog.ts`.
  - Tests (qa-tools `node` project): byte-identical JSON for two runs of the same scenario; the stripped scenario's trace equals the full trace sample-for-sample up to the first emotion `at`; an angry strong pulse yields a Natural `hold` event with the decider's strength and an `impulse` event within one step of the pulse; a `t3`-only check is not needed here.
  Must NOT do: re-implement decider or conductor logic; add timing assertions to tests; import from `@proj-airi/stage-ui-live2d` root barrel (use the todo-6 subpaths).
  Closes: GAP-1, GAP-3 (T1 side)
  Parallelization: Wave 2 | Blocked by: 1, 5, 6 | Blocks: 11, 12, 14
  References: `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:1-30,68-130,162-200,197-260,353-400`; `use-stage-performance-conductor.test.ts:1-60` (Node construction pattern); `packages/stage-ui/package.json` exports `./composables/*`; `packages/stage-ui-live2d/src/composables/live2d/expression/hold.ts:25-112`; `Model.vue:166,323-338,588-620,1393-1404`; `natural-motion-adapter.ts:23-59,126,298-308`; `natural-motion/liveliness-gate.test.ts` (sim pattern and unit conversions); `packages/stage-ui/src/components/scenes/Stage.vue:275,308,406,454-493`.
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/motion/t1` passes; `pnpm -F @proj-airi/qa-tools typecheck` exits 0.
  QA scenarios: happy - a script in the node project writes the trace for `buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 })` and prints the event list plus mean `ParamBrowLY` over [20.5, 23.5] s vs [19, 20] s; Evidence `.omo/evidence/qa-tooling/task-8-angry-trace.json`, `task-8-summary.txt`. Failure - the same with `settings.heldEmotions: false` shows no `hold` event; Evidence `.omo/evidence/qa-tooling/task-8-heldemotions-off.txt`.
  Commit: Y | feat(qa-tools): add T1 scenario runner on the real performance pipeline
  Recommended task executor category: deep-low - wiring real modules together; every decision is settled by the cited code.

- [x] 9. Add the emotion scorer and committed gate definitions; migrate the liveliness gate
  What to do:
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion/emotion-score.ts` (pure, no Node APIs) implements this design:
    - Units: channels normalized by half-range from `trace.ranges`; per trial `delta = stat(W) - stat(B)` with baseline `B = [-1, 0]` s relative to the pulse.
    - Channel classes and windows: face (`browMean = (ParamBrowLY + ParamBrowRY)/2`, `browAsym = side * (LY - RY)/2`, brow angle mean, eye smile mean, `ParamMouthForm`, `ParamMouthOpenY`, `ParamCheek`) mean over `[0.5, 3.5]`; eyelid (`(ParamEyeLOpen + ParamEyeROpen)/2`) 80th percentile over `[0.5, 3.5]`, reported as `log(W/B)`; posture (`ParamAngleX/Y/Z`, `ParamBodyAngleX/Y/Z`) mean over `[2.0, 4.0]`; modulation (blink rate, breath period, detrended head RMS, camera-fixation fraction) as log-ratio vs the paired null over `[10, 60]` in long-hold scenarios, clear and strong only.
    - Blink detection for modulation: lid < 0.5 x running 1 s 80th percentile, recovering within 400 ms, refractory 150 ms; closures longer than 400 ms are not blinks. Breath period: upward crossings of 0.45 with +-0.02 hysteresis.
    - Paired statistics: `d_i = delta_i - delta0_i` (same seed, emotions stripped). Significance: one-sided sign-flip permutation test on `s * d_i` with 1e5 permutations; Holm correction across all checks of a gate run at family alpha 0.01. Sign: `mean(s * d) > 0`. Size (held-only variant): `E / expected` within `[0.5, 1.5]` (clamped channels check only `>= 0.5`).
    - Visibility (face and eyelid, full variant): hit when `s * delta_i > q90` of the unpaired placebo null `s * delta0`; minimum hit rate / minimum `d = E / sigma0`: slight 0.3 / 0.5, clear 0.6 / 1.0, strong 0.75 / 1.5. Posture has no per-trial visibility rule (bias only).
    - Lifetimes: export `naturalEmotionLifetime(settings, band)` next to `impulses.ts:213` = the longest of the head impulse lifetime (`pulseLifetime(15) * tau`, `impulses.ts:46,63`), the face-hint lifetime (`faceHold + 15 * faceReleaseTau`, `impulses.ts:213`) and the gesture clip lifetimes (`gestures.ts:28,91,104`). The scorer rejects (verdict `n/a`, reason named) any trial whose window overlaps another emotion event within that lifetime.
    - Release (held-only variant, so impulse and gesture residue cannot contaminate it): mean paired trajectory over `[4, 10]` fit to `A * exp(-(t-4)/tau) + c`; pass when `tau` in `[0.5, 2] x` nominal (`held.releaseTau`, `settings.ts:154-162`) with its bootstrap 95% CI (1000 resamples) excluding `3 x` nominal, `|c| <= 0.1 * A`, and the late-window mean over `[7, 9]` has a 95% CI within `+-max(0.15 * E, 0.25 * sigma0)`. Breath/blink release: ratio within `1 +- 0.05` over `[10, 30]` s after release.
    - Sides: sided checks use the `hold` event's `side` (todo 6); without side metadata (T2/T3 single traces) test `|delta|` against the folded null and label the result `unsigned`.
    - All permutation/bootstrap randomness comes from `createRandomStream` (`natural-motion/random.ts`) seeded from a hash of the gate id; results are byte-identical across runs and independent of input event order.
    - Expected values: `recipe value x band nominal x adapter gain x onset factor` (face 0.989 on `[0.5, 3.5]`, posture 0.990 on `[2, 4]` (postureTau 0.6; corrected 2026-10-20 from an arithmetic slip of 0.94, see task-9-gate-review.md)); derive adapter gains from `natural-motion-adapter.ts` `composeFace`/`composePosture` and document each in a comment.
  - `natural-motion/gates.ts` exports versioned gate objects: `naturalIdleLivelinessGate` (`id: 'natural-idle-liveliness'`, `version: 1`, `metrics` = the exact `gatedMetrics` list now in `liveliness-gate.test.ts`, seeds `[1, 2, 3]`, warm-up 180 s, scored 1800 s, bands = `referenceStats.bands` + `generatedBlinkBands` + `generatedMouthOpenBand`), `naturalTalkingGate` (`speedRatio` [1.15, 1.7], `onsetEnrichment` > 1.2), and `emotionGate` (`id: 'natural-emotion'`, `version: 1`, `scenario` timings above, seeds `{ start: 1, count: 100 }` full, 30 held-only, 40 long-hold, `placeboPerNullRun: 10`, `family: { alpha: 0.01, method: 'holm', permutations: 1e5, bootstrap: 1000 }`, levels `['t1', 't2']`), plus `buildEmotionChecks(table = naturalEmotions)` that generates every `ChannelCheck` from the recipe table so recipe edits update expectations automatically. Types: `EmotionGate`, `ChannelCheck`, `ScorerInput`, `CheckResult` as in the design (fields `key, n, E, ci, d, hits, p, pHolm, sizeRatio, tau?, residual?, verdict: 'pass' | 'fail' | 'n/a', failed: string[]`).
  - `liveliness-gate.test.ts` reads `gatedMetrics`, seeds and timings from `naturalIdleLivelinessGate` (add an assertion that the list equals the previous literal list).
  - `packages/stage-ui-live2d/scripts/score-natural-captures.ts`: replace `--prereg <file>` and the mtime check (`:12-36`) with `--gate natural-idle-liveliness`; keep the >= 3 equal-duration traces rule and median aggregation; output adds `gate: { id, version, fileSha }` where `fileSha` = `git log -1 --format=%H -- packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts`.
  - Update `packages/stage-ui-live2d/README.md` sections "Liveliness score and reference stats" and "Natural QA" for the new flag and gate ids (docs ship with code), and sweep the repo outside `.omo/` for `--prereg` (`git grep -n -- --prereg`) so no doc or skill teaches the retired flag.
  Must NOT do: change any reference band, metric, or `scoreLiveliness` behavior; add Node APIs to `emotion-score.ts`/`gates.ts`.
  Closes: GAP-2, GAP-4, GAP-14
  Parallelization: Wave 2 | Blocked by: 6 | Blocks: 12, 13, 14
  References: `natural-motion/liveliness.ts` (whole file: resample, quantile, banding, `aggregateLivelinessReports`); `natural-motion/reference-stats.ts`; `natural-motion/liveliness-gate.test.ts:18-50`; `natural-motion/emotions.ts` (recipes); `natural-motion/hold.ts`; `natural-motion/random.ts:5,20`; `packages/stage-shared/src/expression-performance/settings.ts:39-80,150-220`; `natural-motion-adapter.ts:96-112` (eyelid floor 0.2, pass-through <= 0.15) and `composeFace`/`composePosture`; `blink.ts:32,85,105`; `breath.ts:30,69`; checkpoint-12 numbers in `.omo/ulw-execute/ledger.jsonl` (event `checkpoint-accepted-partial`).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion` passes, including new `emotion-score.test.ts` (synthetic traces: a known effect passes size/sign/significance; zero effect fails significance; sign flip fails sign; Holm ordering; permutation and bootstrap determinism; exponential fit recovers tau within 5% on a noise-free curve; unsigned fallback) and `gates.test.ts` (generated checks cover every nonzero recipe entry for all 11 non-neutral emotions); the liveliness gate still passes; `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-ui-live2d exec tsx scripts/score-natural-captures.ts --gate natural-idle-liveliness <3 traces from NATURAL_TRACE_OUT runs of seeds 1-3>` exits 0 and prints the gate block; Evidence `.omo/evidence/qa-tooling/task-9-captures.json`. Failure - the same command with `--prereg x.json` exits 2 with a message pointing to `--gate`; Evidence `.omo/evidence/qa-tooling/task-9-prereg-removed.txt`.
  Commit: Y | feat(stage-ui-live2d): add idle-noise-relative emotion scorer and committed gates
  Recommended task executor category: ultrabrain - one cohesive statistical design that must be implemented exactly.

- [x] 10. Add the dev-only motion QA bridge, reached over remote debug
  What to do:
  - Gate 1 (main): when building the main window URL query (`apps/stage-tamagotchi/src/main/windows/main/index.ts:~199`), append `motion-qa-bridge=true` only when `is.dev && /^true$/i.test(env.APP_MOTION_QA_BRIDGE ?? '') && /^true$/i.test(env.APP_REMOTE_DEBUG ?? '')` (`is` from `@electron-toolkit/utils`, as `main/index.ts:151` uses it).
  - Gate 2 (window context): extend `resolveRendererWindowContext()` (`apps/stage-tamagotchi/src/renderer/window-context.ts:32-37`) with a boolean `motionQaBridge` read from that query parameter.
  - Gate 3 (renderer build): in `apps/stage-tamagotchi/src/renderer/main.ts`, synchronously BEFORE `mount()` (so `Stage.vue` setup already sees it), run `if (import.meta.env.DEV && resolveRendererWindowContext().motionQaBridge) { globalThis.__airiMotionQaEnabled = true; void import('./bridges/motion-qa').then(m => m.installMotionQaDispatcher()) }`. Only the dispatcher module is lazy; `isMotionQaBridgeEnabled()` is false in every other case. No preload change. `apps/stage-tamagotchi/src/renderer/bridges/motion-qa.ts` installs `globalThis.__airiMotionQa = { dispatch(command: string): Promise<string> }`, which parses JSON, validates against the todo-5 command schemas, invokes the matching Eventa contract on `createMotionQaContext()`, and returns JSON `{ ok: true, result } | { ok: false, error }` (errors via `errorMessageFrom(error) ?? 'unknown error'`).
  - Handlers: `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts` exports `useMotionQaBridge({ enqueueEmotion, parseAct, ... })` that registers `defineInvokeHandler`s on `createMotionQaContext()` and disposes them on scope dispose. `Stage.vue` must not import it statically: in setup, inside `if (import.meta.env.DEV && isMotionQaBridgeEnabled())`, capture `const scope = getCurrentScope()` and run `void import('../../composables/performance/use-motion-qa-bridge').then(m => scope?.run(() => m.useMotionQaBridge({ ... })))`, passing the existing `emotionsQueue` (`Stage.vue:308`). The stage-shared bridge contracts are imported only by that lazy module and by the renderer dispatcher module, so production tree-shaking removes them. Behavior:
    - `state`: reads `useSettingsLive2d` (`live2dMotionDriver`, `live2dNaturalCursorAttention`, `live2dExpressionEnabled` at `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:11,13,104,129`), `useExpressionPerformanceSettings` (`heldEmotions`, `stage-shared settings.ts:202`), the display-model store for model id/loaded, the diagnostics store for capture state, and the current hold (expose a read accessor from `Model.vue` through the diagnostics store, for example `holdSnapshot`).
    - `configure`: writes those same settings.
    - `importModelFromInput`: reads `document.getElementById(inputId).files[0]` and imports it through the same store calls the settings model picker uses (find them from `.omo/evidence/emotion-expression-performance/task-26-scripts/import.ts:7-17`: `display-models` store `addDisplayModel('live2d-zip', file)` then stage model update), resolving after the model reports loaded.
    - `startCapture`/`awaitCapture`: through `useNaturalMotionDiagnostics().requestCapture` and its result, with `extraParameterIds` passed to the recorder (todo 6).
    - `runScenario`: validates `levels` includes `t3`, schedules each event at `performance.now()/1000 + at` with one `requestAnimationFrame`-driven dispatcher (no `setTimeout` chains), and dispatches through the real paths only: `emotion` -> `emotionsQueue.enqueue({ emotion, source })` exactly like the lab pulse (`Stage.vue:487-493`); `act` -> the streaming parser and `Stage.vue:406` enqueue; `mode` -> `useNaturalPerformanceOverride` (`overrideEnabled`, `overrideMode`, `overrideEnergy`, `packages/stage-ui/src/stores/natural-performance-override.ts:30-63`); `expression` -> the same toggle the expression preview UI uses; `placebo`/`noop`/`marker` -> marks only. Every dispatched event is marked via `markCaptureEvent` (todo 6). Unsupported kinds are returned in `rejected`.
  - Production check script `packages/qa-tools/bin/check-prod-bundle.ts`: greps `apps/stage-tamagotchi/out/renderer/**/*.js` for `__airiMotionQa`, `motion-qa:` contract ids and `installMotionQaDispatcher`; exits 1 if any is found.
  Must NOT do: open a port or server; register handlers or install the dispatcher when any gate is false; dispatch through controller calls instead of the real queue/store paths; add the bridge to the web or pocket apps.
  Closes: GAP-6 (control surface), GAP-7, GAP-13 (bridge part)
  Parallelization: Wave 2 | Blocked by: 5, 6 | Blocks: 11
  References: `apps/stage-tamagotchi/src/main/app/debugger.ts:9-16`; `apps/stage-tamagotchi/src/main/index.ts:151,~393`; `apps/stage-tamagotchi/src/preload/shared.ts:1-45`; `apps/stage-tamagotchi/src/renderer/main.ts:51-80` and `src/renderer/bridges/` (precedent `opencode-go`); `apps/stage-tamagotchi/src/shared/eventa/` (contract conventions); `packages/stage-ui/src/components/scenes/Stage.vue:275,308,406,454-493`; `packages/stage-ui/src/composables/queues.ts:23-60`; `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts:103-298` (NOTICE about raw messages on the BroadcastChannel - the bridge uses its own event-target context, not that channel); `.agents/skills/eventa/SKILL.md`; `.agents/skills/use-agent-browser-for-airi/SKILL.md:22-40` (model import flow).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-motion-qa-bridge.test.ts` passes with real pinia stores and a recording fake `emotionsQueue` (configure writes settings; `runScenario` with a fake rAF clock dispatches emotion/act/mode in order and rejects `speech`; schema errors return `ok: false`); `pnpm -F @proj-airi/stage-shared typecheck`, `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm -F @proj-airi/stage-tamagotchi typecheck` exit 0; after the app's production renderer build (`pnpm -F @proj-airi/stage-tamagotchi build`, which runs `electron-vite build`), `pnpm -F @proj-airi/qa-tools exec tsx bin/check-prod-bundle.ts` exits 0, and the same checker run against a fixture file containing `motion-qa:` exits 1 (proves it can fail). The todo-6 golden hashes still match.
  QA scenarios: happy - dev app with all three gates on: CDP `Runtime.evaluate` of `__airiMotionQa.dispatch('{"name":"state"}')` returns `ok: true`; Evidence `.omo/evidence/qa-tooling/task-10-state.json`. Failure - dev app with `APP_MOTION_QA_BRIDGE` unset: `typeof globalThis.__airiMotionQa` is `undefined`; Evidence `.omo/evidence/qa-tooling/task-10-gate-off.txt`. Production - `check-prod-bundle` output; Evidence `.omo/evidence/qa-tooling/task-10-prod-bundle.txt`.
  Commit: Y | feat(stage-tamagotchi): add dev-only motion QA bridge over remote debug
  Recommended task executor category: deep-high - a cross-package contract with a production-safety invariant.

- [x] 11. Build the T3 rendered harness and `qa:motion t3` CLI
  What to do:
  - Move `apps/stage-tamagotchi/scripts/lib/remote-debug.ts` and `remote-debug.test.ts` to `packages/scenarios-stage-tamagotchi-electron/src/runtime/remote-debug.ts` (+ test); add the subpath export `./runtime/remote-debug` to that package; update `apps/stage-tamagotchi/scripts/desktop-overlay-live-window-smoke.ts` and `linux-window-render-smoke.ts` imports; delete the old files.
  - `packages/qa-tools/src/t3/`: `launch.ts` (`spawnPnpm(['-F', '@proj-airi/stage-tamagotchi', 'dev'])` with `APP_USER_DATA_PATH=<runDir>/profile`, `APP_REMOTE_DEBUG=true`, `APP_REMOTE_DEBUG_PORT=<findAvailablePort()>`, `APP_REMOTE_DEBUG_NO_OPEN=true`, `APP_MOTION_QA_BRIDGE=true`; wait with `waitForRemoteDebug`; pick the main stage target with `findDebugTarget` on URL containing `synced-leader=true` and hash route `#/`; record root PID in `run.json`), `bridge-client.ts` (`call(name, payload)` via `CdpClient.evaluate('globalThis.__airiMotionQa.dispatch(' + JSON + ')')` with `awaitPromise`; typed by the todo-5 schemas; waits for `__airiMotionQa` to exist by polling `state` with a bounded timeout and backoff - no fixed sleeps), `onboarding.ts` (localStorage `onboarding/completed=true`, `onboarding/skipped=false`, reload, per `.agents/skills/use-agent-browser-for-airi/SKILL.md:33`), `import-rig.ts` (zip the rig folder from `AIRI_QA_RIG_FORBOOTH` with `jszip` into `<runDir>/rig.zip`, create a hidden `<input type=file id=qa-rig>` via CDP, `DOM.setFileInputFiles`, then bridge `importModelFromInput`), `cursor.ts` (win32: park the OS cursor with the PowerShell `SetCursorPos` approach from `.omo/evidence/emotion-expression-performance/task-26-scripts/cursor.ps1`; other OS: no-op with a warning) - and always `configure({ cursorAttention: false })`, `screenshot.ts` (`Page.captureScreenshot` of the stage target at `scenario.screenshotsAt` offsets, using capture events as the time origin), `teardown.ts` (first `Browser.close` over CDP, then win32 `taskkill /PID <root> /T /F`, posix process-group kill; then list processes whose command line contains the run's `APP_USER_DATA_PATH` and fail if any remain; delete the profile dir; runs in `finally` and on SIGINT).
  - `packages/qa-tools/bin/motion.ts` subcommand `t3 --rig forbooth --scenario <file | builtin:<name>> [--keep-open]` (package script `motion`, root script `qa:motion`): `createRun` -> launch -> onboarding -> import -> `configure({ driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: scenario.settings?.heldEmotions ?? true })` -> `startCapture(min(600, scenario.durationSeconds + 1))` (the CLI rejects scenarios longer than 599 s, since the store caps captures at 600 s, `natural-motion-diagnostics.ts:50`) -> `runScenario` -> screenshots -> `awaitCapture` -> write `trace.json` and screenshots as artifacts -> teardown -> exit 0 (exit 2 when `AIRI_QA_RIG_FORBOOTH` is unset or invalid, before launching).
  - Built-in scenario `builtin:t3-smoke` in `packages/qa-tools/fixtures/scenarios/t3-smoke.json`: clear pulses of happy, sad, angry, surprised, think, love, flustered, sleepy 12 s apart (longer than `naturalEmotionLifetime`, todo 9); one ACT marker `<|ACT {"emotion":"angry"}|>` (verify the real token shape against `queues.ts:23-60`); one expression toggle of `expression1` on then off; screenshots 1 s and 3 s after each pulse.
  Must NOT do: click DOM controls for anything the bridge covers; use fixed sleeps; reuse a real profile; leave processes running.
  Closes: GAP-6
  Parallelization: Wave 3 | Blocked by: 1, 4, 8, 10 | Blocks: 15, 16
  References: `apps/stage-tamagotchi/scripts/lib/remote-debug.ts:9-226` (+ test); `apps/stage-tamagotchi/scripts/desktop-overlay-live-window-smoke.ts:14,44-46,226-228`; `linux-window-render-smoke.ts:120-122`; `packages/scenarios-stage-tamagotchi-electron/package.json` (exports) and `src/runtime/windows.ts:10-40`, `src/scenarios/display-model-from-file.ts:43-97,162-163,238-351`; `.omo/evidence/emotion-expression-performance/task-26-scripts/` (setup.sh, import.ts, capture.ts, cursor.ps1, teardown.ps1) and `task-37-scripts/resumed-teardown.ps1:14,20,42` (ownership-checked teardown and its failure); `.agents/skills/agent-browser-electron/SKILL.md`; `.agents/skills/use-agent-browser-for-airi/references/electron.md`.
  Acceptance criteria: `pnpm -F @proj-airi/scenarios-stage-tamagotchi-electron exec vitest run` and `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/t3` pass (teardown process matching with injected listings, cursor command builder, CLI argument errors); `pnpm -F @proj-airi/stage-tamagotchi typecheck`, `pnpm -F @proj-airi/qa-tools typecheck` exit 0.
  QA scenarios: happy - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke` exits 0; `trace.json` has `version: 2`, scenario events for all 8 pulses, the ACT and the toggle, and Natural `hold` events; 16 screenshots exist; no process with the run's profile path remains; Evidence `.omo/evidence/qa-tooling/task-11-t3-smoke/` (copy of the run dir minus the profile). Same scenario at T1 - run the unchanged `fixtures/scenarios/t3-smoke.json` through `runT1` with `fixtures/forbooth-catalog.json`; the T1 and T3 traces list the same scenario events (kinds, order and `at` values); Evidence `.omo/evidence/qa-tooling/task-11-same-scenario-t1.txt`. Failure - unset `AIRI_QA_RIG_FORBOOTH`: exit 2 before launching; and killing the Electron root mid-run makes the CLI exit non-zero with teardown still reporting 0 leftovers; Evidence `.omo/evidence/qa-tooling/task-11-failures.txt`.
  Commit: Y | feat(qa-tools): add T3 rendered harness driven by the motion QA bridge
  Recommended task executor category: unspecified-high - multi-file harness work with live Electron QA.

- [x] 12. Add the `qa:motion gate` CLI and run the emotion and liveliness gates at T1
  What to do:
  - `packages/qa-tools/gates/`: `emotion-<emotion>.gate.ts` (one file per non-neutral emotion; each runs its cells: full variant with `emotionGate` seeds, held-only variant, long-hold variant for clear/strong) and `null.gate.ts` (idle-with-placebo runs for the same seeds), all using `runT1` and writing per-trial deltas and paired trajectories to `$QA_RUN_DIR/partials/*.json`; `liveliness.gate.ts` writes the three idle traces for `naturalIdleLivelinessGate`.
  - `bin/motion.ts gate <emotion | liveliness> --level t1 [--emotions a,b] [--bands clear,strong] [--seeds N]`: `createRun` (records `gate: { id, version, fileSha }`) -> spawn the Vitest entry (todo 1) with `--config packages/qa-tools/vitest.config.ts --project gate`, env `QA_RUN_DIR`, `QA_GATE`, filters, and `--maxWorkers <cores - 1>` -> aggregate partials with `emotion-score.ts` (null stats per channel: sigma0, q90, n; Holm across all checks) or with `aggregateLivelinessReports` -> write `report.json` (`{ gateId, version, fileSha, inputHash, level, nullStats, results, determinismHash }`) -> print a pass/fail summary per cell -> exit 0 when all checks pass, 1 otherwise.
  - Run both gates on the integration tip and record the verdicts; failing emotion cells are findings for Luke (listed in the evidence summary), not things to fix in this plan.
  Must NOT do: retune recipes or settings; reduce seed counts in the committed gate to make a run pass.
  Closes: GAP-1, GAP-2 (end to end)
  Parallelization: Wave 3 | Blocked by: 4, 5, 8, 9 | Blocks: 13, 15, 16
  References: todos 4, 5, 8, 9 outputs; `natural-motion/liveliness.ts` (`aggregateLivelinessReports`); `packages/qa-tools/vitest.config.ts` (`gate` project, todo 1).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/motion/aggregate` passes (aggregation on fixture partials); `pnpm qa:motion gate liveliness --level t1` exits 0 (the existing gate passes today); two consecutive `pnpm qa:motion gate emotion --level t1 --emotions angry --bands strong` runs produce identical `determinismHash`; the full `pnpm qa:motion gate emotion --level t1` completes and writes a schema-valid `report.json`.
  QA scenarios: happy - full emotion gate run; Evidence `.omo/evidence/qa-tooling/task-12-emotion-t1/` (`run.json`, `report.json`, summary with wall time). Failure - run with `--emotions not-an-emotion`: exit 2 with the valid list; Evidence `.omo/evidence/qa-tooling/task-12-bad-arg.txt`.
  Commit: Y | feat(qa-tools): add motion gate CLI for T1 emotion and liveliness gates
  Recommended task executor category: deep-low - orchestration and aggregation over settled designs.

- [x] 13. Validate the scorer itself: idle false positives, mutation kills, determinism
  What to do:
  - `packages/qa-tools/gates/validation.gate.ts` plus `bin/motion.ts validate-scorer --level t1`, built on todo 12's machinery:
    1. A/A false-positive check: 20 independent seed sets of emotion-free runs scored as if they were emotion cells (unpaired against the null pool). Pass when at most 1 of the 20 gate runs has any passing significance or visibility check, the per-check placebo hit rate is `0.10 +- 0.03`, and p-values are uniform (Kolmogorov-Smirnov p > 0.01, implemented in the package without new dependencies). A zero-recipe table (all values 0, through the todo-6 `emotionTable` seam) scored paired must pass nothing.
    2. Mutation kills on T1 (each through `emotionTable`, `setEmotionStrengths`, or scenario `settings.performance`; never by editing source): x0 caught by detection >= 99%; sign flip caught by sign >= 99%; ignore side caught by sided checks >= 95%; x0.5 caught by size >= 90% at clear/strong (slight reported only); x2 caught by the size upper bound >= 90%; `releaseTau` x3 caught by release >= 95%; blink-interval multiplier forced to 1 caught by modulation >= 95%. The unmutated table passes 100% on 5 reseeded sets.
    3. Determinism: two runs give byte-identical `report.json`; shuffling event order in the inputs does not change results.
    4. Old-rule comparison: score the checkpoint-12 single-trial rules (`.omo/plans/natural-emotion-revamp.md:623-627`) on emotion-free T1 data next to the new rules and record both false-positive rates.
  - Write `validation.json` with every number, threshold and verdict.
  Must NOT do: loosen thresholds after seeing results; change gate constants (a proposed change becomes a finding for Luke).
  Closes: GAP-2 (trust in the scorer)
  Parallelization: Wave 4 | Blocked by: 12 | Blocks: 17
  References: todo 9 (`emotion-score.ts`, `gates.ts`), todo 12 (gate CLI), todo 6 (`emotionTable` seam); `.omo/plans/natural-emotion-revamp.md:614-640`.
  Acceptance criteria: `pnpm qa:motion validate-scorer --level t1` exits 0 and `validation.json` shows every threshold met; `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/motion/ks.test.ts` passes (KS implementation against known values).
  QA scenarios: happy - full validation run; Evidence `.omo/evidence/qa-tooling/task-13-validation/`. Failure - in an uncommitted local copy of the gate, set the visibility quantile to 0.5 and rerun the A/A check: it must fail the false-positive bound; revert; Evidence `.omo/evidence/qa-tooling/task-13-negative.txt`.
  Commit: Y | test(qa-tools): validate emotion scorer false positives, mutation kills and determinism
  Recommended task executor category: deep-low - running and checking a fully specified validation protocol.

- [x] 14. Implement the T2 runner on GO, or the documented fallback on NO-GO
  What to do:
  - Read `.omo/evidence/qa-tooling/task-7-verdict.json` (its `verdict` already folds in Luke's EULA decision recorded in the Decisions section of the draft).
  - GO: promote the spike path into `packages/qa-tools/src/t2/runner.ts` with the same scenario sink as T1 (conductor, scene, hold performer, Natural adapter) on the real ForBOOTH core model, physics and pose, recorded with `NaturalTraceRecorder` using the rig's real ranges and `extraParameterIds` for the six catalog switches, at fixed `dt = 1/60`. Extend `bin/motion.ts gate <emotion | liveliness> --level t2 --rig forbooth` (emotion gate seeds `{ start: 1, count: 30 }` full and 30 held-only; liveliness 3 x 600 s simulated). Run both; record verdicts and T2/T1 effect ratios per face channel for clear and strong cells.
  - NO-GO: write `packages/qa-tools/docs/t2-decision.md` (verdict, failing criterion or the legal decision, fallback: statistics stay on T1, rendered checks stay on T3 including `gate liveliness --level t3`) and make `--level t2` exit 2 printing that decision. Delete `spikes/t2/` code not referenced by the docs.
  Must NOT do: claim T2 parity beyond what todo 7 measured; commit rig content.
  Closes: GAP-5
  Parallelization: Wave 3 | Blocked by: 7, 8, 9 | Blocks: 17
  References: todo 7 report and verdict; todo 8 runner; `cubism4.es.js:5416-5437`; `natural-motion/rig-profile.ts`.
  Acceptance criteria: GO - `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/t2` passes (determinism of a 10 s scenario; the test uses `it.skipIf(!process.env.AIRI_QA_RIG_FORBOOTH)` with a logged reason because rigs are local-only) and `pnpm qa:motion gate liveliness --level t2 --rig forbooth` writes `report.json`; NO-GO - `pnpm qa:motion gate emotion --level t2` exits 2 with the decision text.
  QA scenarios: happy - GO: the T2 emotion gate run, Evidence `.omo/evidence/qa-tooling/task-14-t2/`; NO-GO: the decision output, Evidence `.omo/evidence/qa-tooling/task-14-no-go.txt`. Failure - GO: `AIRI_QA_RIG_FORBOOTH` pointing at an empty dir exits 2 naming the missing `.moc3`; Evidence `.omo/evidence/qa-tooling/task-14-bad-rig.txt`.
  Commit: Y | feat(qa-tools): add T2 headless rig runner (NO-GO: docs(qa-tools): record T2 fallback)
  Recommended task executor category: deep-low - follows a settled spike result.

- [x] 15. Generate the self-contained HTML review report
  What to do:
  - `packages/qa-tools/src/report/` + `bin/report.ts <runDir...>` (package script `report`, root script `qa:report`) writes `<firstRunDir>/report.html`: one file, no external URLs, inline SVG and base64 PNG only:
    - Header: run ids, levels, rig, git SHA and dirty flag, gate id/version/fileSha.
    - The limitations statement, verbatim from a constant in `src/report/limitations.ts`: "These scores show direction, size relative to the recipe, release, and whether a reaction stands out from this rig's own idle motion. They do not show whether the motion looks natural or suits streaming; that call is Luke's. The desk recordings behind the idle bands describe sitting at a desk, not performing."
    - Verdict table: one row per emotion x band, per-channel details in `<details>`, failed checks named.
    - Per cell: an SVG of the paired mean trajectory with its bootstrap band, the null q90 band and window markers.
    - T3 runs: a contact sheet of screenshots grouped by pulse with time offsets; transfer ratios when present.
    - "For your visual check": cells that pass numerically but have a size ratio > 1.3 or face channels within 5% of a range limit (possible extreme or clipped faces), plus every failing cell.
    - A known-failures section when a `qa:test` run dir is passed.
  Must NOT do: claim naturalness; load fonts, scripts or images from URLs; add video capture.
  Closes: GAP-8
  Parallelization: Wave 4 | Blocked by: 4, 11, 12 | Blocks: 16, 17
  References: todo 4 `run.json`; todo 12 `report.json`; todo 11 run dir layout; `DESIGN.md` (readable type and color).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/report` passes: fixture run dirs render; output contains the limitations constant; no `src="http`, `href="http` or `url(http`; every failing fixture cell is in the visual-check list.
  QA scenarios: happy - `pnpm qa:report <task-12 run dir> <task-11 run dir>`, then screenshot the HTML in headless Chromium at widths 1280 and 390; Evidence `.omo/evidence/qa-tooling/task-15-report.html`, `task-15-report-1280.png`, `task-15-report-390.png`. Failure - a run dir without `report.json` yields a page that names the missing inputs instead of an empty table; Evidence `.omo/evidence/qa-tooling/task-15-missing-input.html`.
  Commit: Y | feat(qa-tools): add self-contained HTML review report
  Recommended task executor category: visual-engineering - a readable static page with plots and screenshots.

- [x] 16. Add T3 transfer and liveliness gates and run them on ForBOOTH
  What to do:
  - `bin/motion.ts gate emotion --level t3 --rig forbooth`: one T3 run with a generated scenario of 10 trials each for angry strong, sad clear, love clear and sleepy strong, pulses spaced by at least `naturalEmotionLifetime` + 4 s (todo 9 helper; >= 12 s), placebo windows between, scored unpaired: visibility hits >= 6/10 against the session's placebo null (>= 50 placebo windows); transfer ratio `E_T3 / E_T1` within `[0.7, 1.3]` per face channel (T1 values from todo 12's report at the same tip); unsigned unless the hold side is in trace events. Release checked only for gross regressions (`tau > 3 x` nominal). Posture pooled and reported, not gated.
  - `bin/motion.ts gate liveliness --level t3 --rig forbooth`: three idle captures through the bridge (scenario duration 599 s, capture 600 s) with cursor attention off and the cursor parked, aggregated with `naturalIdleLivelinessGate` (median; any hard failure fails).
  - Run both on the integration tip and produce `report.html` for each (todo 15). Failing results are findings for Luke, recorded verbatim, never retuned.
  Must NOT do: run during any heavyweight check; retune; run on Bear (it inherits ForBOOTH under Luke's rule).
  Closes: GAP-6, GAP-3 (T3 side)
  Parallelization: Wave 4 | Blocked by: 11, 12, 15 | Blocks: 17
  References: todos 9, 11, 12, 15; `.omo/evidence/emotion-expression-performance/task-26-diag-notes.md` (cursor-attention confound).
  Acceptance criteria: both commands complete with exit 0 or 1 (a verdict, not a crash) and write `report.json` and `report.html`; each `trace.json` contains scenario and Natural events; teardown reports 0 leftover processes; `git status --porcelain` shows no new tracked or untracked files outside `.temp/` and `.omo/evidence/`.
  QA scenarios: happy - both runs; Evidence `.omo/evidence/qa-tooling/task-16-t3-emotion/`, `task-16-t3-liveliness/`. Failure - with another Electron instance from the same worktree running, the gate refuses before launching (reusing doctor's `stray-electron` probe); Evidence `.omo/evidence/qa-tooling/task-16-conflict.txt`.
  Commit: Y | feat(qa-tools): add T3 transfer and liveliness gates
  Recommended task executor category: unspecified-high - long live Electron runs with judgment-free scoring.

- [x] 17. Document the QA levels; add the motion-qa skill and AGENTS.md routing; run root checks
  What to do:
  - `packages/qa-tools/README.md`: complete structured README (Purpose, Usage with every `qa:*` command, When to use, When not to use) plus sections Levels (T0-T4, what each proves and cannot prove), Scenarios, Gates (ids, versions; changing a gate = edit `gates.ts` and bump `version` in a commit before running it), Evidence, Known failures, Bridge gates, T2 status (from todo 14).
  - `packages/stage-ui-live2d/README.md` "Natural QA": points to qa-tools levels and gate ids (verify todo 9 removed the preregistration steps).
  - ADR `docs/ai/adr/2026-10-20-motion-qa-levels.md` in the format of `docs/ai/adr/2026-10-19-natural-emotion-revamp.md`: context (checkpoint-12 noise numbers), decisions (levels, idle-noise-relative scoring, committed gates, bridge over remote debug with three gates and why Eventa still helps: one typed dispatcher, not isolation; T3 is Electron-only; Kirie out of scope), consequences, the EULA decision.
  - Agent configuration, in its own commit: `.agents/skills/motion-qa/SKILL.md` (front matter `name: motion-qa` and a `description` that triggers on motion, emotion, or idle QA; body: run `pnpm qa:doctor` first; which level proves what; commands; the required limitations wording; env vars; evidence convention and archiving before worktree removal; known-failures workflow; never retune to pass a gate); root `AGENTS.md`: a TASK ROUTING row "Motion QA, emotion/idle gates, rendered motion runs | [motion-qa](.agents/skills/motion-qa/SKILL.md)" and COMMANDS lines for `pnpm qa:doctor`, `pnpm qa:test`, `pnpm qa:motion`, `pnpm qa:report`.
  - Run root `pnpm typecheck`, then `pnpm lint`, serially; then `pnpm qa:test --all`.
  Must NOT do: mix agent configuration with runtime or package docs in one commit; write tests that pin prose; edit non-English locales.
  Closes: GAP-12; final checks for all
  Parallelization: Wave 5 | Blocked by: 2, 3, 13, 14, 16 | Blocks: F1-F4
  References: root `AGENTS.md` (COMMANDS, TASK ROUTING, "Keep agent configuration changes in a separate commit/PR"); `.github/copilot-instructions.md`; `docs/ai/adr/2026-10-19-natural-emotion-revamp.md`; `.agents/skills/README.md`; `.agents/skills/use-vishot/SKILL.md` (skill format).
  Acceptance criteria: `pnpm typecheck` exits 0; `pnpm lint` exits 0 with warnings not above the base count in `task-0-baseline.txt`; `pnpm qa:test --all` reports 0 new failures; every backticked repo path in the ADR and skill exists (scripted: extract backticked paths, `test -e` each).
  QA scenarios: happy - the three root commands; Evidence `.omo/evidence/qa-tooling/task-17-root-checks.txt`. Failure - the path checker on a copy of the ADR with one bogus path reports it; Evidence `.omo/evidence/qa-tooling/task-17-path-check-negative.txt`.
  Commit: Y (two commits) | docs(qa-tools): document motion QA levels, gates and evidence; then chore(agents): add motion-qa skill and AGENTS.md routing
  Recommended task executor category: writing - documentation and agent guidance plus running root checks.

- [x] 18. Follow-up: confirm the Natural frame-cost ratio on a quiet machine
  What to do: with no other QA lanes, test suites or builds running, run `packages/stage-ui-live2d/scripts/bench-natural.ts` interleaved base (`0154abdde` source snapshot) vs integration tip, at least 10 rounds per arm, and record per-round medians, the median-of-medians ratio and CPU-time ratio in `.omo/evidence/qa-tooling/task-18-bench-quiet.txt`.
  Must NOT do: edit product code; run while any other heavyweight command runs.
  Closes: todo 6 acceptance "benchmark ratio <= 1.05" (unconfirmed under load: executor 1.044, verifier wall 1.03-1.086, CPU 0.94-1.04).
  Parallelization: before F1-F4 | Blocked by: 6 | Blocks: F2
  References: todo 6; `.omo/evidence/qa-tooling/task-6-gate-review.md`.
  Acceptance criteria: quiet-run median-of-medians ratio <= 1.05; if > 1.05, todo 6 reopens with the numbers.
  QA scenarios: happy - the interleaved run; Evidence `.omo/evidence/qa-tooling/task-18-bench-quiet.txt`. Failure - n/a (measurement only).
  Commit: N
  Recommended task executor category: unspecified-low - one measurement run.

- [x] 19. Follow-up: scorer treats non-finite window samples as missing measurements
  What to do: in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/emotion-score.ts`, a trial whose window contains a non-finite sample (NaN/Infinity) must yield a missing measurement with a named reason for that channel, excluded from the permutation test and from the Holm family, instead of producing a NaN effect that reports p = 1e-5. Add a test with one NaN sample: the check is n/a with the reason, no significance pass, Holm family size unchanged by the NaN channel.
  Must NOT do: change any other scoring behaviour; change gate constants; touch runtime motion code.
  Closes: todo 9 gate review finding (NaN samples make significance pass by mistake; misleading reasons; loosens Holm).
  Parallelization: before 16 | Blocked by: 9 | Blocks: 16
  References: `.omo/evidence/qa-tooling/task-9-gate-review.md`, `task-9-gate-review-adversarial.json`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/emotion-score.test.ts` passes including the new NaN test; golden hash unchanged; typecheck 0.
  QA scenarios: happy - the NaN fixture scored through the public API shows n/a with reason; Evidence `.omo/evidence/qa-tooling/task-19-nan.txt`. Failure - the same fixture on the pre-fix scorer shows the false significance pass (captured before the fix).
  Commit: Y | fix(stage-ui-live2d): treat non-finite window samples as missing in the emotion scorer
  Recommended task executor category: unspecified-low - one guarded code path plus a test.

- [x] 20. Follow-up (Luke-approved 2026-10-20): make the stage-ui browser tests' stylesheet deterministic
  What to do: fix the CSS-delivery race diagnosed in `.omo/evidence/qa-tooling/env-drift-diagnosis.md`: the first `virtual:uno.css` served to the stage-ui browser Vitest project lacks the `packages/ui/src` classes (`.sr-only` etc.), so `bottom-drawer.browser.test.ts` 'hides the heading' and sessions-drawer 'active-session deletion is pending' measure an unstyled page. Make the stylesheet complete before tests measure, preferring a test-infrastructure fix (stage-ui vitest browser config / UnoCSS content pipeline / setup file) over per-test waits; no product component change.
  Must NOT do: change component behaviour or styles; skip, delete or loosen the failing assertions; add dependencies; touch the known-failures registry.
  Closes: outside-scope finding 'bottom-drawer-env-drift' and 'sessions-drawer-pending-delete' (blocks todo 17's `qa:test --all` 0-new check).
  Parallelization: before 17 | Blocked by: none | Blocks: 17
  References: `env-drift-diagnosis.md`; `task-3-unregistered-flakes.txt`; `packages/stage-ui/vitest.config.ts`; `uno.config.ts`.
  Acceptance criteria: both tests pass 5/5 runs each in the stage-ui browser project (at least one run with `--maxWorkers=1`); the full stage-ui browser project shows no new failures versus the task-0 baseline union (registered flaky ids may pass or fail); `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  QA scenarios: happy - repeated runs of both tests plus the full browser project; Evidence `.omo/evidence/qa-tooling/task-20-css-race.txt`. Failure - with the fix reverted locally, bottom-drawer fails again (proves the fix is causal); Evidence `.omo/evidence/qa-tooling/task-20-revert.txt`.
  Commit: Y | fix(stage-ui): load complete UnoCSS before browser tests measure
  Recommended task executor category: deep-low - a test-infrastructure race with a diagnosed cause.

- [x] 21. Follow-up: give heavy simulation tests explicit timeouts sized to their cost
  What to do: tests that run real simulations or git/worktree operations exceed Vitest's default 5 s under CPU load (todo 11 round 2: `packages/qa-tools/src/motion/t1/runner.test.ts:24` 60 s long-hold runT1 at 6.6-6.9 s, `src/t3/t3-smoke.test.ts:25` at 6.1 s, `src/evidence/archive.test.ts:117` real linked worktree at 5.7 s). Give each heavy test an explicit per-test timeout justified by its measured idle cost (measure on an idle run; set about 4x idle, documented in a one-line comment), or reduce the work where the assertion allows it without weakening it. Do not touch assertions, skip tests or raise global timeouts.
  Must NOT do: weaken assertions; skip or retry tests; change pre-existing tests outside qa-tools (the scenarios `gestures.test.ts` load flake is reported, not changed).
  Closes: todo 11 round 2 R2-B2 (load-sensitive suite failures).
  Parallelization: after 11 lands | Blocked by: 11 | Blocks: 17, F2
  References: `.omo/evidence/qa-tooling/task-11-gate-review.md` Round 2 R2-B2; task-11-round2-qa-load-*.json.
  Acceptance criteria: idle per-test durations recorded; qa-tools node suite passes twice while a T1 gate runs in parallel (deliberate load).
  QA scenarios: happy - the loaded double run; Evidence `.omo/evidence/qa-tooling/task-21-timeouts.txt`. Failure - n/a.
  Commit: Y | test(qa-tools): size timeouts of heavy simulation tests to their cost
  Recommended task executor category: unspecified-low - targeted test configuration.

- [x] 22. Follow-up (F4 IS-1): confirm the T1 full and smoke timing targets on a quiet machine
  What to do: with the heavy-run lock held and no other QA lanes, test suites or builds running, run the unchanged full `pnpm qa:motion gate emotion --level t1` and the angry/strong smoke subset at the integration tip. Record source SHA, commands, exits, seed budgets, worker count, CPU load and wall time in `.omo/evidence/qa-tooling/task-22-timing.txt`.
  Must NOT do: change trials, permutations, bootstrap counts, gate constants or motion defaults; assert timing in a test.
  Closes: F4 IS-1 partial (todo 12 full gate 415.6 s vs 300 s target, smoke 56.4-78 s vs 60 s, both measured under load).
  Acceptance criteria: complete verdicts; full <= 300 s and smoke <= 60 s recorded, or the measured numbers reported to Luke for a target decision (timing is recorded, not asserted, per Success criteria).
  Commit: N
  Recommended task executor category: unspecified-low - one measured run.

- [x] 23. Follow-up (F4 IS-2): resolve the accepted scorer-validation design findings
  What to do: needs Luke's decision first (decision todo13-close-as-findings). Present the x0 detection (92.9%), ignore-side (83.3%), x0.5 size (64.4%) and unmutated-set (84-88%) findings with their causes; on approval, move gate-design changes to a separate follow-up plan.
  Must NOT do: loosen thresholds or versioned gate constants without an explicit decision; represent thresholdsMet=false as true.
  Acceptance criteria: each failed threshold maps to an unchanged requirement or an approved replacement, or the limitation is explicitly accepted by Luke.
  Recommended task executor category: ultrabrain - statistical contract reconciliation.

- [x] 24. Follow-up (F4 IS-3, IS-6): rendered T3 gates and shared-scorer transfer proof
  What to do: reopen todo 16 once todo 15 is reopened (needs Luke's approval). Deliver todo 16 as written, including explicit evidence that the shared scorer consumes the T3 trace.
  Acceptance criteria: todo 16's acceptance criteria.
  Recommended task executor category: unspecified-high.

- [x] 25. Follow-up (F4 IS-8): integrate the review report with consistent eyelid plot units
  What to do: reopen todo 15 only after Luke approves another attempt. Exclude or separately label the eyelid late-window mean/CI overlays (preserved lane qa-tooling-t15, trajectory-svg.ts:105-108), rebase onto the integration tip, re-verify, land.
  Acceptance criteria: todo 15's acceptance criteria, with every compared plot value in consistent labeled units.
  Recommended task executor category: visual-engineering.

- [x] 26. Follow-up (F4 IS-12): motion-QA docs, skill, routing and root receipts
  What to do: reopen todo 17 after rows 24-25. Additionally document the accepted scorer limitations from row 23.
  Acceptance criteria: todo 17's acceptance criteria.
  Recommended task executor category: writing.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [~] F1. Plan compliance audit
  Read this plan and `git log <base>..<tip>` on `luke/feat/qa-tooling`. Every todo's Must / Must NOT items and acceptance commands map to receipts in `.omo/evidence/qa-tooling/`, and nothing outside scope changed. Check in particular: no new third-party dependency (diff of every `package.json` and `pnpm-lock.yaml` importers), no non-English locale or Kirie edit, no rig/core/trace/screenshot files tracked (`git ls-files | grep -Ei '\.(moc3|png|zip)$|live2dcubismcore'` against base), stream indices unchanged, golden idle hash matches, agent configuration in its own commit. Verdict APPROVE/REJECT with file:line evidence.
  Recommended task executor category: unspecified-high
- [x] F2. Code quality review
  Fresh worktree at the tip. Rerun serially: the five package suites, `pnpm qa:test --all` (0 new failures), each touched package's `typecheck`, root `pnpm typecheck`, `pnpm lint`. Build the production renderer and run `check-prod-bundle` (must exit 0) plus its negative fixture (must exit 1). Review the diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md` and `.agents/skills/enforce-rules-for-vitest/SKILL.md`: no `any`, no fixed sleeps in tests, seeded randomness, no private-field reads, every workaround carries the `NOTICE:` format. Verdict with file:line findings.
  Recommended task executor category: unspecified-high
- [x] F3. Real manual QA
  A different fresh temp profile and new runs, starting only after F2's heavyweight checks finish: `pnpm qa:doctor`; `pnpm qa:motion gate emotion --level t1 --emotions angry,sad,love,sleepy`; `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke`; `pnpm qa:report` over both; screenshot the report at 1280 and 390 widths. Confirm with the bridge off (`APP_MOTION_QA_BRIDGE` unset) that `__airiMotionQa` is undefined. List visual observations for Luke from the report (faces that pass but look extreme, flat or clipped) without claiming naturalness. Earlier todo artifacts are not F3 evidence.
  Recommended task executor category: unspecified-high
- [x] F4. Ideal-state fidelity
  Map IS-1 to IS-14 one by one to passing evidence (not a test name alone); for each, state delivered / partial / missing. A shortfall becomes a new `- [ ] N.` todo, never a note.
  Recommended task executor category: unspecified-high

## Commit strategy
- One Conventional Commit per todo on `luke/feat/qa-tooling`, in the scopes shown in each todo; todo 17 makes two commits, and the agent-configuration commit (`.agents/skills/motion-qa/`, root `AGENTS.md`) contains nothing else.
- Docs that describe code ship in the same commit as that code (READMEs in todos 1-4, 9, 15; ADR and package README completion in todo 17).
- Each commit leaves its package suites green against the registry and its typecheck at exit 0.
- No push, no PR; `main` is updated only after Luke's explicit okay following the final wave.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1, 5, 8, 12 | task 12 full T1 emotion gate run (wall time in `run.json`; target: full gate <= 5 min on 16 cores, smoke subset <= 60 s, recorded not asserted) | `.omo/evidence/qa-tooling/task-12-emotion-t1/` |
| IS-2 | 9, 12, 13 | task 13 validation (A/A false positives, mutation kills, determinism) | `.omo/evidence/qa-tooling/task-13-validation/validation.json` |
| IS-3 | 5, 6, 8, 10, 11 | task 11: the unchanged `t3-smoke.json` runs at T3 and through `runT1`, and both traces list the same scenario events; both are read by the todo-9 scorer | `.omo/evidence/qa-tooling/task-11-t3-smoke/`, `task-11-same-scenario-t1.txt` |
| IS-4 | 9, 12 | task 9 `--gate` run and `--prereg` refusal; `report.json` carries gate id/version/fileSha | `.omo/evidence/qa-tooling/task-9-captures.json`, `task-9-prereg-removed.txt` |
| IS-5 | 7, 14 | task 7 verdict plus parity/speed numbers; task 14 GO gate run or NO-GO decision | `.omo/evidence/qa-tooling/task-7-verdict.json`, `task-14-*` |
| IS-6 | 10, 11, 16 | task 11 t3-smoke run with 0 leftover processes; task 16 gates | `.omo/evidence/qa-tooling/task-11-t3-smoke/`, `task-16-*` |
| IS-7 | 10 | task 10 gate-off check and production bundle check with its negative fixture | `.omo/evidence/qa-tooling/task-10-gate-off.txt`, `task-10-prod-bundle.txt` |
| IS-8 | 15, 16 | task 15 report screenshots at 1280/390 and the missing-input page | `.omo/evidence/qa-tooling/task-15-*` |
| IS-9 | 1, 2 | task 1 pnpm resolution and missing-version failure; task 2 doctor and warm-up | `.omo/evidence/qa-tooling/task-1-*`, `task-2-*` |
| IS-10 | 3 | task 3 `qa:test --all` and the NEW-failure negative | `.omo/evidence/qa-tooling/task-3-*` |
| IS-11 | 4 | task 4 archive and conflict refusal | `.omo/evidence/qa-tooling/task-4-*` |
| IS-12 | 17 | task 17 path check and root checks; F1 reads the skill routing | `.omo/evidence/qa-tooling/task-17-*` |
| IS-13 | 6, 10 | golden idle hash (todos 6, 8, 9, 10), observer mutation negative, frame-cost ratio <= 1.05, gate-off check | `.omo/evidence/qa-tooling/task-6-*`, `task-10-gate-off.txt` |
| IS-14 | 9 | liveliness gate still passes with metrics read from `naturalIdleLivelinessGate` (list equality asserted) and `gate liveliness --level t1` exits 0 | `.omo/evidence/qa-tooling/task-12-*`, task 9 test output |
