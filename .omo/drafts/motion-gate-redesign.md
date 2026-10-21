---
slug: motion-gate-redesign
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/motion-gate-redesign.md
plan_sha256: 205d990af69f8adb87e4054005236ae7dec8d25cb32ef4d5d7f8ff1ccededdf2
review_round_id: null
review_round_limit: 5
pending-action: plan written; plan-reviewer and plan-consultant refused by the harness plan gate in this session (no explicit /skill:ulw-plan request); self-review done; Luke may rerun review via /skill:ulw-plan
review:
  plan_reviewer:
    status: gate_locked
    workspace_root: null
    runtime_home: null
    target: .omo/plans/motion-gate-redesign.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
approach: <fill: the approach you intend to plan>
---

# Draft: motion-gate-redesign

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- Agents running `pnpm qa:motion validate-scorer` to decide whether the emotion scorer can be trusted.
- Luke, who reads the verdict and decides on recipe and gate follow-ups.
- T1/T2/T3 gates and the report, which consume the same scorer.

Ideal state:
- IS-1 | Every validation requirement is attainable by a sound scorer and fails only on a real scorer or recipe defect | today 3 of 4 misses are harness-design artifacts (ultrabrain st_01a15cc6).
- IS-2 | A miss names its cause: a persistent check is a finding, noise is budgeted | today all 73 failing checks are lumped as "84-88%".
- IS-3 | Gate contract, T3 gate and golden idle hash unchanged unless Luke approves a versioned gate change | do not retune merely to pass.
- IS-4 | Protocol fixed and written in protocolNotes before the next run | no post-hoc thresholds.
- IS-5 | Docs (README, ADR, motion-qa skill, report limitations) state the new protocol and remaining findings | agents read these.

Gaps:
- GAP-1 | x0 kill rule ignores held-only size, so impulse hints mask a zeroed recipe | IS-1.
- GAP-2 | ignore-side cannot change awkward's output (fixed side +1) yet counts as a survivor | IS-1.
- GAP-3 | x0.5 lands exactly on the 0.5 size bound, so the 90% target contradicts the gate | IS-1.
- GAP-4 | Unmutated requires 1685/1685 check passes; release noise makes that unattainable, and the 23 always-failing checks are not separated | IS-1, IS-2.
- GAP-5 | Docs state the old accepted limits | IS-5.

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
- K1 | x0 protocol | active
- K2 | ignore-side protocol | active
- K3 | x0.5 protocol | active
- K4 | unmutated requirement | active
- K5 | Validation run, findings hand-off and docs | active

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
- Consumer map (explore st_01a15cc7, claims to verify):
  - Thresholds live in packages/qa-tools/src/motion/validation/evaluate.ts:20-28 (x0, ignore-side, x0.5, unmutated); the verdict `thresholdsMet` is at :313-368. Mutations and set counts are in validation/plan.ts:15-31,105-131,257-258. The exit-1 logic is validation/cli.ts:122-153. Pins are in validation/validation.test.ts:26-72.
  - gates.ts:13-16 rule: a change to metrics, thresholds, windows or interpretation needs a gate version bump. The gate version seeds the scorer streams (emotion-score.ts:1264-1272) and is in the hashed report body (gate/aggregate.ts:46-47). A version bump therefore changes every report determinismHash, and the T3 archive rescore compares the archived T1 hash (t3-gate.ts:215-216), so old T1 references stop matching.
  - T3 reuses the shared scorer and adds transfer, visibility and release checks (t3-score.ts:75-185). The report renders row verdicts only (report/cells.ts); the limitations prose is report/limitations.ts:1-6.
  - known-failures.json has no validate-scorer entry. The accepted limits are stated in README.md:85-89, ADR 2026-10-20-motion-qa-levels.md:49-52 and motion-qa SKILL.md:50. Plan qa-tooling row 23 (:502-506) forbids loosening thresholds without an explicit decision.
  - The golden idle hash (observer.test.ts:12) covers idle motion, not the scorer, so a scorer-only change should not move it (to verify).
