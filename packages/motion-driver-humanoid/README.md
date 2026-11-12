# `@proj-airi/motion-driver-humanoid`

This package defines renderer-neutral humanoid rig and body-intent types and
deterministic motion algorithms for reusable character motion drivers.

## Entry points

- `./clip-mask`: `buildClipBoneMask`, which reports which bone groups a clip animates.
- `./clip-meta`: `deriveClipMeta`, `effectiveLayer` and `slugLabel`, which turn a clip bone mask, duration and name into a layer, kind, loop flag and label.
- `./director` exports the pure stance and attention director. It also issues
  `visit` walks toward the cursor, keeps her where a wander or a visit took
  her for 45 to 150 s, and accepts `idle` clip requests as the weakest source.
- `./idle-clips`: `decideIdleClip`, a pure scheduler that picks one of the
  clips the user allowed for idle after enough quiet time. The caller sends
  the pick to the director as an `idle` request.
- `./foot-contact`: planted foot anchors, eased contact, shared pelvis reach
  correction, signed knee pre-bend, and body-turn step arcs.
- `./look-at`: `createLookAt`, look-at and turn-step contracts, and `aimEyes`.
- `./locomotion`: `createLocomotion`, a deterministic procedural gait with root
  motion, planted world foot anchors, body channels, and arm swing.
- `./rest-pose`: `createArmRest`, the relaxed arm, hand, and finger rest pose.
- `./types`: canonical humanoid and finger bones, rig traits, positions, rotations (with `rotationToMatrix` and `mirrorRotation`), and body intents.
- `./weight-shift`: deterministic seeded weight shift and Natural body composition.

## Usage

```ts
import type { BodyIntent, HumanoidBoneName, RigTraits } from '@proj-airi/motion-driver-humanoid/types'

import { decideBody, initialBodyDirectorMemory } from '@proj-airi/motion-driver-humanoid/director'
import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
import { createLookAt } from '@proj-airi/motion-driver-humanoid/look-at'
import { createWeightShift } from '@proj-airi/motion-driver-humanoid/weight-shift'
```

Create one foot-contact planner per rig with mesh-local bind hip, knee, and ankle
positions. Call `step(input, dt)` with explicit seconds, the requested pelvis
translation, and the previous solved ankle positions/yaws. Weights are in [0, 1].
Use an ankle baseline (not the toe or mesh minimum) for `footBaselineY`. The
returned pelvis offset includes the drop and lateral clamp; apply it before IK.
Apply the returned foot targets and knee pre-bends before the renderer's IK pass.
Bind hips must already be reachable within a 6% leg-length drop; this planner
handles stance sway, not vertical teleports or locomotion.

Contact eases over 0.3 seconds. Anchors stay fixed until contact has fully released
and is requested again. Clip foot weights and ducking reduce the contact target;
animated knees receive no pre-bend. Renderer adapters retain ownership of bone
rotations and solving IK.

`planFootSteps(turnSteps, anchors, pivot, swingHeight = 0.3)` accepts newly issued
commands with `foot`, relative `yawDelta` (radians), and `duration` (seconds). Play
the returned steps sequentially, sampling each with elapsed seconds. Each arc lifts
`swingHeight` model units at its midpoint and lands at the anchor rotated about the
pivot. Feed the landed ankle back to the contact planner after releasing that foot.
`setAnchors(anchors)` re-bases the planted anchors without re-easing contact, for
example when the gait hands its final anchors back after a walk.

```ts
import { createLookAt } from '@proj-airi/motion-driver-humanoid/look-at'

const lookAt = createLookAt({ eyeYawLimit: 0.35, eyePitchLimit: 0.25 })
const frame = lookAt.step({ targetYaw: 0.5, targetPitch: 0.1, facingYaw: 0 }, 1 / 60)
```

