# Scorer validation protocol 2

Date: 2026-10-21
Status: accepted

## Context

Protocol 1 exposed four limits. The x0 mutation detected only 92.9% of checks because impulse hints remained active and could still move face channels after the held recipe was zeroed. The `ignore-side` mutation detected 83.3% because T1 fixes the hold side for an emotion, and clearing `sided` can exactly reproduce the natural table on one side. The x0.5 mutation detected 64.4% because its half-strength recipe landed on the inclusive lower size bound of 0.5, so the gate could still pass it. Unmutated sets passed 84% to 88% of checks, mixing checks that fail persistently with ordinary noise and treating results that are not applicable as failures.

These are protocol-1 results and remain historical. They motivated changes to how the scorer is validated, not changes to the scorer or its gates.

## Decision

Luke approved the recommended protocol-2 options on 2026-10-21. The rules and constants below were fixed before the first protocol-2 run.

- **K1, x0:** Include `full`, `held-only`, and `long-hold` cells. A check is killed by failed detection or failed held-only size. The minimum kill rate remains 0.99.
- **K2, ignore-side:** Run both `ignore-side` and `ignore-side-neg`. The first clears `sided` as before. The second also negates `posture[axis]` for every formerly sided axis before clearing `sided`. For each variant, `sideEquality` records whether the first-seed mutated trace equals the natural-table trace for that cell. A check is `notMutable` when this proof is true. Mixed hold sides within a cell are rejected. The 0.95 minimum applies to the pooled mutable checks across both variants; each variant's rate is also reported.
- **K3, x0.5:** Judge the mutation using paired `sizeCalibration`: divide the mutated held-only `sizeRatio` by the unmutated set-1 `sizeRatio`. A result is not evaluable unless both ratios exist and the baseline ratio is positive. A check is killed when the quotient is at most `Math.SQRT1_2`. The 0.90 minimum applies to clear and strong checks; slight checks are reported only. Without the unmutated set-1 baseline, the calibration has no kill rate, fails with reason `x0.5 calibration needs unmutated set 1`, and does not substitute the gate verdict. The gate-verdict size kill rate remains in `gateVerdictKillRate`, reported only and not used for the calibration verdict.
- **K4, unmutated:** A check is persistent when its verdict is `fail` in at least 4 of 5 sets. Any persistent check is a finding and fails the section. For remaining checks, count check-set pairs with an evaluable result as `noiseTrials` and their failures as `noiseFails`. The fixed `budget` is `binomialQuantile(noiseTrials, 0.01, 0.99)`, the 0.99 quantile of Binomial(`noiseTrials`, 0.01). The section passes only when there are no persistent findings and `noiseFails` does not exceed the budget. Results that are not applicable are reported separately and never count as failures.

The report records `protocolVersion: 2` and describes the changes in `protocolNotes`. Gates, Natural code, and the golden idle hash are unchanged.

## Findings

The first full protocol-2 run passed A/A, zero, mutations, and determinism; unmutated failed. Mutation thresholds passed: x0 killed 324/325 eligible checks, pooled ignore-side killed 72/72 mutable checks, and x0.5 calibration killed 174/174 clear and strong checks. The unmutated run identified 37 persistent findings, with 7 failing visibility, 6 significance, 31 release, and 3 size criteria; counts overlap when a check failed more than one criterion. The remaining 66 noise failures exceeded the fixed budget of 25 over 1,500 check-set pairs. Therefore, the prediction that unmutated would fail only through persistent checks was missed. No constants, recipes, or gates were changed. The complete check list is in .omo/evidence/motion-gate-redesign/findings.md.

## Consequences

Validation misses now identify persistent check findings separately from the fixed allowance for noise. Persistent checks are findings for Luke, not authorization to retune recipes, gates, thresholds, or protocol constants. A missed predicted rate remains a finding under these fixed rules.

The protocol-1 limits above remain part of the historical record only.
