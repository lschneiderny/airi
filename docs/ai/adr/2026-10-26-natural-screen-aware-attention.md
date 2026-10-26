# Natural screen-aware attention

Date: 2026-10-26
Status: accepted

## Context

Natural's resting pose and peripheral glances did not account for where the Live2D model sits among the user's displays. Screen attention also used a fixed desk point, and Natural had no chat target or chat cues. The change is limited to Live2D Natural. It does not alter Universal, MAGIC, VRM, web, or pocket behavior.

The placement reference is the horizontal center of the union of the bottom-layer displays. Upper displays do not move that reference. The model's head position is measured in Electron DIP screen coordinates, with y increasing downward. A centered model has no inward bias.

## Decision

One setting, `settings/live2d/natural-screen-awareness`, enabled by default, controls both placement and chat attention. It appears only for Natural. Disabling it sends no placement or chat signal and restores the prior behavior.

Placement inwardness is normalized against the bottom-layer reference and clamped to -1 through 1 by `stage-placement/index.ts` (`screenInwardness`). `natural-motion/placement.ts` (`shapeInwardness`) applies a 0.15 dead zone and saturation at 0.80 with smoothstep; the same file sets the 2-second first-order easing time constant. Positive values mean inward toward screen +x, positive gaze x, and positive head X (`ParamAngleX`). `natural-motion.ts` computes head-yaw bias as `0.10 * inward * (1 - onCursor)`, a normalized 0.10 head-X bias at full inwardness. The approved plan and design research describe this as about 3 degrees on the reference rig; the tracked code establishes only the normalized bias, not a rig-specific degree conversion. The bias fades as cursor attention engages. There is no drag detector.

The turn is head-only in the controller; each rig carries the body through its existing path. Design research recorded that Bear PhysicsSetting1 maps AngleX to BodyAngleX at weight 100, and that ForBOOTH uses BodyAngleX as a physics input. These are plan/research observations, not facts established by tracked rig configuration. `natural-motion/body.ts` sets the body follower X/Y gain to 0.99. Because body movement trails the head, a small head bias is sufficient and avoids a large, mechanical whole-body rotation.

For peripheral and aside side choices, `natural-motion/gaze.ts` uses the draw threshold `0.5 - 0.15 * inward`, shifting the edge preference to about 65/35 while remaining even at center. The same file defines the screen point as x `0.30 * inward` and y `-0.18`; `natural-motion.ts` activates it for screen attention or watching mode, and `natural-motion/pending-actions.ts` uses it for screen-change glances. Luke chose both modes for now and may revisit the choice.

Chat receives only a mapped target, typing activity, sequence counters, and a word count. `packages/stage-ui/src/components/scenes/chat-activity.ts` sets the typing activity window to 1.5 seconds. In `natural-motion/gaze.ts`, 0.35 of autonomous fixation choices branch to chat while typing with a non-null target; `natural-motion.ts` sets head follow to 0.6 of the mapped target. A null target consumes chat cues without a glance. `natural-motion.ts` schedules typed-send glances after a seeded delay from 0.18 to 0.30 seconds, with a hold of `clamp(0.5 + 0.25 * words, 0.6, 3.0)` seconds. It schedules chat-opening glances after 0.25 seconds with a hold of 0.8 seconds. Voice sends never trigger the reading glance. When talking starts, any active chat fixation or glance ends at once, and a pending chat glance is cancelled, so replies stay on camera. The first non-null chat input records the send and unfold counters as baselines; a scenario whose first chat event is a send or unfold therefore needs an earlier target event to trigger that glance.

Chat randomness uses stream index 14, appended after existing streams in `natural-motion.ts`. With no signal, no new random draws or reordered draws are introduced. The observer-only `glance` and `placement` events report actions and add no motion or random draws. Chat signals use the existing speech-bus Eventa context and BroadcastChannel adapter. Eventa dispatches to listeners in the same context, so same-page delivery is possible. Web and pocket remain inert because their `Model.vue` instances provide no `chatTarget`; `natural-chat-input.ts` then returns `null`.

## Consequences

The stage-ui-live2d README describes the setting and behavior. QA can drive placement and chat through the `placement`, `chat-target`, `chat-typing`, `chat-sent`, and `chat-unfold` scenario events. T1 applies those events through its scenario sink. T3 pins screen awareness off for scenarios without these signals and provides `builtin:t3-screen-attention` for rendered checks.

Placement and chat state are independently inspectable through the QA bridge. The adapter forwards changed placement and chat inputs only when their values change. Its `onPlacementStep` hook reports `placementYawBias` after each composition and controller advance, so the readout reflects the latest Natural step, not every internal 120 Hz integration step. `run-t3` configures screen awareness on only for scenarios with placement or chat events; T3 gate scenarios without those events are pinned off. Seeded tests check placement shaping, eased yaw, cursor fade, chat selection and glance timing, and no-signal determinism. Existing seeded traces remain unchanged when no signal is present.

## Open items

Joint QA with Luke should tune the roughly 3-degree turn, the 65/35 edge preference, the 0.30 screen point, and chat fixation and glance timing across the supported rigs. Visual checks should also confirm the mirrored-rig sign and whether applying the screen point to both screen attention and watching mode remains desirable.
