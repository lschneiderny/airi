# motion-gate-redesign - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** Agents and Luke rely on the check that tells them whether the emotion scorer can be trusted. Today it always fails on four known limits, so its failures say nothing new. After this plan, it fails only for reasons that matter, and it names the specific emotion checks that need fixing.

**What you'll get:** A corrected way of testing the scorer that no longer asks the impossible, and one full run of it. That run comes with a written list of the checks that fail every time, which is your to-do list for recipe or gate fixes. Updated docs and agent guidance come too.

**Why this approach:** Three of the four limits come from how the test was set up, not from the scorer. A zeroed recipe was judged on channels that other motion still moves. One emotion's side could never be told apart. A half-strength recipe was asked to fail exactly at the gate's own boundary. Fixing the test, not the gate, keeps every motion and gate rule exactly as it is. The fourth limit separates checks that fail every time, which become findings, from ordinary noise, which gets a fixed allowance decided before the run.

**What it will NOT do:** It will not change any emotion recipe, gate threshold or motion behavior, and it will not tune anything after seeing results. It will not fix the checks that keep failing; those come back to you as findings.

**Effort:** Medium
**Risk:** Low - the changes stay inside the test harness, and one long run of about 50 minutes needs the machine mostly to itself.
**Decisions to sanity-check:** The allowance for noise (about 27 stray failures out of about 1,685 checks) and the "fails in 4 of 5 runs" rule for calling something a real finding. Also whether a half-strength recipe should count as "the right size" at all. That question is left open for later; this plan does not change it.

Your next move: start execution with `/ulw-execute motion-gate-redesign`. The plan review could not run in this session (see below). Full execution detail follows below.

---

> TL;DR (machine): Medium effort, low risk - scorer-validation protocol 2 (x0 held-only size, two-sided ignore-side with equality proof, paired x0.5 calibration, 4-of-5 persistence plus Binomial(N,0.01) q0.99 budget), one full run with findings, docs and skill.

## Scope
### Affected user and ideal state
**Affected user:**
- Agents run `pnpm qa:motion validate-scorer --level t1` to decide whether the emotion scorer can be trusted before they rely on T1, T2 or T3 emotion verdicts.
- Luke reads the verdict and decides on recipe and gate follow-ups.
- The T1, T2 and T3 gates and the HTML report consume the same scorer, but none of them reads `validation.json`. `rg "validation|thresholdsMet" packages/qa-tools/src/report` finds nothing.

Today, the run exits 1 on four limits. Three of them are artifacts of the validation design, and one mixes real findings with noise. After this plan, every requirement can be met by a sound scorer. Every miss names its cause, and checks that fail persistently are handed over as findings.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Every validation requirement can be met by a sound scorer, and fails only on a real scorer or recipe defect. | A requirement that no sound scorer can meet trains agents to ignore exit 1. |
| IS-2 | A miss names its cause: a persistently failing check is a named finding, and other failures are measured against a fixed noise budget. | Luke needs a list of checks to fix, not "84-88%". |
| IS-3 | The emotion gate contract, the T3 gate, Natural motion code and the golden idle hash are unchanged. | Luke's rule: never retune a gate or recipe merely to pass. Gate changes need their own versioned decision. |
| IS-4 | The new protocol is fixed in code and in `protocolNotes` before the first full run, and the report records a protocol version. | Thresholds chosen after seeing data are a retune in disguise. |
| IS-5 | The README, a new ADR, the old ADR's limits line and the motion-qa skill describe the new protocol and the findings of the first run. | Agents learn the protocol from these files. |
| GAP-1 | x0 is scored only on full and long-hold trials with a detection rule, so impulse hints keep 22 face checks alive (plan.ts:100-102, evaluate.ts:84-87,95). | Violates IS-1. |
| GAP-2 | ignore-side sets `sided = []`, which equals the unmutated output whenever the emotion's fixed T1 side is +1, so 12 awkward posture checks cannot be killed (plan.ts:266-268, hold.ts:80-86,126). | Violates IS-1. |
| GAP-3 | x0.5 lands exactly on the inclusive 0.5 size bound (gates.ts:130, emotion-score.ts:1589), so a 0.90 gate-verdict kill rate contradicts the gate. | Violates IS-1. |
| GAP-4 | Unmutated requires a pass rate of 1 in every set (evaluate.ts:28, 313-322). That counts 'n/a' as failing and cannot separate the 23 checks that fail every set from release noise. | Violates IS-1 and IS-2. |
| GAP-5 | The README (:85-89, :151), the ADR (2026-10-20-motion-qa-levels.md:51) and the motion-qa skill (:50) state the old accepted limits. | Violates IS-5. |

