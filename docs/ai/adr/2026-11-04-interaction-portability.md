# Interaction portability across renderers

Date: 2026-11-04
Status: accepted

## Context

Luke uses Live2D every day to judge how the core interaction feels: pokes, pets, mood, ACT cues, held emotions, gestures, and attention. MMD is the experimental 3D track, which lands on `main` behind lazy loading and an off-by-default switch. VRM is planned as milestone M5 of the [3D character roadmap](2026-10-30-3d-character-motion.md). The goal is that a feel tuned on Live2D carries over to every renderer that can perform it, while each renderer can still be tuned on its own.

An audit on 2026-11-04 found that the [3D character motion ADR](2026-10-30-3d-character-motion.md) had already made the behaviour engine shared: Live2D and MMD both run one `NaturalMotion` controller from `packages/motion-driver-natural`. The audit also found four gaps, all in the wiring around that engine and not in the engine itself:

- MMD pokes and pets moved her body but never reached mood, the situation, or a reaction turn, because `Stage.vue` routed `touch` only from `Live2DScene`.
- ACT cue gestures (nod, shake, shrug, lean, glance) played only on Live2D, because `Stage.vue` checked for the `live2d` renderer and the MMD scene had no `gesture` or `addMood`.
- Per-model emotion strengths existed only in the Live2D settings.
- Three ADRs described attention and touch as Live2D Natural only, although MMD runs the same layers.

## Decision

### Four layers

| Layer | Owns | Shared | Where |
| --- | --- | --- | --- |
| 1. Intent | ACT cues, classified touch gestures, the situation, the layered character state | Every renderer | `pipelines-audio` ACT parser, `stage-shared` (`expression-performance/touch-affect.ts`, `character-state`, `situation`), `motion-driver-natural/frame-types.ts` (`NaturalTouchGesture`) |
| 2. Decision | Bands, habituation, refractories, held emotions, slot leases, mood doses | Every Natural renderer | `StagePerformanceConductor` and the decider; `selectStagePerformanceRenderer` gives a scene to Live2D and MMD |
| 3. Behaviour | Timing, rhythm, envelopes, gaze, blink, breath, posture, impulses, holds, cue gestures, mood, touch reactions, cursor and chat attention | Every Natural renderer | `packages/motion-driver-natural` |
| 4. Adapter | How the normalized pose and face commands look on a rig | Per renderer | Live2D: rig-profile parameter ranges. MMD: head and body spans on bones, face through the morph runtime |

The feel lives in layers 2 and 3, which are one implementation. The look lives in layer 4, where per-renderer and per-model tuning belongs. A new interaction feature lands in layers 1 to 3 first and reaches each renderer through its adapter. A feature that only one renderer can perform says so in its ADR and names the reason: a hard limit of the format, or work not done yet.

### Renderer tiers

- **Natural renderers** implement the whole `StagePerformanceScene` surface, including `gesture`, `addMood`, and `setFaceBaseline`. Their scene emits `touch` as a `NaturalTouchGesture`, and they read per-model emotion strengths. Today these are Live2D under the Natural driver and MMD under the Natural driver. VRM joins this tier with its M5 adapter.
- **Basic renderers** map an emotion directly to a clip, an animation, or an image and never reach the conductor. Spine and Tachie are frozen in this tier: no Natural parity work is planned for them. Live2D Universal and MAGIC and MMD Classic are basic drivers of Natural renderers.

The optional methods on `StagePerformanceScene` stay optional only so that scenario and QA sinks can omit them. A Natural renderer that omits one is a portability bug.

### Shared vocabulary

- **ACT `gesture`** is the renderer-neutral procedural vocabulary (`motion-driver-natural/src/cue-gestures.ts`), and every Natural renderer plays it. The conductor gates it on the Natural driver only, and `Stage.vue` no longer checks the renderer. **ACT `action`** is the 3D clip library layered on top ([clip actions ADR](2026-11-03-mmd-clip-actions.md) on `luke/feat/fullscreen-stage`). **ACT `motion`** stays the Live2D motion-group field for Universal and MAGIC.
- **Touch.** `NaturalTouchGesture` (`poke` with a region and a region-relative point, `pet-start`, `pet-end` with a duration) is the one event type. `Live2DTouchEvent` and `MMDTouchEvent` are aliases of it. `Stage.vue` hands either scene's `touch` event to `useStageTouchStore`, so a pet or poke doses mood through the decider, reaches the situation as a `TouchObservation`, and can lead to a reaction turn on both renderers.
- **Per-model emotion strengths.** `NaturalEmotionStrengthsByModel` and `parseNaturalEmotionStrengths` live in `motion-driver-natural/src/emotion-strengths.ts`. Live2D stores them under `settings/live2d/natural-emotion-strength` and MMD under `settings/mmd/natural-emotion-strength`, in the same shape and range (0 to 2). Both settings pages use the shared panel `packages/stage-ui/src/components/scenarios/settings/model-settings/natural-emotion-strength.vue`. The MMD adapter applies the strengths at the start of each frame, before queued episodes start, as the Live2D adapter does.

