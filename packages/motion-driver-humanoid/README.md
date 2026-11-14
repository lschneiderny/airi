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
  collision corrector, and extensible `PerformanceLayer` contract. Its act
  layer plays the whole-body form of the idle behaviour Natural's idle layer
  started (`BodyPerformanceInput.idle`); it schedules nothing itself. A stance
  shift moves her weight fully onto one foot and, once the other carries 5 % of
  it (support 0.9), re-plants that foot: one `BodyFootStep` in
  `frame.footSteps`, 0.4 s, lifting 0.02 L and turning it 4 to 8 degrees
  toward and past its standing angle, so it stays within 8 degrees of it. The
  host's foot stage plays the step. A foot let go in the air lands before her
  weight goes back. A hand clasp (4e act 6) asks the gesture layer for the
  two-hand `clasp` at the front-low anchor, lets the hand away from Natural's
  side go first, and rocks the pelvis fore and aft by 0.012 L, two to four
  rocks below 0.35 Hz, with both feet turning onto their balls by the lean of
  the legs while it goes forward; a rig that cannot reach the anchor rocks with
  hanging hands. A heel raise (4e act 11) lifts the pelvis 0.012 L and turns
  both feet toe-down 14 degrees through their `FootPitch` channels, which the
  host's foot stage turns about each ball, two or three times. A hair tuck
  (4e act 8) asks the gesture layer for `hair-touch` from 0.1 s, the cupped
  fingertips at the side of the head at the tragion, then for `hair-sweep` from
  0.8 s, one ear breadth further back, which the arm reaches from the held touch
  without going home, and lets go 0.9 s before the end; the head tilts 4 degrees
  toward the hand. A
  stretch's elbows fold to bring each hand along the straight line from where
  it hangs to where it reaches (Morasso 1981), the far arm 120 ms behind, fed
  through the relaxed arm followers' inverse (`followerInverse` with `used` 0);
  an arm swing pushes at the relaxed upper-arm follower's period, and each
  hand flicks open (`open` for 0.15 s) at its arm's forward peaks (4e act 7).
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
restarting. Pass `home: true` when the target is where the body rests facing,
such as the viewer: a continuous error above 20 degrees then starts a turn after
the same dwell, and the turn takes equal steps of at most 22.5 degrees that end
on the target. `turnSteps` contains events emitted once at step start, alternating
left/right feet, each lasting 0.4 seconds with at most 22.5 degrees of signed yaw
(45 degrees per pair). The facing follows each step on a minimum-jerk profile,
so it starts and ends every step at rest. Event timestamps are elapsed seconds since controller
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
so 90 degrees takes two steps. The turn leaves and reaches its facing at rest: the first step eases in, the last eases
out, and the steps between are linear, so every step still ends on its facing and the yaw rate never steps. After arrival the gait closes the stance, turns to
`arriveFacing`, and returns to `idle` after both feet have been planted for 0.45
seconds. A walk starts with a 0.22 second preparation (architecture 5.4): the root holds while the phase carries the
weight onto the stance foot, the pelvis dips 0.008 L and the trunk draws back 1.5 degrees; the first foot lifts as it
ends. The trunk's lean follows an under-damped response (omega 5 rad/s, zeta 0.55), so it overshoots once as she stops,
and the pelvis dips 0.006 L over the settle.