### Must have
- **K1, x0:** add held-only cells to the x0 experiment. The x0 kill rule becomes `detection-or-size`. The 0.99 minimum is unchanged.
- **K2, ignore-side:** two variants.
  - `ignore-side` keeps today's `sided = []`.
  - `ignore-side-neg` sets `sided = []` and negates `posture[axis]` on the axes that were sided.
  - For each variant, checks whose cell's trials all carry the side that variant reproduces are listed as `notMutable`. A per-cell trace-equality proof confirms it.
  - The 0.95 minimum is unchanged and applies to the pooled mutable checks of both variants.
- **K3, x0.5:** the kill criterion becomes a paired calibration, the x0.5 sizeRatio divided by the unmutated set-1 sizeRatio. A check is killed when that quotient is at most `Math.SQRT1_2`.
  - The 0.90 minimum applies to the clear and strong checks.
  - The gate-verdict size kill rate stays in the report as `reportedOnly`.
- **K4, unmutated:** a two-part requirement.
  - **Persistence:** a check whose verdict is 'fail' in at least 4 of 5 sets is a finding, and any finding fails the section.
  - **Noise budget:** the remaining 'fail' verdicts must not exceed the 0.99 quantile of Binomial(N, 0.01). N is the number of non-'n/a' check-set pairs, excluding persistent checks. 'n/a' is reported separately and never counts.
