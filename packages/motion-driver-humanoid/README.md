# `@proj-airi/motion-driver-humanoid`

This package defines renderer-neutral humanoid rig and body-intent types and
deterministic motion algorithms for reusable character motion drivers.

## Entry points

- `./director` exports the pure stance and attention director.
- `./foot-contact`: planted foot anchors, eased contact, shared pelvis reach
  correction, signed knee pre-bend, and body-turn step arcs.
- `./look-at`: `createLookAt`, look-at and turn-step contracts, and `aimEyes`.
- `./types`: canonical humanoid bones, rig traits, positions, rotations, and body intents.

## Usage

```ts
import type { BodyIntent, HumanoidBoneName, RigTraits } from '@proj-airi/motion-driver-humanoid/types'

import { decideBody, initialBodyDirectorMemory } from '@proj-airi/motion-driver-humanoid/director'
import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
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

`planFootSteps(turnSteps, anchors, pivot)` accepts newly issued commands with
`foot`, relative `yawDelta` (radians), and `duration` (seconds). Play the returned
steps sequentially, sampling each with elapsed seconds. Each arc lifts 0.3 model
units at its midpoint and lands at the anchor rotated about the mesh-local pivot.
Feed the landed ankle back to the contact planner after releasing that foot.

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

Time is supplied only through `dt` in seconds, with no clocks or randomness.
Springs integrate their response analytically, including the changing facing
during turns. Non-finite target angles become zero; coincident or non-finite
world targets aim eyes forward. Negative or non-finite `dt` advances no time.

## When to use it

Use these canonical types at boundaries between humanoid motion algorithms and
renderer-specific adapters. Positions use model units, rotations use radians,
and time values use seconds where applicable.

## When not to use it

Do not put renderer integration or Three.js, Vue, Pinia, or MMD runtime types
in this package. Use renderer-specific packages to adapt these contracts to a
particular rig.