Targets and facing use the same stance frame: +Z forward, positive yaw toward
+X, positive pitch downward. Feed actual facing back each frame; when the facing
command is applied directly, feed back `frame.facingYaw`. Rotations are absolute
rest-relative parent-frame angles, not incremental bone writes.

The spine, chest, neck, and head share yaw/pitch through critically damped
springs. Eye output covers the remaining angular error within rig limits.
`aimEyes` separately computes per-eye world-aligned angles from world positions
and a target; adapters must account for each animated eye parent's orientation
before applying these angles. Neither helper imports renderer math types.

A continuous yaw error above 60 degrees starts a turn after 0.5 seconds; an
error above 90 degrees starts immediately. Turns finish planted steps, aim for
15 degrees remaining, stop below 20 degrees, and wait 1.5 seconds before
restarting. `turnSteps` contains events emitted once at step start, alternating
left/right feet, each lasting 0.4 seconds with at most 22.5 degrees of signed yaw
(45 degrees per pair). Event timestamps are elapsed seconds since controller
creation. A foot-contact adapter consumes the events; this module never moves
feet or writes bones.

Pass `allowTurn: false` while another planner owns facing, such as locomotion:
no turn steps are planned and `facingYaw` passes through.

Time is supplied only through `dt` in seconds, with no clocks or randomness.
Springs integrate their response analytically, including the changing facing
during turns. Non-finite target angles become zero; coincident or non-finite
world targets aim eyes forward. Negative or non-finite `dt` advances no time.

### Locomotion

```ts
import { createLocomotion } from '@proj-airi/motion-driver-humanoid/locomotion'

const locomotion = createLocomotion({ traits, seed: 7 })
locomotion.rebase({ x: homeX, yaw: 0 })
const frame = locomotion.step({ now, goalX, pace: 'walk', arriveFacing: 0, enabled: true, idleSupport, plantedFeet }, 1 / 120)
```

`traits` are `GaitTraits`: leg length L, ankle baseline, bind hip-to-ankle height,
and bind ankles. Step on the fixed 120 Hz grid. Positions are world model units on
the ground line (y = 0, travel along x). Yaw 0 faces the camera, and walking faces
+/-90 degrees. The reference step is 0.5 L at 1.8 Hz, so `v_ref = 0.9 L` per
second; `pace` (`LocomotionPace` from `./types`) scales it by 0.6 or 1.0. Speed ramps at `v_ref` per second and
stops exactly at `goalX`. A goal that needs a new heading first turns in place
through `planFootSteps` about the root: at most 45 degrees per 0.45 second step,
so 90 degrees takes two steps. After arrival the gait closes the stance, turns to
`arriveFacing`, and returns to `idle` after both feet have been planted for 0.25
seconds.

Planted foot targets are frozen world anchors. Landing targets are re-planned until
75% of the swing, so the stance stays symmetric about the hip while the speed
changes. The pelvis drop is the design bob, sized from the planned stance spans, plus
a reach floor that may lower it by at most 0.01 L for off-centre stances. A leash
shortens root travel if a planted ankle would end farther than 0.985 L from its hip;
`leashClamps` counts those ticks and stays zero in normal driving. Body channels use `composeWeightShift` field names and
signs: blend them as `lerp(weightShift, frame.body, frame.weight)` and duck
weight-shift by `1 - frame.weight`. While `frame.weight > 0`, the gait owns the foot
targets: seed it with the contact planner's planted anchors (converted to world),
and hand `frame.feet` back through `setAnchors` when it returns to idle. Pass
`frame.root.yaw` to look-at as `facingYaw` with `allowTurn: false` while moving.
`rebase` teleports the root, re-plants both feet at the bind ankle offsets, and
makes the next frame `idle`; use it for drag and teleports. The seed only breaks
first-foot ties.

`decideBody(input, memory)` from `./director` returns a `BodyIntent` and the
next memory. It sits after 120 seconds of continuous idle mode
(`IDLE_TO_SIT_MS`) and sleeps while the user is away, only when the matching
slot is available, and holds each stance for at least 3 seconds
(`STANCE_MIN_DWELL_MS`).

