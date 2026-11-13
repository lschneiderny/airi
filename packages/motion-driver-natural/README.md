# Motion Driver Natural

Renderer-neutral Natural motion controller and pure motion layers.

## Usage

```ts
import { NaturalMotion } from '@proj-airi/motion-driver-natural'

const motion = new NaturalMotion({ seed: 41 })
const frame = motion.advance(0)
```

The root exports the controller, frame contracts, rig traits, touch regions,
emotion episodes, and speech onset detector. `./frame-types` also holds
`NaturalTouchGesture`, the touch event every renderer's classifier emits, and
`./emotion-strengths` holds the per-model emotion strength record and its
storage parser, which every Natural renderer's settings use. `./touch-gestures`
holds `NaturalTouchGestures`, the poke and pet classifier both renderers feed
with pointer samples; each renderer keeps its own hit-testing. Individual layers are available
through source subpaths, such as `@proj-airi/motion-driver-natural/gaze`.
Times are monotonic seconds; seeded inputs preserve deterministic output.

The layers are blink, breath, gaze, posture, body, face and face hints,
impulses, hold, gestures, cue gestures, mood and mood modulation, energy,
cursor attention, placement, speech emphasis, pending actions, touch and idle
activities. Each layer draws from
its own seeded stream, so a change in one layer does not reshuffle another.
The controller advances every layer on a fixed 120 Hz grid and interpolates
between grid states, so the frame rate does not change the motion.

After `advance()`, `motion.bodyIntent()` returns the cached `NaturalBodyIntent`
for the frame it most recently produced. Call `advance()` before the first read;
reading earlier throws. Repeated reads return the same snapshot without stepping
or consuming events. `NaturalMotionFrame` keeps its original shape; intent is
not a frame property. `NaturalBodyIntent` is exported from the root and
`./frame-types`. It is a detached, read-only snapshot of state already
computed by Natural: head posture and its slow component, the six additive head
terms (emphasis, impulse, pet, held, emotion gesture, cue), posture shift sequence
and final amplitude/rate scales and activity gain, gaze ownership and saccades,
breath phase/effective period/amplitude scale, host voice and its slow envelope
and onsets, mood, energy, held affect, touch, and cursor attention.

Intent is assembled after the grid loop and describes its next endpoint; the
legacy pose, face, blink, breath and fixation remain interpolated. `intent.time`
is the frame's active seconds, so the grid endpoint may be up to one tick ahead.
At grid endpoints after the origin, the posture plus six head terms, clamped to
[-1, 1], equals the reported head before breath pitch is added and clamped again.
`head.slow` is an alternative to `head.posture`, not an additional term.
Gaze ownership chooses pet override, cursor, chat, aside, then free. Pet coordinates
are the eased hand. Held affect reports the raw target and eased level, including
its retained side after release; `head.held` reports the term actually applied.
The energy reaction deadline starts at negative infinity before any reaction.

Emphasis, impulse, emotion gesture, cue, poke and desktop reaction records are
`null` before their first start. Each has its own `seq`, starting at 1 and advancing
once per accepted start, independently of observers and reads. Multiple starts
between frames advance the sequence for each start and retain the latest payload.
Records remain after their motion ends. Impulses include accepted escalations and
poke surprise episodes; every poke advances its own record even when surprise is
deduplicated. Refused gestures/cues do not advance a sequence; queued cues advance
only when they start. A cue reports its actual start and end; other records use
`at`, the grid-step start, except emphasis uses the speech detector's active time
at acceptance. Emphasis carries magnitude, tau, kind and side (1 for an unsided
nod); an emotion gesture carries its resolved kind, side, sampled lifetime and
the exact strength times band scale passed to its clip. Pokes preserve their
region-relative input coordinates. Desktop reactions carry `wake` or
`screen-change`. Reading intent draws no randomness and changes no frame output.

Two adapters consume the controller. `Live2DNaturalMotionAdapter` in
`@proj-airi/stage-ui-live2d` writes Live2D parameters, and `MMDNaturalAdapter`
in `@proj-airi/stage-ui-mmd` writes MMD bones and morph-runtime layers. Live2D
keeps the trace recorder, rig profile, scorers and QA gates, because they
read Live2D parameters. The architecture is recorded in
[the 3D character motion ADR](../../docs/ai/adr/2026-10-30-3d-character-motion.md),
and what each renderer performs is in
[the interaction portability ADR](../../docs/ai/adr/2026-11-04-interaction-portability.md).

