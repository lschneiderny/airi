---
slug: qa-tooling
status: plan-written
intent: clear
review_required: true
phase: review_approved
plan_path: .omo/plans/qa-tooling.md
plan_sha256: cd31c22c4a11ef8398425dcbf3f47162e1bc168f2d0dd1072186c90e5f2459a1
review_round_id: r4-mvg3r34a
review_round_limit: 5
round_status: approved
pending-action: hand off; execution via /ulw-execute qa-tooling (user-started)
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/qa-tooling.md
    round_id: r4-mvg3r34a
    plan_sha256: cd31c22c4a11ef8398425dcbf3f47162e1bc168f2d0dd1072186c90e5f2459a1
    launch_id: l4-r59i2esw
    session: st_01a15749
    result: "OKAY (round 4, final). Non-blocking notes for execution: todo 11 implicitly needs todo 9 (naturalEmotionLifetime) - wave order covers it; todo 3 must add a --registry flag; todo 10 bundle grep also matches __airiMotionQaEnabled so Stage.vue must not statically import isMotionQaBridgeEnabled in production."
    previous_round: "r1 OKAY (notes N1-N3 fixed); r2 st_01a15742 OKAY (notes N4 matrix 9->14, N5 baseline pipelines-audio/qa-tools zero, N6 capture 600 s clamp, N7 lazy Stage.vue handler import) fixed -> fresh round; r3 st_01a15748 OKAY (notes: wave 4 order, IS-3 same-scenario proof, line drift, root vitest config path, gitignored evidence paths) fixed -> final round"
convergence:
  rounds: 4
  accepted_blockers: []
  notes: [N1 todo-10 flag timing, N2 todo-1 diff allowed set, N3 todo-7 UNVERIFIED wording]
approach: "Quick wins (pnpm resolution, known-failures registry, doctor, evidence convention) -> T2 spike + scenario contract + T1 runner/emotion scorer/committed gates/event traces/scorer validation -> T2 runner if go -> dev-only Eventa bridge over remote debug + T3 harness/CLI -> HTML review report -> skill/routing/README/ADR"
---

# Draft: qa-tooling

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users (provisional, refine after research wave 1):
- U1 QA/verifier agents running motion acceptance. Today: rebuild CDP harness per checkpoint (148 scripts, cdp.ts x10), one real-time 7 s Electron capture per emotion cell, rules 2/3 fail 34-99% / ~50% on idle. After: one command per level, scored report in minutes, verdicts that mean something.
- U2 Implementing agents tuning motion (recipes, layers). Today: T0 unit + idle liveliness gate only; emotion feedback needs Electron. After: T1 scenario + emotion scorer in seconds.
- U3 Luke (owner, visual QA). Today: digs through evidence JSON; partial verdicts from noise. After: HTML review report with clips/plots/verdicts/limits; naturalness stays his call.
- U4 Agents doing general QA in any package. Today: pnpm shim exit 127, cold Vite reload, re-derive baselines each checkpoint, lost evidence. After: pinned pnpm, doctor preflight, known-failures registry, evidence convention.
- U5 End users of the app/runtime. Must see no change: idle path, determinism, frame cost, bridge never enabled in production.
- U6 Plan orchestrators (ulw-execute/F-wave verifiers). After: gates as committed code, a skill + routing that tells them which level proves what.

Ideal-state rows (provisional):
- IS-1 | An agent answers 'does this motion change meet its standard' at T1 with one command in seconds-to-minutes, no Electron | U1/U2 speed
- IS-2 | Emotion verdicts are idle-noise relative: false-positive rate on emotion-free runs <= target; real recipe effects detected with high power; weakened recipes caught (mutation test) | U1/U3 trust; Luke decision
- IS-3 | One scenario file runs unchanged on T1/T2/T3 and yields event-stamped traces scored by the same scorer | U1 consistency
- IS-4 | Gate definitions (metrics, thresholds, trials) are committed code; no per-run prereg JSON/mtime ritual | U1/U6 anti-tuning without ritual
- IS-5 | T2 decided by a recorded go/no-go spike; on go, post-physics scoring on the real rig >=10x real time, no GPU, parity with Electron within tolerance; on no-go, documented fallback | Luke decision
- IS-6 | Rendered T3 runs are driven by typed dev-only bridge commands through one CLI; isolated profile, parked cursor, guaranteed teardown; no per-task CDP scripts | U1; Luke decision
- IS-7 | The bridge is impossible to enable in production builds | U5 safety
- IS-8 | Luke gets one HTML review report per run: clips/contact sheet, parameter plots, verdicts, limitations statement | U3
- IS-9 | QA runs do not fail for environment reasons (pinned pnpm, doctor preflight, Vite warm) | U4
- IS-10 | Agents get new-failures-only results against a committed known-failures registry | U4
- IS-11 | Evidence has one archive location and a manifest per plan | U4/U6
- IS-12 | Agents discover the tooling via a motion-qa skill, AGENTS.md routing, READMEs and an ADR | U6
- IS-13 | Runtime unchanged for end users: idle path bit-identical, no new random draws, no frame-cost regression, lab capture keeps working | U5
- IS-14 | Existing liveliness gate keeps its meaning after migration into the gate framework | U1 regression safety