On a stage with a ground line, `decideBody` also owns where she goes:
`BodyIntent.locomotion` carries the goal x, its reason (`approach-chat`,
`approach-cursor`, `return-home`, `wander`, `tool`, `debug`, `enter-stage` or
`stay`) and the pace. She approaches the chat when it unfolds, chases the cursor for
`CHASE_WINDOW_MS` after a poke, pet, drag or sent message, returns home
`RETURN_HOME_DELAY_MS` after the last reason, and wanders between
`WANDER_MIN_MS` and `WANDER_MAX_MS` apart in roam mode only. A wander goes at
least three leg lengths, or, where three legs fit on neither side, half the
longer free side but never less than one leg length. A wander that falls due
while another goal is walking is rescheduled from the arrival. A goal waits while
she speaks and is dropped after `PENDING_GOAL_TTL_MS`. Tool requests share
`MOVE_TOOL_REFRACTORY_MS` for movement and use `LOOK_TOOL_REFRACTORY_MS` for a
glance. The boundary is fixed: the director chooses goals and never moves the
root; locomotion integrates the position, gait phase, step targets, arm swing
and root yaw, and never chooses a goal.

The optional `reach` input lists every ground line she may walk to, for a row of
displays; `ground` stays the one she stands on. A goal with a destination (the
chat, the cursor, home, a tool, the debug goal) clamps to the nearest zone, so it
can cross from one zone to another, while a wander stays on `ground`. The stretch
between two zones is a wing that no display shows. There a clip that stops her
(an action or a dance) is refused as `busy`, and a root at rest gets an
`enter-stage` goal to the nearest zone. Without `reach`, `ground` is the only
zone and neither wing rule applies.

`NO_WORLD_BODY_INPUT` supplies inert world inputs for the classic window. The
MMD stance director spreads it only when the scene has no stage world; in stage
mode the scene supplies the ground, root, home, clip ownership, speech, chat,
cursor, tool and leg-length inputs.

The director also performs clips. A `BodyActionRequest` (`gesture`, `action` or
`dance`, layer `full` or `upper`, source `act`, `tool` or `debug`) is decided in
a fixed order, first match wins: an empty `clipId` from `tool` or `debug` stops
the running performance; then `asleep` (away or sleeping), `dragging`, the
gesture repeat cooldown (`GESTURE_REPEAT_MS`, 4 s per clip, refused without a
retry time), the action and dance refractories (`ACTION_REFRACTORY_MS` 15 s and
`DANCE_REFRACTORY_MS` 60 s from the end of the last one), and `busy` (a full clip
runs, or a gesture arrives while any clip runs). A request whose source is
`debug` and whose `loop` is true skips the gesture repeat cooldown and no other
rule, so the Motion Lab and the QA gates can keep a gesture playing. An action
or dance replaces a running upper clip. A gesture plays at once, also while she
sits, walks or speaks; an action or dance waits in `settling` until she has
stood for `STAND_SETTLE_MS` and locomotion is idle, or for `SETTLE_TIMEOUT_MS`,
and without a timeout while she speaks.
A refusal still advances `lastActionSeq` and names `actionRefusal` with
`actionRetryAfterMs`. An accepted clip is `BodyIntent.action`, `settling` until
the body is clear and then `playing`; the adapter echoes `actionFeedback`, and
`PERFORM_WATCHDOG_MS` ends a one-shot that never reports. A full clip closes the
locomotion gate, parks the goal in progress as the pending goal, and hands the
pending goal a fresh time to live when it ends. A poke, a drag, going away, a
chat unfold (loops only), a sent chat message (`chatSendSeq`, loops only) or a move tool (loops only) ends it. Every host supplies
`interactionSeq`, `chatSendSeq`, `interactionAtMs`, `actionRequest`, `actionFeedback` and
`dragging`, with or without a stage world; `NO_WORLD_BODY_INPUT` no longer
defaults them.

