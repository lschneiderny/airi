# Live2D parameter ownership

This is a living document. It records which writer owns each Live2D parameter channel, in what order the writers run, and the rules that decide ownership. The ADRs link here instead of repeating the rule.

Verified against the code on 2026-11-01 (commit `95e7808d5`). Line numbers are for that tree and drift as code changes. `ADP` is `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, `MM` is `motion-manager.ts` in the same directory, `MV` is `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, `EC` is `expression-controller.ts`, and `RIG` is `natural-motion/rig-profile.ts`.

Drivers are Natural, Universal, and MAGIC. Under Universal and MAGIC, Natural is inactive, so its posture weight eases to zero (ADP:317-327) and its face writes stop (ADP:372-373). Those drivers play motion-group curves through the Live2D parameter store.

## (a) Channel ownership

| Channel | Parameters | Natural | Universal and MAGIC | Composition | Sources |
| --- | --- | --- | --- | --- | --- |
| Eyelids | `ParamEyeLOpen`, `ParamEyeROpen` | Writes each open lid from its current value, with the Natural eyelid factor and blink factor. Skipped when a clip owns the parameter. Only while active. | Motion curves, then expression, then auto blink and light squint, then manual control. Manual control multiplies the open value by `1 - eyeSquint` (MM:725-727). | Natural: function of the current value (not absolute). Manual control: multiply. | ADP:402-405, MM:713-737 |
| Blink | `ParamEyeLOpen`, `ParamEyeROpen` | Natural blinks feed the eyelid write through `blinkFactor`, only when `autoBlink` is on (ADP:401, 404). | AutoEyeBlink runs in the final stage after expression (MV:607-608). It reports handled through `markHandled()` (MM:393). | Blink factor, applied inside the eyelid write. | ADP:401, MM:294-486, MV:607-608 |
| Light squint | `ParamEyeLOpen`, `ParamEyeROpen` | Not written by Natural. | Runs in the final stage after blink (MV:613-619). | Narrows the value that blink returns to. | MM:515, MV:613-619 |
| Brows | `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowRForm` | Additive offsets on `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLAngle`, and `ParamBrowRAngle` (ADP:94-97, 406-409). Natural does not write the form channels. | Motion curves and expression. Model.vue sets the brows from settings at load and on change (MV:773-780, 1101-1150). | Additive offset under Natural. Absolute from settings elsewhere. | ADP:94-97, 406-409, MV:773-780, MV:1101-1150 |
| Mouth open | `ParamMouthOpenY` | Adds `silentMouthOpen` to the current value only when neither speech nor the lipsync window is active (ADP:334, 410-413). | Motion curves and expression. Lipsync writes it while speech is active, during release, and during the handoff hold (MM:782, 795, 807). | Lipsync: absolute while speaking, blended during release (MM:801-807), zero during hold (MM:795). Natural: additive, masked. | MM:757-810, ADP:334, 410-413, MV:621-623, MV:631 |
| Mouth form and cheek | `ParamMouthForm`, `ParamCheek` | Additive face offset from the current value, clamped to the range (ADP:406-409). | Motion curves and expression. Manual control writes `ParamMouthForm` absolutely (MM:734). | Additive offset. | ADP:406-409, MM:734 |
| Smile | `ParamEyeLSmile`, `ParamEyeRSmile` | Additive face offset (ADP:406-409). | Motion curves and expression. | Additive offset. | ADP:406-409 |
| Gaze (eyeball) | `ParamEyeBallX`, `ParamEyeBallY` | Natural does not write these directly. At full weight, Natural skips the SDK focus call (ADP:366-369). | SDK focus adds to these values when `updateFocus` runs. Manual control writes them absolutely (MM:723-724). IdleDisable and IdleFocus manage the idle curves (MM:257-292). | SDK focus is additive (SDK:5439-5440). Manual control is absolute. | ADP:366-369, MM:723-724, SDK:5439-5440 |
| Head angles | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ` | Posture. At weight 1, the command overwrites the parameter. Below 1, it eases from the current value. Clip-owned channels keep `clipResidual` (0.1) of the offset, scaled by weight (ADP:385-391). | Motion curves. Manual control writes absolutely (MM:728-730). SDK focus adds `x * 30` and `y * 30` (SDK:5441-5443) when weight is below 1. | Absolute overwrite at full weight (`written = natural`, ADP:391). Eased blend below full weight. | ADP:376-396, MM:728-730, SDK:5441-5443 |
| Body angles | `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ` | Posture, same rule as head. A `null` command skips the write because physics derives that axis (ADP:381-384). | Motion curves. Manual control writes absolutely (MM:731-733). SDK focus adds `x * 10` to `ParamBodyAngleX` (SDK:5444). | Absolute overwrite at full weight, as for head. | ADP:376-396, MM:731-733, SDK:5444 |
| Breath | `ParamBreath` | Absolute write from the Natural breath value, skipped while manual breath control is active (ADP:414-415). | Motion curves. Breath control writes the manual curve only while active (MM:79-99). The SDK breath pass is deleted for every driver (MM:69-71, MV:529). | Absolute. | ADP:414-415, MM:69-99, MV:529, MV:787 |
| Expression parameters | Any parameter in an `.exp3.json` file | Not written by Natural. | Expression composes in the final stage (MM:698-705, EC:89-101). Each parameter uses its blend mode: Multiply, Overwrite, or Add (EC:70). | Add, multiply, or overwrite per parameter, on the value the motion writers left this frame (`expression/compose.ts:113-140`). | EC:70, EC:85-101, MM:698-705, MV:599 |
| Physics outputs | Destinations of physics outputs with non-zero weight | Never written. Natural drops these channels from its channel list (ADP:221-226, skipped count at ADP:365). | Physics writes them after the SDK focus step (SDK:5432). | Not composed by Natural. | RIG:126-131, ADP:221-226, ADP:365, SDK:5432 |
| Clip-owned parameters | Parameters a gesture clip animates | Posture uses the 0.1 residual (ADP:388-389). Face writes skip clip-owned channels (ADP:400, 402-415). | Motion curves only. | Residual for posture, skip for face. | ADP:388-389, ADP:400-415, MV:689 |

### Per state

| State | Effect | Sources |
| --- | --- | --- |
| Expression system on | The SDK expression manager and SDK eye blink are removed. Expression writes go through the controller in the final stage. | MV:797-810 |
| Expression system off | The SDK expression manager and eye blink stay. The expression runtime does not initialize. | MV:797, expression ADR:196 |
| Speaking | Natural mouth write is masked. Lipsync owns `ParamMouthOpenY`. | ADP:334, 410, MM:778-785 |
| Lipsync release and hold | Natural mouth write stays masked for the 200 ms release and 500 ms hold. The adapter keeps no timer. | MM:787-808, `lipsync-handoff.ts:7,10`, ADP:35-38 |
| Clip playing | Posture uses the clip residual. Face writes skip clip-owned channels. Natural keeps running. | ADP:316, 388-389, 400-415 |
| Manual control active | Posture eases out (`eligible` is false). Face keeps composing. | ADP:317-318, 324-327, 368-373 |
| Spring active | Same as manual control. | ADP:318 |
| Manual breath active | Natural breath write is skipped. Breath control writes the manual curve. | ADP:414-415, MM:79-99 |
| Exclusive owner holds the model | Natural is inactive. Posture eases out, and face, blink, and breath composition stops. | ADP:317, 372-373 |

## (b) Per-frame order

1. SDK `Cubism4InternalModel.update` starts (SDK:5416).
2. SDK `motionManager.update`, which is replaced by the AIRI hook (MV:731-732), calls `hookUpdate` (MM:136-181).
3. Pre plugins run in registration order, and the loop stops when a plugin marks the frame handled (MM:128-134, MM:164):
   - `restoreExpressionBases` (MV:599) restores the frame base for every parameter expressions wrote last frame (EC:85-87).
   - BeatSync (MV:600).
   - IdleDisable (MV:601).
4. If no plugin marked the frame handled, the SDK motion update runs (MM:166-170). Post plugins run next, and IdleFocus (MV:602) is the only post plugin.
5. Final plugins always run, even when the frame is handled (MM:174-177), in this order:
   - Expression (MV:607, `applyExpressions`, EC:89-101). This is the first final plugin.
   - AutoEyeBlink (MV:608).
   - LightSquint (MV:613-619).
   - ManualControl (MV:620).
   - LipSync (MV:621-623).
   - BreathControl (MV:624).
   - Natural frame step (MV:723-729). It advances Natural time through `frame()` (ADP:283-289) and does not compose.
6. SDK `saveParameters` captures the frame base (SDK:5425).
7. SDK expression manager update (SDK:5426). This is absent when the expression system is on (MV:801-803).
8. SDK eye blink fallback, when no motion ran (SDK:5427-5429). This is absent when the expression system is on (MV:808-810).
9. SDK `updateFocus`, which the Natural adapter wraps (SDK:5430, ADP:215). The wrapper calls `compose()` (ADP:310-374), which sets posture (ADP:376-396) and face (ADP:398-416). It calls the SDK focus only when weight is below 1 (ADP:368-369).
10. SDK `updateNaturalMovements`, which holds the SDK breath pass (SDK:5431, 5446-5449). Breath is deleted for every driver, so this step does nothing (MM:69-71).
11. SDK physics evaluate (SDK:5432). Physics runs after Natural, so it sees Natural's writes.
12. SDK pose update (SDK:5433), then `model.update` and `loadParameters` (SDK:5435-5436).

## (c) Rules

- **R8: Natural owns posture absolutely while it drives.** At full weight, `composePosture` overwrites each posture channel with the Natural value (ADP:391). Expression tilts and beat-sync bob that land on those channels are overwritten on the same frame. This is the intended rule. Clip-owned channels keep the residual (ADP:388-389). BeatSync writes head angles only (reads MM:200-202, writes MM:251-253). The only `ParamBody*` writes in `motion-manager.ts` are at MM:731-733, in the manual control plugin.
- **R9: Lipsync owns the mouth window.** `lipsync-handoff.ts` sets the 200 ms release (line 7) and the 500 ms hold (line 10). The lipsync plugin (MM:757-810) writes `ParamMouthOpenY` and reports ownership every frame through `lipSyncOwnsMouth`. Natural reads that flag from `MV:686` and masks its mouth write (ADP:334, 410-413). The adapter keeps no timer (ADP:35-38). The 0.7 s window in the v2 ADR is the sum of the two constants and is still correct.
- **R10: SDK breath stays disabled for every driver.** `disableLive2DSdkBreath` deletes the SDK breath pass (MM:69-71) and is called from `MV:529`. Natural's breath write (ADP:414-415) and the manual breath curve (MM:79-99) are the only breath writers. The exception is recorded in the Natural v2 ADR's Non-goals section (line 183), dated 2026-11-01.
- **Cancellation releases clip ownership (2026-11-07).** `useLive2DMotionManagerUpdate` tracks the clip parameter ids and supplies them to Natural through `getClipOwnedIds`. An empty SDK `state.currentGroup` releases the mask even without `motionFinish`: `stopAllMotions` resets that state synchronously, but only a later SDK `update` emits the finish event. AIRI's disabled-idle plugin can handle every following frame and skip that update. Starting another clip reacquires its channels through `motionStart`.

## (d) How to change this

- Accepted ADRs are not edited in place. A new decision gets a new ADR, or a dated `Amendment (YYYY-MM-DD)` note under the affected section.
- Update this document in the same commit as any code change that moves an owner, changes an order, or changes a rule.
- Re-check every `file:line` here when the code moves. The line numbers were verified on 2026-11-01.
