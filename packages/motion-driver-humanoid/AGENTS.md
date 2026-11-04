# Motion Driver Humanoid

This package owns renderer-neutral humanoid motion contracts and algorithms.
Keep its source independent of Three.js, Vue, Pinia, three-mmd, and stage UI
packages.

- Subpaths: `./types`, `./look-at`, `./foot-contact`, `./weight-shift`,
  `./director`, `./locomotion`, `./rest-pose`, `./clip-mask`, and `./clip-meta`.
  Register a new subpath in `package.json` exports and the README.
- The director also performs clips: it accepts or refuses a `BodyActionRequest`
  in a fixed order and echoes the `clipId` in `BodyIntent.action`. It never
  starts, stops, or names a clip itself. A refusal still advances
  `lastActionSeq`; keep that, because the ports settle on it.
- The director chooses goals, reasons, pace, and tool refractories and never
  moves the root. Locomotion integrates position, gait phase, step targets, arm
  swing, and root yaw and never chooses a goal. Keep that boundary.
- `RestRelativeRotation` is intrinsic YXZ Euler, `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
  Convert through `rotationToMatrix` and `matrixToRotation`; do not compose the
  angles in another order.
- Take time only as explicit seconds or milliseconds and randomness only from a
  seed. Tests run in Node.

Read `README.md`, `docs/ai/adr/2026-10-30-3d-character-motion.md`,
`docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md`, and
`docs/ai/adr/2026-11-03-mmd-clip-actions.md` before changing a contract.
