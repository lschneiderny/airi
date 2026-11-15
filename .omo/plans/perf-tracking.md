# perf-tracking - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** Luke, and the agents working on the app with him. Today the app's performance can only be watched live in developer panels. After this work, every development session leaves a tagged record of CPU, memory and frame timing, so slowdowns can be compared across commits and features.

**What you'll get:**
- A recorder that runs by default in development, with an on/off switch in the developer settings.
- Automatic incident files when the character stutters, memory keeps growing, or a process is pegged.
- A one-click 10-second browser trace.
- A `perf` report command that answers "what got slower" and "which feature is heavy".
- A repeatable benchmark whose results are kept per commit, so two commits can be compared against measured noise.

**Why this approach:**
- Real use and benchmark runs share one data format. The benchmark launches the app with the same recorder switched on, so one report reads both.
- CPU is measured the one way that stays correct when other code also polls the same Electron API.
- Comparisons are made per session rather than per 5-second sample, and are labelled as observations, so they don't over-claim.

**What it will NOT do:**
- Send data anywhere.
- Record the web version of the app.
- Change any existing quality gate or motion behaviour.
- Start traces automatically.

**Effort:** XL
**Risk:** Medium - the recorder sits next to a frame loop with no spare time; an early overhead check guards it.
**Decisions to sanity-check:**
- Existing QA sessions are opted out of recording, and only the benchmark records.
- Dev sessions re-read the git state on every hot reload, so a session can span several "identity epochs".
- Statistics need at least 5 blocks from 3 sessions before they report a difference.

Your next move: start execution with `/ulw-execute perf-tracking` in this session or a new one. Full execution detail follows below.

---

> TL;DR (machine): XL, medium risk; usage recorder (main + stage-window samplers) + incidents + manual Chromium trace + `pnpm perf` report + `pnpm qa:bench` with history/compare + docs; 22 todos, 4 waves, F1-F4.

## Scope
### Affected user and ideal state
**Affected user:** (U1) Luke, who runs `pnpm dev:tamagotchi` daily on Linux and packaged builds on his MacBook; today he can only watch live devtools panels, after this every dev session leaves a tagged performance record he can compare across commits and features. (U2) Coding agents doing optimization and bug work; today they start from one-off evidence folders, after this they read `pnpm perf ... --json` (including the session they just ran) and run `pnpm qa:bench`, comparing a working tree against HEAD. (U3) The running app: its MMD frame has no idle time (bundled Ammo is wasm2js, ~10.5 ms per Bullet step), so recording must not perturb it. (U4) Existing QA sessions (`qa:smoke`, `qa:app`, `qa:motion t3`, `qa:stage measure`) and parallel worktree dev sessions: their gates and profiles must not change because of the recorder.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | In a dev build (`import.meta.env.DEV`) the recorder runs with no action; Settings > System > Developer has a persisted "Record performance" toggle; preview and packaged builds start with it off; `AIRI_PERF_RECORD=0\|1` and `AIRI_PERF_DIR=<dir>` override both in dev builds only, and the toggle shows when an override is active | Owner decision 2026-11-14 "On in dev, toggle" |
| IS-2 | Recording adds at most 1% of one core summed over all app processes, no per-frame allocation, sort or IPC, and leaves stage fps and p95 frame time unchanged within the independent instrument's pair noise | U3: the MMD frame budget is saturated |
| IS-3 | Every record is attributable: session id, identity epoch with commit sha, branch, dirty flag and diff hash (re-read at runtime in dev after hot reloads), build mode (dev/preview/packaged), app and Electron version, host fingerprint, renderer kind, display-model id and sanitized name, feature flags, devtools-open, stage host, display size/scale/refresh, activity mode, visibility, and host/lease contention | History and "what is heavy" both need tags that stay true during a dev session |
| IS-4 | Per-process CPU (cumulative CPU-second deltas) and working set are mapped to an exhaustive role set: browser, gpu, zygote, utility:<serviceName>, window:<kind>, devtools:<kind>, renderer:unmapped, other | "Which window or process is heavy" without a silent bucket |
| IS-5 | Raw JSONL is segmented (daily or at 64 MiB), each segment rolled up; raw segments are kept 14 days and pruned only after a rollup or `rollup-failed` row exists; rollups are appended to a file that is never pruned; a crashed session is rolled up on the next start; incidents are kept 14 days; the perf dir stays under a 1 GiB raw cap | Owner decision "Raw 14d, rollups forever" |
| IS-6 | `pnpm perf sessions\|features\|compare\|incident\|bench` prints text or `--json`, includes sessions not yet rolled up (reduced in memory, never written back), counts malformed and unknown-version lines instead of failing, reads the Linux dev and packaged data dirs by default and any `--dir` (repeatable), and follows the qa-tools exit-code contract | U1 and U2 |
| IS-7 | Frame stall, memory growth and pegged-process incidents write an incident file immediately from main's records, append the stage window's per-frame ring when it arrives (or `ringMissing: true` after 3 s), with settling, hidden and suspend exclusions, hysteresis, cooldowns and 6/hour, 20/day caps | Owner decision "Yes, ring-buffer dump" |
| IS-8 | A "Capture Chromium trace (10 s)" button in Settings > System > Developer writes a contentTracing file into the perf `traces/` folder with a bounded buffer, shows its path and a "local only, may contain URLs" note, keeps the last 5, refuses a second concurrent capture, and marks samples `chromiumTrace: true` | Owner decision: manual trace |
| IS-9 | `pnpm qa:bench` (Linux, inside `qa:display`) runs a fixed scenario matrix, each launch under its own exclusive CPU lease with a temp profile, measures with the same recorder, appends one record per run to `bench.jsonl` in the per-machine state dir (resolved like cpu-slots history; `AIRI_PERF_BENCH_DIR` override), keyed by scenario, model fingerprint and (sha, diffHash); `pnpm perf compare --bench` reports deltas against measured noise, allows a dirty tree against HEAD, and prints `low-confidence` with little history | Owner decisions: bench store in state dir, on-demand cadence |
| IS-10 | Records, rollups, incidents and bench rows never contain chat text, prompts, transcripts, file paths, URLs or secrets; `traces/` is exempt and labelled local-only | Motion-trace precedent: never a personal asset path |
| IS-11 | The behavior is documented with the code (stage-shared README, qa-tools README, stage-tamagotchi README, docs/ai/testing.md, an ADR that also justifies `pnpm perf` living in qa-tools), and agent routing is updated in a separate commit | AGENTS.md conventions |
| IS-12 | QA sessions other than `qa:bench` do not record (`t3LaunchEnv` sets `AIRI_PERF_RECORD=0`), so existing gates such as `stage-frame-budget` see no change; no QA session writes outside its temp profile or an explicit `AIRI_PERF_DIR` | U4: gates have little margin and must not be tuned |
| GAP-1 | No recorder service, config, Eventa contract or toggle exists; `io-trace-recording` is the template, but its config hardcodes `enabled: false` | IS-1 |
| GAP-2 | No per-window rollup exists; the lag sampler is stage-web only; `MMDFrameMetrics` is read only live and sorts on read | IS-2, IS-3 |
| GAP-3 | Nothing tags measurements; `~build/git` is frozen at bundle build and has no dirty flag; hot reloads change code under one sha | IS-3 |
| GAP-4 | Nothing maps `app.getAppMetrics()` pids to windows; its `percentCPUUsage` interval is shared with three other callers; dev DevTools windows are an unlabelled confound | IS-4 |
| GAP-5 | No rollup store, segmentation or failure handling; the IO-trace sweep only runs on enable and start | IS-5 |
| GAP-6 | No report CLI exists | IS-6 |
| GAP-7 | No incident detection exists; the desktop stage window disables background throttling, so renderer visibility is unreliable there | IS-7 |
| GAP-8 | No contentTracing code exists; the performance-visualizer devtools page already starts its own "tracing" on mount | IS-8 |
| GAP-9 | Bench-like runs leave one-off evidence folders with no history or compare | IS-9 |
| GAP-10 | No privacy rule exists for perf data | IS-10 |
| GAP-11 | No documentation covers any of it | IS-11 |
| GAP-12 | Every QA launch is a dev launch, so a dev-default recorder would run inside existing gates | IS-12 |

