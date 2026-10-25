# stage-ui-live2d

## Purpose

This package provides AIRI's shared Live2D renderer, model controls, expressions, and persisted settings.

## Usage

Use the shared model settings to select a motion driver.
Universal remains the default and uses model motions, idle eyes, and mouse tracking.
MAGIC retains its dataset-based motion controls.
Natural generates continuous autonomous motion from layered random processes and reacts to what the character and the user are doing.

### Expressions

ZIP imports and OPFS-restored archives discover every `.exp3.json`, including files absent from the model settings references. URL-loaded models discover only expressions referenced by their model settings; remote folders are not enumerated.
Each expression keeps its own activation and composes in activation order with its file's blend modes and fade times. Missing or invalid fade times use one second.
Save expression defaults stores the manually active expressions, including combos, as the model's rest set. Reset all expressions returns to that set.
Rest sets use `expression-rest:${modelId}` with `{ version: 1, active: string[] }`. Previous parameter defaults are not loaded; save the desired defaults once again.
The Expression system setting, stored as `settings/live2d/expression-enabled`, turns this runtime on. A fresh profile starts with the Expression system on. While it is off, the model keeps the SDK expression manager and eye blink, the catalog stays empty, and no expression fires automatically or reaches the LLM.

The [expression performance ADR](../../docs/ai/adr/2026-10-18-expression-performance.md) records the contracts below. The [expression combos and reactions ADR](../../docs/ai/adr/2026-10-24-expression-combos-and-reactions.md) records combos, areas, duplicates, masks, and the claims model, and it supersedes the passages that these sections replace.
The [Natural emotion revamp ADR](../../docs/ai/adr/2026-10-19-natural-emotion-revamp.md) records held emotions, gestures, and the per-model emotion strength.

### Expression catalog

Each discovered expression has a catalog entry with a label, a kind (`face`, `effect`, `outfit`, `prop`, `system`, `unsorted`, or `combo`), an optional area, an optional pick-one group, a reviewed flag, an optional inverted display flag, an LLM-exposed flag, and emotion mappings.
The label comes from the model settings `Name`, else from the archive's first `.vtube.json` hotkey for that file, else from the file name.
Kinds and groups are suggestions. Expressions of the same suggested kind that share a parameter form a pick-one group when at least one of them sets a non-zero value on it. Expressions that share only zero values form no group. Parameters of `system` expressions, such as a watermark hide, never form groups.
The English and Chinese label lexicon suggests mappings for face and effect entries. It skips negated labels, assigns weight 0.5 to face mappings in the eyes, mouth, or cheeks areas and weight 1 otherwise, and uses `clear` as the minimum band for faces and `strong` for effects. Default LLM access is chosen by kind. Review entries and edit labels, kinds, areas, "Choose one with" fields, mappings, and display inversion in Settings > Models > Live2D. Each mapping has an emotion, a weight from 0.1 to 5, and a minimum band.
Edits are stored per model in `expression-catalog:${modelId}` as `{ version: 1, overrides: CuratedOverride[] }`.

- `face` and `effect` entries are eligible for automatic selection. Duplicates and `unsorted` entries are never picked automatically.
- `face`, `effect`, and `prop` entries are eligible for LLM access when exposed. Outfits, system expressions, duplicates, and `unsorted` entries never reach the LLM.

An entry's `area` is one of whole looks, eyes, mouth, cheeks, effects, outfit and hair, props, hidden, or unsorted. The area is derived from parameter and display names, and an entry override can set it or clear it with `area: null`, which falls back to the derived area. The panel groups entries by area. The Reactions picker gives a new mapping weight 0.5 when the entry's area is eyes, mouth, or cheeks and weight 1 otherwise, and marks every mapping below weight 1 with a ½ marker.

When several expression files write identical parameters, they collapse into one primary entry. The primary lists the others as aliases, shown as "Also: ...", and each alias offers a "Show {label} separately" action that removes the collapse for that member.

A combo is a catalog entry of kind `combo` with members whose strengths range from 0 to 1. Its slots are the distinct slot kinds of its usable members. A combo with an outfit, system, or unsorted member is manual-only: only the user and saved defaults can turn it on, and the Combos card shows a manual-only note without the AI marker. A combo's area is its stored area, else the shared area of its members, else whole looks.

A custom expression drives one parameter that no other expression uses. It is stored in `expression-catalog:${modelId}` as a custom document with a label, kind, area, value, and mappings. The parameter list offers only free switches.

