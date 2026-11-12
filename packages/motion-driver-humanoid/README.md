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
- `./dynamics`: `secondOrderCoefficients`, `advanceSecondOrder`, `createLagChain`,
  `createInertializer`, `softLimit` and `minJerk`, for scalar secondary motion.
- `./noise`: `deriveSeed`, `gaussian`, `createDriftNoise` and
  `createActivityGate`, for independent seeded drift and moving holds.
- `./foot-contact`: planted foot anchors, eased contact, shared pelvis reach
  correction, signed knee pre-bend, and body-turn step arcs.
- `./look-at`: `createTurnPlanner`, the turn-step contracts, and `aimEyes`.
- `./locomotion`: `createLocomotion`, a deterministic procedural gait with root
  motion, planted world foot anchors, body channels, and arm swing.
- `./performance`: `createBodyPerformer`, a pure whole-body performer on a
  120 Hz grid, its rig/input/frame contracts, channels, FK, arm-key solver,
  collision corrector, and extensible `PerformanceLayer` contract.
- `./motion-trace`: `MotionTraceV1`, little-endian float32 block codec, canonical
  humanoid parents, and `MotionTraceRecorder`. The recorder accepts plain vectors
  and rest-normalised world quaternions in +Y up, +Z forward axes, removes hips
  heading and stores parent-relative rotations with continuous quaternion signs.
  Call `start(header)`, `sample(time, wall, readN, rootPos, channels)`, `event(e)`,
  `stop()`, then `drain(from, count)`. Times are seconds; samples rebase time and
  wall to frame zero, while event times are already relative to frame zero.
  Samples outside recording are inert; starting again discards the old capture.
  Drain is non-destructive and supports arbitrary ranges across 600-frame chunks;
  only the first range includes the header (with total frames) and sorted events.
- `./types`: canonical humanoid and finger bones, rig traits, positions, rotations (with `rotationToMatrix` and `mirrorRotation`), and body intents.

## Usage

```ts
import type { BodyIntent, HumanoidBoneName, RigTraits } from '@proj-airi/motion-driver-humanoid/types'

import { decideBody, initialBodyDirectorMemory } from '@proj-airi/motion-driver-humanoid/director'
import { createFootContact, planFootSteps } from '@proj-airi/motion-driver-humanoid/foot-contact'
import { aimEyes, createTurnPlanner } from '@proj-airi/motion-driver-humanoid/look-at'
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
import { createTurnPlanner } from '@proj-airi/motion-driver-humanoid/look-at'

const turns = createTurnPlanner()
const frame = turns.step({ targetYaw: 0.5, facingYaw: 0 }, 1 / 120)
```

Target and facing yaw use the stance frame: +Z forward, positive yaw toward +X.
Feed actual facing back each frame; when the facing command is applied directly,
feed back `frame.facingYaw`. The whole-body performer plans the head and torso
toward a gaze target; this planner only decides when the feet turn the body.