### Must have
- One record contract (`@proj-airi/stage-shared/perf/usage`) with only schemas and pure, explicit-time math, used by the app, the CLI and the bench; versioned records (`v: 1`); unknown versions are skipped and counted, never migrated.
- TDD for pure parts (owner decision); tests-after for services and UI; agent-run live QA in `qa:display` for every runtime todo.
- CPU from `cumulativeCPUUsage` deltas per (pid, creationTime), never `percentCPUUsage`.
- Main drives the 5 s cadence: it pulls each stage window's rollup on its tick and writes one append per tick; renderer samplers run only in stage windows and only while recording is active.
- A runtime probe (todo 7) validates platform assumptions before the recorder is built on them.
- Overhead proven in the recorder wave with the independent `measureStage` instrument (todo 14).
- Tamagotchi (Electron) only; macOS covered by fixtures and pure path resolvers, listed as a limitation.
- Branch `luke/feat/perf-tracking`, atomic passing commits, one PR against `lschneiderny/airi`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No network upload, telemetry endpoint or analytics provider call with perf data.
- No change to `apps/stage-web/**`, its lag sampler or `devtools-lag` store.
- No automatic contentTracing; no change to the performance-visualizer page's existing tracing.
- No change to any gate, scorer constant, Natural recipe, motion behavior or `motion-diagnostics` snapshot field (adding a store method is allowed; snapshot fields are a QA contract).
- No product import of `@proj-airi/cpu-slots` or `@proj-airi/qa-tools`.
- No new npm dependency, no root `package.json` dependency change, no lockfile change (root `scripts` entries are allowed).
- No `any` (do not copy `io-trace-recording/register.ts:14`), no `tsconfig` suppression, no skipped tests, no edits to non-English locales.
- No bench run wired into `pnpm verify` or `verify --gate` (owner decision: on demand).
- No renderer heap metric in v1 (`performance.memory` is bucketed and cached; working set per process is the memory signal).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for pure parts (schemas, histograms, CPU and role math, contention decider, identity resolver, rollup reducer, incident deciders, comparison statistics, CLI planning/formatting); tests-after for the main service, renderer sampler, Eventa registration and UI; Vitest (`--project node` / `--project browser` per package config).
- Allocation guarantees are tested structurally (typed-array identity and length unchanged, no collection growth after 100k calls), never with GC observation.
- Evidence: `<attemptDir>/task-<N>-perf-tracking.<ext>` where attemptDir is the ulw-execute attempt dir; outside ulw-execute use `.omo/evidence/perf-tracking/`.
- Live app QA always runs inside `pnpm qa:display run -- ...` with a temporary profile (never Luke's profile or desktop), recording enabled explicitly through `qa:app --perf-dir` or `AIRI_PERF_RECORD=1` + `AIRI_PERF_DIR`, and asserts on parsed `pnpm perf ... --json` fields or parsed JSONL, not on grep hits.
- Commit loop: `pnpm verify` after each todo; branch gate: `pnpm verify --gate` and `pnpm qa:display run -- pnpm qa:smoke` before the PR (docs/ai/testing.md "App runtime code" row); `pnpm qa:test:model` when stage-ui-mmd changes.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- Prerequisite (before todo 1): the main checkout holds two uncommitted, verified fixes from 2026-11-14 (Live2D import waits for preview-module initialization in `packages/stage-ui/src/stores/display-models.ts`; QA speech-end events in `packages/stage-ui/src/composables/performance/use-motion-qa-events.ts`, `use-motion-qa-bridge.ts`, `packages/stage-ui/src/components/scenes/Stage.vue`, `packages/qa-tools/src/app/summary.ts`). Todo 19's `mmd-talk` scenario depends on the speech-end fix. If `git log main` does not contain them when execution starts, ask Luke to land them first; never copy them into this branch.
- Branch: create `luke/feat/perf-tracking` from `main` (`pnpm wt new perf-tracking` when another session uses the main checkout).
- Wave 1 - contracts, pure logic, identity, probe: todos 1-7. Todo 1 runs first (it provides the schemas and bins). Then 2 -> 3 -> 4 run in order (they share `packages/stage-shared/src/perf/usage/`), while 5 and 6 (both need todo 1) run in parallel with them; 7 has no dependency and can start immediately.
- Wave 2 - runtime recorder: todos 8-13. 8 (Eventa) and 9 (QA opt-out) first; then 10 (main service) and 11 (stage sampler) in parallel; then 12 (toggle) and 13 (trace) in parallel.
- Wave 3 - overhead, retention, incidents, report: todos 14-18. 14 right after 10+11 (stop and fix overhead before building more); then 15 and 16 in sequence (both touch `perf-recording/`); 17 after 15; 18 after 4+16+17.
- Wave 4 - bench and docs: todos 19-22. 19 after 10+15+17; 20 after 4+19; 21 after all runtime todos; 22 last, its own commit.
- Executor topology: one worker per todo; workers whose write scopes overlap run sequentially (1-4 in stage-shared; 10, 13, 15, 16 all touch `perf-recording/` in that order); independent todos in a wave run in parallel.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2, 3, 4, 5, 6, 8, 10, 11, 17 | 7 |
| 2 | 1 | 3, 10 | 5, 6, 7 |
| 3 | 1, 2 | 4, 15, 16 | 5, 6, 7 |
| 4 | 1, 3 | 18, 20 | 5, 6, 7 |
| 5 | 1 | 11 | 2-4, 6, 7 |
| 6 | 1 | 10 | 2-5, 7 |
| 7 | - | 10, 11 | 1-6 |
| 8 | 1 | 10, 11, 12, 13, 16 | 9 |
| 9 | - | 10, 14, 19 | 8 |
| 10 | 2, 6, 7, 8, 9 | 12, 13, 14, 15, 16, 19 | 11 |
| 11 | 1, 5, 7, 8 | 14, 15, 16, 19 | 10 |
| 12 | 10 | 21 | 13 |
| 13 | 9, 10 | 21 | 12 |
| 14 | 9, 10, 11 | 15, 16, 21 | - |
| 15 | 3, 10, 11, 14 | 16, 17, 19 | - |
| 16 | 3, 8, 9, 10, 11, 14, 15 | 18, 21 | 17 |
| 17 | 1, 15 | 18, 19, 20 | - |
| 18 | 4, 16, 17 | 21 | 19 |
| 19 | 9, 10, 11, 15, 17 | 20 | 18 |
| 20 | 4, 19 | 21 | - |
| 21 | 12, 13, 14, 16, 18, 20 | 22 | - |
| 22 | 21 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

### Wave 1 - contracts, pure logic, identity, probe

- [x] 1. Add the `@proj-airi/stage-shared/perf/usage` record contract and fixed-bin histogram
  Recommended task executor category: deep-low - schema and data-structure work fully specified here.
  What to do: Create `packages/stage-shared/src/perf/usage/` with `index.ts` (barrel), `records.ts`, `bins.ts`, `histogram.ts`, `privacy.ts`, tests beside them; export the subpath `./perf/usage` in `packages/stage-shared/package.json` (same shape as `./perf/io-trace`); add a README entry (purpose, use, non-use: no samplers or IO here).
  - `records.ts` - Valibot schemas + inferred types. Every line: `v: 1`, `kind`, `t` (epoch ms integer), `sessionId`. Kinds:
    - `session-start`: `segment` (integer, 0 for the first file), `host` {`platform`, `arch`, `cpuModel`, `cores`, `totalMemKb`, `gpu: string | null`}, `buildMode: 'dev' | 'preview' | 'packaged'`, `appVersion`, `electronVersion`, `chromeVersion`, `frameBins`/`stageBins` ids, `startedBy: 'toggle' | 'env' | 'default'`.
    - `identity`: `epoch` (integer, starts 0), `sha`, `shortSha`, `branch: string | null`, `dirty: boolean | null`, `diffHash: string | null`, `source: 'runtime-git' | 'build-info'`. Written at session start and whenever the identity changes (todo 6).
    - `sample` (main, 5 s): `epoch`, `intervalMs`, `processes[]` {`pid`, `creationTime`, `role`, `label`, `cpuPctOfCore: number | null`, `workingSetKb`, `peakWorkingSetKb`}, `machine` {`load1`, `cores`, `externalCpuPct`, `psiCpuSomeAvg10: number | null`}, `hostContended: boolean`, `chromiumTrace: boolean`, `recorderMs`, `bytesWritten`.
    - `window-rollup` (stage window, pulled by main per tick): `epoch`, `window` (label), `visible` (supplied by main), `paused`, `tags` {`renderer: 'live2d' | 'mmd' | 'vrm' | 'spine' | 'tachie' | 'godot' | 'none'`, `modelId`, `modelName`, `features` (fixed keys from todo 11), `featureHash`, `activity: PerformanceMode | 'unknown'`, `chatGenerating`, `stageHost: 'window' | 'desktop'`, `devtoolsOpen`, `display` {`width`, `height`, `scale`, `refreshHz`}, `diagnosticsTracing`}, `frames`, `frameHist` (number[] = frame bins + overflow), `frameSumMs`, `frameMaxMs`, `longTasks` {`count`, `maxMs`, `sumMs`}, `stages` (record stageId -> {`n`, `sumMs`, `maxMs`, `hist` sparse [binIndex, count][]}) | null, `recorderUs`.
    - `event`: `name` ('model-load' | 'feature-change' | 'visibility' | 'suspend' | 'resume' | 'renderer-reload' | 'recording-start' | 'recording-stop' | 'trace-start' | 'trace-stop' | 'rollup-missing' | 'incident-suppressed'), `window?`, `detail` (record of scalars).
    - `incident`: `id`, `trigger` ('frame-stall' | 'memory-growth' | 'pegged'), `window?`, `pid?`, `peak` (record of numbers), `hostContended`, `file` (path relative to the perf dir).
    - `segment-rollup` (only in `sessions.jsonl`): `segment`, `startedAt`, `endedAt`, `recovered`, `malformedLines`, `excludedWindows`, `cells[]` keyed by {`epoch`, `sha`, `dirty`, `diffHash`, `window`, `renderer`, `modelId`, `featureHash`, `features`, `activity`, `hostContended`, `stageHost`, `devtoolsOpen`, `refreshHz`} with `windows`, `frames`, merged `frameHist`, per-window headline quartiles {`p50FrameMs`, `share21`, `share36`, `share100`, `cpuPct`, `workingSetKb`}, merged stages, `incidents`; plus segment totals `recorderMs`, `rawBytes`, and `host`, `buildMode`.
    - `rollup-failed` (only in `sessions.jsonl`): `segment`, `reason`.
    - `bench-run` (only in `bench.jsonl`, used by todo 19): `matrix`, `scenario`, `scenarioVersion`, `run`, `sha`, `dirty`, `diffHash`, `modelFingerprint`, `host`, `buildMode`, `electronVersion`, `leaseClass`, `valid`, `invalidReason?`, `metrics` {`fps`, `p50FrameMs`, `p95FrameMsApprox`, `share21`, `share36`, `share100`, `stageWindowCpuPct`, `gpuCpuPct`, `browserCpuPct`, `stageWindowWorkingSetKb`, `stageSumMeanMs: number | null`, `recorderMs`}.
    - `parsePerfLine(line): { ok: true, record } | { ok: false, reason: 'json' | 'schema' | 'version' }`; never throws; unknown `v` -> `version`.
  - `bins.ts`: `FRAME_BINS_V1` = `[4, 6, 7.5, 9, 10.5, 12.5, 15, 18, 21, 25, 30, 36, 42, 58, 75, 100, 150, 250, 500, 1000, 2000]` ms (bin i counts [edge[i-1], edge[i]); overflow bin >= 2000), `STAGE_BINS_V1` = `[0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 25, 50]` ms; ids `frame-v1`, `stage-v1`.
  - `histogram.ts`: class `FixedHistogram` over a preallocated `Uint32Array`: `add(value)` (binary search, no allocation; NaN/negative go to an `invalid` counter), `reset()`, `mergeFrom(counts)`, `toArray()`, `toSparse()`, `count`, `shareAtLeast(edgeMs)` (exact for an edge, throws for a non-edge), static `approxQuantile(counts, edges, q)` returning a bin upper edge.
  - `privacy.ts`: `sanitizeModelName(name)` -> basename without extension, path separators removed, max 80 chars; `containsForbiddenText(line)` heuristics used by tests (path-like `/x/y`, `://`, `sk-` prefixes).
  Must NOT do: no Vue, Pinia, Electron, `node:fs`/`os` imports; no clocks; no `any`.
  Closes: GAP-2, GAP-3, GAP-10 (contract part)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 2, 3, 4, 5, 6, 8, 10, 11, 17
  References: `packages/stage-shared/package.json` exports (`./perf/io-trace`); `packages/stage-shared/src/perf/io-trace.ts`; `packages/stage-shared/AGENTS.md` (pure cores, explicit time, no platform side effects, own subpath for transports); `packages/stage-shared/src/performance-state/index.ts:14` (`PerformanceMode`); `packages/stage-shared/README.md`; `packages/motion-driver-humanoid/src/motion-trace/types.ts` (never a personal asset path).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage` passes: every kind round-trips through `parsePerfLine`; `v: 2` -> `version`; truncated -> `json`; missing field -> `schema`; `FixedHistogram` edge value goes to the upper bin, NaN to `invalid`, >= 2000 to overflow, `shareAtLeast(21)` exact; `sanitizeModelName('/opt/a/b/Chisa v1.pmx') === 'Chisa v1'`; `pnpm -F @proj-airi/stage-shared typecheck` clean.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage --reporter=verbose` saved to `<attemptDir>/task-1-perf-tracking.txt`, PASS when all cases pass; failure - the committed test `parsePerfLine('{"v":1,"kind":"sample"}')` returns `{ ok: false, reason: 'schema' }` and `parsePerfLine('{')` returns `json`, Evidence same file.
  Commit: Y | feat(stage-shared): add usage performance record contract and fixed-bin histogram

- [x] 1F. Tighten the usage record contract from the todo 1 gate notes
  Recommended task executor category: quick - three small contract fixes in `packages/stage-shared/src/perf/usage/`.
  What to do: (a) assert `FRAME_BINS_V1` and `STAGE_BINS_V1` equal the plan's todo 1 lists in a test (stored records depend on these edges; a changed edge must fail); (b) constrain every `frameHist` array in `records.ts` (window-rollup ~:180, segment-rollup cell ~:240) to length `FRAME_BINS_V1.length + 1` and every sparse stage hist index to `< STAGE_BINS_V1.length + 1`, so a schema-valid line can never make `FixedHistogram.mergeFrom` throw; (c) make the `activity` picklist (~:42) exhaustive over `PerformanceMode` at compile time (a type-level check that fails typecheck when a mode is added).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage` passes with a test that a wrong-length `frameHist` returns `{ ok: false, reason: 'schema' }`; changing one bin edge fails a test; typecheck clean; `pnpm verify` green.
  Commit: Y | fix(stage-shared): pin usage bins and bound histogram lengths in perf records

- [x] 2. Add pure CPU, process-role and contention math to `perf/usage`
  Recommended task executor category: deep-low - small pure functions with precise rules.
  What to do: `packages/stage-shared/src/perf/usage/cpu.ts` + test:
  - `class CpuDeltaTracker` keyed by `${pid}:${creationTime}`: `update(processes: { pid, creationTime, cumulativeCpuSec: number | undefined }[], nowMs)` -> Map key -> `cpuPctOfCore | null` (delta CPU s / delta wall s * 100); first sighting, missing `cumulativeCpuSec`, or a negative delta -> null; unseen keys dropped. Time is passed in.
  - `machineExternalCpuPct({ prevTimes, nowTimes, appCpuPctOfCoreSum, cores })` from two `os.cpus()`-shaped `times` arrays; clamp [0, 100]; document that AIRI's own child processes outside `getAppMetrics` (MCP servers, computer-use daemon) count as external.
  - `decideHostContended({ load1, cores, externalCpuPct, psiCpuSomeAvg10 })` -> true when `externalCpuPct >= 25` OR `psiCpuSomeAvg10 >= 10` (when non-null) OR `load1 / cores >= 0.75`; thresholds exported as named constants.
  - `processRole({ type, serviceName, windowLabel, devtoolsKind })` exhaustive over Electron `ProcessMetric.type` ('Browser' -> browser; 'GPU' -> gpu; 'Zygote' -> zygote; 'Utility' -> `utility:<serviceName ?? name ?? 'unknown'>`; 'Tab' with a window label -> `window:<label>`, with a devtools kind -> `devtools:<kind>`, else `renderer:unmapped`; 'Sandbox helper', 'Pepper Plugin', 'Pepper Plugin Broker', 'Unknown' -> other). A `switch` with an exhaustiveness check.
  - `parsePsiCpu(text)` for `/proc/pressure/cpu` (`some avg10=1.23 ...`) -> number | null.
  Must NOT do: no `node:os`/`fs` reads; no clocks.
  Closes: GAP-4, GAP-3 (contention tag)
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 3, 10
  References: `node_modules/.pnpm/electron@43.8.7_supports-color@10.2.2/node_modules/electron/electron.d.ts` `app.getAppMetrics` :1153-1159 (percentCPUUsage interval shared - do not use), `CPUUsage.cumulativeCPUUsage` :7390 (optional), `ProcessMetric` :11383-11431, `MemoryInfo` :9472-9490; existing callers `apps/stage-tamagotchi/src/main/services/electron/foreground-window.ts:70-72`, `services/linux-desktop/index.ts:32`, `services/electron/window-rects-spike.ts:625`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage/cpu` passes: 2 CPU-s over 4 wall-s -> 50; pid reuse -> null; undefined cumulative -> null; vanished pid dropped; every `ProcessMetric.type` maps to a role (table test); PSI real line and garbage; each contention threshold true at and false just below.
  QA scenarios: happy - verbose run to `<attemptDir>/task-2-perf-tracking.txt`; failure - pid-reuse and negative-delta cases assert null, never a negative or huge value, Evidence same file.
  Commit: Y | feat(stage-shared): add usage CPU delta, process role and contention deciders

- [x] 3. Add the segment rollup reducer and incident deciders to `perf/usage`
  Recommended task executor category: deep-high - streaming reducer plus three stateful deciders with hysteresis; correctness argued from rules.
  What to do: `rollup.ts` and `incidents.ts` + tests in `packages/stage-shared/src/perf/usage/`.
  - `class SegmentRollupReducer`: `push(record)` for every raw kind; `finish({ endedAt, recovered })` -> `segment-rollup`. A `window-rollup` joins the latest `sample` of the same session within 7.5 s for its window process `cpuPctOfCore`/`workingSetKb` and `hostContended`, and the latest `identity` for epoch/sha/dirty/diffHash. Excluded from cells (counted in `excludedWindows`): `visible=false`, `paused=true`, the first 60 s of the session, 20 s after `model-load`, `resume`, `renderer-reload` or a new `identity` epoch, and windows spanning a `suspend`..`resume` gap. Quartiles computed at `finish()` only (arrays bounded by window count). Malformed and unknown-version lines are counted by the caller and passed into `finish`.
  - `incidents.ts` - pure, explicit `nowMs`, returned memory:
    - `decideFrameStall(memory, rollup, nowMs)`: fires on one frame >= 500 ms OR >= 3 frames >= 100 ms in one rollup OR a long task >= 500 ms OR a `rollup-missing` signal (stage window did not answer the tick's pull); clears after 6 consecutive clean rollups; per-window cooldown 10 min.
    - `decideMemoryGrowth(memory, { workingSetKb, nowMs })`: the caller feeds samples (sizes in KiB; "MB" below means MiB); baseline = median of minutes 2-5 after the window's last `model-load`; fires when the least-squares slope over the last 10 min > 20 MB/min AND current >= baseline + 300 MB; clears when slope < 5 MB/min for 5 min; cooldown 30 min; next fire needs a further +300 MB.
    - `decidePegged(memory, { cpuPctOfCore, nowMs })`: >= 90 for 6 consecutive samples; clears < 60 for 3; cooldown 10 min.
    - `IncidentBudget`: 6 per rolling hour, 20 per rolling day.
    - Each returns `{ fire, suppressedReason?: 'host-contended' | 'chromium-trace' | 'settling' | 'hidden' | 'suspended' | 'budget' | 'cooldown', memory }`.
  Closes: GAP-5 (rollup), GAP-7 (deciders)
  Parallelization: Wave 1 | Blocked by: 1, 2 | Blocks: 4, 15, 16
  References: todo 1 shapes; `packages/stage-shared/AGENTS.md` (deciders take explicit time, return memory); precedents `packages/stage-shared/src/situation/`, `src/performance-state/`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage/rollup src/perf/usage/incidents` passes: a synthetic segment with settling, hidden and suspended windows excluded and counted, and contended windows kept in their own `hostContended: true` cells; an identity change splits cells by epoch; a crash stream finished with `recovered: true`; frame-stall fires on 3 x 100 ms and on `rollup-missing`, not on 2 x 100 ms, honors cooldown and the 6-rollup clear; memory growth fires on 25 MB/min + 350 MB, not on + 250 MB; pegged needs 6 consecutive; budget suppresses the 7th in an hour.
  QA scenarios: happy - verbose run to `<attemptDir>/task-3-perf-tracking.txt`; failure - "2 frames of 100 ms" and "+250 MB" cases assert no fire, Evidence same file.
  Commit: Y | feat(stage-shared): add usage segment rollup reducer and incident deciders

- [x] 4. Add usage and bench comparison statistics to `perf/usage`
  Recommended task executor category: ultrabrain - statistical correctness (blocks, bootstrap, noise floors) is the deliverable.
  What to do: `compare.ts` + test.
  - `compareFeature({ rollups, feature, metric, seed })` (observational), metric in `p50FrameMs | share21 | share36 | share100 | cpuPct | workingSetKb`: keep cells with `hostContended=false` and `leaseContended !== true` (todo 18 sets it); stratify by host (`platform`+`cpuModel`), `renderer`, `modelId`, `activity`, `window`, `stageHost`, `devtoolsOpen`, `refreshHz`; never pool strata; the two sides differ only in `feature`; block = one segment-cell with >= 24 valid windows, value = cell median; per side report blocks, sessions, windows, median, IQR; difference (abs and %), Cliff's delta, 90% bootstrap CI over blocks (2000 resamples, mulberry32 seeded from `seed`); minimums 5 blocks, 3 sessions, 120 windows per side else `insufficient` with counts; A/A floor from 50 seeded half-splits of the larger side (90th percentile of |difference|); verdict `difference` only when the CI excludes 0 AND |difference| > floor, else `within-noise`; always `label: 'observational'`; prefer paired within-session differences when >= 3 sessions contain both states (report both).
  - `compareBench({ runsA, runsB, history, metric })`: groups keyed by (sha, diffHash); refuse when host, buildMode, electronVersion, scenario or modelFingerprint differ or any run is invalid; dirty A or B is allowed (agents compare a working tree against HEAD) but dirty runs never enter the pooled noise history; sigma = 1.4826 x MAD of residuals from each group's median, pooled over A, B and up to 10 trailing clean commits of the same host+scenario+model; with fewer than 10 history commits use pair-local noise and set `lowConfidence: true`; verdict `regression`/`improvement` when |median(B) - median(A)| > 2 sigma AND > the practical floor (`p95FrameMsApprox` 0.5, `fps` 1, `stageWindowCpuPct` 2, `stageWindowWorkingSetKb` 20000) AND >= 4 of 5 (or all of 3) B runs on the same side of median(A); else `within-noise`; `stale` when the groups' newest runs are > 7 days apart; return every run value.
  Closes: GAP-6 (statistics), GAP-9 (compare)
  Parallelization: Wave 1 | Blocked by: 1, 3 | Blocks: 18, 20
  References: todo 1 and 3 shapes; alternating-pair medians `packages/qa-tools/src/stage/gates.ts:466-511` (`gateFrameBudget`); `packages/qa-tools/src/stage/measure.ts` `INVALID-CONCURRENT-LOAD`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage/compare` passes: a 4 ms shift with 6 blocks per side -> `difference` with CI excluding 0; no shift -> `within-noise`; 4 blocks -> `insufficient`; mixed hosts never pooled; bench: host mismatch -> refused; dirty B vs clean A allowed and excluded from history; 3-sigma shift 5/5 -> `regression`; 3/5 -> `within-noise`; 4 history commits -> `lowConfidence: true`; same seed -> identical output.
  QA scenarios: happy - verbose run to `<attemptDir>/task-4-perf-tracking.txt`; failure - no-shift and 3/5-agreement cases assert `within-noise`, Evidence same file.
  Commit: Y | feat(stage-shared): add usage and bench comparison statistics

- [x] 4F. Make the paired sign-flip floor exact for small session counts
  Recommended task executor category: deep-low - one statistical helper and its wording.
  What to do: in `packages/stage-shared/src/perf/usage/compare-stats.ts`, compute the paired sign-flip floor by exact enumeration of all 2^n sign patterns when n <= 14 (fall back to the seeded 50-flip sample above that), so a consistent shift at >= 8 sessions always rejects and the paired verdict no longer depends on the seed; correct the wording in `compare.ts:21-28`, the README and the test title that say pairing "cannot reject at all" below 8 sessions (it rejects rarely; 8 is where it may decide).
  Acceptance criteria: a test that a consistent 4 ms shift over 8 sessions x 1 block returns `difference` decided by the paired estimate for every seed in 1..20; no-shift calibration (200 seeds, 8x1 and 20x1) <= ~10%; `pnpm -F @proj-airi/stage-shared exec vitest run src/perf/usage` passes; `pnpm verify` green.
  Commit: Y | fix(stage-shared): enumerate sign flips exactly for small paired comparisons

- [x] 5. Add allocation-free usage accumulators to `MMDFrameMetrics` and a drain on the diagnostics store
  Recommended task executor category: deep-low - one class plus one store method, strict no-allocation rule, QA contract to respect.
  What to do: In `packages/stage-ui-mmd/src/composables/mmd/frame-metrics.ts` add usage accumulators independent of the rolling rings and measurement state: per stage index preallocated `n`, `sumMs`, `maxMs` and a `Uint32Array` over `STAGE_BINS_V1`; a frame accumulator (count, sum, max, `Uint32Array` over `FRAME_BINS_V1`); a 30 s per-frame ring (`Float32Array(2048)` intervals, `Float32Array(2048)` total stage ms, `Uint8Array(2048)` slowest stage index, cursor). Stage ids get an integer index on first sight using the existing lookup. `recordStage`/`recordFrame` update them with no allocation. Add `drainUsage(target)` (copy into a caller-owned reusable object, then reset) and `copyFrameRing(target)`. In `packages/stage-ui-mmd/src/stores/motion-diagnostics.ts` add store methods `drainUsage(target)` and `copyFrameRing(target)` that forward to the current metrics instance, and drain the old instance into a pending buffer before `setMetrics` swaps it (`:429`), so no frames are lost on remount.
  Must NOT do: no change to `timings()`, `fps()`, `measurement()`, ring sizes or any snapshot field (`packages/stage-ui-mmd/AGENTS.md`); no sort; no per-call closures; no frame-order change.
  Closes: GAP-2 (MMD stage source)
  Parallelization: Wave 1 | Blocked by: 1 (bins) | Blocks: 11
  References: `packages/stage-ui-mmd/src/composables/mmd/frame-metrics.ts:1-140` (`MMDFrameMetrics` :34, ring 600 :17, `startMeasurement` :123, `stopMeasurement` :131, `measurement` :137); owner swaps `packages/stage-ui-mmd/src/components/scenes/MMD.vue:928,:1344`; `packages/stage-ui-mmd/src/stores/motion-diagnostics.ts:185,:401-403,:429`; `packages/stage-ui-mmd/src/composables/mmd/frame-pipeline.ts:66-166` (existing `metrics.measure(id, () => ...)` closures are pre-existing and out of scope); memory: a per-frame metrics sort once dropped measurement mode to 33 fps (c0ba40539).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/composables/mmd/frame-metrics src/stores/motion-diagnostics` passes, including a structural test: capture references to every accumulator typed array, run 100,000 `recordStage` + `recordFrame` calls across 12 stage ids, assert the same array identities and lengths and that the stage-index Map size equals 12; drain twice returns zeros the second time; a swap via `setMetrics` keeps the drained frames; existing tests unchanged and green; `pnpm qa:test:model` green.
  QA scenarios: happy - test output to `<attemptDir>/task-5-perf-tracking.txt`; failure - in a scratch run make `recordStage` push into a growing array and observe the structural test fail; record that output, then restore. Evidence same file.
  Commit: Y | feat(stage-ui-mmd): add allocation-free usage accumulators and a diagnostics drain

- [x] 6. Add the build-mode and identity resolvers for perf sessions
  Recommended task executor category: unspecified-low - a pure resolver plus a small git-reading module with fakes.
  What to do:
  - `apps/stage-tamagotchi/src/main/services/airi/perf-recording/mode.ts`: pure `resolvePerfRecording({ dev, packaged, env, stored })` -> `{ buildMode: 'dev' | 'preview' | 'packaged', enabled, source: 'env' | 'toggle' | 'default' }` where `dev` is `import.meta.env.DEV`; precedence: env (`AIRI_PERF_RECORD` '1'/'0', honored only when dev) > stored (boolean) > default (`dev`); `AIRI_PERF_DIR` honored only when dev. Table test shaped like `windows/stage/mode.test.ts:21-39`.
  - `perf-recording/identity.ts`: `class PerfIdentity` with injected `exec` (async) and `buildInfo` (`~build/git` `sha`, `abbreviatedSha`, `branch`): `read()` -> todo 1 `identity` without `epoch`. Dev with a repo found by walking up from `app.getAppPath()` to a `.git` entry (a directory in the main checkout or a file in a `pnpm wt` worktree - accept both; add a test for the file case): one batch of async git calls with a 5 s timeout each - `git rev-parse HEAD`, `git rev-parse --abbrev-ref HEAD`, `git status --porcelain --untracked-files=normal`, and `git diff HEAD` plus the untracked files' names and contents (`git ls-files --others --exclude-standard -z` + `git hash-object --stdin-paths`, all with `--no-optional-locks`) into sha256 (`diffHash`, null when clean); `source: 'runtime-git'`. On any failure, or not dev: build info with `dirty: null`, `diffHash: null`, `source: 'build-info'`. `changed(prev, next)` compares sha, dirty, diffHash.
  Must NOT do: no sync exec on the main thread; never store diff content or file names, only the hash.
  Closes: GAP-3, GAP-1 (mode)
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 10
  References: `apps/stage-tamagotchi/src/main/windows/stage/mode.ts:22-40` + `mode.test.ts:21-39` (pure resolver precedent); dev flags `apps/stage-tamagotchi/src/main/index.ts:157` (`is.dev`) vs `:203,:411` (`import.meta.env.DEV`) - use `import.meta.env.DEV`; `apps/stage-tamagotchi/package.json:20-22` (`preview`, `dev` scripts); `~build/git` use `src/main/services/electron/auto-updater.ts:21` + mock `auto-updater.test.ts:86`; unplugin-info 1.3.2 `client.d.ts` (no dirty flag).
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/airi/perf-recording/mode src/main/services/airi/perf-recording/identity` passes: env '0' in dev -> disabled/source env; env ignored when not dev; stored false beats default; preview -> buildMode preview, default off; clean tree -> `dirty: false, diffHash: null`; porcelain lines -> `dirty: true` + 64-hex hash; an untracked-only change changes the hash; exec rejection -> build-info fallback without throwing.
  QA scenarios: happy - test output to `<attemptDir>/task-6-perf-tracking.txt`; failure - exec-rejection and env-in-packaged cases, Evidence same file.
  Commit: Y | feat(stage-tamagotchi): resolve perf recording mode and build identity

- [x] 7. Probe the runtime assumptions the recorder depends on
  Recommended task executor category: unspecified-low - a throwaway probe whose findings are recorded; no product code.
  What to do: Write `<attemptDir>/probe-main.cjs` (not committed): on `app.whenReady()` it sets `app.setName` to the dev app's name (`apps/stage-tamagotchi/package.json` `name`), opens one hidden `BrowserWindow` loading `data:text/html,<p>probe</p>`, waits 3 s, then prints one JSON object and quits: (1) `cumulativeCPUUsageOnAll`: every `app.getAppMetrics()` entry has a numeric `cpu.cumulativeCPUUsage` after a second call; (2) `osPidMatches`: `win.webContents.getOSProcessId()` equals the `pid` of a `Tab` metric; (3) `memoryUnitsKb`: the Browser metric's `memory.workingSetSize * 1024` is within 20% of `process.memoryUsage().rss`; (4) `userData`: `app.getPath('userData')` (compare with the observed dev path `~/.config/@proj-airi/stage-tamagotchi`; record the packaged productName path from `apps/stage-tamagotchi/electron-builder.config.ts:84` as the expected packaged dir); (5) `psiReadable`: `/proc/pressure/cpu` readable; (6) `loafSupported`: `await win.webContents.executeJavaScript('PerformanceObserver.supportedEntryTypes')` includes `long-animation-frame`; (7) `traceCategories`: `contentTracing.getCategories()` includes `devtools.timeline`. Run it with the repo's Electron binary inside qa:display. Every FAIL becomes a plan amendment (change the affected todo or add a `- [ ] N.` row) recorded before todo 10 starts.
  Must NOT do: no product code or committed file.
  Closes: (de-risks GAP-1, GAP-4, GAP-8)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 10, 11
  References: `electron.d.ts` :1153-1159, :7168, :7390, :9472-9490, :18251 (path `node_modules/.pnpm/electron@43.8.7_supports-color@10.2.2/node_modules/electron/electron.d.ts`); `apps/stage-tamagotchi/src/main/index.ts:92-95` (`APP_USER_DATA_PATH`); `apps/stage-tamagotchi/electron-builder.config.ts:84`.
  Acceptance criteria: `<attemptDir>/task-7-perf-tracking.txt` holds the JSON with the seven facts and a PASS/FAIL line per fact; every FAIL has a recorded amendment.
  QA scenarios: happy - `pnpm qa:display run -- "$(node -p "require('electron')")" <attemptDir>/probe-main.cjs` (run from `apps/stage-tamagotchi` so `require('electron')` resolves the binary path) prints the JSON and exits 0; failure - rerun with `PROBE_PSI_PATH=/nonexistent` honored by the script and confirm `psiReadable: false` is reported without a crash. Evidence `<attemptDir>/task-7-perf-tracking.txt`.
  Commit: N | probe only
  Amendment (2026-11-14, from the todo 7 probe): 6/7 facts PASS (cumulativeCPUUsage on Browser/GPU/Utility/Tab, OS pid match, workingSetSize in KiB (ratio 1.007), PSI readable, `long-animation-frame` supported, all nine trace categories available). `userData` FAIL is a probe artifact: a bare Electron binary with `app.setName` after ready keeps `~/.config/Electron`. Consequences: todo 10 must take the directory from `app.getPath('userData')` at runtime (already specified; `APP_USER_DATA_PATH` in `src/main/index.ts:92-95` may move it), and its QA asserts against the path the running app reports, never a hardcoded one; todo 17 `dirs.ts` uses `@proj-airi/stage-tamagotchi` (dev, from the package name) and `ai.moeru.airi` (packaged: Electron names userData after the packaged package.json `name`, which `electron-builder.config.ts:138` `extraMetadata` sets to `ai.moeru.airi`; `productName: 'AIRI'` only names the bundle - corrected 2026-11-14 by the todo 17 gate, verified with the repo's Electron binary) under the platform config dir.

### Wave 2 - runtime recorder

- [x] 8. Add the perf-recording Eventa contract
  Recommended task executor category: unspecified-low - contract declarations following an existing file.
  What to do: `apps/stage-tamagotchi/src/shared/eventa/perf-recording.ts`, re-exported from `src/shared/eventa/index.ts` like other topic files: `perfRecordingGet` (invoke -> `{ enabled, active, sessionId | null, directory, buildMode, source }`), `perfRecordingSetEnabled` (invoke `{ enabled }` -> state), `perfRecordingChanged` (event state), `perfRecordingPullRollup` (invoke main -> renderer `{ tick }` -> `window-rollup` payload without `sessionId`/`t`/`epoch`/`visible`, or null when not sampling), `perfRecordingPullFrameRing` (invoke main -> renderer -> `{ intervalsMs: number[], stageMs: number[], slowestStage: string[] }` or null), `perfRecordingRendererReload` (event renderer -> main, sent on Vite `vite:afterUpdate` debounced 2 s and on page load), `perfTraceCapture` (invoke `{ seconds: 10 }` -> `{ file }` or error), `perfTraceState` (event `{ capturing, lastFile | null }`).
  Must NOT do: no direct `ipcMain`/`ipcRenderer`; no Eventa main adapter `createContext` in `src/main` (apps/stage-tamagotchi/AGENTS.md).
  Closes: GAP-1
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 10, 11, 12, 13, 16
  References: `apps/stage-tamagotchi/src/shared/eventa/index.ts:54-65`; sibling `src/shared/eventa/computer-use.ts`; `.agents/skills/eventa/SKILL.md`; `docs/ai/adr/2026-11-10-electron-main-ipc-listeners.md`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi typecheck` clean; `pnpm verify` green.
  QA scenarios: happy - typecheck output to `<attemptDir>/task-8-perf-tracking.txt`; failure - a type test (`expectTypeOf`) that `perfRecordingPullRollup`'s result rejects a payload with a `sessionId` field, Evidence same file.
  Commit: Y | feat(stage-tamagotchi): add perf-recording eventa contract

- [x] 9. Opt existing QA launches out of recording and add `qa:app --perf-dir`
  Recommended task executor category: quick - one env line, one flag, their tests.
  What to do: In `packages/qa-tools/src/t3/launch.ts` `t3LaunchEnv` (:21-29) add `AIRI_PERF_RECORD: '0'`; update `launch.test.ts:28`. In `packages/qa-tools/src/app/args.ts` + `run.ts` add `--perf-dir <dir>` which passes `AIRI_PERF_RECORD: '1'` and `AIRI_PERF_DIR: <abs dir>` through `session.start({ launch: { env } })` (options env wins over `t3LaunchEnv`, `launch.ts:69`); README row for the flag.
  Closes: GAP-12
  Parallelization: Wave 2 | Blocked by: - | Blocks: 10, 14, 19
  References: `packages/qa-tools/src/t3/launch.ts:21-29,:60-75`; `launch.test.ts:28`; `packages/qa-tools/src/app/args.ts`, `src/app/run.ts`, `src/app/plan.ts` (dry-run plan lists env); `packages/qa-tools/README.md` qa:app section (:1106-1135).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/t3/launch src/app` passes with: default env contains `AIRI_PERF_RECORD: '0'`; `--perf-dir` produces `'1'` and an absolute dir in the plan; `pnpm qa:app run --dry-run --model x.zip --say hi --perf-dir ./p` prints both env entries.
  QA scenarios: happy - the dry-run command above saved to `<attemptDir>/task-9-perf-tracking.txt`; failure - `--perf-dir ''` exits 2 with the empty-path usage error. Evidence same file.
  Commit: Y | feat(qa-tools): keep qa sessions out of perf recording unless asked

- [x] 9F. Fix the todo 9 gate findings
  Recommended task executor category: quick - a comment move, one test, one env line.
  What to do: (a) `packages/qa-tools/src/app/plan.ts:36-37`: put `buildPlan`'s doc comment back on `buildPlan` (and give `appLaunchEnv` its own short one only if needed); (b) replace the test "lets the launch options env override t3LaunchEnv in the real merge" that copies the merge into the test: assert through the real code path instead (`launchStageTamagotchi`'s spawn harness in `launch.test.ts`, or the function `run.ts:53` actually calls), so reverting `run.ts:53` to the old env fails a test; delete it if no real seam exists and say so; (c) `apps/stage-tamagotchi/scripts/desktop-overlay-live-window-smoke.ts:221` launches the dev app directly: add `AIRI_PERF_RECORD: '0'` to its env so it stays out of recording (IS-12).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/t3/launch src/app` passes; reverting `run.ts:53` env in a scratch edit fails a test (or the test is deleted with the reason recorded); `pnpm verify` green.
  Commit: Y | fix(qa-tools): test the perf-dir launch wiring and keep the overlay smoke out of recording

- [x] 10. Add the main-process perf recorder service, config and wiring
  Recommended task executor category: deep-high - stateful service with lifecycle, file IO, pulls from windows, process mapping and identity epochs.
  What to do:
  - `apps/stage-tamagotchi/src/main/configs/perf-recording.ts`: `createConfig('perf-recording', 'options.json', object({ enabled: optional(boolean()) }), { default: {}, autoHeal: true })` (do not copy io-trace's hardcoded `enabled: false`).
  - `perf-recording/index.ts`: class `PerfRecordingService` with injected `{ directory, now, setInterval, getAppMetrics, getWindows (-> { label, osPid, visible, devtoolsKind?, pullRollup(), pullFrameRing() }[]), readMachine (-> { load1, cores, cpuTimes, psiText | null }), identity: PerfIdentity, mode (todo 6 resolver inputs), getStoredEnabled, setStoredEnabled, fs }`. Methods: `restore()`, `setEnabled(enabled, persist = true)` (mutex), `getState()`, `onStateChange(listener)`, `rendererReloaded(windowLabel)`, `dispose()`.
  - While active: session id `<ISO time, ':' and '.' -> '-'>-<6 base36>`; files `raw/<sessionId>.<segment>.jsonl` (dir 0o700, files 0o600) plus `raw/<sessionId>.live` with the pid; first lines `session-start` and `identity` (epoch 0). Every 5 s tick: one `getAppMetrics()`; `CpuDeltaTracker` on `cumulativeCPUUsage`; map pids to labels (`windowLabelFromUrl`, see below) and DevTools windows (`webContents.isDevToolsOpened()` + `devToolsWebContents.getOSProcessId()` -> `devtools:<label>`); machine signals and `decideHostContended`; `Promise.allSettled` of `pullRollup()` on every stage window with a 1 s timeout (timeout -> `event rollup-missing`); stamp `visible` from main's window state; build the `sample`; ONE `appendFile` with the sample, rollups and queued events; `recorderMs` via `process.cpuUsage()` deltas; `bytesWritten`. Segment rotation at local midnight or 64 MiB (new `session-start` with `segment+1`, same session id, current `identity` repeated). On `rendererReloaded` (debounced 2 s) re-read identity; when changed write `identity` with `epoch+1` and an `event renderer-reload`. `powerMonitor` suspend/resume -> events. On disable/quit/dispose: `event recording-stop`, delete `.live`.
  - `perf-recording/window-label.ts`: pure `windowLabelFromUrl(url)`: `#/` -> `stage-main`, `#/stage` -> `stage`, `#/chat-floating`/`#/chat` -> `chat`, `#/settings...` -> `settings`, `#/devtools...` -> `devtools`, `#/widgets...` -> `widgets`, else `other`; table test.
  - `register.ts`: Eventa handlers for get/set/changed and `perfRecordingRendererReload`, registered for the windows that register IO-trace recording (`windows/settings/rpc/index.electron.ts:57`, `windows/main/rpc/index.electron.ts:76`) and the stage window; renderer-side pull handlers are provided by todo 11.
  - Directory = (dev + `AIRI_PERF_DIR`) else `join(app.getPath('userData'), 'perf')`. Wire in `apps/stage-tamagotchi/src/main/index.ts` beside the IO-trace services (:246-247, :313-340, :415, :436); restore on start; dispose on quit.
  Must NOT do: never read `percentCPUUsage`; no sync fs in the tick; no per-record append; nothing runs when disabled (interval cleared, no pulls).
  Closes: GAP-1, GAP-3, GAP-4
  Parallelization: Wave 2 | Blocked by: 2, 6, 7, 8, 9 | Blocks: 12, 13, 14, 15, 16, 19
  References: template `apps/stage-tamagotchi/src/main/services/airi/io-trace-recording/index.ts:9-100`, `register.ts:18-21`, `index.test.ts:49,:70`; `apps/stage-tamagotchi/src/main/configs/io-trace-recording.ts:5-9`; `apps/stage-tamagotchi/src/main/index.ts:246-247,:300-340,:411,:415,:436`; `src/main/services/airi/io-trace-hub/register.ts:24-40`; `src/main/libs/electron/window-context.ts:32,:41`; window visibility `src/main/services/electron/window.ts:28-31`; powerMonitor `src/main/services/electron/powerMonitor.ts:14-15`, `src/main/windows/stage/index.ts:192-193`; dev DevTools `src/main/windows/main/index.ts:113-115`; stage window `src/main/windows/stage/window-contract.ts:46` (`backgroundThrottling: false`); `electron.d.ts:18251` (`getOSProcessId`).
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/airi/perf-recording` passes with fakes: one append per tick holding the sample and pulled rollups; a timed-out pull writes `rollup-missing`; CPU from cumulative deltas; DevTools pid labelled `devtools:stage-main`; identity change writes epoch 1; segment rotation at the size limit; `.live` created and removed; nothing scheduled when disabled; `windowLabelFromUrl` table; `pnpm verify` green.
  QA scenarios: happy - `pnpm qa:display run -- pnpm --silent qa:app run --model "$AIRI_QA_MMD_MODEL" --say "hello" --expect turn,tts --perf-dir <attemptDir>/task-10-perf --out <attemptDir>/task-10-app` (variables from `.env.qa`); PASS when the raw file's first lines parse as `session-start` and `identity` (40-hex sha, `source: 'runtime-git'`), >= 6 `sample` lines are 5 s +- 0.5 s apart, a `window:stage-main` process has `cpuPctOfCore` in (0, 400], and no `.live` file remains after teardown. failure - `pnpm qa:display run -- pnpm --silent qa:app run --model "$AIRI_QA_MMD_MODEL" --say hello --expect turn --out <attemptDir>/task-10-app-off` (no `--perf-dir`, so `AIRI_PERF_RECORD=0` from todo 9): PASS when `ok: true` and the app log shows no perf-recording start line. Evidence `<attemptDir>/task-10-perf-tracking.txt`.
  Commit: Y | feat(stage-tamagotchi): add main-process perf recorder service

- [x] 11. Add the stage-window usage sampler and tag collection
  Recommended task executor category: deep-high - per-frame hot path with a no-allocation contract and tags from many stores.
  What to do:
  - `apps/stage-tamagotchi/src/renderer/libs/perf/window-usage-sampler.ts`: class `WindowUsageSampler` with injected `{ now, raf, cancelRaf, PerformanceObserver?, mmdDrain?: (target) => boolean, mmdRing?: (target) => boolean, tags: () => tags, paused: () => boolean }`. `start()`/`stop()`; `pull()` returns the current window's rollup (reusing one builder object; a plain copy is returned, one allocation per 5 s) and resets accumulators. Frame data: when `mmdDrain` reports an active MMD source (todo 5 store method), use it and run no own rAF; otherwise one rAF loop with a preallocated callback adding intervals to a `FixedHistogram` and a 30 s `Float32Array` ring. Long tasks: observe `long-animation-frame` when supported (todo 7 result), else `longtask`. `recorderUs` from `now()` deltas.
  - `apps/stage-tamagotchi/src/renderer/bridges/perf-recording.ts`, started from `App.vue` beside `io-trace-hub` (:69) only in full-stage-runtime windows (`renderer/window-context.ts` `stageRuntime`): follows `perfRecordingGet`/`perfRecordingChanged` (sampler only while recording is active), handles `perfRecordingPullRollup` and `perfRecordingPullFrameRing`, emits `perfRecordingRendererReload` on load and on `import.meta.hot` `vite:afterUpdate` (dev), and emits `model-load` and `feature-change` events through the next pull. Tags: renderer kind and model from `useStageModelSelectionStore` (`packages/stage-ui/src/stores/settings/stage-model.ts:15,:108`) + `useDisplayModelsStore` + `sanitizeModelName`; features (fixed keys) `speechMuted` (`stores/speech-output-control.ts:36`), `mmdPhysics`, `naturalMotion` (MMD `motionDriver === 'natural'` from `packages/stage-ui-mmd/src/stores/mmd.ts:112`, or the Live2D Natural setting found with `rg -n "natural" packages/stage-ui-live2d/src/stores`), `mmdRoam` (`roamMode`), `wakeWord` (`stores/wake-word-detection.ts:29`), `hearing` (`stores/modules/hearing.ts:313`); `activity` from the stage's `PerformanceMode` (`packages/stage-shared/src/performance-state/index.ts:14`; expose the current mode from `Stage.vue` `performance` (:588-603) through a read-only getter on an existing stage-ui store, not by importing the component); `chatGenerating` from chat `sending` (`stores/chat.ts:383`); `stageHost` from `useHostCapabilitiesStore` (`packages/stage-shared/src/stores/host-capabilities.ts:14`); `devtoolsOpen` reported by main is merged in main, so the renderer sends false; `display` from `screen` size, `devicePixelRatio` and the measured median frame interval; `diagnosticsTracing` from the performance-visualizer diagnostics tracing state if that store is loaded, else false; `paused` from `useStageWindowLifecycleStore().stagePaused` (`renderer/stores/stage-window-lifecycle.ts:27-29`).
  Must NOT do: no allocation, Map creation, closure creation, sort or IPC per frame; no sampler in settings/chat/devtools windows; no change to stage-web; never read chat text.
  Closes: GAP-2, GAP-3, GAP-10
  Parallelization: Wave 2 | Blocked by: 1, 5, 7, 8 | Blocks: 14, 15, 16, 19
  References: rAF/observer pattern `apps/stage-web/src/composables/perf/register-lag-sampler.ts:18-60` (read only, do not move); `apps/stage-tamagotchi/src/renderer/App.vue:69`; `apps/stage-tamagotchi/src/renderer/bridges/io-trace-hub.ts:5-34`; `apps/stage-tamagotchi/src/renderer/window-context.ts`; `apps/stage-tamagotchi/src/renderer/pages/stage.vue:62-81,:476`; `apps/stage-tamagotchi/src/main/windows/main/query.ts:12`; todo 5 store methods.
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/renderer/libs/perf/window-usage-sampler` (or the browser project if the renderer test setup requires it) passes with a fake rAF/clock: 300 frames at 16.7 ms -> one pull with 300 frames in the 15-18 bin; an active MMD drain suppresses the own rAF; `stop()` cancels rAF and observers (counts zero callbacks afterwards); a structural no-growth test for the rAF callback path (100,000 frames, same typed-array identities); disabled state starts no rAF, observer or timer. `pnpm verify` green.
  QA scenarios: happy - rerun todo 10's happy command with `--perf-dir <attemptDir>/task-11-perf`; PASS when parsed raw has >= 6 `window-rollup` lines for `stage-main` with `tags.renderer === 'mmd'`, `frames > 200`, non-null `stages`. Privacy canary (failure path): set the model directory name and the chat text to a sentinel by copying the rig to `<attemptDir>/canary-PERFCANARY-dir/` and `--say "PERFCANARY hello"`; PASS when `rg -c PERFCANARY <attemptDir>/task-11-perf` finds 0 matches outside `traces/`. Evidence `<attemptDir>/task-11-perf-tracking.txt`.
  Commit: Y | feat(stage-tamagotchi): sample stage windows for perf recording

- [x] 11F. Carry renderer model-load and feature-change events through the pull contract
  Recommended task executor category: unspecified-high - one contract field, renderer emit points, main write-through.
  What to do: extend `perfRecordingPullRollup`'s result in `apps/stage-tamagotchi/src/shared/eventa/perf-recording.ts` with `events: { name: 'model-load' | 'feature-change', detail: Record<string, string | number | boolean | null> }[]` (todo 1 `event` detail shape; no free text, model names only through `sanitizeModelName`); the renderer bridge (todo 11) queues `model-load` when the stage's display model finishes loading (including a reload of the same model) and `feature-change` when `featureHash` changes, and drains the queue into the next pull; main (todo 10) strips `events` from the rollup payload and writes each as an `event` line (with `window`) in the same tick's single append, after the rollups.
  Also (todo 11 gate notes): main overwrites each pulled rollup's `tags.display.refreshHz` with the window's display `displayFrequency` (`screen.getDisplayMatching(win.getBounds())`), so a frame-rate drop never moves a window into another cell; the renderer emits `perfRecordingRendererReload` without its own 2 s debounce (main keeps its 2 s debounce).
  Acceptance criteria: node tests on both sides (renderer queue drains once; main writes events after rollups in one append); `pnpm -F @proj-airi/stage-tamagotchi typecheck` clean; `pnpm verify` green; live: in the combined todo 10+11 QA run, the raw file holds a `model-load` event for `stage-main`, the reducer excludes the 20 s after it, and `tags.display.refreshHz` equals the display-reported rate, or 0 (documented as unknown) where the platform reports none (Electron reports 0 under Wayland/KWin headless).
  Commit: Y | feat(stage-tamagotchi): carry renderer model-load and feature-change events into perf records

- [x] 12. Add the "Record performance" toggle to Settings > System > Developer
  Recommended task executor category: visual-engineering - settings UI copying an existing toggle, with i18n.
  What to do: In `apps/stage-tamagotchi/src/renderer/pages/settings/system/developer.vue` add a `CheckBar` bound to `perfRecordingGet`/`perfRecordingSetEnabled`/`perfRecordingChanged` like the IO-trace toggle (:11-53), disabled while busy or when `source === 'env'` (the description then reads "Controlled by AIRI_PERF_RECORD for this session"), plus a read-only line with the perf directory and build mode. English strings only, in `packages/i18n/src/locales/en/tamagotchi/settings.yaml` in a new `performance-recording` block next to the IO-tracer keys (:1248-1255): `title` "Record performance", `description` "Saves CPU, memory and frame timing every 5 seconds for pnpm perf. On by default in development builds.", `env-controlled`, `directory`. Main side (todo 10): `perfRecordingSetEnabled` always persists the stored choice, but while an env override is active the returned state keeps `enabled` from the env and `source: 'env'`.
  Must NOT do: no other locales; keep the page's `<route>` meta.
  Closes: GAP-1
  Parallelization: Wave 2 | Blocked by: 10 | Blocks: 21
  References: `developer.vue:11-53`; `packages/i18n/AGENTS.md`; `packages/i18n/src/locales/en/tamagotchi/settings.yaml:1248-1255`; `DESIGN.md`; `.agents/skills/enforce-rules-for-unocss/SKILL.md`; browser test setup `apps/stage-tamagotchi/vitest.config.ts` (browser project).
  Acceptance criteria: a browser test for the toggle with mocked Eventa invokes: clicking calls `perfRecordingSetEnabled({ enabled: false })` and reflects the returned state; `source: 'env'` renders the toggle disabled with the env description; `pnpm -F @proj-airi/stage-tamagotchi typecheck` clean; `pnpm verify` green.
  QA scenarios: happy - `pnpm qa:display run -- pnpm qa:app run --model "$AIRI_QA_MMD_MODEL" --say hello --expect turn --perf-dir <attemptDir>/task-12-perf --keep-open --out <attemptDir>/task-12-app`, then over the app's CDP port (from `<attemptDir>/task-12-app/app.log`) open the settings window route `/settings/system/developer` and capture a screenshot with the agent-browser Electron skill (`.agents/skills/agent-browser-electron/SKILL.md`); PASS when it shows "Record performance" checked, disabled, with the env description and the perf directory line. failure - from that settings window invoke `perfRecordingSetEnabled({ enabled: false })` through CDP `Runtime.evaluate`; PASS when the returned state is `enabled: true, source: 'env'`, the stored perf-recording config in the temp profile (path per `createConfig` in `apps/stage-tamagotchi/src/main/libs/electron/persistence`) holds `enabled: false`, and recording continues (new `sample` lines keep arriving). Interrupt the keep-open run afterwards and confirm teardown. Evidence `<attemptDir>/task-12-*.png`, `<attemptDir>/task-12-perf-tracking.txt`.
  Commit: Y | feat(stage-tamagotchi): add a performance recording toggle to developer settings

- [x] 13. Add manual Chromium trace capture in Settings > System > Developer
  Recommended task executor category: unspecified-high - Electron contentTracing in main plus a settings control.
  What to do: `apps/stage-tamagotchi/src/main/services/airi/perf-recording/trace.ts`: class `PerfTraceCapture` with injected `contentTracing`, `directory` (`<perf dir>/traces`), `now`, `setTimeout`; `capture(seconds = 10)`: refuse when capturing; `getCategories()`; `startRecording({ included_categories: <intersection of ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink', 'cc', 'gpu', 'v8', 'toplevel', 'electron'] with available>, recording_mode: 'record-until-full', trace_buffer_size_in_kb: 65536 })`; wait; `stopRecording(join(dir, '<ISO>.json'))`; keep newest 5; set the recorder's `chromiumTrace` flag and write `trace-start`/`trace-stop` events. Register `perfTraceCapture`/`perfTraceState` with the same window registrations as todo 10 (`windows/settings/rpc/index.electron.ts`, `windows/main/rpc/index.electron.ts`), so the settings window that hosts the button can invoke it. UI: a "Capture Chromium trace (10 s)" button, state, last file path and the note "Local only: traces can contain URLs. Open in Perfetto or chrome://tracing." in `developer.vue` next to the todo 12 toggle; English i18n keys in the same block.
  Must NOT do: no automatic capture; no change to `performance-visualizer.vue` or its tracing.
  Closes: GAP-8
  Parallelization: Wave 2 | Blocked by: 9, 10 | Blocks: 21
  References: `electron.d.ts:7137-7209` (startRecording :7192, stopRecording :7209, getCategories :7168), `TraceConfig` :14834-14883 (`trace_buffer_size_in_kb`); `apps/stage-tamagotchi/src/renderer/pages/devtools/performance-visualizer.vue:28-30,:53-57` (existing tracing - leave untouched).
  Acceptance criteria: node tests with a fake contentTracing: category intersection, buffer size set, concurrent refusal, newest-5 retention, flag set and cleared; `pnpm verify` green.
  QA scenarios: happy - `pnpm qa:display run -- pnpm qa:app run --model "$AIRI_QA_MMD_MODEL" --say hello --expect turn --perf-dir <attemptDir>/task-13-perf --keep-open --out <attemptDir>/task-13-app` (todo 9 flag turns recording on); attach to the app's CDP port from `<attemptDir>/task-13-app/app.log` with the agent-browser Electron skill (`.agents/skills/agent-browser-electron/SKILL.md`), open the settings window at `/settings/system/developer` and click "Capture Chromium trace (10 s)"; PASS when after 15 s `<attemptDir>/task-13-perf/traces/*.json` (> 10 KB) parses as JSON with `traceEvents` and the raw samples inside the 10 s window have `chromiumTrace: true`. failure - click the button twice within 1 s; PASS when the UI shows the "already capturing" error and exactly one new trace file exists. Interrupt the keep-open run and confirm teardown. Evidence `<attemptDir>/task-13-perf-tracking.txt` plus a screenshot `<attemptDir>/task-13-ui.png`.
  Commit: Y | feat(stage-tamagotchi): capture chromium traces from developer settings

- [x] 10F. Close the recording session cleanly when the app is interrupted
  Recommended task executor category: deep-low - shutdown path diagnosis in the main process.
  What to do: the todo 13 gate's live run interrupted `qa:app --keep-open` with SIGINT and the recorder left `raw/<session>.live` and wrote no `recording-stop` (todo 10's executor run did not). Reproduce it (several interrupts, SIGINT and SIGTERM to the qa:app process), find why `dispose()` does not complete (quit hooks not reached, process killed before the async append/unlink, in-flight pull), and make the main-process shutdown path finish the session: `recording-stop` appended and `.live` removed on app quit, SIGINT and SIGTERM, bounded by a short timeout. A hard kill still leaves `.live` by design (todo 15 recovers it).
  Acceptance criteria: a node test for the shutdown ordering; live: 3 consecutive `qa:app --perf-dir --keep-open` runs interrupted with SIGINT each leave no `.live` and end with `recording-stop`; `pnpm verify` green.
  Commit: Y | fix(stage-tamagotchi): finish perf recording sessions on interrupted shutdown

- [x] 13F. Fix the todo 13 gate notes on trace capture
  Recommended task executor category: quick - four small fixes in trace capture code.
  What to do: (a) `developer.vue` loads the current trace state on mount (capturing, last file) instead of waiting for the next `perfTraceState` event - add a `perfTraceState`-shaped invoke or include it in `perfRecordingGet`; (b) the trace-changed flag (`perf-recording/index.ts` ~:135) only arms while a session is active, so the next session's first sample is not marked `chromiumTrace: true`; (c) clamp `seconds` from the renderer to [1, 30] at the main boundary; (d) when `stopRecording` throws, retry it once and report the failure; (e) make the refusal test fail by assertion, not by timeout; (f) group the perf controls in `developer.vue` (record toggle, directory line, trace button and status) into one section instead of loose text between cards (todo 12 gate note).
  Acceptance criteria: node tests for (b)-(d) and the browser test for (a); `pnpm verify` green.
  Commit: Y | fix(stage-tamagotchi): load trace state on open and bound trace capture inputs

- [x] 13G. Gzip Chromium traces after capture (owner decision 2026-11-14: gzip, keep 5)
  Recommended task executor category: unspecified-low - streaming compression in the trace service.
  What to do: after `stopRecording` writes `<ISO>.json`, stream it through `node:zlib` gzip to `<ISO>.json.gz` (async, never blocking the main thread; no new dependency), delete the plain file only after the gzip finished, and keep the newest 5 `.json.gz` (a leftover plain `.json` from a crash is compressed or pruned on the next capture). The UI path and the "Open in Perfetto or chrome://tracing" note point at the `.json.gz` (Perfetto opens gzip directly). The `chromiumTrace` flag stays tied to recording, not to compression.
  Acceptance criteria: node tests with a fake fs/zlib for ordering (plain file removed only after a successful gzip; failure keeps the plain file and reports it) and retention by `.json.gz`; live: one capture yields a `.json.gz` that gunzips to JSON with `traceEvents`, no plain `.json` left, size reported in the evidence; `pnpm verify` green.
  Commit: Y | feat(stage-tamagotchi): gzip chromium traces after capture

### Wave 3 - overhead, retention, incidents, report

- [x] 14. Prove the recorder's overhead with an independent instrument before building on it
  Recommended task executor category: deep-low - a measurement mode modeled on an existing pairs runner.
  What to do: Add `qa:stage measure --perf-ab` in `packages/qa-tools/src/stage/` modeled on `measurePairs` (`measure.ts:620-648`): N=3 interleaved pairs, each pair launches the app twice with the same seeded profile and an MMD model (window host), alternating `AIRI_PERF_RECORD=0` and `AIRI_PERF_RECORD=1` (+ `AIRI_PERF_DIR=<run>/perf`) instead of alternating host modes; each launch takes its own exclusive lease like `measure.ts:654-700`; measure with `measureStage`/`FrameMeasurement` (`measure.ts:578-600`, `frame-metrics.ts:6-16`) - fps, p95 frame - and app CPU from `/proc/<pid>/stat` utime+stime summed over the app process tree at the start and end of the measured window (Linux; elsewhere print unsupported and exit 2). Output one JSON with every pair and median deltas.
  Must NOT do: no change to `stage-frame-budget` or any gate; IS-2 is never relaxed.
  Closes: (proves IS-2)
  Parallelization: Wave 3 | Blocked by: 9, 10, 11 | Blocks: 15, 16, 21
  References: `packages/qa-tools/src/stage/measure.ts:578-700` (`measureStage`, `measurePairs` at :620, exclusive lease, exits 2/3 at :612-616); `packages/qa-tools/README.md:770-772,:1297-1314`; `packages/qa-tools/src/stage/preflight.ts:67-73` (exclusive refused under a live lease).
  Acceptance criteria: unit tests for the /proc stat parser and pair aggregation; the live run below.
  QA scenarios: happy - `pnpm qa:display run -- pnpm qa:stage measure --perf-ab --pairs 3 --profile <seeded profile with Chisa selected> --seconds 60 --out <attemptDir>/task-14-ab.json`; PASS when median added app CPU <= 1% of one core and median fps and p95 deltas are within the pair spread (report the band). If not, open a new `- [ ] N.` row to cut overhead before todo 15 starts. failure - run with recording forced the same in both arms (`--perf-ab-control`, both '1'); PASS when deltas are within the same band (no arm-order bias). Evidence `<attemptDir>/task-14-perf-tracking.txt`.
  Commit: Y | feat(qa-tools): measure perf recorder overhead with interleaved stage pairs

- [x] 15. Add crash-safe segment rollups and retention
  Recommended task executor category: deep-low - file lifecycle rules fully specified; reducer exists.
  What to do: `apps/stage-tamagotchi/src/main/services/airi/perf-recording/retention.ts`: class `PerfRetention` with injected `{ directory, now, fs, isPidAlive, setTimer }`, run 30 s after app start and then hourly, also when recording is off.
  - Rollup pass: a raw segment is closed when a later segment of the same session exists, or its session has no `.live` file, or the `.live` pid is dead (stale `.live` removed). Read `sessions.jsonl` keys (sessionId, segment). For each closed segment without a row: create `raw/<sessionId>.<segment>.rollup.lock` with flag `wx` (skip if present and < 10 min old; remove and retry if older), stream lines with `readline` into `SegmentRollupReducer` (count malformed and unknown-version lines), `finish({ endedAt: last t, recovered: no recording-stop and not followed by another segment })`, append one row to `sessions.jsonl`; on reducer exception append a `rollup-failed` row; remove the lock.
  - Prune pass: delete raw segments started more than 14 days ago only when a `segment-rollup` or `rollup-failed` row exists; then while raw total > 1 GiB delete the oldest rolled-up segments (never a live one); delete `incidents/*.json` older than 14 days. `sessions.jsonl` is append-only and never pruned.
  Must NOT do: never delete an un-rolled segment; never rewrite `sessions.jsonl`; no sync fs on the main thread.
  Closes: GAP-5
  Parallelization: Wave 3 | Blocked by: 3, 10, 11, 14 | Blocks: 16, 17, 19
  References: `apps/stage-tamagotchi/src/main/services/airi/io-trace-recording/index.ts:90-100` (start-only prune - this one is hourly too); todos 3 and 10.
  Acceptance criteria: node tests with a temp dir: dead-pid session -> `recovered: true`; two app instances sharing a dir never double-write (lock); 16-day-old rolled-up segment deleted; 16-day-old un-rolled segment rolled up first and deleted only on the next pass; a reducer failure writes `rollup-failed` and the segment becomes prunable; size cap deletes oldest first; `sessions.jsonl` only grows.
  QA scenarios: happy - seed `<attemptDir>/task-15-perf/raw/` with a crafted crashed segment (stale `.live`, pid 999999) and a 16-day-old segment plus its rollup row; run todo 10's happy command with `--perf-dir <attemptDir>/task-15-perf` for 60 s; PASS when `sessions.jsonl` gained a `recovered: true` row for the crashed id, the old raw segment is gone, and its row remains. failure - seed an old segment without a row; PASS when it is rolled up and not deleted in that pass. Evidence `<attemptDir>/task-15-perf-tracking.txt` (before/after listings).
  Commit: Y | feat(stage-tamagotchi): roll up and prune perf segments

- [x] 15F. Close the todo 15 gate's test gaps and the empty-segment row time
  Recommended task executor category: quick - tests plus one timestamp rule in `perf-recording/retention.ts`.
  What to do: (a) a size-cap test that reaches a live segment, so removing the live-segment guard fails; (b) the schedule test asserts the 30 s first delay and the hourly delay it is given; (c) age-boundary tests at exactly 14 days and just under/over; (d) a segment with no readable lines gets a `rollup-failed` row timed from its file mtime (or its session-start if present), not 0, so it is pruned on the normal 14-day schedule; (e) replace the duplicate error-code check in `isPidAlive` (`electron.ts:143`) with `hasErrorCode`.
  Acceptance criteria: each new test fails when its rule is broken (mutate + restore); `pnpm verify` green.
  Commit: Y | test(stage-tamagotchi): pin perf retention boundaries and time empty segment rows

- [x] 16. Detect incidents and write incident files with ring dumps
  Recommended task executor category: deep-high - deciders wired to live data, cross-process pulls with timeouts, caps.
  What to do: In `PerfRecordingService` keep the last 6 ticks' serialized lines in memory and per window/process decider memories (todo 3). Per pulled rollup run `decideFrameStall` (a `rollup-missing` also feeds it); per tick run `decidePegged` per process and `decideMemoryGrowth` per window process (baseline after that window's last `model-load`); pass host contention, `chromiumTrace`, settling, visibility and suspend state; apply `IncidentBudget`; suppressed causes become `incident-suppressed` events. On fire: write `incidents/<id>.json` immediately `{ incident, recent: <last 30 s lines>, frameRing: null, ringMissing: true }` (0o600) and append the `incident` line; then `pullFrameRing()` with a 3 s timeout and, on success, rewrite that incident file once with the ring and `ringMissing: false`.
  Must NOT do: no contentTracing; nothing while recording is off; never block the tick on the ring pull.
  Closes: GAP-7
  Parallelization: Wave 3 | Blocked by: 3, 8, 9, 10, 11, 14, 15 | Blocks: 18, 21
  References: todo 3 deciders; todo 8 pull contract; todo 5/11 ring copies.
  Acceptance criteria: node tests with fakes: a 700 ms frame produces one incident file with 6 recent lines and then the ring; a second stall within 10 min -> `incident-suppressed` `cooldown`; stall while host-contended -> suppressed `host-contended`; ring timeout leaves `ringMissing: true`.
  QA scenarios: happy - `pnpm qa:display run -- pnpm qa:app run --model "$AIRI_QA_MMD_MODEL" --say hello --expect turn --perf-dir <attemptDir>/task-16-perf --keep-open --out <attemptDir>/task-16-app`; after 90 s (past settling), send CDP `Runtime.evaluate` to the stage window target (`#/` page from `http://127.0.0.1:<port>/json/list`) with `(() => { const t = performance.now(); while (performance.now() - t < 700) {} })()`; PASS when within 10 s `<attemptDir>/task-16-perf/incidents/*.json` has `trigger: 'frame-stall'`, `ringMissing: false` and a ring whose max interval >= 650 ms. failure - repeat the evaluate 45 s later; PASS when no second incident file appears and the raw file has an `incident-suppressed` event with reason `cooldown` (repeat the evaluate at least 45 s after the first so the first episode has cleared after 6 clean rollups). Interrupt the keep-open run and confirm teardown. Evidence `<attemptDir>/task-16-perf-tracking.txt`.
  Commit: Y | feat(stage-tamagotchi): capture perf incidents with frame ring dumps

