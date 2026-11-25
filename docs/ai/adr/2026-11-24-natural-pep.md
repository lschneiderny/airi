# Natural pep: a per-character baseline for lively, input-driven motion

Date: 2026-11-24
Status: accepted. Implementation of the natural pep plan (`.omo/plans/natural-pep.md`, slices NP1 to NP7). How the motion feels is not reviewed yet; the plan's review backlog lists what the owner looks at.

## Context

The owner asked how all of Natural's motion could look closer to a refined, input-based version of Neuro-sama, without copying it one to one, and asked for a way to measure how that model moves.

A pilot tracked the head box, the face box and the eyes of the reference's current 2D model in two public stream recordings (a 360 s solo talk segment from the stream of 2026-11-10, and 115 s of talk and 165 s of one song from the karaoke stream of 2026-09-16), and fed the talk segment's voice envelope through the headless `NaturalMotion` controller of `main`. No footage, audio or track is committed; only derived statistics are.

| Head tilt, talk segment | Reference | Natural on `main`, three seeds |
| --- | --- | --- |
| SD | 7.3° | 2.8 to 3.2° |
| Share of time under 2°/s | 10 % | 75 to 82 % |
| Median speed | 11°/s | 0.5 to 0.7°/s |
| Swings of 8° or more | 40 per minute | 2 to 5 per minute |
| Blinks | 27 per minute, 0.13 s | 10 to 12 per minute, 0.23 s |

- The reference sways from the torso: sideways head position and tilt correlate at 0.73 while talking. A typical swing is 13° over 0.75 s with a peak speed 2.6 times its mean.
- The reference's talk motion does not follow its speech: speech onsets change nothing, and the correlation with the voice envelope is under 0.07.
- The reference holds a closed-eye smile about 4 times a minute.
- Natural's maximum user energy raises its tilt SD from 2.8° to 3.4°, so no existing setting closes the gap. The gap is a style, not a tuning error.

The owner ruled on 2026-11-24 that the earlier idle work removed motion whose direction and focus conflicted, not motion as such, so more movement may come back.

## Decision

1. **A card stores `pep`**, a number in [0, 1] in its `CharacterProfile`. An absent value is 0 and a card at 0 stores nothing. The stage hands the active card's pep to the Live2D and MMD Natural adapters, which call `NaturalMotion.setPep`; the controller eases it over 1 s. The name avoids "energy" (the user setting and the mood axis) and "liveliness" (the idle scorer).
2. **Pep 0 is the Natural of `main`, bit for bit.** Every pep output is exactly zero at pep 0 and is then not added, and the new random streams are appended. The golden frame hashes are not re-pinned, and `qa:motion3d diff` prints `IDENTICAL` on all 12 MMD scenarios.
3. **Pep adds a sway layer** (`packages/motion-driver-natural/src/sway.ts`). A scheduler draws swings, each a side, a size and a gap. The lean follows the swing target through an underdamped follower, the head tilt trails the lean through a faster one, each swing start dips the head, and the target returns to the centre between swings.
4. **The sway follows inputs, which the reference does not.** While she talks, a speech onset starts the next swing; while she is silent, swings come slower. The sway's weight is pep times the posture amplitude scale times the posture duck, so the performance mode, the user energy, the mood, held emotions, sleep, the pet and the cursor calm scale it, and it steps back under emotion gestures, cue gestures and idle acts. The eye compensation includes the sway, so the gaze holds its target through a swing.
5. **Pep livens the eyes.** Blinks come up to 2.25 times as often and up to 42 % faster. While the mood valence is positive, the eyes close into a smile at up to 6 per minute times pep; a smile does not start during a held glance, a cursor or chat fixation, the pet override, an idle act, a moving lid, or while the user is away.
6. **Both renderers perform it.** Live2D adds the head and body terms to its parameters. On MMD the body intent carries a seventh head term, `sway`, to the whole-body performer: the spine chain takes a third of the roll, most of it at the waist, the neck and head take the rest, and the head's steadying reflex does not cancel the trunk's share. Pelvis, legs, stance and gait are unchanged.
7. **`pnpm lab:natural` measures the motion.** A `uv` script tracks an illustrated avatar in a video with `dghs-imgutils`; `replay` drives the headless controller with a track's voice envelope; `fingerprint`, `reference` and `compare` print the measures of the table above beside stored reference bands. The tool reports and never gates, and no band or constant is changed to pass it. `qa:motion3d run --pep` holds a pep in a headless MMD run.
8. **The card editor has one slider**, "Calm to lively motion". Every card starts at 0.

## Consequences

Measured with `lab:natural compare` on the talk segment after the sway constants were tuned, three seeds at pep 1, against the reference bands (the range over the reference's 60 s windows):

| Measure | Pep 0 | Pep 0.5, one seed | Pep 1 | Reference band |
| --- | --- | --- | --- | --- |
| Tilt SD | 2.8 to 3.2° | 3.9° | 6.2 to 6.6° | 6.1 to 8.3° |
| Share under 2°/s | 0.75 to 0.81 | 0.31 | 0.13 to 0.15 | 0.10 to 0.12 |
| Median tilt speed | 0.5 to 0.7°/s | 3.7°/s | 6.9 to 7.3°/s | 9.2 to 12.2°/s |
| Swings of 8° or more per minute | 2 to 5 | 20 | 47 to 49 | 29 to 48 |
| Swing size | not measured | 7.7° | 14.3 to 15.2° | 9.9 to 15.5° |
| Swing length | not measured | 0.92 s | 0.82 to 0.85 s | 0.50 to 1.07 s |
| Peak over mean swing speed | not measured | 2.8 | 2.6 to 2.7 | 2.1 to 3.2 |
| Blinks per minute | 10 to 12 | 19 | 26 to 28 | 18 to 34 |
| Tilt speed, talking over silent | 1.2 to 1.5 | 2.4 | 2.6 to 2.7 | 0.2 to 1.1 |

- The last row is above the band on purpose: she moves more while she talks, and the reference does not.
- With a mood valence of 0.5 at pep 1, long eye closures come 3.5 times a minute (band 1 to 9) and the eyes are closed 11 % of the time (band 7 to 28 %). With a neutral mood there is no closed-eye smile.
- Before tuning, pep 1 swung 56 to 59 times a minute with a peak over mean speed of 1.8 and a talking over silent ratio of 4.9 to 5.5.
- On MMD, `lab:motion3d gate` at pep 1 passes on the idle and speak scenarios. The idle scenario at pep 0 fails its head smoothness line ("smoother than the reference pool"), as it did before this work.
- The groove was measured against the song segment and not changed: at 111 beats per minute Natural sways 47 times a minute with a tilt SD of 4.2° (4.8° at pep 1), and the reference 87 to 98 times with 10.7 to 12.2°.
- Limits of the evidence: one talk segment and one song of one model; tilt is the only channel compared in degrees; the Natural side is the commanded head angle, not rendered pixels; mouth tracking failed, so lip sync is not compared.

## Not decided

- Whether one number is enough, or swing size, swing rate and the eyes need their own values for a character.
- Whether any card should start above 0.
- Emotion and question poses, a livelier groove, a pep preview in the card editor, and pep under the other motion drivers.
- The tracker's dependencies (`dghs-imgutils`, `onnxruntime`, OpenCV) were taken with the pilot the owner chose to keep. They live in a `uv` script header outside the pnpm workspace; no comparison of alternatives was made.
- On a rig with one spine bone the performer scales the trunk channels, so the head's world tilt comes out slightly under the sway's roll.
