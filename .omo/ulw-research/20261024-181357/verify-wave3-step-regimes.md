# Verification wave 3: step shifts + regimes (lane st_01a1702f, journaled 2026-10-24T23:28:04.677Z)
Scripts/stdout: C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/{human_steps.py,steps.ts,wander-out/human_steps.out.txt,steps-report-*.txt}

st_01a1702f [completed] transcript via event-log:
assistant: I read this as an execution-verification task: characterize the human step structure, run the S1-S4, R1 and R2 arms through the existing harness, then report verdicts. I'll stop when the tables and verdicts (a)-(d) are written from executed output.
tool: eval
tool: read
tool: read
tool: read
tool: read
tool: eval
tool: eval
tool: read
tool: write
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
assistant: ## Handoff
Ask: test whether step-like head shifts with holds plus a minutes-scale activity regime can match Luke's recordings, and name the gate metrics such arms fail. Wanted: executed numbers and verdicts (a)-(d).
For you: all four verdicts below come from executed runs: 20 arm variants, seeds 1-3, gate protocol. The harness is unchanged, so the numbers are comparable with the previous lane. Only scratch files were written. No tracked file was touched and the app was not launched.
Now: done. Next: your decision on the EXPAND leads below.

**Quiet fast OU does not work.** Min-jerk shifts are monotone, so they produce almost no 0.25° reversals. Reversals come from the OU. Cutting OU sd to x0.3 drops yaw q25 to 0.40-0.56x human and makes the head too still. Yaw q25 reaches the recording level only when OU sd is back to roughly baseline or higher. I also added arms S5-S8 and R3/R4 beyond the brief.

## Paths and versions
- Scratch dir: `C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/`.
- Scripts: `human_steps.py` (step analysis) and `steps.ts` (copy of `wander.ts` plus the new arms). `wander-report.mjs` is reused unchanged.
- Stdout and reports: `wander-out/human_steps.out.txt` and `steps-report-{S,S567,S8,r1_,r1L_,r1X_,r2_,r2X_,r3_,r3L_,r3X_,r4_,r4X_}.txt`. Per-run JSON is also in `wander-out/`.
- Versions: bun 1.3.14, Python 3.13.12, numpy 2.5.4.

## Step 1: human step structure
Pooled 7525 s of 30 Hz data. A move is a run of 3-axis speed above the threshold lasting at least 100 ms. "Merge3" means runs separated by at most 3 samples (0.1 s) are joined.

| Quantity | Value |
|---|---|
| Frames with speed > 2 deg/s | 57% |
| Frames with speed < 0.5 deg/s | 8% |
| Path from frames above 2 deg/s | 94% |
| Move rate, 2 deg/s, no merge | 0.89/s |
| Move rate, 2 deg/s, merge3 | 0.49/s |
| Hold q10/50/90/99, merge3 | 0.13 / 0.37 / 1.9 / 7.3 s |
| Hold lognormal fit (mu, sigma), merge3 | -0.82, 1.02 |
| Hold q50/q99, no merge | 0.13 / 5.6 s |
| Move amplitude q10/50/90/99 | 0.28 / 0.88 / 6.4 / 31 deg |
| Move duration median / q90 | 0.40 / 2.9 s |
| 10 s windows: speed CV / CV after dropping top 5% | 1.09 / 0.84 |
| 60 s windows: speed CV / CV after dropping top 5% | 0.775 / 0.66 |
| 60 s windows: CV after dropping bottom 5% / both 5% | 0.74 / 0.62 |
| Lag-1 autocorrelation of 10 s log-speed | 0.61 |
| Same autocorrelation at lag 6 (60 s) | 0.17 |
| Dwell above/below median speed, q50 / q90 | 20 s / 70-80 s |
| Moves/s across 60 s windows, CV | 0.40 |

- The human is mostly in motion, not "move, then freeze". Holds are short.
- The 60 s CV is not driven by a few burst windows; dropping the top 5% only takes it from 0.775 to 0.66.
- The regime timescale is about 20-60 s, shorter than the 1-5 minutes in the brief. I tested dwell 40 s and 120 s.
- The default model shift distance has median 4.5 deg. Human moves have median 0.9 deg with a tail to 31 deg.
- My amplitude calibration for S4 got median 1.5 deg, p90 5.4 deg, p99 15 deg. The model's 0.7 pull-back and 0.75 target limit cap the tail.