No two strides are the same. `createLocomotion({ variability })` (default `youngAdultStrideVariability`) varies stride
time and stride length independently by healthy young adults' coefficients of variation, 1.8 % and 3.9 % (Beauchet et
al. 2005, J NeuroEng Rehabil 2:26, n = 49; independent draws reproduce their 4.3 % speed CV), through the package's
1/f source (`createDriftNoise`) stepped in strides with time constants of 1, 4 and 16 strides, because stride
fluctuations are long-range correlated, not white (Hausdorff et al. 1995 and 1996, J Appl Physiol; Terrier, Turner &
Schutz 2005, Hum Mov Sci 24:97). The study's CVs are each subject's SD over its 15 m of steady walking, about 11
strides; inside so short a window the slow terms barely move, so the process's own SD is the source CV divided by
0.6163, the expected 11-stride SD of the stride-averaged process (2.92 % and 6.33 %), and an 11-stride window of her walk
shows the source's 1.8 % and 3.9 %. The streams are `deriveSeed(seed, 0)` and `deriveSeed(seed, 1)`; the seed's own stream
still only breaks first-foot ties. A stride's time scales the step rate and its length the speed command, with the
cadence law evaluated at the unvaried speed so the two stay independent; the goal is still reached exactly. Pass
`{ strideTime: 0, strideLength: 0 }` for a periodic walk (the structural tests do).

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
`frame.body.lowerBodyYaw` turns the pelvis by `6 deg * strideScale` with the leading leg, and `frame.body.twist`
carries it up the spine as a counter-rotation (lower, mid and upper torso at -0.25, -0.55 and -0.35 of it, 0.03, 0.06
and 0.09 steps late) with a head counter of minus the torso's yaw 80 ms later, so the head stays near the travel
line (architecture 5.2). Each lag is a link of architecture 3a's lag chain, a critically damped response to the
segment below (`f = 1 / (pi lag)`), so the segments are not samples of one phase: each answers a change of stride, a
start or a stop with its own dynamics. `chestCounterYaw` keeps its old meaning for other readers.
`frame.armSwing` swings each arm from one cosine in antiphase with its leg: flexion `2 deg + s (16 deg forward -
12 deg back)` with `s = min(1.3, speed / v_ref)`, an elbow that follows the shoulder's swing 200 ms late (the human walk
reference's median elbow lag), the forward hand moving 3 degrees toward the midline (`abduct`), and the clavicle
protracting 3 degrees with the forward swing (`clavProt`) (architecture 5.3). The right arm swings 0.781 of the left (`s`
times 0.781 on every swing term), the mean left-dominant asymmetry of adults walking overground (directional arm swing
asymmetry index 21.9, Killeen et al. 2018, https://www.nature.com/articles/s41598-018-31151-9). The wrist and fingers
come from the performer's followers.
`frame.lookAhead` is the world yaw she is about to face: during a turn it sweeps from the facing the turn starts at to the
final facing as a minimum-jerk move over every step but the last, so it never steps and leads the body by one step;
otherwise it is the walk heading. `lookAhead - root.yaw` is the turn the gaze leads by, so a host can aim the gaze there
and let the head lead the turn (architecture 5.5).
With `traits.foot` (each foot's ankle height and heel and ball distances) every foot also carries
`roll` (architecture 5.1): it strikes on the heel at `14 deg * min(1, strideScale)`, is flat from 12 % of the stance,
rises onto the ball from 62 % to `-32 deg * min(1, strideScale)` at lift-off, and swings back through flat to the next
strike. `roll.ankleOffset` is the ankle's displacement from `target` as the foot rotates about `roll.pivot`, so that
point holds still; `target` keeps its meaning. Without `traits.foot`, and in turns, every roll is 0.
`ballRoll(foot, pitch)` is the same ball-pivot roll for a standing foot the gait does not carry, such as the
performer's heel raise: a host turns the foot toe-down about its ball by the performer's negative `FootPitch` channel.
`rebase` teleports the root, re-plants both feet at the bind ankle offsets, and
makes the next frame `idle`; use it for drag and teleports. The seed only breaks
first-foot ties.

`decideBody(input, memory)` from `./director` returns a `BodyIntent` and the
next memory. It realises Natural's long idle states (`input.idle`): it sits
when Natural has settled her in (after 120 s of idle, `IDLE_TO_SIT_MS`) and
sleeps when Natural sleeps, with the matching stance clip, or, when the slot is
empty, sets `BodyIntent.rest` to `rest` or `doze` for the performer's
clip-free rest layer. It refuses both while she must stand, and holds each
stance for at least 3 seconds (`STANCE_MIN_DWELL_MS`). It has no timer of its
own: with both `idle` flags false (no idle drive) she never sits or sleeps. The
clip-free rest takes its architecture 4f pelvis lateral gain of 1.25: the
pelvis goes a quarter further over the stance foot than the posture takes it.
A stance shift while she rests changes her legs: the act takes her full weight
to the leg she did not stand on, re-plants the foot she leaves, and the rest
layer keeps her on the new leg, so over a long rest she stands on each in turn. Her hands are clasped low in front (the two-hand
`clasp` at the front-low anchor) or hang, chosen per rest by the seed, one in
two; a rig that cannot reach the anchor keeps them hanging. The rest's
tension is 4f's 0.2 and the doze's 0.1 on 4c's K scale, read as an offset from
its neutral 0.40 (`followerK`, below), so her arms hang looser while she rests
and looser still while she dozes.

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
`bones.helpers`), `leftFingers`/`rightFingers`, `upperBody` (spine, chest, upper chest, and the bones listed under
`bones.helpers.upperBody`, which an adapter fills with the rig's whole spine chain so an unnamed trunk link
is grouped by its place on the chain), and `head`.
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
and head sphere. Only kinematic obstacles belong here. A body on a leg bone
keeps `hips` as its ancestor and names its `leg` segment (side, `thigh` or
`shin`). With `BodyRigTraits.legs` (the leg IK chains' hip, knee and ankle bind
joints) and a gait input that carries the feet (weight above 0, `ankles` set to
the ankle targets the leg IK reaches that tick), the corrector turns those
bodies with the leg as the MMD foot stage seeds its IK: the knee bends until hip
to ankle spans the target, the hip turns the leg onto it, both scaled by the
gait weight. Without the gait they stay with the hips, as at bind, so a still
body is corrected exactly as before. While the gait carries the body, every
proxy also has a soft skin outside its margin, one margin thick (0.03 of the
shorter arm segment) at gait weight 1 and thinner by the weight while the gait
blends in or out: an arm `x` deep in the skin of thickness `s` is pushed back by
`x^2 / 4s` up to `x = 2s` and by `x - s` beyond, before the hard projection
runs. The push starts with zero slope and never leaves the arm inside the
margin, so a thigh swinging into the hand, or a trunk the walk twists into the
upper arm, slows it over several ticks instead of stopping it in one. Without
the gait every proxy keeps the hard projection, which gesture paths are planned
to graze.

`BodyPerformanceInput.head.attitude` is Natural's posture alone, converted to
radians, and `head.terms` keeps the six other terms separate. `head.slow` is the
slow posture component. The adapter reads `controller.bodyIntent()`, resolves
the gaze goal and the viewer's direction (`viewerYaw`, the camera before
Natural's fixation deflects it), converts Natural units, and maps breath, voice,
mood, energy, latest event records, directive, clip ownership and root velocity. Inputs are
finite; amplitudes/rates are nonnegative, weights/tension/voice are [0,1],
valence/arousal and forced support are [-1,1]. Event times are active seconds.
Positive support names the RIGHT foot, so its pelvis displacement is negative X.
The performer follows `attitude`, `pet` and `held` through separate neck and
head responses, with the neck starting each turn and the head following, and
the speech- and cue-timed terms `emphasis`, `impulse`, `gesture` and `cue`
through one fast follower so an accent keeps its beat. In a gaze shift the neck
also follows the head plan through its own, faster response. Both responses
hold their direction in space while the facing changes, so feet that turn the
body under a head already on its target leave the head there; the gaze trunk
stays a share of the body. Underneath these,
the neck and head counter-rotate part of the trunk's world rotation from
posture and breath (0.5 of yaw, 0.6 of pitch and roll, 80 ms late), so the
head stays near level while the body sways; the trunk's share of Natural's head
yaw and the gaze trunk are intent and are not cancelled. The trunk carries 0.6
of that share while the gaze holds a target or travels and all of it for a free
gaze; a change of gaze kind moves the share through the same lag links as the
head yaw it scales, so the trunk never steps on it. At idle the head also
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
noise and its drag bypass the link. The wrist-placing joints (flex, abduct,
twist, elbow) take a layer's target past the link where the layer feeds them
forward (`LayerOutput.fed`, collected per channel as `PerformanceStack.fed`).
The gesture layer does so once an arm is prepared, easing in over 0.1 s, and
stops at the retraction; the preparation keeps the links and their order. The
link's state follows what it passes on, so it takes the joint back without a
step and filters the retraction and a clip's claim; with nothing fed its
arithmetic is unchanged.
Nonnegative channels use a C1 lower knee that preserves zero exactly; the
generic tanh lower knee would bend an otherwise neutral toe. Their upper knee
and all signed channel limits use the shared `softLimit` primitive.

The frame's `gaze` is the planned stance-frame direction, not the raw target.
Aim each eye from its rendered head transform toward that line and clamp to
the rig's eye limits; `eyes` is the canonical FK residual for diagnostics.
Large unreachable shifts saturate the eyes until head/body turning catches up.
`lidClose` is closure [0,1], whereas Natural's `blinkFactor` is openness:
the adapter combines `max(1 - blinkFactor, lidClose)`.
`createTurnPlanner().step({ targetYaw, facingYaw, allowTurn, home }, dt)` plans
the dwell, hysteresis, refractory and planted-step timing of body turns. While
the gaze is free the performer passes `viewerYaw` as a home target, so after a
far look the feet step back to face the viewer and a free glance never turns
them. Its frame and event array are borrowed until the next call.

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
hand, for the gesture layer to hold), `suppressHeadCue`, which hands the
head cue to the cue layer, and `suppressHeadEmphasis`, which hands the speech
emphasis nod to the gesture layers' head beat. A step may also return its `gesture`, `cue`,
`emotion` or `reaction` report; the frame's diagnostics carry the latest one
of each kind, and `diagnostics.gesture.activation` is the weight the stack
applied to each arm through gesture-order layers; `diagnostics.actActivation` is
the same for act-order layers (an idle behaviour's form, the clip-free rest). Hosts turn report sequence
changes into trace events. `HAND_SHAPES` holds architecture 4a's six hand
shapes as data; the emotion layer blends the open and fist shapes, and the
gesture layer shapes each stroke and arm form from them. Layers implement clip admission/cancellation
from `input.owned`; generators and followers keep integrating beneath clips.
The adapter applies `1 - owned[group]` exactly once at bone writes.

`createPerformanceLayers({ traits, seed })` (`src/performance/layers.ts`) returns
every layer below in one list, which the MMD body registers: the emotion layer,
the gesture pair, the cue layer and the reaction layer. Without speech, emotion,
cue, touch or arm-form input each stays at weight 0 and the output is
bit-identical to a performer with no layers. Each tick the performer copies
`plan.suppressHeadCue` and `plan.suppressHeadEmphasis` to the posture, and feeds the stack's `modulation` (the
emotion layer's tempo, amplitude and breath depth, blended by that layer's
weight) to the posture's `tempo` and `amplitude` and the breath's `depth`; each
sighing onset of a layer with weight calls `sigh()` once, and so does each new
`deepBreaths` count (the act layer's sigh and yawn, which take 4c's sigh
inhale). The stack runs after
the generators, so the modulation reaches them one tick (8 ms) later. The
layer's `tension` is not fed to a generator. A layer's `followerK` is 4c's K
for the arm followers, read as an offset from its neutral `NEUTRAL_K` (0.40):
the followers, and every layer that inverts them, take
`clamp(mood tension + (followerK - 0.40), 0, 1)` (`PerformanceContext.tension`),
so at the neutral K they read Natural's mood tension exactly. Only the
clip-free rest (0.2) and doze (0.1) set it.