Gap rows:
- GAP-1 (IS-1) | No scenario runner; T1 exists only as idle/talking vitest fixtures inside liveliness-gate.test.ts | emotion feedback needs Electron today
- GAP-2 (IS-2) | No emotion scorer in repo; checkpoint-12 rules lived in prereg JSON; rule2/3 noise-limited | Luke decision: idle-noise relative
- GAP-3 (IS-3) | NaturalTrace has no events/sides; no shared scenario format; T1/T3 drive different entry points | alignment by wall clock today
- GAP-4 (IS-4) | score-natural-captures.ts enforces prereg via file mtimes (:30-35) | ritual, not reviewable in git
- GAP-5 (IS-5) | No headless rig runner; feasibility unproven (renderer construct :5322/:5350, core-in-Node, EULA) | spike needed
- GAP-6 (IS-6) | Rendered QA uses copied CDP/DOM scripts (cdp.ts x10, fixed sleeps, hardcoded ports/lanes) | slow, fragile
- GAP-7 (IS-7) | No bridge exists; any bridge adds a control surface | must be impossible in production
- GAP-8 (IS-8) | No review artifact for Luke | he reads raw evidence
- GAP-9 (IS-9) | pnpm shim regeneration broke runs (exit 127); cold Vite reload; no preflight | env failures cost runs
- GAP-10 (IS-10) | Baselines re-derived per plan (stage-shared 6 localStorage failures; stage-ui node 24-33 failures); no registry; .omo/slop/report.md missing | repeated cost
- GAP-11 (IS-11) | natural-emotion-revamp evidence folder missing from main and worktree | no convention
- GAP-12 (IS-12) | No skill/routing/ADR for motion QA levels | agents rediscover
- GAP-13 (IS-13) | New hooks (event stamping, bridge, subpath exports) could touch runtime | must stay inert in production and on idle path
- GAP-14 (IS-14) | Liveliness gate metrics/bands live in a test file + reference-stats.ts; migration risk | keep meaning

## Components (topology ledger)
- C1 quick wins (pnpm resolution, known-failures registry + new-failures reporter, doctor, evidence convention) | active
- C2 scenario contract + interpreter (stage-shared/motion-scenario) | active
- C3 T1 runner + emotion scorer + committed gates + scorer validation | active
- C4 event-stamped traces (NaturalTrace v2) | active
- C5 T2 headless rig spike -> runner if go | active (gated)
- C6 dev-only Eventa bridge + T3 harness/CLI | active
- C7 HTML review report | active
- C8 skill, AGENTS routing, READMEs, ADR | active
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
- Package placement | pure contracts in packages/stage-shared/src/motion-scenario; pure scorer + gates in stage-ui-live2d natural-motion/; new private Node-only packages/motion-qa for runners, harness, CLIs, report, doctor, known-failures | keeps dependency arrows one way; renderer never imports Node code (architect st_01a15731) | yes
- T3 role | smoke + transfer check (E_T3/E_T1 within [0.7,1.3], >=6/10 visibility hits), never the statistical gate | rendered timing nondeterministic (ultrabrain st_01a15732 (g)) | yes
- Scorer stats | paired counterfactual (same seed, emotion events replaced by no-ops) for size/sign/release/modulation; unpaired placebo windows for sigma0/q90 visibility; sign-flip permutation + Holm alpha 0.01; release by fitted tau + late-window CI; modulation via 60 s long-hold scenario; N=100 seeds full, 30 held-only, 40 long-hold | ultrabrain design (a)-(i) | yes (gate file)
- Gate cost | full emotion gate runs as an explicit command with worker parallelism, not in default vitest; a small T1 smoke subset runs in vitest node | ~18 min single-thread | yes
- Prereg replacement | gates.ts committed; reports record gate file git SHA + input hash; score-natural-captures --prereg path retired | Luke accepted committed gates | yes
- Known failures | committed registry with reason + removal condition; never skip/delete tests | AGENTS 'never suppress test failures' | yes
- Evidence | tool run output under .temp/motion-qa/<runId>/ (matches .temp smoke convention); plan evidence under .omo/evidence/<plan>/ with manifest.json | | yes
- No new third-party dependencies | stats hand-rolled; report self-contained HTML/SVG; screenshots via CDP | AGENTS dependency rule | yes
- Rigs | read from env AIRI_QA_RIG_FORBOOTH / AIRI_QA_RIG_BEAR, never copied into git; T2/T3 skip cleanly when unset | licensing | yes
- Cubism EULA | spike records the EULA terms read; legal fit stays UNVERIFIED and is surfaced to Luke in the spike report | | yes

