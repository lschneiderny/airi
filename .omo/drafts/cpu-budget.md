---
slug: cpu-budget
status: handed-off
intent: clear
review_required: true
plan_path: .omo/plans/cpu-budget.md
plan_sha256: 73ff538760daa423a598a3ac7dabcd4102b9286c2303a6e0e69e9f008458e5d9
review_round_id: r8-95cfadc1-39e0-40a1-bd0e-b24b26a33e7f
review_round_limit: 8 (Luke authorized rounds 6-8, 2026-10-21)
pending-action: none (handed off; Luke starts /ulw-execute cpu-budget)
phase: review_round_initialized
round_status: closed_without_approval
review:
  plan_reviewer:
    status: changes_requested
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/cpu-budget.md
    round_id: r8-95cfadc1-39e0-40a1-bd0e-b24b26a33e7f
    plan_sha256: f05a8e3a56061c6271221c27841272c43b00a58348cf16dadf68cf668f42d0ca
    launch_id: l8-6c1425c1-5079-4625-a0af-24bdfb64b63b
    session: st_01a1609c
    result: REJECT - B11 POSIX pgid cannot track a detached grandchild (A21b); B12 wt install launches the broker CLI inside the unprepared new worktree; B13 F1 VITEST_MAX_WORKERS grep contradicts the ADR text
approach: zero-dependency machine-wide CPU slot lease broker (12-slot budget, strict FIFO, heartbeat leases, env inheritance) wired into root heavy scripts, verify, wt, vitest configs, and qa-tools; plus a module-closure-keyed T1 gate/validation result cache that counts as a local check only. Source material: .omo/drafts/cpu-budget-prior-plan.md
---

# Draft: cpu-budget

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- Agents in several worktrees running verify, test:run, typecheck, build, qa:test, qa:motion, wt new, and direct vitest. Today each run assumes the whole machine. After this plan, they share a 12-slot budget and see why they are waiting.
- Luke at his desk, including T3 captures that need a quiet machine. Today agent load spoils captures and slows the desktop. After this plan, about 4 cores stay free and T3 holds the machine exclusively.
- CI (GitHub Actions) and the pre-commit hook, which must behave exactly as today.
- Gate reviewers and evidence consumers (T3 `--t1-report`, F-wave reviewers), who must never receive a cached result as acceptance evidence.

IS-1 | brokered work never holds more than the budget (12 by default, `AIRI_CPU_BUDGET` override) | running several agents must not oversubscribe the machine
IS-2 | every brokered command runs with a worker count equal to its grant | a cap the tools ignore does nothing
IS-3 | strict FIFO; an exclusive lease (T3, packaging) waits for all leases to clear, then blocks new ones | T3 needs a quiet machine; the prose lock is not enforced
IS-4 | dead or stale leases stop counting within 45 s; nested commands inherit and never deadlock | earlier PID-reuse and lock misfires; wt new -> install -> postinstall build
IS-5 | `CI=true` or `AIRI_CPU_SLOTS=off` turns the broker off and restores today's behavior | CI and emergency bypass
IS-6 | holders, grants, the queue, and wait times are visible (`pnpm slots status`, `dev:top`) | agents must see why they wait
IS-7 | an unchanged-input T1 gate or validate-scorer rerun returns the stored verdict, marked cached; any recorded input change misses | deterministic reruns waste minutes of all-core CPU
IS-8 | a cached result is a local check only: `run.json` cache marker, `--t1-report` refusal, skill requires `--fresh` for evidence | Luke's 2026-10-21 decision
IS-9 | verify's pass-cache key ignores worker flags | the grant varies; otherwise the cache never hits
IS-10 | every vitest config in the repo is capped, not only the heavy ones | agents call `pnpm -F <pkg> exec vitest` directly; an uncapped small suite still spawns 15 workers

