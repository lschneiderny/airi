# Stage UI MMD

This package owns the MMD scene, its frame pipeline, morph runtime, rig, Natural, body, touch, and stance adapters, and the diagnostics store. Read `README.md` and `docs/ai/adr/2026-10-30-3d-character-motion.md` before changing frame order or motion layers.

- Every bone write happens in a pose stage registered on `MMDFramePipeline`, before `mmd.beforePhysics()`. A pose stage reads `context.clean` and writes absolute transforms from it; it never writes the snapshot. Surface effects (material, UV, vertex morphs, measurements) belong in surface stages after physics.
- Pose stages skip bones that the rig profile reports as physics-owned. Do not read Ammo internals (`physics.bodies`, btRigidBody).
- Morph writers set channels on their morph-runtime layer; never write `morphTargetInfluences` directly.
- Pure, renderer-neutral motion math belongs in `@proj-airi/motion-driver-humanoid` or `@proj-airi/motion-driver-natural`, tested in Node. Do not import `@proj-airi/stage-ui-live2d` from this package.
- Diagnostics snapshot and command field names are a QA contract; change them together with `src/stores/motion-diagnostics.ts`, its test, and the README. Fields are only appended. The `qa:stage` gates read `locomotion.skate`, `feet.maxError`, `arms.penetration`, and `measurement.readbackMs`; stage mode also publishes `characterPlacement`, `stageModel`, `world`, and the director's locomotion fields.
- Stage mode is active only when `stageWorld` is set; without it every classic path must stay unchanged. Per-frame root motion and drags never request a physics reset; user transform edits and teleports do. Read `docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md` before changing stage mode.
- Do not edit `@moeru/three-mmd` or node_modules. No model, texture, or VMD assets in the repository.

Checks: `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node`, `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser`, and `pnpm -F @proj-airi/stage-ui-mmd typecheck`.
