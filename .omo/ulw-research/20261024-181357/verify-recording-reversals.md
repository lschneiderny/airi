# Verification: recording reversal rate + still05 noise floor (lane st_01a16fab, journaled 2026-10-24T23:04:52.398Z)
Script/stdout: C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/human_compare.py, human_compare.out.txt (aggregates only)

st_01a16fab [completed] transcript via event-log:
assistant: I read this as an execution-based comparison of human head reversals with Natural's ablations - I'll locate the reference data, reproduce the metric and PSD, and stop when the code, stdout, environment, table, and verdict are recorded.

tool: todo
assistant: The comparison is scoped to read-only source data and scratch outputs. You need: 0/5 done; reference locations and metric details are not yet verified. Now: Locate reference traces and metric implementations. Next: Read reference exclusion and resampling rules.

tool: eval
tool: read
tool: eval
tool: read
tool: eval
tool: eval
tool: eval
tool: todo
assistant: The exporter and scorer rules are verified; the two source archives are available. You need: 2/5 done; neutral exclusions include 1-second margins, and invalid samples or gaps over 200 ms split spans. Now: Compute human reversal rates and yaw spectra. Next: Compare recording rates with Natural ablations.

tool: apply_patch
tool: eval
tool: lsp_diagnostics
tool: eval
tool: todo
tool: eval
tool: read
tool: read
tool: todo
tool: apply_patch
error: You have hit your ChatGPT usage limit (prolite plan). Buy credits at https://chatgpt.com/settings/usage. To keep going now, add an OpenAI API key, sign in with another ChatGPT account, or switch providers. Try again in ~8667 min.
error: Provider stream start timed out after 300000ms (raise streamStartTimeoutMs — retry.provider.streamStartTimeoutMs in senpi settings; 0 disables)
assistant: Ask: reversal metric plus still05 noise-floor test, numbers only. For you: reversal results are in (3/6 done); the noise analysis is patched in and is about to run. Now: Measure still-window noise and median-filter stillness. Next: Report exact code, stdout, environment, and verdicts.
tool: eval
tool: eval
tool: eval
tool: eval
assistant: Ask: verify the human head quick-reversal rate against Natural's ablation arms, then test whether the recordings' low still05 is a tracker-noise floor. For you: both analyses ran and exited 0 (6/6 done). Natural's baseline reverses yaw about 3.5x more often than the recordings. The still05 noise-floor claim is refuted. Now: none. Next: none.

## Code, stdout, environment
- **Code:** `C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/human_compare.py` is the exact script. It runs as `uv run --python 3.13 human_compare.py` and has no repo changes. I did not paste its ~250 lines here.
- **Stdout:** `C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/human_compare.out.txt` holds the full output. It contains aggregate numbers only, no raw samples. The whole-session `NOISE` lines in this reply were truncated in my view, and I read the values below from that file.
- **Environment:** Python 3.13.12, numpy 2.5.4, pyarrow 26.0.0, Windows 11 (10.0.26340). Natural's numbers are from the earlier lane: 60 Hz, medians over seeds 1, 2 and 3. The `uv` and `bun` versions are in the earlier tool output.
- **Data source:** Both sessions were read straight from the `.riggold` archives. No exported trace JSON exists locally.
- **Exclusions:** I applied the exporter's exclusions and liveliness.ts's span splitting, with a linear resample to 30 Hz.
- **Session 134050:** 1 span, nothing excluded, 1130 s.
- **Session 140122:** 28 spans after 22 near-neutral bouts were dropped, 6394 s retained.

## Quick reversals per second
Recordings are the pooled 7525 s. Raw is irregular timestamps, and lin30 is the 30 Hz linear resample.

| Source | yaw ≥0.25 | pitch ≥0.25 | roll ≥0.25 | yaw ≥1 | pitch ≥1 | roll ≥1 |
|---|---|---|---|---|---|---|
| Recording, raw | 0.433 | 0.892 | 0.355 | 0.153 | 0.227 | 0.102 |
| Recording, lin30 | 0.436 | 0.884 | 0.353 | 0.155 | 0.226 | 0.102 |
| Natural baseline (product) | 1.517 | 1.197 | 0.260 | 0.208 | 0.078 | 0.003 |
| Natural OU off | 0.052 | 0.060 | 0.027 | 0.023 | 0.020 | 0.010 |
| Natural filter 0.25 s | 0.682 | 0.490 | 0.098 | 0.052 | 0.032 | 0.003 |
| Natural tau x3 | 0.782 | 0.485 | 0.062 | 0.047 | 0.022 | 0.003 |
| Natural filterTau x3 | 0.847 | 0.573 | 0.097 | 0.073 | 0.037 | 0.003 |

- **Per session:** yaw ≥0.25 is 0.455 raw and 0.463 lin30 for 134050, and 0.430 and 0.431 for 140122. The yaw ≥0.25 quick rate is consistent across the two sessions.
- **Desk home:** the Natural desk arms are within about 0.05 of the product values.
- **Interpolation effect:** the resample changes rates by under 2%, so it does not explain the gap.
- **Closest arm:** on yaw ≥0.25, filter 0.25 s is closest in absolute distance (0.25 off, desk and product alike).
  - OU off is 0.38 off, below the recording.
  - tau x3 is 0.35 off and filterTau x3 is 0.41 off, both above it.
  - Baseline is 1.08 off.
