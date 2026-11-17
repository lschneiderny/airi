---
slug: perf-tracking
status: approved-reviewed
intent: clear
review_required: true
plan_path: .omo/plans/perf-tracking.md
plan_sha256: da04cb653ceb5a03aa1b09853eb83f9500d65248384d4fb7e3852c01870dc25c
review_round_id: r2
review_round_limit: 5
pending-action: none - hand off to /ulw-execute perf-tracking
review:
  plan_reviewer:
    status: approved
    workspace_root: /mnt/dev/projects/dtuber
    runtime_home: null
    target: .omo/plans/perf-tracking.md
    round_id: r2
    plan_sha256: da04cb653ceb5a03aa1b09853eb83f9500d65248384d4fb7e3852c01870dc25c
    launch_id: L-r2
    session: st_01a1da64
    result: OKAY (st_01a1da64, r2; notes applied)
approach: one plan, 4 waves - W1 shared contract + MMD accumulators + build identity (TDD), W2 main recorder + renderer sampler + toggle + trace button, W3 rollups/retention/incidents + pnpm perf report, W4 qa:bench + history + compare + docs; branch luke/feat/perf-tracking + PR to lschneiderny/airi
---

# Draft: perf-tracking

> Status 2026-11-17: complete; frozen history.

## Affected user and ideal state
Users: (U1) Luke running `pnpm dev:tamagotchi` daily on Linux (and packaged builds on his MacBook), wanting a history across commits and answers to "what is heavy"; (U2) coding agents doing optimization/bug work who read `pnpm perf` output (text + `--json`) and run the bench; (U3) the running app itself, whose MMD frame has no idle time (notes/mmd-frame-budget-ammo-wasm2js), so the recorder must not degrade it; (U4) stage-web users of the existing lag overlay (must not regress).

IS-1 | In dev the recorder runs with no action; Settings > System > Developer has a persisted toggle; packaged builds default off | approved decision 2026-11-14
IS-2 | Recording costs < 1% of one core in main + each renderer and adds no per-frame allocation, sort or IPC; stage fps/p95 with recording on equals off within bench noise | MMD frame budget is saturated
IS-3 | Every sample is attributable: commit sha, dirty flag + diff hash (dev), app version, platform, renderer kind, display-model id + name, feature flags, activity mode, visibility, contended | history + feature questions need tags
IS-4 | Per-process CPU and memory are mapped to roles (browser, gpu, utility:<name>, window:<route kind>) | "which window/process is heavy"
IS-5 | Raw JSONL kept 14 days (swept at start AND hourly), session rollups kept forever in a never-pruned file; a crash leaves usable raw data and its rollup is recovered on next start | approved retention; io-trace sweep only runs on enable/start (gap)
IS-6 | `pnpm perf sessions|features|compare|incident|bench|trace` answers in text and `--json`, tolerates malformed lines, reads Linux and macOS data dirs, `--dir` override | humans + agents
IS-7 | Incidents: frame stall, memory growth, pegged process trigger an incident file with the last ~30 s of samples/events, with cooldown, listed by the report | approved: ring-buffer dump
IS-8 | A manual "Capture Chromium trace" control records N seconds via contentTracing into userData/perf/traces and shows the path; documented to open in Perfetto/chrome://tracing | approved: manual trace
IS-9 | Lab bench runs a fixed scenario matrix headless in qa:display on the exclusive lease with a temp profile, measured by the same recorder, appends one tagged record per scenario run to a history store in the git common dir, and `compare` reports deltas against repeated-run noise bands | approved: bench as slice 2
IS-10 | No chat text, prompts, file paths of personal assets, or secrets are stored in perf records | motion-trace precedent: never a personal asset path
IS-11 | Docs: qa-tools README section, docs/ai/testing.md row, stage-tamagotchi README/AGENTS note; agent-config change in its own commit | AGENTS.md conventions
IS-12 | stage-web lag overlay keeps working after the sampler moves to shared code | U4 regression guard

