# @proj-airi/qa-tools

## Purpose

This private, Node-only package runs repository QA checks for motion, test failures, rendered Electron scenarios, reports, and evidence. Product packages must not depend on it.

## Usage

Run `pnpm qa:doctor` first. It checks whether the current worktree can produce meaningful results and does not repair the environment.

| Command | Use |
| --- | --- |
| `pnpm qa:doctor [--json] [--warm]` | Check Node, pinned pnpm, installation, built packages, Cubism Core, Chromium, rig paths, and conflicting Electron processes. `--warm` runs the stage-ui browser warm-up. |
| `pnpm qa:test --all` | Run the registered Vitest package and project set, then report new, known, fixed, and flaky-passed tests. |
| `pnpm qa:test --package <name> [--package <name>...] [--project node\|browser] [--registry <file>] [--timeout <seconds>]` | Run selected test targets. |
| `pnpm qa:motion gate emotion --level t1 [--emotions a,b] [--bands clear,strong] [--seeds N] [--workers N] [--timeout-minutes N]` | Score the deterministic controller simulation against committed emotion rules. |
| `pnpm qa:motion gate liveliness --level t1 [--workers N] [--timeout-minutes N]` | Check idle motion against the committed generated-liveliness rules. |
| `pnpm qa:motion gate <emotion\|liveliness> --level t2 --rig forbooth [options]` | Run the selected gate against the headless ForBOOTH rig and Cubism Core. Set `AIRI_QA_RIG_FORBOOTH`; set `AIRI_QA_CUBISM_CORE` when the core is not at the checkout's default path. |
| `pnpm qa:motion t3 --rig forbooth --scenario <builtin:name\|file.json> [--keep-open]` | Drive a scenario in the rendered Electron app and collect a Natural trace and screenshots. |
| `pnpm qa:motion validate-scorer --level t1 [--sections aa,zero,mutations,unmutated,determinism] [--seeds N] [--workers N] [--timeout-minutes N]` | Evaluate scorer false positives, mutation detection, unmutated gate power, and determinism. A missed validation threshold exits 1 by design. |
| `pnpm qa:report <runDir> [<runDir>...] [--out <file>]` | Combine gate, T3, and test-run evidence into a self-contained HTML review page. |

`--seeds N` reduces a run and the report records that selection. It does not change the committed gate. Exit code 0 means the requested check passed, 1 means a check failed or a run broke, and 2 means invalid arguments or setup; T3 also uses 130 for interruption.

## Levels

| Level | What it proves | What it cannot prove |
| --- | --- | --- |
| T0 | Unit tests cover local contracts and deterministic behavior. | Integration with the full controller, a rig, or a rendered application. |
| T1 | A deterministic scenario exercises the real decider, conductor, hold performer, Natural controller, adapter, and shared scorer without a rig. | Cubism physics, rig-specific parameter behavior, pixels, or visual naturalness. |
| T2 | The real ForBOOTH rig, Cubism Core, physics, and pose run headlessly at a fixed timestep. The spike measured exact Chromium parameter parity and more than 10x real time. | Renderer pixels, complete application behavior, or naturalness. |
| T3 | The Electron renderer dispatches scenario events through its development-only bridge and captures the resulting trace and screenshots. | Statistical confidence from a single rendered scenario or visual naturalness. |
| T4 | Luke reviews the report and rendered images for appearance and naturalness. | An automated, reproducible naturalness score. |

Statistical scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which remains Luke's visual call. Desk VTS recordings are valid for idle liveliness only.

## Scenarios

Scenario files use the shared `@proj-airi/stage-shared/motion-scenario` contract. The same scenario can run at T1, T2, and T3 when its events are supported at those levels. T3 scenarios cannot contain speech or cursor events. `builtin:t3-smoke` is a rendered smoke scenario; scenario events and Natural events are timestamped in the captured trace.

`builtin:t3-touch` declares a near-band right-side approach from 1.9 to 0.6 head widths at 3 head widths per second, four seconds of horizontal strokes, a 1.5-second rest, and body/head pokes. It ends after the head poke without an off-desktop escape target. Far and medium approaches remain covered at T1. `builtin:t3-touch-pass` declares one straight pass. T3 performs pointer events with real Windows input. The head rectangle uses the cursor's unscaled face-feature interaction unit, not the physics-inclusive presence bubble or the user's touch scale. It is measured in viewport CSS pixels through the model's layout and world transforms, then converted to physical screen pixels with the DOM window origin and device pixel ratio. `bridge.json` records that head rectangle beside the stage window's CSS size.

