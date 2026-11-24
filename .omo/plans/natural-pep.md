# natural-pep - Work Plan

Status: in progress, 2026-11-24. Decision record: [Natural pep ADR](../../docs/ai/adr/2026-11-24-natural-pep.md), written in slice NP7.

## TL;DR (For humans)

**Goal.** Natural can move like a lively streamer avatar, but with its motion tied to inputs: speech, mood, attention and the performance mode. The calm Natural of today stays the neutral value.

**What changes.**

- A character card stores one new value, `pep`, from 0 (today's Natural, bit for bit) to 1 (bouncy).
- Pep adds a whole-upper-body sway to Natural: the torso leans, the head tilts with it and follows through, and the head dips on each swing. Swings start on speech stress while she talks and come slower and smaller while she is silent.
- Pep makes blinks faster and more frequent, and adds a closed-eye smile while her mood is positive.
- Both renderers perform it: Live2D through head and body parameters, MMD through the head and the trunk.
- A lab tool, `pnpm lab:natural`, measures a "motion fingerprint" from reference video and from a headless Natural replay of the same audio, and compares both with stored reference bands.

**What does not change.** With pep 0 every frame is identical to `main`: the golden hashes are not re-pinned and the MMD identity diff prints `IDENTICAL`. Emotion gestures, cue gestures, idle acts, the gaze arbiter and the groove keep their code and constants.

## 1. Evidence

Measured on 2026-11-24 with the pilot of the lab tool. Reference: the current 2D model of Neuro-sama on two public stream recordings, a 360 s solo talk segment (stream of 2026-11-10) and a karaoke stream (2026-09-16: 115 s of talk, 165 s of one song). Natural: the headless controller of `main`, fed the talk segment's voice envelope, three seeds, default settings, no emotion cues or idle acts. No footage is committed; only derived statistics are (slice NP1).

| Head tilt, talk segment | Reference | Natural on `main` |
| --- | --- | --- |
| SD | 7.3° | 2.8 to 3.2° |
| 5th to 95th percentile | 25° | 10° |
| Share of time under 2°/s | 10 % | 75 to 82 % |
| Median speed | 11°/s | 0.5 to 0.7°/s |
| Swings of 8° or more | 40 per minute | 2 to 5 per minute |
| Speed, talking against silent | 10.8 against 11.8°/s | 1.2 to 1.5 times faster talking |
| Blinks | 27 per minute, 0.13 s | 10 to 12 per minute, 0.23 s |
| Eyes closed | 14 % | 4 % |

Further findings:

- The reference's talk motion does not follow speech: 81 speech onsets change nothing, and the correlation with the voice envelope is under 0.07.
- The reference sways from the torso: sideways head position and tilt correlate at 0.73 while talking and 0.96 while singing. A typical swing is 13° over 0.75 s, and its peak speed is 2.6 times its mean speed (a minimum-jerk move has 1.9).
- The tilt spectrum is flat to about 1 Hz and rolls off above it; vertical motion reaches about 2 Hz. Natural keeps half of its tilt power below 0.1 Hz.
- The reference holds a closed-eye smile about 4 times a minute, median 0.74 s.
- At the maximum user energy setting Natural's tilt SD rises from 2.8° to 3.4°, so no existing setting reaches the reference.
- In karaoke the reference bounces at the song's tempo and repeats 48 bars later (correlation 0.85 to 0.91). Natural's groove is not yet measured (slice NP6).

Limits: one talk segment and one song; tilt is the only channel compared in degrees; the Natural side is the commanded head angle, not rendered pixels; mouth tracking failed, so lip sync is not compared.

Owner's ruling of 2026-11-24: the earlier idle work removed motion whose direction and focus conflicted, not motion as such, so more movement may come back. The rule this plan takes from it: pep motion never fights the gaze, a gesture, or an act.

## 2. Design

### Pep

`pep` is a number in [0, 1] in a card's `CharacterProfile` (`packages/stage-shared/src/character-state/types.ts`), beside `gait`. An absent value is 0, and a card at 0 stores nothing. The stage hands the active card's pep to the scene, the scene's Natural adapter hands it to `NaturalMotion.setPep(pep, nowSeconds)`, and the controller eases it over 1 s so a card switch never pops.

Pep is a character baseline, not a user setting: the user energy setting (`NaturalPerformanceEnergy`) and the mood keep scaling everything, pep motion included.

### Sway layer (`packages/motion-driver-natural/src/sway.ts`)

A new layer on its own appended stream (`sway`), so no existing stream moves.

- **Swings.** A scheduler draws swings: a side, a size and the interval to the next. Each swing draws a fixed number of uniforms. Most swings change side.
- **Input coupling.** While she talks, a detected speech onset starts the next swing at once when the running swing is at least 0.3 s old. Intervals have a median of about 0.75 s while talking and about 1.6 s otherwise.
- **Shape.** The lean follows the swing target through an underdamped second-order follower (about 1.1 Hz, damping about 0.55), which gives the fast attack, the overshoot and the slow settle. The head tilt follows the body lean through a second, faster follower, so the head trails the torso. Each swing start also kicks a faster follower (about 2 Hz) that dips the head pitch and recovers.
- **Scale.** The layer's weight is `eased pep x posture amplitude scale x duck`. The posture amplitude scale already carries the performance mode (talking 1.4, idle 1, listening 0.75), the user energy, the mood, held emotions, idle acts, sleep, the pet and the cursor calm. The duck is the posture layer's `continuousScale`, which already steps back under emotion gesture clips, cue gestures and idle acts.
- **Output.** Additive head terms (roll from the lean, a small counter yaw, the pitch dip) and additive body terms (roll, a share of the dip), in Natural's normalized units. The eye compensation includes the sway, so the gaze holds its target through a swing.
- **Neutral.** At pep 0 every output is exactly 0 and is not added, so frames stay bit-identical. The layer still steps, so its draws depend only on time.

Targets at pep 1 while talking, from section 1: tilt SD near 7°, a share of time under 2°/s near 10 to 30 %, and 25 to 45 swings of 8° or more per minute; and, unlike the reference, a tilt speed after speech onsets clearly above the talking mean. Constants are tuned in slice NP5 with the lab tool. A target is a direction, not a gate.

### Eyes

- **Blinks.** Pep divides the blink interval by `1 + 1.25 pep` and multiplies the lid closing and opening times by `1 - 0.42 pep` (27 per minute and 0.13 s at pep 1).
- **Closed-eye smile** (`packages/motion-driver-natural/src/smile-closure.ts`, stream `smile`). While Natural's mood valence is positive, the eyes close into a smile for 0.35 to 1.6 s (median 0.7 s) at a rate of up to 6 per minute times pep. It adds to `eyeSmile` and closes the lids through the blink factor. It does not start while a glance is held, the cursor or the chat is fixated, the pet override holds, an idle act owns the eyes, or she sleeps.

### Body intent and MMD

`NaturalBodyIntent.head` gains a seventh additive term, `sway`. The MMD body intent carries it to the whole-body performer (`packages/motion-driver-humanoid/src/performance`), which adds it to the head and gives the trunk a share of its roll, so she leans from the waist. The feet stay planted; the stance and gait code is not changed.

### Lab tool (`packages/lab-tools`, `pnpm lab:natural`)

- `scripts/track-avatar-video.py` (run with `uv`): tracks the face, head and eye boxes of an illustrated avatar in a video with `dghs-imgutils`, reads the voice envelope with ffmpeg, and writes a track file.
- `replay`: drives `NaturalMotion` with a track's voice envelope and writes the same channels.
- `fingerprint`: tilt SD and range, share of time still, median speed, swings per minute, swing size and length, the 0.5 to 2 Hz power share, blink rate and length, eyes-closed share, long closures, the talking-to-silent speed ratio, and the speed after speech onsets.
- `reference` and `compare`: build reference bands from tracks, and print a fingerprint beside them. The tool reports and never gates.
- Series are resampled to 60 Hz so the existing lab metric helpers apply unchanged.
- Committed: derived statistics with their provenance (stream date, segment, tracker version). Not committed: footage, tracks, audio.

## 3. Slices

Each slice is one or more atomic commits that pass `pnpm verify`.

| Slice | Scope | Proof |
| --- | --- | --- |
| NP1 | The lab tool: tracker script, track schema, fingerprint, replay, reference, compare, README, the reference fixture and its provenance note | Unit tests on synthetic signals with known answers; the fixture rebuilt from the three tracked segments; the section 1 table reproduced by the committed tool |
| NP2 | The sway layer, `setPep`, the blink scaling, the closed-eye smile, the `sway` intent term, glossary, body ownership and README | Pep 0 equals no call, frame for frame, on a talk-and-emotion script; golden hashes unchanged; bounds, onset coupling, duck, determinism and smile gating tests |
| NP3 | `pep` in the character profile, its schema, the card share round trip, the path from the active card to both adapters | Schema and round-trip tests; adapter tests that a pep reaches `setPep` and survives an adapter rebuild |
| NP4 | The card editor slider and its strings | `pnpm verify`; a screenshot of the editor |
| NP5 | Tuning of the sway constants against the reference bands | `lab:natural compare` at pep 0, 0.5 and 1 on three seeds, before and after |
| NP6 | MMD: the `sway` term in the body intent and the performer; the groove measured against the karaoke segment (measurement only) | `qa:motion3d diff` prints `IDENTICAL` at pep 0 on every affected scenario; `lab:motion3d gate` on idle and speak at pep 1 as information; a `clip --compare` render |
| NP7 | The ADR, the roadmap lines, rendered evidence from the desktop app on both renderers | `qa:test:model`; a clean start with pep 1 without renderer errors; clips attached to the pull request |

Order: NP1, NP2 and NP3 with NP4 run in parallel on disjoint files. NP5 and NP6 follow NP1 and NP2. NP7 is last.

## 4. Not in this plan

- Emotion and question poses. Emotion gestures and ACT cue gestures already choose poses from inputs; pep leaves them unchanged. A question pose needs the text of the line, which Natural does not receive.
- Any change to the groove. NP6 only measures it.
- Hair, tail and prop behaviour of the reference model, lip sync, and the 3D reference model.
- A pep preview in the card editor, and pep under the Universal, MAGIC or classic drivers.
- Changing the default: every card starts at pep 0 until its owner moves the slider.

## 5. Decisions taken without the owner

| Decision | Reason |
| --- | --- |
| The name is "pep" | "Energy" names two existing things and "liveliness" names the idle scorer and its gate. |
| One number, not a baseline of several values | Nothing yet shows that swing size, rate and eyes need separate values per character. |
| The tracker depends on `dghs-imgutils` through a `uv` script header, outside the pnpm workspace | The owner chose to keep the pilot tool, which is built on it; nothing in the app depends on it. |
| Reference statistics are committed with the stream date and segment, and the product's name | They are derived numbers about a public product that the repository already names; no person, account or footage is recorded. |
| Pep motion ducks under gestures and acts and never starts a closed-eye smile during a held glance | The owner's ruling on conflicting direction and focus. |

## 6. Review backlog

Feel is not judged by agents. After landing, the owner reviews: the sway at pep 0.5 and 1 while talking and while silent on Live2D; the same on one MMD model; the closed-eye smile after a happy turn; and whether pep 1 reads as too much on a small widget.