GAP-1 | No recorder service, config, Eventa contract or toggle exists (io-trace-recording is the template) | IS-1 | closed by todos 3,4,7
GAP-2 | No renderer-side 5 s rollup; lag sampler is stage-web only and allocates per frame events; MMDFrameMetrics only read live | IS-2,IS-3 | closed by todos 2,5,6
GAP-3 | No commit/dirty/feature/activity tagging anywhere in the app; unplugin-info gives `~build/git` sha but no dirty flag | IS-3 | closed by todos 1,4,6
GAP-4 | Nothing maps app.getAppMetrics pids to windows (getOSProcessId unused) | IS-4 | closed by todo 4
GAP-5 | No retention for a forever rollup; io-trace sweep has no periodic timer | IS-5 | closed by todos 3,8
GAP-6 | No report CLI | IS-6 | closed by todos 9,10
GAP-7 | No incident triggers | IS-7 | closed by todo 8
GAP-8 | No contentTracing code | IS-8 | closed by todo 7
GAP-9 | Bench runs exist only as one-off evidence folders, no history/compare for perf | IS-9 | closed by todos 11,12
GAP-10 | No docs for any of it | IS-11 | closed by todo 13
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

## Components (topology ledger)
C1 | shared perf record contract (schemas, bins, rollup math) | active
C2 | renderer window rollup samplers (frame histogram, long tasks, heap, MMD stages, tags) | active
C3 | main recorder service (getAppMetrics sampler, JSONL writer, retention, session rollups, toggle) | active
C4 | incidents + manual Chromium trace | active
C5 | `pnpm perf` report CLI | active
C6 | lab bench + history + compare | active
C7 | docs + agent guidance | active
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
- IO trace recording template: apps/stage-tamagotchi/src/main/services/airi/io-trace-recording/index.ts (RETENTION_MS :9, class :17, restore :39, setEnabled :44, recordSpan :60, start :74, prune :90-100, sweep only on start), register.ts :18-21, configs/io-trace-recording.ts :5-9 (default false, autoHeal), wiring main/index.ts :246-247, :313-330 (dir userData/io-traces :317), window deps :415 :436; tests index.test.ts :49 :70.
- Eventa contracts: apps/stage-tamagotchi/src/shared/eventa/index.ts :54-65 (recording get/set/changed, hub publish/get/subscribe); renderer bridge renderer/bridges/io-trace-hub.ts :5-34 started from App.vue:69.
- Developer page: renderer/pages/settings/system/developer.vue :11-53 (useElectronEventaInvoke + CheckBar; openDevtoolsWindow ButtonBars); i18n en tamagotchi/settings.yaml :1248-1255.
- Build info: unplugin-info 1.3.2 `~build/git` exposes sha, abbreviatedSha, branch (no dirty flag); used by main auto-updater.ts:21 and stage-ui use-build-info.ts:1-4; Info() in electron.vite.config.ts :96 :235.
- getAppMetrics already used for pid sets (foreground-window.ts:70-72, linux-desktop/index.ts:32, window-rects-spike.ts:625): percentCPUUsage is an average since the PREVIOUS getAppMetrics call shared by all main callers (electron.d.ts:1153-1159) -> recorder must use cumulativeCPUUsage deltas (d.ts:7390) per pid+creationTime instead. MemoryInfo units unstated (inferred KB, d.ts:9472-9490), privateBytes win32-only. webContents.getOSProcessId (d.ts:18251) maps windows; unused today.
- contentTracing.startRecording/stopRecording(resultFilePath) (d.ts:7192, 7209), TraceConfig (d.ts:14834); no use in repo.
- Renderer sources: lag sampler apps/stage-web/src/composables/perf/register-lag-sampler.ts:18 + stores/devtools-lag.ts:89 (stage-web only); MMDFrameMetrics frame-metrics.ts:34 (ring 600, recordStage/recordFrame, timings sorts on read), owner MMD.vue:928/:1344, motion-diagnostics.ts:185/:429; tamagotchi stage-three-runtime-diagnostics.ts:326 (three/VRM); defaultPerfTracer stage-shared/perf/tracer.ts:154.
- Tags: PerformanceMode 'idle'|'watching'|'listening'|'thinking'|'talking' (stage-shared/performance-state/index.ts:14), Stage.vue performance :588-603; chat `sending` stores/chat.ts:383; speech mute speech-output-control.ts:36; stage model selection settings/stage-model.ts:15/:108; MMD physicsEnabled/motionDriver/roamMode stores/mmd.ts:112; wake word store wake-word-detection.ts:29; hearing modules/hearing.ts:313; host capabilities stage-shared/stores/host-capabilities.ts:14; stagePaused stage-window-lifecycle.ts:27-29; synced leader via query main/windows/main/query.ts:12, renderer/window-context.ts.
- cpu-slots: readStatus packages/cpu-slots/src/status.ts:71 (filesystem read; store under tmpdir()/airi-cpu-slots, acquire.ts:54-56); history.ts:38-50 under XDG_STATE_HOME with 5 MB rotation.
- History precedent: scripts/dev-tools/verify-history.ts appendVerifyRun :58, readVerifyStats :126, dir git-common-dir/airi-verify (verify.ts:95-97, lib/git.ts:19).
- Bench surfaces: qa:stage measure (packages/qa-tools/src/stage/measure.ts; README :770-772, stage-frame-budget :1297), qa:motion3d matrix with receipts + `matrix compare` (README :422), qa:app AppSessionCore (src/app/run.ts, src/session/app-session), qa:display; root scripts package.json :33-69 (qa:* via node --import tsx packages/qa-tools/bin/*.ts).

## Decisions (with rationale)
- Owner decisions 2026-11-14 (memory reference/projects/dtuber-perf-recorder.md): recorder then bench (both in this one plan, recorder waves first), on in dev + toggle, raw 14d + rollups forever, ring-buffer incidents + manual trace.
- CPU from cumulativeCPUUsage deltas, not percentCPUUsage (shared interval with other getAppMetrics callers).
- Commit identity: `~build/git` sha in both builds; dev adds dirty flag + sha256 of `git diff HEAD` computed once at main start (null in packaged).
- Bench measures with the recorder itself (temp profile, recorder forced on via env, data dir in run dir) so lab and field share one format.
- Architect lane (st_01a1da3e, advisory, verified against cited files) folded as defaults: contract in packages/stage-shared/src/perf/usage/ (subpath export); main service apps/stage-tamagotchi/src/main/services/airi/perf-recording/ + configs/perf-recording.ts; Eventa in src/shared/eventa/perf-recording.ts; MMD usage accumulators inside MMDFrameMetrics via drainUsage() (no timings() sort, no diagnostics snapshot fields); host-neutral WindowUsageSampler class in stage-shared, wired only in windows that mount a stage; one append per 5 s tick (not per record); bench in packages/qa-tools/src/bench + bin/bench.ts (`pnpm qa:bench`).
- Report CLI placement: packages/qa-tools/bin/perf.ts as root `pnpm perf` (node --import tsx, like qa:app) because qa-tools already depends on stage-shared and the root package.json does not; avoids a root dependency change. (Architect preferred scripts/dev-tools; rejected for the root-dependency cost.)
- contended = design B: main records load1, cores, external CPU (os.cpus delta minus app CPU), Linux PSI cpu some avg10; the CLI joins cpu-slots history lease intervals; the product never imports cpu-slots.
- Files: userData/perf/raw/<sessionId>.jsonl (14 d prune, refuses files without a rollup, hourly sweep + size cap), userData/perf/sessions.jsonl forever, userData/perf/incidents/, userData/perf/traces/ (keep last 5); rollups computed by one streaming reducer over closed raw files ~30 s after start (crash-safe).
- Incidents: per-frame preallocated 30 s ring in the renderer; triggers frame stall / memory growth / pegged with settling exclusions, hysteresis, cooldowns, 6/h and 20/day caps; contended or tracing -> event only.
- features stats: block-level (session runs >= 24 valid windows), stratified, medians + IQR + Cliff's delta + bootstrap 90% CI, minimums 5 blocks/3 sessions/120 windows, A/A noise floor, labelled observational.
- bench compare: 5 runs/commit/scenario (min 3), MAD-based sigma pooled with trailing 10 commits, 2 sigma + practical floor + 4/5 direction agreement; never across host/build mode/Electron/dirty; dev-build deltas only.
- Bin edges: frame 4,6,7.5,9,10.5,12.5,15,18,21,25,30,36,42,58,75,100,150,250,500,1000,2000 ms; stage 0.05..50 ms (architect list).
- Overhead proof: recorderMs self-accounting, deterministic zero-gc allocation test, interleaved on/off bench pairs with external CPU readings.
- Manual trace control on renderer/pages/devtools/performance-visualizer.vue, fixed 10 s.
- Extrinsic sweep: budget none (local only); stack mandated (TS, Electron 43, Eventa, Valibot, injeca at boundaries); scale = one user, a few MB/day; audience = Luke + agents, local files only.

## Scope IN

## Scope OUT (Must NOT have)
- No network upload/telemetry; no stage-web recorder (no main process); no automatic contentTracing on incidents; no change to gates or Natural recipes; no new runtime dependency without asking (DuckDB stays ad hoc).

## Open questions
- ANSWERED 2026-11-14 (batch, all recommended): bench store ~/.local/state/airi-perf/bench.jsonl (env override AIRI_PERF_BENCH_DIR); bench on demand only (`pnpm qa:bench`, not in any gate); Electron only (web overlay untouched); TDD for pure parts, tests-after for services/UI, agent-run live QA throughout.
- Q1 bench history location: XDG state dir (per machine, survives re-clone; recommended) vs git common dir (per clone, like verify).
- Q2 bench cadence: on demand only (recommended) vs required in `verify --gate` for perf-sensitive paths.
- Q3 stage-web: Tamagotchi only, web overlay untouched (recommended) vs also record web sessions to a downloadable file.
- Q4 test strategy: TDD for pure parts (recommended) vs tests-after.

## Approval gate
status: approved
next action: write and review .omo/plans/perf-tracking.md (scaffold without --draft-only, plan-consultant, append todos, TL;DR last, plan-reviewer rounds)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Plan consultant (st_01a1da55) - folded 2026-11-14
- B1 QA opt-out (todo 9, IS-12); B2 overhead via independent measureStage pairs in wave 3 (todo 14); B3 traces exempt from IS-10 with local-only note; B4 runtime git identity + epochs (todos 1, 3, 6, 10, 11).
- S1 exhaustive roles + devtools/stageHost/display/diagnosticsTracing tags; S2 main pulls rollups, main-supplied visibility, suspend exclusions; S3 import.meta.env.DEV resolver + optional stored toggle + buildMode dev|preview|packaged; S4 per-launch exclusive lease, exits 2/3, Linux only, wall-clock slicing, model fingerprint; S5 (sha, diffHash) keys, dirty allowed, lowConfidence cold start; S6 segments, rollup-failed, incidents 14 d, 1 GiB cap, dedupe; S7 CLI reduces in memory, unknown v skipped+counted; S8 incident written first, ring appended or ringMissing; S9 sampler in tamagotchi renderer, drain via motion-diagnostics store method; S10 hostContended/leaseContended, bench store resolved like historyRoot; S11 trace button in developer.vue, chromiumTrace flag, buffer size; S12 probe todo 7, renderer heap dropped; S13 structural no-growth tests; S14 exit codes, privacy canary, disabled-state test.
- N3: the PLAN supersedes this draft's IS/GAP rows and Decisions (IS-9 git-common-dir and stage-web rows here are stale).

## Review ledger
- r1 (st_01a1da62): REJECT. Blockers: (1) todos 13/16 QA could not enable recording via airi-qa MCP after todo 9 -> rewrote both to qa:app --perf-dir --keep-open + CDP/agent-browser, trace handler registered on settings+main windows, deps on 9; (2) todo 5 dependency inconsistent -> matrix + wave text fixed. Notes: line refs (measurePairs :620), createConfig path wording fixed.
- r2 (st_01a1da64): OKAY on sha da04cb653ceb5a03aa1b09853eb83f9500d65248384d4fb7e3852c01870dc25c. Notes applied afterwards (consistency only, no scope change): todo 1 Blocks includes 5; 15 -> 16 sequential; .git file-or-dir in worktrees. Final sha e84490e2bb15ec274737577d4d14668f4a2dff95649a446b5d36152fdc8e2591.