`createEmotionLayer()` (`src/performance/emotions.ts`) is the additive emotion
posture layer of architecture 4c. Each emotion
in `BODY_EMOTIONS` adds a trunk, shoulder, elbow, pelvis and hand posture at the
weight `held.level x held.strength`, or at an unheld pulse's intensity, through
its own second-order response (so happy sinks before it lifts and surprise rings).
An unheld pulse holds its body pose as long as the held face of the same
episode: it rises with Natural's impulse attack, keeps its full intensity for
the band's `faceHold` (the face hint), and keeps the emotion's `heldShare` of it
for as long as the expression system holds a turnless episode's face
(stage-shared `held.turnlessSeconds`, `emotionHold`), then releases with the held
face's `held.releaseTau`. So the body holds the pose about 4 s, as the face does,
and a startle settles to its held share. A pulse of the same emotion during the
hold continues from the current pose; a pulse of another emotion releases the
earlier one from where it stands, as the held face switches. A slight pulse
moves no body. A held emotion releases with Natural's held `releaseTau`, so a
hold that switches emotion at full level crossfades instead of dropping the old
posture in one step. Each posture's `scale` is its size against architecture
4c's table; the sources and the emotions that do not reach the separation bar
are in the goal-3 evidence `g3/b/amplitude-sources.md`. Question (1.5 times its
sourced size) and surprised (1.6 times) are larger than that source, by the
owner's decision for expressive held poses; surprised keeps its held share, so
its startle settles as before. Neutral writes nothing,
nor does any emotion term reach a group owned above 0.5. Think requests the
thinking hand, and sad, love and flustered the hand to chest, through
`plan.armForm` while their weight exceeds 0.5; angry and think force the
support. The layer's `modulation` exposes 4c's tempo, amplitude, tension and
breath depth for the generators, and `sighSeq` counts sighing onsets. The
posture's `tempo` and `amplitude` and the breath's `depth` and `sigh()` are the
hooks the performer feeds from that modulation; each is exact at its neutral
value.