Activations resolve through claims. A slot activation that conflicts with a pick-one member masks that member instead of skipping the activation, and releasing the claim restores the member. A switch hidden by another active expression shows a "Hidden by ... while it is active" line.

The stage window owns `useExpressionStore`. Other windows render its `settingsSnapshot` and send `Live2DExpressionSettingsCommand` values, including `toggle`, `set-active`, `save-defaults`, `reset-all`, `update-entry`, `reset-entry`, `create-combo`, `update-combo`, `update-custom`, and `delete-custom`.

### Expression slots

The expression store executes the decider's slot commands in three slots: `face`, `effect`, and `prop`. The scene exposes `applySlots`, `onSpeech`, and `setMuted` for the stage performance conductor.
The scene also exposes `applyHolds`, which sets or releases the held emotion; see Held emotions below.
Each slot holds at most one transient lease on top of the rest set and manual toggles. Releasing a lease never turns off an expression that the rest set or a manual toggle also owns.
A speech-bound lease lasts while its own speech turn plays. It releases after the turn ends, plus a short grace, or at once when the turn's playback is stopped. A muted lease, or a lease with an explicit hold, releases after its hold. Every lease releases within `slots.holdCap` seconds.

### Natural layers

Natural is composed of independent layers. Each layer draws from its own seeded random stream, so retuning one layer does not reshuffle another.
The `Live2DNaturalMotion` controller advances every layer on a fixed 120 Hz grid and interpolates between grid states, so the frame rate does not change the motion.

- Posture moves the head through a slow home drift, continuous sub-second motion whose activity waxes and wanes, and occasional heavy-tailed posture shifts along min-jerk paths. Activity changes only while a shift moves, so a held pose never starts shivering mid-hold.
- Gaze picks fixation targets (camera, desk, and peripheral points) independently of the head and compensates the eyes for the slow head pose (posture shifts, drift, cursor bias, plus emphasis, impulse, pet, hold, and gesture heads), not for the sub-second continuous wobble.
- Body follows the head with a lag of 150 to 300 milliseconds, drawn again at each posture shift.
- Face adds slow brow, mouth-form, and eyelid micro-activity, plus occasional silent mouth openings. Mouth-form and eyelid micro-activity are low-passed (0.3 s), so they do not flicker frame to frame.
- Blink schedules blinks at irregular intervals, with occasional double blinks, and starts a nearly due blink early at a large gaze shift.
- Breath drives the breath channel and couples a very small pitch movement to the head.
- Speech emphasis turns onsets in the lipsync mouth level into occasional small head beats while the character speaks: 80% are pitch-down nods and 20% are roll tilts to a random side.
- Impulses add short head gestures and decaying face hints for emotions and desktop reactions.
- The hold layer keeps the face, posture, and pacing of the current held emotion; see Held emotions below.
- Gestures play short emotion-specific head clips, such as a laugh chuckle or a sleepy nod-off. The laugh also pulses the smile and, while the character is silent, the mouth.
- Mood keeps a decaying afterglow of recent emotions that tints posture, gaze, speech emphasis, and mouth form.
- Touch reacts when the user pokes the model or pets its head with the cursor; see Touch below.
- Energy scales posture amplitude, posture shift rate, and gaze target choice from the performance state and the user's Energy setting.

### What Natural owns and what it never writes

`Live2DNaturalMotionAdapter` writes all Natural values inside the SDK focus update, which runs before physics.
The SDK brackets each model update with `saveParameters()` and `loadParameters()`, so every Natural write is an overlay on that frame's post-motion values. Natural values never feed back into the next frame.

Natural owns these channels when the model has them:

- head XYZ (`ParamAngleX`, `ParamAngleY`, `ParamAngleZ`);
- body XYZ (`ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ`), except an axis that rig physics derives from the head;
- eye XY (`ParamEyeBallX`, `ParamEyeBallY`);
- face micro-offsets on brows, eye smile, and mouth form, and the eyelid composition (eye smile comes only from emotion hints);
- cheek (`ParamCheek`), which a pet and a held emotion with a cheek value raise; otherwise Natural leaves it at its base value with a 0 offset. Natural resolves blush using the rule below, never cheek inflation. ZIP and restored-directory models retain CDI names. Traces sample the resolved physical parameter under the canonical `ParamCheek` channel;
- Natural blink, while the user's auto-blink setting is on;
- breath (`ParamBreath`), unless manual breath control is active.

Blush resolution first excludes every candidate whose id or CDI display name contains any of these case-insensitive substrings: `puff`, `inflat` (including inflate and inflation), `swell`, `鼓`, or `膨`. This exclusion also applies to exact `ParamCheek`, even if another metadata entry labels the same id as blush. Among the remaining candidates, preference is:

