# @proj-airi/stage-ui-mmd

MMD (MikuMikuDance) scene components, composables, and stores for Project AIRI.

## What it does

Renders PMX/PMD models with VMD/VPD motion support inside AIRI's stage,
reaching feature parity with the Live2D and VRM renderers:

- **Model loading** for `.pmx`/`.pmd`, from a packaged ZIP (model + textures)
  or a bare model URL.
- **Physics** for hair, skirts, and custom rigs via Bullet (Ammo.js) — rigid
  bodies and 6-DOF spring joints, toggleable at runtime.
- **IK** (CCD solver) and **append-bone ("grant")** propagation for standard
  and custom rigs.
- **Importable, mappable motions**: import VMD clips (persisted to IndexedDB,
  synced across windows), set one as the looping idle, play any through the
  body director, remove them, and map AIRI emotions to clips (Neutral and
  Sleepy map to no clip).
- **Idle activities**: under Natural she stretches, yawns, looks around, watches
  the screen, sighs, rolls her shoulders, shifts her weight, clasps her hands,
  touches her hair, rocks on her heels, swings her arms and dozes on her own (`idleActivities` in the Natural settings,
  on by default), and plays the clips the user marked "Idle may use" now and
  then while her body is quiet. A model with a sleep clip sleeps through its
  stance; a model without one dozes on her feet (the performer's rest layer). The scene emits `idle`
  and `self` events, which the stage forwards to the situation. See
  [the idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md).
- **Clip library**: every imported clip gets a derived kind and layer, and the
  user gives it a label and an "AI may use" switch per model. Gestures layer
  over idle, sitting and walking; full-body actions and dances pre-empt the
  walk through the director. See [Clip library and actions](#clip-library-and-actions).
- **Stance slots**: assign imported motions to a model's `idle`, `sit` and
  `sleep` slots (`stanceSlots` in the `mmd` store). Natural settles her in
  after two minutes idle and sleeps while the user is away; the body director
  plays the sit or sleep clip for it with a 0.6 s eased cross-fade on the base
  layer, or rests or dozes her without a clip when the slot is empty. A sit or
  sleep clip never plays as the standing idle.
- **Stage locomotion** (desktop stage only, `stageWorld` set): the body director
  also walks her to the chat after it unfolds, chases the cursor after a poke,
  pet, drag or sent message, returns home 20 s after the last reason and, with
  `roamMode` (`settings/mmd/roam-mode`, `'stay' | 'roam'`, default `'stay'`),
  wanders. A due wander walks over to where the cursor rests in 60 % of cases
  (`visit`), and always while the user is active; she then stays 45 to 150 s
  before she strolls home. Goals wait while she speaks, and a goal held longer than 30 s is
  dropped. `director` in the diagnostics snapshot reports `reason` (the
  locomotion reason), `goalX`, `pace`, `pendingGoal` and the tool refractories;
  `stanceReason` is the stance's reason. The `requestGoal` command is the
  director's `debugGoal`. Without a stage world no goal is ever issued.
- **Morph-based lip-sync** driven by the shared wLipSync profile, mapping
  phonemes to the canonical あいうえお mouth morphs, with per-slot morph
  remapping for non-standard models.
- **Emotion expressions** via morph cross-fades.
- **Looking-at modes** (camera / cursor / disabled) with idle saccades, plus
  procedural blink.
- **Scene settings**: model transform, camera FOV, ambient + directional
  lights, albedo glow, render scale, physics gravity, and per-material opacity
  — all live, persisted, and synced across windows.

It builds on [`@moeru/three-mmd`](https://github.com/moeru-ai/three-mmd) for
PMX/PMD loading, VMD animation building, IK, append-bone propagation, toon
materials, outlines, and the shared runtime update order. Physics comes from
`@moeru/three-mmd-physics-ammo` and is loaded lazily, so the Ammo runtime is
initialized only after a live MMD model is mounted. That package bundles
`ammojs-typed`, which is Bullet compiled to WebAssembly and then translated to
plain JavaScript (wasm2js); it loads no WebAssembly module. One fixed physics
step costs about 10 ms of main-thread time for a full model.

## How to use

The package exposes the same scene contract as the other renderers, so it is
wired through `@proj-airi/stage-ui`'s `Stage.vue` automatically when the
selected model resolves to the `mmd` renderer:

```ts
import { MMDScene, useMMD } from '@proj-airi/stage-ui-mmd'
```

```vue
<MMDScene
  v-model:state="state"
  :audio-context="audioContext"
  :model-src="modelUrl"
  :cursor-position="cursorPosition"
  :current-audio-source="audioSource"
  :enable-orbit-controls="true"
  @error="onError"
/>
```

The component exposes `canvasElement()`, `captureFrame()`,
`setEmotion(name, intensity)`, `listMorphs()`, `listMotions()`, the clip
library surface `listActions()`, `action(label)` and `actionPort`, and, for
the desktop stage host, `setRootX(x, { teleport })` and `setDragging(on)`.

Runtime configuration (physics/IK/grant toggles, gaze tracking, scale,
morph overrides, emotion→motion mapping) lives in the `useMMD` Pinia store and
is edited through the model settings panel.

The architecture, its boundaries and its open follow-ups are recorded in
[the 3D character motion ADR](../../docs/ai/adr/2026-10-30-3d-character-motion.md).
Stage mode, locomotion, the arm rest layer and the split physics-reset rule
are recorded in
[the full-screen stage and locomotion ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).

### Model loading

Loads are latest-wins. Each load and dispose increments a load generation;
a model, physics initialization or motion registration that finishes for an
older generation is disposed and never acquires the scene or the expression
store. `disposeMMDObject` releases geometry, materials, their textures and
skeleton bone textures exactly once, including resources shared between parts.

`resolveFrameBounds` (`src/composables/mmd/camera-bounds.ts`) frames the
camera from the skeleton, so skirts and hair hanging below the feet do not
shrink the model. The bottom is the lowest ankle or toe bone, the top is the
higher of the mesh top and the 頭 bone plus 1.5 neck-to-head lengths, and the
width is the upper-arm span times 2.2. The whole mesh bounding box is used
only when 頭, 首 or both ankles are missing.

### Stage mode

`MMD.vue` accepts an optional `stageWorld` prop (`MMDStageWorld`: work area,
`CameraCalibration`, ground line and `homeX`, from `@proj-airi/stage-shared/stage-world`).
Without it every classic code path is unchanged. With it the scene builds an
off-axis camera from the calibration (`applyStageCamera`, using
`makePerspective`; never `updateProjectionMatrix`), skips framing and orbit
controls, ignores the classic scale, position and rotation settings, caps the
drawing buffer at one pixel per DIP (`stagePixelRatio`), and stands the root at
`(homeX, -footBaselineY, 0)` with one physics reset. The calibration needs the
model height, so the host reads it from the `stageModel` diagnostics field
after the load. `setRootX(x, { teleport })` writes the root x (`teleport: true`
resets physics once, `false` never does). `characterPlacement`, the projected
rect of the skeleton bounds in work-area DIP, is exposed on the scene,
published in the diagnostics snapshot and emitted as a `placement` event.
`body/attention.ts` resolves cursor and chat points onto the plane `0.6 * D`
in front of her and uses the calibration eye as the camera point.

`MMDStageWorld.row` is optional: a `StageRow` of every display she can walk to.
The host sets it only while it can move the stage window between displays.
With it, `rowInputs` gives the director every display's ground line as `reach`
and places the cursor and the chat by their screen positions, so they count on
whichever display they are on. A new calibration then means the window moved
to another display: the camera follows, and the root, the gait, and physics
stay as they are. In stage mode the scene also re-applies the pixel ratio when
the device pixel ratio changes, because displays can differ in backing scale.

### Frame pipeline and diagnostics

`./composables/mmd/motion-trace` exports `createMMDMotionTraceSampler(mmd, rig, pose)`.
It returns `{ recorder, stage, rig, inputs }`. Give `rig` a model key and asset
hash, pass it in `recorder.start(header)`, and place `stage` last in the surface
stages to read final bones after physics. `MMD.vue` registers it last, after
`morphs`. It never writes bones or changes motion, and returns immediately
while idle.

Set `inputs.channels` to the voice, speaking, trace-axis world target, locomotion
mode and gait weight used for that frame. Omitted scalars become NaN. Set
`inputs.wall` in seconds for a headless clock; null selects `performance.now()`.
Motion time is the sum of pipeline dt, rebased with wall time to frame zero.
The sampler derives bind rotations and offsets from the skeleton inverse bind
matrices, folds helper bones into canonical humanoid parents, excludes physics
bones, and duplicates the both-eyes fallback into both eye columns.
Root positions divide out the mesh's uniform world scale each frame so they use
the same model units as bind offsets and leg length.

The headless composition also imports `MMDBody` from `./composables/mmd/body`,
`MMDNaturalAdapter` from `./composables/mmd/natural/adapter`,
`MMDStanceDirector` from `./composables/mmd/stance`, and `composeMMDStages`
from `./composables/mmd/stage-composition`.

For Node composition, import `MMDFramePipeline` from
`./composables/mmd/frame-pipeline`, `MMDFrameMetrics` from
`./composables/mmd/frame-metrics`, `readMMDRigProfile` from
`./composables/mmd/rig`, `MMDBodyPose` from `./composables/mmd/body/pose`,
and `bodyGazePoints` and `resolveBodyTarget` from
`./composables/mmd/body/attention`. `LAYER_FADE_SECONDS` and `stepLayerFade`
from `./composables/mmd/layer-fade` are the smoothstep clip-layer fade that
`playLayer` uses; the headless motion runner drives its claim clip with them.
These direct entry points avoid the browser audio runtime exported by the
general `./composables/mmd` barrel.

`MMDFramePipeline` owns a clean, pre-solver pose for each model. It restores
that pose before queued playback commands and mixer sampling, then captures
the clip pose before registered pose stages, IK, grants, and physics. Surface
stages apply expressions, blink, and lip-sync after physics. User edits of the
model transform and animation loops request a physics reset. In stage mode the
rule is split: per-frame root motion from the `locomotion` stage and a drag
(`setRootX` with `teleport: false`) never reset physics, so hair and skirts
feel the travel, and a teleport resets it once. During a measurement,
`measurement.physicsResets` counts the resets that callers requested
(`requestPhysicsReset`, for example a stage teleport); loop wraps are not
counted.

The pipeline clamps a frame's time to 1/20 s and lets physics catch up by at
most two of Ammo's fixed 1/65 s steps per frame
(`MMD_PHYSICS_MAX_STEPS_PER_FRAME`). A 60 Hz frame takes one or two steps (1.08
on average), so the cap applies only to frames later than about 30.8 ms. It
drops the simulated time beyond two steps instead of carrying it into later
frames. One Ammo step costs about 10 ms of main-thread time for a full model,
so an uncapped catch-up after one late frame made the next frames late as well.
Pose stages keep the full clamped time; only the physics clock slows on those
late frames.

The scene registers these pose stages in order: `natural`, `locomotion`,
`body-torso`, `foot-contact`, `body-head`, `body-arms`, `eyes`, `classic-gaze`,
`classic-face`, `lip-sync` and `bone-morphs`. Its surface stages are
`body-diagnostics`, `morphs` and `motion-trace`.
The Natural and body stages run only for the Natural driver; the classic
stages run only for Classic. Every stage is timed under its id.

The order has one owner: `composeMMDStages({ body, host })`
(`./composables/mmd/stage-composition`) returns both lists from
`MMD_POSE_STAGE_IDS` and `MMD_SURFACE_STAGE_IDS`, taking the six body stages
from `MMDBody` and the rest from `host`. A host that does not run a stage
leaves it out, and the stage keeps its id and slot and does nothing. `MMD.vue`
registers the result, the headless runner of `@proj-airi/qa-tools` composes
from it, and `qa:stage capture` refuses with `stage-composition-mismatch` when
the scene reports any other list.

Classic gaze is a pose stage: it composes head and eye aim with the clean
clip rotation before solvers and physics, rather than replacing VMD rotation
with a rest-relative gaze override.

`useMMD().motionDriver` persists at `settings/mmd/motion-driver` and defaults
to `natural`. Natural seeds its shared controller with FNV-1a over the model
id's UTF-16 code units. Its pose stage advances Natural and prepares the face
channels; it writes no bone. The body performer (below) reads Natural's state
through `bodyFrame.intent` (`controller.bodyIntent()`) and poses the whole body.
Face and blink use separate morph-runtime layers; the face shows the larger of
Natural's blink closure and the performer's lid closure (`body.lidClose`).
Classic retains its gaze, blink and emotion composables. Switching drivers
clears procedural morph channels and starts a fresh Natural controller.

The adapter accepts performance, voice, chat, head-width cursor coordinates,
screen inwardness and touch inputs. `Stage.vue` passes the resolved
`performance` state, Natural energy, expression performance settings, screen
placement, chat target and activity, mouth level and speaking state, and routes
the stage performance conductor to this scene when the MMD renderer is active
(`selectStagePerformanceRenderer` in `@proj-airi/stage-ui`). The MMD Natural
driver is the conductor's `natural` driver and Classic is `universal`. The
exposed `setEmotion`, `applyHolds`, `applySlots`, `onSpeech`, `setMuted`,
`getMood` and `action` methods form the `StagePerformanceScene` surface.
`action(label, gesture?)` receives an ACT `action` label (under Natural and
Classic alike) and runs `resolveActAction`
(`src/composables/mmd/actions/resolve-act-action.ts`) against
`labeledClips(modelKey)`: the label is compared exactly with the labels the user
curated and is never used as a clip name. An exposed gesture is queued for the
director with `source: 'act'`; a label no clip carries counts `unknown`, a
hidden clip `notExposed`, and an exposed action or dance `notGesture` (those
play only through `perform_action`). When the label plays, the ACT's cue
`gesture` counts `superseded`. Diagnostics publish
the rig profile and Natural event count, requested energy and the head bone's
local yaw in radians.

### Body layers

`MMDBody` (`src/composables/mmd/body/`) owns the `locomotion`, `body-torso`,
`foot-contact`, `body-head`, `body-arms` and `eyes` pose stages for one model.
Under the Natural driver the whole body is posed by the pure performer of
`@proj-airi/motion-driver-humanoid/performance`, seeded with FNV-1a over the
model key; no stage maps Natural's head and body channels onto bones in fixed
shares. The adapter has four parts:

- `MMDBodyClock` (`body/clock.ts`): one 120 Hz clock. For each tick the
  `locomotion` stage steps the gait, then the performer with that tick's gait
  frame (`writeGaitChannels` maps it onto `BODY_CHANNELS`). Display-rate inputs
  are blended linearly across the ticks of a frame, and the stages show the two
  latest ticks blended by the leftover fraction, so a seed moves the same at
  any frame rate.
- `buildBodyRigTraits` (`body/rig-traits.ts`): the rig's bind positions, spine
  chain, arm segments, feet and the kinematic arm-test and head bodies, each
  re-expressed in its nearest canonical ancestor's frame. A rig without hips,
  a spine, neck, head, two full arms or a leg length gets no performer.
- `MMDBodyIntent` (`body/intent.ts`): maps `NaturalBodyIntent`, the gaze goal,
  the director's stance, the gait and clip ownership into
  `BodyPerformanceInput`. Natural head terms are 30 degrees per unit. The gaze
  goal follows Natural's gaze target (`intent.gaze.on`), first match wins: the
  facing still to come while walking or turning (the gait's `lookAhead`, so the
  head leads a turn and runs along the travel line on a straight walk); the cursor point, as a sustained goal, while
  Natural fixates the cursor; the chat point while Natural looks at the chat;
  otherwise the camera direction deflected by Natural's free fixation at 20
  degrees per unit, as a free goal. The host passes the cursor, chat and
  camera points through `bodyGazePoints`; in camera mode the camera stands in
  for the cursor. Without points the free fixation is taken around the facing.
  The undeflected camera direction (the facing without points) is passed as
  `viewerYaw`, where the feet return while the gaze is free.
- `MMDBodyPerformer` (`body/performer.ts`): writes the blended channels to
  bones from `context.clean`. `body-torso` writes the pelvis offset, the hips
  and the spine chain, spreading the three torso controls with
  `spineWeights` so the chain's total rotation is the same on one to four
  bones. `body-head` applies facing to the center bone, then neck and head.
  `body-arms` writes clavicles, arms, hands and fingers; it carries the
  canonical straight-down arm onto the bind arm, so the posed segments sit
  where the performer's own forward kinematics (and its arm collision
  corrector) put them. Pronation is written on the hand and twist on the
  upper arm; twist helper bones are not written. Missing and physics-owned
  bones are skipped. `eyes` aims both eyes from their rendered parents at the
  far end of the performer's gaze line.

When the performer finds no clear arm pose against the supplied bodies, that
arm keeps its previous valid pose while the torso, head, eyes and legs move on;
`performance.collision` counts it with the latest side, depth and tick, and the
first one is logged. Body blinks and planned gaze shifts reach `body.onEvent`, and both the
scene recorder and the headless runner pass them to the sampler's `bodyEvent`,
which records them as trace `marker` events labelled `blink` and
`gaze-shift:<amplitude>:<signed yaw>:<goal kind>` (degrees, the yaw positive toward
the character's left), stamped with the time of the frame that raised them.
The performer also turns the core's layer reports into markers:
`gesture-stroke:<form>:<left|right|both>:<unitSeq>` on the tick that reaches the
stroke's planned hit, `gesture-unit:start` and `gesture-unit:end`,
`cue:<kind>:<seq>`, `emotion-posture:<emotion>:<onset|release>` and
`reaction:<kind>`, and `act:<id>:<playing|finished|cancelled>` when the frame's act
feedback changes its sequence or state and `rest:<none|rest|doze>` when the rest
directive changes (neither is raised from the initial state, so no act or rest
marker appears without a producer). Every bone write also records the
largest angle between the written local rotation and the clean pose per written
group (`performance.writeDeviationRad`), measured on the bone, so a fully owned
group can be checked against the clip it should leave untouched.

Ducking follows clip ownership (below), not raw clip weights, and is applied
once per written group as `clean * slerp(I, delta, 1 - owned)`. Looping stance
clips duck the body fully but keep half of the head and neck gaze
(`STANCE_HEAD_ATTENTION`). The pelvis offset ducks by
`max(stance weight, owned root, owned lowerBody)`, the hips by
`max(stance, lowerBody)`, the spine by `max(stance, upperBody)`, head and neck
by the head ownership of non-stance clips plus half the stance weight, arms and
fingers by their own groups, and foot contact by the larger non-stance
ownership of `root`, either leg IK or `lowerBody`. An arm or finger gesture
therefore keeps breath, sway and planted feet, even during a walk. Stance clips
reduce contact only through their foot-IK tracks. Diagnostics publish `feet`
(`maxError`, `errorL`, `errorR`, `contact`), `lookAt` (`target`, `yaw`,
`pitch`, `turning`, `turns`) and `performance` while Natural drives the model.
The `setDebugFlag` command disables foot contact, or keeps head, neck and eyes
at the clip pose (`disableLookAt`), for QA.

Foot contact keeps mesh-local ankle anchors and writes leg IK targets, IK-bone
yaw and knee pre-bend before the IK solver; it measures ankle error after IK
and physics. It also plays the performer's turn steps.

The `body-arms` stage runs after `body-head` and before eyes. It poses the
finger bones the rig has (`fingerBones`, read through
`HUMANOID_FINGER_CANDIDATES`: thumbs `親指０/１/２` map to Metacarpal, Proximal
and Distal; a leading `０` is the metacarpal of the other fingers, which is not
written), curling the thumb about `thumbAxis`. The gait's arm swing arrives in
the performer's channels. A clip owns the arm and finger bones
it keys: `registerClip` builds a `ClipBoneMask` once and `body.ownership()`
returns `min(1, sum(weight * mask))` per group (`root`, `leftLegIk`,
`rightLegIk`, `lowerBody`, `leftArm`, `rightArm`, `leftFingers`, `rightFingers`,
`upperBody`, `head`). The performer's arms are written with weight `1 - owned`, and the
gait is enabled only while no clip owns `root` or a leg IK bone. A clip the body
never saw owns every group. `registerClip(name, clip, { forceGroups })` adds
groups the mask did not key, so a full-body action or dance that animates only
the upper body still stops the gait. `body.performing()` returns the clip the
animation manager reports on its layer (`MMDBodyInput.layerClip`) and its
captured weight, or `null` once that weight is 0. Diagnostics publish `arms` (`weight`, `owned`, `penetration`, `clothContact`,
`hangDeg`, `handBelowHip`, `headPenetration` and `correctionDeg`). `penetration` per side is the gate and must be 0: the overlap, in model units, of the
arm capsules (radius 0.12 of the segment, the hand reaching 0.65 of the forearm beyond the wrist) with the KINEMATIC
rigid bodies, those that follow a bone (torso, hips, legs, kinematic skirt roots). `clothContact` per side is
information only: the centerline overlap with DYNAMIC (physics) bodies such as skirt plates, belts and wings, which the
simulation resolves. The test skips the first half of the upper arm, because the shoulder joint sits inside the chest
bodies by construction. It ignores collision masks, because a rig's own torso, hip and leg bodies turn off collision
with their group, and skips only a body wider than 0.65 of the shoulder span (a coat shell such as Chisa's radius-2
body). While both arms are free, no gesture layer moves either arm, and the gait is idle, a rig whose kinematic overlap persists for 5 frames after the
60-frame warm-up, at the default 78 degree hang gets a
per-rig hang: the arm is lifted away from the body in 2 degree steps, down to 60, until the overlap is 0 (the hang is the
angle below horizontal, so a larger one swings the arm into the hips). The lift reaches the performer as `armLift`, added
to its rest abduction; the default hang restates that abduction (12 degrees from vertical). The performer's own
collision corrector already keeps the arms clear of the same bodies, so the solver acts only where its model and the
rendered pose differ. `buildBodyRigTraits` gives the corrector the leg IK chains' joints and tags each body on a leg bone,
or on a deform (D) bone that copies a leg bone's whole rotation through an append transform, with its thigh or shin;
while the gait carries the feet the body passes the same ankle targets the foot stage reaches (`meshAnkleTarget`), so
the corrector sees the thighs swing instead of holding them where they hang at bind. `hangDeg` reports the value in effect. `headPenetration` measures the same capsules against the
kinematic head and neck bodies, and `correctionDeg` is the performer's arm collision correction in effect.
`setDebugFlag` with `{ flag: 'armRestHangDeg', value }` (0-90, `null` restores the default) overrides the hang for QA
and switches the solver off. The desktop stage measures its placement rect from the REST-POSED hands and fingertips
(`body.restPositions`, passed as `reachBones` of `resolveFrameBounds`) plus `ARM_SWING_REACH` of each one's
distance from the shoulder for the walking swing, so her hands stay inside the click-through rect without widening it to
the bind A-pose.

Pose stages read `context.clean` and write absolute transforms from that
snapshot; they must not modify the snapshot itself. `clipFootIK` records
which registered motions contain left/right foot IK position tracks.

The `mmd-motion-diagnostics` store publishes `{ type: 'snapshot', snapshot }`
at 10 Hz on `airi-stores-stage-ui-mmd-motion-diagnostics` while a scene runs,
including `loadedModelKey: null` when the scene has no model. Commands use
`{ type: 'command', name, value }` on the same channel. `startMeasurement`
and `stopMeasurement` capture every frame interval and stage duration, separate
from the 600-sample rolling FPS and timing readouts. `setDebugFlag`,
`advanceDirectorClock`, and `setOverlay` carry transient controls for the
body, director, and overlay consumers. `setPerformanceLayer` with
`{ layer, enabled }` turns one performance layer of the body performer on or
off for tuning; the stack eases it in or out. The body registers
`createPerformanceLayers`, so `performance.layers` lists `emotion`, `act`,
`gesture-left`, `gesture-right`, `cue` and `reaction`. The act layer plays
Natural's idle behaviour (`bodyIntent().idle`, mapped by `MMDBodyIntent`). Windows that never publish mirror the
latest stage snapshot they receive, so the devtools lab reads the stage's
state from the same store. Overlay toggles also travel as the Eventa event
`mmdOverlaySetEvent` on the same channel, and the snapshot's `overlays` field
reports the flags the stage draws, so a lab opened after a toggle starts with
the stage's state; the scene adds the IK helper,
touch-collider wireframes, foot anchors, and look-at marker
(`src/composables/mmd/overlays.ts`) to its scene only while each flag is on
and disposes them when it turns off. The stage-mode overlays `floorLine`
(`y = 0` across the work area at `z = 0`), `groundLine` (`ground.minX` to
`ground.maxX`), `home` (a marker at `homeX`) and `goal` (a marker at the
director's `goalX`, labelled with the locomotion reason) read the stage world
every frame and stay hidden in classic mode; `armCapsules` draws the two
capsules per side that the arm penetration test sweeps (`mmdArmCapsules`).

#### Snapshot fields

The snapshot and command field names are a QA contract (`AGENTS.md`): the
stage gates read them, so fields are only ever appended. Every field is
published at 10 Hz by the scene (`MMD.vue`); `null` means the source is not
running (no model, the Classic driver, or the classic window).

| Field | Meaning |
| --- | --- |
| `loadedModelKey`, `driver` | The mounted model key (`null` without a model) and `natural` or `classic`. |
| `fps { last, mean60s }`, `timings { <stage>: { lastMs, p95Ms } }` | Rolling frame rate and per-stage timings over the last 600 samples. |
| `measurement` | The explicit measurement window: `state`, `durationMs`, `frames`, `fps`, `readbackMs { meanMs, maxMs }` (the host's alpha readback cost, `reportReadback`) and `physicsResets` (resets callers requested through `requestPhysicsReset`; loop wraps are not counted). While the window runs, each stage's `p95Ms` covers its last 600 frames; once it stops, `p95Ms` covers the whole window. `meanMs` and `maxMs` always cover the whole window. |
| `rig` | The `MMDRigProfile` of the loaded model. Its `spineChain`, `toeBend`, `twist` and `structure` fields are appended to the diagnostics snapshot, and `capabilities { gestures, headClearance }` is the performer's load-time result per side (`null` without a performer). |
| `natural { events, energy, headYaw }` | Natural event count, requested energy and the head bone's local yaw in radians as `body-head` wrote it. |
| `feet { maxError, errorL, errorR, contact }` | Ankle error after IK and physics in model units, and the foot-contact weight. |
| `lookAt { target, yaw, pitch, turning, turns }` | The world-space sustained gaze point (the cursor or chat point while Natural looks at it, otherwise `null`), the head bone's local yaw and the neck plus head pitch channels in radians, whether the performer's turn planner is turning the center bone, and the turn count. |
| `director` | The body director (below). |
| `touch { lastRegion, hitBody, petActive, headScreenPoint, events }` | The touch classifier state; `headScreenPoint` is in canvas client pixels. |
| `animation { idle, currentAction, actionsStarted, layer }` | The looping base clip, the one-shot in progress, the one-shot count and the layered clip (`{ seq, name, state }` or null). |
| `action { performing, lastActionSeq, refusal, retryAfterMs, drops }` | The action layer: the clip the director accepted (`{ name, layer, phase, seq }` or null), the last request it read, the last refusal (`refractory`, `busy`, `asleep`, `dragging`) with its retry time, and the ACT drop counters (`unknown`, `notExposed`, `notGesture`, `superseded`). |
| `clips [{ name, kind, layer, loop, label, exposed, downgraded, notes }]` | The imported clips of the loaded model with the effective kind and layer; `downgraded` marks a gesture override that forced a full-body clip onto the upper layer, and `notes` are the derivation notes (`no-animated-bones`, `bad-duration`, and so on). |
| `characterPlacement { x, y, width, height }` | Stage mode: the character's projected rect in work-area DIP with the root at its current x. |
| `stageModel { height, footBaselineY }` | Stage mode: the measured model height and foot baseline in model units, which the host calibrates the camera from. |
| `world { unitsPerDip, floorRowDip, ground { minX, maxX }, homeX, characterHeightDip, originX, reach }` | Stage mode: the calibration the world was built from. `unitsPerDip` converts work-area DIP to model units on the floor line, `floorRowDip` is the floor line's row, `ground` the reachable root x range, `homeX` the resting root x and `characterHeightDip` the configured height (`stageModel.height / unitsPerDip`). `originX` is the world x of the work area's left edge; it changes when the stage window has moved to another display. `reach` lists every display's ground line while she can walk between displays, and is `null` otherwise. |
| `locomotion { mode, position { x, z }, yaw, goalX, reason, pace, speed, phase, weight, skate, leashClamps, enabled, skateContact, skateContactPeak }` | The gait in world units: `mode` (`idle`, `turning`, `walking`, `stopping`), the root position and yaw, the body's goal and its reason and pace, the speed and gait phase, the gait weight, `skate` (the largest per-frame horizontal world movement of a planted ankle; 0 when the feet stay planted), `leashClamps` (ticks on which the reach leash shortened root travel) and `enabled` (false while a clip owns the root or a leg IK bone). `skateContact` (appended) is `skate` measured at each planted foot's contact point: the ankle while the foot is flat (then it equals `skate` bit for bit), or the rig's heel or ball point when the foot stage's `measure(pivot)` names that kind: the ball is the toe bone (つま先), the heel lies under the ankle at the toe bone's height, both read from the bind skeleton (a rig without a toe bone reads the ankle). Only the pivot kind is the performer's report: the body passes each foot's gait roll pivot (`LocomotionFoot.roll`) while the gait weight is above 0, and the foot stage rolls the foot about the same heel and ball points (`MMDFootContact.rollGeometry`, on rigs with toe bones and toe IK bones). `qa:stage gate` judges it when present (owner decision O6), and `qa:stage measure` records it. `skateContactPeak` (appended) is the largest per-frame `skateContact` since the previous diagnostics snapshot (model units per frame): the scene resets it after each 10 Hz snapshot it publishes, so the stage measure sees a one-frame slide between snapshots. |
| `arms { weight, owned, penetration { left, right }, clothContact { left, right }, hangDeg, handBelowHip, headPenetration { left, right }, correctionDeg { left, right } }` | The arm measurement: `weight` is one minus the larger arm ownership, `owned` the clip ownership per group (`leftArm`, `rightArm`, `leftFingers`, `rightFingers`, 0-1), `penetration` the deepest arm capsule-radius overlap of a kinematic body per side in model units (the gate: 0), `clothContact` the deepest centerline overlap of a dynamic cloth body (information only), `hangDeg` the rest hang in effect, `handBelowHip` whether both hands sit below the hips bone, `headPenetration` the same overlap with the kinematic head and neck bodies, and `correctionDeg` the performer's arm collision correction in degrees. |
| `overlays` | The `MMDOverlayFlags` the stage draws. |
| `ownership` | The body's clip ownership per mask group (`root`, `leftLegIk`, `rightLegIk`, `lowerBody`, `leftArm`, `rightArm`, `leftFingers`, `rightFingers`, `upperBody`, `head`; 0-1) while the Natural driver runs. |
| `trace { state, frames, bones, seconds, refused }` | Scene recorder state (`idle`, `recording`, `stopped`), sample and bone counts, motion duration, and named refusal; null without a recorder or refusal. |
| `performance { tick, layers, support, shift { target, dwellS }, breath { speechLift, inhales }, gaze { kind, shiftDeg, eyeDeg, headDeg, trunkDeg, shifts, blinks }, correctionDeg { left, right }, collision { count, last }, corrector { capHits, guardScans }, writeDeviationRad { hips, torso, head, leftArm, rightArm, leftFingers, rightFingers }, gestureActivation { left, right }, arms { deg { left, right }, restDeg { left, right } } }` | The body performer while Natural drives the model: 120 Hz ticks since its reset, each performance layer as 1 on or 0 off, the weight support (+1 on the right foot), the scheduled support target and remaining dwell, the speech chest lift and phrase inhale count, the gaze goal kind with the last planned shift, eye, head and trunk angles in degrees and the shift and body-blink counts, the arm collision correction in degrees, the corrector's cap-hit and guard-scan arm ticks, this frame's largest write deviation from the clean pose per written group in radians, the gesture-layer weight applied to each arm, the nine displayed arm angles per side with their rest values in degrees, and the count of ticks on which an arm kept its previous pose for want of a clear one, with the last one (`side`, `depth`, `tick`). |

The `director` block carries `MMDStanceDiagnostics` plus `clockOffsetMs` (the
`advanceDirectorClock` total) and `centerY` (the センター bone's Y in model
units): `stance`, `sinceMs` (director-clock time at which the stance began; it
moves only on a stance change), `nowMs` (director-clock time of the last frame
the director decided; it advances every frame), `stanceReason` (why the stance
holds: `idle-timeout`, `away`, `rest-fallback`, `doze-fallback`, `dwell`,
`no-sleep-slot`, `idle`, `no-sit-slot` or `active`), `reason` (the locomotion reason: `approach-chat`,
`approach-cursor`, `return-home`, `wander`, `tool`, `debug`, `enter-stage` or
`stay`),
`goalX`, `pace`, `pendingGoal { x, reason }` (a goal held while she speaks),
`nextWanderAtMs` (`null` outside roam mode), `moveRefractoryUntilMs` and
`lookRefractoryUntilMs` (director-clock times until which `come_here` and
`go_home`, or `look_at`, are refused), `lastToolSeq`, `toolRefused` (whether the
last tool request was refused) and `toolRetryAfterMs` (how long the refused
request must wait, `null` when it was accepted).

#### Commands

| Command | Value | Effect |
| --- | --- | --- |
| `startMeasurement`, `stopMeasurement` | none | Open and close the measurement window. |
| `setDebugFlag` | `{ flag: 'disableFootContact' \| 'disableLookAt', on }` or `{ flag: 'armRestHangDeg', value }` | Disables a body stage for QA, or overrides the rest hang in degrees below horizontal (0-90; `null` restores the default and the per-rig solver). |
| `advanceDirectorClock` | milliseconds | Adds to the director's clock only; Natural and physics keep real time. |
| `setOverlay` | `Partial<MMDOverlayFlags>` | Turns overlays on or off (the lab uses `mmdOverlaySetEvent`). |
| `requestGoal` | `{ x, pace: 'stroll' \| 'walk' }` | The director's `debugGoal`: walks her to `x` on the ground line, clamped to `ground`. Any other pace is rejected with one warning. |
| `setHome` | `{ x }` | Moves the resting root x the director returns to. |
| `setRoamMode` | `{ mode: 'stay' \| 'roam' }` | Writes `roamMode` (`settings/mmd/roam-mode`) from the lab. |
| `playClip` | `{ name, loop? }` | Queues the clip on the director as a `debug` request. The asleep, dragging, refractory and busy rules apply; `loop: true` skips only the gesture repeat cooldown. `loop` unset keeps the clip's curated or derived loop. An empty or non-string name is rejected with one warning. |
| `stopClip` | none | Stops the running performance (a `debug` stop request). |
| `startTrace` | `{ scenario: { id, class, seed }, maxSeconds }` | Replaces stopped data and records final bones, up to 130 s. Refuses with `measurement-running`, `trace-recording`, `no-mmd-model` or `invalid-trace-request`. |
| `markTrace` | `MotionTraceEvent` | Adds a labelled event on the trace clock; malformed events report `invalid-trace-event`. |
| `stopTrace` | none | Stops sampling and sorts events; repeated stops are inert. |
| `drainTrace` | `{ requestId, from, count }` | Replies with `{ type: 'trace', requestId, header?, rot, root, channels, events? }`; header and events appear only at `from: 0`. Maximum chunk: 600 frames. Refuses with `trace-not-stopped`, `invalid-trace-range` or `no-mmd-model`. |

Trace replies stay inside the existing temporary raw diagnostics protocol.
The scene drops recorder buffers on model unload. Changing the driver stops
the trace. Frame measurements cannot start during recording. Natural's
additive `onEvent(listener)` returns an unsubscribe function and leaves its
existing event counter and seeded output intact. Impulse, hold, gesture and
touch events, gait events and director goal changes use the trace clock.

A malformed command is ignored with one `console.warn` per store; later valid
commands are still applied.

### Clip library and actions

At import, `syncMotions` in `MMD.vue` builds the clip's bone mask
(`buildMMDClipMask`), derives its meta with `deriveClipMeta` from
`@proj-airi/motion-driver-humanoid/clip-meta` (kind `gesture`, `action`,
`dance`, `stance` or `unusable`; layer `upper`, `full` or `none`), publishes it
as `availableClipMeta`, and registers the clip with the animation manager and
the body. Action and dance clips are registered with `forceGroups` `root`,
`leftLegIk` and `rightLegIk`, so they stop the gait even when their mask keys
only the upper body. A clip that is removed and imported again under the same
name is derived and registered again without a model reload
(`composables/mmd/motion-registrations.ts`).

The `useMMD` store keeps the user's curation per model in `clipCuration`
(`settings/mmd/clip-curation`: `label`, `kind` override, `loop` override and
`aiMayUse`, which defaults to off). `setCuration` refuses a label that fails
`CLIP_LABEL_PATTERN` or that another clip of the model already uses.
`labeledClips(modelKey)` lists every clip with a label and a gesture, action or
dance kind, and `exposedActions(modelKey)` the exposed ones. `removeMotion`
drops the clip's curation and meta. Derived data is never persisted as user
state; the scene recomputes it on load.

Every one-shot goes through one entry, `requestPerform`, which turns a clip
name into a `BodyActionRequest` for the director: the emotion map (`source:
'act'`), ACT `action` labels (`'act'`), `perform_action` (`'tool'`, through
`MMDActionPort`), and the Motion Lab and settings play buttons (`'debug'`).
The director accepts or refuses it, and the scene obeys `intent.action`: it
calls `animation.playLayer` when the request reaches `playing` and
`stopLayer` when the intent clears, and feeds the layer events back as
`actionFeedback`. An exposed action is never chosen as a standing base.

`playLayer` (`composables/mmd/animation-manager.ts`) plays a second layer
without replacing the base. Each usable clip is registered with `#upper` and
`#lower` partitions (`rig/clip-split.ts`). An `upper` layer plays the clip's
upper partition and splits the running base by the bones that partition keys:
those base tracks ease out, every other base track keeps full weight, and the
base recombines when the layer ends (in 0.25 s, out 0.3 s). A `full` layer
eases the whole clip in over 0.4 s, or 0.6 s for a dance. Dances never loop,
because the frame pipeline resets physics on every mixer loop; `playLayer`
ignores `loop` for a dance and reports `loop-ignored`.

`MMDActionPort` (`composables/mmd/action-port.ts`) answers `perform_action`. It
submits the request and settles when the director's `lastActionSeq` reaches
it: success, or the refusal text for `refractory` (with `retryAfterSeconds`),
`busy`, `asleep` or `dragging`. The scene observes it every frame in both host
modes, so the tool works in the classic window. The design is recorded in
[the clip actions ADR](../../docs/ai/adr/2026-11-03-mmd-clip-actions.md).

### Touch

While Natural drives the model, the scene turns canvas pointer input into pokes
and pets (`src/composables/mmd/touch/`). Pointer rays hit the model's PMX rigid
bodies as analytic shapes (sphere radius, box half-extents, capsule radius and
cylinder height along Y), posed from bone matrices through a body-to-bone offset
stored at load; the Ammo world is never read. Bodies under 頭/首 are `head`, and
bodies under 上半身/上半身2/上半身3/下半身 are `body`. A model without usable rigid
bodies falls back to a skinned mesh raycast and the hit face's heaviest bone.
`NaturalTouchGestures` from `@proj-airi/motion-driver-natural/touch-gestures`,
the classifier Live2D uses, turns the samples into pokes and pets. They feed
`NaturalMotion`, so the response is pre-physics head and body motion.
The `touch` (default on) and `touchPetRequiresHold` (default off) Natural
settings match the Live2D settings, and the scene emits `touch` events like `Live2DScene`. `Stage.vue`
routes them to the stage touch store, so a pet or poke doses mood, reaches the
situation, and can start a reaction turn as on Live2D. The scene also plays ACT
cue gestures (`gesture`) and takes mood doses (`addMood`), and
the `emotionStrength` Natural setting holds per-model emotion strengths in the
Live2D shape. The Natural settings are one synced settings document, held by
`useMMDNaturalSettings` (`src/stores/natural-settings.ts`) and stored as
`settings/mmd/natural`: every window reads `document`, and the leader-routed
`update` and `reset` are the only writers. A profile saved before the document
kept one `settings/mmd/natural-*` key per setting; the store starts from those
keys while no document is stored, and the first `update` or `reset` writes the
document and deletes them. Diagnostics
publish `touch` with `lastRegion`, `hitBody`, `petActive`, `events`, and
`headScreenPoint` in canvas client pixels.

### Rig profile

For motion layers, `readMMDRigProfile(mmd.pmx)` (exported from
`@proj-airi/stage-ui-mmd/composables/mmd`) maps the PMX skeleton to the canonical
humanoid bones of `@proj-airi/motion-driver-humanoid` and reports leg IK chains,
the knee bend sign, leg length, foot baseline, eye bone source, physics-owned
bones and the waist-cancel flag. `toRigTraits(profile)` converts it to the
renderer-neutral `RigTraits`. Pose stages must not write physics-owned bones.

Each humanoid bone takes the first name candidate in `bone-map.ts` that exists
and is not physics-owned. `upperChest` (`上半身3`) must also lie after the
`chest` bone (`上半身2`) on `spineChain`, because the upper chest is the child of
the chest. Carlotta and Chisa parent `上半身2` to `上半身3`, so their
`上半身3` is a middle chain link like Ellen's and Vivian's `上半身1`, and
`upperChest` is missing on all four. The trace and the QA reports then measure
the neck and shoulders against `上半身2`, their true parent. Trunk motion reads
`spineChain`, not these names, and so do clip masks: `mmdClipMaskBones` lists
every `spineChain` link as `upperBody`, so a clip track on a middle link such
as `上半身1` or `上半身3` plays on the upper layer and owns the upper body.

The profile also reports structural facts for body adapters:

- `spineChain` contains `{ name, position }` entries in root-to-tip hierarchy
  order on the path from `上半身` to the neck, excluding the neck and
  physics-owned links. Positions are copied mesh-local, post-parse bind positions.
  Ellen and Vivian have `上半身`, `上半身1`, `上半身2`; Carlotta has
  `上半身`, `上半身3`, `上半身2`. Missing endpoints or a disconnected or
  cyclic path yield an empty chain.
- `toeBend.left/right` resolves the posable `左足先EX`/`右足先EX` deform
  controls, or `null`. The `つま先` bones remain toe positions and IK targets;
  their presence alone does not establish toe bend.
- `twist.left/right.arm/wrist` contains the posable main `腕捩`/`手捩`
  controls as `{ name, fixedAxis }`, or `null`. `fixedAxis` copies the parser's
  optional PMX `axisLimit` vector without normalizing it; absent axes are `null`.
  This only describes the controls and does not pose them.
- `structure` reports posable bone classes: `intermediateSpine` means a chain
  link beyond the mapped `spine` and `chest`; `shoulders`, `fingers` and `toes`
  have per-side booleans. Fingers means at least one mapped finger joint, and
  toes means a toe position or bend control. `eyes.left/right` reports separate
  eyes; `eyes.shared` reports a posable shared fallback only when neither
  separate eye is posable. These flags exclude mode 1 and 2 physics ownership
  and describe skeleton availability only.

The new fields are detached plain data. They do not change existing mappings,
clip ownership, eye-source selection or motion, and make no reach or clearance
claim.

### PMX morph runtime

`createMMDMorphRuntime` from `@proj-airi/stage-ui-mmd/composables/mmd`
provides the scene's runtime for group, vertex, bone, material and UV morphs.
The scene prepares procedural channels in pose stages, composes bone morphs
after the procedural pose and before physics, then applies surfaces after
physics. Classic expression, blink and lip-sync controllers write their own
layers instead of overwriting mesh influences.

Channels are persistent named weights. `setChannel(layer, name, weight)`
replaces that layer's value; `clearChannel(layer, name)` releases ownership.
An explicitly set clip channel can own a zero weight; an inactive zero mesh
influence does not mask Natural face output.
Optional channel alpha blends over lower layers; additive contributions sum
after layer composition. Priority is devtools, lipSync, blink, expression,
clip, naturalFace, from highest to lowest.

Before `applyBoneStage(cleanPose)`, supply fresh clip influences on the mesh
and a clean array of `{ position, quaternion }` in skeleton order.
Run the bone stage before physics, then `applySurfaceStage()` after physics.
Group vertex children stay baked into the group's position target; the runtime
expands only bone, material and base-UV children. Nested groups, Flip, Impulse
and additional-UV morphs are unsupported and reported once per model.

`setComposition({ speakEnv, exprEyeClosure })` supplies normalized speech and
eye-closure envelopes. Without an explicit speech envelope, a lip-sync channel
owns its target at full alpha. Standard vowel names identify lip-sync targets; PMX
Lip/Eye categories identify other mouth and eye morphs.
`setMaterialOpacityOverrides(overrides)` composes user opacity after the fresh
material morph state. Removing an override exposes the live morph value.
Opacity composition runs every frame, including on unmorphed materials.
`resetToBase()` clears channels and overrides and restores bind bones,
descriptor material values, base UVs and zero vertex influences.

### Expression catalog and store

`deriveMMDCatalog(morphs)` builds one `CatalogEntry` per PMX morph, with
the id `mmd:<morph index>:<name>`. Vowels and the blink and wink morphs are
`system`, material and UV morphs are `effect`, and every other morph is `face`.
The PMX panel sets the area: hidden for panel 0, eyes for the eyebrow and eye
panels, mouth for the mouth panel. Emotion mappings come from Japanese and
English name tokens. A repeated name keeps its own entry as a `duplicateOf`
alias of its first morph. A blank-named morph keeps its raw name for the
channel, gets the label `Morph <index>`, and defaults to a hidden `system`
entry the LLM cannot pick.

`useMMDExpressionStore` (Pinia id `mmd-expressions`) has the same settings API
as the Live2D expression store: `modelId`, `settingsSnapshot` (a
renderer-neutral `ExpressionPanelSnapshot`) and `applySettingsCommand`. It
satisfies `StageExpressionBackend`. Curation and rest sets persist under
`expression-catalog:${modelId}` and `expression-rest:${modelId}`, in the Live2D
document shape. `registerMorphs(modelId, runtime.morphs, runtime)` binds a
loaded model. `applySlots`, `onSpeech` and `activate` take explicit times in
seconds, and `update(now)` must run once per frame: it expires leases, advances
the fades and writes the morph-runtime `expression` layer. A finished release
clears its channel instead of holding a zero weight. The store ignores an
unknown expression id and warns once per model. The derived catalog and the
curated document are replaced whole, never edited in place, so `catalog`
entries are plain data: reading them on a lease change tracks no entry fields.

### Settings, expression panel, and Motion Lab

The MMD model settings expose the motion driver, Natural energy
(the `energy` Natural setting), the touch toggles and the per-model stance
slots (`settings/mmd/stance-slots`). Below the motion import list, a curation
table shows one row per clip with its derived kind and layer badge (plus
`downgraded` and `unusable` badges), a label input with an inline duplicate
error, a kind select, a loop toggle and the "AI may use" switch; its label
drafts are kept per model. The expression section is the shared
expression panel from `@proj-airi/stage-ui`, fed by `useMMDExpressionStore`;
MMD publishes no free parameters, so custom switches do not appear. In the
Electron app, Settings > System > Developer > MMD Motion Lab
(`/devtools/mmd-motion`) reads the diagnostics store from the main window's
stage and toggles its overlays. Its World card shows the `world` calibration,
`stageModel` and `characterPlacement`; its Locomotion card shows the
`locomotion` fields with the director's `reason`, `pace`, `goalX` and
`pendingGoal`, posts `requestGoal` ("Walk here", a DIP offset from the
root along the floor line), `setHome` and `setRoamMode`; its Arms card shows
the `arms` fields; its Clips card lists `clips` with a Play button per row
(`playClip`, disabled with the derivation notes as its title for an `unusable`
clip) and a Stop button on the performing row (`stopClip`), reads out `action`
and `animation.layer`, and draws the `ownership` groups as a bar row; the
Director card keeps `stanceReason`.

### Checks

```bash
pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node
pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser
pnpm -F @proj-airi/stage-ui-mmd typecheck
```

Pure motion math belongs in `@proj-airi/motion-driver-humanoid` or
`@proj-airi/motion-driver-natural` and is tested there in Node.

## When to use it

- Displaying MMD/MikuMikuDance characters (`.pmx`/`.pmd`) on the AIRI stage.
- When you need physics-driven secondary motion, IK, and VMD playback.

## When not to use it

- For VRM avatars use `@proj-airi/stage-ui-three`; for Live2D use
  `@proj-airi/stage-ui-live2d`; for Spine use `@proj-airi/stage-ui-spine`.
- In environments without WebGL support.