## Idle activities

`./idle-activities` holds `NaturalIdleActivities`, the layer of self-directed
idle behaviour: stretch, yawn, look-around, check-in, peer, zone-out, nod-off
and sway, sleep while the user is away, and the two reach-out cues
`about-to-speak` and `let-go`.

```ts
motion.setIdleDrive({ energy: 0, valence: 0, tension: 0, sleepiness: 0.8, solitude: 0.5, music: false, allowSleep: true, rate: 1 }, now)
motion.idleCue('about-to-speak', now)
motion.idlePlay('yawn', now) // previews and scripted QA
const { seq, behaviour } = motion.idleState
```

- The layer is inert until `setIdleDrive` receives a drive. Without one the
  controller draws nothing for it and composes exactly as before, so seeded
  traces and gates that never set a drive are unchanged.
- `idleActivityWeights`, `idleActivityRate` and `idleEnergyOffset` are the pure
  rules that turn a drive into odds, pace and an energy offset.
- An activity yields within 0.4 s to speech, thinking, listening, touch, an
  emotion, a cue gesture and a noticed cursor.
- `idlePlay` starts one behaviour by name at the next step, in place of the
  running one, when a drawn activity could start too. A played sleep ends after
  14 s.
- `motion.idleLidFactor` is the part of the frame's `blinkFactor` that a
  behaviour closes on purpose. A renderer whose blinks are switched off applies
  it alone. It is not a frame field, so recorded frames keep their shape.
- `idleState.seq` increments at every start. `IdleBehaviourReports` turns
  per-frame reads of it into start and end reports; both renderer adapters use
  it. An attached observer also receives `idle` events.
- The layer is the one idle scheduler for both renderers. A host that performs
  a whole body (MMD) sets `body: true` in the drive. That unlocks the
  whole-body kinds (`sigh`, `shoulder-roll`, `shift-stance`, `clasp-hands`,
  `hair-touch`, `heel-rock`, `arm-swing`) and settling in after 120 s of
  continuous `idle` mode. Without `body` those kinds weigh 0 before the single
  draw, so a Live2D drive draws exactly as before they existed. `shift-stance`
  takes architecture 4e's weight 1.2: the MMD body re-plants a foot.
  `clasp-hands`, `hair-touch` and `heel-rock` weigh 0 with `body` too, until
  their forms read on the MMD mesh: the rock needs the toe-down foot pitch the
  performer has no output for, the clasping hands need a two-hand contact, and
  the hair touch needs a temple anchor solved per rig with the head-clearance
  gate (its fitted anchor reads as a salute). While
  she is settled in, nothing that needs her arms, her shoulders or a standing
  posture is drawn (`stretch`, `peer`, `shoulder-roll`, `arm-swing`,
  `shift-stance` and the three above), and a stretch that would follow a long sleep becomes a yawn. The
  sigh and the yawn still play, as architecture 4f allows; so do the head and
  gaze kinds (`look-around`, `check-in`, `zone-out`, `nod-off`, `sway`), a
  recorded deviation from 4f's list.
- With `body`, the draw prefers kinds she has not shown recently: a kind
  started `t` seconds ago weighs `t / 300` of its odds until 300 s have
  passed. 300 s is about five acts of 60 s each, so each of the other kinds
  of her settled pool can come first. A ten-minute idle then shows more of
  what she can do. Without `body` the odds are unchanged.
- `bodyIntent().idle` carries the latest behaviour as an
  `IdleBehaviourRecord` (its timing, side and drawn parameters, kept after it
  ends) and `settled`, so a body host plays its own form of each behaviour. The
  frame Live2D draws does not change.

[The idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) records the
design, the pacing numbers and the rendered Live2D pass.

## Checks

```bash
pnpm -F @proj-airi/motion-driver-natural exec vitest run
pnpm -F @proj-airi/motion-driver-natural typecheck
```

Any numeric change to a layer changes the seeded Live2D trace hashes. Make such
a change deliberately, never as part of a move or rename.

## When to use

Use this package for autonomous posture, gaze, face, blink, breath, speech,
emotion, cursor attention, placement, touch, and self-directed idle behavior
across renderers.

## When not to use

Keep model parameter writes, rig discovery, rendering, stores, trace recording,
and QA scoring in their renderer or tooling packages. This package does not
depend on Three.js, Vue, Pinia, three-mmd, or stage UI packages.