1. Exact `ParamCheek`, including when CDI is absent or its name is neutral or blush-related.
2. The first conventional alias in model parameter order: optional `param` prefix with optional `_` or `-`, followed by `cheek` with optional digits, `blush`, or `hoppe`, matched case-insensitively against the entire id.
3. The first CDI entry in metadata order whose id exists in the model and whose trimmed display name exactly matches `Cheek`, `Blush`, `hoppe`, `脸红`, `臉紅`, `赤面`, or `頬染め`, case-insensitively.
4. No blush channel.

Missing or malformed optional CDI is ignored without throwing; conventional-id resolution remains available.

Natural never writes these channels:

- any parameter that model physics outputs;
- a body axis that physics derives from the head; the adapter skips it and the model's physics remains authoritative;
- mouth opening (`ParamMouthOpenY`) while the character speaks and for 0.7 seconds after speech ends, so lipsync owns mouth opening; other face offsets, including mouth form, still compose;
- a face channel that a playing explicit motion clip animates.

Head, body, and eye posture fades out while manual or spring motion control is active or an exclusive owner holds the model.
On a channel that an explicit clip animates, posture keeps only 10% of its offset.
Eyelids that an expression closes stay closed, and a blink closes open eyelids fully.
While Natural is selected, the SDK blink plugin is off and Natural's own blink scheduler replaces it.

### Natural observer and QA seams

`Live2DNaturalMotion.setObserver(observer)` reports what the controller performed. Pass `null` to stop reporting. The adapter exposes its controller as `natural`.

- `impulse`: an emotion episode started, with its band, clamped intensity, and side.
- `hold`: the held emotion or its side changed. A release, or held emotions switched off, reports `emotion: null`.
- `gesture`: a gesture clip started. For angry, it names the clip it chose, `shake` or `drop`.
- `attention`: the cursor episode changed phase to `notice`, `engage`, `release`, or `dismiss`, with its distance in head widths.
- `touch`: the controller performed a `poke`, `pet-start`, or `pet-end`, with an optional `head` or `body` region.

Each observer event carries `at`, the active time of the grid step that first performs it. The controller observer's `touch` event is separate from the scene's `touch` emit. The scene emit forwards gesture-classifier events, including pet duration.
The observer receives values the controller already computed. It adds no random draw, and no event is built while no observer is attached, so motion is bit-identical with or without one.
An observer that throws is reported with `console.error`, and the step continues.

The `emotionTable` constructor option replaces the `naturalEmotions` recipe table for scorer mutation tests. Production code leaves it at the default.

These subpath exports load in plain Node without pixi, Vue files, or `window`, so QA tools can run the controller outside the renderer:

- `@proj-airi/stage-ui-live2d/composables/live2d/natural-motion`;
- `@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/*`, for example `natural-motion/trace` or `natural-motion/speech-fixture`;
- `@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter`;
- `@proj-airi/stage-ui-live2d/composables/live2d/expression/hold`.

### Performance state

The stage resolves a `PerformanceState` from `@proj-airi/stage-shared/performance-state` and passes it to the Live2D scene as the `performance` prop.
Its mode is `talking`, `listening`, `thinking`, `watching`, or `idle`.
Each mode has its own posture amplitude, shift rate, and camera-fixation probability, and Natural cross-fades between them, so a mode change never makes the pose jump.
While the user is away from the desktop, Natural settles to smaller and less frequent movements.
A wake (screen unlock or resume) lifts the head slightly and glances at the camera. A sharp screen change glances at the desk.

### Energy

Natural has an Energy setting, stored as `settings/live2d/natural-energy`, from 0 (calm) to 1 (energetic). The default is 0.5.
The settings page shows it as a slider only while Natural is selected.
Energy `E` scales posture amplitude by `0.7 + 0.6E` and posture shift rate by `0.6 + 0.8E`. It also sets the probability that a speech onset becomes an emphasis to `0.15 + 0.2E`.
At the default of 0.5, Energy leaves every layer at its unscaled behavior.
Resetting Live2D settings restores the default Energy.

### Emotions by intensity band

When Natural drives the model, the stage performance conductor sends each chat emotion to the scene's `setEmotion(episode)` as a `NaturalEpisode` instead of playing the emotion's motion group. A `NaturalEpisode` is a `ReactionEpisode` with an optional `moodGain`.
The episode's band decides which body parts react:

