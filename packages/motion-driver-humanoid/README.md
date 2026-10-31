# `@proj-airi/motion-driver-humanoid`

This package defines renderer-neutral humanoid rig and body-intent types and
deterministic motion algorithms for reusable character motion drivers.

## Entry points

- `./clip-mask`: `buildClipBoneMask`, which reports which bone groups a clip animates.
- `./director` exports the pure stance and attention director.
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

`MMDBody` and `MMDStanceDirector` in `@proj-airi/stage-ui-mmd` are the first
consumers. The architecture is recorded in
[the 3D character motion ADR](../../docs/ai/adr/2026-10-30-3d-character-motion.md).

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
`leftLegIk`/`rightLegIk`, `leftArm`/`rightArm` (plus bones listed under
`bones.helpers`), `leftFingers`/`rightFingers`, `upperBody`, and `head`.

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
