# T2-3D body-motion quality measurement

Status: accepted implementation contract; version 0 uses analytic fixture bands.

## Decision

Keep rig-neutral trace measurements, reference fitting, and gate policy in the
Node-only `@proj-airi/qa-tools` package. Product packages do not depend on it.
The T2-3D level measures motion statistics without rendered acceptance. It does
not establish physical realism, naturalness, or appeal.

`motion-trace` version 1 stores rest-relative local quaternions, model-space
root position and unwrapped heading, explicit time and wall channels, scenario
state, and event annotations. The column hierarchy precedes children.
Physics-owned bones are excluded. World orientations are reconstructed before
angular differencing, so constant right factors introduced by a different rest
pose cancel. Analysis resamples scored poses to 60 Hz and applies identical
zero-phase 6 Hz and 15 Hz Butterworth filters to references and judged traces.

Eligible windows are centred with a half-window hop: idle and walk use 10 s,
talk 5 s. Characters need three windows; references need one. Walk eligibility
requires root speed above 0.2 leg lengths/s. Idle excludes speech and locomotion;
talk excludes locomotion and requires 80 percent speaking in a window.
The trace-length refusal uses the class window, not the earlier 30 s minimum.

## Fitting rules

The fixed manifest identifies sources, subjects, roles, and fitting/held-out
splits. Ten fitting and three held-out eligible window clips establish a class.
Detector floors use half the fitting clip P10 activity. Body and regional move
speeds use fitting clip medians. Recompute dependent measurements after fitting
these quantities. Episode-only clips contribute episodes, not detector scales.

Clip statistics are medians of their windows. Percentiles use linear rank
interpolation. A lower bound is `2 * P5 - P50`; an upper bound is `2 * P95 - P50`.
Chain correlations, bilateral correlations, idle ACF, and gait chest counter
first use Fisher z with correlation clamped to +/-0.9999. Store and compare in
z space. If any required bound reaches its natural limit, report the metric
as vacuous. Do not change its side.

Episode pools require forty fitting and sixteen held-out values. The
specified generator restarts at seed 20261111 for each pool. Bootstrap 2,000
groups of eight with replacement, reduce by median or indicator mean, and fit
the same percentile margins. Validate held-out consecutive groups of eight
in manifest then episode-time order. Store subject counts. Dependent episodes
and actor mixing limit generalization.

Count failing held-out units independently for each class and fitted metric:
clips for clip fits and groups for episode fits. Zero or one failure leaves
the fitted gate and every bound unchanged. Two or more failures make that
metric report only with `holdout-failures: <n>`. Retain every original held-out
verdict; declared bands are unchanged.

The P5 to P95 interval plus a margin is not a promise that every unseen value
lies inside. A clip is checked on about 25 metrics, so an isolated miss is
expected occasionally by chance. Repeated misses for one metric show that it
does not transfer reliably enough to gate. The lead set this tolerance after
seeing the held-out results and before any character trace was judged. This
post-selection decision must remain visible when interpreting validation.

Head LDLJ pools idle and talk; arm LDLJ pools talk. Gaze and onset pools use idle
and talk, including episode-only clips. Gaze onset uses only the head region.
Gaze character episodes must match the fitting head-rotation P5 to P95 range;
excluded episodes are reported. Emotion trials pool across supplied emotion
directories and include placebo in every pairwise separation comparison.

## Declared bands

Every band carries its fitted or declared basis. Declared bands also store the
rule and source. The lead's version 1 declarations are:

| Metric | Rule | Weakness |
| --- | --- | --- |
| `period.head.loopPeak` | strictly below 0.3 | A transferred Live2D rule supported by two seated desk sessions, not standing body capture. |
| `period.rootForeAft.loopPeak`, `period.rootLateral.loopPeak` | strictly below 0.3 | Broadband standing sway supports the premise, but no measured human root distribution calibrates 0.3. |
| `coverage.fingers` | at least 0.5 at 10 percent wrist speed, conditional on active wrist | Both thresholds are judgments; the references lack fingers. |
| `fingers.frozen` | equal to 0; skip without fingers | A construction defect rule, not a human distribution. |
| `gaze.eyeLeadMs` | at least 0 | Tests order at 16.7 ms resolution rather than a fitted human lag. |
| `gesture.strokeP` | at most 0.01 | Tests speech coupling against chance, not a human hit-rate distribution. |
| `gesture.strokeLagMs` | -200 to 200 ms; no hit fails | A published coupling timescale, with no speech-paired reference capture. |
| `emotion.armShare` | at least half the smallest of Angry, Depressed, Elated, Proud shares relative to Neutral | Four styled standing clips; requires the same skeleton or stays report only. |
| `emotion.minSeparation` | at least 2, including every emotion against placebo | A detectability judgment transferred from the Live2D emotion standard. |

Emotion median separation, spectral concentration, long intermittency and idle
act counts remain diagnostics. Idle ACF covers 1 to 6 s periods but cannot
separate narrow-band noise from repetition in short windows. The long loop
detector covers dominant repeating components at 2 to 30 s over at least 60 s.
Short idle contexts and desk summaries are not fitting data.

## Integrity and acceptance

The gate refuses structurally invalid traces, low rates, gaps, wall/time drift,
short scored spans, incomplete rigs, non-upright hips, unavailable classes, and
band-hash mismatches. A trace with no judged gated metrics is also refused.
A failure takes exit-code precedence over refusals. Every trace gets a machine
verdict beside it; emotion verdicts record their pooled directories.

Version 0 is explicitly a fixture. Freeze real bands in their own commit with
the reference license note, new version and hash, and only tests requiring those
real bands. Future changes to bands, detectors, formulas, windows or gated
metrics require another isolated version freeze before judging runs. Never
retune a bound to a failure. The initial rejected run is preserved as evidence;
the lead's subsequent per-metric tolerance determines which fitted metrics can
gate. Store only derived statistics; motion and model files stay outside git.

Node validity covers in-phase and frozen rejection, rest-pose and sample-rate
invariance, noise robustness, determinism, Fisher and vacuous bands, seeded
episode bootstraps, and every named CLI refusal. Real-band tests require that
no gated fitted metric has two or more held-out failures, without raw clips
in the environment. They do not rewrite recorded failing verdicts as passes.

Scores compare motion statistics with bands derived from human capture. They do not prove naturalness or appeal, which stay a visual review.