GAP-1 | no concurrency cap anywhere (turbo none; root vitest none; vitest default cores-1 = 15, cli-api.CnMVyzaz.js:3832-3838; gate/cli.ts:68 and validation/cli.ts:43 default cpus-1) | IS-1, IS-2
GAP-2 | the heavy lock is prose only (.agents/skills/motion-qa/SKILL.md:70) | IS-3
GAP-3 | no lease liveness or inheritance mechanism exists | IS-4
GAP-4 | no status surface for CPU leases; dev:top shows processes only (scripts/dev-tools/top.ts) | IS-6
GAP-5 | gates and validation always recompute; determinismHash is identical for identical inputs (gate/aggregate.ts:46-47) | IS-7
GAP-6 | run.json has no cache field; t3-gate.ts:215 checks only determinismHash | IS-8
GAP-7 | verifyCacheKey hashes the full command (verify.ts:90; verify-cache.ts:23) | IS-9
GAP-8 | 48 vitest configs (git ls-files) set their own workers or none | IS-10

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
C1 | broker core package: store, grant rule, acquire, CLI | active | .omo/drafts/cpu-budget-prior-plan.md K1-K5
C2 | tool wiring: root scripts, verify, wt, vitest configs, qa-tools | active | K6
C3 | observability: slots status, dev:top leases | active | K7
C4 | QA result cache: T1 gate and validate-scorer, local check only | active | K8-K9
C5 | docs and agent guidance: READMEs, AGENTS.md, ADR, motion-qa skill | active | K10

## Open assumptions (announced defaults)
- assumption: dependency declaration | default: every package whose vitest config imports `@proj-airi/cpu-slots/vitest` declares it as a `workspace:^` devDependency (explicit, per AGENTS.md boundaries); root declares it too | rationale: no phantom resolution, and knip stays clean; the cost is retypechecking consumers on cpu-slots edits | reversible: yes
- assumption: lease store at os.tmpdir()/airi-cpu-slots | reversible: yes
- assumption: cache store at <git common dir>/airi-qa-cache, keeping the newest 20 entries per key | reversible: yes
- assumption: verify runs per-step classes in-process; `typecheck` and `build*` are CLI-wrapped with `{grant}`; `test:run` and `test` are not wrapped (config wrappers cover their steps; watch mode never leases) | reversible: yes<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
- vitest 4.1.11 `VITEST_MAX_WORKERS` (coverage.DM_a_rWm.js:380) overrides the forced `maxWorkers = 1` for `fileParallelism: false` (:223-225). Forbidden. `--maxWorkers` flows through options before :225, so serial projects stay at 1.
- Project `maxWorkers` beats the root value (cli-api.CnMVyzaz.js:3832-3838). A group of projects with different maxWorkers throws (:3890-3893). Today it is avoided by qa-tools `sequence.groupOrder: 1`.
- Worker module fetches go through `project.vite.environments.{ssr|client}.moduleGraph.ensureEntryFromUrl` (cli-api:415, :1001). A reporter can read the closure from the graph after the run (`onInit(ctx)`, `onTestRunEnd`, reporters.d.DtoKVV2s.d.ts:1061, :1126).
- Project config files load through Vite's config-file path (cli-api:11180-11213). Vite accepts function and async default exports.
- turbo 2.10.11 has `--concurrency` and no env equivalent. pnpm 11.24 has `--child-concurrency`. Node 26.11.1 strips types natively (`process.features.typescript = strip`).
- T1 gates read no files besides imports. Their environment inputs are QA_LEVEL, QA_VALIDATION_{PHASE,SHARD,SHARDS,SECTIONS}, QA_SEEDS, and QA_RUN_DIR as output (gates/define.ts:18, 70-74). Natural-motion code does no fs reads (grep).
- The gate spawns one vitest with `--maxWorkers <workers>` (gate/cli.ts:145-152). Validation spawns `workers` vitest processes, each with `--maxWorkers 1` (validation/cli.ts:86, 139). qa:test runs suites serially with the default workers (bin/test.ts:50-61, 152-153).
- verify runs turbo typecheck, moeru-lint, and vitest related, sequentially (verify.ts:33-61). Its cache dir is `<git common dir>/airi-verify` (verify.ts:79).
- `pnpm wt new` runs `pnpm install --frozen-lockfile --prefer-offline` (wt.ts:80-84). Postinstall runs `build:packages` through turbo (package.json).
- TEMP is `H:\llm\ollama\tmp`, which also holds the old heavy lock.
- Measured 2026-10-21: the indexer and Defender add load to every loop. Out of scope here, listed as follow-ups.
## Decisions (with rationale)
- Luke, 2026-10-21: scope is the broker plus the QA cache only; heavy scripts are wrapped automatically; the budget is 12 cores; cached results are a local check only.
- Defaulted: lease store under os.tmpdir()/airi-cpu-slots, because it is machine-wide across clones and worktrees and colocated with the old lock. Reversible.
- Defaulted: the cache covers T1 only; T2 reads rig assets outside the repo, and T3 and browser runs are not deterministic.
- Defaulted: worker flags are used, never `VITEST_MAX_WORKERS` (see Findings).
- Architect lane (st_01a16078), verified against the cited lines:
  - A new workspace package `@proj-airi/cpu-slots` is correct, because qa-tools is a consumer and AGENTS.md puts shared logic in packages/. Run it with tsx and extensionless imports, matching every dev tool (package.json:53-55), instead of Node type stripping, so no AGENTS.md exception is needed.
  - `withCpuSlots` async config wrapper constraints:
    - (a) watch mode never acquires;
    - (b) it sets root `test.maxWorkers` only when it acquired the lease itself; a reused in-process or inherited lease edits nothing, so package configs loaded as projects of the root config stay untouched;
    - (c) it covers every vitest config (IS-10).
  - `test:run` is not CLI-wrapped. Each vitest step in its chain acquires through its config wrapper with its own class (`browser` or `test`).
  - The CLI substitutes a `{grant}` token in the command (`turbo run typecheck --concurrency={grant}`), because `$AIRI_CPU_GRANT` is not portable across cmd and sh.
  - The QA cache stays local to qa-tools. It shares the location convention and `git hash-object` with verify, not code. Its key adds the vitest config files the run loaded (packages/qa-tools/vitest.config.ts) and any fs-read fixture.
  - The ADR names the blast radius: one global turbo miss from the root package.json and lockfile change, and every cpu-slots edit retypechecks its consumers through `^typecheck`.