## Step 2: arms and results
Arm definitions, all built on W7 (OU tau x5, sd x2, filterTau x2) with the rest below:
- **S1:** OU sd x0.3.
- **S2:** S1 with shift amplitude x1.5.
- **S3:** S1 with lognormal holds (mu -0.82, sigma 1.02) at rate x1.5.
- **S3f:** S3 at rate x1.
- **S4:** S3 with amplitude median 0.03 (normalized units), log sd 1.5.
- **S5-S8:** S3 holds with OU sd x0.5/0.65/0.8/0.74 (a sweep I added).
- **R1:** 2-state Markov regime on S7. Calm state: rate x0.4, amplitude x0.5. Active state: rate x1.8, amplitude x1.7. Dwell 40 s.
- **R1L:** R1 with dwell 120 s.
- **R1X:** stronger regime, rate 0.25-2.5, amplitude 0.3-2.5, dwell 40 s.
- **R2:** continuous log-gain OU on S7, tau 120 s.
- **R2X:** stronger version, tau 60 s.
- **R3/R3L/R3X:** R1/R1L/R1X with the regime applied to shifts only, OU untouched.
- **R4/R4X:** R2/R2X with the regime applied to shifts only.

The regime multiplies the shift rate and amplitude. In R1, R1L, R1X, R2 and R2X it also scales the fast OU. In R3, R3L, R3X, R4 and R4X it leaves the OU alone. The facade resets `amplitudeScale` and `shiftRateScale` every frame, so the regime runs in its own variables.

Streams are paired for the OU, drift, gain and shift-direction draws. They are not exactly paired once holds are drawn from a different distribution.

Human reference: yaw q25 0.436, CV60 0.775, mean speed 6.7 deg/s, still05 band [0.02, 0.10], still2 band [0.22, 0.447].

| Arm | dist | yaw q25 (ratio) | CV60 | CV10 | speed | still05 | still2 | Median-failing gated metrics |
|---|---|---|---|---|---|---|---|---|
| W7 | .738 | .777 (1.78) | .105 | .260 | 5.5 | .065 | .436 | jitter, speedPeakLogAsym (SPLA) |
| S1 | 1.581 | .176 (.40) | .123 | .318 | 4.5 | .329 | .706 | still05, still2, top10PathShare, jitter, SPLA |
| S2 | 1.413 | .182 (.42) | .136 | .297 | 6.1 | .321 | .683 | S1's plus angleXp95, speedPeakP90P50 |
| S3 | 1.033 | .229 (.53) | .125 | .301 | 6.0 | .263 | .588 | still05, still2, jitter, speedPeakP90P50, SPLA |
| S3f | 1.309 | .202 (.46) | .146 | .353 | 5.0 | .307 | .670 | same as S3 |
| S4 | 1.730 | .244 (.56) | .160 | .407 | 2.9 | .298 | .700 | sd X/Y/Z LOW, still05, still2, angleXp5, angleXp95, jitter |
| S5 | .807 | .388 (.89) | .121 | .291 | 6.3 | .151 | .534 | still05, still2, jitter, speedPeakP90P50, SPLA |
| S6 | .690 | .521 (1.20) | .119 | .285 | 6.5 | .107 | .477 | same as S5 |
| S8 | .621 | .586 (1.34) | .117 | .281 | 6.6 | .088 | .445 | jitter, speedPeakP90P50, SPLA |
| S7 | .580 | .627 (1.44) | .117 | .279 | 6.6 | .077 | .424 | jitter, speedPeakP90P50, SPLA |
| R1 | .417 | .572 (1.31) | .444 | .657 | 7.3 | .142 | .497 | still05, still2, jitter, SPLA |
| R1L | .390 | .596 (1.37) | .593 | .698 | 7.5 | .146 | .478 | still05, still2, angleXp95, jitter, SPLA |
| R1X | .379 | .554 (1.27) | .583 | .831 | 9.4 | .246 | .499 | sd Z, still05, still2, angleXp95, jitter, SPLA |
| R2 | .479 | .617 (1.41) | .499 | .597 | 6.8 | .113 | .459 | still05, still2, jitter, SPLA |
| R2X | .559 | .522 (1.20) | .716 | .918 | 6.0 | .222 | .554 | still05, still2, jitter, SPLA |
| R3 | .499 | .620 (1.42) | .388 | .585 | 7.4 | .080 | .447 | still2 (marginal), jitter, SPLA |
| R3L | .488 | .618 (1.42) | .525 | .627 | 7.5 | .083 | .440 | angleXp95, jitter, SPLA |
| R3X | .447 | .617 (1.42) | .516 | .742 | 9.3 | .077 | .442 | sd Z, angleXp95, jitter, SPLA |
| R4 | .539 | .635 (1.46) | .450 | .550 | 6.8 | .084 | .439 | jitter, SPLA only |
| R4X | .642 | .633 (1.45) | .608 | .798 | 6.2 | .089 | .480 | still2, jitter, SPLA |