Before any cursor movement, the runner reads the physical virtual-screen bounds with `GetSystemMetrics` and checks every mapped target. It keeps a fitting declared path. If the path does not fit, it mirrors the approach axis toward the virtual-screen center, including later strokes and pokes, and checks the entire mirrored path. It never clips points or shortens the approach. If neither path fits, `pointer-path-outside-virtual-screen` refuses input. The playback script rechecks the live bounds before input, so a changed monitor layout cannot silently clamp targets. `bridge.json` records the virtual-screen rectangle, selected mirror axis, and effective physical steps; scenario trace markers retain the declared coordinates.

Before any cursor movement, a head width greater than half the stage window's CSS width refuses the run as `pointer-head-implausible`, with both widths in the error. A path that cannot fit the desktop is also a named refusal, not permission to shrink the reported head or bypass bounds checks. Real cursor receipt mismatches remain failures, and the receipt is preserved in the error. Touch runs enable cursor attention; ordinary smoke and emotion/liveliness gates keep their existing cursor-parked behavior.

## Gates

Gate definitions live in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts`.

| Gate id | Version | Meaning |
| --- | --- | --- |
| `natural-idle-liveliness` | 1 | Idle Natural metrics against reference bands. |
| `natural-talking` | 1 | Talking head speed relative to silence and speech-onset enrichment. |
| `natural-emotion` | 1 | Emotion direction, recipe-relative size, release, and visibility above the idle null. |
| `natural-emotion-t3` | 2 | Rendered emotion transfer against session-local placebo windows and a same-commit T1 reference. |
| `natural-idle-liveliness` at T3 | 1 | Rendered idle liveliness from three captures, aggregated by the liveliness gate. |

Changing a gate means editing `gates.ts` and bumping its `version` in a commit before running it. Reports record the gate id, version, and source file SHA. Never tune a gate or Natural recipe merely to make a failing run pass. Failures are findings.

T1 is the deterministic controller simulation. T2 uses the real headless rig and the shared scorer. The idle liveliness gate keeps its original seeds, warm-up, scored duration, and metric list.

## Evidence

After argument and environment checks pass, `pnpm qa:test`, `pnpm qa:motion gate` at T1, T2, or T3, direct `pnpm qa:motion t3`, and `pnpm qa:motion validate-scorer` create unique runs under `.temp/qa/<timestamp>-<tool>-<label>/`. Each run's `run.json` records its command, source SHA, dirty state, relevant `APP_*` and `AIRI_QA_*` environment values, gate provenance when applicable, artifact hashes, and result. A T3 gate also creates one run per capture session. An emotion `--rescore` creates its new run only after the archive passes validation; a refusal exits 2 before creating it. The standalone `t2:probe` prints a JSON summary and creates no run directory.

`pnpm qa:doctor` prints its findings, including with `--warm`, and creates no run directory or manifest. `pnpm qa:report` writes `report.html` into the first input run directory or the path passed with `--out`; it creates no separate run directory or manifest. The evidence archive command copies files under `.omo/evidence/<slug>` and writes that archive's `manifest.json`, not a QA run directory or `run.json`.

Archive plan evidence into the main checkout before removing a worktree:

```bash
pnpm -F @proj-airi/qa-tools run evidence archive --plan <slug> --from <worktree-path>
```

The archive command preserves the source, refuses conflicting bytes, and writes a hash manifest. Run output and evidence are not committed.

## Known failures

`packages/qa-tools/known-failures.json` is the committed baseline. `pnpm qa:test` matches package, project, file, and full test name. New failures and suite errors fail the command. Known failures are reported without being called passes; fixed known failures are reported for registry removal, and flaky entries that pass are identified separately.

Never skip, delete, or weaken a test to clear a failure. Fix a regression or add a registry entry only when there is a concrete cause, date, and removal condition.

## Bridge gates

The motion QA bridge is development-only and uses remote debug; it adds no listening port. Registration requires all three gates: a development build, `APP_REMOTE_DEBUG=true`, and `APP_MOTION_QA_BRIDGE=true`. The bridge uses typed Eventa commands as one dispatcher and validation boundary, not as an isolation or security boundary. Production bundle checks verify that bridge markers are absent.

## T2 status

T2 is GO, path A. The Cubism Core and ForBOOTH rig ran in Node without a GPU using two documented global shims. Across 600 frames and 281 parameters, Node and Chromium differed by 0; the negative control differed by 30. The measured Natural, adapter, and physics loop reached 55.19x real time. The runner skips mesh deformation because it reads but does not write parameters and costs about 90% of a frame.

## Known limitations

The protocol-1 limits are historical: x0 detection was 92.9% with impulse hints active, `ignore-side` detection was 83.3% with a fixed hold side, x0.5 size detection was 64.4% at the inclusive 0.5 size boundary, and unmutated sets passed 84% to 88% of checks. Protocol 2 addresses these validation-design causes without changing gates or Natural motion. See `docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md`.

The first full protocol-2 run passed A/A, zero, mutations, and determinism; unmutated failed. Mutations met their thresholds: x0 killed 324/325 eligible checks, pooled ignore-side killed 72/72 mutable checks, and x0.5 calibration killed 174/174 clear and strong checks. The unmutated run found 37 persistent failures: visibility 7, significance 6, release 31, and size 3. Its remaining 66 noise failures exceeded the budget of 25 across 1,500 check-set pairs, so the prediction that failures would come only from persistent checks was missed. These findings were recorded without retuning. See .omo/evidence/motion-gate-redesign/findings.md for the full list.

Smoke timing is recorded, not asserted. Quiet-machine measurements were 44.7 to 65.0 seconds against a 60-second target; the full gate was 294.6 seconds against a 300-second target.

Naturalness remains Luke's visual call. ForBOOTH's watermark covers part of the face in T3 screenshots. Per Luke's rule, acceptance on one rig counts for the other.

### T1 limitations

- **ACT markers need an emotion.** A scenario ACT marker that carries only `expression` (or only `motion` or `look`) throws at T1 with `ACT marker has no recognized emotion`, because the T1 sink applies only the marker's emotion (`src/motion/scenario-sink.ts`). Put an `emotion` in the marker, or use an `expression` event.
- **Traces show no catalog expressions.** T1 has no rig, so it decides expression slot commands but does not apply them (`src/motion/t1/runner.ts`). A T1 trace records what Natural performed and never shows a catalog expression.
- **Visibility is uninformative on a channel whose idle null never moves.** A zero-spread null makes a hit rate and uniform p-values impossible by construction, so scorer validation reports those channels separately (`zeroSpreadChannels` in `src/motion/validation/evaluate.ts`). At T1 this affects eyeSmile and cheek.
- **`QA_RUN_DIR` in your shell enables the gate project.** `vitest.config.ts` includes `gates/**/*.gate.ts` whenever `QA_RUN_DIR` is set, so a plain package test run in a dev shell with it exported picks up gate files. Unset it before running the package tests directly; `qa:motion gate` sets it per run.

### T3 gates

Before scoring, live T3 gates require `trace.meta.home` to equal the scenario's `home` (default `desk`). Emotion `--rescore` checks the same `posture-home` invariant after all artifact digests pass; a mismatch exits 2 before creating a run directory.

The diagnostics store's local `postureHome` defaults to `product`. At `runScenario`, the bridge synchronously sets it to `scenario.home ?? 'desk'`. Model owns rebuilding the adapter for that home, preserving an already-running recorder and reattaching its observer. The home persists after the last event and capture, until the next scenario replaces it or bridge scope disposal restores `product`. The `t3-smoke` fixture already requests `desk`.

`pnpm qa:motion gate emotion --level t3 --rig forbooth [--t1-report <run dir>]` and `pnpm qa:motion gate liveliness --level t3 --rig forbooth` run committed gates in the rendered app. Emotion `--rescore <gate run dir>` re-scores archived sessions without launching Electron. A live gate uses a separate launch, capture, and teardown for each session. These commands do not accept `--emotions`, `--bands`, `--seeds`, `--workers`, or `--timeout-minutes`.

- Preflight, before anything launches (exit 2 with the reason): `AIRI_QA_RIG_FORBOOTH` must name a rig; doctor's `stray-electron` probe must find no stage-tamagotchi Electron process of this worktree; the emotion gate needs a T1 emotion report at the same commit with a result for every face check of its cells. Without `--t1-report`, the newest `.temp/qa/*-motion-gate-emotion-t1` run at `HEAD` is used; create one with `pnpm qa:motion gate emotion --level t1 --emotions angry,sad,love,sleepy --bands clear,strong`.
- Emotion (`naturalEmotionT3Gate`, `src/motion/gate/t3-scenario.ts`): 10 pulses each of angry strong, sad clear, love clear, and sleepy strong, ordered by a seed so the same cell never repeats consecutively. The gate uses three capture sessions so each session forms its own stratum for the placebo null. The planner assigns the 40 pulses across three equal 300-second scenarios, leaving room for warm-up and placebo windows below the 599-second scenario limit imposed by the renderer's 600-second capture cap and the harness's one-second capture margin. It places placebo windows after each pulse and adds lead placebos until the run has at least 50. The archived accepted run contains 52 placebo windows.
- Scoring (`src/motion/gate/t3-score.ts`) uses the shared scorer with no stripped run: `measureEmotionTrial(trace, null, ...)`, `measurePlacebos` and `scoreEmotionGate` (significance, sign, visibility). The placebo null is session-stratified (`naturalEmotionT3Gate` v2, `placeboNull`): every record carries its session as `stratum`, each trial's visibility hit uses its own session's placebo q90, `E` is the mean trial-minus-own-session-null difference with a bootstrap that resamples within sessions, and significance is `stratifiedUnpairedPValue`, a permutation test that relabels trials and placebos only within each session. The roughly 17 windows per session are too few for a session-only null, so the 50-window minimum applies to the total (the archived run has 52). `report.json` states this under `nullModel`, with per-session trial and placebo counts and per-session null statistics; `nullStats` is pooled for display only; checks of sided channels are unsigned unless the trace has the hold side. A face or eyelid check passes with at least 6 trials above the placebo q90, a face check also needs `E_T3 / E_T1` within [0.7, 1.3], and the release fails only when the tau fitted to the mean unpaired release trajectory exceeds 3 x the nominal `held.releaseTau`. A criterion without data is `n/a`, which fails the gate, except for a channel whose parameter no trace of the rig has (ForBOOTH has no `ParamCheek`): that check is listed with the reason and not gated. Posture checks are reported and pooled per channel, never gated. Slow-modulation checks need long holds, which T3 does not run, so they are not scored. Each result keeps the scorer's own verdict under `scorer`.
- Liveliness: three 599-second idle scenarios, each captured for 600 seconds, with a marker each minute and no inputs. Cursor attention is off and the OS cursor is parked. Each trace is trimmed by the unchanged 180-second warm-up and aggregated with `naturalIdleLivelinessGate` as in T2. A median is used; any hard failure fails. A conflicting stage-tamagotchi Electron process from this worktree refuses the run before launch with exit 2. A cursor-parking failure is recorded as a failed session.
- Output: the gate run dir (`.temp/qa/<ts>-motion-gate-<target>-t3/`) holds `scenarios/`, `partials/`, `report.json` (level `t3`, the rules, the T1 reference, the plan and every session run id), `summary.txt`, `timing.json` and `report.html` rendered with each session's T3 run dir. Each session's own run dir keeps `trace.json` with its scenario and Natural events and the screenshots. A session that fails (verification, cursor parking, launch) adds a failing `session:<id>` row, and the remaining sessions still run; an interrupt or a refusal stops the run.
- `--rescore <gate run dir>` scores an archived emotion run again with the current scorer and rules, launching nothing. Before parsing scoring inputs, it checks every artifact it will read against the SHA-256 recorded in that run directory's `run.json` at capture time (`src/motion/gate/t3-archive.ts`): the gate run's `report.json` and `scenarios/*.json`, the T1 reference's `report.json`, and each traced session's `scenario.json`, `trace.json`, `bridge.json` and `verification.json`. A changed or missing file, or one without a digest, exits 2 with the named `archive invariant "artifact-digest"`. It then checks the planner's layout invariants, exact trace-event identity (`trace-identity`), and session headers (`session-header`). Those refusals also exit 2 with the named invariant, before any rescore run directory is created. A valid archive uses the same scoring and output code as a live run and writes a new rescore directory with `rescoreOf`. The manifest is trusted: rewriting an artifact and its corresponding `run.json` digest together is not detected.
- Exit codes: 0 every gated check passed, 1 a check failed or a session broke, 2 refused before launch (or an archive that cannot be re-scored), 130 interrupted.

Rendered T3 gates require an UNDISTURBED desktop. Mouse movement can fail cursor parking. Focus changes or window occlusion can throttle frames and corrupt long captures. Warn the user before starting a long capture, then keep the desktop, app focus, and window visibility unchanged until it ends.

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
- Exit codes: 0 verified, 1 run, verification or teardown failure, 2 usage or environment error before launch (for example `AIRI_QA_RIG_FORBOOTH` unset, a scenario without level `t3` or longer than 599 s), 3 no exclusive CPU lease within 30 min (`T3_LEASE_TIMEOUT_EXIT`), 130 interrupted. `pnpm qa:motion` and the `node --import tsx` form preserve these codes; `pnpm -F @proj-airi/qa-tools exec tsx bin/motion.ts` reports every failure as 1.
- A hard kill of the CLI itself (for example `taskkill /F` on its PID) skips teardown. Check for leftovers with `pnpm qa:doctor` (`stray-electron`) and stop them by hand after confirming their command lines contain your worktree path.
- `builtin:t3-smoke` (`fixtures/scenarios/t3-smoke.json`, levels `t1` and `t3`, 140 s): clear pulses of happy, sad, angry, surprised, think, love, flustered and sleepy 14 s apart (longer than `naturalEmotionLifetime` for clear, 8.7 s, and strong, 12.3 s), one `<|ACT {"emotion":"angry"}|>` marker, `expression1` on and off, and screenshots 1 s and 3 s after each pulse. The same file runs unchanged through `runT1`, and both traces stamp the same scenario events.

## Result cache

Completed T1 runs are stored in `<git common dir>/airi-qa-cache`, whether they pass or fail. A rerun whose inputs match a stored entry is replayed: it prints `CACHED from <run id>`, copies the stored files, sets `cache: { hit: true, sourceRunId, entryId }` in `run.json`, starts no Vitest process, and takes no CPU lease. A measured hit ran in 0.3 s (2.7 s with pnpm and tsx startup). The matching miss ran Vitest for about 12.9 s.

The key covers the arguments, the environment variables with the prefixes `QA_`, `VITE_`, and `VITEST_` plus `NODE_OPTIONS`, `NODE_ENV`, and `TZ` (`QA_RUN_DIR` is excluded), the gate file hash, the install inputs (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `patches/`), and the runtime identity (Node, platform, architecture, and the Vitest version and hash).

A hit requires every recorded file to exist with identical bytes, including line endings. The recorded closure is the repository files reached through the Vitest config's module graph, plus the `extends` chains of the tsconfig files. A corrupt entry counts as a miss. If the key cannot be built, the run prints `QA cache disabled for this run: <reason>` and runs normally.

Limits:

- `--fresh` skips the lookup, and the run is still stored.
- A cached run is never T3 acceptance evidence. `gate emotion --level t3 --t1-report <cached run>` refuses it before any lease is taken.
- An environment variable outside the filtered prefixes does not enter the key, so changing it can return a stale hit. The same applies to a relative import written with a `.js` suffix for a `.ts` file: that form was measured as a stale hit. The repository config chain does not use either form today.

Worker count: `gate --workers` defaults to the CPU slot grant and is clamped to it. See the cpu-slots README for the classes.

## Review report

`pnpm qa:report <runDir> [<runDir>...] [--out <file>]` writes one self-contained HTML page, `<firstRunDir>/report.html`, from any mix of run directories: gate runs (`report.json`), T3 runs (`scenario.json`, `screenshots.json`, `screenshots/`) and `qa:test` runs (`summary.json`). Rerunning overwrites the file.

The report is a review aid. It does not change a gate verdict or make a naturalness claim.

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
- `mutations`: x0, sign flip, `ignore-side`, `ignore-side-neg`, x0.5, x2, `releaseTau` x3 and blink interval 1, each applied through the `emotionTable` seam or scenario `settings.performance`. K1 scores x0 using detection or held-only size, with a 0.99 minimum. K2 proves per-cell equality for both constant-side variants, excludes `notMutable` checks, and applies the 0.95 minimum to their pooled mutable checks. K3 uses paired held-only size calibration for x0.5, with a 0.90 minimum on clear and strong checks; slight checks and the gate-verdict size kill rate are reported only.
- `unmutated`: 5 reseeded full gate runs. A check failing in at least 4 of 5 sets is a persistent finding and fails the section. Other failures are compared with the 0.99 quantile of Binomial(`noiseTrials`, 0.01); `n/a` results are reported separately and do not count.
- `determinism`: two independent runs give identical scores, and shuffled events or records change nothing.
- The CLI runs one Vitest process per shard and phase (simulate, then score) and writes `validation.json` (every number, threshold and verdict, with no run id or time) and `summary.txt`. Exit codes: 0 every threshold met, 1 a threshold missed or the run broke, 2 a usage error. A missed threshold is a finding for Luke; never change a gate constant to meet it.

## When to use

Use this package when motion needs a gate verdict, an agent needs to run a rendered scenario, a test run must distinguish new failures from the baseline, or QA evidence needs a portable report and durable archive.

## When not to use

Do not use this package from product code or for ordinary development commands. It does not replace unit tests, manual visual review, or Luke's naturalness judgment.
