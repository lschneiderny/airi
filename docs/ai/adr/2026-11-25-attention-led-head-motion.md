# Attention-led head motion: the head moves when her attention does

Date: 2026-11-25
Status: accepted. The owner asked on 2026-11-25 for this direction to be settled and delegated the decision; an agent made it. How the motion feels is not reviewed, and every constant below is a starting value.

## Context

The owner reported that Live2D idle motion is twitchy and uninteresting, most of all on the Bear Pajama rig.

Natural's posture layer is fitted to desk recordings of a person. It starts a posture shift about once a second, in a random direction, with a median size of about 0.17 head units (5°). A measurement of the drawn picture (`pnpm qa:live2d-rig --idle`, added with this ADR) shows what that becomes on a rig:

- On Bear Pajama the head makes 56 moves a minute, with a median travel of 0.35 % of the model's height. On a character drawn 400 px tall that is 1.4 px. 35 % of the moves travel under one pixel.
- A rig decides how far a head angle moves the picture, so the same command reads as a posture change on one rig and as a tremor on another. Bear Pajama's yaw moves its picture a quarter as far as the widest rig measured.
- Bear Pajama's physics hangs the arms, legs, ears, hair and props from the head angles, so each small shift also sets those parts swinging.

The shifts are also unrelated to the gaze. 30 % of them follow a saccade by 30 to 80 ms, but the saccade's target does not set the shift's direction. The owner's ruling of 2026-11-24 was that the earlier idle work removed motion whose direction and focus conflicted, not motion as such.

A review candidate, the `follow` gain, already aimed each shift at the gaze and made the head answer every saccade. Measured on Bear Pajama during the investigation, with the centre of the face as the marker, it kept the rate (55 moves a minute) and shrank the moves (median 0.11 %, 81 % under one pixel), because the fixation points lie close to the camera.

## Decision

1. **The head moves when her attention moves.** With attention-led head motion every posture shift is an attention shift: the eyes go first, and the head follows 30 to 80 ms later to where they look (`headAimShare`: one head unit of yaw and 0.8 of pitch per eye unit), keeping a fifth of the shift's random offset so that two looks at one place do not land on one pose.
2. **The head stays when her attention stays.** A shift whose aim moved less than 0.08 head units since the previous shift does not move the head. The head also stays while another layer holds the eyes: a glance, the chat, or the petting hand, each of which moves the head itself. Under the cursor the shift returns to the home, because the cursor follow bias already turns the head.
3. **An attention shift is a wide, held fixation.** Its desk and side fixations lie 2.5 times as far from the camera as an ordinary fixation, and it holds 0.8 s longer, so the eyes are still on the place when the head arrives. A fixation on the camera or on the screen content is not moved. Between attention shifts the eyes keep their ordinary fixations, and the head does not answer them.
4. **Attention shifts are rarer than the desk shifts.** The hold between shifts is 6 times as long, and at most 12 s.
5. **Pep carries it.** The share is `min(1, pep / 0.25)`: complete from pep 0.25, and a linear blend below it. Pep 0 is the Natural of `main`, bit for bit, as the [pep ADR](2026-11-24-natural-pep.md) requires: the golden frame hashes are not re-pinned and every draw is the same. Above 0.25, more pep adds sway and livelier eyes, not head shifts, so a card at 0.25 is calm and deliberate and a card at 1 is lively.
6. **Both renderers perform it**, because it lives in the shared controller (`NaturalPostureLayers` `aimShare`, `aim` and `holdLimit`; `NaturalGazeLayer` `beginAttentionShift`; `NaturalAttentionShifts` `share` and `wide`).
7. **The `follow` review gain is removed.** It was this decision's prototype.
8. **`pnpm qa:live2d-rig --idle` measures the result** on a rig's drawn picture, in % of model height. It reports and never gates.

Pep was chosen over a new card value because the owner's standing rule makes liveliness a per-character value and never a retune of Natural's defaults, and pep is that value: one slider, "Calm to lively motion". A second slider would ask the user to tune two numbers that mean one thing.

## Consequences

Measured over 300 s at seed 1 with `pnpm qa:live2d-rig --idle 300`, from the product home. "Before" is the same commit with the share forced to 0, which is the motion of `main`.

| Rig and pep | Head moves per minute | Median move | Moves under 0.25 % | Picture speed | Quick reversals per minute |
| --- | --- | --- | --- | --- | --- |
| Bear Pajama, 0.25, before | 54.9 | 0.36 % | 36 % | 0.22 %/s | 1.55 |
| Bear Pajama, 0.25, after | 17.1 | 0.58 % | 5 % | 0.11 %/s | 0.52 |
| Bear Pajama, 1, before | 41.7 | 0.52 % | 25 % | 0.33 %/s | 3.30 |
| Bear Pajama, 1, after | 28.7 | 0.66 % | 14 % | 0.25 %/s | 1.86 |
| ForBOOTH, 0.25, before | 29.5 | 0.42 % | 25 % | 0.47 %/s | 3.95 |
| ForBOOTH, 0.25, after | 37.4 | 0.25 % | 49 % | 0.28 %/s | 1.43 |
| ForBOOTH, 1, before | 20.3 | 0.52 % | 15 % | 0.67 %/s | 10.78 |
| ForBOOTH, 1, after | 29.1 | 0.42 % | 22 % | 0.52 %/s | 8.87 |

- At pep 0 both rigs measure the same before and after, and the `pnpm qa:live2d-rig` trial keeps its trace hash.
- In the controller, over 600 s on three seeds, the head makes 9 to 11 moves a minute instead of 42 to 48, their median size is 0.35 head units instead of 0.16 to 0.20, and the cosine between the head's offset and the fixation at the end of a move is 0.91 to 0.96 instead of -0.06 to 0.17.
- **On ForBOOTH the count of small head moves rises.** That rig moves far per degree. Before, its head was in a move 79 % of the time, and the sway and the continuous wobble were hidden inside the shifts. After, the head is still 51 % of the time, and the same sway and wobble stand alone as small moves. The picture as a whole moves 40 % slower with a third of the quick reversals. Whether that reads better is for the visual review.
- The eyes glance without the head between attention shifts. A head turned to one side with the eyes on another fixation is expected.
- The idle liveliness gate and the desk reference statistics describe pep 0 only.
- A rig that moves little per degree still shows smaller moves than one that moves far. Nothing scales the command to the rig.

## Alternatives

- **Drop or enlarge a shift that would be invisible on the rig.** It needs a visibility threshold per rig in the performer, and it filters a random walk instead of giving the move a cause. The [character mind ADR](2026-11-17-character-mind-direction.md) keeps frames in the performer and reasons in the layers above it.
- **Let the head answer every saccade** (the `follow` candidate). It kept the rate and shrank the moves.
- **Scale the head command by the rig's measured reach.** It makes moves visible and keeps them unmotivated, and it multiplies the swing of every part the rig's physics hangs from the head.
- **Make it the default.** It would change every character on `main` and invalidate the liveliness gate, whose reference is a person at a desk.

## Not decided

- Whether attention-led head motion gets a card value of its own, or becomes the default at pep 0. Either is the owner's call.
- The constants: the 0.25 pep, the hold scale of 6, the 12 s limit, the reach of 2.5, the 0.8 s hold, and the 0.08 stay distance.
- Whether the ordinary fixations between attention shifts should stay near the place the head is turned to.
- Whether the continuous wobble should shrink under attention-led motion on rigs that move far per degree.
