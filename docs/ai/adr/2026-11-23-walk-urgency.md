# Walk urgency replaces the two paces

Date: 2026-11-23
Status: accepted. Decision D1 of the walk style plan (`.omo/plans/walk-style.md`, slice WS5), which the [walk style ADR](2026-11-23-walk-style.md) left open under "Not decided".

## Context

The body director asked for one of two paces, `stroll` (0.6 of the reference speed) or `walk` (1.0). Every reason for a walk shared one of them, so a chase of the cursor, a walk to the chat, a wander and the walk home could not differ, and the walk style had no urgency factor to read.

## Decision

1. **`urgency`, a number in [0, 1], replaces `LocomotionPace`** wherever the pace flowed: `BodyLocomotionIntent`, `BodyGoalRequest`, the director's `debugGoal` and memory (`goalUrgency`), `LocomotionInput`, the MMD body and scene, the diagnostics snapshot and the `requestGoal` command, the qa-tools cues, and the motion trace `goal` event. `STROLL_URGENCY` (0.3) and `WALK_URGENCY` (0.6) in `@proj-airi/motion-driver-humanoid/types` name the former paces.
2. **The gait maps urgency to speed** with `urgencySpeedShare`, linear through the anchors (0, 0.4), (0.3, 0.6), (0.6, 1) and (1, 1.35). Each anchor starts its segment, so the former paces return their old speeds bit for bit. NaN reads as the walk urgency, and values outside [0, 1] are clamped.

## Consequences

- With every reason at its former value, headless traces keep their pose, root and channel blocks byte-identical; only the `goal` event's field changes.
- The motion trace `goal` event carries `urgency: number | null` instead of `pace`. The trace stays version 1: no committed trace has a `goal` event, and traces without one still read. A stored trace that has a `pace` goal event no longer reads.
- The diagnostics snapshot's `locomotion.pace` and `director.pace` are removed, and `urgency` takes their place, because no pace remains to report. Every reader (the MMD Motion Lab's Locomotion card, qa-tools) changes with them. `requestGoal` takes `{ x, urgency }` and rejects an urgency outside [0, 1].
- `@proj-airi/stage-ui` depends on `@proj-airi/motion-driver-humanoid` for the walk urgency its "Walk here" button sends.
