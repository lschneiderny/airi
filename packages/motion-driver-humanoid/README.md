# `@proj-airi/motion-driver-humanoid`

This package defines renderer-neutral humanoid rig types and procedural motion
planners for reusable character motion drivers.

## Usage

```ts
import type { BodyIntent, HumanoidBoneName, RigTraits } from '@proj-airi/motion-driver-humanoid/types'

import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
```

## Entry points

- `./types`: canonical bones, rig traits, positions, rotations, and body intents.
- `./foot-contact`: planted foot anchors, eased contact, shared pelvis reach
  correction, signed knee pre-bend, and body-turn step arcs.

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

## When to use it

Use these canonical types at boundaries between humanoid motion algorithms and
renderer-specific adapters. Positions use model units, rotations use radians,
and time values use seconds where applicable.

## When not to use it

Do not put renderer integration or Three.js, Vue, Pinia, or MMD runtime types
in this package. Use renderer-specific packages to adapt these contracts to a
particular rig.
