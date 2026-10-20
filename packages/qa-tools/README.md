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
- `--seeds N` runs at most N seeds per variant; the report records `selection.seedsLimit`. The committed counts live in the gate, never in the CLI.
- Exit codes: 0 every check passed, 1 a check failed or the run broke (a missing partial, a Vitest failure, the timeout), 2 a usage or T2 setup error (including invalid model3 JSON or a missing rig/core). `pnpm qa:motion` passes the code through.
- Timing targets (full gate 5 min, smoke 60 s on 16 cores) are recorded in `timing.json` and `run.json` with the CPU load before the run; they are not asserted.
- Every report states that scores prove direction, size relative to the recipe, release and detectability above the rig's idle noise, not naturalness.

## When to use

- A QA script must spawn pnpm or Vitest reliably, for example while `PNPM_HOME` shims may be regenerated (exit 127).
- Running agent QA that needs the shared helpers in this package.

## When not to use

- Product code: nothing in the apps or runtime packages should depend on this package.
- Ordinary development; use `pnpm` directly.