- `slight`: face hints only;
- `clear`: face hints, a head pulse, and a glance;
- `strong`: face hints, a head pulse, a glance, and a body lean. No band raises the posture amplitude or shift rate scales; only desktop reactions and pokes do, through a fixed x1.3 / x1.5 overlay for 2 s.

With held emotions on, the held posture also moves the body at clear, and emotions with a gesture play the gesture instead of the head pulse and body lean. While that gesture is cooling down, such an episode adds no gesture, head pulse, or body lean.
ACT markers name the band with `slight`, `clear`, or `strong`. A marker without an intensity means clear.
Repeats of the same emotion habituate. A stronger repeat within 2 seconds escalates the running reaction and adds only the missing amplitude. Neutral starts no reaction.
An impulse adds to every other layer, so it never resets the pose.
The body lean skips a body axis that rig physics derives from the head.
With the `bands` switch off, Natural treats every episode as clear.
Band timings and gains come from `naturalBands` in the `settings/expression-performance` document.
Universal and MAGIC still play the emotion's motion group for every emotion, repeats and neutral included.
The `love`, `flustered`, and `sleepy` emotions play the Happy, Awkward, and Idle motion groups there.

### Held emotions

While the `heldEmotions` switch is on, which is the default, Natural holds each emotion for as long as it lasts instead of showing a short reaction.
The decider sends a hold with each episode, and the conductor passes it to the scene's `applyHolds` only while Natural drives the model:

- An emotion of a speech turn is held while that turn speaks, plus a short grace. An emotion without a turn, such as a lab pulse, is held for `held.turnlessSeconds` seconds, 4 by default.
- An explicit expression whose catalog entry maps to an emotion holds that emotion for as long as the expression's own slot lease lasts. Its primary mapping is the one with the highest weight.
- Neutral, and a clear that names no slot, release the hold.
- A manual expression toggle in Settings previews the emotion of its primary mapping while it stays on. Saved defaults never hold an emotion.

The held emotion eases in over `held.onsetTau` and out over `held.releaseTau`, and a switch to another emotion glides without a jump.
While it lasts, Natural adds the emotion's face to brows, eyes, eye smile, mouth form, and cheek, and keeps a head and body posture bias at every band. It also changes blink intervals, breath period, posture amplitude, camera and desk gaze, and the size and frequency of speech nods.
A pet overrides the held face on the channels that the pet shapes. A repeated pulse of the held emotion adds a smaller accent, so the face does not saturate.
The `naturalEmotions` table in `natural-motion/emotions.ts` holds every per-emotion value: the impulse, the mood coefficients, the held recipe, and the gesture.

Gestures are short head clips: a laugh for happy, a recoil for surprised, a head shake or drop for angry, a sway for awkward, a tilt-in for love, a look-away for flustered, and a nod-off for sleepy. Sad, think, question, and curious have none.
A gesture plays only at the clear and strong bands, and each kind has a cooldown. The body follows a gesture only at strong.
The laugh is a chuckle of 2 or 3 head bounces at 2.6 to 3.2 Hz, with a smile that follows its lift and a mouth opening on each bounce. Its smile applies with held emotions on and the mouth only while no speech is active or recent; both stay inside the rig's parameter range. The other gestures move only the head and body.
Gestures draw from their own random stream, so idle motion and the other layers keep their sequences.
While a gesture clip is active, Natural ducks the idle continuous head motion (not drift or posture shifts) by up to 0.45 at strong with full strength, 0.27 at clear. The duck eases in over 0.15 s, holds until the clip's head offset has fallen under 10% of its peak (at most 2 s), and eases out over 0.3 s. It applies only with held emotions on, so the clip stays visible above the idle jitter.

Turn the switch off to compare with the earlier behavior: Natural then shows only the short band reaction.

### Emotion strength

Each model has its own emotion strength per emotion, stored as `settings/live2d/natural-emotion-strength` by stage model id. Values range from 0 to 2, and a missing value means 1.
The strength scales the held emotion. While held emotions are on, a strength of 0 means Natural does not perform that emotion at all: no reaction, no gesture, no mood dose, and no held face.
While Natural is selected, the settings page shows an Emotion strength group with one slider per emotion and a reset button for the selected model.
Resetting Live2D settings clears every model's strengths.

### Mood

