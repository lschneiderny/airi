# Walk start: the gaze leaves first, the first foot lands along travel

Date: 2026-11-24
Status: accepted; the look awaits Luke's visual review. It changes one value of the [natural walk refit ADR](2026-11-23-natural-walk-refit.md), decision 6: a start that must turn up to 100 degrees turned over 2.4 steps.

## Context

A start from standing turned the body over 2.4 steps, and the gaze swept with the turn and left her facing at rest. On the reference rig's `walk` scenario her hips had turned 22 to 23 degrees of the quarter turn when the first foot struck, and her head 30. The first step read as a foot reaching sideways from a body still square to the viewer. Walking adults turn the head toward a new direction of travel before the body follows (Grasso, Glasauer, Takei and Berthoz 1996, NeuroReport 7:1170).

## Decision

1. **A start from standing turns over 2.0 steps.** A start that carries an on-spot turn's yaw rate keeps 2.4 steps. Over 1.8 steps the standing foot stood 61 degrees off her facing before it lifted, past the 60 degrees a planted foot may.
2. **Its gaze runs half a step ahead of the turn**, ramped in over the 0.22 s preparation, within 40 degrees of her facing ([walk reversal ADR](2026-11-24-walk-reversal.md)). The eyes leave as the preparation carries her weight onto the stance foot, and the head follows.

## Consequences

- On three rigs (seed 1), her hips stand 33 to 35 degrees round at the first strike and her head 74 to 75. The head is only 13 degrees round as the first foot lifts, because it trails the gaze by its own response.
- The first step's angle off the travel line is unchanged on two rigs (25 to 29 degrees) and falls from 9 to 4 on the reference rig. The angle comes from the stance line: the foot moves from beside the other foot to its side of the travel line.
- `walk-form` keeps every verdict, and `pops` passes.
