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
