# Natural idle reshape and emotion ducking

Date: 2026-10-25
Status: accepted for the delivered parts. The idle reshape is held, not decided. The gate-band decision is open.

## Context

The research session in `.omo/ulw-research/20261024-181357` checked why Natural motion still reads differently from recorded desk VTS footage. It found eight gaps.

GAP-1: The continuous head wander is an Ornstein-Uhlenbeck process with a short correlation time. Its yaw reverses direction 3.5 to 3.85 times as often as in the human recordings, depending on the protocol.

GAP-2: No activity regime produces tens of seconds of higher or lower activity. The 60 second speed coefficient of variation (CV60) sits at 0.10 to 0.17. The recordings reach 0.78.

GAP-3: A strong emotion calls the energy path. That path raises amplitude by up to 30 percent and shift rate by up to 50 percent for 2 seconds, and it does not duck the idle motion under the gesture clip.

GAP-4: The laugh was a symmetric head pitch sine. It did not touch the face.

GAP-5: The face noise was unfiltered. Mouth form reversed 11.8 times per second, and a 0.3 second low-pass cuts that to 0.94 per second. The lid multiplier used `1 - 0.04 * abs(q)`, which has a kink at zero.

GAP-6: Eye compensation followed the full head pose, including the continuous wobble. The eyes therefore chased noise.

GAP-7: The idle reshape fails two liveliness bands. The jitter band runs from 1.469e-5 to 3.918e-5, and the speedPeakLogAsymmetry band runs from 1.051 to 2.102 (`task-8-natural-motion-quality.md`).

GAP-8: Nothing packaged an A/B comparison for Luke's visual acceptance.

## Decision

The following changes are delivered on the combined branch `luke/feat/natural-idle-reshape`, whose tip is `c3c81f84c`.

- The hold-latched activity gain (`bcdfd23cb`) was already on the base.
- The face low-pass and the soft-absolute lid (`bb9405726`) remove the unfiltered face noise and the lid kink.
- The emotion energy boost and its three settings (`energyAmplitude`, `energyRate`, `energySeconds`) are removed in `34c6b1373`. On load, `settings.ts` deletes these three keys from a stored `naturalBands` once, under a `NOTICE` block. Without that step, the strict schema would reject the stored document and reset every performance setting. The strict context schema in `trace.ts` rejects affect traces recorded before this change, because their recorded settings still carry the removed keys.
- The idle motion ducks under gesture clips (`4bd1df081`). The duck depth is 0.45 times the clip strength times the band amplitude. The attack lasts 0.15 seconds and the release lasts 0.3 seconds. Each clip keeps its own active span.
- The chuckle laugh now moves the eyes and mouth with synced pulses (`160158688`). This replaces the earlier contract that gestures never touch the face.
- The eyes counter-rotate against the slow head pose only (`491a4b687`). The continuous wobble no longer reaches them.
- Todo 17 (`19f6d68bb`, `c3c81f84c`) removes the unused intensity parameter from `energy.react`. The desktop reaction and poke overlay is now a fixed x1.3 amplitude and x1.5 shift rate for 2 seconds, and overlapping reactions do not stack. `createClip` is no longer exported. Motion output is bit-identical to `7bc5156c7` (rebased as `491a4b687`). `c3c81f84c` also corrects the 2026-10-17 line that said impulses raise posture amplitude.

The idle reshape is held, not decided. It covers the continuous Ornstein-Uhlenbeck retune, human-measured hold durations, and a shifts-only activity regime. Todos 9 to 13 wait on Luke's answer to the todo 9 gate question. That answer was requested four times through the question tool, the fourth as a last call that offered a defer option, and has not arrived.

Two options remain for the gate band.

Option (a) reports jitter and speedPeakLogAsymmetry without gating them, under gate version 2. This lets the reshape be measured.

Option (b) keeps the gate as it is. Under this option, only idle steps (todos 11 to 13) whose metric packet passes every gated liveliness metric land. R4 as measured fails jitter and speedPeakLogAsymmetry, so the full reshape is unlikely to land under option (b).

