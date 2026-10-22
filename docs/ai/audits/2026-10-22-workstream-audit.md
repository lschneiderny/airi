# Workstream audit and next steps (2026-10-22)

Scope: every major workstream that landed on local `main` from 2026-10-17 to `639979638`. Each workstream was audited read-only against the current code by an independent auditor. The orchestrator spot-checked six citations from the first two reports against the repository, and all six matched. The per-workstream evidence lives in `.omo/evidence/audit-2026-10-22/` (git-ignored). Every follow-up table below is copied from those files with its citations.

Status vocabulary: `open` means confirmed still present on `main`; `resolved` cites the fixing commit or file; `superseded` means later work replaced it; `unverified` names the cheap check that would settle it. Severities run blocker, user-visible, dev-workflow, robustness, polish. Sizes are S (under 1 h), M (a day or less) and L (needs a plan).

## Executive summary

- **Everything planned has landed, and nothing is stranded on a branch.** All of these are on `main` with no unmerged work: cpu-budget, situational presence, qa-tooling, the motion-gate redesign, post-merge QA, natural-emotion-revamp, live2d-presence-v2 and emotion-expression-performance. The final verification for cpu-budget passed today at this exact tip. `pnpm verify --base origin/main` exited 0, and `pnpm qa:test --all` reported `NEW failures: 0`.
- **The state files have drifted from reality.** `boulder.json` still calls natural-emotion-revamp "paused", although it is complete and merged at `574483c2b`. live2d-presence-v1 is open, but v2 replaced the controller its last row would test. Both ADRs from the last three days still say `Status: proposed`. A stray untracked directory, named with a mangled `C:` path, sits in the repo root, and `stash@{0}` holds old v1 QA evidence.
- **One real broker bug can deadlock a process on itself.** It is rare, Windows-only and a small fix (cpu-slots F31 and F16 below). Everything else in the broker is hardening or documentation.
- **The test baseline is incomplete, and that now costs real time.** Some failures are unregistered, so concurrent runs report "new" failures that are not new:
  - three load-sensitive stage-ui tests (`hearing.analytics`, `live2d.browser`, `history.browser`);
  - 17 of the 23 pre-existing root vitest failures.

  The `nano-staged` pre-commit hook and the `pnpm verify` lint step can also overflow the Windows command line.
- **The repo-level checks are not all green.** `pnpm qa:doctor` fails on the Node version (v26.11.1 installed, 26.7.0 pinned). `pnpm test:run` exits 1 on 8 root files, 7 of them unregistered. Its `&&` chain then skips every package and browser suite. Typecheck and lint have 0 errors, but typecheck replayed its cache rather than compiling.
- **The stray untracked directory contains copies of `.env` files.** It sits inside the repo root, so a single `git add -A` would commit secrets. It also doubles the lint warnings. Deleting it is the most urgent item in this report.
- **Situational presence has the largest user-facing exposure.** No setting turns off sensing on its own; disabling unprompted speech still sends window titles to the model, cloud providers included. Several leader and follower and routing gaps predate the feature but became visible through it. The feature has never been used day to day.
- **The motion gate cannot certify itself yet.** The unmutated scorer validation still fails: noise 66 against a budget of 25, and 37 persistent checks, mostly on release. No plan or follow-up tracks it.

## Repo health on main

Sources: `.omo/evidence/audit-2026-10-22/f-health.md` (commands run from the main checkout through Windows `cmd`) and `f-git-hygiene.md` (orchestrator, read-only git).

| Check | Result | Note |
| --- | --- | --- |
| `pnpm typecheck` | exit 0, 2.0 s | All 57 turbo tasks were cache hits. This replays an earlier green run; it is not a fresh compile. No Godot/.NET task is in the turbo graph. |
| `pnpm lint` | exit 0; 0 errors, 1,298 warnings | All warnings come from `slop/*` rules. 649 of them come from the stray untracked worktree copy (see below), so the real repo has about 649. |
| `pnpm qa:doctor` | **exit 1** | The node-version check fails: this machine runs v26.11.1 and `.tool-versions` pins 26.7.0. Rig environment variables are unset (warning). |
| `pnpm test:run` | **exit 1**, 368 s | 8 files and 23 tests fail out of 447 files and 4,964 tests. Only the stage-shared `use-local-storage-manual-reset` file (6 tests) is registered in `known-failures.json`. These 7 files are not: cap-vite (2 files), plugin-sdk, ui-server-auth, api-server revenuecat, auth-server account deletion (8 tests, HTTP 403) and stage-tamagotchi static-assets paths. Several look Windows-specific (backslash paths, CRLF). The `&&` chain then stops, so the tamagotchi, web, pages, ui and live2d suites **never ran**. The 23 registered stage-ui entries could not be rechecked. |
| `pnpm verify --base origin/main` and `pnpm qa:test --all` | exit 0; `NEW failures: 0` | From cpu-budget final review F3 round 2, at this exact tip, earlier today. |
| Unpushed commits | 35 | The whole cpu-budget series; `main` is 0 commits behind `origin/main`. |
| Branches and worktrees | 9 branches, 1 worktree | The 8 `lschneiderny/feat/cpu-budget*` branches are fully merged and deletable. Only the main checkout remains as a worktree. |
| Stash | 1 | `stash@{0}` holds v1 QA evidence, on the deleted branch `luke/feat/live2d-presence-v1`. |
| Untracked | 4 entries | `.omo/plans/cpu-budget.md` and two cpu-budget drafts (the other 8 plans are committed), plus the **stray directory `C<U+F03A>/Users/Luke/projects/dtuber-wt/cpu-budget-w5/`**. That directory is a mangled-path copy of a worktree created today, and it **contains copies of git-ignored `.env` files**. |
| Tracked changes | none (Windows git) | WSL git reports 4,947 modified files, but `git diff --ignore-cr-at-eol` is empty, so that is line-ending churn from the WSL view only. |
| Dependencies | 2 major gaps | vitest 4.1.11 to 5.0.5, and typescript 6.0.3 to 7.0.2. vite, turbo, eslint and tsdown are only minor or patch behind. `@eslint/markdown` 8.0.3 is the latest, and eslint/markdown#619 is still open. |

## Cross-cutting themes

1. **Bookkeeping lags the code.** Plan statuses, ADR statuses, the memory notes and the known-failures registry all trail what actually landed. A future `/ulw-execute` resume could re-run finished work from a stale `paused` status.
2. **Windows command-line limits keep surfacing.** They affect the pre-commit hook (cpu-budget F11), the `pnpm verify` lint step during the presence final merge, and earlier the chunking `verify.ts` already does. One shared chunking helper would close all of them.
3. **The flaky-under-load tests are the cost of running things side by side.** The CPU budget made concurrent heavy commands safe, which exposed tests with thin timeouts or fixed sleeps. They need either fixing or explicit registration.
4. **Rendered acceptance relies on one Windows machine and two private rigs.** Linux and macOS behaviour is untested for:
  - the broker's POSIX path;
  - presence sensing, which never fires on non-Windows Electron;
  - the launcher on macOS;
  - the qa-tools process handling.

  CI no-ops the broker.
5. **Evidence that backs shipped claims is not in the repository.** ADR numbers cite `.omo/evidence/**`, which is git-ignored, so they cannot be reproduced from a clone.

## Decisions only Luke can make