- Ultrabrain lane (st_01a16079). Repo claims verified: aggregate.ts:13-15, evaluate.ts:6-8, and validation/cli.ts:12 import natural-motion scoring on the CLI side; `module.registerHooks` exists in Node 26.11.1; `import.meta.glob` is unused in qa-tools, natural-motion, and stage-shared. Adopted:
  - Lock: `broker.lock/owner.json {token,pid,at}`. To break a stale lock (owner pid dead or older than 10 s), rename it to a unique tombstone, then check the token; if it differs, rename it back and stay busy. Every commit re-reads the token and aborts on mismatch. Writes go through temp + rename, as in verify-cache.ts:40-45. Residual seconds of oversubscription are accepted and stated in the ADR (soft budget).
  - The heartbeat uses `utimesSync` with the injected clock. If the observer's own tick gap exceeds 3 intervals (sleep or a clock jump), it skips pruning that tick. A pruned live holder re-registers on ENOENT, even over budget, and no new grants happen until usage falls back under it.
  - Tickets carry a pid and are touched on each 500 ms poll. They are pruned when the pid is dead or the ticket is older than 45 s.
  - Requests are clamped: min and max are each capped at the budget.
  - `lease.env` is an object merged into spawn envs; `process.env` is never mutated. An inherited lease counts only while live; the child gets `min(childMax, parentGrant)`. An exclusive request under a non-exclusive parent exits 2 with a named message.
  - Library mode uses only `process.on('exit')` for synchronous unlink, with no SIGINT or SIGTERM handlers, so Vitest's own signal handling is not replaced. The CLI `run` forwards signals to its child.
  - Windows: mkdir EEXIST, EPERM, EACCES, and EBUSY all mean busy and are retried on the next poll; ENOENT means create the root. rename EPERM and EBUSY are retried a bounded number of times. `kill(pid,0)` ESRCH means dead and EPERM means alive. The H: drive is NTFS, measured 2026-10-21.
  - The core is a pure `decide(state, now)` over a store that takes the root, clock, isAlive, and fs adapter, with a pre-commit interleave hook so tests run without sleeps. Test list A1-A16 is from the lane report.
  - Cache closure = the Vite module graph (worker side) plus the CLI-side module closure, recorded with a `module.registerHooks` resolve and load hook (spike). Fallback for the CLI side: every tracked file under packages/qa-tools/{src,gates}, packages/stage-ui-live2d/src, and packages/stage-shared/src.
  - The cache key also includes: the vitest config files; root package.json; the package.json and tsconfig*.json files of the workspace packages in the closure; .npmrc; the env after CLI overrides minus QA_RUN_DIR, covering QA_*, NODE_OPTIONS, NODE_ENV, VITE_*, VITEST_*, and TZ; process.arch; and the realpath and version of vitest/package.json. Emotion order is kept as given.
  - File hashes are sha256 of raw bytes, not `git hash-object`, because CRLF filters hide changes. Paths are normalized: strip ?query, skip \0 and /@id/, decode /@fs/, realpath, forward slashes, lowercase drive letter; only then drop node_modules.
  - No entry is stored when a closure file's mtime is at or after the run start. Entries copy their artifacts and are written atomically; a parse error is a miss.
  - A test fails if `readFileSync` appears in gate-reachable source outside the partials module, or if `import.meta.glob` appears in qa-tools. Test list B1-B13 is from the lane report.