- Harness map (explore st_01a15cc5, claims to verify):
  - Thresholds (evaluate.ts:15-29): x0 0.99, sign 0.99, ignore-side 0.95, x0.5 0.90, x2 0.90, releaseTau-x3 0.95, blink-1 0.95, unmutated 1.0 per set. A/A: at most 1 of 20 sets with a pass, mean placebo hit 0.10 +/- 0.03, KS p > 0.01. `thresholdsMet` = every section true (:368); missed -> exit 1 (cli.ts:153).
  - x0 scales `held` only (plan.ts:253-256), but the impulse spec survives (emotions.ts:68-97; impulses.ts:146-240). 22 of 23 x0 survivors are face channels moved by impulses (task-13 summary.md).
  - Ignore-side clears the `sided` axes (plan.ts:266-268), but NaturalHoldLayer.set picks the side from a hash of the emotion plus a change count (hold.ts:73-87), so T1 gets the same side every seed. Awkward's fixed side +1 makes 12 posture checks unkillable.
  - x0.5: the natural-emotion v1 size ratio band is [0.5, 1.5] (gates.ts:105-110,130), with inclusive lower-bound comparison at emotion-score.ts:1568-1589. Halving lands exactly on the bound; kill rate 64.4% (clear/strong), 72.4% (slight).
  - Unmutated: 5 sets x 337 checks; pass needs verdict 'pass' (n/a counts as non-pass, evaluate.ts:316-320). Rates 86.9/84.9/87.5/86.1/84.3% (final-run/summary.txt:14-18).
  - Gates: natural-emotion v1 (T1/T2), natural-emotion-t3 v2. A change means editing gates.ts and bumping the version before running (SKILL.md:54-56).

## Decisions (with rationale)
- 2026-10-21: the four-fork question timed out (30 min, no answer). Under Luke's away rule, the recommended options were adopted provisionally; Luke then replied "approve", which confirms them.
  - K1 x0 = a1: add held-only cells to x0; a check counts as killed if detection OR size fails; the 0.99 target stays.
  - K2 ignore-side = b1: run +side and -side variants; pairs with identical traces (proved by a trace-equality assertion) are listed as notMutable; the 0.95 target stays.
  - K3 x0.5 = c1: a paired same-seed size calibration; killed when the ratio of mean held effects (x0.5 / unmutated) is at most sqrt(0.5) ~= 0.707; the gate-verdict kill rate becomes reported-only. Separately, ask Luke whether a 0.5x recipe should be inside the size contract.
  - K4 unmutated = d1: a check failing in 4 or more of 5 sets is a finding and fails the section; the remaining failures must stay within the 99% quantile of Binomial(1685, 0.01), computed in code and fixed in protocolNotes before any run.
  - No change to gates.ts, the T3 gate or Natural code; the golden idle hash must stay unchanged.
  - Test strategy: tests-after (Luke's qa-tooling choice).

## Scope IN

## Scope OUT (Must NOT have)

## Open questions
- Owner decisions on K1-K4 (protocol/requirement changes): recommended a1, b1, c1, d1 (beta 0.01, 4-of-5 persistence), from ultrabrain st_01a15cc6.
- Test strategy: default tests-after (Luke's choice for qa-tooling 2026-10-20); agent-executed QA always included.
- Swept axes: no budget or spend; stack fixed (qa-tools); scale = one 16-core machine, about 45 min per full validation run; audience = agents and Luke.

## Approval gate
status: approved (Luke: "approve", 2026-10-21; options K1-K4 confirmed as recommended)
approach: harness-only protocol changes K1-K4 in packages/qa-tools/src/motion/validation (plan.ts, evaluate.ts, units/tests), one full validate-scorer run, findings hand-off of persistent checks, docs (README, ADR, report limitations; motion-qa skill in a separate agent-config commit).
next: on Approve, scaffold the plan, run plan-consultant, append todos, fill TL;DR last, then plan-reviewer rounds.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Review log
- 2026-10-21: the plan was written after Luke's "approve". plan-consultant and plan-reviewer spawns were refused, because the harness plan gate requires an explicit /skill:ulw-plan request in this session. A self-review stood in for them.
- Self-review:
  - Every GAP has a todo: GAP-1 -> 1, GAP-2 -> 2, GAP-3 -> 3, GAP-4 -> 4, GAP-5 -> 7, 8.
  - Every IS row has a proving scenario in Success criteria.
  - The structure check passed: 8 implementation rows and 4 final rows, all column-zero in the right sections, each with a category line, no placeholders, and TL;DR first.
  - The code facts behind K1-K4 were verified directly in plan.ts, evaluate.ts, units.ts, gates.ts:105-135, emotion-score.ts:139,212,1569-1589 and hold.ts:73-127.
