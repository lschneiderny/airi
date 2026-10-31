# 3D character motion for MMD models

Date: 2026-10-30
Status: accepted

## Context

Before this change, an MMD model on the stage stood still unless the user imported an idle VMD. Its cursor gaze ran after physics and replaced the clip's head and eye rotation. Emotions were fixed morph slots, and only vertex and group-to-vertex morphs had a visible effect. The Natural behaviour engine lived inside `packages/stage-ui-live2d`, typed against Live2D rig and touch types, so no other renderer could use it. The stage performance conductor dispatched only to the Live2D scene and read only the Live2D expression store. No renderer-neutral humanoid contract existed for look-at, foot contact, weight shift, or stance decisions.

The goal was a 3D character as lively as the Live2D Natural character, plus a body: planted feet, weight shifts, a whole-body look-at, physical touch, and sit and sleep stances from imported clips. The Live2D path had to stay byte-identical. Locomotion, window following, gesture libraries, dance, perching, and the VRM adapter are out of scope (milestones M2 to M5).

## Decision

### Two renderer-neutral packages

`packages/motion-driver-natural` holds the Natural controller (`packages/motion-driver-natural/src/natural-motion.ts`) and its pure layers: blink, breath, gaze, posture, body, face, impulses, hold, gestures, mood, energy, cursor attention, placement, speech emphasis, and touch. The root entry exports the controller, the frame contracts, `NaturalRigTraits`, `NaturalTouchRegion`, `NaturalEpisode`, and `SpeechOnsetDetector`; every layer is also a source subpath. The move changed no numbers. Seeded trace hashes were equal before and after the move, and `@proj-airi/stage-ui-live2d` re-exports none of the moved symbols.

Live2D keeps its adapter (`natural-motion-adapter.ts`) and the Natural tooling that reads Live2D parameters: the rig profile, trace recording, liveliness and emotion scorers, reference stats, and QA gates, all under `packages/stage-ui-live2d/src/composables/live2d/natural-motion/`. Gate definitions therefore stay at their existing path.

`packages/motion-driver-humanoid` holds canonical humanoid types with VRM bone names (`./types`), look-at distribution with body-turn hysteresis (`./look-at`), foot contact with leg reach and knee pre-bend (`./foot-contact`), seeded weight shift (`./weight-shift`), and the stance and attention director (`./director`). Every function takes explicit time in seconds or milliseconds and seeded randomness, and returns rest-relative rotations or mesh-local positions.

Neither package may import `three`, `vue`, `pinia`, `@moeru/three-mmd`, or `@proj-airi/stage-ui*`. The `no-restricted-imports` block for `packages/motion-driver-{natural,humanoid}/src/**` in `eslint.config.ts` enforces this. Both run as Node Vitest projects listed in the root `vitest.config.ts`.

### The MMD frame pipeline owns a clean pose

`MMDFramePipeline` (`packages/stage-ui-mmd/src/composables/mmd/frame-pipeline.ts`) replaces `updateWithMixer`. Each frame, with `dt` clamped to 1/20 s, it runs:

1. `beforeUpdate`, then `restore`: bones and morph influences return to the last clean clip pose, so procedural output never feeds back into the next frame.
2. `commands`: deferred playback commands, so `play()` captures clean state.
3. `mixer.update` and `updateAnimation`, then `capture`: the clip pose, morph influences, and per-clip effective weights become the new clean snapshot.
4. Pose stages, in registration order: `natural`, `weight-shift`, `foot-contact`, `look-at`, `eyes`, `classic-gaze`, `classic-face`, `lip-sync`, `bone-morphs`.
5. `beforePhysics` (IK and grants), `physics.reset` when requested, `physics.update`, `afterPhysics`.
6. Surface stages: `body-diagnostics` (foot error measured after the real IK and physics), then `morphs` (material, UV, and vertex surfaces).

`render` is measured outside the pipeline by the diagnostics store. A mixer loop event and every model transform change request a physics reset.

The binding rule is that a pose stage reads `context.clean` and writes absolute transforms derived from it, and never writes the snapshot. Every bone write therefore happens before `mmd.beforePhysics()`, so hair and cloth react to procedural motion and nothing compounds across frames. Pose stages skip bones that the rig profile reports as physics-owned. Classic gaze became a pose stage that composes with the clip's head rotation instead of replacing it.

