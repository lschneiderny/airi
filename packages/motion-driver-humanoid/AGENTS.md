# Motion Driver Humanoid

- Register a new subpath in `package.json` exports and the README.
- A new generator hook is fed by the performer from the merged plan or the
  stack's `modulation`, never by a layer reaching into a generator.
- The director never starts, stops, or names a clip itself. A refusal still
  advances `lastActionSeq`; keep that, because the ports settle on it.
- Take time only as explicit seconds or milliseconds and randomness only from a
  seed.

Read `README.md`, `docs/ai/adr/2026-10-30-3d-character-motion.md`,
`docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md`,
`docs/ai/adr/2026-11-03-mmd-clip-actions.md`,
`docs/ai/adr/2026-11-11-whole-body-performer.md`, and
`docs/ai/adr/2026-11-12-idle-agency.md` before changing a contract.
