# Motion Driver Humanoid

This package owns renderer-neutral humanoid motion contracts and algorithms.
Keep its source independent of Three.js, Vue, Pinia, three-mmd, and stage UI
packages.

- Register a new subpath in `package.json` exports and the README.
- `./performance` is the whole-body performer the MMD body poses from. It
  writes no bone and reads no clock; the adapter in `@proj-airi/stage-ui-mmd`
  owns the 120 Hz clock, the bind-frame mapping and clip ownership. Read
  `docs/ai/adr/2026-11-11-whole-body-performer.md` before changing its
  contracts.
- Hosts register the performance layers only through
  `createPerformanceLayers`. A layer must stay at weight 0 without its input:
  the headless idle and gaze-shift traces must stay byte-identical with every
  layer registered. A new generator hook is fed by the performer from the
  merged plan or the stack's `modulation`, never by a layer reaching into a
  generator.
- The director also performs clips: it accepts or refuses a `BodyActionRequest`
  in a fixed order and echoes the `clipId` in `BodyIntent.action`. It never
  starts, stops, or names a clip itself. A refusal still advances
  `lastActionSeq`; keep that, because the ports settle on it.
- An `idle` clip request is the weakest source: refused while anything performs
  or while she walks, talks, listens or thinks, replaced by any other source,
  and never arming a refractory or a gesture cooldown. `./idle-clips` only
  picks which clip to ask for; the director still decides.
- The director chooses goals, reasons, pace, and tool refractories and never
  moves the root. Locomotion integrates position, gait phase, step targets, arm
  swing, and root yaw and never chooses a goal. Keep that boundary.
- `RestRelativeRotation` is intrinsic YXZ Euler, `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
  Convert through `rotationToMatrix` and `matrixToRotation`; do not compose the
  angles in another order.
- Take time only as explicit seconds or milliseconds and randomness only from a
  seed. Tests run in Node.

Read `README.md`, `docs/ai/adr/2026-10-30-3d-character-motion.md`,
`docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md`,
`docs/ai/adr/2026-11-03-mmd-clip-actions.md`,
`docs/ai/adr/2026-11-11-whole-body-performer.md`, and
`docs/ai/adr/2026-11-12-idle-agency.md` before changing a contract.
