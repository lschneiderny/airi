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
const { seq, behaviour } = motion.idleState
```

- The layer is inert until `setIdleDrive` receives a drive. Without one the
  controller draws nothing for it and composes exactly as before, so seeded
  traces and gates that never set a drive are unchanged.
- `idleActivityWeights`, `idleActivityRate` and `idleEnergyOffset` are the pure
  rules that turn a drive into odds, pace and an energy offset.
- An activity yields within 0.4 s to speech, thinking, listening, touch, an
  emotion, a cue gesture and a noticed cursor.
- `idleState.seq` increments at every start. `IdleBehaviourReports` turns
  per-frame reads of it into start and end reports; both renderer adapters use
  it. An attached observer also receives `idle` events.

[The idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) records the
design, the pacing numbers and the open visual review.

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
