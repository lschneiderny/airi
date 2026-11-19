# Stage UI MMD

- `MMDBody` registers the performer's layers from `createPerformanceLayers`; do not construct or register layers anywhere else, so the headless runner and the scene perform the same body.
- Every bone write happens in a pose stage registered on `MMDFramePipeline`, before `mmd.beforePhysics()`. Do not read Ammo internals (`physics.bodies`, btRigidBody).
- Morph writers set channels on their morph-runtime layer; never write `morphTargetInfluences` directly.
- Pure, renderer-neutral motion math belongs in `@proj-airi/motion-driver-humanoid` or `@proj-airi/motion-driver-natural`, tested in Node. Do not import `@proj-airi/stage-ui-live2d` from this package.
- Diagnostics snapshot and command field names are a QA contract; change them together with `src/stores/motion-diagnostics.ts`, its test, and the README. Fields are only appended, unless the change deletes what a field reports and no reader remains; record that removal in the ADR that deletes it (the idle agency ADR removed `nextWanderAtMs`). Recording and frame measurements exclude each other.
- Stage mode is active only when `stageWorld` is set; without it every classic path must stay unchanged. Read `docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md` before changing stage mode.
- A new `stageWorld` calibration can mean the stage window moved to another display (`stageWorld.row` is set). Then only the camera changes: never rebase the gait, move the root, or reset physics on a calibration change. Read `docs/ai/adr/2026-11-10-display-hand-off.md` before changing how the scene reacts to `stageWorld`.
- Never call `animation.playAction` for a user clip; the scene plays a clip only with `playLayer` when `intent.action` reaches `playing`. Body ducking reads `body.ownership()`, never raw clip weights. Dances never loop, because a mixer loop resets physics. Read `docs/ai/adr/2026-11-03-mmd-clip-actions.md` before changing the clip library, layered playback, or the action port.
- Do not edit `@moeru/three-mmd` or node_modules. No model, texture, or VMD assets in the repository.