| # | Decision | Recommendation | Unblocks |
| --- | --- | --- | --- |
| D1 | Delete the stray untracked root directory named with a mangled `C:` path (a copy of the cpu-budget w5 worktree, created today by a fix-wave worker's relative `git worktree add`; it **contains copies of `.env` files**) | Delete it now. It is untracked and generated by mistake. `git add -A` would commit secrets, and it doubles the lint warnings | Clean `git status` |
| D2 | Close live2d-presence-v1 as superseded by v2, and drop `stash@{0}` (v1 QA evidence only) | Close it. Its row 5 would test a controller that no longer exists | Removes a resume hazard |
| D3 | Presence privacy: add a master "share window titles" or "foreground sensing" switch, and decide whether cloud providers need an allowlist rather than a denylist | Add the switch; keep the denylist for local models and consider an allowlist for cloud models | The main privacy gap |
| D4 | Presence platforms: keep it Windows-only, or build macOS and Linux sensors | Document Windows-only for now; revisit after daily use | Sets scope for any presence plan |
| D5 | Motion gate unmutated failure: fix the release criterion or recipes, register the 37 checks as accepted, or revise the noise budget in a protocol 3. Also, who may authorize a retune? | Decide after one week of rendered use. Fixing release recipes is the honest fix but needs a golden-hash regeneration | A gate that can certify itself |
| D6 | Turbo global hash: keep the root devDependency on cpu-slots and accept that every cpu-slots edit invalidates the whole turbo cache, or schedule its removal | Accept it while cpu-slots is stable; fix the ADR wording that says "not accepted yet" | ADR and ledger consistency |
| D7 | `AGENTS.md:130`: is `AIRI_CPU_SLOTS=off` a supported opt-out, or is "never bypass" the rule? | A supported opt-out for one-off diagnosis, never for routine runs; reword the line | Agent guidance |
| D8 | Known failures policy: register the 3 load-flaky stage-ui tests and the 17 unregistered root failures, or fix them first | Register now with `removeWhen` conditions, then fix the cheap ones (fixed sleeps, cold-start timeouts) | Trustworthy `qa:test` and `verify` |
| D9 | Run live2d-presence-v3 from the stub, and treat the wlipsync 192 kHz real-device defect as in scope | Fix lipsync first (it blocks v2 row 25 and affects real voices); defer v3 until after daily use | Lip sync on real devices |
| D10 | Should poke or pet reach the chat model through `spark:notify`? | Defer; decide alongside presence pacing | Touch feature scope |
| D11 | T3 exclusive lease wait: add a bound and an exit code, or keep waiting forever | Add a generous bound, for example 30 min, with a clear exit code | Unattended T3 runs |
| D12 | Mark the dev-launcher and cpu-budget ADRs `accepted` | Yes | Docs consistency |
| D13 | Is parent `run.json` digest binding worth building? | Not now. The threat model is local and single-user | QA archive trust |
| D14 | Web-extension notifications never reach the stage (`destinations: ['character']`). Fix it inside presence work? | Yes, as a small presence follow-up | Extension notifications |
| D15 | Push local `main` to `origin` | Push after D1, D2 and D12, so the published history is consistent | Remote backup |
| D16 | Node version: update `.tool-versions` to the installed v26.11.1, or install 26.7.0, so `pnpm qa:doctor` passes | Update the pin after a green `test:run` on 26.11.1 | `qa:doctor` |

## Prioritized next steps

### Now: small, high-value, mostly S
1. **Workspace hygiene (S).**
   - Apply D1 and D2.
   - Flip natural-emotion-revamp to complete in `boulder.json`.
   - Commit the cpu-budget plan and drafts, which are still untracked.
   - Mark the ADRs `accepted` (D12).
   - Update the stale presence memory note.
2. **Broker deadlock fix (S).** One change for cpu-slots F31 and F16:
   - a post-commit busy must not discard a committed transaction;
   - pass the ticket id through `touchTicket` and `grant`;
   - add two fault-injection tests.

   This is the only path that can deadlock a process on itself.
3. **Test baseline (S to M).** Fix the `test:run` chain first, because today it hides every suite after the first failure.
   - Register or fix the three load-flaky stage-ui tests and the 17 unregistered root failures (D8).
   - Rerun the stage-ui browser project once to confirm the 16 flaky entries.
   - Make `pnpm test:run` run every suite, even when an earlier one fails.
4. **Windows command-line chunking (S).** Give nano-staged a function config that chunks the file list, and check the `verify` lint path that overflowed during the presence merge.
5. **Doc contradictions (S).** In one docs commit:
   - resolve `AGENTS.md:130` (D7) and the ADR turbo wording (D6);
   - document `entry-busy`;
   - convert the non-NOTICE comments in `tsdown.config.ts` and `doctor.ts`;
   - add the four missing T1 limitation notes in qa-tools;
   - fix `check-doc-paths` so it handles a missing `.temp/qa`.

### Next: product quality, M each
6. **Presence privacy switch (D3).**
7. **Presence correctness:**
   - lost follower sends on a leader reload (pre-existing);
   - web-extension notify routing (D14);
   - the voice-send race;
   - synced state growing from 27 to 54.5 KB per session;
   - measure the main-thread foreground FFI latency with a hung focused window.
8. **A packaged-installer smoke test of koffi.** This turns the H1 "false positive" from an argument into evidence.
9. **The wlipsync 192 kHz real-device defect** (D9).

### Later: plans, L
10. **The motion-gate unmutated finding**, after D5.
11. **cpu-slots hardening:**
   - snapshot failures inside the lock;
   - write-path EPERM;
   - an unbounded `entry-busy` wait;
   - marker retry;
   - crashed-build staging.

   Also rebuild `dev:top` CPU sampling from raw counters.
12. **Optional new work, decided after daily use:**
   - live2d-presence-v3;
   - macOS and Linux presence sensors (D4);
   - removing the root cpu-slots devDependency (D6).

## Risks

- **Untested platforms.** No rendered or broker evidence exists outside one Windows 11 machine. Presence never speaks unprompted on non-Windows Electron hosts.
- **Masked regressions.** Known-failures entries never expire automatically. The 16 flaky browser entries could hide a real regression in sessions-dialog and related files.
- **An unvalidated gate.** The motion gate has no validated false-positive rate beyond its A/A section.
- **Privacy.** Window titles reach cloud models, protected only by a denylist.
- **Unused feature.** Presence pacing and copy have never been tried in daily use.
- **Unpushed history.** Local `main` is ahead of `origin` and has no backup.

## Workstream details

### A. Live2D motion and emotion (natural-emotion-revamp, live2d-presence v1/v2, emotion-expression-performance, touch)

Source: `.omo/evidence/audit-2026-10-22/a-live2d-motion.md`.

#### Summary

- All four plans' code is on `main` (`639979638`). There are no live2d-presence or natural-emotion branches, and `git worktree list` shows only the main checkout.
- `natural-emotion-revamp` is paused only in `boulder.json`. It is stale: 16/16 rows are `[x]`, F1-F4 are APPROVE, Luke approved the merge, and it landed on `main` at `574483c2b`. Only the status field needs flipping.
- `live2d-presence-v1` is the one genuinely unfinished plan: row 5 (both-rig desktop QA) and F1-F4 are open. Its code (rows 1-4, 6-8) is on `main`, and v2 superseded its tuning and acceptance goals.
- Of the four ledger notes: routing and blink masking are now tested, and the gate catches constant amplitude. The `live2d.browser.test.ts` screenshot write is still open (now at lines 729/763, not 323). The compare/live parity caveat is documented in the ADR.
- Real open items: v2 partials 14/15/20/25 and expression-performance partials 26/35 (all accepted by Luke), the v3 stub, and a few polish items.

#### What shipped

**Commits (all ancestors of `main`).**
- Presence v1: `15d16f940`, `68b10f7a9`, `00ed03441`, `ce25b2ae0`, `690de0f6d`. They add the Natural controller, the adapter composed before SDK physics, and the settings.
- Presence v2: integration tip `a524482ea` (22 verified commits). Examples: `c7cab6fac` (gate on shift-amplitude dispersion) and `fd825d166` (routing and blink-handoff test).
- Expression performance: 32 verified commits, for example `8fa290f49`, `7f3a992dc`, `755b12022` and `bc86c5e42`. Touch landed as `6706300e0`.
- Natural emotion revamp: `4902913e1`, `1f0be0bb7`, `2ff5fb9c9`, `3862a2924`, `4d2e6030e`, `b2347d001`, `f6790bcac`, `f3b4ad1f5`, `d4a91ee52`, `9728f8d5b`, `4e7c27112`, and the F2 fix `574483c2b`.
- Later refactors and docs: `16a2d56dc` (expression store split), `59b9741ee` (natural-motion split), and `d3104d529` (ADRs and READMEs aligned with shipped behavior).

**Packages and surfaces.**
- `packages/stage-ui-live2d`: the `natural-motion/` directory (about 30 modules, including hold, gestures, impulses, mood, liveliness, emotion-score, touch, observer and trace), the adapter, the expression controller and the touch composables.
- `packages/stage-ui`: the performance conductor, Stage.vue routing, the settings UI, and the devtools Natural lab.
- Settings: Natural mode, Energy, per-model emotion strength, the held-emotions switch, and touch (`natural-touch`, `natural-touch-pet-requires-hold`, `natural-touch-head-scale`).
- Developer surfaces: the `/devtools/live2d-motion` lab, and the scripts `bench-natural.ts`, `extract-natural-reference.ts`, `score-natural-captures.ts`, `score-natural-trace.ts` and `replay-affect-trace.ts`.
- Gates: the liveliness gate (`liveliness-gate.test.ts`), plus the later motion-gate-redesign and qa-tooling gates.

#### Intent vs current state

##### Paused plan 1: natural-emotion-revamp (boulder `paused`, in fact done)
- **Rows.** Plan rows 1-12 and F1-F4 are all `[x]` (.omo/plans/natural-emotion-revamp.md:155-663). There are no `[ ]` or `[~]` rows.
- **Row 12 caveat.** It is checked as an "accepted partial by Luke 2026-10-19": rule 1 passed 22/22, and rules 2 and 3 are noise-limited (see the "Rendered acceptance noise" follow-up below).
- **Why boulder says paused.** `stale_since 2026-10-20T08:13Z` and `final_gate` show 16/16 rows, F1-F4 APPROVE, `luke_okay: "Approved, merge to main"`, `merged_main_at 574483c2b`, `pushed: false`. The ledger shows situational-presence was told to wait for this plan to land, which it then did. Nobody flipped `status` from `paused` to `complete` after the merge.
- **Branches and worktrees.** None remain (`git branch -a` shows only main, cpu-budget and the remotes; the worktree list is main only). The lane worktrees were removed with ledger receipts.
- **What resuming takes.** Nothing. Update `boulder.json` to `complete`, which is an S edit.
- **Superseded?** No. Situational presence later extended the same files (the ACT look cue, gaze, the observer), but it built on this work.

##### Paused plan 2: live2d-presence-v1
- **Rows.**
  - Done: 1, 2, 3, 4, 6, 7, 8.
  - Open (`[ ]`): row 5 "Run both-rig desktop motion QA and tune only demonstrated defects" (.omo/plans/live2d-presence-v1.md:565), and F1-F4 (:602-617).
  - No `[~]` rows.
- **Why it paused.** The ledger event `execution-blocked` for task 5 reads: "Native Chromium rejects background input; foreground grant not obtained; native accessibility unusable." Execution had also been steered once by task 8, which re-aligned the QA app after the wrong app version was used. Boulder status moved to blocked, then paused, and it has been stale since 2026-10-17T13:10Z.
- **On main versus elsewhere.** All v1 code commits are on `main`. Not on any branch: `stash@{0}` ("backup: local Live2D QA worktree before retirement", `3674f6990`). It holds only evidence (desktop-actions.jsonl, desktop-preflight.md, the task-1 probe) and a plan edit, and its diff against `690de0f6d` otherwise carries unrelated account-free and provider changes. Nothing product-relevant is stranded.
- **What resuming would take.** Run N1-N6 on both rigs with a foreground desktop grant, then F1-F4. In practice this has been **superseded**: v2 replaced the v1 controller (v1 followers "converge and hold", GAP-1 to GAP-3), and its rendered acceptance (v2 rows 14, 23, 24) covers the same N1/N5 scenarios on the same two rigs. Running v1's row 5 now would test a controller that no longer exists.
- **Recommendation.** Close v1 as superseded by v2. Do not resume it.

##### Completed plans (for context)
- **live2d-presence-v2**: complete (approved by Luke 2026-10-18). Rows 14, 15, 20 and 25 are `[~]` (accepted partials). Row 14 was later completed by rows 23 and 24 (both `[x]`), so its `[~]` is only a stale marker. Rows 15, 20 and 25 stand. The deferred IS-9 and IS-11 work lives in `.omo/drafts/live2d-presence-v3.md` (a stub with 4 candidate todos).
- **emotion-expression-performance**: completed. Rows 26 (rendered acceptance on ForBOOTH and Bear) and 35 (the partial IS-6 idle acceptance) are `[~]`; the post-merge QA audit lists both as accepted partials.

#### Follow-ups

| id | item | source | status | evidence | severity | size |
|---|---|---|---|---|---|---|
| A1 | boulder.json says `natural-emotion-revamp` is paused though it is complete and merged | boulder.json | open | `works.natural-emotion-revamp.status: "paused"` vs `final_gate.merged_main_at 574483c2b`; plan rows 16/16 | dev-workflow | S |
| A2 | `live2d-presence-v1` row 5 and F1-F4 never run; plan still shows paused | boulder, ledger `execution-blocked` | superseded | .omo/plans/live2d-presence-v1.md:565,602-617; v2 rows 14, 23, 24 | dev-workflow | S |
| A3 | `stash@{0}` (`3674f6990`) retained v1 QA evidence | git stash list | open | holds .omo/evidence/live2d-presence-v1 and a plan edit only | polish | S |
| A4 | Ledger note: no test covers Natural/Universal emotion routing or blink masking | v2 ledger, task 8 gate | resolved | routing: `stage-emotion-routing.browser.test.ts:187-435` (`fd825d166`, `9728f8d5b`, `29c9cd660`); blink: `live2d-blink-ownership.browser.test.ts:63,76` (`fd825d166`). I read the test names but did not mutation-test them | robustness | M (done) |
| A5 | Ledger note: constant-amplitude mutation passes the gate | v2 ledger, todo 5 gate | resolved | todo 16 added dispersion metrics `speedPeakP90P50` and `speedPeakLogAsymmetry` (liveliness-gate.test.ts:35-37, `c7cab6fac`). The rejections in the ledger named both a constant 0.35 shift and a uniform [0.1,0.5] shift. I did not re-run the mutation | robustness | M (done) |
| A6 | Ledger note: `live2d.browser.test.ts:323` writes screenshots into `.omo/evidence` | v2 ledger, todo 11 | open | the lines moved: `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.browser.test.ts:729-730` (v2) and `:763-765` (natural-emotion-revamp). The directory is gitignored (.gitignore:24), so nothing is committed, but every run writes into the evidence tree and the test depends on a relative `../../../../../../../.omo` path | dev-workflow | S |
| A7 | emotion-expression-performance compare/live parity caveat | ledger `verify-verdict` | resolved (documented, not removed) | docs/ai/adr/2026-10-18-expression-performance.md:293 states that on a timestamp tie, compare mode delivers the deadline first and the live conductor delivers playback first. The behavior remains by design | polish | S |
| A8 | v2 todo 14: rendered 600 s acceptance not met (ForBOOTH `speedPeakLogAsymmetry` 1.031 < 1.051; Bear jitter 1.24e-5 < 1.47e-5) | plan row 14 `[~]` | superseded in part | rows 23 and 24 (`[x]`) completed rendered acceptance; the `[~]` marker is stale | polish | S |
| A9 | v2 todo 15: Universal parity probe outside 15% on head SD (sdAngleY +21.8%, sdAngleZ -30.9%), attributed to the adapter constructor's extra random draw but not proven | plan row 15 `[~]` | open | v3 stub candidate 3 (.omo/drafts/live2d-presence-v3.md) | robustness | M |
| A10 | v2 todo 20: jitter metric not normalizable; controller has about 2.3x the recordings' >5 Hz share | plan row 20 `[~]` | open | v3 stub candidates 1, 2 and 4 | polish | L |
| A11 | v2 todo 25: real-device voice level reads 0 (pre-existing wlipsync@1.3.1 `processorerror` at 192 kHz); Bear emphasis enrichment 1.044 < 1.2 | plan row 25 `[~]` | unverified | needs a real-device audio run; todo 26 fixed the unit mismatch | user-visible | M |
| A12 | expression-performance rows 26 and 35 are `[~]` (rendered acceptance partials) | plan | open (accepted by Luke) | .omo/plans/emotion-expression-performance.md:568,643; post-merge QA audit line 40 | polish | M |
| A13 | Natural-emotion rendered acceptance (row 12): release and head-sign rules fail 18-61% and about 50% on emotion-free idle data. Luke deferred: "After we finish this plan, we will discuss better tooling for testing" | memory dtuber-motion-recordings | superseded | the qa-tooling plan added the session-stratified emotion significance (`91fe58a5f`, `989baba39`, `da50a8d16`) and a T2/T3 gate CLI (`d68afc5d4`, `21cece80f`, `44309fb9d`) | polish | S |
| A14 | Natural lab capture test still uses `expect.poll`, against the test rules | post-merge QA audit L4 | open (partly fixed) | override-change polling removed in `0091856a9`; one poll remains at `packages/stage-ui/src/features/devtools/motion/natural/devtools.browser.test.ts:270` | polish | S |
| A15 | Unused i18n key `live2d-natural-motion.emotions.intensity` | post-merge QA audit L2 | resolved | `521eb49af` | polish | S |
| A16 | ADR and README drift (cheek reserved, "never writes the mouth", `setEmotion` dedupe) | post-merge QA audit L5 | resolved | `d3104d529`; the v2 ADR now says Natural does not write `ParamMouthOpenY` while speaking or within 0.7 s after (ADR lines about mouth ownership, ~124) | polish | S |
| A17 | Touch has no chat reaction; the scene emits a `touch` event with nothing consuming it through `spark:notify` | docs/ai/adr/2026-10-18-live2d-touch-interaction.md:10 | open (deferred by design) | ADR line 10 | polish | M |
| A18 | v2 ledger task-completed notes: nearLimit band center penalizes zero clipping (N1), log/linear distance switch (N2), thin seed margins | v2 ledger | unverified | needs a read of the gate code and a seed sweep | robustness | S |

#### Open decisions raised by the auditor

1. **Close v1 as superseded?** I recommend yes: mark `live2d-presence-v1` as superseded by v2 in boulder and plan, and drop stash `3674f6990`.
2. **Flip natural-emotion-revamp to complete** in boulder (it is already approved and merged). This is bookkeeping only.
3. **Whether to run live2d-presence-v3.** It would cover the deferred IS-9 and IS-11 items: controller high-frequency smoothing, a dedicated tail gate, quantitative Universal parity, and multi-capture acceptance rules. Luke has not answered the scope question (the ledger says the orchestrator took the recommended option after 30 minutes).
4. **Real-device lipsync.** Is fixing the wlipsync 192 kHz defect in scope? Without it, v2 row 25 cannot be closed.
5. **Touch to chat.** Should poke or pet reach the chat model through `spark:notify`, or stay visual only?

#### Risks

- **Stale status.** `boulder.json` shows two plans as paused when one is complete and the other superseded. A future `ulw-execute` resume could pick up either one and re-run finished work.
- **Evidence directory.** `.omo/evidence/` is gitignored and `.omo/evidence/natural-emotion-revamp/` keeps only four PNGs (post-merge QA audit line 41). The rendered-acceptance proof for this plan survives only in the ledger.
- **Browser tests write into the evidence tree** (A6). A run from a different working directory would break the relative path or write elsewhere.
- **Noisy gates.** Single 600 s captures are noisy judges (Bear still2 was 0.31 and then 0.47 on identical code); only the 3-run mean rule satisfied v2 parity.
- **Platform.** Idle detection reports unknown on Linux Wayland (`a16d67a45`). The 192 kHz lipsync defect is unverified on macOS or Linux. Rendered QA only ever ran on one Windows machine with two private rigs.
- **Audit limits.** I did not run any tests. The A4 and A5 "resolved" calls rest on test names, commit messages and ledger text, not on a mutation re-run.

#### Recommended next steps

1. **Finish (S):** update `boulder.json`: `natural-emotion-revamp` to complete, `live2d-presence-v1` to superseded. This removes the resume hazard.
2. **Finish (S):** drop `stash@{0}` after confirming with Luke (decision 1).
3. **Fix (S):** make `live2d.browser.test.ts` screenshot paths resolve from a repo-root helper or an env override (A6), and replace the remaining `expect.poll` at devtools.browser.test.ts:270 (A14).
4. **Fix (S):** change the v2 row 14 marker to `[x]` or add a note citing rows 23 and 24 (A8).
5. **New work (M):** an optional mutation re-run of the constant and uniform amplitude cases against the current gate, to turn A5 from "resolved by history" into "resolved by evidence".
6. **New work (M-L):** only if Luke wants it, plan v3 from the existing stub (A9, A10). Fix the lipsync 192 kHz defect first, because it blocks A11.

### B. Situational presence

Source: `.omo/evidence/audit-2026-10-22/b-situational-presence.md`.

#### Summary

- All 49 todos plus F1-F4 (53/53 rows) of `.omo/plans/situational-presence.md` are ticked `[x]`. `.omo/boulder.json` says `status: complete`, with integration tip `6ff2b87d5` merged to main and not pushed.
- The feature is Electron-on-Windows only. Web and Pocket exclude the Presence page. Kirie now hides the page (`fdd3f8229`) and never starts the situation store.
- The post-merge QA items are fixed: M2 Kirie page, M3 Presence test fixture (`801ff9b19`), and H1 koffi packaging, which was a false positive and shipped no change.
- The code gaps that remain are the ADR "Consequences" caveats, which are open. The most serious are the unmeasured main-thread FFI latency, untested macOS/Linux behavior, and the voice-send race.
- No situational-presence row is `[~]`. The `[~]` that the brief mentions is todo 3 of the separate `cpu-budget` plan (boulder lane verdict, ledger line 1469).

#### What shipped

Commits run from `d59c5f36c` (situation types) to `6ff2b87d5`, plus post-merge `fdd3f8229` and `801ff9b19`. They include many `chore(...): land ... on situational presence` lane landings.

- **stage-shared (`src/situation/`):**
  - Types, title normalization, the pure reducer, and the budgeted block renderer.
  - The opportunity gate (`gate.ts`; busy states held at `gate.ts:227`).
  - The `foreground-window` store.
- **stage-tamagotchi:**
  - Foreground-window main service via koffi (`src/main/services/electron/foreground-window.ts`) and a renderer producer (`renderer/stores/foreground-window.ts`).
  - koffi added as a dependency (`package.json:122`) and externalized in `electron.vite.config.ts:45`.
- **stage-ui:**
  - Situation store with sensors for foreground, desktop, conversation, stage, context, notify and Minecraft (`stores/situation/`).
  - Presence settings document `settings/situation` (`features/situation/settings.ts`).
  - Unprompted turns, spark-notify observe and gate, and widget reactions as forced unprompted turns.
  - Retirement of the side-path notification speech.
  - Devtools inspector backend over Eventa and a BroadcastChannel (replacing synced actions), plus the ACT-compliance store.
- **stage-pages:** the Settings > Presence page and the devtools Situation inspector (gate trace, spend panel, ACT compliance).
- **core-agent:** `origin: 'unprompted'`, the `<|SILENT|>` decline contract (provider aborted on decline), tool-free unprompted turns, cue stats, and recovery or stripping of malformed ACT/DELAY markers (`recovered-cue.ts`).
- **pipelines-audio and stage-ui-live2d:** bare-word ACT, the `look` cue and the screen/aside gaze behaviour.
- **i18n and docs:**
  - Character-neutral stage contract in `base.yaml`.
  - ADR `docs/ai/adr/2026-10-19-situational-presence.md` and four README updates.

Exposure: Settings > Presence (Electron), the devtools Situation inspector, and the stub-LLM QA tooling.

#### Intent vs current state

The delivered behaviour matches the ADR and plan:

- **Four layers:** sensors, then the situation model, then the gate, then delivery through the normal chat runtime.
- **Gate and veto:** the code gate decides when a moment exists, and the model may veto with SILENT.
- **Spark notifications:** observed and gated instead of spoken directly.
- **Final gate:** F1-F4 APPROVE (F4 on its third attempt) and a 53/53 row audit.

Caveats on the delivery:

- **Never run in daily use.** The pacing constants are starting values and, per the ADR, "untested in daily use".
- **Platform coverage.** Windows is the only platform with a sensor. On other Electron hosts the gate holds on `stale-signal`, which the ADR says "has not been run on macOS or Linux".
- **Intentional leftovers.** Lowercase `[delay 1s]` and a few rare forms stay spoken, and `<DELAY 1s>` is forwarded and rejected (memory note, 2026-10-21 checkpoint). This follows the plan.
- **Local-only memory note.** The note `dtuber-situational-awareness.md` is at `/mnt/c/Users/Luke/.omo/memory/agents/dtuber-26755dfe/repo/reference/projects/` (the Windows-path form does not resolve). Its last checkpoint predates completion and is stale.

##### Per-host status
| Host | Status | Evidence |
| --- | --- | --- |
| Electron on Windows | Works. Sensor, store, gate, settings page and inspector are all present. | `Stage.vue`, `apps/stage-tamagotchi/src/renderer/App.vue` |
| Electron on macOS/Linux | The block renders. The foreground sample stays null, so the gate never fires. Not run. | ADR Consequences |
| Web | The page is excluded (`apps/stage-web/vite.config.ts:173`). `App.vue` references the store, which renders the block without presence data and runs no gate. | ADR "Other hosts" |
| Pocket | The page is excluded (`apps/stage-pocket/vite.config.ts:160`). Otherwise the same as web. | same |
| Kirie | The page is excluded (`apps/stage-tamagotchi-kirie/kirie.config.ts:153`, `fdd3f8229`). The situation store is not initialized, so there is no block and no gate. | ADR, QA audit M2 |

##### Privacy and permissions
- **On by default:** `unpromptedEnabled` true, `chattiness` 0.5, `showUnpromptedCue` true, `speakDuringGames` true (`features/situation/settings.ts:20-32`).
- **Off by default:** `dontDisturb`.
- **Default lists:** `quietApps` zoom, teams and webex (`settings.ts:26`); `titleDenylist` 1password, keepass, bitwarden and keepassxc (`settings.ts:28`).
- **Window titles** go to the model, cloud providers included, after normalization and a 120-character cap. A denylisted exe reports its app but no title (`sensors/foreground.ts:143`). Titles are not written to history or sync, and the state is in-memory only.
- **Screen watching** here means gaze attention (`screen` for game or media), driven by the foreground category. It is not capture. Screen capture or vision remains the older, separate feature.
- **Gating:** the settings feed the gate (`stores/situation/index.ts:394-399`).
- **No master off-switch for sensing.** `unpromptedEnabled=false` stops speaking, but the foreground sampler and the per-turn block with titles are not gated by a setting that I found. This is raised as decision D1 below.
- **Evidence redaction:** a sweep redacted real window titles in `.omo/evidence` (memory note, 2026-10-21).

#### Follow-ups

| id | item | source | status | evidence | severity | size |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Kirie exposed a Presence page whose toggles did nothing | QA audit M2 | resolved | `fdd3f8229`; `kirie.config.ts:153` | user-visible | S |
| P2 | Presence page test failed on narrow width (380 px content-box textareas) | QA audit M3 | resolved | `801ff9b19`, `c44e75fc1` | dev-workflow | S |
| P3 | Packaged build drops koffi runtime code (`src/` excluded) | QA audit H1 | resolved (false positive, no change). See U1 | QA audit Resolution row H1. `electron-builder.config.ts:100` still has no koffi re-include. | blocker if true | S |
| P4 | Foreground FFI calls run synchronously on the main thread once per second. Latency was never measured, for example with a hung focused window. | ADR Consequences | open | ADR "Windows only"; sync FFI in `foreground-window.ts` | robustness | M |
| P5 | Non-Windows Electron never speaks unprompted. Gate holds `stale-signal`. Not run on mac or Linux. | ADR | open | `gate.ts:227`; ADR | robustness | M |
| P6 | Spend panel under-reports declined turns, because usage after the abort is dropped | ADR | open | ADR "Token spend" | polish | S |
| P7 | Voice send race: a widget reaction's quiet wait ends when speech stops, before STT submits. The first words may play before the user send cancels it. No test. | ADR | open | ADR "Voice sends" | user-visible | M |
| P8 | Client-role widget request times out in 30 s total, with up to 20 s spent in the quiet wait. The client can show the fallback while the main window still speaks. | ADR | open | ADR "Widget budget" | robustness | M |
| P9 | If the audio host dies mid-speech, `characterSpeaking` stays true until the next leadership. | ADR | open | ADR "Gate details" | robustness | M |
| P10 | A fire just before minimize can still speak while hidden. | ADR | open | ADR "Gate details" | polish | S |
| P11 | Reaction not shared if leadership changes during a gate-fired notify turn. | ADR | open | ADR "Lost shared reactions" | polish | S |
| P12 | The web extension sends `spark:notify` with `destinations: ['character']`, and no stage peer matches it. Its notifications never reach the situation. Pre-existing. | ADR | open | `plugins/airi-plugin-web-extension/src/background/client.ts:135` | user-visible | M |
| P13 | A follower window can lose sends when the leader reloads mid-speech (`requestStopSpeaking` waits forever). Pre-existing on main. | ADR | open | ADR "Pre-existing gaps" | robustness | M |
| P14 | The context bridge watches the `airi-spark-notify-bridge` channel only after the server channel connects. Client widget requests then time out to fallback. | ADR | open | `stores/mods/api/context-bridge.ts`; ADR | robustness | M |
| P15 | Pacing defaults (about 4 per hour, 10 min gaps, duration remarks at 30 min and 1 h) are untested in daily use. They may feel mechanical. | ADR; plan "Decisions to sanity-check" | open | ADR "Pacing" | polish | M |
| P16 | Some malformed-cue forms stay spoken by design: lowercase `[delay 1s]` and rare forms. | memory note 2026-10-21 | open (accepted) | plan todos 47 and 49 | polish | S |
| P17 | The memory note's last checkpoint is stale (it says the plan is unfinished). | memory note | open | note body | polish | S |

#### Open decisions raised by the auditor

- **D1.** There is no setting that turns off sensing, as opposed to speaking. Foreground sampling and the titles in the situation block stay active when `unpromptedEnabled` is false. The plan chose "full titles with only a denylist". Decide whether to add a master "share window titles" or "foreground sensing" toggle, and whether the denylist should become an allowlist for cloud providers.
- **D2.** Whether to ship non-Windows sensing (macOS/Linux) or document the feature as Windows-only.
- **D3.** Whether to fix the web-extension `destinations` mismatch (P12) here or leave it as pre-existing.
- **D4.** Whether pacing needs retuning after daily use (P15).
- **D5.** The brief mentions "the plan row annotated as an accepted partial". Nothing in `situational-presence.md` is annotated that way, so this is a contradiction between the brief and the repo. The `[~]` is on `cpu-budget` todo 3. Confirm which row you meant.

#### Risks

- **Stale evidence for packaging (U1):** the H1 false-positive claim rests on `electron-builder --dir` builds recorded in the QA audit. I did not rerun them. koffi is not re-included in the file matcher, so the claim holds only if electron-builder's dependency collection behaves as the audit probed. A `--dir` build is not an installer smoke test.
- **Untested paths:** the voice-send race (P7), mac/Linux (P5), the FFI hung-window latency (P4), and leadership changes (P9, P11, P13).
- **Known flaky tests:** `airi-card-sync.browser.test.ts` fails under load (QA audit final state). The 23 root and 24 Node-26 `localStorage` failures are baseline, not caused by this workstream.
- **Privacy surface:** window titles go to cloud models. Only the denylist protects the user, and sensing cannot be disabled on its own (D1).
- **Live-QA depth:** Windows-only QA through an Electron stub LLM. There is no real-provider daily-use evidence.

#### Recommended next steps

1. **Finish or fix: run a packaged installer and smoke-test koffi (U1/P3).** This turns the false-positive claim into direct evidence. Size S.
2. **Decide D1 and add the sensing toggle if wanted.** It is the main privacy hole. Size S to M.
3. **Finish or fix: measure the main-thread FFI latency, including a hung focused window (P4).** If it is bad, move the sampling to a worker or use async calls. Size M.
4. **Finish or fix: cover the voice-send race (P7) with a test and a fix, and fix the web-extension destination (P12) if D3 says yes.** Size M each.
5. **Update the stale memory note (P17), then use the feature for a week to retune pacing (P15).** Size S.
6. **New work, only if wanted: macOS/Linux foreground sensors (D2).** Size L.

Unverified (U): U1 is the packaged installer claim in P3. I also did not confirm that the foreground main service guards on `win32` (a grep for `platform` in the file found nothing). The ADR states that non-Windows stays null, but I did not trace that guard. Running the service's win32 tests, or reading `foreground-window.ts` near the koffi load, would settle it.

#### Additional follow-ups from the plan ledger

Source: `.omo/ulw-execute/ledger.jsonl`, entries whose `plan` contains `situational-presence` (402 entries). These entries carry follow-ups that the plan's execution flagged "for the final report". The auditor (b-situational-presence.md) did not see them because its query used the plan name, while the ledger stores the plan path. Each item cites the ledger task and event. None was re-verified against `main` in this extract.

##### Pre-existing defects surfaced during execution (on `main` before the feature)
- **Lost follower sends.** `requestStopSpeaking` awaits forever across a leader reload, so follower-routed sends are lost or delayed 1-4 min (stall investigation-closed).
- **Web-extension notifies never reach stage windows.** The server delivers by destination, so `["character"]`-only notifies never arrive. A notify forwarded with no leader is lost. The simulator re-sends commands (26 task-completed).
- **Minecraft store label mismatch.** `minecraft-bot` vs `<name>:<instance>`, so bot text is never saved (12 task-completed; w2c lane-finished).
- **A chunk split inside `</think>` speaks "/think>"** (5 adversarial-verify).
- **DataCloneError at startup** from a synced store; the investigation attributed it to the QA setup's ensureProvider (18 task-completed; stall investigation-closed).

##### Feature residuals (branch-introduced or accepted)
- **Synced domain state grows from 27 to 54.5 KB over one session** (pinia-plugin-synced op records) (F3 final-gate-result).
- **Residual spoken cue forms outside plan scope:**
  - `[delay 1s]`/`[Delay 1s]`, `[act {..,}]`, `[DELAY one second]`, `[ACT happy,]` (F4 task-completed);
  - `[[ACT happy]]` leaves stray `[]`; `[ACT happy|>` is never recovered; the categorizer treats an unknown `<word>` as a tag (37 task-completed);
  - angle forms count as recovered even though the stage rejects them (F4).
- **A stale `system:situation` entry is re-sent after a dev HMR.** A reconnecting plugin keeps its old context until decay (w2c lane-finished).
- **`selfAppIds` is taken from the first own sample.** That sample could be the Godot id. The dev `electron.exe` is hidden (18 task-completed).
- **Kirie shows did-not-answer instead of not-started.** Store dispose does not unregister handlers (40 task-completed).
- **A leader change mid-turn loses the share.** The default start connects the server channel on port 6121 (28 adversarial-verify).
- **Declined turns may under-report token spend** in the inspector spend panel, because onUsage drops usage reported after the stop (25 carry-forward).
- **Repeated Evaluate can exceed the hourly cap** (by design). Spend counts reset on a leader change (25 adversarial-verify).
- **Harden `retrySourceIndexFrom` against cue rows.** There is an 8 px gap when the cue is hidden (22 task-completed).
- **The dark-mode situation block background has low contrast** (14 task-completed).
- **Salience order between notifications and contexts is undecided**: should notifications always outrank contexts? (35 task-completed).
- **Speech has no grace window.** A reaction can start before STT submits; the user's send then cancels it (43 task-completed).
- **An auth error appears when opening settings** during F3 (F3 final-gate-result).
- **Presence edge cases:** Linux Wayland reports unknown presence; idle-detected absence with a short auto-lock; promotion during a lock; suspend event timing (42 task-completed, N1-N4).
- **Non-Windows Electron hosts never speak unprompted,** because the foreground sample is null. F4 judged this in scope (F4 carry-forward).
- **Idle and thinking camera still follow the cursor.** The `Model.vue` screen-gaze change has no unit test of its own (38 task-completed).

##### Process and tooling notes
- **The `pnpm verify` lint step hits the Windows command-line limit.** The final merge was committed with SKIP_SIMPLE_GIT_HOOKS (final-merge step 1 done-claim). This is the same root cause as the nano-staged pre-commit overflow.
- **A semantic merge conflict was fixed.** `scenario-sink.ts` now parses synchronously. The workspace dependency `@proj-airi/pipelines-audio` was added to qa-tools, accepted by the orchestrator (final-merge sink fix).
- **Input-safety incidents during QA:** worker typing reached real user windows (25 done-claim). Real window titles leaked into evidence and were later redacted (evidence redaction sweep).

### C. QA tooling and the motion gate redesign

Source: `.omo/evidence/audit-2026-10-22/c-qa-motion-gate.md`.

#### Summary

- Both plans (`qa-tooling` rows 1-26 + F1-F4, merged at `63661cb83`; `motion-gate-redesign`, merged at `3ff383f84`) are complete, and `main` has no later changes to `packages/qa-tools`.
- All four "Luke decisions remain" items from todo 13 (x0 scope, deterministic side, 0.5 boundary, unmutated 100%) were answered: Luke approved the K1-K4 options on 2026-10-21, and `docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md` records them.
- The unmutated validation section still fails (37 persistent checks; noise 66 against a budget of 25). Nothing tracks it except `findings.md`, the ADR and README prose; it needs a decision from Luke, and no plan or boulder follow-up exists.
- The 8 qa-tooling follow-up entries break into 20 separate items: 7 resolved, 10 open, 3 unverified. Most open items are small doc or tidiness gaps; the one large open item is the unmutated validation failure.
- T2 is not just a spike: ADR GO by path A, `src/t2/`, and `gate --level t2` all ship. Full T1 emotion gate cost is 294.6 s (quiet) and 415.6 s (loaded); the smoke subset takes 44.7-65.0 s; the T3 liveliness gate is 3 x 600 s captures; a full protocol-2 validation took 2652 s on 15 workers.

#### What shipped

- `packages/qa-tools` (`@proj-airi/qa-tools`), 38 commits in `8ba043df0^..3ff383f84`. Source layout: `src/env` (doctor, pnpm pin, process kill helpers), `src/known-failures` (registry and diff), `src/evidence` (run dirs, archive), `src/motion` (T1 sim, gate, validation, result cache), `src/t2` (headless ForBOOTH rig with Cubism Core), `src/t3` (rendered bridge client, launch, cursor park, teardown, rig import, screenshots), `src/report` (HTML review report), `src/prod-bundle`.
- Scenario contract `@proj-airi/stage-shared/motion-scenario` and the dev-only Eventa bridge (`use-motion-qa-bridge`), reached over remote debug.
- Root scripts: `qa:doctor`, `qa:motion`, `qa:report`, `qa:test` (`package.json:35-38`); skill `.agents/skills/motion-qa/SKILL.md`; ADRs `2026-10-20-motion-qa-levels.md` and `2026-10-21-scorer-validation-protocol-2.md`.
- Follow-up commits: `bbab1496d` (chess stub removed), `ec9e8bdba` (20 s budgets on head-variability tests), `0733c5df7` and `f2f4740c6` (T3 posture home and `posture-home` archive invariant).
- Motion-gate redesign (all inside the validation harness; gates and Natural code untouched, golden hash unchanged): K1 x0 now includes held-only size, K2 `ignore-side` and `ignore-side-neg` with a `notMutable` trace-equality proof, K3 paired x0.5 `sizeCalibration` (quotient at most `Math.SQRT1_2`), K4 persistence (4 of 5 sets) plus a Binomial(N, 0.01) q0.99 noise budget.

#### Intent vs current state

- Levels T0-T3 delivered as the ADR states. T2 was meant to be a go/no-go spike, and it went GO: parity difference 0 over 600 frames and 281 parameters, 55.19x real time with mesh deformation skipped (ADR consequences). T2 is exposed as `qa:motion gate <emotion|liveliness> --level t2 --rig forbooth` (README:18). T4 is Luke's visual check and is not tooling.
- Deferred or accepted-as-is: row 22 (smoke timing recorded, not asserted), row 23 (four protocol-1 limits moved to the redesign plan, which is done), and the T3 runs from 2026-10-20 that Luke accepted despite desktop interference. A rescore of that accepted run now exits 2 on the `posture-home` invariant (home was `product`), so it cannot be re-scored.
- The redesign met its end state for K1-K3 (x0 324/325, ignore-side 72/72, x0.5 calibration 174/174). K4 did not: validation exits 1 by design, and the ADR labels this a finding, not a defect.
- `.temp/qa` is absent in the main checkout (no gate runs retained); evidence lives in `.omo/evidence/qa-tooling/` and `.omo/evidence/motion-gate-redesign/` (the post-merge audit notes the task-17 run folder is gone).

#### Follow-ups

Boulder `works['qa-tooling'].followups` has 8 entries (5 nested groups with 17 items, plus 3 plain strings). Each item is listed separately.

| id | item | source | status | evidence | severity | size |
|---|---|---|---|---|---|---|
| F1 | T3 bridge does not apply the scenario posture home | boulder string 1 | resolved | `0733c5df7`, `f2f4740c6`; README:95-97; `use-motion-qa-bridge.test.ts` | user-visible | S |
| F2 | Parent gate `run.json` does not bind the session `run.json` digests | boulder string 2 | open | `t3-archive.ts:13-15` ("does not authenticate `run.json` itself"); SKILL.md:42 (manifest is trusted); README:108 | robustness | M |
| F3 | Head-variability test 5 s budget thin under load | boulder string 3 | resolved | `ec9e8bdba`; `natural-motion.test.ts:306,654` (`20_000`) | dev-workflow | S |
| F4 | `doctor.ts` types-condition skip comment not in NOTICE format | todo 2 review | open | `doctor.ts:94-95` (plain `//`, no NOTICE, no removal condition) | polish | S |
| F5 | Doctor warm-up `child.kill()` may orphan Chromium on Windows | todo 2 review | resolved | `doctor.ts:302-309` (`killOwnedTree`/`killTree`) | robustness | S |
| F6 | README should document stray-electron cross-worktree false positives | todo 2 review | resolved | README:126 (other worktrees never match; doctor row uses the whole-path rule) | polish | S |
| F7 | `bench-natural` after/base ratio unconfirmed under load (todo 6) | todo 6 review | resolved | `.omo/evidence/qa-tooling/task-18-bench-quiet.txt` (wall 0.9944, cpu 0.9655, PASS under 1.05); `task-18-gate-review.md:7` (independent 1.0418) | robustness | S |
| F8 | ACT marker with only `expression` throws at T1; document as T1 limitation | todo 8 review N2 | open | No limitation text found in README or SKILL (grep: README:129 only mentions the smoke ACT marker); the source `queues.ts` parser was not re-read | polish | S |
| F9 | `motion-scenario` accepts events past `durationSeconds` | todo 8 review N4 | resolved | `scenario.test.ts:35` (event at 5.5 in a 5 s scenario yields issue `events.1.at`) | robustness | S |
| F10 | Sample spacing 0.025-0.042 s; window means not uniform | todo 8 review N5 | unverified | Routed to the todo 9 scorer; would be settled by reading `samples.ts` for window-mean use | robustness | S |
| F11 | T1 traces never show catalog expressions; document as T1 limitation | todo 8 review N1 | open | README:123 describes id mapping only; no T1 limitation statement found | polish | S |
| F12 | Multi-trial NaN drop and modulation guards proven only by scratch probe | row 19 review | unverified | Would be settled by grepping `emotion-score.test.ts` for multi-trial NaN cases | robustness | S |
| F13 | Visibility is uninformative when the idle null never moves (eyeSmile/cheek at T1); document | todo 12 r2 B4 | open | Findings.md reports zero-spread channels separately, but README/SKILL have no T1 statement | polish | S |
| F14 | `QA_RUN_DIR` in a dev shell makes the plain package test pick up gate files; document | todo 12 r2 | open | README:135 only says `QA_RUN_DIR` is excluded from the cache key; no dev-shell warning | dev-workflow | S |
| F15 | Zero-spread test asserts reason prose and an unfailable no-Infinity check | todo 12 r2 | unverified | `Infinity` no longer matches in any `qa-tools` test (grep empty), so the check may be gone; the prose assertion was not located | polish | S |
| F16 | Unmutated validation fails: 37 persistent checks, noise 66 against budget 25 ("genuine release/recipe finding") | ledger todo 6, F4 | open | `.omo/evidence/motion-gate-redesign/findings.md:209-211`; ADR protocol 2 Findings; README:87-89. Tracked only as prose: no boulder follow-up, no plan | user-visible (gate cannot certify itself) | L |
| F17 | Summary-label assertions are prose-coupled | ledger F2 | open | `validation.test.ts:141-144` (`toContain('Mutation ignore-side (')` etc.) | polish | S |
| F18 | `evaluate.ts` is large | ledger F2 | open | `packages/qa-tools/src/motion/validation/evaluate.ts` is 513 lines, the largest in `validation/`; `t3-gate.ts` is 500 | polish | M |
| F19 | `check-doc-paths` fails without `.temp/qa` | ledger todo 7 | open | `.temp/qa` absent on main (`ls`); `scripts/check-doc-paths.ts:66` is plain `existsSync` and the docs cite `.temp/qa` paths; last touched `9c3cc71bf` | dev-workflow | S |
| F20 | `pnpm verify` fails on main because `airi-plugin-game-chess` lacks `vue-tsc` | memory note | resolved | `bbab1496d`; memory note: a full `pnpm verify` passed after removal | dev-workflow | S |

Tallies: open = F2, F4, F8, F11, F13, F14, F16, F17, F18, F19 (10); resolved = F1, F3, F5, F6, F7, F9, F20 (7); unverified = F10, F12, F15 (3).

Other things you asked about:
- **What does addressing F16 mean?** The ADR rules out retuning gates, thresholds, recipes or protocol constants inside the validation work. "Addressing" is therefore a separate, Luke-approved plan with one of three outcomes. (a) Fix the release criterion or recipes: 31 of 37 persistent checks fail on release, 34 of 36 noise keys fail on release, and `curious`/`surprised` eyelid, `surprised` mouthForm, and `love` head/body are named. (b) Accept the checks as documented failing keys (for example, in the known-failures registry or a gate exclusion list). (c) Re-register a noise budget based on the measured 4.4% rate. Option (a) touches Natural recipes or gate rules, which would also require regenerating the golden hash; option (c) changes the pre-registered protocol and so needs a protocol-3 ADR.
- **Real-world cost:** On a quiet 16-core machine at the integration tip the full T1 emotion gate took 294.6 s (target 300 s), 415.6 s under load (SKILL.md:52). The angry/strong smoke subset took 44.7-45.5 s (executor) and 65.0 s (independent) against a 60 s target; Luke accepted this. The T3 liveliness gate is three 600 s captures, the T3 smoke scenario is 140 s of scenario time, and the full `validate-scorer` run took 2652 s on 15 workers (README:20, `findings.md`). The ledger notes a prior T3 rerun cost about 33 minutes after cursor interference.
- **T2 headless rig:** exists. `src/t2/rig.ts`, `core-node.ts`, `runner.ts` ship; ADR GO by path A; README:81 has a "T2 status" section. It requires `AIRI_QA_RIG_FORBOOTH` and a local Cubism Core, which are non-distributed (so T2 cannot run in default CI).

#### Open decisions raised by the auditor

1. **The F16 unmutated failure.** Choose fix recipes/release criterion, accept with registry entries, or revise the noise budget (protocol 3). Until then `validate-scorer` exits 1 by design and `qa:test --all` cannot treat it as green.
2. **Whether to keep the contradiction between "gate failures remain findings, never authorize retuning" (ADR) and the need to ever get a green validation.** This needs an explicit statement of who may authorize a retune and in which plan.
3. **Decide whether F2 (parent digest binding) is worth the work.** The current trust model accepts a manifest rewritten together with its digests (SKILL.md:42); closing it needs a signed or external anchor.
4. **Decisions from the todo 13 note, status:** x0 scope (K1), deterministic side (K2), the 0.5 boundary (K3) and unmutated 100% (K4) were all decided by Luke on 2026-10-21 ("approve" after a two-question timeout, per the memory note), and the ADR is `accepted`. One caveat: that approval came as a plain "approve" after a timeout, not as an explicit per-option choice. The plan reviewers were refused by the plan gate, so only a self-review occurred; confirm this is acceptable.
5. **The ulw-plan harness gate refusal** (consultant and reviewer refused because the plan was not started by an explicit skill request) means the redesign plan never got an independent plan review.

#### Risks

- No gate has certified itself: unmutated fails, so the committed gates have no validated false-positive rate beyond the A/A section (A/A passed: 0/5340 per check).
- T3 depends on a quiet desktop (cursor parking); runs accepted on 2026-10-20 were interference-affected and cannot be rescored (`posture-home`).
- The `.temp/qa` evidence is gone from main, so the `check-doc-paths` failure (F19) is the normal state for any fresh checkout; CI or worktrees will hit it.
- Platform: the tooling is Windows-first (`taskkill`, cursor parking, PID reuse lessons). Linux/macOS paths were not exercised in anything I found; the POSIX process-group kill is documented but not demonstrated.
- T2 and T3 need local assets (`AIRI_QA_RIG_FORBOOTH`, Cubism Core), so neither can run in default CI.
- Timing is recorded, not asserted, so a performance regression of the gate would not fail a test.
- The 23 unrelated root test failures noted in the 2026-10-21 post-merge audit include 6 in the qa-tools known-failures registry; those were not re-run here.

#### Recommended next steps

1. Decide F16 (Luke, see above), then either write a small plan for release-criterion recipes or register the 37 checks explicitly. Finish or fix; size L if recipes change.
2. Fix F19 by making `check-doc-paths` treat missing `.temp/qa` paths as external or by creating the directory; S, dev-workflow.
3. Add the missing documentation in one docs commit (F8, F11, F13, F14) and convert the F4 comment to NOTICE format; S, finish or fix.
4. Settle the three unverified items (F10, F12, F15) by reading `samples.ts` and the two test files; S.
5. Replace the prose assertions in `validation.test.ts:141-144` with structured fields, then split `evaluate.ts` along its section boundaries; M, polish.
6. Decide F2; if yes, anchor the parent manifest digests; M, new work.

### D. Post-merge QA remediation (2026-10-21)

Source: `.omo/evidence/audit-2026-10-22/d-post-merge-qa.md`.

#### Summary

- All 12 report findings are fixed on `main` except H1, which was withdrawn as a false positive. The plan's U2-U10 landed and U1 was dropped, so no plan row is left unexecuted. The final real-surface Electron check has no saved evidence.
- The eslint markdown rule disable is still needed. The installed `@eslint/markdown` is 8.0.3, which is also the latest npm release, and eslint/markdown#619 is still open.
- The 24 stage-ui node failures and 6 stage-shared failures are registered and the counts are unchanged. The other 17 root failures are not registered. `airi-card-sync.browser` is registered as flaky, but its 15 sibling browser entries are not in the report.
- No commit after `4c722484a` touched any file a fix depends on. One new stray directory is untracked in the checkout.

#### What shipped

The report's baseline is `ec9e8bdba`, and the work ran from `9eedea98f` (report) to `4c722484a` (markdown lint crash). The fixes were:

- `898455bd5`: removed 9 orphan provider settings pages and their tests in stage-pages (M1).
- `fdd3f8229`: excluded `**/settings/presence/**` in `apps/stage-tamagotchi-kirie/kirie.config.ts` (M2).
- `c44e75fc1`: made the UnoCSS scan globs root-relative in `apps/stage-tamagotchi/vitest.config.ts` and `packages/stage-pages/vitest.config.ts` (M3).
- `801ff9b19`: loaded the Tailwind reset in the Presence page test (M3).
- `25ee5a9fd`: added the Kirie model-settings test to the Kirie browser project (M4).
- `337899d3a`: dropped the `@ax-llm/ax` and `stockfish` catalog entries (M5).
- `63ae1320d`: gitignored `.omo/ulw-loop/` (L1).
- `521eb49af`, `8eb11a17f`, `0091856a9`: L2, L3 and L4 (unused i18n key, `any[]`, polling).
- `d3104d529`: ADR, README and `ui-components.md` doc drift (L5, L6).
- `0eaaad756`: scratch files deleted and plans committed (L7).
- `b7b732885`: turned off three `markdown/*` rules for `**/*.md` in `eslint.config.ts:122-135`, with a NOTICE comment.
- `ed2cbbed6` and `4c722484a`: the report's Resolution table.

These are developer-facing only: repository checks, tests, config and docs. The user-visible effect is that the Kirie Presence page is hidden and the dead provider settings routes are gone. The memory note is consistent with the report.

#### Intent vs current state

The end state in the report and the plan holds on `main`.

- Re-checked on `main`: the root-relative globs and their NOTICE at `apps/stage-tamagotchi/vitest.config.ts:~34-47` and `packages/stage-pages/vitest.config.ts:~28-40`; the eslint block at `eslint.config.ts:122-135`; and no `ax-llm` or `stockfish` in `pnpm-workspace.yaml` or `package.json` (git grep returned nothing).
- `git diff 4c722484a..HEAD` over the fix-bearing files (eslint config, the three vitest configs, `kirie.config.ts`, `pnpm-workspace.yaml`, `.gitignore`, `known-failures.json`) shows one change: the CPU-budget commit `aab0a4965` wrapped three vitest configs in `withCpuSlots(...)`. It left the globs and includes intact.
- Nothing was dropped except U1. The accepted partial results (natural-emotion task 12, expression tasks 26 and 35, QA tasks 13/16/22/23/24, presence v2 tasks 14/15/20/25 and open v1 F1-F4) were left to other plans on purpose and belong to other workstreams.

#### Follow-ups

| id | item | source | status | evidence | severity | size |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | koffi runtime dropped from packaged build | report H1 | superseded (false positive, no change) | report Resolution; `.omo/evidence/post-merge-qa/h1-asar-koffi.txt` | polish | S |
| M1 | orphan provider settings pages and tests | report M1 | resolved | `898455bd5` | user-visible | S |
| M2 | Kirie exposes the dead Presence page | report M2 | resolved | `fdd3f8229`; `kirie.config.ts` exclusion | user-visible | S |
| M3 | Windows UnoCSS absolute globs | report M3 | resolved | `c44e75fc1`, `801ff9b19`; vitest configs on main use relative globs with NOTICE | dev-workflow | S |
| M4 | Kirie model-settings test uncollected | report M4 | resolved | `25ee5a9fd`; `apps/stage-tamagotchi-kirie/vitest.config.ts` | dev-workflow | S |
| M5 | stale chess catalog entries break `pnpm lint` | report M5 | resolved | `337899d3a`; git grep on main finds no `ax-llm`/`stockfish` in workspace or package.json | dev-workflow | S |
| L1 | `.omo/ulw-loop/` not gitignored | report L1 | resolved | `63ae1320d`; `git status` on main does not list it | dev-workflow | S |
| L2-L4 | unused i18n key, `any[]`, polling test | report L2-L4 | resolved | `521eb49af`, `8eb11a17f`, `0091856a9` | polish | S |
| L5-L6 | ADR, README and component-reference drift | report L5-L6 | resolved | `d3104d529` | polish | S |
| L7 | scratch root files, untracked plans | report L7 | resolved for the named files | `0eaaad756` | polish | S |
| F1 | new stray untracked directory `C<U+F03A>/Users/Luke/projects/dtuber-wt/cpu-budget-w5/...` (a mangled Windows path holding a copy of `.agents/skills`) plus untracked `.omo/drafts/cpu-budget*.md` and `.omo/plans/cpu-budget.md` | `git status` on main (not in the report) | open | `git ls-files --others` lists hundreds of files under it; dir `C\uf03a` exists in repo root | dev-workflow | S |
| F2 | eslint markdown rule disable (3 rules) | report Deferred; `b7b732885` | open, still needed | `eslint.config.ts:122-135`; installed `@eslint/markdown@8.0.3` (`node_modules/.pnpm/@eslint+markdown@8.0.3_...`) equals npm `latest` 8.0.3; GitHub issue eslint/markdown#619 state `open` (fetched 2026-10-22). Removal condition: a release guards position-less nodes in those rules. | polish | S (when released) |
| F3 | root vitest 23 pre-existing failures: only the 6 stage-shared failures are registered | report Deferred; `packages/qa-tools/known-failures.json` | open (17 unregistered: cap-vite, auth-server, ui-server-auth, plugin-sdk, api-server, Electron static-asset path test) | known-failures.json has `@proj-airi/stage-shared` x6 only. I did not rerun root vitest, so the 23 count itself is the report's number and is `unverified` for today. | dev-workflow | M |
| F4 | stage-ui 24 known failures | report Deferred | resolved as registered; count unchanged | known-failures.json: `stage-ui/node` x24 (`consciousness.test.ts` 15, `onboarding.test.ts` 5, `consciousness-settings.test.ts` 4). No entry changed since 2026-10-20 (git log shows only `aab0a4965`... on that file's path is empty after 4c722484a). Not stale on date, but not rerun. | dev-workflow | S |
| F5 | `airi-card-sync.browser` flake | report Deferred | open (registered as `flaky: true`, no cause fix) | known-failures.json entry `card synchronization across windows > returns false for a revision the server does not have`, `removeWhen` needs 3 clean consecutive runs plus a cause fix | robustness | M |
| F6 | 15 more stage-ui browser tests registered flaky/failing (sessions-dialog x11, voice-messages, markdown-renderer, character-switcher-drawer x2) | known-failures.json, not mentioned in the report, which says only airi-card-sync failed in the full run | unverified: the report's final run reports 1 failure, so these were either added after (all `since` 2026-10-20) or are load-sensitive. A rerun of the stage-ui browser project would settle it. | known-failures.json (16 stage-ui/browser entries, all `flaky: true`) | robustness | M |
| F7 | plan's final "real-surface check of Electron (Presence page, Situation inspector, danmaku menu)" | plan, Order paragraph | unverified: the Electron browser project passed 171/171 but no real-surface evidence file exists in `.omo/evidence/post-merge-qa/` (no screenshots or run notes for it) | evidence dir listing | polish | S |
| F8 | stage-web was not rerun after the fixes | report final test state | open (accepted, no stage-web change) | report | polish | S |
| F9 | Missing raw evidence for natural-emotion-revamp and qa-tooling task 17 | report Deferred | open, accepted | report | polish | L (not recoverable) |

#### Open decisions raised by the auditor

1. Whether to register the 17 unregistered root failures in `known-failures.json` (clean baseline for gates) or fix them (Windows path/CRLF, Node 26 `localStorage`, server environment).
2. Whether the 15 extra flaky browser entries should stay registered, or whether the flake root cause (load sensitivity under parallel workers; see the CPU budget work) should be fixed so entries can be removed.
3. Whether to keep the eslint markdown disable until upstream ships a fix, or to pin or patch `@eslint/markdown`, or to avoid bare URLs in brackets in drafts. Recommended: keep it.
4. What to do with the `C<U+F03A>/` directory and the untracked cpu-budget drafts and plan (delete versus commit); they come from a different workstream.

#### Risks

- The 23 root and 24 stage-ui counts come from the 2026-10-21 report and the registry. I did not rerun them. Node 26 `localStorage` failures could change with a Node or vitest bump.
- Known-failures entries have no automatic expiry; they were all dated 2026-10-20, so an entry can mask a real regression in those files (for example sessions-dialog).
- Windows-specific glob fixes (M3) are not exercised on Linux or macOS CI. The root-relative globs are portable, so the risk is low.
- The cpu-slots work (`aab0a4965`, `03452832b`, `e9281de6e`) caps vitest workers and wraps configs. That changes timing under load for the browser projects, so the flake rate could shift in either direction.
- The H1 outcome rests on one before/after packaging build on Windows; there is no packaging gate in CI.
- Linux/macOS: Kirie and Presence exclusion are config-level, with the bundle grep recorded only for the Windows build.

#### Recommended next steps

Finish or fix:
1. Remove or commit the stray `C<U+F03A>/` directory and the untracked cpu-budget drafts and plan (S). `git status` stays noisy until then, and the directory can be picked up by lint and by `git add -A`.
2. Rerun the stage-ui browser project and root vitest once to confirm the 16 flaky entries and the 23 root failures against `639979638` (M). This settles F3, F4 and F6 and updates stale registry entries.
3. Register or fix the 17 unregistered root failures (M) so gates have a complete baseline.
4. Retrospectively run the Electron real-surface check or record why it was skipped (S).

New work, later:
5. Fix the airi-card-sync cause and the sessions-dialog layout flakes, and delete the entries per their `removeWhen` rules (M).
6. When `@eslint/markdown` releases a fix for #619, remove the three-rule disable (S). Check the issue and npm on each dependency bump.

### E. Developer tooling (dev launcher, verify/wt/dev:top, cpu-budget)

Source: `.omo/evidence/audit-2026-10-22/e-dev-tooling.md`.

#### Summary

- The launcher, `pnpm verify` / `pnpm wt` / `pnpm dev:top`, and the cpu-budget broker and QA cache all shipped and match their stated end states. Both ADRs still say `Status: proposed`.
- Of 37 boulder follow-ups plus 3 new findings, 28 are open, 4 resolved and 6 unverified (merged IDs below).
- Reviewer claim F4r2 (post-commit `checkToken` busy leaves a duplicate lease) is real but needs a rare window. Claim F4 (same-seq enqueue overwrites a ticket) is a real code gap that is practically unreachable.
- New finding: an untracked stray `C:/Users/Luke/...` directory sits in the repo root (`git status` shows `?? C:/`).
- `dev:top` CPU over-reporting could not be reproduced; the PID-0 and mapping hypotheses are ruled out.

#### What shipped

**Dev launcher** (commit `2bf057c12`, ADR `docs/ai/adr/2026-10-19-dev-launcher.md`). `scripts/dev.mjs` runs one package script the way `pnpm --filter <pkg> run <script>` does, starting each Node entry point behind a pnpm `.cmd` shim directly. `scripts/dev-launcher.mjs` holds the pure logic and `scripts/dev-launcher.test.mjs` tests it (Vitest project `root-scripts`). Root scripts `dev`, `dev:web`, `dev:web:https`, `dev:ui`, `dev:server-auth`, `dev:server`, `dev:tamagotchi` and `dev:tamagotchi:xwayland` call it (root `package.json` scripts). `dev:pocket:*`, `dev:backend`, `dev:apps` and `dev:packages` stay on pnpm or Docker by design.

**Dev-perf tooling** (merged 2026-10-20: `ceef02447`, `7ca872923`, `b916a6549`, `65083a46a`). `scripts/dev-tools/`: `verify.ts` and `verify-plan.ts` plus `verify-cache.ts` (affected-only typecheck, lint, related tests, and a tree-hash pass cache), `wt.ts` and `wt-plan.ts` (`ls/new/rm/gc`), and `top.ts` with `lib/processes.ts` (`dev:top`, `kill <wt> --yes`). `pnpm-workspace.yaml:69` sets `verifyDepsBeforeRun: error`.

**cpu-budget** (fast-forward to `639979638`). `packages/cpu-slots` is a local broker with a 12-slot budget, class bounds, FIFO tickets, an owner-identity directory lock and write-then-verify grants. It ships a CLI (`pnpm slots run|status`), a built `dist/vitest.mjs` wrapper `withCpuSlots` guarded by a source-hash build stamp, and an atomic-publish `tsdown` build. The QA result cache is under `packages/qa-tools/src/motion/cache` (closure, key, store and lookup). `typecheck`, `typecheck:engines`, `verify` and the gate run through leases. ADR `docs/ai/adr/2026-10-22-cpu-budget.md`.

#### Intent vs current state

- **Launcher.** It matches the ADR. The ADR says macOS, `dev:web:https` and `dev:tamagotchi:xwayland` were not run. Two Ctrl+C prompts remain through `pnpm dev` by design, because they come from Luke's pnpm install.
- **Dev-perf.** All three tools shipped. `verify.ts` already chunks lint and test commands (`verify.ts:61,72`). The repo's own pre-commit hook still does not (F11).
- **cpu-budget.** All 13 plan todos and F1-F4 are delivered. The ADR names three cost areas that were consciously not fixed:
  - every `cpu-slots` edit invalidates the whole Turbo cache;
  - explicit `--watch` takes no lease;
  - the N1 residual double-holder gap.
- **Limit.** The budget bounds parallelism, not CPU time. Two leases together peaked at 10.12 of 12 effective cores (ADR Limitations).
- **Docs drift.** Both ADRs are still `Status: proposed` (`2026-10-19-dev-launcher.md:4`, `2026-10-22-cpu-budget.md:4`) though the work is merged.

#### Follow-ups

Duplicates are merged: F05 covers boulder #5, #35 and the t5/t9 entries; F11 covers #11 and #14; F21 covers #22 and #36.

| id | item | source | status | evidence | severity | size |
|---|---|---|---|---|---|---|
| F01 | `runT3Cli` exclusive acquire under an inherited shared lease throws `exclusive-under-shared`; the `.catch` rethrows and nothing in `runT3Cli` handles it | t8 | open | `packages/qa-tools/src/t3/cli.ts:56-60`; `acquire.ts` `assertShareable` | robustness | S |
| F02 | Lease label omits the gate (T3 label is `stage-tamagotchi dev (T3, <root>)`) | t8 | unverified | `t3/launch.ts:53`; gate-path label not read. Settle: grep the gate's `acquire` call | polish | S |
| F03 | `launch.ts` T3 path untested without a rig | t8 | unverified | No test file for `launch.ts` was searched. Settle: grep `packages/qa-tools` tests for `launchStageTamagotchi` | robustness | M |
| F04 | `wt` default branch prefix and branch left after `rm` | t5 | resolved | `wt.ts:118` (`airi.branchPrefix` config), `wt.ts:162-165` (`--delete-branch`). The default is still the OS user name and `rm` keeps branches by design (`wt.ts:28`) | polish | S |
| F05 | Lease label shows raw `{grant}` template | t5/t9, F3r2 | open | `cli.ts:100` records `command.join(' ')` before `cli.ts:101` substitutes | polish | S |
| F06 | `verify-plan.test.ts` uses a real broker with a 30 s timeout | F2 | open (by design) | NOTICE in the test | robustness | S |
| F07 | N1 residual double-holder gap: a breaker acting on a stale view lets two stores pass the lock check; write-then-verify is the backstop | F4 | open | ADR Limitations; `store.ts` `transact` and `write` (`checkToken` then `rename`, not atomic) | robustness | L |
| F08 | Unmarked retirement markers are retried only on the same instance's next `lock()`, not on release or exit | F2 | open | `store.ts` `markRetired` / `lock()` | robustness | S |
| F09 | `leave()` rethrows non-busy errors from `readOwner`/`retireLock` in `transact`'s `finally`, masking a committed result | F2 | open | `store.ts` `leave` (`if (!(error instanceof StoreBusyError)) throw error`) | robustness | S |
| F10 | `identityDeath` mutation gap | F2 | unverified | `packages/cpu-slots/test` has no test naming it. Settle: a mutation run, or read `liveness.test.ts` and `store.test.ts` | polish | M |
| F11 | nano-staged `"*": "moeru-lint --fix"` is unchunked and overflows the Windows command line on large staged sets | F2 | open | `package.json:128-129`. `verify.ts:61,72` chunk already | dev-workflow | S |
| F12 | Pre-existing failing tests not in `known-failures.json`: `hearing.analytics`, `live2d.browser`, `history.browser` | F2/F3r2 | open | `packages/qa-tools/known-failures.json` lists only stage-shared, stage-ui onboarding/consciousness and a few flaky browser files | dev-workflow | S |
| F13 | ADR should document that vitest browser mode ignores `maxWorkers` and the measured CPU reality | ADR todo 12 | resolved | ADR Limitations bullets 1-2, "Browser projects are capped per project" | polish | S |
| F14 | `pnpm test:run` `&&` chain stops before the browser suites when the root vitest fails | F2 | open | root `package.json` `test:run` | dev-workflow | S |
| F15 | `AGENTS.md:130` says `AIRI_CPU_SLOTS=off` is allowed and also "Never bypass the broker" | F2 | open | `AGENTS.md:130` | polish | S |
| F16 | Same-seq enqueue overwrites a ticket; `grant` and the `touchTicket` check key by `seq` only, not ticket id | F4 | open (real gap, practically unreachable) | `acquire.ts` (`touchTicket(ticket.seq)`); `store.ts` `grant`/`enqueue`. See probe 2 | robustness | S |
| F17 | Persistent child processes (dotnet build server) hold a lease for life; undocumented | F4 | open | No match in `packages/cpu-slots/README.md` or the ADR | polish | S |
| F18 | A snapshot failure rejects every waiter, and snapshots run inside the global lock | F4 | open | `processes.ts:22,27-29` (10 s timeout, throws); `store.ts` `processesAfter`/`snapshot` run inside `transact` | robustness | M |
| F19 | ADR says turbo-hash cost is "not accepted yet" but the ledger decision accepted it | F4 | open (decision) | ADR Limitations, "Any `packages/cpu-slots` edit invalidates every Turbo task cache" | polish | S |
| F20 | T3 exclusive lease waits without a timeout | F4 | open | `t3/cli.ts:56` (`acquire` with only an abort signal) | robustness | S |
| F21 | `dev:top` CPU over-reports (38 vs 3-8 cores) | F3, F3r2 | open (cause unknown; see below) | `scripts/dev-tools/lib/processes.ts:18` | dev-workflow | M |
| F22 | `dev:top` busy lock does not retry | F3 | resolved | `lib/cpu-slots.ts` `readCpuSlots` retries once after 200 ms; `status.ts` `STATUS_BUSY_BUDGET_MS` = 2 s | polish | S |
| F23 | `pnpm slots status` can wait up to 10 s, and loops forever on a busy lock with no cap | F3 | open | `cli.ts:44-52` | polish | S |
| F24 | Persistent EPERM on `broker.lock/owner.json` waits unbounded, and the `entry-busy` message names no path or holder | T14 | open | `store.ts` `readJson` throws `StoreBusyError('entry-busy')` with no detail; `acquire.ts` tick retries every 50 ms forever | robustness | S |
| F25 | Write-path EPERM is still fatal: `rename` retries 5 times back to back, then throws the raw EPERM, which `acquire` rejects (not in the unbrokered code list) | T14 | open | `store.ts` `rename`; `acquire.ts` catch list `EROFS/EACCES/ENOENT/ENOTDIR` | robustness | M |
| F26 | README documents `lock-busy` but not `entry-busy` | T14 | open | `packages/cpu-slots/README.md:70` | polish | S |
| F27 | Turbo restores `dist` in place (rare half-written read) | T15 | open (documented, accepted) | `README.md:60` states the exception | robustness | M |
| F28 | `hearing.analytics.test.ts` 10 s timeouts are load-sensitive (8.8-9.4 s measured) | T15 | open | `packages/stage-ui/src/stores/modules/hearing.analytics.test.ts:84,113` | dev-workflow | S |
| F29 | README should say metadata (mtime) triggers the Turbo rewrite | T15 | open | `README.md:60` says only "differs from its record" | polish | S |
| F30 | A crashed build leaves `node_modules/.cache/dist-<pid>`; only a completed `replaceFiles` removes it | T15 | open | `tsdown.config.ts:15` (staging path), `replaceFiles` last line | polish | S |
| F31 | `transact` post-commit `checkToken` throws busy after a committed grant, so a retry enqueues a second ticket and takes a duplicate lease | F4r2 | open (real, rare). See probe 1 | `store.ts` `transact`; `acquire.ts` tick `catch` and `touchTicket` | robustness | S |
| F32 | `live2d.browser.test.ts` first test times out under load (15 s default; 6.4-8.1 s passing) | F3r2 | unverified | Test file exists. Settle: read the first test's timeout and run it under load | dev-workflow | S |
| F33 | `history.browser.test.ts` uses fixed 80/60 ms sleeps | F3r2 | unverified | A grep for `setTimeout`/`sleep` showed nothing in the lines read. Settle: `grep -n "80\|60" history.browser.test.ts` for `await new Promise` | dev-workflow | S |
| F34 | `tsdown.config.ts:13-14` atomic-publish comment is not in NOTICE format | delta | open | `tsdown.config.ts:13-14` (the next comment at 17-21 is a NOTICE) | polish | S |
| F35 | Both merged ADRs are still `Status: proposed` | new | open | `docs/ai/adr/2026-10-19-dev-launcher.md:4`, `2026-10-22-cpu-budget.md:4` | polish | S |
| F36 | Untracked stray `C:/Users/Luke/projects/dtuber-wt/cpu-budget-w5/...` directory in the repo root, created 2026-10-22 03:52; it holds a copy of `packages/qa-tools` and more, which globs may pick up | new | open | `git status`: `?? C:/`; `find` hits `./C:/Users/Luke/projects/dtuber-wt/cpu-budget-w5/packages/qa-tools/src/t3/cli.ts` | dev-workflow | S |
| F37 | `dev:server-auth` fails before and after the launcher | launcher | resolved (explained, not a regression) | `apps/ui-server-auth/vite.config.ts:146-147` throws without `VITE_WEB_APP_URL`; no `.env*` file exists in that app | polish | S |
| F38 | `npm_package_bin` differs for `server-runtime` | launcher | unverified | `packages/server-runtime/package.json:29` has `"bin"` as a string. Likely cause: pnpm's lifecycle normalizes a string `bin` to `{ <name>: path }` (`npm_package_bin_<name>`), while `addPackageFields` (`dev-launcher.mjs`) emits `npm_package_bin`. Settle: dump env under both and diff | polish | S |

#### Open decisions raised by the auditor

1. **Turbo global hash cost (F19).** The ADR says "not accepted yet" and the ledger says accepted. Choose whether to keep the root devDependency and accept the whole-repo cache invalidation, or schedule its removal. Removal needs a split of the dev tools and a new way for the root `vitest.config.ts` to import the wrapper.
2. **AGENTS.md:130 (F15).** Decide whether `AIRI_CPU_SLOTS=off` is a supported opt-out or "never bypass" is the rule. The code supports the opt-out (`acquire.ts` `noop`).
3. **ADR status (F35).** Both ADRs are merged. Move them to `accepted`, or keep `proposed` until the follow-ups close.
4. **Known flaky tests (F12, F28, F32, F33).** Add them to `known-failures.json` with `flaky: true`, or fix the load sensitivity. The file's own policy requires 3 consecutive passes to remove an entry.
5. **T3 exclusive wait timeout (F20).** Pick a bound and an exit code for an exclusive lease that never arrives, or keep waiting indefinitely.
6. **Stray `C:/` directory (F36).** Deleting a directory tree is destructive and no worktree registration was checked. Please approve its removal.

#### Risks

- **Platform.** The broker was gate-tested on Windows only. POSIX descendants that call `setsid` are untracked (README, ADR). Linux CI sets `CI` and therefore no-ops the broker. macOS and `dev:web:https` were never run for the launcher.
- **Evidence kept outside the repo.** The ADR's measurements cite `.omo/evidence/cpu-budget/task-*-gate-review*.md` files, which are not committed. The numbers are not reproducible from the committed tree.
- **Locking.**
  - F07, F16 and F31 share one root: `checkToken` is a time-of-check read, and the grant path has no end-to-end ticket identity.
  - F25 and F24 leave Windows sharing errors as either fatal or an unbounded retry.
  - `store.ts` is 775 lines with heavy race handling and one mutation gap (F10).
- **Turbo.** Any `packages/cpu-slots` edit invalidates the whole Turbo cache (F19). A cache-hit restore can still expose a half-written `dist/vitest.mjs` (F27).
- **Pre-commit.** The nano-staged hook can fail on Windows for large staged sets (F11). A failed hook risks pressure to bypass it.
- **Working tree.** `git status` from WSL showed about 4,947 entries, mostly modified `.agents/skills/*` (probably line-ending noise). I did not verify the cause. The `C:/` stray directory (F36) may be matched by repo-wide globs.
- **Not run.** I did not run `pnpm verify`, `vitest` or the T3 rig, in keeping with the read-only brief.

#### Recommended next steps

Finish or fix:

1. **F31 and F16 (S, one change).** Make a post-commit busy not discard a committed result, and pass the ticket id through `touchTicket` and `grant`. Add two store/acquire tests with injected faults. Rationale: this is the only path that can deadlock a process on itself.
2. **F36 (S).** Remove the stray `C:/` directory after Luke approves.
3. **F15, F35, F19 (S, docs).** Resolve the three contradictions after decisions 1-3 above. Add the `entry-busy` README entry (F26), the NOTICE format (F34), the metadata wording (F29) and the persistent-child note (F17).
4. **F11 (S).** Replace the nano-staged glob command with a function config that chunks the file list.
5. **F12, F28, F14 (S).** Add `hearing.analytics`, `live2d.browser` and `history.browser` to `known-failures.json`, or raise the timeouts. Change `test:run` to run all suites even when one fails.
6. **F20, F01 (S).** Give the T3 acquire a timeout and catch `CpuSlotsError('exclusive-under-shared')` with a clear message.
7. **F24, F25, F23 (S-M).** Add path and holder detail to `entry-busy`, bound the persistent-EPERM wait, and add the same short delay to the `rename` retry. Cap `slots status`.
8. **F05 (S).** Substitute `{grant}` before `acquire`, or record the original string with the grant noted.

New work:

9. **F21 (M).** Rebuild the `dev:top` CPU measurement from two raw samples. Reproduce the 38-core figure first (run `dev:top` from a Windows shell, not WSL).
10. **F18, F08, F09, F30 (M).** Harden snapshot failure handling inside the lock, marker retry, and the crashed-build staging leak.
11. **F19 root fix (L).** Remove the root devDependency on `@proj-airi/cpu-slots` if decision 1 says so.
12. **Settle the six unverified items (F02, F03, F10, F32, F33, F38) with the cheap checks named in the table.**

## Resolution (2026-10-22 follow-up loop)

Luke authorized implementing the report's recommendations. They ran as ulw-loop plan `01a16053`, goals G1 to G10. Each goal was verified on a real surface and landed on local `main`. The evidence is in `.omo/evidence/workstream-followups/`, which git ignores. This section records the outcome of each decision and each numbered next step.

### Decisions

| # | Outcome | Commit or reason |
| --- | --- | --- |
| D1 | Done. The stray mangled `C:` directory, which held `.env` copies, was deleted after its one reparse point was unlinked. `node_modules` is intact. | No commit; the directory was untracked. |
| D2 | Done. live2d-presence-v1 is closed as superseded by v2. `stash@{0}` was archived to a patch, then dropped. | `d0670fe8e`; boulder status `superseded` |
| D3 | Done for the switch. Settings > Presence has "Share the foreground app and window titles", on by default. Turning it off stops the foreground sampler and removes the app, title and category from the situation and from the model request. The cloud allowlist stays deferred. | `a8bf1c2ab`, `73c87f54f` |
| D4 | Done. The presence ADR and the stage-tamagotchi README state that presence supports Electron on Windows only. | `b09fc9e73` |
| D5 | Deferred, as recommended. The motion-gate unmutated finding needs its own decision after rendered daily use. | No change. |
| D6 | Done. The ADR records the turbo global-hash cost as accepted while cpu-slots is stable. Removing the root devDependency stays deferred. | `8bd97b9c9` |
| D7 | Done. `AGENTS.md` now limits `AIRI_CPU_SLOTS=off` to one-off diagnosis of the broker and forbids bypassing the stale-build guard. | `0cdc6e594` |
| D8 | Done, beyond the recommendation: most failures were fixed at their cause instead of registered. Six of the seven unregistered root files are fixed (Windows paths, CRLF, an auth-server time-zone seed), and only revenuecat is registered. `vitest.dom-storage.ts` fixes the 30 Node 26 `localStorage` failures, and their entries are removed. The three named load-flaky stage-ui tests and four more found during the loop are fixed without fixed sleeps. | `341080d1e`..`61b0062b4` |
| D9 | Lip sync is fixed; v3 stays deferred. wlipsync 1.3.1 traps above about 64 kHz, so contexts above 48 kHz now analyse in a separate 48 kHz context. | `60802ed8e` |
| D10 | Deferred, as recommended. | No change. |
| D11 | Done. T3 waits at most 30 minutes for its exclusive lease, then exits with code 3, which no other T3 path uses. Under an inherited shared lease it exits with code 2 and names that lease. | `c3e3d7f5f` |
| D12 | Done. The dev-launcher and cpu-budget ADRs are `accepted`. | `203740ede` |
| D13 | Deferred, as recommended. | No change. |
| D14 | Done. The web extension routes notifies to the stage windows. A pre-existing identity bug that kept it from connecting at all is also fixed. | `bc564c20c`, `94d0aadae` |
| D15 | Done by pushing this commit. The push happens only after the final health run and the gate review pass, and it is confirmed by checking that `git rev-parse main origin/main` returns the same hash. It also publishes the earlier unpushed cpu-budget series that the audit reviewed. | This commit and its push |
| D16 | Done. `.tool-versions` pins Node 26.11.1 after a full `test:run` on it, and `pnpm qa:doctor` exits 0. | `61b0062b4` |

### Prioritized next steps

| # | Item | Outcome | Commit or reason |
| --- | --- | --- | --- |
| 1 | Workspace hygiene | Done. The stray directory is removed and 8 merged branches deleted. natural-emotion-revamp is marked complete and the cpu-budget plan and drafts are committed. The ADRs are accepted (D12), and the presence memory note is updated (agent memory commit `4da4058`, outside this repository). | `f76747e04`, `d0670fe8e`, `203740ede` |
| 2 | Broker deadlock fix (F31, F16) | Done. Each `acquire` call puts one id on every ticket and lease it creates. A retry adopts the lease that already carries its id, so a committed grant is never discarded, and `touchTicket` and `grant` compare ticket ids. Fault-injection tests fail on the parent and pass on the fix. | `c370f67f4` |
| 3 | Test baseline | Done (D8). `pnpm test:run` runs all seven suites even after a failure, prints a per-suite summary, and exits non-zero exactly when a suite fails. Its only failure is the registered revenuecat test, so it exits 1 by design. Two `pnpm qa:test --all` runs reported 0 new failures, and the 16 flaky stage-ui entries were rechecked. | `341080d1e`..`61b0062b4` |
| 4 | Windows command-line chunking | Done. `nano-staged.mjs` chunks pre-commit lint by command length, and a `nano-staged` patch chunks its own `git add` and `git checkout`. `verify` lint now batches by length instead of count; its old 150-file batches overflowed `cmd.exe`. | `7df06cb6a` |
| 5 | Doc contradictions | Done. The `AGENTS.md` wording (D7) and the ADR turbo wording (D6) are fixed, `entry-busy` is documented, and the `doctor.ts` and `tsdown.config.ts` comments are NOTICE blocks. The four qa-tools T1 limitations are added, and `check-doc-paths` handles a missing `.temp/qa`. | `0cdc6e594`, `b09fc9e73`, `a3cf8cd82`, `8bd97b9c9`, `5a8878259` |
| 6 | Presence privacy switch | Done (D3). | See D3. |
| 7 | Presence correctness | Done. A follower's send after a leader-window reload was lost on `main` and now arrives within 2.7 to 3.9 s, and a send that tab-election re-delivers to a new leader runs only once. A voice input that speech-to-text is still finishing counts as user activity. After 30 minutes the synced state measures 24.3 KB, against 47.1 KB on `main`. Foreground sampling costs at most 2.9 ms on the main thread, so it needs no code change. Web-extension routing is D14. | `282845f42`, `e9409462b`, `e248a85d6`, `c85fe4a7e` |
| 8 | koffi installer smoke test | Done, with no defect found. A real NSIS install loads koffi's JavaScript from `app.asar` and its native `koffi.node` from `app.asar.unpacked`, and it samples the foreground window. H1 stays withdrawn, now with evidence. | Evidence `g8-installer.txt`; no code change |
| 9 | wlipsync at 192 kHz | Fixed in code (D9). A real 192 kHz device run is still needed to close live2d-presence-v2 row 25. | `60802ed8e` |
| 10 | Motion-gate unmutated finding | Deferred until D5 is decided. | Waits on D5. |
| 11 | cpu-slots hardening and `dev:top` CPU | Done. Snapshot failures and timeouts count as busy and are retried, and write-path EPERM and EBUSY retry with backoff. `entry-busy` waits are bounded at 5 minutes. Exit-marker writes are retried, and builds remove the staging directories of crashed builds. `dev:top` measures CPU from raw counter deltas. | `3e9118394`, `c3e3d7f5f`, `5a8878259`, `0ce37abb3`, `5314ac5a7`, `76f07473a` |
| 12 | Optional new work | Deferred, as recommended: live2d-presence-v3, macOS and Linux presence sensors (D4), and removing the root cpu-slots devDependency (D6). | Decide after daily use. |

### New follow-ups found during the loop
- **Lip sync:**
  - The VRM and MMD lip-sync composables still call `createWLipSyncNode` directly. They are safe only because their context is the pinned 48 kHz store context.
  - The NOTICE in `stores/audio.ts` attributes the wlipsync failure to `set_input`; it actually happens in `execute`.
- **Presence:**
  - With foreground sharing off, unprompted speech pauses, because the gate needs a foreground sample. Replies and widget reactions still work.
  - A reply that a leader-window reload cuts off is not regenerated, whichever window sent it. This is by design and recorded in the presence ADR.
  - A message sent in the roughly 100 ms before the leader page unloads can still fail; the composer keeps the draft.
  - A voice host that crashes mid-capture without reporting keeps the user marked as speaking until a new host connects.
  - When no voice output host is connected, a send now waits up to 10 s for one to return before it fails. Before, it failed at once (`speech-output-control.ts`).
  - The reload fix relies on the voice store's `pagehide` listener running before setupSynced's. A plain comment documents this, but nothing enforces the order.
  - The web-extension `vue-tsc` compile still has 7 pre-existing errors.
- **cpu-slots:**
  - The process lookup timeout is now 30 s, so a hung PowerShell can hold the store lock for up to 30 s.
  - The F07 double-holder gap remains, as do process snapshots taken inside the global lock.
  - A `MaxListenersExceededWarning` during `vitest-wrapper.test.ts` comes from the existing per-lease exit listener.
  - The T3 usage text in `args.ts` does not list exit code 3 yet.
- **Builds:** pulling or merging i18n source changes does not rebuild `packages/i18n/dist` when the lockfile is unchanged. Tests then run against stale translations: the final health run first failed two Settings > Presence tests this way, because `packages/i18n/dist` predated G6's new key. After `pnpm -F @proj-airi/i18n build`, `pnpm verify --base origin/main` passed. `pnpm qa:doctor` reports the stale dist, but nothing rebuilds it automatically.
- **Pre-commit:** the `nano-staged` patch does not chunk its `git diff` backup of partially staged files. A commit with more than about 300 partially staged files can still overflow.
- **Tests:**
  - The api-server revenuecat test "grants the new capacitor on PRODUCT_CHANGE" fails. After a product change, reconciliation raises `capacitorQuota` to 5000 but leaves `capacitorFlux` at 2000. It is registered in `known-failures.json`, and the api-server owner needs to decide whether the behavior or the expectation is wrong.
  - stage-layouts has 17 passing tests that no runner runs; it is in neither `test:run` nor `qa:test`. Several other packages with their own vitest config are not referenced by path in the root config and should be checked the same way.
  - 16 stage-ui browser tests stay registered as flaky. They passed in four consecutive `qa:test --all` runs, but their timing causes are not fixed.