`dist` is the previous lane's mean absolute log distance over the six reversal values and four yaw Welch bands. Full per-metric values and per-seed PASS/LOW/HIGH are in the `steps-report-*.txt` files.

**Ranking by dist:** R1X .379 < R1L .390 < R1 .417 < R3X .447 < R2 .479 < R3L .488 < R3 .499 < R4 .539 < R2X .559 < S7 .580 < S8 .621 < R4X .642 < S6 .690 < W7 .738 < S5 .807 < S3 1.033 < S3f 1.309 < S2 1.413 < S1 1.581 < S4 1.730.

**Ranking by 60 s CV distance |ln(CV/.775)|:** R2X .08 < R4X .24 < R1L .27 < R1X .29 < R3L .39 < R3X .41 < R2 .44 < R4 .54 < R1 .56 < R3 .69, then every non-regime arm at 1.58 or worse.

## Verdicts
- **(a) PARTIAL.** Quiet-OU step arms S1-S4 reach only 0.40-0.56x the human yaw q25, so the quiet-OU hypothesis is refuted. A step arm gets within 30% only when OU sd is raised to baseline or above: S5 is 0.89x, S6 is 1.20x, and R1X at 1.27x is also inside the band. S8 (1.34x) and R1 (1.31x) just miss it. The OU, not the steps, supplies the reversals.
- **(b) REFUTED.** Every arm within 30% of q25 fails still05 and still2: S5, S6 and R1X do. Arms that pass both, such as S7, S8, R3 and R4, sit at 1.34-1.46x q25. The tradeoff is that OU sd controls both quantities, with the crossing near sd x0.74-0.8 (q25 about 1.34-1.44x).
- **(c) CONFIRMED.** CV60 is at least 0.39 for R1 .444, R1L .593, R1X .583, R2 .499, R2X .716, R3L .525, R3X .516, R4 .450 and R4X .608. R3 at .388 is marginal. Each is a median over 3 seeds with about 30 windows per seed. 10 s CV peaks at .92 against the human 1.09.
- **(d) Closest arms:**
  - **R1X** (nominally closest, dist .379) fails sd:ParamAngleZ HIGH, still05, still2, angleXp95, jitter and SPLA.
  - **R4** (closest among arms that pass stillness, dist .539, CV60 .45) fails only jitter LOW (3.9e-6 vs band floor 1.47e-5) and speedPeakLogAsymmetry LOW (.68 vs floor 1.05). It fails them by seed too: jitter and SPLA fail in all three seeds, and seed 2 also fails still05, still2 and angleXp5. W7 already failed both of these.
  - **Band provenance** (my reading of `extract-natural-reference.ts:44-57` plus arithmetic on the generated bands; `reference-stats.ts` itself not opened):
    - Jitter is provisional and gets the x0.6-1.6 heuristic. The band [1.47e-5, 3.92e-5] equals 2.45e-5 x 0.6 and x 1.6.
    - speedPeak* metrics use x0.7-1.4, not x0.6-1.6. SPLA [1.05, 2.10] equals 1.5 x 0.7 and x 1.4. The speedPeakP90P50 upper bound is widened to include a recorded session.
    - sd:* metrics also use x0.7-1.4, subject to widening.
    - still05, still2 and angleXp95 are hand-set initial bands, widened only to include both recorded sessions (still2's upper bound is .447 instead of .43). So they are not heuristic-derived.

## EXPAND
- LEAD: Recalibrate the jitter and SPLA bands, or the shift model's smoothness and speed-peak shape. WHY: R4 matches everything else (stillness, CV60 .45, dist .54) and fails only those two, which every OU-heavy arm fails too. ANGLE: Compare jitter and SPLA against both recorded sessions separately to see whether their bands are over-tight. Test shorter min-jerk durations or a heavier-tailed shift speed.
- LEAD: Regime applied to shifts only with a log-gain OU (R4/R4X), tuned for q25 and CV together. WHY: it is the only family that passes stillness with CV60 at least 0.39, but R4 is still 1.46x on q25. ANGLE: Sweep the OU sd x0.7-0.74 together with regime sdR/sdA at tau 60-120, and score on more seeds. The CV60 estimate currently uses about 30 windows per seed.
- DEAD END: Quiet fast OU plus bigger or more frequent monotone shifts (S1-S4), and stationary step arms (CV60 about 0.12-0.16, regardless of step statistics).
