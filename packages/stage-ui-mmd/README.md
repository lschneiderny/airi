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
  synced across windows), set one as the looping idle, preview any as a
  one-shot, remove them, and map AIRI emotions to gesture motions.
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
`@moeru/three-mmd-physics-ammo` and is loaded lazily, so the Ammo WASM runtime
is initialized only after a live MMD model is mounted.

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
`setEmotion(name, intensity)`, `listMorphs()`, and `listMotions()`.

Runtime configuration (physics/IK/grant toggles, gaze tracking, scale,
morph overrides, emotion→motion mapping) lives in the `useMMD` Pinia store and
is edited through the model settings panel.

### Frame pipeline and diagnostics

`MMDFramePipeline` owns a clean, pre-solver pose for each model. It restores
that pose before queued playback commands and mixer sampling, then captures
the clip pose before registered pose stages, IK, grants, and physics. Surface
stages apply expressions, blink, and lip-sync after physics. Model transforms
and animation loops request a physics reset.

Classic gaze is a pose stage: it composes head and eye aim with the clean
clip rotation before solvers and physics, rather than replacing VMD rotation
with a rest-relative gaze override.

`useMMD().motionDriver` persists at `settings/mmd/motion-driver` and defaults
to `natural`. Natural seeds its shared controller with FNV-1a over the model
id's UTF-16 code units. Its pose stage splits head motion between neck (40%)
and head (60%) over a 30-degree span, and body motion between spine and chest
over a 10-degree span. Writes are absolute from the clean clip pose and skip
physics-owned bones. Face and blink use separate morph-runtime layers.
Classic retains its gaze, blink and emotion composables. Switching drivers
clears procedural morph channels and starts a fresh Natural controller.

The adapter accepts performance, voice, chat, head-width cursor coordinates,
screen inwardness and touch inputs. Stage performance wiring is supplied by
the host; the scene currently derives idle/talking, voice level and projected
cursor inputs. Diagnostics publish the rig profile and Natural event count,
requested energy and the head bone's local yaw in radians.

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
body, director, and overlay consumers.

### Touch

While Natural drives the model, the scene turns canvas pointer input into pokes
and pets (`src/composables/mmd/touch/`). Pointer rays hit the model's PMX rigid
bodies as analytic shapes (sphere radius, box half-extents, capsule radius and
cylinder height along Y), posed from bone matrices through a body-to-bone offset
stored at load; the Ammo world is never read. Bodies under 頭/首 are `head`, and
bodies under 上半身/上半身2/上半身3/下半身 are `body`. A model without usable rigid
bodies falls back to a skinned mesh raycast and the hit face's heaviest bone.
Gesture rules mirror the Live2D classifier. Pokes and pets feed
`NaturalMotion`, so the response is pre-physics head and body motion.
`settings/mmd/natural-touch` (default on) and
`settings/mmd/natural-touch-pet-requires-hold` (default off) match the Live2D
settings, and the scene emits `touch` events like `Live2DScene`. Diagnostics
publish `touch` with `lastRegion`, `hitBody`, `petActive`, `events`, and
`headScreenPoint` in canvas client pixels.

### Rig profile

For motion layers, `readMMDRigProfile(mmd.pmx)` (exported from
`@proj-airi/stage-ui-mmd/composables/mmd`) maps the PMX skeleton to the canonical
humanoid bones of `@proj-airi/motion-driver-humanoid` and reports leg IK chains,
the knee bend sign, leg length, foot baseline, eye bone source, physics-owned
bones and the waist-cancel flag. `toRigTraits(profile)` converts it to the
renderer-neutral `RigTraits`. Pose stages must not write physics-owned bones.

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
unknown expression id and warns once per model.

## When to use it

- Displaying MMD/MikuMikuDance characters (`.pmx`/`.pmd`) on the AIRI stage.
- When you need physics-driven secondary motion, IK, and VMD playback.

## When not to use it

- For VRM avatars use `@proj-airi/stage-ui-three`; for Live2D use
  `@proj-airi/stage-ui-live2d`; for Spine use `@proj-airi/stage-ui-spine`.
- In environments without WebGL/WASM support (MMD physics requires Ammo WASM).
