# Whole-body performer for MMD characters

Date: 2026-11-11
Status: accepted

## Context

Before this change the MMD body mapped Natural's two-dimensional head and body channels onto bones in fixed shares. The
`weight-shift` stage rewrote spine and chest at 0.6 and 0.4 of one signal, the `look-at` stage rewrote neck and head at
0.4 and 0.6, and `arm-rest` held a mirrored, constant rest pose with one torso-roll spring. Two bones driven by one
signal reach every extreme on the same frame, so the chain read as one rigid segment with a hinge. Weight shift was a
symmetric ease plus three sinusoids, look-at had no eye lead, no amplitude dependence and no overshoot, and the arms
never moved on their own. The Natural adapter also wrote neck, head, spine and chest, but the body stages overwrote those
writes from the clean pose on the same frame, so they never reached the screen.

The goal of the work is a character whose whole body performs: weight starts in the pelvis and climbs, gaze starts in
the eyes and travels down, the arms hang with their own dynamics and stay out of the body. Live2D had to stay
byte-identical, and the four millisecond frame budget of the AIRI stages had to hold.

## Decision

Natural stays the mind and the body performs. Natural (`packages/motion-driver-natural`) gained only a read-only
`bodyIntent()` accessor: head attitude and its terms, breath phase, voice, mood, energy, held emotion, the latest
impulse, gesture, cue, poke and react records, and gaze events. A pure performer in
`@proj-airi/motion-driver-humanoid/performance` turns that intent into 77 canonical channels on a fixed 120 Hz tick,
from a seed: posture and weight shift with anticipation and settle, aperiodic sway, breath through torso, clavicles and
arms, gaze with eye lead, amplitude-scaled head recruitment and blink coupling, arm rest dynamics, and an arm collision
corrector that clears the arms against the rig's kinematic bodies before a frame leaves the core. It imports no
renderer.

The MMD adapter (`packages/stage-ui-mmd/src/composables/mmd/body/`) owns everything rig-specific:

- One 120 Hz clock steps the gait and then the performer for each tick, blending display-rate inputs across the ticks
  of a frame and showing the two latest ticks blended by the leftover fraction.
- `buildBodyRigTraits` copies the rig's bind geometry, spine chain (one to four bones), arm segments, feet and its
  kinematic torso and head bodies into the performer's plain-data traits, each body in its canonical ancestor's frame.
- `MMDBodyIntent` maps `bodyIntent()`, the gaze goal, the director's stance, the gait and clip ownership into the
  performer's input.
- The gaze goal follows Natural's gaze target, as architecture section 3e specifies: the cursor point only while
  `intent.gaze.on` is `cursor`, the chat point only while it is `chat`, otherwise the camera direction deflected by
  Natural's free fixation as a free goal. The director's attention point no longer holds the body's gaze; it stays the
  diagnostic and trace target. The forced attention row of 3e is absent until `BodyIntent.attention` carries a forced
  flag.
- `MMDBodyPerformer` writes channels to bones from the clean pose, applying clip ownership once per group, carrying the
  canonical straight-down arm onto the bind arm so the rendered segments equal the performer's own kinematics, and
  skipping missing and physics-owned bones.

The pose stages became `natural`, `locomotion`, `body-torso`, `foot-contact`, `body-head`, `body-arms`, `eyes`, then
the unchanged Classic, lip-sync and bone-morph stages. `composeMMDStages` is the one owner of that order: the scene
registers it, the headless runner composes from it, and `qa:stage capture` refuses a scene whose stage list differs
(`stage-composition-mismatch`), so a headless trace is evidence about the real app. An arm without a clear pose keeps
its previous valid pose while the rest of the body moves on, and is counted in diagnostics; a headless run with any
such tick exits 1. The `weight-shift` and `rest-pose` modules and the
look-at joint springs were deleted in the same slice; the turn planner and `aimEyes` stay.

## Alternatives considered

| | A. Filter the channels | B. Natural as intent, pure body performer (chosen) | C. Simulated body |
| --- | --- | --- | --- |
| Idea | Keep the 2D channel mapping; add per-bone lag filters, noise and an arm overlay in the adapter. | Natural keeps timing, attention and affect; a pure performer synthesises the 3D pose from that intent. | Drive joints with PD controllers inside Ammo and let physics produce overlap. |
| Why not | Arms cannot gesture, because a head pulse carries no gesture identity; weight cannot lead, because the body channel is a lagged copy of the head; lags stack on Natural's own lag. | - | Not deterministic per seed, cannot guarantee zero arm penetration or the frame budget, and depends on Ammo internals the package forbids. |