- [x] 17. Add the `pnpm perf` CLI core: data dirs, reading, `sessions` and `incident`
  Recommended task executor category: unspecified-high - new CLI under qa-tools conventions with cross-platform paths.
  What to do: `packages/qa-tools/src/perf/` (`args.ts`, `dirs.ts`, `read.ts`, `sessions.ts`, `incident.ts`, `format.ts`, tests) and `packages/qa-tools/bin/perf.ts`; root `package.json` script `"perf": "node --import tsx packages/qa-tools/bin/perf.ts"` (scripts only).
  - `dirs.ts` (pure, platform passed in): Linux `$XDG_CONFIG_HOME` (default `~/.config`) + `/@proj-airi/stage-tamagotchi/perf` (dev; matches the observed `~/.config/@proj-airi/stage-tamagotchi/logs`) and the packaged userData from todo 7's probe; macOS `~/Library/Application Support/@proj-airi/stage-tamagotchi/perf` and the packaged path; Windows `%APPDATA%` equivalents. `--dir <path>` (repeatable) replaces the defaults.
  - `read.ts`: stream `sessions.jsonl` and `raw/*.jsonl` through `parsePerfLine`; count malformed and unknown-version lines per file; dedupe rows by (sessionId, segment); segments without a row (live or not yet rolled up) are reduced in memory with `SegmentRollupReducer`; the CLI never writes into data dirs.
  - `sessions [--since 7d] [--json]`: one row per session (segments merged): start, duration, short sha (+`*` dirty, `~n` epochs), renderer/model, median fps, share >= 36 ms and >= 100 ms, stage-window CPU %, max working set, incidents, `recovered`, `live`.
  - `incident --list | <id> [--json]`.
  - Exit codes: 0 ok (including "no perf data"), 2 invalid arguments or unknown ids; a reported regression elsewhere is exit 0 with a `verdict` field.
  Closes: GAP-6
  Parallelization: Wave 3 | Blocked by: 1, 15 | Blocks: 18, 19, 20
  References: `packages/qa-tools/bin/app.ts`, `src/app/args.ts` (parseArgs + Valibot + usage error); `scripts/dev-tools/verify-history.ts:58,:126` (malformed counting, `--since`); `packages/qa-tools/AGENTS.md` (exit codes); `.agents/skills/analyze-io-traces/SKILL.md` (per-platform data dirs).
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/perf` passes with fixture dirs (two hosts, a malformed line, a `v: 2` line, an un-rolled live session); `pnpm perf sessions --dir <fixture> --json` length equals the fixture's sessions; `pnpm perf --bogus` exits 2.
  QA scenarios: happy - `pnpm perf sessions --dir <attemptDir>/task-15-perf --json` lists the recovered session with `recovered: true` and the just-run session with non-null numbers; failure - `pnpm perf sessions --dir /nonexistent` prints "no perf data" and exits 0, `pnpm perf incident nope` exits 2. Evidence `<attemptDir>/task-17-perf-tracking.txt`.
  Commit: Y | feat(qa-tools): add pnpm perf sessions and incident reports

- [x] 16F. Make pegged relative to the window's settled baseline and dedupe re-queued recent lines
  Recommended task executor category: deep-low - one decider rule in stage-shared plus one buffer fix in the recorder.
  What to do: (a) every MMD session fired `pegged` at ~60 s because the stage renderer normally runs at ~101% of a core (todo 16 gate, two independent runs), burning 1 of 6 hourly incidents per session. Change `decidePegged` (`packages/stage-shared/src/perf/usage/incidents.ts`) to fire only when cpuPctOfCore >= 90 for 6 consecutive samples AND >= the process's settled baseline (median of its samples in minutes 2-5 after session start or its window's last model-load) + 25 points; before a baseline exists it does not fire; keep clear/cooldown rules; the recorder passes the baseline. (b) `incident-capture.ts:143` with `index.ts:315`: lines re-queued after a failed append must not be added to the recent buffer twice. Orchestrator decision 2026-11-14, reversible.
  Acceptance criteria: decider tests: steady 101% with baseline 100 -> no fire; jump from baseline 40 to 95 for 6 samples -> fire; no baseline yet -> no fire; recorder test: failed append then incident -> no duplicate lines in recent; live: a 3-minute MMD qa:app session writes no pegged incident; `pnpm verify` green.
  Commit: Y | fix(stage-shared): measure pegged processes against their settled baseline

- [x] 18. Add `pnpm perf features` and usage `compare` with lease contention
  Recommended task executor category: deep-low - wires todo 4 statistics into the CLI with a history join.
  What to do: `packages/qa-tools/src/perf/features.ts`, `compare.ts`: `features [--feature <key>] [--metric ...] [--seed 1] [--json]` runs `compareFeature` and prints per stratum the side counts, medians, IQR, difference, CI, Cliff's delta, verdict and `observational`; `compare <shaA> <shaB> [--include-dirty] [--json]` prints per-stratum medians for two commits' usage sessions (dirty excluded unless the flag; labelled observational; points to `--bench`). Before analysis set each cell's `leaseContended` to true/false when cpu-slots history (`packages/cpu-slots/src/history.ts:38-50,:179`, `readHistory`) covers the window's time with a lease from another worktree `cwd`, and null when the history does not cover that time (it rotates at 5 MB, `history.ts:52-60`).
  Closes: GAP-6
  Parallelization: Wave 3 | Blocked by: 4, 16, 17 | Blocks: 21
  References: todo 4 API; `packages/cpu-slots/src/history.ts`; `packages/qa-tools/package.json:33` (cpu-slots is already a workspace dependency).
  Acceptance criteria: tests with synthetic rollups: a 4 ms shift on `mmdPhysics` -> `difference`; too few sessions -> `insufficient` with counts; an overlapping lease marks cells `leaseContended: true` and drops them; uncovered time -> null; `compare` excludes dirty by default.
  QA scenarios: happy - `pnpm perf features --dir <fixture-with-shift> --feature mmdPhysics` prints `difference` and `observational`; failure - `pnpm perf features --dir <attemptDir>/task-15-perf` prints `insufficient data` with counts and exits 0. Evidence `<attemptDir>/task-18-perf-tracking.txt`.
  Commit: Y | feat(qa-tools): add perf feature and commit comparisons

### Wave 4 - bench and docs

- [x] 2F. Measure host CPU from /proc/stat with iowait as idle on Linux
  Recommended task executor category: deep-low - host CPU source in the recorder plus its pure math.
  What to do: the todo 19 gate measured that `os.cpus()` omits iowait, so on a host with 43-57% iowait `externalCpuPct` reads 1.6-1.8x the true busy share (idle machine 15-25% vs real 9-16%) and the 25% host-contended threshold trips with no outside load. On Linux, read the aggregate `cpu` line of `/proc/stat` (async read, no sync fs on the main thread) and compute busy = user+nice+system+irq+softirq+steal over total including idle and iowait; iowait counts as idle. Keep `os.cpus()` on macOS/Windows. Change the pure math in `packages/stage-shared/src/perf/usage/cpu.ts` (~:61-69) to take the extended times, and the source at `apps/stage-tamagotchi/src/main/services/airi/perf-recording/electron.ts` (~:70). Thresholds unchanged.
  Acceptance criteria: unit tests with fixture /proc/stat deltas (iowait-heavy delta -> low busy; real busy delta -> high); a parse test for the cpu line; live: a 2-minute idle qa:app --perf-dir session on this host reports externalCpuPct within 3 points of an independent /proc/stat measurement taken over the same window, recorded in the evidence; `pnpm verify` green.
  Commit: Y | fix(stage-shared): count iowait as idle when measuring host CPU on linux

- [x] 19. Add `pnpm qa:bench`: scenario matrix, per-launch exclusive leases, recorder-measured runs, history
  Recommended task executor category: deep-high - orchestrates app sessions, leases, QA display and summarization.
  What to do: `packages/qa-tools/src/bench/` (`args.ts`, `matrix.ts`, `run.ts`, `summarize.ts`, `history.ts`, tests) and `packages/qa-tools/bin/bench.ts`; root script `"qa:bench": "node --import tsx packages/qa-tools/bin/bench.ts"`.
  - Matrix `bench-v1`: `mmd-idle` (`AIRI_QA_MMD_MODEL`, window host, 20 s settle, 120 s measured), `mmd-talk` (same rig; three replayed turns from `packages/qa-tools/fixtures/llm/turn-happy.json` through the replay server and `sendMessage`, measured from first send to the last turn's `tts` end event - requires the prerequisite speech-end fix), `live2d-idle` (`AIRI_QA_RIG_FORBOOTH`, 120 s). `--scenario <id>`, `--runs <n>` (default 5, minimum 3). Prints a duration estimate before starting. Scenario windows are sliced by wall-clock timestamps in the raw file, no new IPC.
  - Orchestration: Linux only; refuse with exit 2 outside a `qa:display` session using the same guard `qa:app run` uses (README "Linux host session guard" :785-791). Each launch acquires its own `exclusive` lease like `measure.ts:654-700`; lease timeout exits 3; a missing rig variable or model exits 2 (`measure.ts:612-616`). Each run: fresh temp profile, `AIRI_PERF_RECORD=1`, `AIRI_PERF_DIR=<run dir>/perf`, rig import via `importRig`, settle, measure, teardown.
  - `summarize.ts`: reduce the run's raw file with `SegmentRollupReducer` into one `bench-run` record (todo 1) with `buildMode: 'dev'` (the QA bridge is dev-only, `bin/check-prod-bundle.ts:9-13`), `leaseClass: 'exclusive'`, `modelFingerprint` = sha256 of (basename, byte size, mtime) - never a path; `valid: false` with `invalidReason: 'host-contended'` when any measured sample is contended.
  - `history.ts`: resolve the state dir like `packages/cpu-slots/src/history.ts:38-43` (`AIRI_PERF_BENCH_DIR` > `$XDG_STATE_HOME` or `~/.local/state` on Linux, `%LOCALAPPDATA%` on Windows, `~/Library/Application Support` on macOS) + `airi-perf/bench.jsonl`; append-only, 0o600, never rotated.
  Must NOT do: never run outside an exclusive lease; never write into Luke's profile; no gate wiring.
  Closes: GAP-9
  Parallelization: Wave 4 | Blocked by: 9, 10, 11, 15, 17 | Blocks: 20
  References: `packages/qa-tools/src/app/run.ts` (replay server, `sendMessage`, `importRig`, teardown); `src/session/app-session.ts:23,:105`; `src/t3/launch.ts:21-29,:60-75`; `src/stage/measure.ts:612-616,:654-700`; `packages/cpu-slots/src/acquire.ts:204-207`; `packages/qa-tools/README.md:785-791`; `.env.qa` (`AIRI_QA_MMD_MODEL`, `AIRI_QA_RIG_FORBOOTH`).
  Acceptance criteria: node tests for matrix filtering, `--runs 2` refused, summarize on a fixture raw file, history dir resolution per platform and override, model fingerprint never containing `/`; `pnpm verify` green.
  QA scenarios: happy - `AIRI_PERF_BENCH_DIR=<attemptDir>/task-19-history pnpm qa:display run -- pnpm qa:bench --scenario mmd-idle --runs 3 --out <attemptDir>/task-19-bench`; PASS when `bench.jsonl` has 3 `bench-run` lines with `valid: true`, fps in [20, 240] and the HEAD sha. failure - `pnpm qa:bench --scenario mmd-idle --runs 3` outside qa:display exits 2 with the host-session refusal and writes nothing. Evidence `<attemptDir>/task-19-perf-tracking.txt`.
  Commit: Y | feat(qa-tools): add qa:bench with recorder-measured scenario runs

- [x] 20. Add `pnpm perf bench` and `pnpm perf compare --bench`
  Recommended task executor category: unspecified-low - CLI glue over todos 4 and 19.
  What to do: `packages/qa-tools/src/perf/bench.ts`: `bench [--scenario] [--since] [--json]` lists runs grouped by (sha, diffHash) with per-metric medians; `compare --bench <refA> <refB> [--scenario <id>] [--metric <m>] [--json]` where a ref is a sha, `HEAD`, or `worktree` (current sha + current diffHash), runs `compareBench` with trailing history and prints every run value, sigma, the practical floor, the verdict, `lowConfidence`, refusals with reasons and `stale`.
  Closes: GAP-9
  Parallelization: Wave 4 | Blocked by: 4, 19 | Blocks: 21
  References: todo 4 `compareBench`; todo 19 history reader.
  Acceptance criteria: tests with a fixture history: 3-sigma regression 5/5 -> `regression`; host mismatch -> refused; a ref with no runs -> exit 2 "no bench runs for <ref>"; `worktree` resolves to (sha, diffHash).
  QA scenarios: happy - run todo 19's happy command a second time, then `AIRI_PERF_BENCH_DIR=<attemptDir>/task-19-history pnpm perf compare --bench HEAD HEAD --scenario mmd-idle`; PASS when the verdict is `within-noise`, `lowConfidence: true`, and six run values print. failure - compare against a sha with no runs; PASS on exit 2 and the message. Evidence `<attemptDir>/task-20-perf-tracking.txt`.
  Commit: Y | feat(qa-tools): compare bench runs across commits

- [x] 21. Document the perf recorder, report and bench with an ADR
  Recommended task executor category: writing - documentation across five files plus an ADR.
  What to do: (a) `docs/ai/adr/2026-11-14-usage-performance-recording.md`: context (inventory: IO traces, lag sampler, MMD metrics, qa:stage), the owner decisions of 2026-11-14 (recorder then bench, on in dev + toggle, raw 14 d + rollups forever, ring-buffer incidents + manual trace, bench store in the per-machine state dir, on-demand bench, Electron only, TDD for pure parts), the CPU delta rule, identity epochs, host vs lease contention, the statistics method and its observational label, privacy and the traces exemption, retention and segments, QA opt-out, the overhead result from todo 14, why `pnpm perf` lives in qa-tools (`qa:report` precedent, no root dependency change), macOS and Windows limitations, consequences. (b) `packages/qa-tools/README.md`: `pnpm perf` and `pnpm qa:bench` sections (commands, data dirs, `--dir`, exit codes, reading `features`/`compare` honestly), `qa:stage measure --perf-ab`, and the `AIRI_PERF_RECORD=0` default for QA launches. (c) `apps/stage-tamagotchi/README.md`: perf recording (toggle, dev default, dev-only `AIRI_PERF_RECORD`/`AIRI_PERF_DIR`, data layout, trace capture). (d) `packages/stage-shared/README.md` `perf/usage` entry current. (e) `docs/ai/testing.md`: a "Checks by change type" row "Performance-sensitive runtime change -> optionally `pnpm qa:display run -- pnpm qa:bench` at base and tip, then `pnpm perf compare --bench <base> <tip>`" and a tool reference line.
  Must NOT do: no AGENTS.md or skill edits (todo 22).
  Closes: GAP-11
  Parallelization: Wave 4 | Blocked by: 12, 13, 14, 16, 18, 20 | Blocks: 22
  References: `docs/ai/adr/2026-11-12-idle-agency.md` (ADR format); `docs/ai/testing.md:27-45`; root AGENTS.md "UNIQUE STYLES".
  Acceptance criteria: `pnpm verify` green; every documented command runs (`pnpm perf --help`, `pnpm qa:bench --help`, `pnpm qa:stage measure --help`) and exits as documented.
  QA scenarios: happy - run each documented command against todo 15/19 evidence dirs, outputs in `<attemptDir>/task-21-perf-tracking.txt`; failure - `rg -n "percentCPUUsage" docs packages/qa-tools/README.md apps/stage-tamagotchi/README.md` shows only "do not use" mentions, and `rg -n "/home/|/opt/|/Users/" ` over the changed docs returns 0. Evidence same file.
  Commit: Y | docs: document usage performance recording, pnpm perf and qa:bench

- [x] 22. Route agents to the perf tooling (separate agent-config commit)
  Recommended task executor category: quick - two guidance files, exact lines given.
  What to do: root `AGENTS.md`: TASK ROUTING row "Performance history, heavy features, incidents, perf regressions between commits | [qa-tools README](packages/qa-tools/README.md#pnpm-perf)"; COMMANDS lines `pnpm perf sessions | features | compare | incident    # Usage performance records and bench comparisons` and `pnpm qa:display run -- pnpm qa:bench [--scenario <id>] [--runs <n>]   # Recorder-measured scenario matrix, exclusive lease per launch`. `apps/stage-tamagotchi/AGENTS.md` ANTI-PATTERNS: "Do not read `percentCPUUsage` from `app.getAppMetrics()`; other callers share its interval. The perf recorder diffs `cumulativeCPUUsage`."
  Must NOT do: no other guidance edits; no regeneration.
  Closes: GAP-11 (agent routing)
  Parallelization: Wave 4 | Blocked by: 21 | Blocks: F1-F4
  References: root `AGENTS.md` TASK ROUTING and COMMANDS; `apps/stage-tamagotchi/AGENTS.md` ANTI-PATTERNS; AGENTS policy (agent configuration in a separate commit).
  Acceptance criteria: `pnpm verify` green; `git show --stat HEAD` lists only the two AGENTS.md files.
  QA scenarios: happy - `rg -n "pnpm perf" AGENTS.md` returns the new lines; failure - `git show --stat HEAD` shows no non-guidance file. Evidence `<attemptDir>/task-22-perf-tracking.txt`.
  Commit: Y | docs(agents): route agents to perf recording and bench tooling

