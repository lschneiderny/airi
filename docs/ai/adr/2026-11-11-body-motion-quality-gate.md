# T2-3D body-motion quality measurement

Status: accepted; version 2 freezes human-reference bands with mirrored sides pooled. Version 1 keeps per-side bands as a record. Version 0 retains analytic fixtures.

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

Existing chain correlations use angular velocity relative to the parent.
The 100STYLE idle and walk references have nearly identical axial signals:
idle neck-head median correlation is 0.999626. Vacuous neck-head correlation
bands, and idle spine-chest, stay REPORT rather than claiming discrimination
the reference cannot support. Version 1 cannot reject neck-head synchrony
through zero-lag correlation in idle or walk; the CMU talk band can. Arm
upper/lower-segment pairs remain gated in every class with core reference
fits. UNVERIFIED: the capture solve may distribute one measured rotation
across neighbouring axial segments of its 23-joint skeleton. This explanation
has not been established from the capture process. The proposed chainRel
duplicate was withdrawn after inspecting reference values and before any
character trace was judged. No metric formula changed.

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

## Admission review fixes, 2026-11-11

Independent review found that zero leg length could collapse nonfinite root
velocity into a passing periodicity score. Before any changed character motion
was judged, the reader was tightened to require positive finite leg length,
canonical nearest present parents, finite rest offsets and clocks, and no
infinite scalar channels. Optional scalar NaNs still mean absent data.
Preparation refuses nonfinite kinematic signals; the judge fails nonfinite metric values or contributing
samples with `undefined: nonfinite`. Bands, thresholds and version 1 are unchanged.

Re-review at `1db662fbe` found that finite root velocities from leg length
`1e-200` could still overflow inside ACF and become a passing zero.
ACF and loop accumulators now refuse nonfinite arithmetic before zero crossings
or peak selection. Shared sums, moments, norms, covariance and correlation
arithmetic, filter recurrences, spectra, smoothness and posture energies refuse
as `trace-nonfinite` before comparisons can erase an overflow. No minimum leg
length was introduced, and no threshold, detector constant, band or version changed.

The same review showed that copied emotion traces could multiply insufficient
trials into a pass. Before judging changed character motion, pooling was made
to refuse duplicate content digests and trial ids across traces as
`pool-duplicate`, and incompatible rig structure, known asset hashes, source
level or source revision as `pool-mismatch`. Trial identity survives
extraction; repeated labels within one trace count once. Each pooled verdict
records trace directories, digests and per-condition trial counts in
`pooledFrom`. This admission fix changes no band, threshold or gate version.

The `1db662fbe` re-review also found that renaming trial ids bypassed the
whole-file duplicate check. Pooling now compares a SHA-256 measurement
fingerprint of encoded rotation/root/channel blocks and frame count, sample
rate, bones and parents. Events, trial ids, seed and provenance labels do not
enter this identity. A repeated fingerprint is `pool-duplicate`; verdicts keep
both the original whole-file digest and the fingerprint in `pooledFrom.traces`.
Passing pool controls now use genuinely different trajectories across seeds.

The re-review found a third defect: comparing `rig.id` refused the runner's
own seeds because it writes `qa-${seed}` there. Pool cohorts now ignore that
display/controller key. Bones, parents, rest offsets, leg length, source level
and revision must agree, and every pair of known asset hashes must agree.
This also checks conflicts when the first trace's hash is null. The runner
assigns SHA-256 of PMX bytes to `rig.assetSha256`; it is not null for runner
traces. No runner code, trace header, existing trace hash, band, threshold,
detector constant or gate version changed.

The third review pass at `07b5524a7` found that whole-capture identity was
still the wrong unit: copies with only nominal `hz` changed, or with unused
tail frames trimmed, received new fingerprints and their trials were counted
again. The lead's rule identifies reuse at the counted unit. Each emotion
observation owns exactly the raw frames its baseline and hold averages read;
each frame is identified by its sign-normalised raw float32 rotations for all
bones, without time, index, `hz`, events or provenance. No frame content may
belong to two observations, across traces or within one trace; a collision is
`pool-duplicate`. `hz` left the whole-capture fingerprint because scoring takes
timing from the time channel. Consequence: a pool where the character is
completely motionless across two observations is refused, not failed, because
identical samples are not replication; a refusal is never a pass. Perturbed or
fabricated trajectories remain outside this local check. Bands, thresholds,
detector constants and version 1 are unchanged.

## Version 2: pooled body sides, 2026-11-11

