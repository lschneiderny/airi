# Natural walk refit: stride, stance, swing and turns measured against walking adults

Date: 2026-11-23
Status: accepted for the code on the branch `luke/feat/natural-walk`; the look is not accepted. Luke has not reviewed it, and no rendered-app walk has been run. The [3D character roadmap](../context/3d-character-roadmap.md) tracks what is open.

## Context

Luke judged the MMD walk and its turns robotic. The body-motion gate failed the walk only on its arm and trunk lines, and the `walk-form` report passed it. An agent review of stills had called the leg cycle believable.

Measured on the headless `walk` scenario against motion capture of walking adults (Bandai Namco Research Motiondataset 2, CC BY-NC 4.0: 78 walk clips and 190 quarter-turn walk clips of the styles normal, feminine and youthful), in leg lengths L (thigh plus shank):

| Measure | Walking adults | Product before |
| --- | --- | --- |
| Arm against the leg of its own side | opposite (r -0.82 to -0.87) | together (r +0.36) |
| Step length and step rate | 0.79 to 0.88 L at 1.83 to 1.92 steps/s, at 1.4 to 1.6 L/s | 0.51 L at 1.74 steps/s, at 0.89 L/s |
| Knee flexion at heel strike | 4 to 10 degrees | 27 to 30 degrees |
| Largest hip-to-ankle distance in stance | 0.996 to 0.999 L | 0.973 L |
| Pelvis rise and fall per step | 0.046 L | 0.065 L, and 0.11 L at the longer stride |
| Ankle speed in the swing | rises at once, peaks at 2.6 to 2.8 times the walking speed late in the swing | near rest for a third of the swing, then 4.8 times |
| Ankle height in the swing | highest (0.16 L) a third in, low over the last quarter | about 0.08 L throughout |
| Pelvis speed within a step | 0.78 to 1.3 times its mean | constant |
| Quarter turn | made over three steps at 0.69 or more of the walking speed, 1.4 s for its middle 80 %, peak 83 deg/s, head ahead by up to 39 degrees | on the spot in exactly 0.90 s at 133 deg/s, then a stop, then a start |

Four causes were found in the code:

1. **Arm phase.** The gait timed each arm against the trunk, and the performer then passed the swing through the relaxed arm followers. Those sit near resonance at the stride rate and lag a third to half of a stride, so each arm came forward with its own leg. The gate's `gait.armSwingLagMs` takes the absolute correlation, so it passed.
2. **Stance geometry.** The gait's reach model took each hip to sit above its bind ankle and centred the stance on the root. On the measured rig the ankles stand 0.10 L behind the root and the hips 0.076 L ahead of the ankles. The feet landed 0.10 L too far forward, and the pelvis sank to cover a reach the legs did not need. The adapter's foot-contact planner applied a second, coarser reach limit on top.
3. **Stride.** The cadence law's walk ratio (step length over step rate) was 0.28 L s; walking adults keep about 0.43 to 0.46.
4. **Turns.** A walk that needed a new heading turned on the spot, stopped, and then started.

## Decision

