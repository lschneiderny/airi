# @proj-airi/qa-tools

## Purpose

Agent-executed QA tooling for AIRI. It resolves the repository's pinned pnpm without going through `.cmd` shims, and is the home for the preflight, known-failure, evidence, and motion QA tools that build on it.

## Usage

```ts
import { resolvePnpm, spawnPnpm } from './src/env/pnpm'

const { version, node, entry } = resolvePnpm({ repoRoot: process.cwd(), env: process.env })
const child = spawnPnpm(['-F', '@proj-airi/qa-tools', 'typecheck'], { cwd: process.cwd() })
```

- `resolvePnpm` finds `<PNPM_HOME>/.tools/pnpm/<version>/node_modules/pnpm/bin/pnpm.mjs` for the `packageManager` version in the root `package.json`. It falls back to `npm_execpath` only when that is a JS file of the same pnpm version, and otherwise throws an error naming the expected path. It never runs `corepack` or `pnpm self-update`.
- `resolveVitestEntry` returns the Vitest CLI file so callers spawn `node <entry>` directly.
- Tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node`.

### Doctor

Run `pnpm qa:doctor` from the repository root before a QA run. It reports, and never fixes, these checks in order: `node-version` (major.minor against `.tool-versions`), `pnpm`, `install`, `built-packages` (runtime `./dist/` exports of `packages/*` and a current `packages/i18n/dist`), `cubism-core`, `playwright` (Chromium), `rigs` (`AIRI_QA_RIG_FORBOOTH` / `AIRI_QA_RIG_BEAR`), and `stray-electron`.

- `--json` prints the rows `{ id, status, detail, fix }` as JSON.
- `--warm` also runs `packages/stage-ui/src/components/scenes/live2d-blink-ownership.browser.test.ts` once in the browser project. It reruns once only when the first run fails with `optimized dependencies changed`, and then reports `warm: ok after reload`.
- The exit code is 1 when any row is `fail`, 2 for unknown flags, and 0 otherwise. Each check is bounded by a 15 s timeout; a check that hangs becomes a `fail` row.
- `runDoctor(probes)` in `src/env/doctor.ts` takes injectable probes; `createSystemProbes(repoRoot)` supplies the real ones.

### T2 headless rig runner

`src/t2/runner.ts` runs a motion scenario on the real ForBOOTH model (moc, physics, pose) in Node at a fixed 1/60 s step, without Electron or a GPU. It uses the scenario sink that T1 uses (`src/motion/scenario-sink.ts`: conductor, scene, hold performer, Natural adapter), so only the model and the per-frame step differ. See `docs/t2-spike.md` for the feasibility evidence.

```ts
const runtime = await loadT2Runtime() // reads AIRI_QA_RIG_FORBOOTH and AIRI_QA_CUBISM_CORE
const trace = runT2(scenario, runtime, { catalog })
```

- Inputs: `AIRI_QA_RIG_FORBOOTH` is the rig folder (the `.model3.json` may sit up to two folders below it); `AIRI_QA_CUBISM_CORE` is a local `live2dcubismcore.min.js` (the core is gitignored). A missing or empty rig or a missing core throws `T2SetupError` (`exitCode` 2), naming the missing `.moc3` or core.
- Without `AIRI_QA_CUBISM_CORE`, the default is the current checkout's `apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js`, not the main checkout. Fresh worktrees need the environment variable.
- The runner uses `ExpressionComposer` and slot leases directly: the Pinia expression store reads `performance.now()`, which would make fades depend on wall time rather than the simulated clock.
- Expression bases restore before the SDK motion-manager update; composition and `adapter.frame` run on `afterMotionUpdate`, before Natural's late composition, physics and pose. Models and moc allocations are released after every scenario.
- The Cubism core prints its version line when each model is constructed. Gate logs retain those lines; they are not verdicts.
- Mesh deformation (`model.update()`) is skipped by default: it reads parameters and never writes them, and it costs about 90% of a frame. `deform: true` runs it for the parameter-identity check.
- The trace records the rig's own parameter ranges plus the parameters that the catalog's expression files drive (the six ForBOOTH switches). A trace with no moving parameter throws.
- Not reproduced from the stage: the beat-sync, idle-focus and light-squint plugins, manual motion control, expression group conflicts, and rest-set entries. Auto blink, lip sync and breath come from the Natural adapter's attention, as for an unattended stage.
- `pnpm -F @proj-airi/qa-tools t2:probe [--identity]` runs one 10 s trial and prints the trace sha256, the speed multiple, and with `--identity` the parameter difference with and without deformation. It exits 2 for a missing or empty rig or core.
- The probe remains a narrow determinism/deformation diagnostic; gate execution uses the shared CLI and scorer below.
- Rig tests skip, with a logged reason, when `AIRI_QA_RIG_FORBOOTH` or the core is absent.

## Evidence

Run directories: `createRun({ tool, label, repoRoot })` from `src/evidence/run.ts` creates `.temp/qa/<YYYYMMDD-HHmmss>-<tool>-<label>/` (gitignored) and refuses to reuse an existing directory. The handle offers `path(name)` (rejects paths that leave the run dir), `addArtifact(relPath, kind)` (records sha256) and `finish({ exitCode, summary })`, which writes `run.json`: `runId`, `tool`, `label`, `gitSha`, `dirty`, `startedAt`, `endedAt`, `command`, `env` (only `APP_*` and `AIRI_QA_*` keys), optional `gate`, `artifacts` and `result`. `tool` and `label` accept letters, digits, `.`, `_` and `-` only.

Archiving: before a worktree is removed, copy its evidence into the main checkout:

```bash
pnpm -F @proj-airi/qa-tools run evidence archive --plan <slug> --from <worktree-path>
```

- The main checkout is the first entry of `git worktree list --porcelain`. `<worktree>/.omo/evidence/<slug>/` is copied to `<main>/.omo/evidence/<slug>/` through a staging dir, then renamed into place. The source is never modified or deleted.
- If a same-named file exists with different bytes, nothing is copied and the command exits 1 (conflicts are listed). Identical files are skipped, so re-running is safe.
- `manifest.json` in the destination lists every file with `sha256` and `bytes`, sorted by path; it is regenerated on each run and is identical when nothing changed.
- Exit codes: 0 archived, 1 refused or failed, 2 usage error. Evidence is never committed (`.omo/evidence/` is gitignored).

## Known failures

`known-failures.json` lists the tests that already fail on the integration base, so a QA run fails only on new failures. `pnpm qa:test` runs the selected Vitest suites with the JSON reporter and compares the results with the registry.

```bash
pnpm qa:test --all                                   # stage-shared, stage-ui-live2d, stage-ui (node + browser), qa-tools, scenarios-stage-tamagotchi-electron, pipelines-audio
pnpm qa:test --package @proj-airi/stage-ui --project browser
pnpm qa:test --package @proj-airi/stage-shared --registry <file> --timeout 600
```

- Each suite runs as `node <vitest entry> run --config <package>/vitest.config.ts [--project <p>] --reporter=json` from the package directory. Reports and logs go to a `createRun` directory, `.temp/qa/<YYYYMMDD-HHmmss>-test-<label>/` (`vitest-<package>-<project>.json` and `.log`, `summary.json`, and `run.json` listing them with sha256).
- A registry entry matches on `package` + `project` (`node`, `browser`, or `default` for configs without projects) + `file` (relative to the package) + `name` (describe titles and the test title joined with ` > `). Every entry needs a concrete `reason`, a `since` date and a `removeWhen` condition. The schema lives in `src/known-failures/schema.ts`.
- The output lists NEW failures, KNOWN failing tests, FIXED known failures (remove them from the registry; an entry whose test no longer runs is listed as "not run"), and flaky entries that passed.
- `flaky: true` marks one test that fails only sometimes. A failure counts as known and a pass is reported without being called fixed. The marker covers only the listed test, so a new flaky-looking failure still counts as new.
- Exit 1 for any new failure or any suite error: a suite that timed out (default 1800 s per suite, after which its process tree is killed), crashed, wrote no report, reported unhandled errors, or exited non-zero without a failing test. Suite errors never match the registry. Exit 2 for bad arguments or an invalid registry.
- Never skip, delete or edit a test to clear a failure. Fix the test, or add an entry with its reason.

## Production bundle check

The Electron app has a dev-only motion QA bridge (`globalThis.__airiMotionQa`, reached over remote debug). After `pnpm -F @proj-airi/stage-tamagotchi build`, prove that no production chunk contains it:

```bash
pnpm -F @proj-airi/qa-tools exec tsx bin/check-prod-bundle.ts [directory]
```

- It scans every `.js` file under `apps/stage-tamagotchi/out/renderer` (or `[directory]`) for `__airiMotionQa`, `motion-qa:` and `installMotionQaDispatcher`, and prints each match with its file and offset.
- Exit codes: 0 no marker found, 1 any marker found, 2 when the directory is missing or holds no `.js` files, so a missing build never reads as clean.
- `fixtures/prod-bundle-leak/` holds one leaking chunk; running the checker on it must exit 1.

## Motion gates

`pnpm qa:motion gate <emotion | liveliness> --level <t1 | t2> [--rig forbooth] [--emotions a,b] [--bands clear,strong] [--seeds N] [--workers N] [--timeout-minutes N]` runs a committed gate (`stage-ui-live2d` `natural-motion/gates.ts`) and judges it.

- T2 requires `--rig forbooth` and the local rig/core inputs above. Full and held-only emotion variants each use seeds 1..30; long holds retain their committed count. Liveliness runs three 600 s simulations, including the unchanged 180 s warm-up. Reports record the effective seed and duration budgets.
- T2 reports post-physics parameter measurements, not rendered parity beyond the specific todo-7 spike measurement. Gate failures are findings, not authorization to retune motion or scoring constants.

- It creates a run directory (`gate` records `{ id, version, fileSha }`, with the version as a string), spawns Vitest on `gates/*.gate.ts` (project `gate`, one file per emotion plus `null.gate.ts` for the placebo null, or `liveliness.gate.ts`), aggregates `partials/*.json`, and writes `report.json`, `summary.txt`, `timing.json` and `vitest.log`.
- `report.json`: `{ gateId, version, fileSha, inputHash, level, limitation, pass, nullStats, results, determinismHash }` (schema: `src/motion/gate/report.ts`). `determinismHash` covers everything except timings, and is the same for any `--workers` count.
- `reportSchema: 2` adds review fields to every emotion result, read by `qa:report` and never by a verdict: `trajectory` (the paired mean of the full trials on a 0.1 s grid from -1 s to 10 s after the pulse, direction-folded like `E` and in the scorer's `E` units: half-range for face and posture, log-ratio for the eyelid; with a seeded 200-resample bootstrap band) and `levels` (per Cubism parameter: mean baseline, mean and extreme scored-window peak, and the rig's `min`/`max`, in raw units). They come from `samples` in the emotion-cell partials (`src/motion/gate/samples.ts`); reports without `reportSchema` predate them.
- `--seeds N` runs at most N seeds per variant; the report records `selection.seedsLimit`. The committed counts live in the gate, never in the CLI.
- Exit codes: 0 every check passed, 1 a check failed or the run broke (a missing partial, a Vitest failure, the timeout), 2 a usage or T2 setup error (including invalid model3 JSON or a missing rig/core). `pnpm qa:motion` passes the code through.
- Timing targets (full gate 5 min, smoke 60 s on 16 cores) are recorded in `timing.json` and `run.json` with the CPU load before the run; they are not asserted.
- Every report states that scores prove direction, size relative to the recipe, release and detectability above the rig's idle noise, not naturalness.

### T3 gates

`pnpm qa:motion gate <emotion | liveliness> --level t3 --rig forbooth [--t1-report <run dir>]` runs a committed gate in the rendered app through the T3 harness below (one launch, capture and teardown per session). It takes no `--emotions`, `--bands`, `--seeds`, `--workers` or `--timeout-minutes`.

- Preflight, before anything launches (exit 2 with the reason): `AIRI_QA_RIG_FORBOOTH` must name a rig; doctor's `stray-electron` probe must find no stage-tamagotchi Electron process of this worktree; the emotion gate needs a T1 emotion report at the same commit with a result for every face check of its cells. Without `--t1-report`, the newest `.temp/qa/*-motion-gate-emotion-t1` run at `HEAD` is used; create one with `pnpm qa:motion gate emotion --level t1 --emotions angry,sad,love,sleepy --bands clear,strong`.
- Emotion (`naturalEmotionT3Gate`, `src/motion/gate/t3-scenario.ts`): 10 pulses each of angry strong, sad clear, love clear and sleepy strong in a seeded order that never repeats a cell back to back. Pulses are spaced by `ceil(naturalEmotionLifetime + 5)` s (18 s strong, 14 s clear; at least 12 s and the lifetime plus 4 s), and each is followed by one placebo whose baseline starts after the pulse's lifetime and whose scored window ends 0.5 s before the next pulse. Lead placebos on the 6 s idle spacing bring the total to at least 50. The pulses are split over at least three sessions that fit the 599 s capture limit and share one duration.
- Scoring (`src/motion/gate/t3-score.ts`) uses the shared scorer with no stripped run: `measureEmotionTrial(trace, null, ...)`, `measurePlacebos` and `scoreEmotionGate` (significance, sign, visibility). The placebo null is session-stratified (`naturalEmotionT3Gate` v2, `placeboNull`): every record carries its session as `stratum`, each trial's visibility hit uses its own session's placebo q90, `E` is the mean trial-minus-own-session-null difference with a bootstrap that resamples within sessions, and significance is `stratifiedUnpairedPValue`, a permutation test that relabels trials and placebos only within each session. The roughly 17 windows per session are too few for a session-only null, so the 50-window minimum applies to the total (the archived run has 52). `report.json` states this under `nullModel`, with per-session trial and placebo counts and per-session null statistics; `nullStats` is pooled for display only; checks of sided channels are unsigned unless the trace has the hold side. A face or eyelid check passes with at least 6 trials above the placebo q90, a face check also needs `E_T3 / E_T1` within [0.7, 1.3], and the release fails only when the tau fitted to the mean unpaired release trajectory exceeds 3 x the nominal `held.releaseTau`. A criterion without data is `n/a`, which fails the gate, except for a channel whose parameter no trace of the rig has (ForBOOTH has no `ParamCheek`): that check is listed with the reason and not gated. Posture checks are reported and pooled per channel, never gated. Slow-modulation checks need long holds, which T3 does not run, so they are not scored. Each result keeps the scorer's own verdict under `scorer`.
- Liveliness: three 599 s idle scenarios (captures of 600 s, a marker each minute, no inputs) with cursor attention off and the cursor parked, each warm-up-trimmed by 180 s and aggregated with `naturalIdleLivelinessGate` like T2 (median; any hard failure fails).
- Output: the gate run dir (`.temp/qa/<ts>-motion-gate-<target>-t3/`) holds `scenarios/`, `partials/`, `report.json` (level `t3`, the rules, the T1 reference, the plan and every session run id), `summary.txt`, `timing.json` and `report.html` rendered with each session's T3 run dir. Each session's own run dir keeps `trace.json` with its scenario and Natural events and the screenshots. A session that fails (verification, cursor parking, launch) adds a failing `session:<id>` row, and the remaining sessions still run; an interrupt or a refusal stops the run.
- `--rescore <gate run dir>` scores an archived emotion run again from its session traces with the current scorer and rules, launching nothing. It scores the scenarios the run performed, read back from its `scenarios/` and checked against every layout invariant the live planner guarantees (`t3PlanFromScenarios`: strictly increasing times, the planner's scenario identity and settings, event kinds, cell membership, unique trial and placebo ids, pulse-id numbering, session count and equal duration of at most 599 s, warm-up, pulse spacing, pulses per cell, no back-to-back cell, one placebo per pulse gap, every placebo window clear of every pulse's lifetime and of the next pulse, non-overlapping placebo windows, screenshots, at least 50 placebo windows). It also requires each session trace to stamp exactly its scenario's events, every field compared (`trace-identity`: kind, at, trialId, emotion, band, source and any other field), and each session run dir to belong to its scenario (`session-header`: the same `scenario.json`, run label `t3-<scenario id>`, the gate run's commit, trace version 2, Natural driver and capture length, the forbooth rig with the same model file, file count and zip size as the first session, and the bridge configuration with cursor attention off, expressions on, the scenario's held emotions and the captured model). A violation exits 2 naming the invariant, before any run dir is created. It requires the archived T1 reference to be present with the same `determinismHash`, writes a new `<ts>-motion-gate-emotion-t3-rescore` run dir with `rescoreOf`, and uses the same scoring and output code as a live run.
- Exit codes: 0 every gated check passed, 1 a check failed or a session broke, 2 refused before launch (or an archive that cannot be re-scored), 130 interrupted.

## T3 rendered runs

`qa:motion t3` runs one motion scenario in the real Electron app and captures what Natural performed:

```bash
AIRI_QA_RIG_FORBOOTH="<rig dir>" pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke
AIRI_QA_RIG_FORBOOTH="<rig dir>" node --import tsx packages/qa-tools/bin/motion.ts t3 --rig forbooth --scenario <file.json> [--keep-open]
```

- Run `pnpm qa:doctor` first. Do not start a run while a heavyweight check (Vitest browser suites, `electron-vite build`, root typecheck or lint) runs, and keep the app window visible: the bridge paces scenarios with `requestAnimationFrame`, which a hidden or covered window throttles. The harness measures the frame rate before it starts and fails a run whose events were stamped more than 0.5 s late.
- Steps: refuse when an Electron or stage-tamagotchi process of this worktree already runs (exit 2); `createRun` (`.temp/qa/<YYYYMMDD-HHmmss>-motion-t3-<scenario id>/`, never reused); zip the directory that holds the rig's `*.model3.json` into `rig.zip`; `pnpm --dir <worktree> -F @proj-airi/stage-tamagotchi dev` with `APP_USER_DATA_PATH=<run dir>/profile`, `APP_REMOTE_DEBUG=true`, a free `APP_REMOTE_DEBUG_PORT`, `APP_REMOTE_DEBUG_NO_OPEN=true` and `APP_MOTION_QA_BRIDGE=true`; connect to the main stage target (`synced-leader=true`, route `#/`); mark onboarding complete and reload; wait for the bridge; import the rig through a hidden file input and `importModelFromInput`; `configure({ driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions })`; park the OS cursor (Windows `SetCursorPos`, read back with `GetCursorPos`; a failed call or a cursor that is not at the target fails the run with the Win32 error and the foreground process; other platforms warn); `startCapture(min(600, durationSeconds + 1))`; `runScenario`; screenshots at `screenshotsAt` on the scenario clock while it runs; `awaitCapture`; verify; tear down.
- Every wait is bounded: CDP commands time out (default 30 s), the bridge wait, the rig import (600 s), `runScenario` (duration + 60 s) and `awaitCapture` (capture + 120 s) each have a limit, and a launch that exits early fails at once.
- Expression ids: scenarios name expressions by catalog id, which T1 resolves against the rig's catalog fixture (`fixtures/forbooth-catalog.json`). The rendered app keys expressions by their archive-relative `.exp3.json` path, so T3 sends each catalog id as that entry's `fileName` and records the mapping in `bridge.json` (`expressionIds`). Ids that are not in the catalog are sent unchanged, and the bridge rejects them.
- Verification (`verification.json`) fails the run unless every scenario event was dispatched and is stamped in `trace.json` in order with its `at`, the `capture:<label>` marker is present, Natural reported `hold` events when the scenario has emotions, the trace has samples, and every planned screenshot exists.
- Run dir: `run.json` (with `process.rootPid`), `scenario.json`, `launch.json`, `app.log`, `bridge.json`, `trace.json`, `screenshots/NN-<at>s.png`, `screenshots.json` (planned and actual scenario time and trace time per shot), `verification.json`, `teardown.json`, and `error.txt` on failure. The profile and `rig.zip` are deleted by teardown; rig bytes never stay in the run dir.
- Teardown runs on success, failure and Ctrl+C (later interrupts are ignored until it finishes): `Browser.close` over CDP, then `taskkill /PID <root> /T /F` (POSIX: a process-group kill) only after the live process table shows the same PID and creation time with the worktree path in its command line, then each remaining run process the same way. A process belongs to the run when it was seen in the root's tree, its command line contains the run's profile path, or it is an Electron or stage-tamagotchi process whose command line contains this worktree's path as a whole path. Processes of other worktrees never match, so a stray Electron from another worktree is neither a conflict nor a target; the doctor's `stray-electron` row uses the same whole-path rule. The profile is deleted only when no run process remains; otherwise `teardown.json` lists the leftovers and the run exits 1.
- Exit codes: 0 verified, 1 run, verification or teardown failure, 2 usage or environment error before launch (for example `AIRI_QA_RIG_FORBOOTH` unset, a scenario without level `t3` or longer than 599 s), 130 interrupted. `pnpm qa:motion` and the `node --import tsx` form preserve these codes; `pnpm -F @proj-airi/qa-tools exec tsx bin/motion.ts` reports every failure as 1.
- A hard kill of the CLI itself (for example `taskkill /F` on its PID) skips teardown. Check for leftovers with `pnpm qa:doctor` (`stray-electron`) and stop them by hand after confirming their command lines contain your worktree path.
- `builtin:t3-smoke` (`fixtures/scenarios/t3-smoke.json`, levels `t1` and `t3`, 140 s): clear pulses of happy, sad, angry, surprised, think, love, flustered and sleepy 14 s apart (longer than `naturalEmotionLifetime` for clear, 8.7 s, and strong, 12.3 s), one `<|ACT {"emotion":"angry"}|>` marker, `expression1` on and off, and screenshots 1 s and 3 s after each pulse. The same file runs unchanged through `runT1`, and both traces stamp the same scenario events.
## Review report

`pnpm qa:report <runDir> [<runDir>...] [--out <file>]` writes one self-contained HTML page, `<firstRunDir>/report.html`, from any mix of run directories: gate runs (`report.json`), T3 runs (`scenario.json`, `screenshots.json`, `screenshots/`) and `qa:test` runs (`summary.json`). Rerunning overwrites the file.

- Header: run ids, levels, rig, git SHA with the dirty flag, and gate id, version and `fileSha`, from `run.json` and `report.json`.
- The limitations statement from `src/report/limitations.ts` (`reportLimitations`), verbatim, near the top and in the footer.
- Verdicts: one row per emotion x band with its failed checks named; per-channel numbers (`E`, CI, expected, size ratio, `d`, hit rate, Holm p, tau, transfer ratio when a result carries `transferRatio`) in a `<details>` block. Liveliness reports show their metrics against the reference bands.
- Per-cell trajectories: an inline SVG per cell with the gate's windows (`emotionGate.windows`, `release`), the null q90 band, the paired mean trajectory of `report.json` (schema 2: `trajectory`, direction-folded like `E`) with its bootstrap band, the paired mean effect with its CI over the scored window, the late-window mean with its CI and the folded expected effect. Every panel's y axis is in the units of its `E` (named in the gutter), and a mark is drawn only in those units (`src/report/panel-units.ts` holds the audit table): eyelid panels therefore show no late-window mean, late CI or held-only release grid, which the scorer computes from lid ratios minus one. When the run dir still holds `partials/`, the release grids are drawn on face and posture panels, folded the same way. A schema-1 report draws the window statistics only, and the page says so.
- A cell's verdict counts only gated checks. Rows a gate reports without judging (`gated: false`: T3 posture, a channel the rig lacks) show the verdict `not gated` with their reason and never fail the cell.
- T3 runs: a contact sheet of the screenshots grouped by the scenario event that precedes them, with the offset after the pulse. A T3 session that failed before it wrote a trace or a screenshot index is shown as `session not captured` with its own failure summary, not as missing inputs. ForBOOTH runs carry a note that the default watermark expression covers most of the face.
- "For your visual check": every failing cell, every result row the page could not read, and passing cells with a size ratio above 1.3 or a face or eyelid parameter whose mean scored-window peak (`levels`, raw units) lies within 5% of the rig's `min` or `max`. The list points at cells; it never claims the motion looks natural.
- Known failures: the suite counts, new, known, fixed and flaky-passed lists of a `qa:test` run.
- Inputs: every directory with what it was used as and every missing or unreadable file, including result rows of `report.json` that do not have the emotion-check shape (they are named above the verdict table, never dropped). A directory without `report.json` still renders, with the missing inputs named instead of an empty table.
- No `src="http`, `href="http` or `url(http`: images are base64 PNG, plots are inline SVG, fonts are the system stack.
- Exit codes: 0 written, 1 written but an input was missing or unreadable (a file or a result row; the page names it), 2 usage error.
- Tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/report`.

## Scorer validation

`pnpm qa:motion validate-scorer --level t1 [--sections aa,zero,mutations,unmutated,determinism] [--seeds N] [--workers N] [--timeout-minutes N]` checks the emotion scorer itself with the committed emotion gate (`src/motion/validation/`, `gates/validation.gate.ts`).

- `aa`: 20 seed sets of emotion-free runs, scored unpaired as every emotion and band against the committed placebo null. At most 1 set may pass any significance or visibility check, the placebo hit rate must be 0.10 +- 0.03, and the p-values must be uniform (Kolmogorov-Smirnov p > 0.01, `src/motion/ks.ts`). The old checkpoint-12 single-trial rules are scored on the same trials for comparison.
- `zero`: an all-zero emotion table, scored paired, must pass nothing.
- `mutations`: x0, sign flip, ignore side, x0.5, x2, `releaseTau` x3 and blink interval 1, each applied through the `emotionTable` seam or scenario `settings.performance`, with the kill rate of the targeted criterion.
- `unmutated`: 5 reseeded full gate runs, which must pass every check.
- `determinism`: two independent runs give identical scores, and shuffled events or records change nothing.
- The CLI runs one Vitest process per shard and phase (simulate, then score) and writes `validation.json` (every number, threshold and verdict, with no run id or time) and `summary.txt`. Exit codes: 0 every threshold met, 1 a threshold missed or the run broke, 2 a usage error. A missed threshold is a finding for Luke; never change a gate constant to meet it.

## When to use

- A QA script must spawn pnpm or Vitest reliably, for example while `PNPM_HOME` shims may be regenerated (exit 127).
- Running agent QA that needs the shared helpers in this package.

## When not to use

- Product code: nothing in the apps or runtime packages should depend on this package.
- Ordinary development; use `pnpm` directly.
