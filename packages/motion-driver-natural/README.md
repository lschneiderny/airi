# Motion Driver Natural

Renderer-neutral Natural motion controller and pure motion layers.

## Usage

```ts
import { NaturalMotion } from '@proj-airi/motion-driver-natural'

const motion = new NaturalMotion({ seed: 41 })
const frame = motion.advance(0)
```

The root exports the controller, frame contracts, rig traits, touch regions,
emotion episodes, and speech onset detector. Individual layers are available
through source subpaths, such as `@proj-airi/motion-driver-natural/gaze`.
Times are monotonic seconds; seeded inputs preserve deterministic output.

The layers are blink, breath, gaze, posture, body, face and face hints,
impulses, hold, gestures, mood and mood modulation, energy, cursor attention,
placement, speech emphasis, pending actions and touch. Each layer draws from
its own seeded stream, so a change in one layer does not reshuffle another.
The controller advances every layer on a fixed 120 Hz grid and interpolates
between grid states, so the frame rate does not change the motion.

Two adapters consume the controller. `Live2DNaturalMotionAdapter` in
`@proj-airi/stage-ui-live2d` writes Live2D parameters, and `MMDNaturalAdapter`
in `@proj-airi/stage-ui-mmd` writes MMD bones and morph-runtime layers. Live2D
keeps the trace recorder, rig profile, scorers and QA gates, because they
read Live2D parameters. The architecture is recorded in
[the 3D character motion ADR](../../docs/ai/adr/2026-10-30-3d-character-motion.md).

## Checks

```bash
pnpm -F @proj-airi/motion-driver-natural exec vitest run
pnpm -F @proj-airi/motion-driver-natural typecheck
```

Any numeric change to a layer changes the seeded Live2D trace hashes. Make such
a change deliberately, never as part of a move or rename.

## When to use

Use this package for autonomous posture, gaze, face, blink, breath, speech,
emotion, cursor attention, placement, and touch behavior across renderers.

## When not to use

Keep model parameter writes, rig discovery, rendering, stores, trace recording,
and QA scoring in their renderer or tooling packages. This package does not
depend on Three.js, Vue, Pinia, three-mmd, or stage UI packages.