Natural keeps a mood with valence, arousal, and tension. Each episode adds a dose by band, intensity, and emotion, and the mood decays exponentially in active time.
The mood coefficients of every emotion, including `love`, `flustered`, and `sleepy`, live in the `naturalEmotions` table.
A non-zero mood scales posture amplitude and shift rate, biases camera fixation, modulates speech emphasis acceptance, and shifts mouth form. Emphasis acceptance follows arousal: positive arousal raises it, and negative arousal, such as a sad mood, lowers it.
A held emotion's pacing changes apply after the mood's, and the mood's mouth-form tint stays additive.
At exactly zero mood, Natural skips modulation and draws no randomness, so idle motion is unchanged.
The `mood` switch turns accumulation and modulation off. The constants come from `moodDynamics` in the same settings document.
Character card profiles scale mood strength and mood length:

- Each episode's `moodGain` is its band's mood gain under the profile its signal was decided in, and `NaturalMood.add` doses the episode with it. An episode without `moodGain` uses the performer's own band gain.
- Mood decay and the band shapes follow the active card's profile, because the scene receives the settings document under that profile.

### Cursor attention

Natural has its own Cursor attention setting, enabled by default.
It does not change Universal's mouse tracking preference or saved idle animation.
When cursor attention is enabled, Natural maps the cursor from the center of measured eye-feature drawables, in units of the interaction head box width. The tracker uses an authored head or face hit area when available; otherwise it identifies visible face features moved by standard eye-open, eyeball, brow, and mouth parameters, without settling physics. That face-feature box expands by `faceToHeadScale` (1.6) around its center. If face measurement fails, the physics-inclusive head box is used. The presence bubble continues to use that physics-inclusive box. It notices every near cursor and independently decides whether to engage medium and far cursors. Engagement starts with a notice glance, then progresses to full attention. Pursuit stays under 1.5 eye units per second. Once the cursor has moved one way for about 0.1 seconds, catch-up saccades aim up to 0.1 eye units ahead and land still pursuing at the cursor's speed, so fast sweeps are not chased by stale endpoints; a jump or reversal never extrapolates. Attention fades when the cursor rests or disappears; `Live2D.vue` does not expire Natural's cursor position after one second.
Resetting Live2D settings restores Universal and enables both cursor preferences.

### Touch: poke and pet

Natural has a Poke and pet setting, stored as `settings/live2d/natural-touch` and enabled by default.
A second setting, `settings/live2d/natural-touch-pet-requires-hold`, counts strokes as petting only while the left mouse button is held. It is off by default.
A third setting, Head area for petting, scales the touch head box around its center for the selected model, from 0.5× to 2×. This box uses an authored head or face hit area, otherwise the face-feature measure expanded by `faceToHeadScale` (1.6) and extended up to the top of the physics-inclusive head box, otherwise the physics-inclusive head box. The setting is stored per stage model id in `settings/live2d/natural-touch-head-scale`.
The settings page shows these settings only while Natural is selected. Touch does nothing under Universal or MAGIC, and nothing while the stage is paused.

`Live2DTouchGestures` classifies pointer input on the Live2D canvas, mapped into model canvas space:

- A hover poke commits at 90 ms while the press is held and remains eligible, or on an earlier eligible release within 400 ms and 5% of the scale. With the held-button setting, a poke commits only on an eligible release within 400 ms and 5% of the scale. Before commit, travel beyond 5% permanently rejects the press as a drag, even if the pointer returns.
- A pet is at least 0.35 head widths of travel within 1.5 seconds, with at least half of the trail time inside the true head box. The trail allows overshoot into a margin zone around the head. Without a held button, travel must reverse direction at least once, so a cursor passing over the head is not a pet.
- A pet ends after 600 ms without movement over the head, 250 ms after the pointer leaves the expanded margin zone (or the head region when head geometry is unavailable), when the held button is released, or when the pointer leaves the canvas.

The scene updates the classifier every rendered frame while a pet is active or a poke press is pending. This lets a resting pointer end an idle pet or commit an eligible hover poke.

The touch head region follows this fallback order: authored `head` or `face` hit area, face-feature measure expanded by `faceToHeadScale` (1.6), then physics-inclusive head box. Face features stop near the brows, so with the face measure the touch box keeps that box's width and bottom but starts at the top of the physics-inclusive head box, where the hair or hood ends; the crown can then be petted. The cursor unit keeps the unextended box. Face features are visible drawables moved by the rig's standard eye-open, eyeball, brow, and mouth parameters, measured without settling physics. Parameter presence is checked against the real parameter table because Cubism returns virtual indices for absent ids. The per-model head-scale setting applies after this selection. The presence bubble still uses the physics-inclusive head box.
The body is the box around the drawables the renderer currently draws, not the padded model canvas.

