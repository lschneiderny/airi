# stage-ui-live2d

## Purpose

This package provides AIRI's shared Live2D renderer, model controls, expressions, and persisted settings.

## Usage

Use the shared model settings to select a motion driver.
Universal remains the default and uses model motions, idle eyes, and mouse tracking.
MAGIC retains its dataset-based motion controls.
Natural generates continuous autonomous motion from layered random processes and reacts to what the character and the user are doing.

### Natural layers

Natural is composed of independent layers. Each layer draws from its own seeded random stream, so retuning one layer does not reshuffle another.
The `Live2DNaturalMotion` controller advances every layer on a fixed 120 Hz grid and interpolates between grid states, so the frame rate does not change the motion.

- Posture moves the head through a slow home drift, continuous sub-second motion whose activity waxes and wanes, and occasional heavy-tailed posture shifts along min-jerk paths.
- Gaze picks fixation targets (camera, desk, and peripheral points) independently of the head and compensates the eyes for head rotation.
- Body follows the head with a lag of 150 to 300 milliseconds, drawn again at each posture shift.
- Face adds slow brow, mouth-form, and eyelid micro-activity, plus occasional silent mouth openings.
- Blink schedules blinks at irregular intervals, with occasional double blinks, and starts a nearly due blink early at a large gaze shift.
- Breath drives the breath channel and couples a very small pitch movement to the head.
- Speech emphasis turns onsets in the lipsync mouth level into occasional small head beats while the character speaks: 80% are pitch-down nods and 20% are roll tilts to a random side.
- Impulses add short head gestures and decaying face hints for emotions and desktop reactions.
- Energy scales posture amplitude, posture shift rate, and gaze target choice from the performance state and the user's Energy setting.

### What Natural owns and what it never writes

`Live2DNaturalMotionAdapter` writes all Natural values inside the SDK focus update, which runs before physics.
The SDK brackets each model update with `saveParameters()` and `loadParameters()`, so every Natural write is an overlay on that frame's post-motion values. Natural values never feed back into the next frame.

Natural owns these channels when the model has them:

- head XYZ (`ParamAngleX`, `ParamAngleY`, `ParamAngleZ`);
- body XYZ (`ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ`), except an axis that rig physics derives from the head;
- eye XY (`ParamEyeBallX`, `ParamEyeBallY`);
- face micro-offsets on brows, eye smile, and mouth form, and the eyelid composition (eye smile comes only from emotion hints);
- cheek (`ParamCheek`), a reserved channel that Natural currently leaves at its base value with a 0 offset;
- Natural blink, while the user's auto-blink setting is on;
- breath (`ParamBreath`), unless manual breath control is active.

Natural never writes these channels:

- any parameter that model physics outputs;
- a body axis that physics derives from the head; the adapter skips it and the model's physics remains authoritative;
- the mouth while the character speaks, and for 0.7 seconds after speech ends, so lipsync owns it;
- a face channel that a playing explicit motion clip animates.

Head, body, and eye posture fades out while manual or spring motion control is active or an exclusive owner holds the model.
On a channel that an explicit clip animates, posture keeps only 10% of its offset.
Eyelids that an expression closes stay closed, and a blink closes open eyelids fully.
While Natural is selected, the SDK blink plugin is off and Natural's own blink scheduler replaces it.

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

### Emotions as impulses

When Natural drives the model, the stage sends each chat emotion to the scene's `setEmotion(name, intensity)` instead of playing the emotion's motion group.
Natural turns the emotion into an impulse: a short head gesture that peaks after 0.25 to 0.5 seconds and returns to zero, plus face hints that decay over about 1.5 seconds.
Some emotions also glance aside.
An impulse adds to every other layer, so it never resets the pose.
Neutral does nothing, and the same emotion within 2 seconds is ignored.
Universal and MAGIC still play the emotion's motion group.

### Cursor attention

Natural has its own Cursor attention setting, enabled by default.
It does not change Universal's mouse tracking preference or saved idle animation.
When cursor attention is enabled and the cursor is active, the gaze and a small head bias follow the cursor.
Resetting Live2D settings restores Universal and enables both cursor preferences.

### Liveliness score and reference stats

`scoreLiveliness` in `natural-motion/liveliness.ts` scores a timestamped parameter trace against reference bands. The bands come from recordings of a human performer in `natural-motion/reference-stats.ts`.
The report lists every metric with its value and band, any hard failures, a score, and `pass`.
The liveliness gate test scores generated Natural motion with it, so every motion change is checked in the test suite.

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

### Natural motion lab

The Natural motion lab is a devtools page for tuning Natural on the rendered model.
In the Electron app, open it from Settings > System > Developer > Natural Motion Lab (route `/devtools/live2d-natural-motion`).
The lab UI is `NaturalMotionDevtools` from `@proj-airi/stage-ui/features/devtools/motion/natural`. No web page mounts it.
The lab runs in the devtools window, and every control and capture applies to the character in the main stage window.

The lab provides these controls:

- Performance state: when the override is on, the selected mode (`idle`, `watching`, `listening`, `thinking`, or `talking`) replaces the resolved mode at once. When it is off, the stage resolves the mode from its real signals.
- Energy: the energy override and its 0 to 1 slider take effect only while "Override the performance state" is also on; otherwise Natural uses the user's Energy setting.
- Emotions: each button sends that emotion, at the selected intensity, through the same stage emotion queue that chat replies use.
- Trace capture: buttons start a 60, 300, or 600 s capture, and a cancel button stops it.

The override and emotion pulses live in the `natural-performance-override` store in `@proj-airi/stage-ui`. That store is replicated across windows and not persisted.

Captures go through the `useNaturalMotionDiagnostics` store, which carries requests and results between windows on a BroadcastChannel.
The stage's model listens for frames only while a capture request is pending.
It samples in the SDK `beforeModelUpdate` event. That event fires after Natural composition, physics, and pose, and before the SDK restores the saved parameters, so the trace records the values that are actually rendered.
`NaturalTraceRecorder` keeps one frame per 1/30 s slot. It records head, body, eye, eyelid, eye smile, brow, mouth, cheek, and breath parameters that the rig has, together with their ranges.
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
Use Natural for continuous autonomous movement that responds to speech, listening, thinking, desktop activity, and emotions, with optional cursor attention.
Natural controls head, body, eye, face, blink, and breath channels before the model's physics pass.
Model physics remains authoritative, so torso movement depends on the rig.

## When not to use

Do not use Natural to play recorded or authored motion; use model motions or MAGIC for that.
Do not use Natural to control physics outputs directly, or to drive the mouth during speech; lipsync owns the mouth.
Use a different renderer package for VRM, MMD, or other model formats.