1. **The gait's arm swing reaches the arm followers through their inverse** (`GAIT_ARM_CHANNELS` in `performance/index.ts`), as a gesture's planned motion does. The followed arm keeps the gait's timing, and the forearm, wrist and fingers still trail it. The trunk's counter-rotation and the arm drive run 0.3 step ahead of the pelvis twist, which puts the shoulders' and the arms' turning points where walking adults have them in the stride. The swing is sized to the capture: the upper arm goes 19.5 degrees forward and 15.5 back, the elbow bends 34 degrees more at the front and is straight at the back, and the hand travels 0.37 L fore and aft (0.30 before; walking adults 0.42 to 0.50). The gait gives the arm a floor on its hang, 16 degrees out from the chest's vertical at the back of the swing and 20 at the front, which the performer applies only as far as the arm's own rest hang is narrower. A rig whose rest hang is already wider keeps it: the per-rig hang solver sets that from the rig's body colliders.
2. **The gait takes the bind hip joints** (`GaitTraits.bindHips`) and places the stance from them, not from the bind pose. A full stride's stance is centred 0.14 of the step behind the hips, as walking adults land the foot 0.46 of a step ahead of the hip; a foot set down beside a stopped root stands on the bind ankle line. The step is 0.55 of the hip joints' spacing wide. The bob is sized from the true hips, the heel-strike and heel-off roll, and the pelvis's fore-aft swing. The reach limits are 0.988 L planned and 0.993 L hard (`GAIT_REACH_SHARE`); beyond that the rig's leg IK misses its target. While the gait drives the feet, the foot-contact planner checks the rolled ankles against the gait's own limit (`FootContactInput.reach`).
3. **The reference step is 0.625 L at 1.44 steps/s.** The speed stays 0.9 L/s, a stage decision this ADR does not reopen. The sidestep keeps its own pair size (0.5 L) and rate law.
4. **The swing** starts at the rolled ankle at 0.45 of its mean speed, peaks at two thirds, lifts the ankle highest (0.13 L at a full stride) at 0.29 of the swing, and hangs the foot toe-down until 45 %. The heel rises from 72 % of the stance, ever faster until lift-off. Heel strike is 20 degrees and toe-off 28. A foot rolls by the reach it landed with and by how far it stands behind the ankle line.
5. **The pelvis** lists 4.5 degrees 0.3 step ahead of its sway, and its forward speed swings by 0.2 of the walking speed, fastest 0.2 step after a heel strike. The trunk nods 1.2 degrees per step.
6. **A walk turns while it steps.** A start that must turn up to 100 degrees opens with the foot on the side it turns to and turns over 2.4 steps. A wider turn first turns the excess on the spot and the walk takes the last 90 degrees over. From the first braking tick the body turns to the arrival facing over 2.6 steps. Each foot lands turned toward where the body faces a step later, at most 42 degrees from her facing. The gaze reaches the final facing at 0.65 of the turn, and the trunk leans into it. A start's acceleration rises with the speed from a quarter of the limit.
7. **`walk-form` version 5** adds `arm-opposition`, `knee-at-strike` and `turns-under-way`, each with its bar and source printed. The walk before this ADR fails all three.

## Consequences

- On the headless `walk` scenario of the reference rig: knee flexion at heel strike 16 degrees, largest stance leg extension 0.99 L, bob 0.046 L, step 0.64 L at 1.40 steps/s, arm against its own leg r -0.81, every turn under way at its middle. `pops` passes and the contact skate passes.
- The same walk ran on 13 rigs of 8.1 to 10.8 model units of leg, with flat shoes, heels, stilettos and bare feet (seed 1). On all of them `pops` reads 0, the skate passes, the knee at heel strike reads 15 to 18 degrees and every turn is under way. The bob reads 0.046 to 0.050 L on eleven and the step width 0.14 to 0.16 L on all. Before the stance was placed from the hips, the bob ran from 0.046 to 0.10 L with how far a rig's bind ankles stand behind its hips, and the step width from 0.11 to 0.21 L with its bind stance.
- Two rigs still bob 0.08 to 0.09 L: one in stilettos and one with short robot feet. Their toe sits under the ankle, so the heel-off roll does not raise the ankle and the trailing leg must reach. A shorter stride for such feet is not built.
- On one rig the arms never move, walking or standing: its arm starts inside a body collider and the corrector holds it. This predates the refit.
- The arm is held 18 to 21 degrees out on average where walking adults hold it 12 to 15, because the rigs' body colliders are wider than a body. Narrower floors brought `pops` back. With these, `pops` reads 0 on most runs and one velocity step of 35 degrees per second on some, at a start; the corrector's contact is not smooth, and that is the cause to fix.
- Still failing: the gate's `bilateral.*`, `dim.*` and `chain.chest-neck` lines (one signal still drives both arms and the trunk); `walk-form` `roll-every-step` on the first step of a start, which lands at 3 to 5 degrees on nine of the 13 rigs against a bar of 5.48; `scenario-turn-around` reads NOT-EXERCISED, because a reversal is now an arrival turn to the viewer followed by a start, never one turn of 135 degrees.
- A walk is under way sooner: the fixture of `director/press.test.ts` travels 0.25 L in the first second of a chase where it travelled none.
- The capture holds no standing start or stop, so the start, the stop and the turn from rest rest on the quarter-turn clips and on judgment, not on a measured reference.
- A rig without foot roll geometry gets a deeper bob, since its trailing foot cannot rise onto its ball. No such rig was among the 13.