### What carries over and what is tuned per renderer

- **Carries over automatically**, because it is the same code: reaction timing and rhythm, how often and how long reactions last, decision pacing, how mood rises and decays, attention behaviour, cue-gesture shapes, and speech-emphasis timing.
- **Tuned per renderer**: amplitude, because a Live2D `ParamAngleX` of 30 is a rigger-defined deformation while MMD rotates real bones (head span 30 degrees, body span 10 degrees); face shape, because MMD depends on the morphs a PMX model ships and VRM has a small preset set; and physics response, because Cubism physics reacts to parameters while MMD simulates bodies after the pose.
- **Not portable**: locomotion, clip actions, dances, and perching need a 3D body. Spine and Tachie have no procedural pose, so at most they could share decision timing, which this ADR does not plan.

### QA

Luke chose manual QA for feel. The Natural liveliness and emotion gates keep reading Live2D parameters, and he judges MMD feel by eye. The browser tests in `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts` cover the routing: ACT gestures and touch doses reach the MMD scene the same way they reach the Live2D scene.

## Parity matrix

State on `main` after this change. "Branch" means `luke/feat/fullscreen-stage`.

| Feature | Live2D Natural | MMD Natural | VRM | Spine | Tachie |
| --- | --- | --- | --- | --- | --- |
| Idle life (breath, blink, posture, saccades) | Yes | Yes | Blink and eye motion only | Idle track | No |
| Cursor attention | Yes | Yes | Eyes only | No | No |
| Screen placement and chat attention | Yes | Yes | No | No | No |
| Poke and pet motion | Yes | Yes | No | No | No |
| Touch to mood, situation, and reaction turn | Yes | Yes | No | No | No |
| Emotion episodes and bands | Yes | Yes | Expression preset | Emotion animation | Image swap |
| Held emotions | Yes | Yes | No | No | No |
| Expression catalog, slots, and panel | Yes | Yes | No | No | No |
| ACT `gesture` | Yes | Yes | No | No | No |
| ACT `action` (clips) | No | Branch | No | No | No |
| ACT `motion` (motion groups) | Universal and MAGIC | No | No | No | No |
| Fast mood | Yes | Yes | No | No | No |
| Slow mood face baseline | Yes | Yes | No | No | No |
| Per-model emotion strengths | Yes | Yes | No | No | No |
| Speech lip-sync | Yes | Yes | Yes | No | No |
| Speech emphasis | Yes | Yes | No | No | No |
| Sit and sleep stances | No | Yes | No | No | No |
| Locomotion and the desktop stage | No | Branch | No | No | No |
| Feel QA gates | Yes | Manual | No | No | No |

Keep this table current when a feature reaches or leaves a renderer.

## Consequences

Tuning in `motion-driver-natural` reaches MMD unchanged, and MMD now performs every Natural interaction that Live2D performs. The Live2D path changed no behaviour: its touch event type became an alias of the shared type, and its strength parser moved to the shared package without a numeric change.

`Stage.vue` routes touch and gestures by driver, not by renderer, so a future Natural renderer gets them by implementing the scene surface.

## Follow-ups

- Move the touch classifier into `motion-driver-natural`. `stage-ui-mmd/src/composables/mmd/touch/gestures.ts` still duplicates the rules and thresholds of Live2D's `touch-gestures.ts`, so a pet or poke tuning change must be made twice until then.
- Add per-model amplitude gains (head, body, face) if MMD reads weaker or stronger than Live2D in Luke's QA.
- Remove the remaining Live2D vocabulary from shared code: the conductor's `Live2DMotionDriver` type, the exp3 parser in `stage-shared`, the `live2d`-namespaced diagnostics event ids, and the `settings.live2d.*` i18n keys that shared panels read.
- When `luke/feat/fullscreen-stage` lands, keep the ACT `gesture` branch in `Stage.vue` ungated beside the MMD `action` branch. This resolves the clip actions ADR follow-up that asked how gesture kinds should reach MMD.
- VRM joins the Natural tier through the M5 adapter.
