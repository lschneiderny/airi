---
slug: test-qa-revamp
status: reviewed-approved (plan-reviewer r5 OKAY 2026-11-10)
intent: clear
review_required: true
plan_path: .omo/plans/test-qa-revamp.md
plan_sha256: 7479b30cc4ad03d29d0342ce281ebf23649232152f8a1d7c384caeb41fc822d1
review_round_id: r5-20261110
review_round_limit: 5
pending-action: none (ready for /ulw-execute after linux-sensor-parity lands)
review:
  plan_reviewer:
    status: approved
    workspace_root: /mnt/dev/projects/dtuber
    runtime_home: null
    target: .omo/plans/test-qa-revamp.md
    round_id: r5-20261110
    plan_sha256: 7479b30cc4ad03d29d0342ce281ebf23649232152f8a1d7c384caeb41fc822d1
    launch_id: r5-launch-1
    session: st_01a1c35b
    result: OKAY (unconditional; no blockers, no notes)
approach: see Approval gate
---

# Draft: test-qa-revamp

> Status 2026-11-17: superseded in part. Several `qa:*` commands were removed after all, the verify pass cache and the `live`-as-`browser` encoding are gone, and the T3 exclusive gate was deleted. Current rules: [Testing and QA](../../docs/ai/context/testing.md), [fork policy plan](../plans/fork-policy-and-tooling.md), [character mind roadmap](../../docs/ai/context/character-mind-roadmap.md). Its body is frozen history.

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users: (1) Luke, who waits on plan lanes and lands work; (2) agents/worker lanes that run `pnpm verify`, `pnpm test:run`, and `qa:*` and read AGENTS.md/skills to decide what to run; (3) the cpu-slots broker and the scripts that consume verify/QA results (verify cache, qa evidence runs).

IS-1 | A commit-loop `pnpm verify` re-checks only what changed since the last passing verify on that worktree, typically under ~60 s | lanes stop paying branch-cumulative cost
IS-2 | A branch gate still checks the full branch against main before landing | nothing slips through narrower commit-loop scope
IS-3 | One verify test step queues once for CPU, not per command | no FIFO re-queue tax under load
IS-4 | Live QA (smoke/app/host/T3) no longer blocks verify/typecheck in other worktrees; only timing-sensitive motion gates opt into exclusive | parallel lanes keep moving
IS-5 | Lease waits, holds, and verify step results (pass AND fail) are recorded and summarized by one command | bottlenecks are measured, not guessed
IS-6 | Browser tests exist only where a browser is required; Vitest `related` runs as few invocations as possible | lower cost and fewer ERR_INSUFFICIENT_RESOURCES flakes
IS-7 | One testing guide defines tiers and a change-type -> required-checks table; root AGENTS links to it; skills/READMEs carry only tool mechanics; no contradictions or stale commands | agents run the right checks, no more
IS-8 | Live QA is required only for visible motion changes | renderer edits no longer pay live QA
IS-9 | qa-tools commands share one app-session core; every command kept (D8) | less infra maintenance
IS-10 | No fixed sleeps / unjustified skips / junk tests in touched suites | determinism

GAP-1 | verify diffs against merge-base HEAD main (scripts/dev-tools/verify.ts:103); 201/239 test passes covered 150+ paths | closes IS-1
GAP-2 | no explicit branch-gate mode distinct from commit loop | IS-2
GAP-3 | per-command acquire at verify.ts:145 | IS-3
GAP-4 | qa:smoke/app/host/T3 acquire `exclusive` (bin/smoke.ts:24, t3/launch.ts:56, host/run.ts:92) | IS-4
GAP-5 | broker keeps only live state in /tmp/airi-cpu-slots; verify records only passes | IS-5
GAP-6 | 186 browser test files, 9 extra configs each `vitest related` separately, chunked | IS-6
GAP-7 | guidance spread over ~9 docs; root AGENTS done list requires smoke+qa:app for any runtime change; agreement row says defer live QA | IS-7, IS-8
GAP-8 | 14 qa:* commands, ~26k LOC qa-tools; 179/953 commits since 10-15 touched QA tooling | IS-9
GAP-9 | 14 test files with >=100ms fixed sleeps, 2 unconditional skips, 1 source-text test (plan GAP-11) | IS-10

