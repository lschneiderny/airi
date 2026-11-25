# Walk reversal: one turn through the stop

Date: 2026-11-24
Status: accepted; the look awaits Luke's visual review. It replaces the reversal of the [natural walk refit ADR](2026-11-23-natural-walk-refit.md), decision 6, which made a reversal "an arrival turn to the viewer followed by a start".

## Context

A goal behind her braked the walk to the arrival facing (the viewer), settled, turned the rest of the way on the spot, and started again. On the reference rig's `walk` scenario she took 3.0 s from the new goal until she moved the other way at 0.3 L/s: she stood still 0.7 s and faced the viewer 2.2 s, which read as a presentation pause between two walks. The head stayed within 10 degrees of the hips through both turns. The same held on two more rigs (3.0 s, 0.7 s and 2.3 s on each).

## Decision

1. **A goal behind her that is worth a walk is a reversal.** From the first braking tick the body turns toward the new heading through the viewer, over 2.0 steps. Once the stop step lands, the same walk sets off the other way: the turn, the phase, the feet and the gait's weight carry on, with no settle, closing steps or turn on the spot. She faces the viewer only when she stays.
2. **Her gaze leaves first.** A reversal's look-ahead runs 0.8 step ahead of the turn and sweeps over all of it. The look-ahead of every turn stays within 40 degrees of her facing; walking adults carry the head up to 39 degrees ahead in a quarter turn (refit ADR).
3. **A reversal's steps roll by their own reach.** A start from standing keeps its 50 % least roll. A reversal's stop step lands flat, and the next steps roll by their own reach.
4. **The trunk's lean into a turn scales with the speed**, since it answers the turn's centripetal acceleration. A reversal's fast turn about the stop otherwise tipped her 8 degrees while she stood.
5. **A goal that comes during the settle starts a new walk at once** instead of waiting for the settle to end.

## Consequences

- On the `walk` scenario (40 s, seed 1) of the reference rig and two others, she moves the new way at 0.3 L/s 1.8 to 1.9 s after the goal. She stands still 0.22 to 0.27 s and faces the viewer 0.22 to 0.23 s. Her head leads her hips by 29 to 31 degrees as the hips pass the viewer. As she sets off, her head is 71 to 81 degrees round to the new heading and her hips 39 to 49.
- `walk-form` keeps every verdict on the three rigs. `scenario-turn-around` now reads one turn of 183 to 184 degrees, where the two turns read 164 to 165 before. Max `skateContact` rises from 0.029 to 0.037 and from 0.017 to 0.031 on two rigs, against a bar of 0.05, and falls from 0.039 to 0.029 on the reference rig. The rise comes from the fast spin over planted feet at the stop: at 2.4 steps the turn's middle fell at the stop, and the skate read 0.070.
- The half turn peaks near 250 degrees per second, about the stop, and the head swings up to 13 degrees past the new heading before it settles. This rests on judgment: the walk capture holds no reversal.

## Amendment, 2026-11-25: the feet carry the turn

An independent visual audit of 2026-11-25 found that the shoe turned over a small footprint as the pelvis came through, with the ankles stacked one over the other. Over 2.0 steps in one minimum-jerk sweep the brake foot's stance saw her turn about 147 degrees, so that foot stood up to 97 degrees off her facing. The stop step then landed beside it, 0.05 to 0.07 L away along the new heading.

1. **The half turn takes 2.8 steps at a steady rate.** Its rate ramps up over the first 10 percent of the turn along a smoothstep and down over the last 50 percent, so it turns at most 110 degrees over any 1.2-step stance and is half done at 40 percent of the turn, while she still moves. Ramps of 30 percent each put the half turn at the stop, where `walk-form` `turns-under-way` found her under 0.05 L/s on all three rigs it ran on. Decision 1's 2.0 steps change; the walk still sets off from the stop step.
2. **The turn waits for feet it cannot set.** A foot planted before the goal came, or a swing past `replanUntil`, keeps the yaw it was set at, so the turn starts later, where it must, to reach 55 degrees off that foot no sooner than the foot lifts. Otherwise it starts at the first braking tick.
3. **Every walking foot lands within 55 degrees of the facings its stance sweeps**, 5 inside the 60 a planted foot may stand off her facing. Where a turn sweeps more, the foot lands at the middle. Slower turns are unchanged: the foot still lands up to 42 degrees toward where she faces a step later.
4. **The outgoing step leads off.** The first step to land past the viewer lands at least 0.2 L ahead of the planted foot along the new heading, so the weight moves onto it and the next step carries on from it.
5. **The gaze still steps 0.8 step ahead at once.** Ramping its lead in over 0.4 step was tried: the opening glance fell to 12.5 degrees, below decision 2's glance, and the head spike that `smooth.head.spikeRate` counts moved by 0.15 s at the same size, so the jump of the look-ahead is not its cause. The spike is the onset of the head's recruited turn in the gaze layer; the walk scenario has only about 3 s of moving head samples, so two onsets read as 39 a minute.

Consequences on two rigs (seed 1): in the unit fixture, wherever in the stride the goal comes, no planted foot stands more than 60 degrees off her facing, and the outgoing foot lands 0.2 L ahead of the brake foot. She faces the viewer 0.32 s (0.23 to 0.25 before) while turning, never standing there, and moves the new way at 0.3 L/s 1.87 to 1.88 s after the goal (1.83 to 1.85). Her peak yaw rate falls from 161 to 163 degrees per second to 125 to 127. The reversal's max `skateContact` falls from 0.029 to 0.021 and from 0.031 to 0.017. `walk` exits 0 and `pops` passes on both rigs. `turns-under-way` reads 5 of 5 on the reference rig and one other and 4 of 5 on Ellen (5 of 5 before): her root stands 0.3 s until the outgoing step lands, and the travel heading, low-passed at 0.5 Hz, reaches its half turn there. Setting off while that step was still in the air was tried and dropped: its landing, planned again in the new walk's frame, jumped 0.03 L in one tick.