## Scope IN

## Scope OUT (Must NOT have)
- no dev-server throttling or killing; no Defender, indexing, or Dev Drive changes; no gate, recipe, or test-assertion changes; no T2, T3, browser, or qa:test caching; no new external dependency; no `VITEST_MAX_WORKERS`
## Open questions
- (resolved) Q1 gate class max slots: Luke chose 10 (2026-10-21).
- (resolved) Q2 test strategy: Luke chose tests-after (2026-10-21). Agent-executed QA is included.
- Constraint sweep: budget/spend none (explored); stack: Node builtins plus tsx, no new external dependency (explored); scale: 16 logical cores, 12-slot budget, 3-5 concurrent agents (defaulted); audience: local development only, CI and pre-commit unchanged (explored).
## Approval gate
status: approved (Luke, 2026-10-21: "Approve")
plan written; plan-consultant st_01a16083 folded: findings 3,4,6,7,8,9,10,11,12,13 applied; 1,2,5 were against the prior draft and already resolved; 14 partly (dropped .npmrc; kept tsconfig because the esbuild transform honors compilerOptions).

## Review ledger
round 1: r1-d87ff831-b2ff-4f6b-ae8b-b0833d02b7f0, plan_sha256 9b8b1aa4c64702ab950b05360a75386a1b95a389f3b76768923f534d63a563f1, launch l1-5551c20c-3439-4bb9-a7de-30b27511eb39, session st_01a16089 -> REJECT (changes_requested)
accepted blockers (ledger frozen after round 1):
- B1 (explicit_requirement_or_accepted_decision, IS-2/IS-10): the wrapper must enforce the grant over existing root/project maxWorkers while keeping serial execution
- B2 (explicit_requirement_or_accepted_decision, IS-1/IS-3): recovery must not exceed the budget or overlap an exclusive lease; add a deterministic expiry/replacement/recovery QA scenario
next action: on approval, scaffold the plan, run plan-consultant gap analysis, append todos, fill the TL;DR last, then run the plan-reviewer review rounds (maximum 5).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