`MMDBody` and `MMDStanceDirector` in `@proj-airi/stage-ui-mmd` are the first
consumers. The architecture is recorded in
[the 3D character motion ADR](../../docs/ai/adr/2026-10-30-3d-character-motion.md);
locomotion, rest pose and clip masks in
[the full-screen stage and locomotion ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md);
clip metadata and clip performances in
[the clip actions ADR](../../docs/ai/adr/2026-11-03-mmd-clip-actions.md).

## Arm rest pose and clip masks

`RestRelativeRotation` is intrinsic YXZ Euler: `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
`rotationToMatrix` and `matrixToRotation` convert it, and `mirrorRotation` flips
yaw and roll for the right side. Bind frames must be world-aligned (MMD and
normalized VRM bones both are).

`createArmRest().step(input, dt)` returns rest-relative rotations for the shoulder,
upper arm, lower arm, hand, and finger bones. The body-space angles in
`DEFAULT_ARM_REST_POSE` are the same for every rig. `bindArmAngle` (36 degrees
for an MMD A-pose, 0 for a T-pose) converts them into rig-local rotations, so
both rigs end with the same world forearm direction. Pass `thumbAxis`, measured
by the adapter, to curl the thumb about its own axis. Breath (-1..1) rolls the
shoulder by 0.8 degrees and counter-rolls the upper arm by 0.6 degrees. Torso roll
goes through a critically damped spring with omega 6. Locomotion `swing` adds
forward pitch and elbow flex, scaled by `swingWeight`. Every group's output is
scaled by `1 - owned[group]`. Thumb curl entries map to Metacarpal, Proximal,
Distal; other fingers map to Proximal, Intermediate, Distal and have no
Metacarpal output.

`buildClipBoneMask(tracks, bones)` runs once per clip. A quaternion track counts as
animated when a key differs from identity, or from the first key, by more than
0.5 degrees. A position track counts when a key is more than 0.01 units from the
origin or from the first key. Identity-keyed tracks own nothing. Groups are `root`,
`leftLegIk`/`rightLegIk`, `lowerBody` (hips, FK legs, and caller-listed helper bones), `leftArm`/`rightArm` (plus bones listed under
`bones.helpers`), `leftFingers`/`rightFingers`, `upperBody`, and `head`.
The all-parent bone (`全ての親` or `master`) belongs to `root`.

## Clip metadata

`deriveClipMeta(mask, durationMs, name)` classifies a clip once at import. Rules, first match wins:
a non-positive or non-finite duration or a mask with no animated group is `unusable` on layer `none`;
a name matching idle, stand, sit or sleep (also Japanese) is a looping `stance`; a clip that animates
the root, leg IK or `lowerBody` is a `dance` from `DANCE_MIN_MS` (20 s) and an `action` below it;
an upper-only clip is a `gesture` up to `GESTURE_MAX_MS` (6 s) and an `action` above it. Dances and
gestures never loop; actions loop when the name contains loop, ループ, repeat or ends in `_l`.
`slugLabel` gives the ascii label (`CLIP_LABEL_PATTERN`), or `null` with the `non-ascii-name` note.
`effectiveLayer(meta, kindOverride)` keeps any gesture on the `upper` layer.

## Checks

```bash
pnpm -F @proj-airi/motion-driver-humanoid exec vitest run
pnpm -F @proj-airi/motion-driver-humanoid typecheck
pnpm exec publint packages/motion-driver-humanoid --pack false
```

## When to use it

Use these canonical types at boundaries between humanoid motion algorithms and
renderer-specific adapters. Positions use model units, rotations use radians,
and time values use seconds where applicable.

## When not to use it

Do not put renderer integration or Three.js, Vue, Pinia, or MMD runtime types
in this package. Use renderer-specific packages to adapt these contracts to a
particular rig.
