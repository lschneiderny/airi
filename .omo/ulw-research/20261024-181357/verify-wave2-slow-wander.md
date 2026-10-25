# Verification wave 2: slow-wander retune (lane st_01a17028, journaled 2026-10-24T23:12:28.078Z)
Scripts/stdout: C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/{wander.ts,wander-report.mjs,human_wander.py,wander-report.txt,wander-out/}

st_01a17028 [completed] transcript via event-log:
assistant: I read this as a verification-by-execution task: patch the OU in scratch, run the arms, and report tables and verdicts. I'll stop when the report has all arms, the tables, and the three verdicts.
tool: eval
assistant: The directory listing came back, but the `ablate.ts` content didn't. I'll read it directly.
tool: read
tool: read
assistant: `ablate.ts` and `gates.ts` are loaded. Next I need the gate test settings, the liveliness scorer, the OU/posture code and the human comparison script.
tool: eval
tool: read
assistant: I have the harness and the human comparison script. I still need the OU and posture implementation, the gate test and the scorer.
tool: read
tool: read
tool: read
tool: eval
assistant: Node v26 ran the earlier scripts, so I'll use it again. Next I'll read the scorer body to get the metric ids and band format.
tool: read
tool: read
tool: write
assistant: The script is written. First I'll time one baseline run (A, seed 1) to size the parallel launch.
tool: eval
assistant: Node can't resolve the directory import, so `ablate.ts` was probably run with bun. I'll retry with bun.
tool: eval
assistant: The run takes about 3 s, which is fast. Now I'll calibrate the W4 slow-OU SD against the 2.61 deg^2 target using the 30 Hz gate-trace Welch band.
tool: eval
assistant: At SLOW_SD 0.3 the yaw 0.5-1 Hz band is about 2.87 deg^2, so 0.28 should land near the 2.61 target. I'll run the six main arms for seeds 1-3 with SLOW_SD 0.28.
tool: eval
assistant: Those 18 runs finished in about 19 s. Next I need the matching human numbers: amplitude bins and diversity on the same 30 Hz grid. I'll extend `human_compare.py` by importing it.
tool: write
tool: eval
tool: edit
tool: write
assistant: Now I'll rerun the human script with the fix and generate the first report.
tool: eval
tool: read
assistant: `gaussian` and `createRandomStream` are fine, so the white noise has to come from somewhere else. I'll debug by stepping the patched posture directly.
tool: eval
assistant: The call count and dt are consistent (1198 calls, about 9.98 s). So I'll look at the signal itself, comparing frame-to-frame yaw increments for the baseline and for variants of W4.
tool: eval
tool: edit
tool: eval
tool: eval
assistant: The arm definitions are in place. Now the final runs: W4 literal at 0.28, and W4f/W5/W6 at 0.36, then the report.
tool: eval
tool: eval
tool: eval
assistant: I have the full report in `wander-report.txt`. One last extraction: the key gate metric values for the slow-wander arms (W4f, W5, W6) and the shift-rate arms (W7, W8).
tool: eval
assistant: **Ask:** verify by execution whether a slow-wander retune of Natural's head OU matches the human reversal profile, and which gate metrics it passes or fails. **Wanted:** measured tables and verdicts on three claims. **For you:** the hypothesis is mostly refuted. No arm gets yaw quick reversals within 30% of the recordings, and the arms that match the 0.5-1 Hz band fail eight gate metrics, not just jitter. **Now:** done. **Next:** nothing is open. Nothing tracked was modified and the app was not launched.

## Setup
- **Scripts** (in `.temp/ulw-ablation/`): `wander.ts` (one arm and seed per process), `wander-report.mjs` (aggregation), `human_wander.py` (recording amplitude bins and diversity, imports `human_compare.py`). `dbg.ts` and the `cal*` JSON files are throwaway calibration scratch.
- **Full stdout:** `wander-report.txt`. It holds every table, and every scoreLiveliness metric with band and PASS/LOW/HIGH per arm, including per-seed status. Raw per-run output is in `wander-out/*.json`, and the recordings' numbers are in `wander-out/human.json`.
- **Versions:** bun 1.3.14 ran the TS, because node v26.11.1 can't resolve the directory import. Python 3.13.12 with numpy 2.5.4 ran under uv. Windows 11, 16 cores.
- **Protocols:**
  - Reversal tables use the ablate protocol (60 Hz, 600 s, idle, energy .5).
  - The gate protocol is desk home, 120 Hz simulated and decimated to 30 Hz, 180 s warm-up plus 1800 s scored, seeds 1-3. It does not call setPerformance, matching `liveliness-gate.test.ts`.
  - Reversals and Welch bands in the gate protocol are computed on the 30 Hz trace, the same grid as the recordings.