`createCueLayer()` (`src/performance/cues.ts`) realises
Natural's cue gestures on the whole body, after architecture 4b. It plays the nod
(with a 1-degree lift first) and the shake (toward Natural's side, no
anticipation) on the head itself, at Natural's period and amplitude, and sets
`plan.suppressHeadCue` so `BodyPosture.suppressHeadCue` drops Natural's cue term
from the head accent; the performer copies that flag each tick, so the head
nods once. The shrug lifts both clavicles unequally with the far one 40 ms late,
the lean forces the support to the cue's side, and the glance plans the gaze 14
degrees to the side while the upper torso follows the head's turn through a
250 ms link. `CUE_SCALES` holds each cue's below-neck size as a multiple of 4b's
terms; during a shake the upper torso turns against the head by 0.62 of the
head's shake, 90 ms late. Every term is additive and starts and ends at rest with zero slope;
owned groups receive none.

`createReactionLayer()` (`src/performance/reactions.ts`) adds
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
1.3 times its preparation; its weight ramps out once the arm is home, so the
hang, which the corrector may hold out of the body, takes a resting arm (an
emotion arm form's arm too). An arm form let go while it still moves (an idle
behaviour cut short) starts home from where its plan is, with the plan's
velocity and acceleration, and the followers receive the inverse of that whole
path, so the cut adds no step to their target (architecture 4e: an act's exit
can start from any tick). On the way, home is cleared
every tick against the body as it is posed then, by the corrector's own
projection (`BodyCollision.project`), because the trunk moves during a unit.
Only paths through the
ready key are cleared, so a retraction lets a stroke in flight land, and from a
stroke or hold first goes back to the ready key along the stroke over the
recovery time (an arm already recovering finishes its recovery), then home on
the preparation's path. Energy scales size and
tempo, and selects among forms: the default emphasis form is palm-up at 0.25,
press at 0.10 + 0.25 x the utterance's energy, and beat otherwise. The forms are 4a's beat, palm-up, press, point, chop and frame at unit
A's amplitude scale (`GESTURE_FORMS`), keys solved per rig with
`solveArmKey` and pushed along the proxy gradient until key and path clear;
a contact on the upper arm swings the elbow out by 5 degrees instead (up to
the arm forms' 80), since pushing the hand barely moves the upper arm off the
trunk, so a downward chop's elbow flares past the body's side instead of
leaving the chop unperformed.
A two-hand stroke's second hand plays the same stroke 40 to 70 ms later at
0.85 amplitude and holds as long as the lead hand, so both hands recover
together and every two-hand stroke of a unit keeps that lag.
A unit's preparation, recoveries and retraction legs carry an overlapping
corrective submovement 40 % of the time, as human arm movements do
(`CORRECTION`): in the plain transition's time, the primary aims 0.72 of the
way over 0.8 of it, and from 0.65 of it a second submovement carries on to the
key, ending when the plain transition would. The draw comes from its own
seeded stream (`deriveSeed(seed, 141)`), one per transition, and a two-hand
stroke's second hand takes the first hand's, so forms, hands, lags and holds
keep their draws. A transition whose submovements the followers could not
take in their share of the time stays plain. Strokes and emotion arm forms
keep one segment.
Every segment's wrist-placing channels (flex, abduct, twist, elbow) are fed
forward through their followers' inverse, so the arm moves along the path its
keys were cleared on, without its followers' lag or overshoot. A prepared
arm's joints take no cascade link, so a stroke lands at 4a's
duration, or later when the inverse would ask a follower for more than its
20 rad/s input slope: a segment then lasts the shortest time the followers can
take. The ready key is cleared along its path from the arm's
starting pose, as stroke keys are along theirs from the ready key, and it keeps
a headroom of 0.05 of each segment beyond the corrector's margin
(`KEY_HEADROOM`), because the arm settles and holds there; where no reachable
ready key clears that headroom, the one that clears the margin is used. A stroke is cleared
at its end, the post-stroke hold's 1.5 % A drift included, and its key lies
on that cleared path. Every other
channel of a segment also stays within that slope, so a large forearm, wrist or
finger turn arrives after the hit, and each new segment continues the planned
motion's velocity, never the inverse's. The report marks a stroke at the apex the lead wrist actually shows
on the performer's output, so a marker's time is the motion's. The layers also
hold `plan.armForm` (hand to chest, thinking hand) at contact anchors found as
architecture 6.3 says: a hand point marches in from 1 A in front of the seed to
the body's surface, and the key backs off from it while the elbow swings out,
until the pose and its path from rest clear the proxies (the pose with the ready
key's headroom) with every joint 2 degrees inside its limit; an arm
keeps whichever performance holds it, and speech uses the other hand.
The two-hand contact `clasp` (6.3's front-low anchor, the hips' midline pushed
forward; 4e act 6 and 4f's rest) is requested for `both` hands: it starts
only when both arms are free and both keys solve, each wrist half a hand
length to its own side of the anchor, and both arms travel for the longer
preparation so the hands meet together. A request for one side of a held
clasp lets the other hand go first. The anchor's height is "hands clasped
just below waist" on ANSUR II's women (Gordon et al. 2014, TR-15/007, female
means): the top of the hands at the waist (omphalion, 98.01 cm), the wrists one
hand breadth (7.82 cm) below it, over the trochanterion (84.54 cm), which
stands for the hip joint, the leg IK chains' `hip` joints; the lateral
malleolus (6.27 cm) stands for the ankle, so the hip-to-ankle span 78.27 cm
is the rig's `legLength`. The wrists sit (98.01 - 84.54 - 7.82) / 78.27 =
0.072 L above the hip joints (`FRONT_LOW_HEIGHT`); a rig without leg joints
does not clasp. A rig that cannot reach the anchor does not clasp, as 6.3
states: Vivian's arms reach it; on Chisa and Ellen no key at that height
clears their body proxies inside the limits, so their hands hang. The
proportional proxies of the fixture rigs reach it. A refused form is not
searched again.
The hair tuck's two keys (4e act 8) put the fingertips, not the wrist, on the
side of the head: the hand's end, a hand length from the wrist along the hand
as the wrist bends it, the palm toward the head (Moore 1985: "running her palm
along the surface of her hair"). The anchor is 6.3's temple seed, the head bone
pushed sideways and marched in, at the tragion's height; the sweep goes one ear
breadth back. ANSUR II's women give the sizes, scaled by the widest span of the
head proxies across the head bone against the head breadth (14.78 cm): the
tragion 12.65 cm under the top of the head, the ear 3.32 cm broad. Each key
tries the wrist a hand length from the fingertips in 600 directions, solves the
arm to it, and turns pronation and palmar flexion so the hand ends at the
fingertips; the first back-off step with a key clear of the proxies inside the
limits wins, the touch by limit margin and the sweep by the smallest joint
change from the touch. `capabilities.hairTouch` holds when both sides have head
clearance, 4e's precondition, and both arms reach both keys; without head
clearance the keys are not searched. On the real rigs all three arms reach
both keys; Chisa has head clearance and tucks, Ellen and Vivian do not.
Each lead stroke also nods the head (the speech head beat, MMD only): neck
and head pitch down together by 3 degrees for a major stroke (Graf et al. 2002,
about 3 to 5 degrees per accent nod), 0.6 of that for a minor stroke, 0.6 more
while walking and at a gaze that is not free, split 0.35 neck (30 ms first) and
0.65 head; it rises by minimum jerk over the stroke to its apex on the stroke's
landing and returns over 0.25 s, and a clip owning the head scales it by
`1 - 2 x owned.head`. While a unit runs the layers plan `suppressHeadEmphasis`,
so `BodyPosture` leaves Natural's emphasis term out of the head accent and the
head keeps one posture; outside a unit Natural's nod plays as before. The beat
is pitch only and added after the generators, so it sums with the gaze head
that is held in space while the feet turn. Any clip
claim on a performing arm takes it within 90 ms; a two-handed unit then goes
on one-handed with the arm it still has. Without speech or an arm form
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
