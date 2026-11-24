# Body ownership

This file describes the code on `main`. A change that makes a statement here false updates this file in the same commit. These rules win over the ADRs in `docs/ai/adr/`; the ADRs record the history behind them.

This document states which writer owns each channel of the character's body in each renderer, the order in which the writers run each frame, and how ownership passes from one writer to another. Code is cited by repository path and symbol, never by line number. Terms follow the [domain glossary](glossary.md).

Update this document in the same commit as any code change that moves an owner, changes an order, or changes a rule. A new decision still gets an ADR; the rule it sets lands here.

## Live2D

Natural is the only driver the mind drives. Universal, MAGIC, and classic
declare no capabilities and receive no mind intents. Under Universal and
MAGIC, Stage sends ACT emotions to upstream motion groups and ACT expressions
to `live2d.expressions.execute`. The fork panel, rest set, and manual switches
remain available, but automatic mind picks do not run there.

Live2D has three [motion drivers](glossary.md#motion-driver): [Natural](glossary.md#natural), [Universal](glossary.md#universal), and [MAGIC](glossary.md#magic) (`packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver`). The driver is stored for each display model (see [State persistence](state-persistence.md#per-model-display-settings)), and the fork's default is Natural. The scene passes driver-dependent switches to the model in `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`: idle motions, idle eye animation, and eye tracking reach the model only under Universal, the turn toward the cursor (`focusBias`) reaches it only under MAGIC with eye tracking on, and the auto-blink plugin is switched off under Natural, which blinks on its own. The scene recognizes taps and pats (`createLive2DTouchGestureTracker`) only under Universal and MAGIC; under Natural the model classifies pokes and pets and reports them to the stage, and the response that the [character mind](glossary.md#character-mind) decides is the only touch response (`reactToTouch` in `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`). Natural always runs the expression system (`useSettingsLive2d` `live2dExpressionActive`); the user's expression switch applies only to Universal and MAGIC.

Under Universal and MAGIC, Natural is inactive. The adapter eases its [posture](glossary.md#posture) weight to zero, suspends the controller, and stops its face, blink, and breath writes (`Live2DNaturalMotionAdapter` `compose` in `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`). Every adapter write happens inside the SDK `updateFocus` wrap, which the SDK brackets with `saveParameters` and `loadParameters`, so each write is a stateless overlay on that frame's values.

The Live2D scene declares `LIVE2D_NATURAL_CAPABILITIES`: posture, face, gaze,
and nod, shake, and glance gestures, without body. Universal and MAGIC declare
`NO_CAPABILITIES`. The character mind keeps the newest attached declaration
and reports an `undeclared` refusal for shrug and lean, before performance.
The declarations live beside `Live2DNaturalMotionAdapter` and
`MMDNaturalAdapter`; `permits` in `packages/character-mind/src/capabilities.ts`
defines the channel contract. Voice always passes because chat realises it.

The conductor checks each mind intent with `permits` against its own scene
before dispatch. A second stage that cannot realise the newest stage's request
reports `not-declared-by-stage` through `StagePerformanceConductor.onRefusal`,
the motion QA mind event, and the reaction inspector. The mind's own refusals
use `undeclared`. Baselines, idle drives, and beats remain performer inputs.

Both renderers' expression deciders seed each new episode's slot tickets from
its mind intent id and the slot (`expressionSeed` and `drawEpisodeTickets` in
`packages/stage-shared/src/expression-performance/selection.ts`). The same
intents, catalog, settings, and selection history therefore give the same picks
across stages, regardless of conductor seeds. Escalations reuse their episode's
tickets. Timing and deadline signals only release existing picks. Affect traces
are version 3 and record intent ids; versions 1 and 2 no longer parse.
Mind moment intents also seed their chance and entry pick by id
(`useIdleProps` in `packages/stage-ui/src/composables/performance/use-idle-props.ts`).
Performer idle reports and lab previews have no moment intent id and keep a
separate local random stream. The moment chance remains 0.6.

Expression requests that cannot be shown return one `ExpressionRefusal` per
entry in the command batch, with its catalog id and no label. The conductor
forwards these through `onRefusal`, the motion QA `performer-refusal` mind
event, and the reaction inspector. Missing catalog entries or entries with no
usable slots report `missing-asset`; this also covers a planner entry removed
before its timing event. Live2D's existing protected manual group reports
`masked-by-manual`, and a protected group owned by another slot reports
`masked-by-expression`. A shown expression reports nothing.

These reports preserve existing composition. Live2D applies expression
parameters after motion curves; MMD's `expression` morph layer outranks `clip`
and its slot claims outrank manual claims. Neither currently has a clip-owned
expression slot, so neither manufactures `masked-by-clip`; the report contract
can carry that reason when a performer actually refuses for clip ownership.
Reporting does not add a mask, change a lease, or feed a refusal into the mind.
This lands former Target rule 5 for the expression ownership that exists.

### Channel ownership

| Channel | Parameters | Natural | Universal and MAGIC | Composition | Code |
| --- | --- | --- | --- | --- | --- |
| Eyelids | `ParamEyeLOpen`, `ParamEyeROpen` | On idle frames the idle-disable plugin writes the saved open values and stops motions. Expression, light squint, and manual control then act on the result. The adapter writes last: it reads the current value and applies the micro multiplier, the emotion hint, and the blink factor. Clip-owned lids are skipped. | Motion curves, then expression, the auto-blink plugin, light squint, and manual control. The touch reaction multiplies the result last by `1 - eyeSquint`. With the expression system off, the SDK eye blink runs on frames without a motion update. | Natural: a function of the current value. Expression-closed lids (at or below 0.15) keep their value, and open lids stay at or above 0.2 outside a blink. Manual control multiplies by `1 - eyeSquint`. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `composeEyelid`, `Live2DNaturalMotionAdapter` `composeFace`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginIdleDisable`, `useMotionUpdatePluginManualControl` |
| Blink | `ParamEyeLOpen`, `ParamEyeROpen` | Natural's `blinkFactor` closes the lids when the user's auto-blink setting is on; at a positive [pep](glossary.md#pep) it also carries the closed-eye smile's lid closure. With auto-blink off, only `idleLidFactor` closes them, for sleep, a yawn, a stretch, a nod-off, or pep's closed-eye smile. The auto-blink plugin does not blink, because the scene passes it auto-blink off. | The auto-blink plugin, in the final stage after expression. With the expression system on, it blinks on idle motion by multiplying the post-expression values. With it off, it writes absolute values and marks the frame handled. | Multiply on the lid value. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `composeFace`; `packages/motion-driver-natural/src/natural-motion.ts` `NaturalMotion` `idleLidFactor`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginAutoEyeBlink` |
| Light squint | `ParamEyeLOpen`, `ParamEyeROpen` | Runs under every driver in the final stage, after blink and before Natural. | Same. | Multiplies, with a floor of 0.2, and hands back its own write when it stops. | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginLightSquint` |
| Brows | `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowRForm` | Additive offsets on the Y and angle channels. Natural does not write the form channels. | Motion curves and expression. | Additive offset under Natural. The saved model parameters are written once at load and again when the user changes them. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `faceOffsets`; `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` |
| Mouth open | `ParamMouthOpenY` | Adds `silentMouthOpen` to the current value, but only when there is no speech and [lipsync](glossary.md#lipsync) did not own the mouth this frame. | Motion curves and expression. Manual control writes the parameter absolutely. Lipsync writes it during speech, the release, and the handoff hold. | Lipsync: absolute while speaking, a smoothstep blend back to the motion value during the 200 ms release, and 0 during the 500 ms hold. Natural: additive and masked. | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginLipSync`; `packages/stage-ui-live2d/src/composables/live2d/lipsync-handoff.ts` `lipSyncReleaseMs`, `lipSyncHandoffHoldMs`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAttention` |
| Mouth form and cheek | `ParamMouthForm`, the resolved cheek parameter | Additive offsets, clamped to the range. Blush grows toward the farther end of a one-sided range. | Motion curves and expression. Manual control writes `ParamMouthForm` absolutely. | Additive offset. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `faceOffsets`, `offsetSign`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile.ts` `resolveCheekParameterId` |
| Eye smile | `ParamEyeLSmile`, `ParamEyeRSmile` | Additive offset from `eyeSmile`, which includes the closed-eye smile at a positive pep. A rig that has only `ParamEyeSmile` gets no Natural eye smile. | Motion curves and expression. | Additive offset. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `faceOffsets`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile.ts` `readLive2DRigProfile` |
| Gaze | `ParamEyeBallX`, `ParamEyeBallY` | Posture axes `eyeX` and `eyeY`, under the posture rule below. At full weight the adapter skips the SDK focus call. | SDK focus adds the focus offset. Manual control writes these absolutely; under MAGIC its pose carries the focus bias toward the cursor. The idle eye-focus plugins run only when idle eye animation is on. | Same as head angles. At load, the scene renames idle-group eyeball curves for every driver, so idle motions never move the eyes. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `postureAxes`, `Live2DNaturalMotionAdapter` `composePosture`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginIdleFocus`; `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` |
| Head angles | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ` | Posture. At weight 1 the command overwrites the parameter. Below 1 it eases from the current value. A clip-owned channel keeps `clipResidual` (0.1) of the Natural offset, scaled by weight. | Motion curves. Under Universal and MAGIC, [beat sync](glossary.md#beat-sync) springs the head in the pre stage; under Natural it writes nothing. Manual control writes absolutely, and under MAGIC its pose carries the focus bias. While a manual pose holds the head under Universal or MAGIC, the beat-sync layer adds its offset to `ParamAngleY` and `ParamAngleZ` after it. The touch reaction adds its offsets last. SDK focus adds `x * 30` and `y * 30`. | Absolute overwrite at full weight, which erases expression writes on these channels. Eased blend below full weight. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `composePosture`, `clipResidual`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginsBeatSync`, `beatSyncMode`, `useMotionUpdatePluginTouchReaction`; `packages/stage-ui-live2d/src/composables/live2d/focus-bias.ts` `createLive2DFocusBias` |
| Body angles | `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ` | Posture, under the same rule as the head. A `null` command skips the write, because rig physics derives that axis from the head. | Motion curves. Manual control writes absolutely. The touch reaction adds offsets to `ParamBodyAngleX` and `ParamBodyAngleY` last. SDK focus adds `x * 10` to `ParamBodyAngleX`. | Same as head angles. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `composePosture`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile.ts` `Live2DRigProfile` (`bodyFromHeadPhysics`) |
| Breath | `ParamBreath` | Absolute write of the Natural breath value. Skipped while manual breath control is active and on a clip-owned channel. | Motion curves. Manual breath control writes its curve while active and restores the saved value once when it releases. | Absolute. The SDK breath pass is deleted at load for every driver. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `composeFace`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginBreathControl`, `disableLive2DSdkBreath` |
| Expression parameters | Any parameter in an `.exp3.json` file or a custom expression | Not written by Natural, apart from the overlaps listed in the rows above. | The first final plugin composes the fork's expressions on whatever value the motion writers left this frame. Her own idle pastime entries are claims at layer 0.5: above the user's switches and below slot leases. The second final plugin blends upstream's Live2D context expressions, which a card's Live2D controls activate; it writes nothing until one is activated. | Add, Multiply, or Overwrite per parameter. A pre plugin restores last frame's expression output first. | `packages/stage-ui-live2d/src/composables/live2d/expression-controller.ts` `useExpressionController` (`restoreExpressionBases`, `applyExpressions`); `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginExpression`; `packages/stage-ui-live2d/src/contexts/live2d.ts` `createLive2D`; `packages/stage-ui-live2d/src/stores/expression-store.ts` `useExpressionStore` |
| Physics outputs | Destinations of physics outputs with non-zero weight | Never written. The adapter drops these channels from every write list. | Physics writes them after SDK focus. | None. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile.ts` `readLive2DRigProfile`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `setRigProfile` |
| Clip-owned parameters | Parameters animated by the playing motion | Posture keeps the 0.1 residual. Face, eyelid, mouth, and breath writes skip these channels. | Motion curves only. | Residual for posture, skip for the face. | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useLive2DMotionManagerUpdate` (`getClipOwnedIds`) |

### Per state

| State | Effect | Code |
| --- | --- | --- |
| Natural driver | The expression system runs and the SDK expression manager and SDK eye blink are removed. Idle motions, idle eye animation, eye tracking, the focus bias, the auto-blink plugin, both beat-sync plugins' writes, and the scene's tap and pat gestures with their touch reaction are off. Idle frames are handled by the idle-disable plugin, so the SDK motion update does not run on them. The [character mind](glossary.md#character-mind) decides her idle acts, sleep, and errands, and Natural performs each order and reports what it did; the conductor hands orders to the model only under Natural. | `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `useSettingsLive2d`; `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`; `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginIdleDisable` |
| Universal or MAGIC driver | Natural is inactive. Posture eases out over at most 0.20 s, and the controller is suspended. Face, blink, and breath writes stop, and queued emotions, gestures, cues, and pokes are dropped. A suspended controller refuses each idle order, and the mind hears the dormant idle view. Idle motions and idle eye animation reach the model only under Universal, and the focus bias only under MAGIC. A tap or a pat adds the touch reaction, and a tap plays the model's touch motion group when it has one. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `compose`, `updateSuspension`; `packages/stage-ui-live2d/src/components/scenes/Live2D.vue` |
| Expression system off (Universal or MAGIC only) | The SDK expression manager and SDK eye blink stay, and the expression runtime does not initialize. | `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` |
| Speaking | Lipsync owns `ParamMouthOpenY`, and the Natural mouth write is masked. | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginLipSync`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAttention` |
| Lipsync release and hold | The Natural mouth write stays masked for the 200 ms release and the 500 ms hold. Lipsync reports ownership every frame, and the adapter keeps no timer. | `packages/stage-ui-live2d/src/composables/live2d/lipsync-handoff.ts` `lipSyncReleaseMs`, `lipSyncHandoffHoldMs`; `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` |
| Clip playing | Posture keeps the clip residual, face writes skip clip-owned channels, and Natural keeps running. An empty SDK `currentGroup` releases clip ownership even without a `motionFinish` event. | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useLive2DMotionManagerUpdate` |
| Manual control or spring active | Posture eases out (nominal 0.20 s), and the face keeps composing. When control ends, posture eases back in (nominal 0.45 s). | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `compose`, `blend` |
| Manual breath active | The Natural breath write is skipped, and breath control writes its curve. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `composeFace`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginBreathControl` |
| Auto-blink off under Natural | Natural applies `idleLidFactor` in place of the blink factor, so she closes her eyes only on purpose. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `composeFace` |
| Exclusive owner holds the model | Natural is inactive, exactly as under another driver. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `compose` |
| Paused or hidden | The Natural clock freezes and the controller is suspended. | `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` `setPaused`, `updateSuspension` |

### Per-frame order

1. The pixi-live2d-display SDK method `Cubism4InternalModel.update` starts and calls `motionManager.update`. The scene has replaced that call with `hookUpdate` (`packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useLive2DMotionManagerUpdate`).
2. Pre plugins run in registration order, and the loop stops at a plugin that marks the frame handled:
   - `restoreExpressionBases`;
   - the beat-sync `pre` plugin (`useMotionUpdatePluginsBeatSync`), which advances its springs and writes nothing under Natural;
   - idle disable (`useMotionUpdatePluginIdleDisable`).
3. If no pre plugin handled the frame, the SDK motion update runs and marks the frame handled when it updated a motion. Post plugins run only on a frame that is still unhandled, and idle focus (`useMotionUpdatePluginIdleFocus`) is the only post plugin.
4. Final plugins always run, even on a handled frame, in this order:
   - the fork's expressions (`applyExpressions`);
   - upstream's Live2D context expressions (`useMotionUpdatePluginExpression`), which write only under Universal and MAGIC; under Natural their active parameters enter the preceding fork composer as a frame-scoped lease;
   - auto blink (`useMotionUpdatePluginAutoEyeBlink`);
   - light squint (`useMotionUpdatePluginLightSquint`);
   - manual control (`useMotionUpdatePluginManualControl`);
   - the beat-sync `layer` plugin, which adds nothing under Natural;
   - lipsync (`useMotionUpdatePluginLipSync`);
   - breath control (`useMotionUpdatePluginBreathControl`);
   - the Natural frame step (`Live2DNaturalMotionAdapter` `frame`). This step advances the Natural clock and does not compose;
   - the touch reaction (`useMotionUpdatePluginTouchReaction`), which adds nothing under Natural.
5. The SDK calls `saveParameters`. With the expression system off, the SDK expression manager and, on frames without a motion update, the SDK eye blink run here.
6. The SDK calls `updateFocus`, which the adapter wraps. `Live2DNaturalMotionAdapter` `compose` feeds the controller and advances it. It calls the original SDK focus only while the posture weight is below 1, then writes posture (`composePosture`) and the face (`composeFace`).
7. The SDK calls `updateNaturalMovements`, which does nothing, because the breath pass is deleted.
8. SDK physics evaluates, so physics sees Natural's writes. Pose runs, then `beforeModelUpdate`, where `Live2DItemLayer` sets the parts in a drawn item's hide list to opacity 0, restores released parts once, and captures her final parameters for linked Live2D items. `model.update` and `loadParameters` follow.
9. `Live2DModel._render` draws her. While at least one stage item draws, the model's `itemInsertions` hook (`Live2DItemLayer` in `packages/stage-ui-live2d/src/composables/live2d/items/layer.ts`) runs here, after her update and transform: it reads her current vertices, solves each item's pose, and returns her draw order split into ranges with the items drawn between them. A Live2D item updates inside its insert, right before it draws, by the time its clock accumulated, so it moves after her in the same frame; a linked item writes her captured parameters at its own `afterMotionUpdate`, before its physics. Without items the hook is unset and she draws in one pass. Stage items advance on their own clock, fed by `app.ticker` deltas ahead of the render (`packages/stage-ui-live2d/src/components/scenes/live2d/items.vue`), not by her `deltaTime`.

### Rules

The [Live2D channel owners ADR](../adr/2026-11-22-live2d-channel-owners.md)
records the final-owner reading and the zero-weight expression input.

- **Natural owns posture; others offset it.** At full posture ownership, `composePosture` writes each head, body, and eyeball channel with the Natural value. Expression head tilts enter `NaturalMotion.advance` as a frame-local input with `EXPRESSION_TILT_WEIGHT = 0`; this lands former Target rule 2 without changing motion. The expression composer reports only its contribution relative to the clean base, and the adapter normalizes that contribution using the rig's directional head ranges. A nonzero weight adds it to the head and eye compensation without changing seeded processes or body intents. Raising the weight is future motion tuning. Grooves already enter through the idle layer. Clip-owned channels keep the residual.
- **One owner composes each Live2D channel under Natural.** This lands Target rule 3 for Live2D under the plan's final-owner reading. SDK motion and preceding plugin values are inputs to the final composition boundary. Nothing replaces its result afterward. Natural composes posture and face; lipsync and manual breath hold explicit windows that Natural yields; physics owns its excluded outputs; and the expression composer owns expression-only parameters, including the context preview lease. SDK pose owns part opacity, except parts in a drawn item's hide list: the item layer sets them to 0 at `beforeModelUpdate`, after pose and before `model.update()`, and restores the captured baseline when no drawn item hides them (see the stage item rules below). This is ownership of the composed channel, not a ban on the intermediate parameter assignments that supply its inputs.
- **One touch response per driver.** Under Natural, the body response to a touch starts from the mind's `touch-reaction` [intent](glossary.md#intent), and the model shows nothing before it. `Model.vue` `reactToTouch` queues a poke for the adapter (`pendingNaturalPokes`), and the pet hand reaches the adapter only between the mind's pet `start` and `end` (`naturalPetGranted`). The adapter's poke and pet response is then the only body response. Under Universal and MAGIC, `createLive2DTouchReaction` and the model's touch motion group respond, and Natural's touch response does not run. `Live2D.vue` (`touchGesturesActive`), `Model.vue` (`touchActive`), and `Stage.vue` (`onAvatarTouch`) read the posture declaration. The conductor dispatches each touch answer only through `permits`. The [character mind core ADR](../adr/2026-11-18-character-mind-core.md) records the split.
- **A preview through upstream's context wins while it lasts.** Under Natural, `applyExpressions` samples the Root context into `useExpressionStore.contextPreview`, a frame-scoped parameter lease above every catalog claim. `ExpressionComposer` writes the combined result once; the context plugin writes nothing. Withdrawing the preview immediately reveals the still-running fork lease or clean base. Add uses the context's model-default semantics, Multiply uses the fork's composed value, and Overwrite replaces it. Driver handoff releases previous direct context writes before the composer captures its clean base. Universal and MAGIC retain the direct context plugin and its release semantics.
- **Beat sync writes nothing under Natural.** `beatSyncMode` returns `silent` under Natural. The `pre` plugin then advances the controller and its springs without writing, so a switch to Universal mid-song does not kick the head, and the `layer` plugin adds nothing. Natural is the only writer of the head angles there. This is a fork departure from upstream.
- **A groove is Natural's offset.** Under Natural, a groove is Natural's `sway` idle act. Its head and body offsets enter posture through the idle layer's output, weighted by the act's envelope and release gain (`NaturalIdleActivities` `sample`). When Natural's beat clock is locked at the sway's start, the sway's phase follows the clock; the beat moves no channel of its own. On MMD the performer's `sway` act form reads the same phase from the body intent's `groovePhase`.
- **Pep's sway and closed-eye smile are Natural's offsets.** At a positive [pep](glossary.md#pep), `NaturalSwayLayer` (`packages/motion-driver-natural/src/sway.ts`) adds a head term and a body term inside the controller, so they reach the head and body angles through posture; the eye compensation includes the head term, so the gaze holds its target through a swing. `NaturalSmileClosure` (`packages/motion-driver-natural/src/smile-closure.ts`) adds to `eyeSmile` and closes the lids through the blink factor. Neither starts its own channel write, and at pep 0 both add exactly nothing. The sway steps back under emotion gesture clips, cue gestures and idle acts, and a closed-eye smile does not start while a glance holds, the cursor or the chat is fixated, the pet override holds, an idle act runs or holds the eyes, a blink moves the lids, or the user is away.
- **One gaze arbiter under Natural.** `NaturalGazeLayer` (`packages/motion-driver-natural/src/gaze.ts`) is the only owner of the gaze channel, on both renderers, and decides between its inputs. Every held glance names a `GlanceSource` and goes through `glance`; the cursor notice goes through `orient`. `GLANCE_PRIORITY` ranks them, highest first: the long-pet camera glance and a poke (7); the desktop wake and the wake from sleep (6); a chat read and the idle voice cues (5); look tools, cue gestures, and emotions (4); the screen change (3); a noticed cursor (2); idle acts (1). A request starts unless the running glance ranks higher; a lower one is dropped and reported as refused. While the pet override holds, only the long-pet camera glance starts. Autonomous fixations rank below every glance. [Autonomous behavior](autonomous-behavior.md#precedence) rule 21 states the rule in full.
- **Lipsync owns the speech mouth window.** `packages/stage-ui-live2d/src/composables/live2d/lipsync-handoff.ts` defines the release and the hold. `useMotionUpdatePluginLipSync` is the only writer that times them, and it reports ownership every frame through its `onMouthOwnership` callback. The scene forwards that flag as `voice.lipSyncOwnsMouth`, and the adapter masks its mouth write while the flag or `speaking` is set.
- **The SDK breath pass is off for every driver.** `disableLive2DSdkBreath` runs at model load for every driver. The Natural breath write and the manual breath curve are the only breath writers besides motion curves. The Natural v2 ADR records this as a dated exception to its non-goals.
- **Stage items draw inside her render and write none of her parameters.** `Live2DItemLayer` draws each image, GIF, and Live2D item at its insertion point in her draw order: before her first drawable, right after a named drawable, or after her last. It reads her drawables after her update in the same frame, so a pinned item follows her mesh without lag, and her filters apply to it; while items draw, her filter area is the renderer's screen so an item outside her canvas is not clipped. It writes no parameter or drawable of hers, and no part opacity except through hide lists.
- **A hide list overrides SDK pose for its parts.** Any drawn item may carry a hide list of her part ids (`hides`). At her `beforeModelUpdate`, after pose, the layer sets each listed part to opacity 0, which also hides every drawable in that part's child parts. Part opacity is not among the values `loadParameters` restores, so the layer captures every part's opacity when it attaches to her model and writes a part's captured opacity back once, when no drawn item lists it any more; pose rewrites the parts it manages every frame anyway. An id that names no part of hers is skipped and the item reports `missing-part`. Hide lists apply under every driver where the item shows.
- **A linked Live2D item mirrors her and nothing else drives it.** A Live2D item (`Live2DItemModel` in `packages/stage-ui-live2d/src/composables/live2d/items/live2d-item.ts`) is a separate model with no expression controller, motion-manager hook, Natural adapter, touch, or SDK breath, and it is never on `Ticker.shared`; it plays its own idle motion group, except under reduced motion. With `link: 'parameters'` it also has no SDK eye blink, and `Live2DParameterMirror` (`items/mirror.ts`) copies her values of every parameter id both models have at her `beforeModelUpdate`, after every writer of hers, and writes them into the item at its `afterMotionUpdate`. The item's own physics outputs are never copied, so its physics runs on her values and stays their only writer. Mirroring writes only the item; it reads her and writes none of her parameters. The renderer loads at most `MAX_SHOWN_LIVE2D_ITEMS` Live2D items, which the expression store enforces with `item-limit`.
- **Cancellation releases clip ownership.** `getClipOwnedIds` clears the clip mask when the SDK's `currentGroup` is empty. `stopAllMotions` resets that state at once, but only a later SDK update emits `motionFinish`, and the idle-disable plugin can skip every later update.

## MMD

MMD Natural declares `MMD_NATURAL_CAPABILITIES`: posture, face, gaze, every cue
gesture, and body. Classic declares `NO_CAPABILITIES`. The mind decides no
performer episode without its declared channel.

MMD has two motion drivers: Natural and [classic](glossary.md#classic) (`packages/stage-ui-mmd/src/stores/mmd.ts` `MMDMotionDriver`). The driver is stored for each display model, and the default is Natural. Under Natural, `MMDNaturalAdapter` (`packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`) advances the controller and writes only the face. The body is posed by `MMDBody` (`packages/stage-ui-mmd/src/composables/mmd/body/index.ts`), whose [performer](glossary.md#performer) turns Natural's `bodyIntent()` into bone channels. The body runs only while the driver is Natural (its input's `enabled`). Under classic, the body stages do nothing. [Clips](glossary.md#clip), classic gaze, the classic emote, and the classic blink move her instead.

The [body director](glossary.md#body-director) (`decideBody`, wrapped by `MMDStanceDirector` in `packages/stage-ui-mmd/src/composables/mmd/stance.ts`) decides the [stance](glossary.md#stance), the rest, [locomotion](glossary.md#locomotion) goals, and which clip action plays. It never starts a clip itself. The scene obeys its intent: it sets the [base clip](glossary.md#clip-layer) with `setBaseMotion` and plays or stops a clip action through `obeyAction` (`packages/stage-ui-mmd/src/components/scenes/MMD.vue`). Every clip request goes through the scene's `requestPerform`, including requests from `MMDActionPort` (`packages/stage-ui-mmd/src/composables/mmd/action-port.ts`). Body tool requests go through `MMDBodyToolPort` (`packages/stage-ui-mmd/src/composables/mmd/body-tool-port.ts`). Each port reads the director's answer back and decides nothing.

### Director inputs

The director acts on the mind's intents, requests from the model or user, and
its own world. It does not subscribe to raw touches, drag releases, chat, or
presence. This lands former Target rule 8 and D6 to D11 of the
[director input ADR](../adr/2026-11-21-character-mind-director-intents.md).

- **Intents:** `MMDAttendInbox` counts `attendCause` into touch/drag, chat,
  and chat-open sequences and stamps the cursor window on the next director
  frame. The director keeps the clip-ending and chat-approach rules. `away`
  comes from the mind's presence answer, seeded on scene attach and return to
  Natural. Natural's idle states and wander errand realise the mind's idle
  intents; the wander keeps its `pick` while held and uses it for the visit
  share. The scene resolves an idle-clip errand against the model's library
  before requesting that clip.
- **Requests:** ACT action labels, body tools, and user/debug clip requests still go
  to the director. A look tool yields `BodyIntent.look` for Natural's gaze
  arbiter. ACT look remains resolver input, outside this path.
- **World:** performance mode, speaking, dragging in progress, geometry and
  positions, gait state including `restX`, clip ownership and availability,
  settings, and the lab goal remain renderer inputs. The resolver's attention
  goes only to the diagnostic mapper, and its away overlay no longer reaches
  the director.

The conductor sends these intents only under Natural. Classic receives no new
attends and its director reads `away: false`: drag releases, chat activity,
and leaving no longer end its clips. A drag in progress retains its world
refusal and broad-clip ending rules. Feedback, watchdogs, stop requests, and
replacement requests still end clips. Universal and MAGIC receive no new
intents either.

The scene performs each new `BodyIntent.look.seq` once under Natural through
`MMDNaturalAdapter.look`. The `look-tool` glance has priority 4 and an 8 s hold;
missing chat or cursor geometry produces a refusal event. The director no longer
returns diagnostic attention. `resolveBodyTarget` computes the old diagnostic
points from resolver attention and the look request, and writes no gaze.

### Clip ownership weights

Each frame, `MMDBody` `updateOwnership` sums the captured weight of each playing clip into bone groups through the clip's mask (`buildMMDClipMask` in `packages/stage-ui-mmd/src/composables/mmd/rig/`), capped at 1. A playing clip that was never registered with the body owns every group. Looping stance clips count separately as the stance weight. The performer then blends every write toward the clean clip pose by these weights (`MMDBodyPerformer` `write`: performer rotation scaled by `1 - owned`).

| Weight | Value | Applies to |
| --- | --- | --- |
| `pelvis` | max(stance, owned `root`, owned `lowerBody`) | Pelvis translation in `applyTorso`; foot contact is also scaled by `1 - pelvis` |
| `hips` | max(stance, owned `lowerBody`) | Hips rotation |
| `torso` | max(stance, owned `upperBody`) | The spine chain |
| `head` | min(1, one-shot `head` + stance x (1 - `STANCE_HEAD_ATTENTION`)) | Neck and head; the eyes take `1 - head` |
| `leftArm`, `rightArm`, `leftFingers`, `rightFingers` | Owned share of each group | Clavicles, arms, hands, and fingers |
| Contact duck | 1 - max(one-shot `root`, `leftLegIk`, `rightLegIk`, `lowerBody`) | Foot-contact planner; stance clips reduce contact through their own foot-IK tracks instead |

### Bone ownership

| Channel | Bones | Natural driver | Classic driver | Composition | Code |
| --- | --- | --- | --- | --- | --- |
| Clip pose | Every bone a clip keys | The mixer writes the clean pose. The base clip comes from the director's stance through `setBaseMotion`, and clip actions arrive as layers through `playLayer`. | Same. | Every pose stage reads `context.clean` and writes absolute transforms derived from it. No stage writes the snapshot. | `packages/stage-ui-mmd/src/composables/mmd/frame-pipeline.ts` `MMDFramePipeline`, `MMDCleanPose`; `packages/stage-ui-mmd/src/composables/mmd/animation-manager.ts` `createMMDAnimationManager` |
| Root | The model group's ground `x` and yaw | Locomotion moves the root through `MMDBodyRoot.setPose`. The director's intent is the only source of goals, and the scene sends it every frame. The gait is disabled while a clip owns `root` or either leg IK, while a full layer plays, and without root motion, as in the window host. | Not moved. | Absolute. Drags and teleports call `rebase`, and only a teleport resets physics. | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBody` (`setLocomotionGoal`, `rebase`); `packages/stage-ui-mmd/src/composables/mmd/body/locomotion.ts` `MMDLocomotion`, `MMDBodyRoot` |
| Pelvis, hips, spine | Center translation, hips, and the spine chain | The performer (`applyTorso`), weighted by `pelvis`, `hips`, and `torso`. | The clip pose only. | Rotation composed on the clean pose and blended by ownership. | `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer` |
| Facing | Center yaw | `MMDBody` `applyFacing` turns the center toward the facing. The foot stage reads the final facing and restores the center, and the head stage owns the visible yaw. | The clip pose only. | Facing weight is max(stance, owned `root`). | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBody` |
| Legs and feet | Leg IK targets and foot pitch | Foot contact plants the feet or follows the gait's feet, ducked by ownership. Turn steps, foot re-plants, and toe-down pitch come from the performer. | The clip pose only. | Absolute IK targets before physics. | `packages/stage-ui-mmd/src/composables/mmd/body/feet.ts` `MMDFootContact` |
| Neck and head | Neck and head | The performer (`applyHead`), weighted by `head`, after facing. The `disableLookAt` QA switch keeps the clip pose. | Classic gaze adds a damped share of the eye aim to the head. | Rotation on the clean pose. | `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer`; `packages/stage-ui-mmd/src/composables/mmd/gaze.ts` `createGazeController` |
| Arms and fingers | Clavicles, arms, hands, and fingers | The performer (`applyArms`), weighted per group. Where a side's `腕捩` or `手捩` sits between its joints with a PMX fixed axis, upper-arm twist or pronation turns that twist bone instead of the upper arm or the hand, in the same arm group; `beforePhysics` keeps it on its fixed axis and spreads it over the `捩1..3` grant children in the same frame. | The clip pose only. | Rotation on the clean pose. | `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer`; `packages/stage-ui-mmd/src/composables/mmd/body/arms.ts` `MMDArms` |
| Eyes | Each eye bone, or the both-eyes bone as a fallback | `MMDEyes` aims at the gaze point. The gaze goal follows Natural's gaze target: the cursor, the chat, the camera deflected by free fixation, or the held glance Natural's gaze arbiter chose (see the Live2D rules). | Classic gaze rotates the eyes toward the cursor offset or idle saccades. | Weighted by `1 - head` under Natural. | `packages/stage-ui-mmd/src/composables/mmd/body/eyes.ts` `MMDEyes`; `packages/stage-ui-mmd/src/composables/mmd/body/attention.ts` `resolveBodyPoints`, `bodyGazePoints`; `packages/stage-ui-mmd/src/composables/mmd/gaze.ts` `createGazeController` |
| Bone morphs | Bones that bone morphs move | The bone-morph stage composes bone morphs on the procedural pose. | Same. | After every pose writer and before physics. | `packages/stage-ui-mmd/src/composables/mmd/morph-runtime/index.ts` `createMMDMorphRuntime` (`applyBoneStage`) |
| Physics-owned bones | Bones the rig profile reports as physics-owned | Never written by a pose stage. Ammo simulates them after the pose. | Same. | None. | `packages/stage-ui-mmd/src/composables/mmd/body/pose.ts` `MMDBodyPose` (`bone`); `packages/stage-ui-mmd/src/composables/mmd/rig/rig-profile.ts` |

**Pep's sway on MMD.** At a positive [pep](glossary.md#pep), `MMDBodyIntent` (`packages/stage-ui-mmd/src/composables/mmd/body/intent.ts`) hands Natural's `sway` head term to the performer as the head term `sway`, in radians. The performer's posture generator (`BodyPosture` in `packages/motion-driver-humanoid/src/performance/posture.ts`) owns it. The spine chain takes a third of its roll (`SWAY_TRUNK_SHARE`, Live2D's 10 to 30 degree body-to-head ratio), split 0.5, 0.3 and 0.2 over the lower, mid and upper trunk channels, so she leans from the waist. The neck and head take the rest of the roll and all of its yaw and pitch, unfiltered, because Natural has already shaped the swing; the head's world tilt is the sway's roll. The trunk's share is intent, so the head's steadying reflex does not cancel it (`steadyHead` subtracts it like the trunk's share of the head yaw). The pelvis, the hips, the feet, the stance, and the gait are not moved. Natural's sway body term is not part of the body intent; it moves Live2D only. Clip ownership ducks the sway like the rest of the trunk and head. At pep 0 the term is zero, and the posture generator does no arithmetic with it.

### Morph ownership

Morphs are persistent per-layer channels that `combineMorphChannels` (`packages/stage-ui-mmd/src/composables/mmd/morph-runtime/combine.ts`) folds each frame, from lowest to highest priority: `naturalFace`, `clip`, `expression`, `blink`, `lipSync`, `devtools`. Each layer moves the value toward its largest absolute weight by its alpha, and additive channels are summed on top. Each morph has a role (`vowel`, `mouth`, `eye`, or `other`), which decides where `lipSync` and `blink` apply.

| Layer | Writer under Natural | Writer under classic | Special rule | Code |
| --- | --- | --- | --- | --- |
| `naturalFace` | `applyNaturalFace`, through `MMDNaturalAdapter` `applySurface` in the `natural` stage | None | Lowest priority. | `packages/stage-ui-mmd/src/composables/mmd/natural/face.ts` `applyNaturalFace`; `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts` `MMDNaturalAdapter` |
| `clip` | The morph influences that the mixer captured | Same | Added at evaluation when no explicit clip channel exists. | `packages/stage-ui-mmd/src/composables/mmd/morph-runtime/index.ts` `createMMDMorphRuntime` |
| `expression` | The expression store's slot leases and holds, sent by the [conductor](glossary.md#conductor) | The classic emote, through its morph controller, in the `classic-face` stage | On mouth morphs that lipsync does not own, the weight is reduced by `0.7 x speakEnv`. | `packages/stage-ui-mmd/src/stores/expression-store.ts` `useMMDExpressionStore`; `packages/stage-ui-mmd/src/composables/mmd/expression.ts` `useMMDEmote` |
| `blink` | `applyNaturalFace`, with the blink factor min(Natural `blinkFactor`, `1 - lidClose`), where `lidClose` is the performer's body lid closure | `useMMDBlink`, in the `classic-face` stage | Eye-role morphs only. A non-additive expression closure floors the value, so a blink never reopens closed eyes. | `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts` `MMDNaturalAdapter` (`applySurface`); `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBody` (`lidClose`); `packages/stage-ui-mmd/src/composables/mmd/blink.ts` `useMMDBlink` |
| `lipSync` | `useMMDLipSync`, in the `lip-sync` stage under both drivers | Same | Vowel and mouth morphs only, with alpha scaled by `speakEnv`, which is 1 while speech is audible (the scene's `nowSpeaking` prop). The lip-sync node reads the played speech through the stage's `connectSpeech` callback; it holds no audio source of its own. Lipsync stays above expression, so expressions cannot lock the vowels. | `packages/stage-ui-mmd/src/composables/mmd/lip-sync.ts` `useMMDLipSync` |
| `devtools` | No writer | No writer | Highest priority. | `packages/stage-ui-mmd/src/composables/mmd/morph-runtime/combine.ts` `MorphLayer` |

Slot names resolve to model morph names through `createMorphController` (`packages/stage-ui-mmd/src/composables/mmd/morph.ts`). Vertex and group influences, material morphs, and UV morphs reach the mesh in the `morphs` surface stage (`applySurfaceStage`), after physics.

**One final owner per MMD channel under Natural.** `MMDFramePipeline` restores the clean morph values, and the morph runtime (`createMMDMorphRuntime`) writes the value `combineMorphChannels` folds from every layer. No other code writes morph influences, so each layer above is an input of one owner. Each bone group has one pose stage that composes its final transform on the clean pose, in `MMD_POSE_STAGE_IDS` order, and a clip enters through the ownership weights of `MMDBody` `updateOwnership`. This lands Target rule 3 for MMD under the final-owner reading of the Live2D rules. The gaze while she walks follows the travel direction only while no glance that outranks travel holds, so a glance the arbiter granted shows on the walk too (Autonomous behavior [Precedence](autonomous-behavior.md#precedence) rules 9 and 21).

### Per state

| State | Effect | Code |
| --- | --- | --- |
| Natural driver | The body stages pose the whole body, Natural writes `naturalFace` and `blink`, and classic gaze and the classic face stages do nothing. The character mind decides her idle acts, sleep, and errands; Natural performs each order and reports what it did, and the scene realises the errands it starts. | `packages/stage-ui-mmd/src/components/scenes/MMD.vue`; `packages/stage-ui-mmd/src/composables/mmd/stage-composition.ts` `composeMMDStages` |
| Classic driver | The body stages and the `natural` stage do nothing. Clips, classic gaze, the classic emote, and the classic blink drive her, and the director does not run. Emotion maps call `animation.playAction` directly, while the global idle selection uses `setIdleMotion`. Stance slots, curated ACT actions, tools, idle clips, and debug clips are Natural only. | `packages/stage-ui-mmd/src/components/scenes/MMD.vue` |
| Driver switch | The scene clears the `naturalFace`, `blink`, `expression`, and `lipSync` channels, starts a fresh `MMDNaturalAdapter`, and rewinds the performer. | `packages/stage-ui-mmd/src/components/scenes/MMD.vue`; `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBody` (`resetPerformance`) |
| Looping stance clip (sit, sleep, or idle base) | The clip ducks the whole body, and the head keeps half of its gaze (`STANCE_HEAD_ATTENTION`). | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBody` (`updateOwnership`) |
| Upper-layer clip (a gesture or upper action) | The layer takes only the bones its upper partition keys. Breath, sway, planted feet, and the walk continue. | `packages/stage-ui-mmd/src/composables/mmd/animation-manager.ts` `createMMDAnimationManager` (`playLayer`); `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBody` |
| Full-layer clip or dance | The clip owns every bone it keys. The gait stops from the `playing` phase on, and the director holds pending goals until it ends. | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBodyInput` (`fullLayerPlaying`); `packages/motion-driver-humanoid/src/director/index.ts` `decideBody` |
| Clip-free rest or doze | The performer's rest layer poses the body from `BodyIntent.rest`, without a clip. | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBodyInput` (`rest`) |
| Walking | The gait drives the root, pelvis, and feet, and the performer layers its channels on the gait frame. The gait's channels include the walk style's trunk lean and neck pitch, which the performer adds by the gait weight like the twist's head counter; the gaze still aims the head on top of them. | `packages/stage-ui-mmd/src/composables/mmd/body/locomotion.ts` `MMDLocomotion`, `writeGaitChannels` |
| Window host (no stage world) | The root never moves, so the gait never leaves idle. | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBodyInput` (`rootMotion`) |
| QA flags | `disableLookAt` keeps the clip's head, neck, and eyes. `disableFootContact` turns the foot planner off. | `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` `MMDBodyInput` |

### Per-frame order

1. The render loop (`packages/stage-ui-mmd/src/components/scenes/MMD.vue` `renderLoop`) updates the expression store, then, only with body declared, the director (`MMDStanceDirector` `update`), applies a base-clip change with `setBaseMotion`, plays or stops the accepted clip action (`obeyAction`), lets the action port read the director's answers, reports the body and realises idle errands (`reportBody`, `realiseErrands`), lets the body tool port read the answers, and sends the locomotion goal to `MMDBody` `setLocomotionGoal`. After the animation update in step 2, it reports touch events to the stage (`MMDTouch` `update`) and hands Natural the pet hand only while the mind's pet runs (`petGranted`); `reactToTouch` performs the mind's `touch-reaction` intent.
2. The animation manager's `update` advances base fades (`advanceBaseFades`) and layer fades (`advanceLayers`), then calls `MMDFramePipeline` `step`, with `dt` clamped to 1/20 s.
3. `step` runs `beforeUpdate`, then `restore`, which returns bones and morphs to the last clean pose.
4. `commands` runs playback commands deferred to this clean frame, including layer teardown.
5. `mixer.update` and `updateAnimation` run, then `capture` stores the clean pose, the morph influences, and each clip's effective weight. A weight in `clipWeightOverrides` wins, so ownership reads a clip's nominal weight rather than its partitions.
6. The pose stages run in `MMD_POSE_STAGE_IDS` order (`packages/stage-ui-mmd/src/composables/mmd/stage-composition.ts`):
   - `natural`;
   - `locomotion`, which reads ownership and runs the gait and performer ticks;
   - `body-torso`;
   - `foot-contact`;
   - `body-head`;
   - `body-arms`;
   - `eyes`;
   - `classic-gaze`;
   - `classic-face`;
   - `lip-sync`;
   - `bone-morphs`.
7. `beforePhysics` (fixed axes, then grants and IK) runs. Next come a physics reset, when a loop wrap or a request asks for one, and `physics.update`, capped at `MMD_PHYSICS_MAX_STEPS_PER_FRAME` steps of `MMD_PHYSICS_FIXED_STEP`. `afterPhysics` follows.
8. The surface stages run in `MMD_SURFACE_STAGE_IDS` order: `body-diagnostics`, then `morphs`, then the read-only `motion-trace`.

`composeMMDStages` is the only owner of this order. The scene and the headless runner both register it, and `qa:stage capture` refuses a scene that reports a different list.

### How layers fade

- **Clip layers.** `stepLayerFade` (`packages/stage-ui-mmd/src/composables/mmd/layer-fade.ts`) moves a layer's weight along a smoothstep, so a takeover starts and ends with zero weight velocity. `LAYER_FADE_SECONDS` sets an upper layer to 0.25 s in and 0.3 s out, a full layer to 0.4 s in, and a dance to 0.6 s in. A full layer or a dance eases out over its own fade-in time. A caller's `crossfade` (`PlayLayerOptions` in `packages/stage-ui-mmd/src/composables/mmd/animation-manager.ts`) replaces the fade-in.
- **Layer replacement.** A new layer starts while the previous one eases out. A finished or stopped layer is torn down on the next clean frame.
- **Base under an upper layer.** The running base is split by the bones the upper partition keys. Those base cells ease out on the same smoothstep (`ease` in `createMMDAnimationManager`), and every other base track keeps full weight. The base recombines when the layer ends.
- **Base clips.** A stance or idle change cross-fades the base with three.js `fadeIn` and `fadeOut` over `BASE_CROSSFADE` (0.6 s).
- **Body yield.** Ownership reads the layer's nominal weight each frame, so the performer yields a group in step with the clip's fade. The performer's own layers ease in and out on their own ramps, and `setPerformanceLayer` turns one on or off.

## Target

This section states the design that refactors move toward. It does not describe the code. The [character mind ADR](../adr/2026-11-17-character-mind-direction.md) records the decision. When a refactor lands a rule, the rule moves into the sections above and the gaps it closes leave the list below.

3. **One writer per channel per frame in the remaining renderers.** Every [channel](glossary.md#channel) has exactly one owner, and a second contribution enters through the owner's inputs. Still open: Live2D under Universal and MAGIC and MMD classic keep upstream's chains of writers, which ADR decision 14 keeps unless the owner decides otherwise; and VRM, Spine, and tachie have no channel owners until the VRM adapter (3D roadmap M5). Landed for Live2D under Natural as the Live2D rule "One owner composes each Live2D channel under Natural", and for MMD morphs and bones under Natural as the MMD rule "One final owner per MMD channel under Natural".
6. **Feel targets survive the rewrite.** A held emotion fills roughly 50 to 70 % of a parameter's range at the clear band and nearly all of it at strong. Each emotion reads unmistakably on the whole face at corner size, even when a rig's expression files only switch decorations. `dizzy` is not part of the emotion vocabulary. Sources: owner rulings in the 2026-10-19 natural emotion revamp plan.
7. **The app ships no motion clips.** MMD motion is a procedural core plus VMD clips the user imports locally; model terms forbid redistributing clips. Source: owner ruling in the MMD natural full-body plan.

| Known gap | Closed by |
| --- | --- |
| Stale text in the 3D motion, clip actions, and idle agency ADRs | No target rule. ADR bodies are frozen history; the current sections above state the code. |

## Known gaps

Each entry names a rule that an ADR states and the code does not follow. This section only describes the gaps; it does not decide how to close them.

- **The 3D motion ADR still lists the old MMD stages and writers.** The [3D character motion ADR](../adr/2026-10-30-3d-character-motion.md) lists the pose stages `natural`, `weight-shift`, `foot-contact`, `look-at`, `eyes`, and so on, and two surface stages. It also says `MMDNaturalAdapter` writes the neck, head, spine, and chest. In the code, the stage order is `MMD_POSE_STAGE_IDS` and `MMD_SURFACE_STAGE_IDS` in `packages/stage-ui-mmd/src/composables/mmd/stage-composition.ts`, which add `motion-trace`. `MMDNaturalAdapter` writes no bones; `MMDBodyPerformer` writes them. The [whole-body performer ADR](../adr/2026-11-11-whole-body-performer.md) records the change, but the 3D motion ADR carries no amendment.
- **The 3D motion ADR still says every non-stance clip ducks the whole body and head.** The [3D character motion ADR](../adr/2026-10-30-3d-character-motion.md) ("Rig profile and body layers") says other clips duck the body and the head fully. `MMDBody` `updateOwnership` in `packages/stage-ui-mmd/src/composables/mmd/body/index.ts` ducks each group by the clip's mask, so a clip that does not key the head leaves the gaze alone.
- **The clip actions ADR names different ducking groups.** The [clip actions ADR](../adr/2026-11-03-mmd-clip-actions.md) ("Layered playback and the base partition") says breath, sway, and weight shift duck by the larger of the stance weight and the owned share of `root` and `upperBody`. `MMDBody` `updateOwnership` uses separate weights: pelvis is max(stance, `root`, `lowerBody`), hips is max(stance, `lowerBody`), and torso is max(stance, `upperBody`).
- **The idle agency ADR's original sections contradict its amendments.** The [idle agency ADR](../adr/2026-11-12-idle-agency.md) says an MMD model with a registered sleep clip turns the drive's sleep permission off, and that an MMD look-at stage runs after the Natural pose. Its 2026-11-13 amendment replaced both statements, but the original text still stands. The scene no longer withholds sleep, the drive no longer has a sleep permission, and no look-at stage exists: `MMD_POSE_STAGE_IDS` has `body-head` and `eyes`.