B costs a larger tuning surface and a pure-core copy of the arm collision test. Per-layer switches
(`setPerformanceLayer`, one switch per registered layer id) and tuning one layer at a time answer the first; the corrector uses the gate's own capsules and
clearance ratio, and the rendered `stage-arm-penetration` gate still measures the real pose after physics.

## Consequences

- MMD motion under the Natural driver changed on purpose, so the headless idle trace differs from the goal-1 baseline.
  From here on the motion is judged with the frozen gate, not with trace equality. Live2D is unchanged: Natural only
  gained an accessor.
- A rig needs hips, a spine, neck, head, two full arms and a measurable leg for the performer. Without them the body
  keeps foot contact and eye aim only.
- The gait's lateral pelvis offset is now applied toward the support foot, as the gait's own reach model assumes; the
  legacy stage applied it with the opposite sign.
- Body blinks and gaze shifts are recorded as trace `marker` events (`blink`, `gaze-shift:<amplitude>:<signed yaw>:<goal kind>`) until the trace
  reader accepts them as their own kinds.
- The per-rig hang solver remains and feeds the performer's `armLift`, but the performer's own corrector already clears
  the same bodies, so the solver acts only where the corrector's model and the rendered pose differ.
- Act layers, twist-bone writes, foot roll and the rest states are later slices.

## Amendment 2026-11-11: performance layers registered

The MMD body now registers `createPerformanceLayers({ traits, seed })` from the performer package, with the body's own
seed: the emotion posture layer, the co-speech gesture pair (one override layer per arm), the cue gesture layer and the
touch reaction layer, in stack order emotion, gesture, cue, reaction. `setPerformanceLayer` switches them by id.

- With no speech, emotion, cue, touch, arm-form or clip input every layer stays at weight 0, and the headless idle and
  gaze-shift traces are byte-identical to the traces before registration. Everything else under the Natural driver
  changes on purpose and is judged by the goal-3 criterion reports.
- The performer feeds the layers' hooks each tick: `plan.suppressHeadCue` to the posture, so the cue layer's head nod
  or shake replaces Natural's head cue term instead of adding to it, and the emotion layer's modulation (tempo, sway
  amplitude, breath depth, sighs) to the posture and breath, one tick after the stack produced it. The modulation's
  tension feeds no generator; the arm followers keep Natural's mood tension.
- An arm keeps whichever performance already holds it: a speech unit takes the other hand while an emotion form holds
  one, and a requested form waits for the unit's retraction, so no performance cuts a moving arm.
- The per-rig hang solver holds its lift while a gesture layer moves either arm, so the pose a gesture retracts to
  does not move under it. It also holds while an act-order layer (an idle behaviour's form or the clip-free rest) has
  weight on either arm (`diagnostics.actActivation`): a lift learnt from an arm that a clasp brings to the belly held
  her arms out for the rest of the session.
- Not built and not registered: the shrug hand shape and its energy key, finger rub noise, the drag reaction and the
  huff and shimmy reactions.

## Amendment 2026-11-14: the walk varies from stride to stride

The gait's strides are no longer equal (owner decision 18: variation only from new seeded streams, sized and structured
from published human gait, no white jitter).

- Stride time and stride length drift independently on two new streams of the gait seed (`deriveSeed(seed, 0)` and
  `deriveSeed(seed, 1)`) through the package's 1/f source stepped in strides, so neighbouring strides are alike and the
  walk drifts slowly. The seed's own stream still only breaks first-foot ties, and every performer stream is unchanged,
  so scenarios without a walk keep byte-identical traces.
- The size is Beauchet et al. 2005's young adults, stride time CV 1.8 % and stride length CV 3.9 %, read as the study
  read them: each subject's SD over 15 m of steady walking, about 11 strides. The process's own SD is therefore the
  source CV divided by 0.6163, its expected SD over 11 strides; the first version set the process's SD to the source
  CV, which showed about 0.62 of it in any 11-stride window.