- The report gets a `protocolVersion: 2` field. `protocolNotes` describes each change.
- One full `validate-scorer` run at the new protocol, with its findings written down.
- Documentation updates, with the motion-qa skill change in its own agent-config commit.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No edit to `packages/stage-ui-live2d/src/composables/live2d/natural-motion/**`. That covers gates.ts, emotion-score.ts, hold.ts, emotions.ts and impulses.ts. No gate version bump.
- No change to any other mutation's threshold or rule: sign-flip, x2, release-tau-x3, blink-interval-1, A/A, zero and determinism stay as they are.
- No tuning of K1-K4 constants after the first run. If a predicted rate is missed, that is a finding.
- No recipe change to fix the persistent checks. Those are handed to Luke as findings.
- No new dependency. Implement the binomial quantile in qa-tools as an exact summation; Binomial(N <= 2000, 0.01) needs no library.
- No change to the T3 gate, the T3 archive, report rendering, or `.omo/plans/qa-tooling.md`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- **Test decision:** tests-after with Vitest (Luke's choice for qa-tooling). Unit tests go in `packages/qa-tools/src/motion/validation/validation.test.ts`, sized like its neighbours. Each new rule gets a synthetic-result case that fails when the rule is removed. Capture that mutation receipt once per todo.
- **Package checks per todo:**
  - `pnpm -F @proj-airi/qa-tools typecheck`;
  - `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/motion/validation`;
  - eslint on the changed files.
- **Golden idle hash:** `node --import tsx .omo/evidence/qa-tooling/task-0-golden-hash.ts --repo <worktree>` must print combined `41c0725b8a1bbfaa0c78c55a6f147ad928585d0933c2dc95b52de95583431d8a`. Run it in the final todo.
- **Smoke run** (todo 5): `node --import tsx packages/qa-tools/bin/motion.ts validate-scorer --level t1 --sections zero,mutations,unmutated --seeds 3`. Call node directly, because pnpm collapses exit codes.
- **Full run** (todo 6): the same command without `--seeds` and with every section. It takes about 45-50 min on 15 workers and holds the heavy-run lock `H:/llm/ollama/tmp/qa-tooling-heavy.lock` for the whole run.
- **Evidence:** under `.omo/evidence/motion-gate-redesign/` in the main checkout. Name files `task-<N>-<what>.<ext>`.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

Todos 1-4 all edit `validation/plan.ts`, `validation/evaluate.ts` and `validation.test.ts`, so they run in sequence in one worktree. Parallel workers would collide on the same lines. Todo 7 depends only on the decided protocol, so it can run alongside todos 5 and 6.
- **Wave 1 (sequential, one worktree):** todos 1, 2, 3 and 4.
- **Wave 2:** todo 5 (protocol version, notes and summary text, then a smoke run). Todo 7 (docs draft) runs in parallel.
- **Wave 3:** todo 6 (full run and findings), then todo 8 (finalize docs with the findings, and the skill commit).
- **Final:** F1-F4.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2 | - |
| 2 | 1 | 3 | - |
| 3 | 2 | 4 | - |
| 4 | 3 | 5 | - |
| 5 | 4 | 6 | 7 |
| 6 | 5 | 8 | 7 |
| 7 | 4 | 8 | 5, 6 |
| 8 | 6, 7 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. x0: add held-only size to the zeroed-recipe kill rule
  **What to do:**
  1. In `packages/qa-tools/src/motion/validation/plan.ts` `mutationCells` (:101-117), make `'x0'` return `allCells(['full', 'held-only', 'long-hold'])`. `'sign-flip'` keeps `['full', 'long-hold']`.
  2. In `evaluate.ts`, add the KillRule `'detection-or-size'` to `killState` (:74-93):
     - **killed** when significance === false, visibility === false or size === false;
     - **survived** when significance === true and size !== false;
     - **null** otherwise.
  3. Map `'x0'` to `'detection-or-size'` in `mutationRule` (:95-103), and set its `criterion` text in `validationThresholds` (:20) to `'detection or held-only size'`. `minKillRate` stays 0.99.

  **Must NOT do:** change the x0 table (scaleHeld(held, 0) at plan.ts:253-256), impulse hints, or any other mutation.
  **Closes:** GAP-1.
  **Parallelization:** Wave 1 | Blocked by: - | Blocks: 2.
  **References:**
  - plan.ts:15-31, 98-117, 207-219, 253-256;
  - evaluate.ts:15-29, 58-103, 324-347;
  - emotion-score.ts:1569-1589 (size is computed only from held-only trials);
  - .omo/evidence/qa-tooling/task-13-validation/summary.md: 22 of 23 x0 survivors are impulse-hinted face channels.

  **Acceptance criteria (agent-executable):**
  - typecheck and validation tests exit 0;
  - new test: `killState({significance:true, sign:true, visibility:true, size:false, release:null}, 'detection-or-size') === 'killed'` and `killState({significance:true, sign:true, visibility:true, size:null, release:null}, 'detection-or-size') === 'survived'`;
  - `buildValidationPlan(emotionGate, {sections:['mutations'], seedsLimit:null})` gives the x0 experiment held-only cells;
  - replacing the size branch with the plain detection rule makes the new test fail (mutation receipt).

  **QA scenarios:**
  - **Happy:** `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/motion/validation` exits 0. Evidence: `.omo/evidence/motion-gate-redesign/task-1-tests.txt`.
  - **Failure:** the mutation receipt shows the new test failing with the size branch removed. Evidence: `.omo/evidence/motion-gate-redesign/task-1-mutation.txt`.

  **Commit:** Y | `fix(qa-tools): score x0 validation with held-only size so impulse hints cannot mask a zeroed recipe`
  Recommended task executor category: unspecified-low - a contained rule change in two files with tests.

- [x] 2. ignore-side: run both constant-side variants and prove unobservable pairs
  **What to do:**
  1. In `plan.ts`:
     - add `'ignore-side-neg'` to `mutationIds` right after `'ignore-side'`;
     - add it to `TableId` through the existing `Exclude`;
     - in `emotionTableFor`, the `'ignore-side-neg'` case negates `held.posture[axis]` for every axis in the original `held.sided`, then sets `held.sided = []`;
     - `mutationCells('ignore-side-neg')` equals `mutationCells('ignore-side')`.
  2. In `units.ts` `runGenerationUnit`, for cells of the experiments `mutation-ignore-side` and `mutation-ignore-side-neg`, also simulate the unmutated table (`emotionTableFor('natural')`) for the unit's first seed. Store `identicalToUnmutated: isDeepStrictEqual(mutatedRun, unmutatedRun)` in a new optional field of `ValidationRecordsPartial` in `gate/partials.ts`. Name it `sideEquality: { seed: number, identical: boolean } | null` and default it to null.
  3. In `evaluate.ts`:
     - make `mutationTargets` handle both variants;
     - a check moves to `notMutable` when its cell's `sideEquality.identical` is true. browAsym keeps its existing exclusion;
     - verify that every trial record in the cell carries the same `side` (`EmotionTrialRecord.side`, emotion-score.ts:139). Otherwise throw `[qa-tools] ignore-side cell <key> has mixed hold sides`;
     - add `validationThresholds.mutations['ignore-side-neg']` with the same criterion and 0.95;
     - add a pooled entry: the ignore-side verdict uses the kill rate over the gated (mutable) checks of both variants together, and each variant's own rate is reported.
  4. Keep `formatValidationSummary` printing both variants plus the pooled line.

  **Must NOT do:** touch hold.ts or the side hash, or add pulses to scenarios.
  **Closes:** GAP-2.
  **Parallelization:** Wave 1 | Blocked by: 1 | Blocks: 3.
  **References:**
  - plan.ts:18-21, 74-76, 101-117, 236-275;
  - units.ts:49-84;
  - gate/partials.ts (ValidationRecordsPartial);
  - evaluate.ts:46, 105-125, 324-347;
  - hold.ts:73-87 (side = (hash + changes) % 2) and :120-127 (side factor);
  - emotion-score.ts:139.

  **Acceptance criteria:**
  - typecheck and tests exit 0;
  - test: `emotionTableFor('ignore-side-neg')` negates exactly the formerly sided posture axes of awkward and clears `sided`;
  - test: a synthetic cell with `sideEquality.identical === true` lands in `notMutable` and not in `gated`;
  - test: mixed sides throw;
  - the smoke run in todo 5 reports both variants, with awkward's posture checks notMutable in exactly one of them.

  **QA scenarios:**
  - **Happy:** the validation tests exit 0. Evidence: `task-2-tests.txt`.
  - **Failure:** remove the notMutable branch, and the synthetic test fails. Evidence: `task-2-mutation.txt`.

  **Commit:** Y | `fix(qa-tools): run both constant-side ignore-side mutations and exclude provably identical traces`
  Recommended task executor category: deep-low - a new partial field plus an equality proof across units and evaluation.

- [x] 3. x0.5: replace the boundary kill rule with a paired size calibration
  **What to do:**
  1. In `evaluate.ts`, add the exported pure function `sizeCalibration(mutated: CheckResult, baseline: CheckResult | undefined): 'killed' | 'survived' | null`:
     - **null** unless baseline exists, baseline.sizeRatio !== null, baseline.sizeRatio > 0 and mutated.sizeRatio !== null;
     - otherwise **killed** when `mutated.sizeRatio / baseline.sizeRatio <= Math.SQRT1_2`, and **survived** otherwise.
  2. For `'x0.5'`, compute the gated kill rate with `sizeCalibration` against the unmutated set-1 baseline. The checks come from `mutationTargets`: non-modulation, with clear and strong gated and slight reported.
  3. The existing gate-verdict size kill rate stays in the report as `gateVerdictKillRate`, reported only.
  4. If the run does not include the `unmutated` section, the x0.5 entry has `killRate: null` and verdict false, with reason `'x0.5 calibration needs unmutated set 1'`.
  5. Set the criterion text to `'paired held-only size calibration <= 0.707 (clear and strong; slight reported only)'`. The minimum stays 0.9.

  **Must NOT do:** change gate.size.ratio or the x0.5 table.
  **Closes:** GAP-3.
  **Parallelization:** Wave 1 | Blocked by: 2 | Blocks: 4.
  **References:**
  - evaluate.ts:15-29, 105-160, 324-347;
  - plan.ts:31-32 (mutation seeds = unmutated set 1), 105-108, 257-258;
  - emotion-score.ts:1569-1589 (sizeRatio = heldEffect / |expected|; expected depends only on check, settings, ranges and gate, which are shared by both runs);
  - final-run/summary.txt:9 (64.4%).

  **Acceptance criteria:**
  - typecheck and tests exit 0;
  - tests of `sizeCalibration`: ratios 0.5/1.0 -> killed; 0.8/1.0 -> survived; baseline 0 -> null; missing baseline -> null; exactly SQRT1_2 -> killed;
  - removing the `<=` branch makes a test fail (receipt).

  **QA scenarios:**
  - **Happy:** the tests exit 0. Evidence: `task-3-tests.txt`.
  - **Failure:** the mutation receipt. Evidence: `task-3-mutation.txt`.

  **Commit:** Y | `fix(qa-tools): judge x0.5 by paired size calibration instead of the gate's inclusive size bound`
  Recommended task executor category: unspecified-low - one pure function and its wiring.

- [x] 4. unmutated: replace the all-pass requirement with persistence plus a binomial noise budget
  **What to do:**
  1. In `evaluate.ts`:
     - replace `validationThresholds.unmutated` with `{ sets: unmutatedSetCount, persistentFailSets: 4, noiseBeta: 0.01, noiseQuantile: 0.99 }`;
     - add the exported pure function `binomialQuantile(n: number, p: number, q: number): number`. It returns the smallest k with P(X <= k) >= q, summing pmf terms in log space.
  2. Rewrite the unmutated block (:313-322):
     - per check key, count the sets whose verdict is 'fail'. 'n/a' is counted separately and never as a failure;
     - `persistent` = keys with fail count >= 4;
     - `noiseFails` = the 'fail' verdicts of the non-persistent keys;
     - `noiseTrials` = the non-'n/a' check-set pairs of the non-persistent keys;
     - `budget = binomialQuantile(noiseTrials, 0.01, 0.99)`;
     - `verdict = persistent.length === 0 && noiseFails <= budget`.
  3. Keep the per-set pass and nonPassing lists. Add `persistent: [{ key, failSets, failed }]`, `nonEvaluable: [{ key, naSets }]`, `noiseFails`, `noiseTrials` and `budget`.
  4. Update `formatValidationSummary`'s unmutated lines to print the persistent findings and `noise fails X / budget Y over N`.

  **Must NOT do:** pick the budget from data, or exclude checks other than by the 4-of-5 rule.
  **Closes:** GAP-4.
  **Parallelization:** Wave 1 | Blocked by: 3 | Blocks: 5, 7.
  **References:**
  - evaluate.ts:15-29, 313-322, 388-415;
  - emotion-score.ts:212 (verdict 'pass' | 'fail' | 'n/a');
  - validation.json:546-547, 868-869, 1240-1241, 1551-1553, 1894-1895 (per-set rates);
  - ultrabrain consult (draft Decisions): about 27 at N = 1685.

  **Acceptance criteria:**
  - typecheck and tests exit 0;
  - `binomialQuantile(1685, 0.01, 0.99)` equals the value from an independent check in the test. Compute the cumulative sum in the test by plain iteration and assert both agree, and that the value is between 24 and 30;
  - a synthetic 5-set score with one key failing in 4 sets gives `persistent.length === 1` and verdict false;
  - all-'n/a' keys appear in `nonEvaluable` and not in the noise counts;
  - changing `>= 4` to `>= 6` makes a test fail (receipt).

  **QA scenarios:**
  - **Happy:** the tests exit 0. Evidence: `task-4-tests.txt`.
  - **Failure:** the mutation receipt. Evidence: `task-4-mutation.txt`.

  **Commit:** Y | `fix(qa-tools): judge unmutated validation by persistent findings and a binomial noise budget`
  Recommended task executor category: unspecified-low - a pure statistic plus a section rewrite.

- [x] 5. Record protocol version 2 and smoke-test the new protocol end to end
  **What to do:**
  1. Add `protocolVersion: 2` to the object `evaluateValidation` returns.
  2. Append one `protocolNotes` entry per change, K1-K4. Each states the rule and that it was fixed before the first protocol-2 run.
  3. Update the comment above `validationThresholds` to: `Thresholds of qa-tooling todo 13 (protocol 1) and motion-gate-redesign (protocol 2), fixed before any protocol-2 run.`
  4. Run the smoke command under the heavy-run lock: `node --import tsx packages/qa-tools/bin/motion.ts validate-scorer --level t1 --sections zero,mutations,unmutated --seeds 3`.
  5. Confirm in the new `.temp/qa/<run>/validation.json`:
     - `protocolVersion` is 2;
     - the x0 entry has `criterion` 'detection or held-only size';
     - both ignore-side variants are present with notMutable lists;
     - x0.5 has `gateVerdictKillRate` and a calibration killRate;
     - unmutated has `persistent`, `budget` and `noiseTrials`.
  6. Exit code 1 is acceptable: reduced seeds are not the committed gate.

  **Must NOT do:** treat smoke verdicts as results.
  **Closes:** IS-4.
  **Parallelization:** Wave 2 | Blocked by: 4 | Blocks: 6 | Parallel with: 7.
  **References:**
  - evaluate.ts:31-48, 368-386;
  - cli.ts:113-153;
  - README.md:145-153;
  - the heavy-run lock protocol in .agents/skills/motion-qa/SKILL.md ("Evidence and heavy runs").

  **Acceptance criteria:**
  - a jq/node dump of those six fields saved;
  - validation tests and typecheck exit 0.

  **QA scenarios:**
  - **Happy:** the smoke run completes, and the field dump matches. Evidence: `task-5-smoke.txt`, `task-5-fields.json`.
  - **Failure:** run `--sections mutations` alone. The x0.5 entry must show reason 'x0.5 calibration needs unmutated set 1' and verdict false. Evidence: `task-5-no-baseline.txt`.

  **Commit:** Y | `feat(qa-tools): record scorer validation protocol version 2`
  Recommended task executor category: unspecified-low - wiring plus a reduced run.

- [x] 6. Run the full protocol-2 validation and record its findings
  **What to do:**
  1. Take the heavy-run lock, then run `node --import tsx packages/qa-tools/bin/motion.ts validate-scorer --level t1` with every section and committed seeds. Record the exit code.
  2. Archive the run's `validation.json`, `summary.txt`, `run.json` and timing into `.omo/evidence/motion-gate-redesign/full-run/` with `pnpm -F @proj-airi/qa-tools run evidence archive --plan motion-gate-redesign`, or a plain copy if that command does not accept the run.
  3. Write `.omo/evidence/motion-gate-redesign/findings.md`. For each section, give the verdict and the numbers. For x0, ignore-side and x0.5, list the survivors with their channels. For unmutated, list every `persistent` key with its fail sets and failed criteria, grouped by criterion (visibility, significance, release, size), plus the noise count against the budget.
  4. State, per prediction, whether it held:
     - x0 >= 0.99;
     - pooled ignore-side >= 0.95 on mutable checks;
     - x0.5 calibration >= 0.90;
     - unmutated failing only on persistent checks.
     A missed prediction is a finding. Do not change any constant.

  **Must NOT do:** rerun with different constants, or edit recipes or gates.
  **Closes:** IS-1, IS-2 (evidence).
  **Parallelization:** Wave 3 | Blocked by: 5 | Blocks: 8.
  **References:**
  - cli.ts:20-153;
  - .omo/evidence/qa-tooling/task-13-validation/ (protocol-1 baseline: 2675.7 s on 15 workers);
  - README.md:145-153.

  **Acceptance criteria:**
  - `validation.json` has `protocolVersion` 2 and `seedsLimit` null;
  - findings.md lists every persistent key that appears in `validation.json` (an automated check: node script comparing the key sets, exit 0);
  - the lock is released.

  **QA scenarios:**
  - **Happy:** the run completes with exit 0 or 1, and `findings.md` matches `validation.json`. Evidence: `task-6-run.txt`, `full-run/validation.json`, `findings.md`.
  - **Failure:** if the run breaks (crash or timeout), save the log, set BLOCKED, and do not write findings. Evidence: `task-6-run.txt`.

  **Commit:** N (evidence only, ignored by git).
  Recommended task executor category: unspecified-high - a long heavy run plus careful findings write-up.

- [x] 7. Draft the protocol-2 documentation
  **What to do:**
  1. Add `docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md` with Context, Decision and Consequences sections. It covers:
     - the four causes;
     - the K1-K4 rules and the decision record (Luke approved the recommended options on 2026-10-21);
     - unchanged gates and golden hash;
     - persistent checks as findings, not retunes.
  2. Rewrite `docs/ai/adr/2026-10-20-motion-qa-levels.md` line 51 to say the limits are superseded by the new ADR, and link it.
  3. In `packages/qa-tools/README.md`:
     - rewrite "Known limitations" (:85-89) and the validate-scorer bullets (:149-153) for protocol 2, including the two ignore-side variants, the x0.5 calibration, and the persistence and budget rule;
     - leave a placeholder sentence `First protocol-2 run: see todo 8`, which todo 8 replaces.
  4. Run `node --import tsx packages/qa-tools/scripts/check-doc-paths.ts` from the repo root, positive and negative. For the negative, use a temp copy of the new ADR with a bogus path, as qa-tooling todo 17 did.

  **Must NOT do:** edit .agents/ or AGENTS.md here.
  **Closes:** GAP-5 (part).
  **Parallelization:** Wave 2 | Blocked by: 4 | Blocks: 8 | Parallel with: 5, 6.
  **References:**
  - README.md:45-55, 85-89, 145-153;
  - docs/ai/adr/2026-10-20-motion-qa-levels.md:17-52;
  - packages/qa-tools/scripts/check-doc-paths.ts (the doc path checker from qa-tooling todo 17).

  **Acceptance criteria:**
  - the path checker exits 0, and the negative exits 1;
  - `rg -n "92.9%|83.3%|64.4%|84% to 88%" packages/qa-tools/README.md docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md` mentions them only as protocol-1 history.

  **QA scenarios:**
  - **Happy:** the checker passes. Evidence: `task-7-paths.txt`.
  - **Failure:** the negative copy with a bogus path exits 1. Evidence: `task-7-paths-negative.txt`.

  **Commit:** held until todo 8 fills the findings; one docs commit.
  Recommended task executor category: writing - documentation only.

- [x] 8. Finalize the docs with the first-run findings and update the motion-qa skill
  **What to do:**
  1. Replace the README placeholder and add a "Findings" paragraph to the new ADR. Draw both from `.omo/evidence/motion-gate-redesign/findings.md`: section verdicts, the counts of persistent checks per criterion, and the noise count against the budget.
  2. Commit the docs: `docs(qa-tools): document scorer validation protocol 2 and its first findings`.
  3. In a separate commit, update `.agents/skills/motion-qa/SKILL.md` :50 (the accepted-limits paragraph) to describe protocol 2 and point at the new ADR: `chore(agents): describe scorer validation protocol 2 in motion-qa skill`.
  4. Run the golden hash script and record the result. It must match 41c0725b....
  5. Run root `pnpm verify`, which must exit 0.

  **Must NOT do:** mix docs and agent-config in one commit.
  **Closes:** GAP-5, IS-3 (proof), IS-5.
  **Parallelization:** Wave 3 | Blocked by: 6, 7 | Blocks: F1-F4.
  **References:**
  - .agents/skills/motion-qa/SKILL.md:40-56;
  - AGENTS.md ("Keep agent configuration changes in a separate commit");
  - .omo/evidence/qa-tooling/task-0-golden-hash.ts.

  **Acceptance criteria:**
  - the golden hash combined equals 41c0725b8a1bbfaa0c78c55a6f147ad928585d0933c2dc95b52de95583431d8a;
  - `pnpm verify` exits 0;
  - `git show --stat` of the agents commit lists only .agents/ files.

  **QA scenarios:**
  - **Happy:** the golden hash, verify and the path checker all pass. Evidence: `task-8-golden.txt`, `task-8-verify.txt`.
  - **Failure:** `git diff main --stat -- packages/stage-ui-live2d/src/composables/live2d/natural-motion` is empty. If it is not, fail. Evidence: `task-8-natural-untouched.txt`.

  **Commit:** Y | the two commits above.
  Recommended task executor category: writing - docs and skill text from recorded findings.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Every todo's Must and Must NOT items map to receipts in `.omo/evidence/motion-gate-redesign/`. Also check:
  - no file under `natural-motion/` changed;
  - no new dependency;
  - the agent-config commit is separate;
  - the protocol constants equal the plan's: 0.99, 0.95, `SQRT1_2`, 0.9, 4-of-5, beta 0.01, quantile 0.99.
- [x] F2. Code quality review
  Run, in a fresh worktree at the tip:
  - the qa-tools typecheck and node suite;
  - `pnpm verify`.

  Review the diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md` and `.agents/skills/enforce-rules-for-vitest/SKILL.md`: no `any`, tests that fail under the named mutation, and no fixed sleeps.
- [x] F3. Real manual QA
  Rerun the todo 5 smoke command. Check the six fields in `validation.json` and the new summary lines in `summary.txt`. Confirm the full-run `findings.md` matches its `validation.json` with the key-set script.
- [x] F4. Ideal-state fidelity
  Check IS-1..IS-5 one to one against the evidence. Any shortfall becomes a new `- [ ] N.` row.

## Commit strategy
- One commit per code todo (1-5), each with its own tests, in the repo's Conventional Commit style (`fix(qa-tools): ...`, `feat(qa-tools): ...`).
- Docs commit: todos 7 and 8.
- Separate agent-config commit: the motion-qa skill.
- Todo 6 commits nothing; its evidence stays under the ignored `.omo/evidence/`.
- Land on `main` by rebase plus fast-forward after F1-F4 and Luke's okay. Re-check `git log main` first, because other sessions move `main`.
- Footer on the last commit: `Plan: .omo/plans/motion-gate-redesign.md`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1, 2, 3, 4, 6 | Unit tests with mutation receipts; the full run shows x0, ignore-side and x0.5 against their predicted rates. A miss is listed as a finding. | task-1..4-*.txt, full-run/validation.json, findings.md |
| IS-2 | 4, 6 | The full run's `unmutated.persistent` list equals findings.md; noise against budget is printed. | full-run/validation.json, findings.md |
| IS-3 | 8, F1 | The golden hash matches 41c0725b...; the diff under natural-motion is empty. | task-8-golden.txt, task-8-natural-untouched.txt |
| IS-4 | 5 | `protocolVersion` is 2 and protocolNotes has the K1-K4 entries before the full run. | task-5-fields.json |
| IS-5 | 7, 8 | The path checker passes and the negative fails; the README, ADRs and skill describe protocol 2 and its findings. | task-7-paths*.txt, the commits |