- [x] 4G. Close the F2 code-review blocker and two cheap notes
  Recommended task executor category: quick - one test fixture fix, one doc comment, one dead computation.
  What to do: (a) `packages/stage-shared/src/perf/usage/compare-bench.test.ts:126`: give `dirtyHistory` runs `t: T0 - DAY` so they would enter history by time and the test proves the `run.dirty` exclusion at `compare-bench.ts:163`; (b) `apps/stage-tamagotchi/src/main/app/exit.ts:16`: the doc comment must say Electron does not quit on SIGTERM once a Node listener exists (srvx and index.ts add one), which is why AppExit handles both signals; (c) `window-usage-sampler.ts:132,212`: stop the renderer's unused refreshHz work (main overwrites it from displayFrequency) and the MMD frame-ring copy it needs; fix the doc comment.
  Acceptance criteria: removing the `run.dirty` check makes the fixed test fail (mutate + restore); sampler tests still pass; `pnpm verify` green.
  Commit: Y | test(stage-shared): prove dirty bench history stays out of the noise pool

- [x] 18F. Mark lease contention per 5-minute bucket and log lease reaps (owner decision 2026-11-14: per 5-min bucket)
  Recommended task executor category: deep-high - record contract change across stage-shared, the recorder, qa-tools and cpu-slots.
  What to do: F4 found lease contention is marked per whole segment (hours), so on this host (other worktrees hold leases ~62% of the time) 96-100% of real segments read contended and `pnpm perf features`/`compare` drop all daily-use data. (a) Segment rollup cells gain 5-minute time buckets: `SegmentRollupReducer` (packages/stage-shared/src/perf/usage) splits each cell's counted windows into wall-clock buckets of 5 min, each with its own frames, windows, histograms/quartile inputs and time span, versioned record contract (old rows still readable as one bucket spanning the segment, documented). (b) qa-tools `lease.ts` marks each bucket true/false/null by overlap with foreign leases and `features`/`compare` drop only contended buckets; fps and other metrics aggregate over kept buckets. (c) packages/cpu-slots history: write a reap event (with the reclaimed lease id, pid, cwd, heldMs) when the broker reclaims a dead holder's lease, and teach `lease.ts` to end a lease at its reap event, so buckets after a reaped grant read false, not null. (d) Update the ADR and qa-tools README sections that describe lease contention and cell timing.
  Acceptance criteria: reducer tests (bucket boundaries, a window spanning a boundary, old-version row read as one bucket); lease tests (bucket overlap true/false/null; reap event ends the lease); cpu-slots test that reaping writes the event; replay the real lease history against a fixture of an 8 h session: the kept share is reported and > 0; `pnpm perf features` on that fixture reaches a verdict; a live 6-minute qa:app --perf-dir session writes bucketed rollups that `pnpm perf sessions` reads; `pnpm verify` green.
  Commit: Y | feat(qa-tools): mark lease contention per five-minute bucket

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Recommended task executor category: unspecified-high - read-only audit of every todo's acceptance criteria and guardrails against the branch diff.
  Every todo's acceptance criteria and evidence files exist and match; every Must NOT have holds (`git diff main...HEAD --stat` shows no `apps/stage-web/**`, no lockfile, no root dependency change, no non-English locale, no gate or `motion-diagnostics` snapshot field change, no change to `performance-visualizer.vue` tracing; `rg -n "percentCPUUsage" apps packages` only in comments/docs that forbid it).