What changed: every fitted metric whose id names a left or right bone or
region and whose mirror is also fitted is fitted once from both sides
pooled. The pairs are the shoulder, upper-arm and lower-arm chain
correlations and lags, the upper-arm idle ACF, and the arm LDLJ and spike
rates. The fitting rules are unchanged: same percentiles, margins, Fisher
transform, minimum counts and vacuous-band rule. Both ids receive the one band.
For a pooled pair the ten-value clip minimum counts side values, not clips, so
pairs that neither side could fit alone are now gated, which makes the gate
stricter: idle `smooth.armL.spikeRate` and `smooth.armR.spikeRate` (8 fitting
clips with a value per side, 16 pooled) and talk `smooth.armR.spikeRate` (7
values in version 1, 18 pooled side values in version 2).
Pooled episodes follow manifest order, left before right within a clip.
Held-out clips are judged on both sides against the pooled band and count
once per failing side; a pooled episode group counts once for the pair. The
0-or-1 held-out tolerance is unchanged.
The held-out allowance stays at one failing unit, while a pooled pair has about
twice the held-out units of either side. The talk arm LDLJ pair has 14 held-out
episode groups instead of 7 per side; two fail, so `smooth.armL.ldlj` and
`smooth.armR.ldlj` became REPORT with `holdout-failures: 2`. This is a loss of
a gated check for speech: version 2 no longer gates arm smoothness (LDLJ) in
talk.
The lead extended the rule before any
version 2 band existed: every left or right bone activity floor (half the P10
of fitting-clip activities) and the `armL`/`armR` move speed (median of
fitting-clip median speeds) are fitted once from both sides pooled under their
unchanged rules and applied to both sides. No declared band, non-mirrored
detector parameter, manifest entry or split changed. A non-sided band keeps its
fitting rule, but when its metric reads a pooled floor or arm move speed its
human values are measured with the pooled value, so the band can move; in
version 2, eleven such bands moved (coverage, bilateral, dimensionality,
gesture stroke rate and onset) and none changed status. A machine comparison
of the two bands files is kept with the freeze evidence.

Mirrored bands whose status changed: idle and walk
`chain.leftUpperArm-leftLowerArm.lagMs` /
`chain.rightUpperArm-rightLowerArm.lagMs` and walk
`chain.leftLowerArm-leftHand.lagMs` / `chain.rightLowerArm-rightHand.lagMs`
became REPORT as vacuous (version 1 gated the left side only); talk
`smooth.armL.ldlj` / `smooth.armR.ldlj` became REPORT; idle
`smooth.armL.spikeRate` / `smooth.armR.spikeRate` and talk
`smooth.armR.spikeRate` became GATED (talk `smooth.armL.spikeRate` was already
gated).

A pooled floor can fall outside both version 1 side values when a class has few
fitting clips, because the floor is half the 10th percentile with linear
interpolation and pooling changes the interpolation rank. This happens in talk
(lower arm, upper leg, lower leg, foot, toes) and in the shared
gaze/emotion/react set (upper leg); every idle and walk pooled floor lies
between its two side values. Within each clip, left-side values are ordered
before right-side values in the pooled episodes, which decides which episodes
share a held-out group of eight and which values the seeded bootstrap draws;
the rule did not specify this order.

Why: version 1 fitted each side from the same 11 idle clips of one performer,
so a sided band encoded that performer's handedness. The idle
`chain.leftShoulder-leftUpperArm.zeroLagCorr` limit was r 0.62, while the
right side's was r 0.98. The fitted activity floors were lopsided too (idle
`leftHand` 0.0054 against `rightHand` 0.0030 rad/s), so the left side was
judged against a higher no-motion threshold. A character whose arms move alike
on both sides failed on the left only. Pooling treats left and right as two samples of
one human arm behaviour.

Timing and decision: this change was made after the tuned character failed
left-side metrics only, so it is a post-hoc change to the gate, not an
independent validation. No character data entered the fit; the bands were
rebuilt from the unchanged reference clips alone, and no band was adjusted
by hand. The user decided on 2026-11-11: "Arm bands: Gate v2, pooled sides
(Recommended)". `bands-v1.json` stays unchanged as the record of version 1.

Acceptance can now demand named metrics with `gate --require <ids>`.
Every named metric must be `PASS` in every supplied verdict; the requirement
and its result are recorded separately from the numerical verdict. Unknown
ids are usage errors. An idle request of 60 s yields about 59.98 scored seconds,
so acceptance uses 90 s and requires the declared loop-peak ids rather than
accepting their skipped status.

Scores compare motion statistics with bands derived from human capture. They do not prove naturalness or appeal, which stay a visual review.