- **Seeds:** all numbers are medians over seeds 1-3.

## Arms
| Arm | Retune |
|---|---|
| A | baseline |
| J | OU tau x3 |
| W1 | tau x3, sd x1.5 |
| W2 | tau x5, sd x2 |
| W3 | tau x5, sd x2, filterTau x2 |
| W4 | fast sd x0.5 plus raw slow OU (tau 3 s, yaw sd 0.28 normalized, which is 0.238/0.112 for pitch/roll), as specified |
| W4f | like W4, but the slow OU goes through two one-pole filters of 0.12 s, with yaw sd 0.36, pitch x0.5, roll x0.15 |
| W5 | like W4f, fast sd x0.15 |
| W6 | like W4f, fast OU off |
| W7 | W3 plus shift holds /2.5 |
| W8 | W7 plus a smoothed slow OU (sd 0.15) |

- **W4 as specified fails.** A raw OU is non-differentiable, so a 3 s OU with an 8 deg sd steps about 0.63 deg per 1/120 s. That is white-noise-like: the >5 Hz yaw band comes out at 0.37 deg^2 against the human 0.00026. I kept it as a recorded negative result and added the smoothed W4f/W5/W6.
- **Calibration:** I set the slow-OU SD so the yaw 0.5-1 Hz band reaches the 2.61 deg^2 target. This was fitted on the same seeds 1-3.
- **W7/W8 are the two extra arms**, added because the human 0.5-1 Hz power seems to come from sparse step-like moves.

## Reversal and band table (gate protocol, 30 Hz, desk)
| Arm | q25 yaw / pitch / roll | q100 yaw | yaw bins .25-.5 / .5-1 / >1 | Welch .5-1 / 1-3 / 3-5 / >5 (deg^2) |
|---|---|---|---|---|
| HUMAN | .436 / .884 / .353 | .155 | .117 / .101 / .218 | 2.61 / .485 / .00226 / .000261 |
| A | 1.679 / 1.232 / .310 | .212 | .473 / .694 / .505 | .556 / .153 / .00337 / .00126 |
| J | .863 / .519 / .080 | .050 | .361 / .302 / .205 | .544 / .135 / .00106 / .00036 |
| W1 | 1.303 / .881 / .206 | .156 | .366 / .476 / .450 | .560 / .147 / .00227 / .00081 |
| W2 | 1.280 / .838 / .206 | .168 | .350 / .448 / .470 | .564 / .148 / .00234 / .00084 |
| W3 | .819 / .504 / .118 | .106 | .264 / .253 / .302 | .560 / .139 / .00090 / .00025 |
| W4 (raw) | 2.562 / 2.681 / 2.866 | 2.699 | .032 / .174 / 2.358 | 2.61 / 1.52 / .287 / .379 |
| W4f | 1.270 / .992 / .513 | .697 | .109 / .194 / .965 | 2.62 / .568 / .00721 / .00098 |
| W5 | 1.251 / .969 / .498 | .682 | .108 / .187 / .954 | 2.63 / .563 / .00644 / .00071 |
| W6 | 1.246 / .949 / .491 | .691 | .110 / .180 / .956 | 2.63 / .563 / .00636 / .00069 |
| W7 | .777 / .523 / .154 | .137 | .221 / .206 / .353 | 1.07 / .262 / .00097 / .00025 |
| W8 | 1.025 / .732 / .305 | .417 | .147 / .192 / .692 | 1.37 / .336 / .00212 / .00038 |

- **Other protocol:** the 60 Hz ablate-protocol tables, for both product and desk home, show the same ordering. They are in `wander-report.txt`.
- **Slow-wander arms W4f-W6:** the 0.5-1 Hz band is hit exactly (2.62-2.63) and the 0.25-0.5 deg bin matches (0.109 against 0.117). Yaw q25 is still 2.9x too high, and almost all of the excess is in the >1 deg bin (0.96/s against 0.218/s).
- **Closest overall:** W8, with a mean absolute log distance of 0.49 over the six reversal values and four yaw bands. Next come W6 (0.58), W5 (0.60), W4f (0.65) and W7 (0.74). A is 1.11 and W1/W2 are about 1.0.