To see these regions, open Devtools > Natural Motion Lab and turn on Show touch regions. The main window's stage then draws an SVG overlay with the head box after the head scale, the pet margin zone, the cursor-unit box, the body box, the eye anchor, the canvas pointer, the host cursor, and the pet trail. The overlay is in viewport pixels, mapped through the same transforms as touch, so a pointer dot that drifts from the real cursor shows a mapping fault. The lab shows where the head box came from (authored hit area, face features, or head with hair), how many drawables each measurement selected, each box in model units and screen pixels, the region under the pointer, and the pet checks against their thresholds. Copy snapshot puts that readout, with the trail and transforms, on the clipboard as JSON. The overlay state is not saved, and a reloaded main window starts with it off. `buildLive2DTouchDebug` in `composables/live2d/touch-debug.ts` builds both the overlay and the snapshot; the store carries them with the `touchOverlaySetEvent` and `touchOverlaySnapshotEvent` Eventa events.

A poke turns and rolls the head away from the poke point; vertical position also sets pitch, so a top-of-head poke pushes down. It starts a short surprise impulse and glances at the camera for 0.9 seconds. A head poke moves more than a body poke.
A pet fades in over about a second and out over about two. While it lasts, the eyes close to a quarter of their openness and smile, the mouth smiles, the cheek and brows rise, the head bows slightly and rolls with the hand, and posture drift calms.
Cursor attention melts into the hand during a pet, with both horizontal and vertical hand position shaping the head response. A pet lasting more than 3 seconds ends with one 1.2 second camera glance.

In the Electron stage window, clicks reach the canvas only over opaque pixels, because the window is click-through elsewhere. Hover pets still work there, because the window forwards pointer movement while it is click-through.

`Live2DScene` emits a `touch` event for every poke, pet start, and pet end. No consumer reads it yet; it exists for a later chat reaction.

### Liveliness score and reference stats

`scoreLiveliness` in `natural-motion/liveliness.ts` scores a timestamped parameter trace against reference bands. The bands come from recordings of a human performer in `natural-motion/reference-stats.ts`.
The report lists every metric with its value and band, any hard failures, a score, and `pass`.
The liveliness gate test scores generated Natural motion with it, so every motion change is checked in the test suite. The gated metrics, seeds, and timings come from `naturalIdleLivelinessGate` in `natural-motion/gates.ts` (see Natural QA).

Score a trace from the repository root. The trace is JSON with `t` (seconds), `channels`, `ranges`, and optional `valid`. The command prints the report and exits 0 only when `pass` is true.

```bash
pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts <trace.json>
```

Add `--reference` to score a recording against the reference bands as measured. Generated mode judges blinks on physiological bands, which the tracker recordings do not meet, so a recording fails without `--reference`.
Generated mode also reports mouth-opening SD without a band: Natural opens the mouth during silence only slightly and rarely, so it cannot match the tracker's mouth noise.

```bash
pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts --reference <trace.json>
```

To regenerate the reference stats, first export each `.riggold` recording to a trace from the repository root. The export requires `uv` and Python 3.13; `uv` installs `pyarrow` and `numpy` from the script header.

```bash
uv run --python 3.13 packages/stage-ui-live2d/scripts/export-riggold-trace.py <recording.riggold> <trace.json>
```

Then extract the reference from every exported trace. This command overwrites `natural-motion/reference-stats.ts` and prints the session ids and any band widenings.

```bash
pnpm exec tsx packages/stage-ui-live2d/scripts/extract-natural-reference.ts <trace.json> [<trace.json> ...]
```

The committed reference uses two sessions, and its provenance comment names them.
If you extract from a different set of recordings, update that comment to match.
Recordings and exported traces are private. Write them under `.omo/evidence/`, which git ignores, and never commit them. Only the derived statistics in `reference-stats.ts` are committed.

### Natural QA

QA gates are committed code in `natural-motion/gates.ts`. Each gate has an `id` and an integer `version`, and lists its metrics, thresholds, windows, trial counts, and seeds. Change a gate only by editing that file, and bump `version` when you do. Reports record the git SHA of the last commit that changed the file, so every verdict names the rules it was judged by.

For the QA levels, their limits, commands, evidence and accepted scorer limits, see [`@proj-airi/qa-tools`](../qa-tools/README.md). Run T0 unit tests, then use T1 for deterministic controller scoring, T2 for the real headless rig, T3 for rendered Electron transfer, and T4 for Luke's visual review. The committed gate ids are `natural-idle-liveliness`, `natural-talking`, `natural-emotion`, and `natural-emotion-t3`. The T3 emotion gate is version 2 and uses session-stratified placebo windows.