fix summary (after round 1): B1 -> M11 rule (b) clamps existing root and project maxWorkers to min(existing, G), never raises, never touches fileParallelism/isolate/sequence; probe expects 1/2/2. B2 -> owner-identity liveness (isAlive + isSameProcess by creation time), no pruning of a live owner, no age-based lock break, write-then-verify commit; soft-budget text removed; QA A7/A7b/A7c (expiry without replacement, death with replacement, PID reuse), A9 (hand-deleted recovery), A17/A18 (forced concurrent commit).
round 2: r2-61fc6c21-7465-4cb1-b22f-09d6658b7189, plan_sha256 136d73f5c115f2a8431eaab2a32b00822153b81d6cb2b9827458c7aa51a2674b, launch l2-e6352e01-bb0a-4247-8c04-52456a733494, session st_01a1608c -> REJECT; accepted B3 (new, reproducible_broken_flow) and B4 (regression from the B1 fix)
fix summary (after round 2): B3 -> referenced polling timer until acquired or cancelled, unref'd heartbeat only after acquisition, plus a standalone queued-survival CLI test; B4 -> todo 6 acceptance now requires downward clamping under a reused or inherited lease (qa-tools 4 -> 2 with groupOrder unchanged) and no insertion of absent limits.
round 3: r3-f5a5a112-17ec-4ac4-9802-cae0b58be774, plan_sha256 43390a32643241eb69245486adf6f763cb9f2d1a450bbd40ff3fbd0341dd10a0, launch l3-5649729b-8c5e-4eb2-90d2-b1c6dd6ba136, session st_01a1608d -> REJECT; accepted B5 (regression from the B2 fix) and B6 (contradiction with acceptance B12)
fix summary (after round 3): B5 -> atomic lock publication (tmp dir with owner.json renamed into place; orphan .tmp cleanup by owner identity or 10 s age; an ownerless broker.lock only from tampering), plus test A19; B6 -> key uses the vitest version plus the content sha256 of vitest/package.json, not its realpath.
round 4: r4-f910402d-6b0d-4e48-9848-b8896b45139d, plan_sha256 dea5790f031eab73ef35239f4543b72b623570545146d871ce459b576f09f38a, launch l4-050eaa4e-0dcf-42ce-8225-9c6c39e6eecf, session st_01a16090 -> REJECT; accepted B7 (explicit_requirement IS-2/IS-10; verified verify-plan.ts:18-20 and provider-inference inline browser project)
fix summary (after round 4): B7 -> the child wrapper enforces min(classMax(detectedClass), AIRI_CPU_GRANT) on its first (top-level) call, setting a root-level value; gate and exclusive parents keep their explicit grant through AIRI_CPU_CLASS; verify and qa:test pass no vitest --maxWorkers; verify uses browser for all extraTestConfigs; probe through a scratch reporter that prints per-project effective maxWorkers (stage-ui browser <= 4, node = 1, stage-pages <= 4).
round 5: r5-e21cbd3c-d6f5-40de-82ed-2e2d690b8e5a, plan_sha256 a8052c9b22920dd147b6ae59def9a6d971512a98757f92b6e2ffe28babb92ead, launch l5-ad3765b1-c856-49d8-95ad-784e63b1a015, session st_01a16093 -> REJECT; accepted B8 (IS-1/IS-3). Review cap of 5 reached: stopped; asking Luke.
fix summary (after round 5): B8 -> leases record workload pids (addWorkload after every spawn; release after child exit); pruning requires owner and workload gone, with descent through the win32 ParentProcessId chain or POSIX pgid via a dependency-free snapshot on the slow path; IS-4 reworded; tests A20 (coordinator-only kill keeps the lease and blocks exclusive until the workload exits) and A15 tree kill; F3 step 8 updated.
round 6: r6-fa8eebe4-c808-431a-b0a4-a2acd53ad84c, plan_sha256 a7197afbb671f4028e414ca07db9c60f15b0cd52c5d42ee73698513a481357ff, launch l6-5d1f1c48-6474-4149-9455-8420b1bfac2a, session st_01a16096 -> REJECT; accepted B9 (regression from the B8 fix). Authorized cap of 6 reached: stopped; asking Luke.
fix summary (after round 6): B9 -> exit cleanup and release() share releaseIfIdle(), which deletes the lease only when no registered workload is alive; otherwise M4 pruning removes it later; test A21 (graceful process.exit with a detached surviving workload keeps the lease and blocks an exclusive waiter until the workload is killed) plus a releaseIfIdle unit test.
round 7: r7-0aa4398e-ec20-4fdb-ae3d-ae93c0e930e9, plan_sha256 9420e6ea40c7113187a9705e8425ac76db65e9be3bf1b1c1f87ce5471ac74ac5, launch l7-12079759-3edc-465f-93bb-83823200ea33, session st_01a16098 -> REJECT; accepted B10 (regression from the B9 fix). Authorized cap of 7 reached: stopped; asking Luke.
fix summary (after round 7): B10 -> a single workloadAlive(lease, snapshot) used by pruning, release(), and exit cleanup; the win32 chain matches recorded pids even when dead; releaseIfIdle always takes a sync snapshot; tests A21b (surviving grandchild of an exited workload) plus parity units.
round 8: r8-95cfadc1-39e0-40a1-bd0e-b24b26a33e7f, plan_sha256 f05a8e3a56061c6271221c27841272c43b00a58348cf16dadf68cf668f42d0ca, launch l8-6c1425c1-5079-4625-a0af-24bdfb64b63b, session st_01a1609c -> REJECT; accepted B11, B12, B13. Authorized cap of 8 reached: stopped; asking Luke.
final (2026-10-21): Luke asked whether the remaining findings were relevant; assessment: B12/B13 real and trivial, B11 theoretical on win32, B8-B10 occasional with brief-oversubscription impact. Luke chose "Fix and hand off". B11 -> stated POSIX limitation, A21b win32-only; B12 -> wt install acquires in-process from the caller's checkout; B13 -> F1 grep limited to runtime/config. Final plan_sha256 73ff538760daa423a598a3ac7dabcd4102b9286c2303a6e0e69e9f008458e5d9. Not re-reviewed after round 8; no unconditional plan-reviewer approval exists.