- [x] F2. Code quality review
  Recommended task executor category: unspecified-high - independent review against repo TypeScript, Vitest and Eventa rules.
  Review against `.agents/skills/enforce-rules-for-typescript`, `enforce-rules-for-vitest`, `eventa`; no `any`, no suppressed errors, deciders explicit-time, classes for stateful modules, Valibot near consumers, NOTICE format for workarounds; `pnpm verify --gate` green.
- [x] F3. Real manual QA
  Recommended task executor category: unspecified-high - live app QA in a QA display session.
  In `pnpm qa:display run -- ...`: `pnpm qa:smoke --model "$AIRI_QA_MMD_MODEL"` passes (QA opt-out keeps the gate identical); a 5-minute `qa:app --perf-dir` session followed by `pnpm perf sessions --dir --json` shows it with non-null numbers; the toggle, trace and stall-incident scenarios of todos 12, 13 and 16 re-run green; `pnpm qa:bench --scenario mmd-idle --runs 3` and `pnpm perf compare --bench HEAD HEAD` run green; the privacy canary of todo 11 finds 0 matches.
- [x] F4. Ideal-state fidelity
  Recommended task executor category: unspecified-high - maps delivered behavior to IS-1..IS-12 one by one.
  For each IS row, cite the evidence file that proves it (Success criteria table); any shortfall becomes a new `- [ ] N.` todo, never a note. macOS rows are proven by fixtures and pure resolvers only and are reported as such.