`aimEyes` computes per-eye world-aligned angles from world positions and a
target; adapters must account for each animated eye parent's orientation before
applying these angles. Neither helper imports renderer math types.

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
Dwell, step and refractory boundaries are split inside a tick rather than
quantized to it. Non-finite target angles become zero; coincident or non-finite
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
`leashClamps` counts those ticks and stays zero in normal driving. `frame.body` holds
`GaitBodyChannels` (pelvis translation with positive `pelvisLateral` toward the
character's right, and torso rotations in radians); the adapter maps them into the
performer's `gait.channels`, which blends them by `frame.weight`. While `frame.weight > 0`, the gait owns the foot
targets: seed it with the contact planner's planted anchors (converted to world),
and hand `frame.feet` back through `setAnchors` when it returns to idle. Pass
`frame.root.yaw` to the turn planner as `facingYaw` with `allowTurn: false` while moving.
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

## Rotations and clip masks

`RestRelativeRotation` is intrinsic YXZ Euler: `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
`rotationToMatrix` and `matrixToRotation` convert it, and `mirrorRotation` flips
yaw and roll for the right side. Bind frames must be world-aligned (MMD and
normalized VRM bones both are).

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

## Dynamics primitives

`./dynamics` holds pure building blocks for scalar secondary motion, used by the body performer.

```ts
import { advanceSecondOrder, secondOrderCoefficients } from '@proj-airi/motion-driver-humanoid/dynamics'

const coefficients = secondOrderCoefficients({ f: 2, zeta: 0.7, r: 0 }, 1 / 120)
const state = { y: 0, v: 0, x: 0 }
advanceSecondOrder(state, 0.1, coefficients)
```

`advanceSecondOrder` mutates caller-owned `{ y, v, x }` without allocating; `x`
is the previous target. It solves `y + k1*y' + k2*y'' = x + k3*x'` exactly for
a target moving linearly across the tick. Frequency `f` is positive Hz, damping
`zeta` is limited to [0.3, 1], and response `r` is dimensionless. Negative `r`
anticipates, underdamping overshoots, and `r = 2` removes steady ramp lag.
Cache coefficients for each parameter and tick set. Target slope is capped at
20 units/s (rad/s for angles). Route larger cuts through inertialisation;
the full target is remembered even when its slope is capped.

`createLagChain(delays, dt).step(driver)` starts at zero and cascades critically
damped followers. Delays are positive seconds per link, with
`f = 1 / (pi * delay)`. Its returned array is borrowed and changes next tick.
`createInertializer(channelCount, dt)` holds borrowed `positions` and `velocities`
offset buffers. Call `cut(channel, previousPosition - newPosition,
previousVelocity - newVelocity)` before reading them at the cut instant.
Add them to the new layer output to preserve position and velocity. Repeated cuts
add to the current offsets. `step(omega = 9)` applies exact critically damped
decay and returns the position buffer; `reset()` zeroes both buffers on rebase.
Omega is positive in inverse seconds; channel indices must be in range.

`softLimit(value, min, max)` requires `min < max`, preserves the middle 80% of
the interval, and uses smooth tanh knees approaching the bounds. Asymmetric
ranges are normalised about their midpoint. `minJerk(u)` clamps progress to
[0, 1] with zero endpoint velocity and acceleration.

All inputs must be finite and time steps are nonnegative seconds. Fixed-tick
constructors keep their `dt`, and a zero tick advances no state. No step method
allocates. Copy borrowed buffers when you keep a past frame. Use these primitives
for renderer-neutral motion synthesis, not for bone writes or wall-clock scheduling.

## Noise primitives

`./noise` holds seeded aperiodic drift and moving holds, used by the body performer.

```ts
import { createActivityGate, createDriftNoise, deriveSeed } from '@proj-airi/motion-driver-humanoid/noise'

const dt = 1 / 120
const drift = createDriftNoise({ seed: deriveSeed(7, 0) })
const gate = createActivityGate({ seed: deriveSeed(7, 1) })
const offset = 0.01 * gate.step(dt) * drift.step(dt)
```

Drift sums three equal-variance OU processes (default time constants 0.9, 3.5,
14 seconds), divided by sqrt(3), then low-passes once (default 0.15 seconds).
It returns normalised noise; multiply by the channel SD and a regional gate
outside the primitive. `taus` is a triple of positive seconds; `filterTau = 0`
bypasses filtering. The gate uses a unit OU (default `tau = 8` seconds) passed
through a logistic curve into [`floor`, 1], with default `floor = 0.15`.
Both processes start at zero latent state. Each instance owns its stream.
Assign permanent stream indices with `deriveSeed(seed, index)` and append new
indices so adding a channel cannot shift existing sequences. `gaussian(random)`
consumes exactly two uniforms in [0, 1) per draw. These are local copies of
Natural's helpers, so the two packages stay independent and Natural's random
streams never change.

Time steps are finite, nonnegative seconds. A zero tick consumes no draw and
returns the current value. No step method allocates.

## Whole-body performance

```ts
import { BODY_TICK, createBodyPerformer } from '@proj-airi/motion-driver-humanoid/performance'

const performer = createBodyPerformer({ traits, seed: 7 })
const reference = performer.restChannels()
// In the adapter's fixed clock, after the gait has advanced by BODY_TICK:
const frame = performer.step(input)
// Copy frame.channels before the next step if retaining it for interpolation.
```

The performer owns posture, seeded support transfers, aperiodic sway, breath,
arm rest and secondary dynamics, gaze planning, layer composition, soft limits,
and final arm collision correction. It never integrates root position, chooses
a director goal, reads a clock, writes a bone, or imports Natural. The MMD body
of `@proj-airi/stage-ui-mmd` poses every bone from it under the Natural driver.

`step` advances exactly `BODY_TICK` (1/120 second), regardless of display rate.
The adapter supplies interpolated continuous inputs, consumes discrete events
once, and interpolates the previous and current channel buffers for display.
The frame, channel array, diagnostics, and turn-event array are borrowed until
the next `step` or `reset`. `restChannels()` returns an owned, collision-cleared
snapshot of the seed's initial reference. `reset()` rewinds all streams, timers,
filters, layer state and collision correction; use it on a teleport or rebase.

The complete plain-data contracts are in
[`contracts.ts`](src/performance/contracts.ts). `BodyRigTraits` supplies finite
model-space bind geometry, one to four spine positions in hierarchy order,
the spine's parent relationship, arm segment vectors, feet and structural
capabilities. Axes are +X character left, +Y up, +Z forward. Upper-arm and
forearm vectors are bind-position differences; lengths are derived once.
Canonical bind frames are world-aligned. Physics-owned bones are removed by the
adapter; partial-finger mapping and toe IK stay with it.

`BodyCollider` attaches a sphere, Y-axis capsule or box to `hips`, `spine0`
through `spine3`, `neck` or `head`. Its centre and intrinsic YXZ rotation are in
that ancestor's rest-aligned frame. Sizes are model units; capsule length
excludes the caps and box sizes are half-extents. Ancestors must exist in the
supplied chain. An empty collider list requests a proportional torso capsule
and head sphere. Only kinematic obstacles belong here.

`BodyPerformanceInput.head.attitude` is Natural's posture alone, converted to
radians, and `head.terms` keeps the six other terms separate. `head.slow` is the
slow posture component. The adapter reads `controller.bodyIntent()`, resolves
the gaze goal, converts Natural units, and maps breath, voice, mood, energy,
latest event records, directive, clip ownership and root velocity. Inputs are
finite; amplitudes/rates are nonnegative, weights/tension/voice are [0,1],
valence/arousal and forced support are [-1,1]. Event times are active seconds.
Positive support names the RIGHT foot, so its pelvis displacement is negative X.
The performer follows `attitude`, `pet` and `held` through separate neck and
head responses, with the neck starting each turn and the head following, and
the speech- and cue-timed terms `emphasis`, `impulse`, `gesture` and `cue`
through one fast follower so an accent keeps its beat. In a gaze shift the neck
also follows the head plan through its own, faster response. Underneath these,
the neck and head counter-rotate part of the trunk's world rotation from
posture and breath (0.5 of yaw, 0.6 of pitch and roll, 80 ms late), so the
head stays near level while the body sways; the trunk's share of Natural's head
yaw and the gaze trunk are intent and are not cancelled. At idle the head also
wanders slowly on the performer's own seeded streams (a gated drift, its
velocity smoothed at 0.25 Hz), scaled by `posture.amplitude` and eased to 0.3
while the gaze holds a sustained target or shifts.

The channel table contains 77 scalars: pelvis XYZ in leg lengths; hips,
three torso controls, neck and head in intrinsic YXZ radians; and per side nine
arm angles, fifteen finger curls, spread, thumb opposition, foot pitch and toe
bend. Arm angles use a straight-down, palm-toward-thigh reference:
`U = Rx(-flex) Rz(side * abduct) Ry(-side * twist)`, then
`F = U Rx(-elbow) Ry(-side * pron)` and
`H = F Rz(-side * wflex) Rx(wdev)`. Positive foot pitch lifts the toes.
`channelGroup` assigns each channel one clip group; pelvis and hips belong to
`lowerBody`. `BodySkeleton` evaluates this FK in borrowed scratch transforms
and `spineWeights` distributes the three controls without changing their sum.
The adapter must apply arm bind-frame conversion and compensate clavicle
rotation, rather than treating these angles as bone-local Euler deltas.
`solveArmKey` performs load-time two-bone IK in this same reference; targets
use arm lengths, swivel and returned angles use radians. A geometrically
unreachable key returns null. Check its limits and clearance before playback.
Each arm follower trails its parent through a drag term (architecture 3a).
The elbow trails the upper arm's swing in the world, its flex rate minus the
trunk pitch rate, so the plumb line's counter-rotation of the upper arm against
a pitching trunk (stillness in the world) never swings the forearm.
Terms that several arm joints receive at once (breath, weight, gait swing, a
layer's key) pass each joint's lag link before its follower, with delay
`s_j + max(0, tau_upper - tau_j)`: architecture 4a's start offsets (0 ms for
clavicle and upper arm, 30 elbow, 60 pronation, 90 wrist, 130 fingers) plus
the faster distal follower's head start in ramp lag. Shared motion therefore
reaches the arm from shoulder to fingertip by construction; each joint's own
noise and its drag bypass the link.
Nonnegative channels use a C1 lower knee that preserves zero exactly; the
generic tanh lower knee would bend an otherwise neutral toe. Their upper knee
and all signed channel limits use the shared `softLimit` primitive.

The frame's `gaze` is the planned stance-frame direction, not the raw target.
Aim each eye from its rendered head transform toward that line and clamp to
the rig's eye limits; `eyes` is the canonical FK residual for diagnostics.
Large unreachable shifts saturate the eyes until head/body turning catches up.
`lidClose` is closure [0,1], whereas Natural's `blinkFactor` is openness:
the adapter combines `max(1 - blinkFactor, lidClose)`.
`createTurnPlanner().step({ targetYaw, facingYaw, allowTurn }, dt)` plans
the dwell, hysteresis, refractory and planted-step timing of body turns. Its frame and event array are borrowed until the next call.

Optional `layers` are performer-owned instances, reset at creation and reset.
Their order is emotion, act, gesture, cue, reaction after base, gaze and gait.
A layer's optional `plan` may replace support and gaze before the generators;
its `step` then emits masked additive or override targets, weight, sequence and
optional additive channels, morph requests, foot-step events and act feedback.
The stack supplies smooth entry/exit and inertializes sequence changes.
Mixed override/additive output supports arm gestures with additive torso
motion. The context exposes full intent, capabilities, initial rest, the
previous frame, the merged plan, tick and time. Besides support and gaze, a
plan may request an emotion arm form (`armForm`, hand to chest or the thinking
hand, for the gesture layer to hold) and `suppressHeadCue`, which hands the
head cue to the cue layer. A step may also return its `gesture`, `cue`,
`emotion` or `reaction` report; the frame's diagnostics carry the latest one
of each kind, and `diagnostics.gesture.activation` is the weight the stack
applied to each arm through gesture-order layers. Hosts turn report sequence
changes into trace events. `HAND_SHAPES` holds architecture 4a's six hand
shapes as data; the emotion layer blends the open and fist shapes, and the
gesture layer shapes each stroke and arm form from them. Layers implement clip admission/cancellation
from `input.owned`; generators and followers keep integrating beneath clips.
The adapter applies `1 - owned[group]` exactly once at bone writes.

`createEmotionLayer()` (`src/performance/emotions.ts`, not yet registered by the
MMD body) is the additive emotion posture layer of architecture 4c. Each emotion
in `BODY_EMOTIONS` adds a trunk, shoulder, elbow, pelvis and hand posture at the
weight `held.level x held.strength`, or at an unheld pulse's intensity, through
its own second-order response (so happy sinks before it lifts and surprise rings).
An unheld pulse holds its body pose as long as Natural holds the face: it rises
with Natural's impulse attack, holds for the band's `faceHold`, and releases with
the band's `faceReleaseTau`, so face and body read as one reaction. A slight
pulse moves no body. A held emotion releases with Natural's held `releaseTau`, so a
hold that switches emotion at full level crossfades instead of dropping the old
posture in one step. Each posture's `scale` is its size against architecture
4c's table; the sources and the emotions that do not reach the separation bar
are in the goal-3 evidence `g3/b/amplitude-sources.md`. Neutral writes nothing,
nor does any emotion term reach a group owned above 0.5. Think requests the
thinking hand, and sad, love and flustered the hand to chest, through
`plan.armForm` while their weight exceeds 0.5; angry and think force the
support. The layer's `modulation` exposes 4c's tempo, amplitude, tension and
breath depth for the generators, and `sighSeq` counts sighing onsets. The
posture's `tempo` and `amplitude` and the breath's `depth` and `sigh()` are the
hooks the performer feeds from that modulation; each is exact at its neutral
value.

`createCueLayer()` (`src/performance/cues.ts`, not yet registered) realises
Natural's cue gestures on the whole body, after architecture 4b. It plays the nod
(with a 1-degree lift first) and the shake (toward Natural's side, no
anticipation) on the head itself, at Natural's period and amplitude, and sets
`plan.suppressHeadCue` so `BodyPosture.suppressHeadCue` drops Natural's cue term
from the head accent; the performer must copy that flag each tick, or the head
nods twice. The shrug lifts both clavicles unequally with the far one 40 ms late,
the lean forces the support to the cue's side, and the glance plans the gaze 14
degrees to the side while the upper torso follows the head's turn through a
250 ms link. `CUE_SCALES` holds each cue's below-neck size as a multiple of 4b's
terms. Every term is additive and starts and ends at rest with zero slope;
owned groups receive none.

`createReactionLayer()` (`src/performance/reactions.ts`, not yet registered) adds
architecture 4d's touch reactions. A body poke flinches the mid torso, pelvis and
the poked side's shoulder and elbow away from the point (and bends the belly in
on a low poke) through a 3.5 Hz, 0.45-damped step released after 0.25 s, which
peaks at 0.16 s and rings once. A poke within Natural's 2 s dedupe window
flinches at 0.6. A head poke lifts both shoulders and lets the upper torso
follow 30 % of Natural's head pulse, 90 ms late. A pet drops the shoulders and
bends the trunk with its level, rolls the trunk toward the hand, pulls the
support to the hand's side above half level, eases the finger curl, and lets the
trunk follow Natural's stroke rock (0.35 upper, 0.18 mid). Arm terms yield to an
arm a gesture layer moves; owned groups receive none. Drag is not realised yet.

`gait.channels` is already mapped to this table: pelvis, hips and feet override
by gait weight, and torso/arm terms add. `armLift` is the existing hang solver's
per-side abduction addition, in radians. No gait or clip contract changes here.
Missing leg IK zeroes pelvis/foot channels and reduces weight rotations.
One spine bone receives all controls at reduced amplitude and collapses the
weight cascade to its longest torso delay. Missing clavicles/fingers/toe bend
drop those channels; missing twist limits pronation to 60 degrees. In this
slice, adapters keep pronation on the hand and upper-arm twist on the arm;
dedicated twist-bone writes belong to the later adapter work.

`createGestureLayers({ traits, seed })` returns the co-speech gesture layer as
two override layers, one per arm, sharing one planner (architecture 4a with
plan 3.1). Register both. A unit starts on every utterance, on the speaking
edge, outside a refractory of 2.5 s + 3 s x (1 - energy): the arm prepares to
4a's ready key, strokes on every onset that passes the gate's S2 voice-peak
rule (accepted emphases major, others 0.6), at least 0.45 s apart and at most
six per unit, holds with a 1.5 % A drift, and retracts to where it came from at
1.3 times its preparation while its weight ramps out. Energy scales size and
tempo. The forms are 4a's beat, palm-up, press, point, chop and frame at unit
A's amplitude scale (`GESTURE_FORMS`), keys solved per rig with
`solveArmKey` and pushed along the proxy gradient until key and path clear.
A stroke's wrist-placing channels (flex, abduct, twist, elbow) are fed forward
through their followers' inverse, so it lands at 4a's duration. The report marks a stroke at the apex the lead wrist actually shows
on the performer's output, so a marker's time is the motion's. The layers also
hold `plan.armForm` (hand to chest, thinking hand) at contact anchors; an arm
keeps whichever performance holds it, and speech uses the other hand. Any clip
claim on a performing arm takes it within 90 ms. Without speech or an arm form
the layers stay at weight 0 and the output is bit-identical to having none.
While a layer drives an arm channel, that channel keeps its own idle noise (a
moving hold) and its passive drag yields to the activation, as the plumb line
and pendulum already do; the drag returns as the activation falls.

Collision runs after dynamics and limits, using the same lower-half upper-arm
and extended-forearm sample capsules as the MMD gate, with its clearance margin.
Corrections persist and decay. When gradient steps leave more than half the
margin (0.015 of a segment), a continuous guard weight moves the arm toward
the guard pose: it follows the smallest clearing weight (16 samples, because
clearance need not be monotone among obstacles, then 10 bisection steps)
through a critically damped response at 14 rad/s, and never falls below the
weight that keeps the depth inside that budget. Until it catches up, proxy
depth up to the budget is allowed, so `penetration` can be positive by that
much. `capabilities.gestures` checks each
guard at load. `headClearance` additionally solves and clears a reachable
head-side anchor within joint limits; later acts still validate their own keys.
If the guard is blocked, that arm loses gesture capability and correction
returns toward its initial rest instead. Guard blending also resets twist,
so the checked endpoint and the applied endpoint are the same pose.
When no pose of an arm keeps the budget, that arm keeps its last valid arm,
hand and finger channels while the rest of the body moves on, and
`diagnostics.collisions` counts the tick with its side, remaining depth and
tick; the performer never throws for it. `diagnostics.corrector` counts the arm
ticks on which a fallback ran: `capHits` when the 6 degree step cap bounded a
projection step, and `guardScans` when the guard weight was searched because a
contact survived projection beyond the budget, or while the guard still eased
out of one. The counters observe the corrector and
never change a channel. Proxy clearance proves neither post-physics
clearance nor interpolation safety on an imported asset; the adapter unit owns
those rendered gates.

The three-bone weight curve divides the former mid-torso roll share between
mid and upper controls, preserving the total tilt while giving the upper
joint its own arrival. Small fixations below the recruitment threshold do not
start a head turn; slow pursuit beyond it recruits the head with a gentle
creep. These resolve the note's unspecified upper roll and its conflicting
small-shift creep/zero-head descriptions. All tuning remains private; tests
assert signs, ordering, bounds, clearance, replay and response shape.

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