## Gate metrics (desk, 1800 s scored; median PASS/LOW/HIGH)
- **A (baseline):** passes all 24 gated metrics, including jitter at 2.90e-5. The jitter failures in the earlier lane were therefore specific to arms B, G, J and K.
- **W1 and W2:** every gated metric passes at the median. Jitter fails on seed 1 only.
- **J:** still05 and still2 are HIGH.
- **W3:** still2 is HIGH (0.517 against a 0.447 maximum).
- **W4f, W5, W6:**
  - They fail still05 (0.002 against a floor of 0.02), still2 (0.058 against 0.22), top10PathShare (0.28), jitter (1.4e-5 for W4f, 1.2e-5 for W6), speedPeakP90P50 and speedPeakLogAsymmetry (0.68-0.71), all LOW.
  - angleXp95 (16.1) is HIGH and nearLimitOccupancy (1.13%) is HIGH, which raises the hard failure `clipped`.
- **W7:** fails jitter (4.6e-6) and speedPeakLogAsymmetry (0.84). It passes still05 (0.065) and still2 (0.436).
- **W8:** fails still05 (0.011), still2 (0.174), jitter (5.8e-6) and speedPeakLogAsymmetry (0.91). Per seed it also fails top10PathShare and speedPeakP90P50 on seed 1.

## Diversity (60 s windows; 10 s windows in brackets)
| | CV mean speed | CV top-10% share | CV yaw range |
|---|---|---|---|
| HUMAN | 0.775 [1.093] | 0.209 [0.308] | 0.589 [0.993] |
| every arm except W4 | 0.10-0.17 [0.25-0.32] | 0.07-0.13 [0.15-0.26] | 0.15-0.22 [0.36-0.53] |

- None of the OU or shift retunes moves the variation between windows toward the human value.
- W4's own figures (0.19, 0.08, 0.15) sit outside those ranges, and its mean speed of 39 deg/s makes it meaningless as a comparison.

## Verdicts
- **(a) A slow-wander retune brings yaw quick reversals within 30% of the recordings: REFUTED.**
  - The target band is 0.31-0.57/s. The smoothed slow-wander arms W4f-W6 give 1.25-1.27/s (2.9x).
  - The best arm anywhere is W7, at 1.78x.
  - Matching the ≥1 deg yaw rate is possible: W1 gives 0.156 against 0.155, but its q25 is 3x too high.
- **(b) Such an arm passes still05 and still2: PARTIAL, and the pairing fails.**
  - W1 and W2 pass both, but they do not reach the human band power or reversal rate.
  - Every arm that reaches 2.6 deg^2 at 0.5-1 Hz fails both. The head never stays still (still05 is 0.002, mean speed 11.5 deg/s against 6.7 in the recordings).
- **(c) The jitter floor is the only gate metric such an arm fails: REFUTED.**
  - The arms that approach the human profile fail 4-8 metrics.
  - The arms that fail only jitter, or nothing, are W1 and W2, and they stay far from the human reversal profile.

**Assumptions:**
- **Parameter choices:** W4f's pitch and roll shares (0.5 and 0.15) were my choice, to avoid failing the pitch and roll SD bands by construction.
- **Smoothing:** the two 0.12 s poles on the slow OU are my addition. The literal OU is unusable, as W4 shows.
- **Seeds:** calibration and evaluation use the same seeds.
- **Slow OU placement:** it is added inside the gain-modulated continuous term, so the gain scales it by 0.2-1.5x.
- **Human windows:** the recordings' 10 s top-10% share skips exactly frozen windows.

## EXPAND
- LEAD: Intermittent step-like shifts (more frequent or larger, min-jerk) rather than stationary wander. The best distance and the only arms that kept still05 came from W7 and W8. W7 passes still05 and still2 and fails only jitter and speedPeakLogAsymmetry. - WHY: human 0.5-1 Hz power is 2.6 deg^2 with only 0.44 quick reversals/s, which stationary Gaussian wander can't produce, but a step spectrum can. - ANGLE: sweep shift rate, amplitude and the hold distribution (heavier tail) with the fast OU quiet. Check jitter and speedPeakLogAsymmetry, and whether the recordings' >1 deg reversal share (0.218/s) can be matched.
- LEAD: Nonstationary activity regimes. - WHY: the human CV of window speed is 0.78 at 60 s, and every arm sits at 0.10-0.19. The gate's `energy`/gain process (OU tau 6 s) is far too stationary. - ANGLE: add a minute-scale regime process (calm, active) that modulates shift rate and OU gain, then re-measure the CV at 10 s and 60 s.
- DEAD END: any raw OU added as a slow component (W4): it is non-differentiable and floods >3 Hz power. Raising OU sd with a longer tau (W1/W2) leaves the 0.5-1 Hz band at about 0.56 against 2.61. Stretching the OU alone (J, W3) pushes still2 HIGH.