- **Pitch and roll:** on pitch ≥0.25 the baseline is 1.2/s against 0.88 in the recordings. On roll it is 0.26 against 0.35, so it is below the recordings. The head is not over-reversing on every axis.
- **Threshold dependence:** at yaw ≥1 deg the baseline (0.208) is only 1.3x the recordings (0.155), and every ablation arm falls well below the recordings. The over-reversal is a small-amplitude effect.

## Yaw band power
Welch PSD on the 30 Hz resample, in deg², pooled, no gap bridging.

| Band | Power (deg²) |
|---|---|
| 0.5-1 Hz | 2.61 |
| 1-3 Hz | 0.485 |
| 3-5 Hz | 0.00226 |
| ≥5 Hz | 0.000261 |

Session 134050 alone gives 0.796, 0.115, 0.00077 and 0.00008 (65 windows). Session 140122 gives 2.96, 0.557, 0.00255 and 0.00030. I did not put Natural's band powers next to these.

## Still-window noise test
- **Method:** non-overlapping 2 s bins, the slowest 10% by mean head speed, per-axis |delta| in units per frame. The raw and lin30 selections are made separately.
- **Selected windows:** the mean speed in the selected windows is not near zero. The p10/p50/p90 across windows is:

| Session | Mean speed p10 / p50 / p90 (units/s, raw) |
|---|---|
| 134050 | 0.71 / 0.98 / 1.21 |
| 140122 | 0.43 / 0.73 / 0.87 |

- **Per-axis |delta| per frame**, raw sampling, order yaw / pitch / roll:

| Session | p10 | p50 | p90 |
|---|---|---|---|
| 134050 | 0.0013 / 0.0024 / 0.0007 | 0.0123 / 0.0195 / 0.0072 | 0.0357 / 0.0537 / 0.0220 |
| 140122 | 0.0002 / 0.0003 / 0.0001 | 0.0078 / 0.0120 / 0.0052 | 0.0238 / 0.0351 / 0.0174 |

  The lin30 values are a little smaller (for example 134050 yaw p50 is 0.0112).
- **Fraction of frames below 0.017:**

| Session | Sampling | Yaw | Pitch | Roll | 3-axis vector |
|---|---|---|---|---|---|
| 134050 | raw | 62% | 45% | 83% | 21% |
| 134050 | lin30 | 67% | 49% | 87% | 25% |
| 140122 | raw | 79% | 63% | 90% | 39% |
| 140122 | lin30 | 82% | 65% | 91% | 42% |

- **still05 after a 3-frame median filter:**

| Session | Sampling | Before | After | Change |
|---|---|---|---|---|
| 134050 | raw | 4.43% | 5.32% | +0.89 pp |
| 134050 | lin30 | 4.59% | 5.31% | +0.72 pp |
| 140122 | raw | 8.54% | 9.18% | +0.64 pp |
| 140122 | lin30 | 8.63% | 9.20% | +0.57 pp |

## Verdicts
- **Natural baseline reverses its head direction more often than the recordings at ≥0.25 deg: CONFIRMED for yaw.** The baseline is 1.52/s against 0.436/s, about 3.5x, and interpolation moves the recordings by under 2%. It is **PARTIAL** across all three axes: pitch is 1.4x, roll is below the recordings, and at ≥1 deg yaw is only 1.3x.
- **The recordings' still05 (0.02-0.10) is held down by a tracker noise floor above 0.5 units/s: REFUTED.**
  - Even the slowest windows have a median speed of 0.7-1.0 units/s. The raw p10 speed is 0.43 for 140122 and 0.71 for 134050.
  - Within those windows, the median per-axis step is at or below the 0.017 threshold for yaw and roll, and about at it for pitch. For 134050, pitch is 0.0195 and 45% of pitch frames are under 0.017.
  - A 3-frame median filter raises still05 by less than 1 pp. Frame jitter is therefore not what keeps it low.
  - What the data shows is that the head is almost always moving a little. This could still be tracker drift or slow wander rather than frame noise, and I did not separate those.

## Caveats
- The recordings are VTS model output from Luke at a desk, including tracker and smoothing effects.
- The 3-frame median filter is deliberately light.
- The vector-below-0.017 fractions cover all three axes at once, so they are stricter than the per-axis ones.

## EXPAND
- LEAD: Compare Natural's yaw ≥0.25 reversals with the recordings' at matched amplitude bins (0.25-0.5, 0.5-1, over 1 deg) - WHY: the baseline over-reverses at 0.25 deg but is near the recordings at 1 deg, so the excess is small wiggles, and the ablations' 0.5-1 Hz power is unmeasured - ANGLE: reuse `turning()` and bin each reversal by the amplitude of its half-swing, and add Natural's Welch bands next to the recording's 2.61 / 0.485 deg².
- LEAD: Run the stillness test on Natural's own traces - WHY: it would show whether Natural's still05 sits above the recordings' because of OU wander or because of the filters - ANGLE: apply the same slowest-10% window, per-axis |delta| and median-3 procedure to the Natural arms.
- DEAD END: The recordings' low still05 as a frame-noise floor - the median filter changed it by under 1 pp and the slow windows' step sizes sit below 0.017.