## Components (topology ledger)
C1 | Measurement: broker lease telemetry + verify step history (pass/fail) + summary command | active
C2 | Verify scoping + cache + single lease per step + branch-gate mode | active
C3 | Lease model: sized live-QA class, exclusive opt-in for timing gates, nested-lease rule | active
C4 | Vitest consolidation + browser-test placement | active
C5 | qa-tools command consolidation/trim | active
C6 | Testing guide + done-criteria policy + doc/skill cleanup + test hygiene | active

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
- new cpu-slots class `live` {min 4, max 6, non-exclusive} for smoke/app/host/mcp/motion t3 | fits Electron dev; one live + one test step fit budget 12 | yes
- exclusive stays only for T3 timing gate (`qa:motion` t3 gate) and `qa:stage measure` | frame timing validity (measure.ts:21-26) | yes
- launch.ts takes the CLI's lease handle instead of acquiring | assertShareable would throw under `live` | yes
- telemetry: `<storeRoot>/events.jsonl` (broker) and `<git common dir>/airi-verify/runs.jsonl` (verify, pass+fail), appended outside the store lock, size-rotated; readers `pnpm slots history` and `pnpm verify --stats` | measure before/after | yes
- one lease per verify step (typecheck/lint/test) | removes FIFO re-queue | yes
- testing guide at `docs/ai/testing.md` + ADR `docs/ai/adr/2026-11-10-test-tiers.md`; root AGENTS done list replaced by a link + short tier table; CONTRIBUTING links to the guide | single source of truth | yes
- guidance: cap heavy plan lanes at 3 concurrent verify/live-QA lanes | load-avg 128 incident | yes
- hygiene: fix the 14 fixed-sleep files and 2 skips, remove/replace tool-call-block source-text test | determinism rule | yes