## Findings (cited - path:lines)
- Emotion chain (pure up to the scene): AffectSignal (stage-shared expression-performance/types.ts:32-39) -> Decider (deciders.ts:23 createDecider; Decider interface types.ts:75 never reads clocks/global randomness) -> PerformanceDecision {episodes, slots, holds} -> StagePerformanceConductor (stage-ui composables/performance/use-stage-performance-conductor.ts:162; injectable clock :101-106,193; scene interface StagePerformanceScene :68-75 setEmotion/applyHolds/onSpeech/setMuted) -> Model.vue scene impl :1393-1404 -> pendingNaturalEmotions (Model.vue:166) + EmotionHoldPerformer (stage-ui-live2d expression/hold.ts:25; Model.vue:323-338,616) -> attention provider -> NaturalMotionAdapter.compose (natural-motion-adapter.ts:298-308) -> Live2DNaturalMotion (natural-motion.ts:70; setters :176-276 advance time first; fixed 1/120 integrator :45).
- Entry points: lab pulse emotion-pulses.vue:48 -> natural-performance-override.ts:46-47 -> Stage.vue:487-493 emotionsQueue (Stage.vue:308); ACT marker queues.ts:23-60 -> Stage.vue:406.
- Natural frame = {pose, fixation, face, blink, breath} (frame-types.ts); liveliness gate sim at 120 Hz, 30 Hz trace, head*30 (liveliness-gate.test.ts).
- Capture: Model.vue:1102-1146 NaturalTraceRecorder on beforeModelUpdate, performance.now() clock (same clock family as conductor default), always scoreLiveliness (:1134). NaturalTrace has no events; capturedAt is ISO.
- SDK frame order verified: node_modules/.pnpm/pixi-live2d-display@0.4.0_*/.../dist/cubism4.es.js:5416-5437 motion -> saveParameters -> expressions -> eyeBlink -> updateFocus (Natural composes) -> breath -> physics.evaluate -> pose -> emit beforeModelUpdate (trace sampled) -> model.update -> loadParameters. Constructor builds CubismRenderer_WebGL and calls renderer.initialize(coreModel) (:5322,:5350) - spike risk.
- Cubism core (apps/*/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js, not in git, downloaded) detects Node (process.versions.node, require('fs')) and appears asm.js (stubs WebAssembly) - loadable in Node, UNVERIFIED at runtime. Header: Live2D Proprietary Software License, 'Redistributable Code' - legal fit for headless dev use UNVERIFIED.
- AIRI hook order: motion-manager.ts hookUpdate :135-184 (pre/post/final plugins, reads localStorage); Model.vue plugin registration :542-578, natural final plugin ~:630; adapter wraps updateFocus :174-180.
- Eventa: Electron contracts centralized apps/stage-tamagotchi/src/shared/eventa/ (e.g. plugin/host.ts defineInvokeEventa); main context createContext(ipcMain) main/index.ts:~393; renderer BroadcastChannel contexts stage-shared beat-sync/eventa.ts:7-29, expression-performance/affect-trace-diagnostics.ts:6,34-48. Skill lists adapters incl. websocket/native (client) and websocket/h3 (server). Remote debug env gate main/app/debugger.ts:9-16 (APP_REMOTE_DEBUG). Renderer dev gate pattern renderer/main.ts:57 import.meta.env.DEV. Diagnostics channel raw-message NOTICE natural-motion-diagnostics.ts:103-122.
- Harness sprawl: .omo/evidence/emotion-expression-performance/*-scripts (148 scripts; cdp.ts x10, ev.ts x10, import.ts x8); in-repo apps/stage-tamagotchi/scripts/lib/remote-debug.ts (waitForRemoteDebug, findDebugTarget, CdpClient.evaluate) unused by them.
- Checkpoint 12 noise (ledger.jsonl): rule2 fails 34-99% on idle in 15/20 face cells; rule3 46-54%; pooled bias 23/26 p 4.4e-5; rule1 22/22 min margin 1.89x.

## Decisions (with rationale)
- [Luke 2026-10-20] Spike T2 headless rig first: real moc3 + Cubism core + physics in Node, fixed timestep, go/no-go gate. Rationale: moves rendered statistics off real-time Electron.
- [Luke 2026-10-20] Emotion acceptance is idle-noise relative: window means, many seeded trials, threshold from the rig's own idle null distribution, plus recipe sign/size. Replaces checkpoint-12 rules 1-3 (not an added layer; consistent with Luke's 2026-10-19 "no supplementary scoring layers").
- [Luke 2026-10-20] Rendered QA control via a dev-only Eventa bridge (typed commands + state reads), not CDP/DOM clicking.
- [Luke 2026-10-20] Order: quick wins first (pnpm pin, known-failures registry, doctor script, evidence convention), then motion.
- [Luke 2026-10-19, standing] Naturalness stays Luke's visual QA call; every QA report states recipe/idle scoring limits; desk VTS recordings valid for idle liveliness only.
- [Luke 2026-10-18, standing] Acceptance on one rig (ForBOOTH) counts for Bear.
- Session stance: one-by-one (cold start, CLEAR).
- [Luke 2026-10-20] Tests-after.
- [Luke 2026-10-20] Cubism Core in Node for local, non-distributed QA: allowed. T2 verdict is technical only.
- Naming (supersedes earlier draft wording): package `packages/qa-tools` (`@proj-airi/qa-tools`), skill `motion-qa`, run dirs `.temp/qa/<runId>/`, root scripts `qa:doctor`, `qa:test`, `qa:motion`, `qa:report`; bridge gate via main-window URL query + `resolveRendererWindowContext` (no preload change).
- Plan-consultant st_01a15739 folded: conductor smoke test (todo 1), lifetimes/held-only release (todo 9), golden idle hash (baseline + todos 6/8/9/10), bundle check with negative fixture (todo 10), root vitest project + lockfile (todo 1), frame-cost bench (todo 6), --prereg sweep (todo 9), agent-config commit split (todo 17).
- [Luke 2026-10-20] Bridge transport: over remote debug. CLI sends schema-validated commands via existing APP_REMOTE_DEBUG/CDP into a dev-only dispatcher that forwards over Eventa; no new port; triple gate (import.meta.env.DEV / is.dev, APP_MOTION_QA_BRIDGE=true, remote debug on).

## Scope IN
- C1-C8 from the components ledger; tests-after (Luke 2026-10-20); agent-executed QA per todo.
- Constraints swept: budget none (no paid services); stack fixed (pnpm/Vitest/Eventa/valibot, no new deps); scale one Windows workstation (16 cores) + optional CI for T1 smoke only; audience Luke + agents.

## Scope OUT (Must NOT have)
- No change to Natural/expression runtime behavior: idle path bit-identical, no new random draws, stream indices unchanged, no recipe retuning.
- No bridge code reachable in production builds; no new listening ports.
- No new third-party dependencies; no package.json/lockfile changes beyond adding the new private workspace package and subpath exports.
- No rig files, Cubism core, or captured traces committed.
- No skipped/deleted tests to go green; known failures only via registry.
- No non-English locale edits; no Kirie edits.
- No naturalness claims from scorers.

## Open questions

## Approval gate
status: awaiting-approval
next: on Approve -> scaffold plan, plan-consultant, append todos, plan-reviewer rounds (max 5)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
