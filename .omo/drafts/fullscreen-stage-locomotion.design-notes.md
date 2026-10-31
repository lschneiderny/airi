# fullscreen-stage-locomotion - design notes (advisory lane outputs, 2026-10-31)

These are read-only advisory outputs gathered during ulw-plan. They are claims that the plan verified selectively (see the draft's Findings); the plan's todos are the contract, these notes explain the math and the decomposition behind them.

## A. Architecture consultation (architect lane st_01a19178)

All 22 files loaded into kernel state. Printing the ones that decide the boundaries first: director, types, stance, attention, camera-bounds, and the main/desktop-overlay window modules.
Survey complete. Evidence I rest on, by path (worktree `dtuber-wt/fullscreen-stage`):

- ADR `docs/ai/adr/2026-10-30-3d-character-motion.md`: purity ban enforced by `eslint.config.ts:97-105` on `packages/motion-driver-{natural,humanoid}/src/**` (per-path, not per-package: humanoid already imports `@proj-airi/stage-shared/performance-state` at `director/index.ts:1`); "every model transform change requests a physics reset"; Live2D path must stay byte-identical.
- `motion-driver-humanoid/src/types/index.ts`: `BodyIntent.facingYaw` exists; `director/index.ts:118` hard-codes it to `0`. `foot-contact/index.ts:166-174` already has `TurnStep` + `planFootSteps(turnSteps, anchors, pivot)`; `look-at` already takes `facingYaw` and owns body-turn hysteresis.
- `stage-ui-mmd/.../body/index.ts`: `MMDBody.facing` comes from `look.step().facingYaw` and is written to the hips center in `applyFacing`; `feet.ts:16`: "Mesh-local anchors survive pose restoration, but never a model replacement".
- `stage-ui-mmd/.../body/attention.ts`: ad-hoc DIP->world raycast against a plane at head depth; `camera-bounds.ts`: camera framed from the skeleton.
- `stage-shared/src/stage-placement/index.ts`: DIP-rect vocabulary (`PlacementRect`, bottom-layer displays, `screenInwardness`); `stage-shared/package.json` lists `vue`/`pinia` as deps, yet `stage-placement` is pure, so subpath purity is existing practice.
- `apps/stage-tamagotchi/src/main/windows/main/index.ts`: 450x600, bounds persisted in `app/config.json` `windows[]` tag `main`, native drag via `electron-click-drag-plugin`, `hideOnClose`, `initScreenCaptureForWindow`, `userFacingMainWindow` handed to chat/settings/caption/tray via `main/index.ts:334-394`.
- `windows/desktop-overlay/window-contract.ts`: tested pure builders for a full-display, transparent, click-through, non-focusable window (`setIgnoreMouseEvents(true,{forward:true})`, `screen-saver` level, `setContentProtection(true)`).
- `windows/chat/floating.ts:290-328` attaches to the main `BrowserWindow` bounds via `main.on('move'|'resize')`; `floating-placement.ts` is pure over a `Rectangle`; `ChatAttentionTarget` (`shared/eventa/index.ts`) is already a DIP rect pushed to the main window.
- `renderer/pages/index.vue:214-380`: renderer decides click-through from a pixel hit test and calls `electron.window.setIgnoreMouseEvents` (handler at `main/services/electron/window.ts:82`); Wayland/Linux `forward` caveat in a NOTICE.
- `stage-ui-three/src/composables/hit-test.ts`: alpha readback at a client point with region radius (`readRenderTargetRegionAtClientPoint`).
- `stage-ui-mmd/.../touch/colliders.ts:76-80`: touch colliders cover only the head and torso subtrees; models without rigid bodies fall back to a mesh raycast (ADR).

---

## A. Where the WORLD/CAMERA contract lives

**Option 1 - `packages/stage-shared/src/stage-world/` (new `./stage-world` subpath).** Already home of the DIP vocabulary (`stage-placement`), already a dependency of `motion-driver-humanoid`, already imported by Electron main (`shared/eventa/index.ts` imports `stage-shared/global-shortcut`, `godot-stage`, `types/io-trace`) and by renderers. Cost: one folder, one `exports` line, one eslint `files` pattern added to the purity block. Weakness: stage-shared is a grab-bag and its `package.json` carries `vue`/`pinia`; purity is by convention + lint, not by dependency graph.

**Option 2 - `packages/motion-driver-humanoid`.** Wrong layer: humanoid works in mesh-local model units and must stay screen-unaware so a VRM adapter can reuse it (ADR "Consequences"). Displays, DIP, taskbars, and display ids do not belong there.

**Option 3 - new `packages/stage-world`.** Cleanest dependency story (no `vue`/`pinia` in `package.json`). Cost: package.json, tsconfig, vitest project in root `vitest.config.ts`, README, AGENTS.md + CLAUDE.md, eslint block, for maybe four modules.

**Recommendation: Option 1 now**, with the promotion trigger written down: move to `packages/stage-world` when a second consumer outside the renderer/main pair appears (Kirie/Godot) or when the module count passes ~6. Evidence: `stage-placement` is the precedent for a pure DIP module inside stage-shared consumed from both processes.

**Minimal interface** (pure TS, own 4x4 math, no `three`):

```text
// Screen side. Electron DIP, y down. Mirrors PlacementRect.
interface StageDisplay { id: string; bounds: PlacementRect; workArea: PlacementRect; scaleFactor: number }

// Calibration = the two owner decisions + rig facts.
interface StageCalibration {
  viewport: PlacementRect        // the stage window's bounds (DIP)
  floorDipY: number              // workArea.y + workArea.height, in window-local DIP
  modelHeightDip: number         // chosen pixel height
  rigHeightUnits: number         // resolveFrameBounds().size[1]
  footBaselineY: number          // RigTraits.footBaselineY
  fovYRad: number                // keep narrow (15-20 deg) so DIP<->world stays near-affine
}

// Camera with zero pitch: eye height + distance solve in closed form from
// (floorDipY, modelHeightDip, fovY). Floor plane y = 0, character on z = 0.
interface StageCameraPose { position: Vec3; target: Vec3; fovYRad: number; aspect: number; near: number; far: number }
solveStageCamera(c: StageCalibration): StageCameraPose

projectWorldToDip(pose, viewport, world: Vec3): { x: number; y: number; depth: number }
unprojectDipToFloor(pose, viewport, dip): Vec3            // ray vs y = 0
unprojectDipToPlaneZ(pose, viewport, dip, z: number): Vec3 // replaces attention.ts raycast

// Space model (decision 3).
interface GroundLine { displayId: string; xMin: number; xMax: number }   // workArea edges unprojected at the floor
interface StageHome   { displayId: string; x: number }                    // persisted per display
groundLineOf(display: StageDisplay, pose, viewport): GroundLine
defaultHome(line: GroundLine, chatSide: 'left' | 'right'): StageHome
```

World unit = model unit, floor at y = 0, root placed at `y = -footBaselineY`. Zero camera pitch means the floor line is exactly horizontal on screen and the height mapping is exact at z = 0, which is all the behaviour uses. `Vec3` is the existing humanoid `types` shape, so the director can consume stage-world points without conversion.

**Risk:** Electron `display.id` is not guaranteed stable across re-plug/reboot on Windows (unverified in this codebase; known Electron behaviour). Key persisted homes by `id` with a `{bounds,scaleFactor}` fingerprint fallback, or homes silently reset.

## B. Where the LOCOMOTION planner lives, and its boundary with the director

**Option 1 - extend `motion-driver-humanoid`** with `./locomotion` (position integration, gait phase, stride-from-speed, start/stop/turn, step targets, arm swing) and `./rest-pose` (relaxed arm/hand layer), and widen `./director`.

**Option 2 - new `motion-driver-locomotion`** importing humanoid `types` and `foot-contact`.

**Recommendation: Option 1.** Gait is the same vocabulary as what already exists: `Foot`, `FootAnchor`, `LegGeometry`, `planFootSteps`/`TurnStep` (`foot-contact/index.ts:5-17,166-174`), `RigTraits.legLength/footBaselineY`, and look-at's `facingYaw`. A second package would put two planners that write foot anchors on opposite sides of a package boundary. Keep the one-module-per-subpath export style the package already uses.

**Boundary (who owns what):**

| Concern | Owner | Why |
|---|---|---|
| Goal: where to be, why, how urgent, allowed? | `director` (extended) | Already owns stance hysteresis + attention from `PerformanceState`; "never mid-sentence" is a `performance.mode` gate that belongs with the other gates. Refractory for LLM tools lives in `BodyDirectorMemory`. |
| Position integration (root x, velocity, accel/decel, arrival) | `locomotion` | Stop distance and the final foot plant must share one acceleration profile and one `dt`; a director that integrates position would have to know gait to stop on a planted foot. Same split as attention point (director) vs turn hysteresis (look-at). |
| Gait phase, stride, step targets, arm swing | `locomotion` | Pure `step(input, dt)` with internal memory, like `createLookAt`/`createWeightShift`. |
| Facing while moving | `locomotion` emits `rootYaw`; `MMDBody` passes it as `facingYaw` into `look.step` | `LookAtInput` already takes `facingYaw` (`look-at/index.ts:3`), so head offsets become relative to travel heading with no look-at change. Stationary keeps today's path. |
| Applying root motion and feet to bones | `stage-ui-mmd` new pose stage `locomotion`, registered before `weight-shift` | Pipeline rule: pose stages write absolute transforms from `context.clean`. |

Shape: `BodyIntent` gains `locomotion: { goalX: number; maxSpeed: number; reason: 'home'|'approach-chat'|'chase-cursor'|'roam'|'tool' } | null`; `LocomotionFrame = { rootPosition: Vec3; rootYaw; phase; moving; feet: Record<Foot, FootAnchor /* world */>; arms: {...} }`.

Two renderer consequences you must plan for: (1) `MMDFootContact` plants anchors mesh-local; under root motion the planner's **world** anchors must be re-expressed as `world - root` every frame or the feet slide with the root. (2) The ADR rule "every model transform change requests a physics reset" must be split into *user transform edit* (reset) vs *per-frame root motion* (no reset), otherwise walking resets Ammo every frame. Hair reacting to walking is the desired outcome of not resetting; a teleport (return-home after display hand-off) still resets.

**Risk:** `decideBody` is called from two places with partial inputs (`stance.ts:84`, `attention.ts:38`); widening its input forces both to grow or forces optional fields with defaults, and `attention.ts` calls it with `initialBodyDirectorMemory` every frame (stateless), which will silently defeat any refractory logic if someone reads a locomotion field from that call.

## C. Electron host decomposition

**Option 1 - extend `windows/main`** behind a flag. `main/index.ts` already interleaves bounds persistence (`windows[]` tag `main`), native drag plugin, `hideOnClose`, screen capture, and `userFacingMainWindow` publication; a full-screen branch inside it doubles every path in one file and persists display bounds into a config meant for a draggable window.

**Option 2 - new `windows/stage/`** manager (`setupStageWindows`), one `BrowserWindow` per display, built from pure option builders in the `desktop-overlay/window-contract.ts` style (copy the pattern, not the file: the stage needs `focusable: true` for the Controls Island and touch, and `setContentProtection` **off** so OBS and screenshots see the character; the overlay module sets both the other way). Register in `main/index.ts` with the same `injeca.provide` + eager `injeca.invoke` pattern the overlay uses (`main/index.ts:396-409`). Mode selection decides whether `windows:main` or `windows:stage` is built; whichever is built becomes `userFacingMainWindow` so chat/settings/caption/tray keep their `getMainWindow` seam.

**Recommendation: Option 2**, plus one abstraction that makes the chat work in both modes: a `CharacterPlacement { displayId; bounds: DIP rect of the projected skeleton bounds }` published by the renderer. `floating.ts` `attachToMain` becomes `attachTo(getAnchorRect, onAnchorChange)`: old mode anchor = main window bounds, stage mode anchor = character rect. `chooseAttachedChatLayout`/`attachedChatOffset` are pure over a `Rectangle` and need no change. The character rect is also the hit-mask broad phase (D), so it is computed once.

**Main vs renderer split:**

- Main: window-per-display lifecycle (`screen` `display-added/removed/metrics-changed`), always-on-top + visible-on-all-workspaces (reuse `setWindowAlwaysOnTop`), the `stage` config file (`createConfig('stage','config.json', schema)` like `chat-window`), the mode setting, which display is *active* (hosts the character), applying `setIgnoreMouseEvents` (only main can), and relaying `CharacterPlacement` to the chat manager.
- Renderer: calibration + camera from stage-world, hit mask decision, character placement publication, character drag along the ground line (pointer capture in-page; no native window drag, so `electron-click-drag-plugin` is unused in stage mode), home save on drag end, chat attention target unprojection via `unprojectDipToPlaneZ`.
- Multi-display hand-off: simplest is one model instance at a time. Only the active display's window loads the stage route; the others load nothing until a hand-off (`electronStageSetActiveDisplay`), then main swaps which renderer is live and the character teleports to that display's home (physics reset is correct there). Cross-display walking is out of scope under decision 3.

**Eventa contracts** (in `src/shared/eventa/index.ts`, same naming scheme):

- `electronStageGetState` invoke -> `{ mode, displays: StageDisplay[], activeDisplayId, homes: Record<string, StageHome> }`; `electronStageStateChanged` event.
- `electronStageSetHome` invoke `{ displayId, x }`; `electronStageSetMode` invoke (applies at relaunch, see E).
- `electronStageCharacterPlacementChanged` renderer->main event (change-only, like `createChatAttentionTargetFeed`); `electronStageGetCharacterPlacement` invoke for the chat manager.
- Reuse unchanged: `electron.window.setIgnoreMouseEvents`, `electronChatAttentionTarget*`, `electronChatFloatingState*`.

**Risk:** one WebGL + Ammo context per display if windows are created eagerly. Create the non-active windows lazily or blank; the spike must measure a single full-resolution transparent canvas before you decide.

## D. Hit mask

**Option 1 - renderer-projected capsules.** Project colliders to DIP shapes, send to main, main tests `screen.getCursorScreenPoint()` against them. No GPU readback; works where `forward` is unsupported (Linux). But the existing touch colliders cover only head and torso subtrees (`colliders.ts:76-80`) and vanish entirely for models without rigid bodies (ADR fallback to a mesh raycast), so legs, arms, and skirts become holes; you would need a second ~10-capsule silhouette set from `MMDRigProfile.bones`/`legIk`, and it still misses hair and cloth physics.

**Option 2 - alpha readback.** Already the mechanism of record: `pages/index.vue` drives `setIgnoreMouseEvents` from `isTransparentForMouseEvents`, and `stage-ui-three/hit-test.ts` reads a small region regardless of canvas size. Exact silhouette including physics. Cost: a synchronous GPU->CPU read per evaluation, and a full-resolution render target.

**Recommendation: readback as the authority, rect as the broad phase.** Cursor outside the projected skeleton rect (the `CharacterPlacement` you already publish for the chat) -> ignore events, no read. Inside -> one read per animation frame (not per `mousemove`) with the existing `regionRadius` -> flip the flag. The touch colliders stay what they are: a classifier for *which region* was touched, not the mask. Linux (no `forward`): fall back to main-process cursor polling against the rect only, reusing the existing NOTICE in `index.vue:363-368`.

**Risk:** the first click after a hover transition lands before the flag flips; the `index.vue` code already handles this with a 250 ms debounce on the way out and immediate on the way in. Preserve that asymmetry when you move the state machine to the stage page, or the first poke on the character falls through to the desktop.

## E. Migration and rollback

Keep a `stage.mode: 'window' | 'desktop'` setting in the new `stage` config file. Transparency and most window flags are fixed at creation (the chat manager says so explicitly, `chat/index.ts:93-96`), and the main window has eight downstream consumers (`main/index.ts:334-394`: chat, settings, caption, tray, `goNetwork.bindWindow`, screen capture, drag plugin, `hideOnClose`). **Apply the mode at the next launch** with a "Relaunch" button rather than a live switch; `createChatModeSwitch` shows a live switch is possible but it is a draft-handover state machine with its own test file, and a live switch here buys little during the branch.

Rollback = flip the setting; the old `windows:main` builds exactly as today. Keep `windows/main/index.ts` untouched (do not refactor it under the flag), and put stage persistence in its own file so `app/config.json` `windows[]` is never rewritten by stage mode.

**Regression surface created by dual mode:**
- Every `getMainWindow()` consumer runs against a different window kind (full-screen, non-moving). `electronCenterMainWindow` and `hideOnClose` are meaningless in stage mode; guard or no-op them explicitly.
- Chat attach has two anchor sources; `chat/index.test.ts`, `floating-placement.test.ts` need a stage-anchor case.
- The `index.vue` click-through state machine assumes "outside the window" exists; in stage mode it never does, so `useElectronMouseAroundWindowBorder` and the fade-on-hover semantics need a mode branch.
- Live2D in stage mode: either excluded (MMD-only, recommended for this branch) or rendered at the home spot with no locomotion; the ADR byte-identical constraint applies.

**Risk:** dual mode lingers. Write the removal condition in a `// NOTICE:` and in the ADR: delete `'window'` mode after roaming, chat anchoring, and hand-off ship and one feedback cycle passes.

## F. Blast radius

- `packages/stage-shared`: + `src/stage-world/` (+ tests), `package.json` exports, README/AGENTS.md mention, `eslint.config.ts` purity pattern.
- `packages/motion-driver-humanoid`: + `locomotion`, + `rest-pose`; `director` and `types` widened; tests for `director`, `types`; `package.json` exports.
- `packages/stage-ui-mmd`: `body/index.ts` (facing source, root-motion stage), `body/feet.ts` (world anchors), `body/attention.ts` (use stage-world unproject), `frame-pipeline.ts` (stage id, reset rule split), `camera-bounds.ts` consumers (calibration replaces framing in stage mode), `natural/adapter.ts` (head projection feeds `screenInwardness`), `stores/motion-diagnostics.ts` (position/goal/phase), `overlays.ts` (floor line, ground line, home marker), settings `settings/mmd/*` for stays-put/roams. Tests: `body.test`, `body.browser.test`, `frame-pipeline.test`, `stance.test`, `overlays.test`, `adapter.test`.
- `packages/stage-ui`: devtools motion lab (`features/devtools/motion/mmd/`) for locomotion fields; settings UI for stage mode + roaming; `packages/i18n` English only.
- `apps/stage-tamagotchi`: `main/windows/stage/*` new (+ tests modelled on `desktop-overlay/window-contract.test.ts`), `main/index.ts` DI, `shared/eventa/index.ts`, `windows/chat/floating.ts` anchor abstraction (+ tests), `renderer/pages/index.vue` or a new `pages/stage.vue`, Controls Island drag start, settings layout route/icon, `AGENTS.md` windows table.
- Docs: new ADR in `docs/ai/adr/` (stage world + locomotion), follow-ups section of the 2026-10-30 ADR, package READMEs; `docs/assets/ai/context/ui-components.md` only if a shared component API changes.
- Unchanged by design: `motion-driver-natural`, `stage-ui-live2d`, `features/performance`, hosted `server/`.

**Risk:** the `attention.ts` change touches the look-at target for the *existing* window mode too; keep a behaviour-preserving degenerate calibration (current framing) and compare diagnostics before/after, or the old mode regresses silently.

## G. Wave order

**Wave 0 - feasibility spike** (env-gated like `AIRI_DESKTOP_OVERLAY`, throwaway): one full-display transparent window on the primary display loading the existing `/` route with a `stage-mode=world` query (`mainWindowQuery` already exists), MMD model at a hard-coded calibration. Measure and record: transparency + always-on-top + `forward` click-through on Windows at 125%/150% scale; alpha-readback ms at full resolution; frame time and VRAM for a 2560x1440 transparent canvas with Ammo; per-frame root translation without physics reset (hair reacts, no explosion); OBS/screenshot visibility with content protection off. Exit criteria are numbers, and they decide D and the FOV in A.

**Wave 1 - stage-world contract** in stage-shared: calibration solve, projection, ground line, home; replace the `attention.ts` raycast with it under a degenerate calibration so the old mode stays identical.

**Wave 2 - Electron stage module**: per-display windows, `stage` config, mode setting (relaunch-apply), eventa contracts, `CharacterPlacement` publication, chat anchor abstraction, hit mask (rect broad phase + readback). Character stands at home; no locomotion. Shippable on its own.

**Wave 3 - locomotion**: humanoid `locomotion` + `rest-pose` (seeded, trace-hash tests like Natural), director goal extension, MMD root-motion stage, world foot anchors, reset-rule split, diagnostics + lab overlays. Drag along the ground line, return home.

**Wave 4 - behaviours**: approach on chat unfold, cursor chase after interaction, stays-put/roams, LLM tool vocabulary with refractory in director memory, never-relocate-mid-sentence gate on `performance.mode`.

**Wave 5 - multi-display hand-off and hot-plug**, then removal of `'window'` mode per E.

**Risk for the order:** Wave 2 before Wave 3 is only safe if Wave 0 proved per-frame root motion without physics reset; if it did not, Wave 3's design changes (hips-translate-within-mesh instead of root-translate), and the world-anchor plan in B changes with it. Run Wave 0 first for that reason alone.

## B. Detail design: camera, gait, arm rest, hit mask, interfaces (ultrabrain lane st_01a19179)

### Detail design: camera calibration, gait, arm rest pose, hit mask and interfaces

## Bottom line
- **Camera:** use a perspective camera with an off-axis frustum. Hold three values fixed: world units per DIP on the z=0 plane, `s = Hm/P`; camera distance `D = 5·Hm`; and eye height `e_y = 0.5·Hm`. With those fixed, the floor line and the character's height in pixels are exact by construction, and resizing or a DPI change never moves the character on screen.
- **Gait:** drive it from a phase counter. Each foot's world anchor stays fixed while it carries weight, so a planted foot cannot skate. The real limit is leg reach, so speed changes are bounded by that.
- **Body blend:** the gait produces the same body channels as `composeWeightShift`, including a support signal `s` with the same sign convention. Moving between idle and walking is then a plain linear blend.
- **Arm rest pose:** write the pose as body-space angles. Convert them using the rig's `restArmAngle`. I checked numerically that A-pose (ρ=36°) and T-pose (ρ=0°) produce the same arm direction in the world.
- **Hit mask:** keep the existing alpha readback as the source of truth. Add a cheap screen-rectangle gate in the main process, and fall back to projected capsules when readback isn't available.

**What I relied on in the repo (read-only, no edits):**
- `RestRelativeRotation` doesn't say which order yaw, pitch and roll are applied in.
- In look-at, positive pitch looks down and forward is +Z.
- `FootContact` keeps its anchors in mesh-local coordinates and has no way to re-base them; `planFootSteps` lifts the foot a fixed 0.3 units.
- `WeightShiftOutput.s` is +1 when the right leg carries the weight; `pelvisLateral = +0.45·s`; `lowerBodyRoll = −4°·s`; `lowerBodyYaw = +3°·s`.
- `MMDRigProfile.restArmAngle` already exists.
- Touch colliders are built from the PMX rigid bodies.
- An alpha-readback hit test already exists (`stage-three-runtime-diagnostics.ts` tracks `readCount` and `lastReadWidth`).
- `use-chat-floating-click-through.ts` already sends the cursor from the main process to the renderer, and `pages/index.vue` notes that `forward:true` isn't supported on Linux.

**Effort:** camera Short · gait Large · arm rest Medium · hit mask Short (it reuses the readback) · interfaces Quick.

---

## 1. Camera calibration

**Frame.** Units are right-handed, +Y up, and the character faces +Z. The camera sits at +Z and looks along −Z with up = +Y and no pitch. World x=0 is the work area's left edge. y=0 is the floor, which is the sole plane. Pixel coordinates `(u, v)` are DIP measured from the window's top-left; the window covers the whole work area. The floor row `r_f` is an edge coordinate, so the very bottom of the window is `r_f = H`, not `H−1`.

**Invariants**

| Quantity | Formula |
|---|---|
| World units per DIP at z=0 | `s = Hm / P` |
| Camera distance | `D = κ·Hm`, with κ = 5 |
| Eye position | `E = (e_x, e_y, D)`, `e_x = s·W/2`, `e_y = η·Hm` (η = 0.5 recommended) |
| Aspect | `W / H` |

**Frustum.** The rectangle the camera sees on the z=0 plane is `x ∈ [0, sW]` and `y ∈ [−s(H−r_f), s·r_f]`. At the near plane `n` this becomes:

```
left   = (0      − e_x)·n/D      right = (sW    − e_x)·n/D
bottom = (−s(H−r_f) − e_y)·n/D   top   = (s·r_f − e_y)·n/D
near = 0.1·D,  far = 2·D
```

In three.js this maps to `projectionMatrix.makePerspective(left, right, top, bottom, near, far)`, or to `setViewOffset` on a larger virtual frame.

**Symmetric special case.** Setting `e_y = s(r_f − H/2)` removes the vertical offset, and the frustum reduces to a single field of view: `fov_v = 2·atan(s·H / (2D))`.

**Why this is exact.** The z=0 plane is parallel to the image plane, so it maps to the screen by a pure scale:
- `u = x/s`
- `v = r_f − y/s`

So the floor point (y=0, z=0) always lands on row `r_f`, and any vertical segment of height Hm standing at z=0 is exactly `Hm/s = P` DIP tall.

**World to DIP for any point:**

```
k = D / (D − z)
u = (e_x + (x − e_x)·k) / s
v = r_f − (e_y + (y − e_y)·k) / s
```

**DIP onto a plane.**
- Onto z=0: `x₀ = s·u`, `y₀ = s·(r_f − v)`.
- Onto a plane z=k: move along the ray from E through `(x₀, y₀, 0)`:

```
x_k = e_x + (x₀ − e_x)·(D − k)/D
y_k = e_y + (y₀ − e_y)·(D − k)/D
```

**Worked example** (W=2560, H=1400, Hm=20, P=600, r_f=1400, all numbers checked numerically)

| Quantity | Symmetric camera | Off-axis camera (η=0.5) |
|---|---|---|
| s | 1/30 = 0.03333 | same |
| D | 100 | same |
| e_x | 42.667 | same |
| aspect | 1.8286 | same |
| e_y | 23.333 | 10 |
| Field of view | 26.27° | 20.14° above the axis, 5.71° below |
| Near-plane bounds (n=10) | from the fov | l/r ±4.267, bottom −1.0, top 3.667 |
| Equivalent virtual frame | none | fov 40.27°, height 2200 DIP, view offset y=0 |

- **Projection check (symmetric):** the head (y=20) lands on v=800 and the feet (y=0) on v=1400, so the character is 600 DIP tall.
- **Unprojection check:** the cursor at (1280, 400) maps to (42.667, 33.333) on z=0.
  - On z=5 it maps to y=32.833 (symmetric) or y=32.167 (off-axis).
  - At u=0 on z=5 it maps to x=2.133.

**Edge cases**
- **Points in front of z=0 drop below the floor row.** A floor point at z>0 is drawn below the bottom edge by `e_y·z/(D−z)/s` DIP. Toes about 1.5 units ahead of the ankle drop **10.7 DIP** with the symmetric camera and **4.6 DIP** off-axis. Either reserve a margin (`r_f = H − ceil(margin)`) or stand the root at `z = −toeForward`. This is the main reason to prefer off-axis, along with a less steep view of the feet.
- **Character too tall for the window.** Clamp `s ≥ Hm / (0.9·(r_f − topMargin))` so the character can never be taller than the window.
- **Gaze targets:** unproject the cursor onto `z = k_gaze ≈ 0.6·D` so the eyes converge in front of the character, not on the screen plane.

**Stability across resize and DPI changes**
- Keep `s`, `D`, `e_y` and the bottom margin fixed. Recompute only `e_x`, the aspect and the frustum from the work area that the main process sends over IPC, not from `innerHeight` during a resize.
- Apply the camera change and `renderer.setSize(W, H)` / `setPixelRatio(dpr)` at the start of the same frame, so there is never a frame where one has changed and the other hasn't.
- DPI changes only the backing-buffer size. The character keeps P DIP, which is what the OS intends. If you want physical pixels instead, set `s = Hm·dpr / P_phys`.
- Because `u = x/s` doesn't depend on W, the root's world x keeps its screen column through a resize. If the work area shrinks past the root, the director walks the character back inside.

**Orthographic alternative.** An orthographic camera with half-height `sH/2` gives `u = x/s` at every depth. That means no toe clipping, and projected spheres are exact circles. I don't recommend it as the default:
- "Look at the camera" stops meaning anything, because there is no camera position to aim the eyes at.
- Turning and walking lose all depth cues.
- MMD content is authored for perspective. MMD's default view angle is 30°; that is from memory, not checked.

Setting D → ∞ in the formulas above gives the orthographic camera, so it can be added later as a toggle.

---

## 2. Procedural gait

**Signs.**
- `ς(foot)`: left = −1, right = +1. This matches the weight-shift convention.
- `σ = −ς` for mirrored arm rotations (left = +1).
- Heading `ψ`: direction `d̂ = (sin ψ, 0, cos ψ)`, lateral axis `n̂` toward the character's right.

**Parameters** (L = `RigTraits.legLength`, h₀ = vertical distance from the bind hip to the bind ankle)

| Symbol | Meaning | Value |
|---|---|---|
| ℓ_ref | step length at reference speed | 0.6·L (0.5·L if you want a softer bob) |
| f_ref | step rate at reference speed | 1.8 Hz |
| v_ref | reference speed | ℓ_ref·f_ref |
| ℓ(v) | step length | `ℓ_ref·√(v/v_ref)` |
| f(v) | step rate | `v/ℓ(v)`, clamped to [1.2, 2.4] Hz; if clamped, `ℓ = v/f` |
| β | share of the stride a foot spends on the ground | 0.6 |
| δ = 2β−1 | double-support fraction of each step | 0.2 |
| c₀ | constant knee softening while walking | 0.02·L |
| r_plan / r_hard | planning reach / hard reach limit | 0.97·L / 0.985·L (same as `FootContact`) |
| a_max | speed ramp limit | v_ref per second |
| w | step width (ankle spacing) | 0.7 × the bind ankle spacing |

**Phase.** `φ += f(v)·Δt` with Δt = 1/120. Integrating a phase instead of computing `f·t` means a change of speed never makes the phase jump.
- Step index `i = ⌊φ⌋`, position within the step `t = φ − i`.
- The swinging foot `S_i` alternates, starting from `S₀`.
- The swing runs over `t ∈ [δ, 1)`, with swing progress `u = (t−δ)/(1−δ)`.

**Feet**
- **Planted foot:** its world anchor never changes while it is planted.
- **Landing target:** `X_land = R̂(t_land) + β·ℓ_i·d̂ + ς(S_i)·(w/2)·n̂`, where `R̂(t_land)` is the predicted root position at touchdown. Re-plan it every tick until `u = 0.75`, then freeze it.
- **Swing path:**
  - Horizontal: `p(u) = p_lift + (X_land − p_lift)·c(u)` with the cycloid `c(u) = u − sin(2πu)/(2π)`. Its velocity is zero at lift-off and touchdown.
  - Height: `y(u) = footBaselineY + H_sw·sin(πu)`, with `H_sw = max(0.03L, 0.08L·√(ℓ_i/ℓ_ref))`.
  - Foot yaw blends to the heading with the same `c(u)`.
- **Why β·ℓ ahead:** the stance lasts 1.2T, during which the root moves 1.2ℓ = 2βℓ. So a foot lands at +βℓ and lifts off at −βℓ, symmetric about the hip.

**Body channels.** These use the same fields as `NaturalBodyComposition`.

The support signal uses the same sign as `WeightShiftOutput.s`:
```
s_loco(φ) = −ς₀ · sin(π(φ − 0.1))      ς₀ = ς(S₀)
```
It crosses zero at the middle of double support (t = 0.1) and peaks over the planted foot at mid-stance (t = 0.6).

The leading-foot signal is:
```
lead(φ) = −ς₀ · cos(π(φ − 0.1))
```

| Channel | Formula |
|---|---|
| Pelvis drop (bob) | `c₀ + A_bob·(1 + cos(2π(φ − 0.1)))/2`, lowest in double support |
| Pelvis lateral (sway) | `A_sway·s_loco`, A_sway = 0.03L, ×0.7 above v_ref |
| `lowerBodyRoll` (hip drop on the swing side) | `−3°·(ℓ/ℓ_ref)·s_loco` |
| `upperBodyRoll` (counter-roll) | `+1.5°·(ℓ/ℓ_ref)·s_loco` |
| `lowerBodyYaw` | `+4°·(ℓ/ℓ_ref)·lead`; positive yaw brings the right hip forward, matching weight-shift |
| `chestCounterYaw` | `−0.5 × lowerBodyYaw` |
| Lean | total `2°·v/v_ref + 3°·a/a_max`, filtered by a spring with ω = 4, split 60% spine / 40% chest |
| Arm flexion, side X | `α_X = 2° − 12°·min(1.3, v/v_ref)·ς(X)·lead(φ − 0.05)`, applied as pitch `−α_X` |
| Elbow flexion | `12° + 0.5·max(0, α_X)` |

The bob amplitude comes from the reach limit:
```
A_bob = (h₀ − c₀ − √(r_plan² − (βℓ)² − e_lat²)) / ((1 + cos(πδ))/2)
```
Here `e_lat` is the largest sideways offset between hip and ankle during double support, and the denominator is 0.9045 for δ = 0.2.

**Worked example** (L = 10, h₀ = 10, s = 1/30)
- **Speed and timing:** v_ref = 10.8 units/s, which is **324 DIP/s**. T = 0.556 s, swing 0.444 s, stance 0.667 s. The swing foot peaks at 54 units/s.
- **Bob:** with r = 0.985L and the factor ignored, the drop needed at heel strike is 0.631 units. With the factor applied, A_bob ≈ 0.70, about 7% of L. With ℓ_ref = 0.5L it is about 0.46 (4.6% of L, close to a human's).
- **Low speeds:**
  - At v = 0.5·v_ref: ℓ = 4.24, f = 1.27 Hz.
  - At v = 0.25·v_ref: the step rate clamps at 1.2 Hz and ℓ = 2.25.

**Start, stop and turning**
- **Turn in place:** reuse `planFootSteps` with the pivot at the root, at most 45° per step, 0.45 s per step. A 90° turn takes two steps (0.9 s). Change its fixed 0.3 swing height to `0.03L`.
- **Start:**
  - Begin at φ = 0.1 so the sway starts centred.
  - `S₀` is the opposite foot to the last turn step. With no turn, it is the unloaded foot from weight-shift (`s > 0.2` → left, `s < −0.2` → right). In a tie, pick with the seeded RNG.
  - Speed rises at a_max. It reaches v_ref after 1.0 s and 5.4 units.
- **Stop:**
  - `v = min(v_cmd, √(2·a_max·d))`, where d is the distance left to the goal. The root reaches the goal with v = 0, with a grid error of at most `a_max·Δt²/2` (about 4e-4 units).
  - Steps shrink on their own because `ℓ = v/f` and f has a floor.
  - The last landing is forced beside the root (lateral w/2, fore-aft 0). If the other foot is more than 0.1L away fore-aft, it takes one more closing step.
  - Mode becomes `idle` after both feet have been planted for 0.25 s.
- **Feet never skate**, because planted anchors are fixed by construction. The real risk is a stretched leg making the IK slide the ankle. Guard it two ways:
  - a_max, sized so the next limit never triggers in normal driving;
  - a leash: `(root − stanceAnchor)·d̂ ≤ √(r_hard² − (h₀ − drop)²)`.
- **Root motion** moves the model's scene object, not the center bone, so physics gets real inertia. A teleport (drag) resets physics.
- **Required contract changes:**
  - `FootContact` needs a `setAnchors(Record<Foot, FootAnchor>)` re-base hook, because its anchors are mesh-local and the root moves.
  - Look-at needs `allowTurn: false` while locomotion owns facing.

**Blending with idle weight-shift**
- `w_loco` ramps with smoothstep over 0.3 s; weight-shift gets `duck = 1 − w_loco`.
- Every body channel is `lerp(composeWeightShift(...), locomotion.body, w_loco)`. This works because both use the same field names and signs.
- Foot ownership:
  - When `w_loco > 0`, the gait owns the foot targets and seeds its anchors from `FootContact`'s current planted anchors, so nothing jumps.
  - On stop, the gait hands its final anchors back through `setAnchors`. The closing step makes them about equal to the bind ankle positions relative to the new root.

**Node tests** (120 Hz grid, seeded)

| Test | Assertion |
|---|---|
| Planted slip | For each run of planted frames, `max ‖target_k − target_first‖ ≤ 1e-9` |
| Ground slide | Sum of horizontal movement while `target.y − baseline < 0.01L` is ≤ 0.002L per step. Analytically 0.00042 × 2ℓ at each end, about 0.001L. |
| Reach | Every frame, hip-to-planted-ankle distance ≤ 0.985L; leash clamp count = 0 in normal scenarios |
| Step period | Steady state: heel-strike gaps are within 1 tick (1/120 s) of `1/f(v)`. At v_ref: 66 or 67 ticks. |
| Symmetry | L/R step lengths equal within 1e-6·L; stance durations within 1 tick; mean `s_loco` over 2 strides < 1e-3; arms mirrored (`α_L − 2° = −(α_R − 2°)`) |
| Alternation | Swing feet strictly alternate; at least one foot is planted in every frame |
| Speed ramp | Speed never changes faster than a_max allows (allow 1e-9 for rounding) |
| Arrival | Root at the goal within 1e-3 units; v = 0; both feet planted; fore-aft gap < 0.05L |
| Turn | After a 90° turn, both foot yaws equal the facing; a planted foot never moves |
| Continuity | Per-tick change of every channel is bounded across the start and stop blends; identical inputs give `deepEqual` frames |

---

## 3. Rest arm pose layer

**Assumptions.** Both rigs have world-aligned bind frames: MMD bones have identity rest rotation, and normalized VRM bones do too. So for each bone, "parent frame" means model axes at bind. Palms face down at bind in both A-pose and T-pose. I assume `RestRelativeRotation` is applied as **intrinsic YXZ (R = Ry·Rx·Rz)**. Pin that order in `types` with a test; I did not check which order the adapter uses. Mirroring left to right is: yaw → −yaw, pitch unchanged, roll → −roll.

**Input** (body-space angles; same numbers for every rig)

| Field | Default | Meaning |
|---|---|---|
| `hangAngle` Θ | 78° | upper arm below horizontal, in the frontal plane |
| `shoulderDrop` ε | 5° | shoulder sits slightly lowered |
| `flexion` f | 4° | upper arm slightly forward |
| `elbowFlex` | 12° | relaxed elbow bend |
| `wristFlex` | 8° | relaxed wrist bend toward the palm |
| Finger curl (prox/int/dist) | 15°/20°/10° | × 1.0 / 1.15 / 1.3 / 1.45 for index / middle / ring / little |
| Thumb | 10° | about an axis the adapter measures: `normalize(thumbDir_bind × palmNormal)` |

**Conversion with bind arm angle ρ** (`restArmAngle`; side sign σ, left = +1)
- **Shoulder:** `R_sh = Rz(−σε)`.
- **Upper arm:**
  - Target in the world: `R_des = Rx(−f)·Rz(σ(ρ − Θ))`.
  - Local rotation: `R_up = R_shᵀ·R_des`, computed exactly with quaternions.
- **Lower arm:** rotate by `−elbowFlex` about the axis `(sin ρ_f, σ·cos ρ_f, 0)`, where ρ_f is the forearm's bind angle, defaulting to ρ. This is the axis `d̂ × Ẑ`, so the forearm bends forward.
- **Hand and fingers:** the curl axis is `d̂ × n̂ = −σẐ` for every ρ, so the hand is just roll `−σ·wristFlex` and finger curl is roll `−σ·curl`.

**Worked example** (left side; numbers checked)

| Output | ρ = 36° (MMD) | ρ = 0° (VRM) |
|---|---|---|
| Upper arm (yaw, pitch, roll) | (−0.35°, −3.99°, −36.99°) | (−0.35°, −3.99°, −72.99°) |
| Elbow (yaw, pitch, roll) | (−9.76°, −7.02°, 0.60°) | (−12°, 0°, 0°) |
| Resulting forearm direction in the world | (0.2034, −0.9399, 0.2741) | (0.2034, −0.9399, 0.2741) |

Both rigs end up with the same forearm direction. Turn that equality into a unit test.

**Coupling with breath and weight shift**
- Breath b ∈ [−1, 1]: shoulder roll `+σ·0.8°·b`, upper-arm roll `−σ·0.6°·b`, so the hands stay nearly still.
- Torso roll `τ = upperBodyRoll + chestCounterRoll`: upper-arm roll gets `−0.8·τ`. This term is the same on both sides because it is a single rotation about Z. Pass it through a critically damped spring with ω = 6 rad/s so the arms swing like a slightly lagging pendulum.
- Walking arm swing from section 2 adds on top in the same frame.

**Clip ownership mask**
- **When:** build it once when the clip loads, from the per-track keyframe values. Do not rely on track names alone.
- **What counts as animated:**
  - A quaternion key differs from identity by more than 0.5°, or keys differ from each other by more than 0.5°.
  - A position key differs by more than 0.01 units.
  - This test matters because many VMD files key every bone at frame 0 with identity; those keys do not count.
- **Map bones to groups:** go through the rig bone map. MMD twist and shoulder helper bones (腕捩, 手捩, 肩P) count toward that side's arm.
  - If any of shoulder, upperArm, lowerArm or hand is animated, the clip owns that whole side's arm chain.
  - Fingers are a separate group.
  - `root` (センター/グルーブ) and `legIk` are also groups. When either is owned, locomotion is blocked.
- **Per-frame ownership:** `owned_g = min(1, Σ clipWeight_c · mask_c[g])`, the same way as `clipFootTrackWeight` in `feet.ts`.
- **Blend rule:** applied after the mixer and before IK/physics: `q_final = q_mixer · slerp(I, Δ_rest·Δ_breath·Δ_swing, 1 − owned_g)`.
  - At ownership 0 and 1 this is exact. In between it only approximates `slerp(rest, clip, w)`. Mark it with a `// NOTICE:` that it can be removed once layers blend in delta space.

---

## 4. Hit mask

| | (a) Capsules projected to screen, tested in main | (b) Alpha readback in the renderer |
|---|---|---|
| Accuracy | Covers only the rigid bodies. Misses hair and skirt edges, and over-covers the gap between arm and body. | Exact to the pixel |
| Cost | Projects about 20–40 shapes to 2D; trivial | Asynchronous readback via PBO + fence. Free when the cursor is outside the gate. |
| Delay to capture the click | at most 17 ms poll + up to 33 ms for stale shapes | see below |
| Robustness | Keeps working while the renderer is throttled or hidden | Needs frames to be rendered |

**Recommendation: (b) as the source of truth, with a gate in main and (a) as fallback.** Reuse the existing readback.

**Data flow**
1. The renderer publishes the character's screen rectangle in DIP (padded by 8 DIP), plus its 2D capsules, at about 30 Hz. It sends them only when they change by more than 2 DIP.
2. The main process polls `getCursorScreenPoint` at 60 Hz. On Windows and macOS you can use `forward:true` mouse-move events instead. Outside the rectangle, main sets `ignore = true` itself, with no renderer round trip.
3. Inside the rectangle, the renderer runs an asynchronous readback of a 5×5 physical-pixel block (DIP × dpr) after it renders. A hit is alpha above 0.1.
   - Capture immediately on a hit; release only after 2 misses in a row.
   - Call `setIgnoreMouseEvents(!hit, { forward: true })` only when the result changes.
4. If the renderer goes stale (no answer for 100 ms), main falls back to the capsule test.

**Delay budget at 60 Hz** (cursor sample → IPC → next frame → readback frame → IPC → OS)
- Capture: worst about 53 ms, typically 25–35 ms.
- Release when leaving the rectangle: at most 17 ms.

---

## 5. Interfaces (renderer-neutral)

Put `WorldFrame` in `stage-shared` so the humanoid package stays free of camera concerns. The director only ever sees the ground line.

```text
/** Display work area in DIP, as reported by the main process. */
export interface WorkAreaSize {
  readonly width: number
  readonly height: number
}

export interface CameraCalibrationInput {
  readonly workArea: WorkAreaSize
  /** Measured model height from the sole plane (y = 0) to the crown, in world units. */
  readonly modelHeight: number
  /** On-screen character height in DIP. */
  readonly characterHeightDip: number
  /** Floor edge row in DIP from the top; workArea.height minus the toe margin. */
  readonly floorRowDip: number
  /** Camera distance in model heights. Default 5. */
  readonly distanceInModelHeights?: number
  /** Eye height in model heights; null selects the symmetric frustum. Default 0.5. */
  readonly eyeHeightInModelHeights?: number | null
}

export interface CameraCalibration {
  /** World units per DIP on the z = 0 plane. */
  readonly unitsPerDip: number
  readonly position: Vec3
  /** Look direction is -Z and up is +Y; there is no pitch. */
  readonly frustum: {
    readonly left: number
    readonly right: number
    readonly bottom: number
    readonly top: number
    readonly near: number
    readonly far: number
  }
  /** Width over height, in DIP. */
  readonly aspect: number
  /** Vertical field of view in radians; only meaningful for the symmetric frustum. */
  readonly verticalFov: number
}

export interface WorldFrame {
  readonly workArea: WorkAreaSize
  readonly calibration: CameraCalibration
  /** Reachable root x range on the ground line, already inset by the model's half-width. */
  readonly ground: {
    readonly minX: number
    readonly maxX: number
  }
}

export declare function calibrateCamera(input: CameraCalibrationInput): CameraCalibration
export declare function dipToPlane(calibration: CameraCalibration, point: { x: number, y: number }, planeZ: number): Vec3
export declare function worldToDip(calibration: CameraCalibration, point: Vec3): { x: number, y: number }
```

```text
export type LocomotionPace = 'stroll' | 'walk' | 'hurry' // 0.6, 1.0, 1.3 × v_ref

export interface GaitTraits extends Pick<RigTraits, 'legLength' | 'footBaselineY'> {
  /** Bind hip-to-ankle vertical distance in model units. */
  readonly hipToAnkleY: number
  /** Bind ankle positions in mesh-local model units. */
  readonly bindAnkles: Record<Foot, Vec3>
}

export interface LocomotionInput {
  /** Seconds on the fixed 120 Hz grid. */
  readonly now: number
  /** World x on the ground line; null means stay. */
  readonly goalX: number | null
  readonly pace: LocomotionPace
  /** Facing at arrival, in radians; 0 faces the camera. */
  readonly arriveFacing: number
  /** False while sitting, during one-shots, or when a clip owns root or leg IK. */
  readonly enabled: boolean
  /** WeightShiftOutput.s; picks the first swing foot. */
  readonly idleSupport: number
  /** Current planted anchors in world space; the gait seeds from them while idle. */
  readonly plantedFeet: Record<Foot, FootAnchor>
}

export interface LocomotionFoot {
  /** World target for the ankle. */
  readonly target: FootAnchor
  /** True while this foot carries weight; its target is then frozen. */
  readonly planted: boolean
  /** Swing progress 0..1, or null while planted. */
  readonly swing: number | null
}

export type GaitEvent = {
  readonly kind: 'liftOff' | 'heelStrike'
  readonly foot: Foot
  readonly time: number
}

export interface LocomotionFrame {
  readonly mode: 'idle' | 'turning' | 'starting' | 'walking' | 'stopping'
  readonly root: {
    /** World position; y = 0. */
    readonly position: Vec3
    readonly yaw: number
  }
  readonly speed: number
  /** Continuous phase, in steps. */
  readonly phase: number
  readonly feet: Record<Foot, LocomotionFoot>
  /** Same sign as WeightShiftOutput.s. */
  readonly support: number
  readonly body: NaturalBodyComposition & { readonly chestCounterYaw: number }
  readonly armSwing: Record<Foot, {
    readonly flexion: number
    readonly elbowFlex: number
  }>
  /** Blend factor; weight-shift duck is 1 - weight. */
  readonly weight: number
  readonly events: readonly GaitEvent[]
}
```

```text
export type HumanoidFingerBoneName = `${'left' | 'right'}${'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Little'}${'Metacarpal' | 'Proximal' | 'Intermediate' | 'Distal'}`
export type ArmBoneName = Extract<HumanoidBoneName, `${string}${'Shoulder' | 'UpperArm' | 'LowerArm' | 'Hand'}`> | HumanoidFingerBoneName

/** Body-space angles in radians; identical for every rig. */
export interface ArmRestPose {
  readonly hangAngle: number
  readonly shoulderDrop: number
  readonly flexion: number
  readonly elbowFlex: number
  readonly wristFlex: number
  readonly fingerCurl: Readonly<Record<'thumb' | 'index' | 'middle' | 'ring' | 'little', readonly [number, number, number]>>
}

export interface ArmRestInput {
  /** MMDRigProfile.restArmAngle; 0 for VRM. */
  readonly bindArmAngle: number
  readonly bindForearmAngle?: number
  /** Measured by the adapter, in model axes. */
  readonly thumbAxis?: Record<Foot, Vec3>
  readonly pose: ArmRestPose
  /** -1..1 */
  readonly breath: number
  /** upperBodyRoll + chestCounterRoll, in radians. */
  readonly torsoRoll: number
  readonly swing?: LocomotionFrame['armSwing']
  readonly swingWeight: number
  readonly owned: Readonly<Record<'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers', number>>
}

export interface ArmRestFrame {
  /** Already scaled by (1 - owned); applied as intrinsic YXZ. */
  readonly rotations: Readonly<Partial<Record<ArmBoneName, RestRelativeRotation>>>
}
```

```text
export type ClipMaskGroup = 'root' | 'leftLegIk' | 'rightLegIk' | 'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers' | 'upperBody' | 'head'

export interface ClipTrackSummary {
  readonly boneName: string
  readonly property: 'quaternion' | 'position'
  /** Flattened key values. */
  readonly values: ArrayLike<number>
}

export interface ClipBoneMask {
  /** Rig bone names with a non-rest key. */
  readonly animatedBones: readonly string[]
  readonly groups: Readonly<Record<ClipMaskGroup, boolean>>
}

export declare function buildClipBoneMask(
  tracks: readonly ClipTrackSummary[],
  bones: Readonly<Partial<Record<HumanoidBoneName | HumanoidFingerBoneName, string>>>,
): ClipBoneMask
```

```text
export interface BodyLocomotionIntent {
  /** World x of the home spot on the ground line. */
  readonly homeX: number
  /** World x target, or null to stay. */
  readonly goalX: number | null
  readonly pace: LocomotionPace
  readonly arriveFacing: number
  readonly reason: 'stay' | 'return-home' | 'wander' | 'approach-cursor'
}

export interface DirectorBodyIntent extends BodyIntent {
  readonly locomotion: BodyLocomotionIntent
}

// BodyDirectorInput gains:
//   ground: WorldFrame['ground']
//   rootX: number
//   locomotionMode: LocomotionFrame['mode']
//   clipOwnsRoot: boolean
// BodyDirectorMemory gains:
//   goalX: number | null
//   goalSinceMs: number | null
//   rngState: number
// Rules:
// - Sit or sleep only once locomotionMode === 'idle'.
// - A goal is issued only while standing and stays at least GOAL_MIN_DWELL_MS.
// - goalX is clamped to ground.
```

---

## Action plan
1. Add `calibrateCamera`, `dipToPlane` and `worldToDip` with the worked-example tests above. **Short.**
2. Pin the YXZ Euler order in `types`, and add `HumanoidFingerBoneName`, `ClipBoneMask` and `buildClipBoneMask`. **Quick to Short.**
3. Write the arm rest decider, including the test that A-pose and T-pose give the same world direction. **Medium.**
4. Write the gait decider and its Node test suite. Add `FootContact.setAnchors` and look-at `allowTurn`. **Large.**
5. Extend the director with the locomotion intent. **Short.**
6. Add the rectangle gate and capsule fallback around the existing readback. **Short.**

## Risks and mitigations
- **Euler order mismatch in the adapter:** the arm numbers would come out wrong. Mitigation: the A/T world-direction test, run through the real adapter.
- **Flat feet need about 7% bob at 0.6L steps:** use ℓ_ref = 0.5L, or add heel-off later and measure the skate metric at the toe instead.
- **Partial clip weights:** the ownership blend is only approximate between 0 and 1. It is exact at the endpoints and marked with a `// NOTICE:`.
- **Linux has no `forward:true`:** the main-process poll covers it.

I edited no files; this turn only read files and ran scratch calculations.