The evidence for the reshape is arm R4. Its quick yaw reversals, counted per second for swings of at least 0.25 degrees of amplitude, come to 1.447 times the recordings. Today's code sits at 3.88 times. The recordings measure 0.436 reversals per second, R4 measures 0.631, and the current code measures 1.691. R4 raises CV60 to 0.451, against 0.147 today and 0.775 in the recordings. At the median of seeds 1 to 3, R4 fails jitter and speedPeakLogAsymmetry.

## Consequences

Gate results were measured at `7bc5156c7` (rebased as `491a4b687`), the last commit that changed motion output before todo 17. The evidence files for this ADR live in the git-ignored `.omo/evidence/natural-motion-quality` folder of the main checkout.

- Liveliness T1 passes 23 of 23 gated metrics, with 0 failures and 0 not applicable.
- Emotion T1 passes 295 checks and fails 42 of 337. This is the documented accepted set. The baseline at `bcdfd23cb` was 297 passing and 40 failing. The net change is three new failures and one fix. The new failures are `sad:slight:eyelid`, which comes from the face low-pass, and `surprised:strong` on `blinkRate` and `mouthForm`, which come from seed churn after the boost removal. The fix is `awkward:strong:browMean`, which passes through the same seed churn.
- Emotion T2 on ForBOOTH passes 291 checks, fails 46, and has no not-applicable results. T2 now measures the cheek through ForBOOTH Param85, which main gained in commit `d724ece9f`.

The duck's per-clip held ratios, from `task-4-verified-r1.json`, are these medians: laugh 0.602 (n 18), drop 0.594, recoil 0.585, look-away 0.559, nod-off 0.556, tilt-in 0.553, sway 0.551, and shake 0.574 (n 7).

Over the plan's [20, 21] second window, the median across all 26 shake seeds is 0.772, with a range of 0.627 to 1.013 (`task-4-gate-review.md`). Inside the narrower [20.15, 20.5] second span, seeds 1 to 4 and seed 41 give ratios from 0.493 to 0.602, and seed 41 measures 0.585. Seeds 5 to 8 sit near 1.0 because a posture shift, which is not ducked by design, dominates their residual. The angry drop clip has an active span of about 0.51 s, so the window sets the value more than the duck gain does (`task-4-natural-motion-quality.md`).

Determinism holds. The changes add no new random draws on existing streams. Hash pins move only in motion-changing commits, and todo 17 left the observer golden hashes byte-identical (`final-f2-code-review-r2.md`).

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

## Rendered QA (todo 15)

Liveliness T1 run `20261025-022043` at `7bc5156c7` (rebased as `491a4b687`) passes 23 of 23 gated metrics.

Emotion T1 run `20261025-022104` at `7bc5156c7` (rebased as `491a4b687`) passes 295 and fails 42 of 337. Emotion T2 reused run `20261025-014444` (291 pass, 46 fail, gitSha `7bc5156c7` (rebased as `491a4b687`)).

Liveliness T3, run `20261025-025017`, fails with 18 pass, 5 fail, and 0 not applicable. The failing metrics are:

- `sd:ParamAngleY` 3.955, against a band of 4.497 to 8.995.
- `still05` 0.1007, against a band of 0.02 to 0.1.
- `still2` 0.5993, against a band of 0.22 to 0.4467.
- `minuteAngleYRange` 7.82, against a band of 8 to 29.52.
- `angleXp5` -15.21, against a band of -34.18 to -16.1.

The five failing values are bit-identical at `bcdfd23cb` and `7bc5156c7` (rebased as `491a4b687`) on the T1 run. Attribution in `task-15-verified-r1.json` classifies them as pre-existing rig and render transfer, not Track E.

Emotion T3 run `20261025-032245` passes, with 16 gated checks passing and 14 posture rows not applicable. Its transfer ratios run from 0.894 to 1.094 against T1 run `20261025-022104`.

The T3 smoke run `20261025-033954` passes with 11 events, 20 holds, and 16 screenshots.

Todo 15 review rejected the first revision (`r1`) for a wrong screenshot path and a blush watch item. Both were fixed, and `r2` was approved. The A/B package for Luke's visual review is `.omo/evidence/natural-motion-quality/task-15-ab-package.md`. It is git-ignored and is not linked from this record.