### The morph runtime follows MikuMikuDance

`createMMDMorphRuntime` (`packages/stage-ui-mmd/src/composables/mmd/morph-runtime/`) evaluates group, vertex, bone, material, and UV morphs. Group members of any type expand, except nested groups. Bone morphs compose after the procedural pose and before physics (`applyBoneStage`). Material and UV surfaces apply after physics (`applySurfaceStage`). Material state goes through three-mmd's material API, which carries diffuse, specular, shininess, ambient, opacity, edge, and texture, sphere, and toon tints. User opacity overrides compose after the morph state.

Channels are persistent named weights per layer. From highest to lowest priority, the layers are devtools, lipSync, blink, expression, clip, and naturalFace. Nested groups, Flip, Impulse, and additional-UV (UV1 to UV4) morphs are reported once per model and have no effect. Additional-UV morphs match MikuMikuDance without effect shaders.

### Rig profile and body layers

`readMMDRigProfile` (`packages/stage-ui-mmd/src/composables/mmd/rig/`) maps the PMX skeleton to humanoid bones and reports leg IK chains, the knee sign, leg length, the foot baseline (the mean ankle bind Y), the eye bone source, physics-owned bones, and the waist-cancel flag. `toRigTraits` turns the profile into the neutral `RigTraits`.

`MMDBody` (`packages/stage-ui-mmd/src/composables/mmd/body/`) owns the weight-shift, foot-contact, look-at, and eyes stages. It seeds the weight shift with FNV-1a over the model key. Looping stance clips duck the body fully but keep half of the head and neck look-at (`STANCE_HEAD_ATTENTION`). Other clips duck the body and the head fully, and foot contact eases out under any non-stance clip. The look-at target resolves from the cursor on the stage plane or the camera (`packages/stage-ui-mmd/src/composables/mmd/body/attention.ts`).

### Natural drives MMD by default

`settings/mmd/motion-driver` defaults to `natural`. `MMDNaturalAdapter` (`packages/stage-ui-mmd/src/composables/mmd/natural/`) seeds the shared controller from the model id. It feeds the controller performance, energy, voice, cursor in head widths, chat target, and screen inwardness. It writes neck and head, spine and chest from the clean pose, and face and blink through their morph-runtime layers. Classic keeps its gaze, blink, and emotion composables. Switching drivers clears the procedural morph channels and starts a fresh controller.

### Conductor routing and the shared expression panel

`selectStagePerformanceRenderer` (`packages/stage-ui/src/features/performance/renderer.ts`) picks the scene, driver, and expression backend of the active renderer. MMD's Natural driver maps to the conductor's `natural` driver and Classic maps to `universal`. Other renderers get no scene and no backend. ACT emotions, holds, slot commands, speech, mute, and mood therefore reach the MMD scene through the same conductor as Live2D. The Natural affect-trace answer stays Live2D-only.

`deriveMMDCatalog` builds one catalog entry per PMX morph, and `useMMDExpressionStore` satisfies both `StageExpressionBackend` and the panel's `ExpressionPanelSource`. The expression panel (`packages/stage-ui/src/components/scenarios/settings/model-settings/expressions/`) is shared between Live2D and MMD. It imports no renderer store, and custom switches appear only for sources that publish `freeParameters`, which MMD does not.

### Touch without Ammo internals

`MMDTouch` (`packages/stage-ui-mmd/src/composables/mmd/touch/`) raycasts pointer input against analytic shapes rebuilt from the PMX rigid-body descriptions and posed from bone matrices. It never reads the Ammo world. A model without usable rigid bodies falls back to a skinned-mesh raycast and the hit face's heaviest bone. Pokes and pets feed `NaturalMotion`, so the physical response is pre-physics head and body motion that hair and skirts follow.

### Stance slots

Per-model `idle`, `sit`, and `sleep` slots (`settings/mmd/stance-slots`) name imported VMDs. `MMDStanceDirector` (`packages/stage-ui-mmd/src/composables/mmd/stance.ts`) runs `decideBody` each frame. The director sits the model after 120 s of continuous idle mode (`IDLE_TO_SIT_MS`) and puts it to sleep while the user is away, with a 3 s minimum dwell. Base clips cross-fade over 0.6 s (`BASE_CROSSFADE`). A missing or unregistered slot keeps the model standing, and a sit or sleep clip never plays as the standing idle. The director clock can be offset for QA without fast-forwarding Natural or physics (`frameClocks`).