## Commit strategy
- Conventional Commits matching `git log` (`feat(<package>): ...`, `docs: ...`, `docs(agents): ...`), lowercase imperative, one logical change each; each todo's Commit line is the exact subject. Todo 7 makes no commit.
- Each commit passes `pnpm verify`; the branch passes `pnpm verify --gate` and `pnpm qa:display run -- pnpm qa:smoke` before the PR.
- Documentation lands with its code (todo 1 README entry, todo 9 qa:app flag row, todo 14 README row, todo 21 docs); the agent-guidance change is its own commit (todo 22).
- Final commit footer: `Plan: .omo/plans/perf-tracking.md`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 6, 8, 10, 12 | todo 6 resolver table (dev default, env, stored, preview); todo 10 happy (recording with `--perf-dir`); todo 12 toggle persisted | <attemptDir>/task-6-perf-tracking.txt, task-10-perf-tracking.txt, task-12-perf-tracking.txt |
| IS-2 | 5, 11, 14 | todo 5 and 11 structural no-growth tests; todo 14 interleaved off/on pairs with the independent instrument | <attemptDir>/task-5-perf-tracking.txt, task-11-perf-tracking.txt, task-14-perf-tracking.txt |
| IS-3 | 1, 6, 10, 11 | todo 10 happy (`session-start` + `identity` with runtime git); todo 11 happy (tags on rollups); todo 3 epoch split test | <attemptDir>/task-10-perf-tracking.txt, task-11-perf-tracking.txt, task-3-perf-tracking.txt |
| IS-4 | 2, 10 | todo 2 role table; todo 10 happy (`window:stage-main` with cumulative-delta CPU) and DevTools label test | <attemptDir>/task-2-perf-tracking.txt, task-10-perf-tracking.txt |
| IS-5 | 3, 10, 15 | todo 15 happy (recovered segment, old raw pruned, row kept) + failure (un-rolled kept); todo 10 segment rotation test | <attemptDir>/task-15-perf-tracking.txt, task-10-perf-tracking.txt |
| IS-6 | 17, 18, 20 | todo 17, 18 and 20 happy/failure | <attemptDir>/task-17-perf-tracking.txt, task-18-perf-tracking.txt, task-20-perf-tracking.txt |
| IS-7 | 3, 16 | todo 16 happy (700 ms stall -> incident with ring) + failure (cooldown) | <attemptDir>/task-16-perf-tracking.txt |
| IS-8 | 13 | todo 13 happy (trace file, `chromiumTrace` flag) + failure (concurrent refusal) | <attemptDir>/task-13-perf-tracking.txt |
| IS-9 | 19, 20 | todo 19 happy (3 valid bench rows in the history store) + todo 20 happy (`within-noise`, `lowConfidence`) | <attemptDir>/task-19-perf-tracking.txt, task-20-perf-tracking.txt |
| IS-10 | 1, 11 | todo 1 `sanitizeModelName`; todo 11 privacy canary (0 sentinel hits outside `traces/`) | <attemptDir>/task-1-perf-tracking.txt, task-11-perf-tracking.txt |
| IS-11 | 21, 22 | todo 21 happy (documented commands run) + todo 22 happy (routing lines, guidance-only commit) | <attemptDir>/task-21-perf-tracking.txt, task-22-perf-tracking.txt |
| IS-12 | 9 | todo 9 default env test + todo 10 failure (QA launch without `--perf-dir` records nothing) + F3 `qa:smoke` | <attemptDir>/task-9-perf-tracking.txt, task-10-perf-tracking.txt |