## Findings (cited - path:lines)
- verify pass records: <git common dir>/airi-verify/*.json (789; fields step, tree, command, passedAt, durationMs). test median 116 s / p90 241 s / max 1937 s / 10.1 h; typecheck 3.3 h; lint 1.0 h (2026-11-05..10).
- verify.ts:103 merge-base; :143-152 per-command acquire/run/release; verify-plan.ts extraTestConfigs (9 configs), testPrerequisiteTurboArgs turbo build packages before tests.
- cpu-slots classes.ts: test 2-6, browser 2-4, typecheck 2-6, build 2-6, lint 1, install 4, gate 4-10, exclusive all; budget 12.
- exclusive callers: qa-tools bin/smoke.ts:24, src/t3/launch.ts:56, src/host/run.ts:92; capture:tamagotchi script.
- smoke runs (dtuber-wt/*/.temp/qa/*smoke-clean-start): 38-64 s ok; failures 617 s (CDP 600 s timeout), 134 s (stage window 120 s), 69 s (teardown).
- Unmerged luke/feat/linux-sensor-parity (33 commits, F-wave pending) changes 37 files in qa-tools/dev-tools/vitest.config.ts (+3269). 36 lsp-* worktrees exist.
- Architect advisory (st_01a1c30f, cites LSP worktree): (a) commit-loop scope = last passing tree per branch in <common>/airi-verify/last/<branch>.json, fallback merge-base when record missing/mergeBase moved/tree pruned; `--gate` = merge-base scope; keep exact-tree cache key; (b) one lease per step, vitest children inherit (acquire.ts:331-348, browser clamp acquire.ts:196); (c) new class `live` {min 4,max 6}; move smoke/app/host/mcp/motion t3 to live; exclusive only for T3 timing gate (gate/cli.ts:253) + qa:stage measure; launch.ts:71 must take the CLI lease handle instead of acquiring (assertShareable would throw); decide() serves FIFO head only (grant.ts:29-32); (d) JSONL telemetry outside store lock: <storeRoot>/events.jsonl and <common>/airi-verify/runs.jsonl; (e) do NOT merge configs into root; filter extra configs by turbo affected packages, optionally a second root vitest.browser.config.ts.
- qa-tools (st_01a1c30c): app/mcp/host/smoke each re-sequence launch->connect->onboarding->bridge->teardown (app/run.ts, mcp/session.ts, host/run.ts, smoke/run.ts); PageErrorCollector started in 3. Run dirs (all checkouts): smoke 33, host 25, motion 7, app 2, mcp/stage 0 visible. Doc mentions: motion 93, model 46, test 62, display 59, mcp 4. Stage measure needs quiet desktop (measure.ts:21-26, INVALID-CONCURRENT-LOAD). qa-tools has 60 test files, no browser tests.
- Test quality (st_01a1c30e): >=100ms fixed sleeps in 14 files (list in lane result: tamagotchi plugins/index.test.ts, InteractiveArea/voice-inlay/push-to-talk/ambient-light browser tests, minecraft brain.test.ts, audio browser.browser.test.ts, better-ws index.test.ts, cpu-slots vitest-wrapper.test.ts, provider-inference web-speech, stage-ui chat-history-scroll-container, voice-input-button); skips: widgets.test.ts:261, aliyun-nls token.test.ts:75; source-text tests: tool-call-block.test.ts:6; ~23 stage-ui store/state *.browser.test.ts candidates for node (unconfirmed).
- Docs (st_01a1c30d): testing rules in root AGENTS.md:112-169 (done list :133-138), .github/CONTRIBUTING.md:113-137, copilot-instructions.md:17-21, enforce-rules-for-vitest, motion-qa, use-vishot, agent-browser(-electron), use-agent-browser-for-airi, qa-tools README, dev-tools README, cpu-slots README, ADR motion-qa-levels, ~35 nested AGENTS CHECKS sections. Stale-command audit not exhaustive -> plan todo with scripted check.
- Agreement c39227bed5 (defer live QA) is needs-human; Luke drops it via /agreements.
- Memory: ~6 parallel heavy lanes -> load avg 128, host restart (notes/facts/2026-11-09-parallel-lane-load); browser batches flaked ERR_INSUFFICIENT_RESOURCES (reference/projects/dtuber-stage-ui-browser-tests).

## Decisions (with rationale)
- D1 (Luke): live QA is required in done criteria only for visible motion changes.
- D2 (Luke): live QA drops from `exclusive` to a sized lease.
- D3 (Luke): one plan covering C1-C6.
- Stance: batch renderer (consistent episodes in system/human/planning-style.md).
- D4 (Luke): start after luke/feat/linux-sensor-parity lands on main (precondition todo).
- D5 (Luke): plain `pnpm verify` = incremental from last passing tree per branch (fallback merge-base); `pnpm verify --gate` = full branch vs main, required once before landing.
- D6 (Luke): `qa:smoke` runs once in the branch gate for branches that change app runtime code; not per commit.
- D7 (Luke): affected-config filter + second root `vitest.browser.config.ts` (node root + browser root); no full merge.
- D8 (Luke): shared qa-tools session core; keep every command; trim duplicate docs; no removals.
- D9 (Luke): audit stage-ui store/state browser tests per file; move the ones needing no DOM/layout/audio to node/happy-dom; record reasons for keepers.
- D10 (Luke): TDD for pure parts, tests-after for the rest; agent QA always.
- D12 (Luke, 2026-11-10, answer to consultant F3): head aging exempts exclusive heads; exclusive tickets wait best-effort.
- Consultant st_01a1c348 (2026-11-10): 15 findings; folded F1 (fits/adopt ceiling), F2 (Must NOT reword), F4 (browser-project modules), F5 (precondition by file presence, not ancestry), F6 (mcp/measure acquire; capture:tamagotchi -> live), F7 (per-step record, Turbo package filter, fallback writes), F8 (status renders reasons via decide), F9 (12/12), F10 (2 -> 3 serial, matrix), F11 (history dir under XDG state), F12/F14 (ADR consequences), F13 (typecheck sizing note), F15 (event names, rotation race, todo 15/13 checks, cpu-slots AGENTS line), plus dev:top render checks and the --gate smoke reminder. F3 -> D12.
- D11 (Luke, 2026-11-10 scope expansion): add broker scheduling: backfill + head aging (todo 17), fair-share grants (todo 18), CPU-pressure admission (todo 19). Machine-derived budget left out (not selected). Evidence: private-store HOL reproduction; live 12/12 exclusive with two queued runs at load 3.1/16; lingering-child leak hypothesis refuted (orphans untracked instead).

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: approved (Luke: "Approve", 2026-11-10)
review: plan-consultant spawn refused ("plan-gated ... no such request was made"); plan-reviewer not attempted for the same gate. Structural self-check passed: 16 todos + F1-F4, every todo has Closes/References/Acceptance/QA/Commit/category, GAP-1..11 all closed. Pending: Luke runs /skill:ulw-plan or asks to review the plan to unlock plan-reviewer rounds.
approach: one plan, waves: W0 precondition (LSP landed) + baseline telemetry; W1 broker (live class, per-step lease handle, telemetry); W2 verify (incremental scope + last-pass record + --gate, per-step lease, affected-config filter, browser root, runs.jsonl, --stats); W3 qa-tools session core + class migration; W4 test hygiene + browser-test moves; W5 docs (testing guide, ADR, AGENTS/skills/READMEs/CONTRIBUTING trim, stale-command check) in separate agent-config commits; final wave F1-F4 incl. before/after measurement.
next: on approval write .omo/plans/test-qa-revamp.md, run plan-consultant, then plan-reviewer rounds.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Review ledger
- r1 (st_01a1c351, sha 0f8acb40...): REJECT, 1 blocker (B1: todo 6 drops stage-ui node project from verify coverage; eligibility: ideal_state_row_unmapped (IS-2 gate) / reproducible coverage loss, verified at verify-plan.ts:22 and stage-ui vitest.config.ts:74). Fix: node project extracted into root as stage-ui:node; list-equality + failing-test regression QA added. Ledger frozen after r1: {B1}.
- r2 (st_01a1c353, sha 8ddbb7e9...): REJECT; closed B1; new B2 (todos 17-19 QA expectations conflict under overcommit; fix: AIRI_CPU_PRESSURE_FILE fixtures, mid.psi for 17/18 re-runs, idle 5/5/5 owned by 19, busy loops dropped) and B3 (todo 12 inventory incomplete vs IS-7; fix: enumerate all store/feature/provider-inference browser tests via git ls-files, audit line per file). Progress: yes (closure + new eligible findings).
- r3 (st_01a1c355, sha 8694b15d...): REJECT; closed B2, B3; new B4 (root vitest.config.ts:35 already includes provider-inference browser project; todo 6 split incomplete). Fix: split provider-inference node/browser between roots, assert root has no browser files and classifies as test; scanned all root entries, provider-inference is the only browser project. Progress: yes.
- r4 (st_01a1c358, sha 4c8ae15c...): REJECT; closed B4; new B5 (old worktrees reject unknown class 'live': store.ts:150 commonRecord, :700-703 skip+delete after 45 s, so old code could grant exclusive beside a live lease). Fix: wire-encode live as class 'browser' + policy 'live' with NOTICE + removal condition; mixed-version QA via git archive of pre-change src on a shared private store; ADR consequence corrected; Must NOT compat line names the exception. Progress: yes.
- r5 (st_01a1c35b, sha 7479b30c...): OKAY, unconditional. Ledger {B1..B5} all closed. Rounds: 5. Final live-plan sha re-validated equal to approved digest.