### Framing, loading, diagnostics, and the lab

`resolveFrameBounds` (`packages/stage-ui-mmd/src/composables/mmd/camera-bounds.ts`) frames the camera from the skeleton. The bottom is the lowest ankle or toe bone, and the top is the higher of the mesh top and a head-top estimate from the neck-to-head length, so a long skirt does not shrink the model. The whole mesh `Box3` is used only when the head, neck, or both ankles are missing.

Loads are latest-wins. A load generation counter invalidates a stale model, physics initialization, or motion continuation, and `disposeMMDObject` releases geometry, materials, their textures, and skeleton bone textures exactly once.

The `mmd-motion-diagnostics` store (`packages/stage-ui-mmd/src/stores/motion-diagnostics.ts`) publishes snapshots at 10 Hz on the `airi-stores-stage-ui-mmd-motion-diagnostics` BroadcastChannel. The snapshot carries the driver, FPS, per-stage timings, rig, Natural, feet, look-at, director, touch, animation, and measurement fields. The store accepts measurement, debug-flag, director-clock, and overlay commands. The MMD Motion Lab (`packages/stage-ui/src/features/devtools/motion/mmd/`, routed at `/devtools/mmd-motion` in Tamagotchi) reads that store. It toggles overlays (IK helper, collider wireframes, foot anchors, look-at marker) through the `mmdOverlaySetEvent` Eventa event.

## Consequences

Live2D and MMD share one Natural behaviour, so tuning carries across renderers and cannot drift between copies. A future VRM adapter can consume both motion-driver packages without MMD assumptions. Pure layers run in Node Vitest with seeded inputs. Adapter, store, and UI behaviour runs in browser tests.

The clean-snapshot rule is load-bearing: a new MMD pose stage must register in the pipeline and write absolute transforms from `context.clean`, and a new surface effect belongs in a surface stage. Stage order is visible in the diagnostics timings and in the lab.

MMD gains the same expression tools, ACT expressions, and panel as Live2D. Lip-sync owns the vowels and blink owns the blink morphs. MMD settings expose the driver, Natural energy, touch toggles, and stance slots. Classic remains available and behaves as before, except that its gaze now layers on imported head motion.

## Follow-ups

- Milestones M2 to M5: locomotion and window following, an action and gesture library with `perform_action` and `go_to` tools, dance to the beat, perching on windows, drag dangle, props, and the VRM adapter.
- Ask upstream three-mmd-physics-ammo for an impulse API, so touch can push rigid bodies directly instead of only moving bones before physics.
- Texture, sphere, and toon tint uniforms already render in the current three-mmd toon material. Confirm each tint visually on a real model that uses it, and record the result in the runtime notes.
- Move the touch gesture classifier into `packages/motion-driver-natural`. `packages/stage-ui-mmd/src/composables/mmd/touch/gestures.ts` duplicates the rules and thresholds of Live2D's `touch-gestures.ts`, because stage-ui-mmd must not import stage-ui-live2d.
- `FieldCombobox` (`packages/ui/src/components/form/field/field-combobox-select.vue`) drops options whose value is empty. The MMD stance picker works around this with a `'/none'` sentinel. The morph-slot `(auto)` option uses an empty value, so it is silently missing from that picker. Fix the component and remove the sentinel.
- Foot contact plants the ankle position and the IK bone's yaw only. Ankle pitch and roll are uncontrolled, so the K4 test sit pose reads as a kneeling crouch. Plant the full ankle orientation, or pin the toe target as well.
- The director snapshot reports `centerY` in PMX model units (mesh space). Stance checks therefore depend on each model's scale. Normalize it by leg length before using it in cross-model thresholds.
- The mesh-raycast touch fallback for models without usable rigid bodies has no automated test and has not been exercised live. Add a browser test and a live check on a model without rigid bodies.
- A Motion Lab opened after overlays were enabled shows every overlay toggle as off. The diagnostics snapshot carries no overlay state, so a new window never learns the stage's current flags. Publish the overlay flags in the snapshot, or answer an initial state request.
- The lab screenshot evidence omits the Timings panel. Only the fixture browser test covers that panel. Capture it in the next real-surface QA run.