| Gate | Id | What it judges |
| --- | --- | --- |
| `naturalIdleLivelinessGate` | `natural-idle-liveliness` | Idle liveliness metrics in generated mode, seeds 1-3, 180 s warm-up, 1800 s scored. |
| `naturalTalkingGate` | `natural-talking` | Talking head speed relative to silence and onset enrichment. |
| `emotionGate` | `natural-emotion` | Emotion direction, size relative to the recipe, release, and detectability above idle noise. |
| `naturalEmotionT3Gate` | `natural-emotion-t3` | Rendered transfer on ForBOOTH, session-stratified placebo null, visibility, T3-to-T1 face-effect ratio, and gross release regression. |
| `naturalEmotionT3Gate` | `natural-emotion-t3` | Rendered transfer on one rig: angry strong, sad clear, love clear and sleepy strong, 10 pulses each, scored unpaired with the `emotionGate` windows against the placebo windows of each trial's own capture session (v2: session-stratified, `stratifiedUnpairedPValue`). Visibility hits, `E_T3 / E_T1` per face channel, and gross release only; posture is reported. |

Every report states the same limitation. Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review. The desk VTS recordings are valid for idle liveliness only.

Every statistical rendered gate scored from Natural traces uses 3 captures of the same duration on the same build, aggregated per the gate's rule. Single captures are diagnostic only.
Functional event checks (a parameter rises after a marker, lipsync mouth > threshold, a tool result) are pass/fail runs, not statistical gates.

Score liveliness captures against a committed gate:

```bash
pnpm -F @proj-airi/stage-ui-live2d exec tsx scripts/score-natural-captures.ts --gate natural-idle-liveliness <trace1.json> <trace2.json> <trace3.json>
```

The CLI requires at least 3 traces whose spans (last minus first timestamp) differ by at most 1 s. It exits 2 for an unknown gate, a missing argument, invalid traces, or unequal durations. Todo 9 removed the preregistration and file-mtime checks; select the committed rule set with `--gate`.
Each metric is the median of its non-null measurements, band acceptance is recomputed on that median, and the score is the median of capture scores. The gate passes when no capture has a hard failure and every metric in the gate's `metrics` list passes, exactly as the liveliness gate test judges it; other metrics are reported in `aggregate` only.
The output JSON holds `gate` (`id`, `version`, `fileSha`), `limitation`, `pass`, `failures`, `durations`, and `aggregate`. The command exits 0 on pass and 1 on fail.

The emotion scorer in `natural-motion/emotion-score.ts` is pure and reads NaturalTrace version 2 files. It has two stages:

- `measureEmotionTrial` measures one trial from its emotion run and the stripped run with the same seed. `measurePlacebos` measures the placebo windows of an emotion-free run. Both produce JSON records.
- `scoreEmotionGate` turns the records into one result per `ChannelCheck`. `buildEmotionChecks` generates the checks from the recipe table, so a recipe edit changes the expectations with it.

Each result reports significance (a sign-flip permutation test with Holm correction across the run), sign, size relative to the recipe on held-only trials, visibility above the placebo null, and release. A criterion without data is `n/a`, never a pass.
Every resampling stream is seeded from the gate id and the check key, so results are byte-identical across runs and do not depend on input order.
A trial is rejected when another emotion event falls within `naturalEmotionLifetime` of its window.
The face and eyelid release fit uses only held-only trials whose face residue has ended when the fit window starts. The residue is `naturalFaceResidue`: impulse face hints and the glance, each followed by gaze-evoked lid responses.
Posture has no release check. It decays with `held.postureTau`, and in held-only runs gesture clips (up to 7.5 s) still write the head and body during the release window.

To compare Natural's frame cost before and after a runtime change, run the micro-benchmark from this package on the same machine. It prints the median of 5 runs, each of 10,000 idle adapter compositions on a stub rig:

```bash
node --expose-gc --import tsx scripts/bench-natural.ts
```

### Natural motion lab

The Natural motion lab is a devtools page for tuning Natural on the rendered model.
In the Electron app, open it from Settings > System > Developer > Natural Motion Lab (route `/devtools/live2d-natural-motion`).
The lab UI is `NaturalMotionDevtools` from `@proj-airi/stage-ui/features/devtools/motion/natural`. No web page mounts it.
The lab runs in the devtools window, and every control and capture applies to the character in the main stage window.

The lab provides these controls:

- Performance state: when the override is on, the selected mode (`idle`, `watching`, `listening`, `thinking`, or `talking`) replaces the resolved mode at once. When it is off, the stage resolves the mode from its real signals.
- Energy: the energy override and its 0 to 1 slider are disabled while "Override the performance state" is off, because only the state override carries the energy to the stage. While they are off or disabled, Natural uses the user's Energy setting.
- Emotions: choose `slight`, `clear`, or `strong`, and each emotion button sends that emotion at the band's default intensity through the same stage emotion queue that chat replies use. Lab pulses belong to no speech turn, so their expressions follow the hold rule.
- Affect trace: "Start recording" starts an affect recording in the stage's performance conductor, and "Export affect trace" downloads the recording as `AffectTrace` JSON for `scripts/replay-affect-trace.ts`.
- Trace capture: buttons start a 60, 300, or 600 s capture, and a cancel button stops it.

The override and emotion pulses live in the `natural-performance-override` store in `@proj-airi/stage-ui`. That store is replicated across windows and not persisted.

Captures and affect traces go through the `useNaturalMotionDiagnostics` store, which carries requests and results between windows on a BroadcastChannel.
The stage's performance conductor answers affect-trace requests. The lab window that requested an export saves the trace through the sink that `setAffectTraceSink` sets, which downloads a JSON Blob by default.
Affect-trace messages are Eventa events from `@proj-airi/stage-shared/expression-performance` on the same channel; capture messages are still raw objects. A failed request carries a code (`no-recording` or `save-failed`), which the lab translates.
The stage's model listens for frames only while a capture request is pending.
It samples in the SDK `beforeModelUpdate` event. That event fires after Natural composition, physics, and pose, and before the SDK restores the saved parameters, so the trace records the values that are actually rendered.
`NaturalTraceRecorder` keeps one frame per 1/30 s slot. It records head, body, eye, eyelid, eye smile, brow, mouth, cheek, and breath parameters that the rig has, together with their ranges.
A capture request can name `extraParameterIds`, such as a ForBOOTH expression switch (`Param60`). The recorder adds columns for the ones the rig has.
A trace has `version: 2` and an `events` list on the sample clock.
While a capture runs, the stage attaches the Natural observer, so the list holds every impulse, hold change, and gesture that Natural performed.
It also holds the scenario events that `markCaptureEvent` receives in the stage window. The scorer ignores events.
The capture also records metadata: the model id, the driver, the energy, the posture home, the capture time and duration, and adapter counters.
The adapter counters are the mean posture weight, the number of body writes, and the number of channels left to physics. They show what Natural wrote during the capture, and they stay at zero body writes on a rig whose physics derives the body from the head.
If the model is unloaded during a capture, the capture fails.

When a capture ends, the stage scores the trace with `scoreLiveliness` in generated mode and sends the result to the lab.
The lab shows the score, pass or fail, the frame count, the model id, any hard failures, and a table with each metric's value, reference band, and result.
Download trace saves the trace as `natural-trace-<ISO>-<model>.json`. Colons and path characters in the name become `-`.
The file has the same `{ t, channels, ranges }` shape as the CLI input, so you can score it from the repository root with the same command as above:

```bash
pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts <trace.json>
```

Keep these caveats in mind:

- A 60 s capture always fails `minuteAngleYRange`, because that metric is the range of per-minute mean head pitch, and a 60 s capture yields only one minute. Use a 300 or 600 s capture to judge a result.
- Keep the main stage window visible during a capture. The stage samples only frames that it renders, and a gap longer than 200 ms splits the trace.
- In the Electron app, Download trace may show a native save dialog.
- Captured traces are private evidence. Keep them under `.omo/evidence/` and never commit them.

## When to use

Use this package to render Live2D models in AIRI hosts.
Use Natural for continuous autonomous movement that responds to speech, listening, thinking, desktop activity, emotions, and pokes and pets, with optional cursor attention.
Use the expression catalog and slots to let emotions and the LLM show a model's own faces, effects, and props without disturbing outfits or saved defaults.
Natural controls head, body, eye, face, blink, and breath channels before the model's physics pass.
Model physics remains authoritative, so torso movement depends on the rig.

## When not to use

Do not use Natural to play recorded or authored motion; use model motions or MAGIC for that.
Do not use Natural to control physics outputs directly, or to drive the mouth during speech; lipsync owns the mouth.
Do not use the expression store to decide which expression to show; the decider in `@proj-airi/stage-shared/expression-performance` owns that choice.
Use a different renderer package for VRM, MMD, or other model formats.
