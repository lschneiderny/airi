# Walk urgency replaces the two paces

Date: 2026-11-23
Status: accepted. Decision D1 of the walk style plan (`.omo/plans/walk-style.md`, slice WS5), which the [walk style ADR](2026-11-23-walk-style.md) left open under "Not decided".

## Context

The body director asked for one of two paces, `stroll` (0.6 of the reference speed) or `walk` (1.0). Every reason for a walk shared one of them, so a chase of the cursor, a walk to the chat, a wander and the walk home could not differ, and the walk style had no urgency factor to read.

## Decision

1. **`urgency`, a number in [0, 1], replaces `LocomotionPace`** wherever the pace flowed: `BodyLocomotionIntent`, `BodyGoalRequest`, the director's `debugGoal` and memory (`goalUrgency`), `LocomotionInput`, the MMD body and scene, the diagnostics snapshot and the `requestGoal` command, the qa-tools cues, and the motion trace `goal` event. `STROLL_URGENCY` (0.3) and `WALK_URGENCY` (0.6) in `@proj-airi/motion-driver-humanoid/types` name the former paces.
2. **The gait maps urgency to speed** with `urgencySpeedShare`, linear through the anchors (0, 0.4), (0.3, 0.6), (0.6, 1) and (1, 1.35). Each anchor starts its segment, so the former paces return their old speeds bit for bit. NaN reads as the walk urgency, and values outside [0, 1] are clamped.
3. **Each goal reason asks for its own urgency** (`GOAL_URGENCY` in the director). Every reason keeps its former pace except three, so a chase, a chat approach, a wander and the walk home differ:

   | Reason | Urgency | Speed share | Before |
   | --- | --- | --- | --- |
   | `wander` | 0.2 | 0.53 | stroll |
   | `visit`, `return-home`, the corrective step onto the cursor | 0.3 | 0.6 | stroll |
   | `approach-chat` | 0.5 | 0.87 | walk |
   | `tool`, `enter-stage`, `stay` | 0.6 | 1 | walk |
   | `approach-cursor` (a chase) | 0.75 | 1.13 | walk |
   | `debug` | as requested | | as requested |

   A chase and the corrective step share the `approach-cursor` reason; the director tells them apart by their urgency.
4. **A hurried walk leans forward.** `walkStyleFrom` takes the goal's urgency as an optional factor: above `WALK_URGENCY` it adds up to 6 degrees of trunk lean at urgency 1, as rushed and active acted walks lean; at or below it, every style stays exactly as it was. The MMD body passes the current goal's urgency, so a chase leans 2.25 degrees more.

## Consequences

- Headless scenarios drive goals with debug cues at the walk urgency and never chase, approach the chat or wander, so their pose, root and channel blocks stay byte-identical; only the `goal` event's field changes.
- The gait brakes at v_ref per second, so a chase at full speed needs up to 1.13 s and 0.58 L to stop instead of 1 s and 0.45 L. A pointer that lands less than 0.58 L ahead of a running chase is passed by up to about 0.1 L (0.093 L in the press test), below the 0.15 L the corrective step needs. The director press tests are pinned again for this.
- On a rig with a step limit, the limit sizes the stride for the style's speed times the urgency's speed share, so a hurried walk takes shorter, quicker steps until the top cadence slows it: a stiletto rig reaches 1.29 of v_ref at urgency 1, and a stroll on it is clamped less than the walk.
- The motion trace `goal` event carries `urgency: number | null` instead of `pace`. The trace stays version 1: no committed trace has a `goal` event, and traces without one still read. A stored trace that has a `pace` goal event no longer reads.
- The diagnostics snapshot's `locomotion.pace` and `director.pace` are removed, and `urgency` takes their place, because no pace remains to report. Every reader (the MMD Motion Lab's Locomotion card, qa-tools) changes with them. `requestGoal` takes `{ x, urgency }` and rejects an urgency outside [0, 1].
- `@proj-airi/stage-ui` depends on `@proj-airi/motion-driver-humanoid` for the walk urgency its "Walk here" button sends.
