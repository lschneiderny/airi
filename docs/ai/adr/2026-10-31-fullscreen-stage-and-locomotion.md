# Full-screen desktop stage and locomotion for MMD models

Date: 2026-10-31
Status: accepted

This decision was made on `luke/feat/fullscreen-stage`, which lands on `main` in slices under [the lazy 3D renderers ADR](2026-11-04-lazy-3d-renderers.md). On `main` today: the stage-world contract, locomotion, the arm rest pose, clip masks, the MMD stage-world adapter, the body tools, and the asynchronous alpha reader. The desktop stage host, its window contract, click-through, the chat anchor, the Desktop stage settings section, and `pnpm qa:stage` are on `main` too, behind the off-by-default **Experimental 3D stage** setting. While it is off, the classic window is the only host, and the MMD scene runs its stage-world code only when a host passes `stageWorld`.

## Context

Before this change, an MMD character lived in the classic main window: a 450x600 DIP transparent `BrowserWindow` that the user dragged around. She could not leave it, so walking, a home spot, and walking over to the chat had no space to happen in. The camera framed the skeleton bounds, so no world, floor, or calibration contract existed. Her arms held the bind A-pose. `BodyIntent` carried a stance and an attention target only, and the LLM had expression tools only. The milestone M2 of [the 3D character motion ADR](2026-10-30-3d-character-motion.md) named locomotion and window following as the next step.

The goal was a character who stands on the bottom edge of the work area of the display she lives on. She has a home there, walks to the chat when it unfolds, follows the cursor after the user interacts with her, returns home, and, if the user allows it, wanders rarely. The desktop must stay usable: everything except her rendered pixels passes clicks through, and the stage never takes focus. The space is a real 3D world even though no behaviour uses depth yet. The classic window had to stay available as a rollback path, and the Live2D path had to stay byte-identical.

A spike measured a full-screen transparent stage window before any behaviour work depended on it (plan evidence is not committed, so the numbers are quoted below). It ran on standard Chisa with the Natural driver on an M2 Mac with a 1440x900 DIP display at scale factor 2.

- Root translation without a physics reset was stable: 574 snapshots, no NaN, a peak foot error of 5.52e-5 model units, and hair and coat trailing the motion.
- At full resolution, the stage cost FPS against the classic window. The median spike/classic ratio over three idle pairs was 0.869 (pairs 0.849, 0.869, 1.014), below the 0.9 gate. The WebGL render itself cost the same (0.59 ms against 0.58 ms). The extra cost was compositing a 2880x1602 px transparent surface.
- With the stage drawing buffer capped at one pixel per DIP, the median ratio over three pairs was 1.060 (pairs 1.223, 1.037, 1.060). The p95 of the AIRI stages was 1.70 ms in every stage run (gate 4 ms), and the readback mean was 0.054-0.064 ms (gate 1 ms).
- The synchronous `readPixels` alpha hit test hitched to 3.8-5.3 ms maxima in both modes. The readback-max criterion was judged on the median per-pair delta (-0.1 ms). The gate line was `GATE: PASS (DPR 1.0 stage cap; median FPS ratio 1.060; readback max judged on the median per-pair delta, -0.1 ms)`.
- Physics is bimodal across launches: Ammo ran at about 12-15 ms or 17-22 ms per frame with no external load. That regime, not the host mode, dominates single-pair noise.

## Decision

### One stage host per launch, chosen by a mode setting

`apps/stage-tamagotchi/src/main/windows/stage/` builds the desktop stage: one full-screen window over the work area of the home display. The classic window module, `apps/stage-tamagotchi/src/main/windows/main/index.ts`, is unchanged. `selectHostMode` (`apps/stage-tamagotchi/src/main/windows/stage/mode.ts`) picks the host once per launch:

1. In a development build (`import.meta.env.DEV`), `AIRI_STAGE_HOST=window|desktop` overrides everything, for QA runs. A production build ignores it.
2. While the Experimental 3D stage setting (`experimental` in the stage config, default off) is off, the classic window.
3. Linux always gets the classic window, because Wayland has no forwarded click-through.
4. A stage model that is not MMD, or that has never been reported, gets the classic window.
5. Otherwise the saved `mode` in the stage config applies.

The stage config (`apps/stage-tamagotchi/src/main/windows/stage/config.ts`, persisted as `config.json` in the `stage` directory under the user data directory) holds `mode` (`window` or `desktop`, default `window`), `activeRenderer`, `homeDisplayId`, and per-display homes as `xDip` on the floor row plus a display fingerprint. A mode change applies at the next launch through a **Relaunch to apply** button. Transparency and window flags are fixed at window creation, so a live switch is not possible.

Whichever window is built becomes `userFacingMainWindow`. Its consumers ask `isStageWindow` (`apps/stage-tamagotchi/src/main/windows/stage/identity.ts`) and never move, resize, or focus the stage. The window contract (`apps/stage-tamagotchi/src/main/windows/stage/window-contract.ts`) creates a frameless, transparent, always-on-top, non-taskbar window. It is a `panel` on macOS, is shown with `showInactive()`, and starts with `setIgnoreMouseEvents(true, { forward: true })`. Unlike the desktop overlay, it is focusable for the Controls Island and touch, and it has no content protection, so screenshots and OBS see her. `bindStageWindowToHomeDisplay` re-bounds the window when displays change.

### The stage-world contract

`packages/stage-shared/src/stage-world/` is a pure subpath, under the same `eslint.config.ts` import guard as the motion drivers. World units are model units, right-handed with +Y up. x = 0 is the left edge of the work area, y = 0 is the floor, and the character stands on z = 0 with her root at `(homeX, -footBaselineY, 0)`.

`calibrateCamera` builds a zero-pitch perspective camera with an off-axis frustum, so the z = 0 plane maps to the window by a pure scale:

- s = Hm / P: units per DIP from the model height `Hm` and the configured character height `P`, raised when the model would exceed 90 % of the space above the floor.
- D = 5 Hm: the camera distance. The eye height is `0.5 Hm`, the eye x is the centre of the work area, near is `0.1 D`, and far is `2 D`.
- The floor row is the bottom of the work area minus an 8 DIP toe margin (`toeMarginDip` in the stage page), so toes never clip below the work area.

`worldToDip` and `dipToPlane` convert between world points and work-area DIP. `groundLineOf` gives the reachable root x range. `defaultHomeDipX` places the default home beside the chat panel. `homeDipToWorldX` and `worldToHomeDipX` convert homes, which are stored in DIP so they survive a change of character height. The MMD scene builds its camera with `makePerspective` from the calibration and caps the drawing buffer at one pixel per DIP, which is the spike's fallback made permanent.

### Locomotion and rest pose in motion-driver-humanoid, behind the director

Two new pure subpaths of `packages/motion-driver-humanoid` hold the new motion:

- `packages/motion-driver-humanoid/src/locomotion/` (`createLocomotion`) is a deterministic procedural gait on a fixed 120 Hz grid. It integrates the root position, turns in place through `planFootSteps`, keeps planted foot targets as frozen world anchors, and outputs body channels and arm swing. A reach leash and the `skate` measure keep feet planted.
- `packages/motion-driver-humanoid/src/rest-pose/` (`createArmRest`) returns the relaxed arm, hand, and finger rest pose as rest-relative rotations, with breath and locomotion swing. `RestRelativeRotation` is intrinsic YXZ Euler, `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
- `packages/motion-driver-humanoid/src/clip-mask/` (`buildClipBoneMask`) reports which bone groups a clip animates, so a VMD that animates arms, fingers, legs, or the root owns them while it plays. The mask also has a `lowerBody` group (hips and FK leg bones, plus caller-listed D bones) and treats `全ての親` and `master` as root, so an FK-only leg clip or an all-parent move owns the legs.

The boundary with the director is fixed. `decideBody` (`packages/motion-driver-humanoid/src/director/index.ts`) owns the goal, its reason (`approach-chat`, `approach-cursor`, `return-home`, `wander`, `tool`, `debug`, or `stay`), the pace, the home, the roam mode, and the tool refractories. `BodyIntent.locomotion` carries that decision. Locomotion owns position integration, gait phase, step targets, arm swing, and the root yaw, which the MMD body passes to look-at as `facingYaw` with turns disabled while moving. The director never moves the root, and locomotion never chooses a goal. Goals wait while she speaks and expire after `PENDING_GOAL_TTL_MS`. A chase lasts `CHASE_WINDOW_MS` after a poke, pet, drag, or sent message, and the return home follows `RETURN_HOME_DELAY_MS` after the last reason. Wanders run only in roam mode, between `WANDER_MIN_MS` and `WANDER_MAX_MS` apart.

### World-space anchors and the split physics-reset rule

The MMD body (`packages/stage-ui-mmd/src/composables/mmd/body/locomotion.ts`) runs the gait as the `locomotion` pose stage, after `natural` and before `weight-shift`. It converts foot anchors between mesh space and world space, so moving the root no longer slides planted feet. The `arm-rest` pose stage runs after `look-at`. Both follow the clean-snapshot rule of the 2026-10-30 ADR.

The physics-reset rule is split by intent:

- User transform edits in the classic window (scale, position, rotation) reset physics, as before.
- Per-frame root motion from locomotion never resets physics, so hair and skirts feel the travel. The spike's root-translation run showed that physics follows the root without exploding.
- `setRootX(x, { teleport })` on the scene moves the root for host moves. A drag (`teleport: false`) never resets physics. A teleport, such as the return home after a display change, resets it once. Both re-base the gait (`rebase`) and drop the walk goal, so the next gait frame never undoes the move.

### Hit mask: readback authority, rect gate

The stage window is click-through except over her pixels. `apps/stage-tamagotchi/src/renderer/composables/stage-click-through.ts` decides each frame:

- The rect gate: outside her placement rect padded by `stageClickThroughPaddingDip`, the answer is click-through without reading pixels.
- The readback authority: inside the rect, the canvas alpha under the cursor decides. `CanvasRegionAlphaReader` (`packages/stage-ui/src/composables/canvas-alpha.ts`) reads through a WebGL2 pixel-pack buffer and a fence, so the answer arrives one or more frames later without a blocking read. WebGL1 keeps the blocking read.
- `planStageHitRead` limits reads: none while the pointer is captured or outside the rect, one every `stageRestingReadIntervalMs` for a still cursor, at most one every `stageMovingReadIntervalMs` for a moving cursor, and one read in flight. Release is debounced by `stageClickThroughReleaseDebounceMs`.

The real-surface gate passed with this planner: the median per-pair readback-max delta was 0.4 ms (pairs 0.4, 1.3, 0.3; limit 1 ms), the readback mean was 0.065-0.083 ms, the median desktop/window FPS ratio was 1.293, and the p95 of the AIRI stages was 2.3 ms. The margin is thin. Chromium still completes the buffer copy through a synchronous GPU-process round trip that occasionally stalls (8 of 350 copies took over 1 ms in an instrumented run). The gate passes because fewer reads leave fewer chances for a stall.

### Chat anchor

The floating chat attaches to a `ChatAnchor` (`apps/stage-tamagotchi/src/main/windows/chat/anchor.ts`). In the classic window, the anchor is the main window's bounds and the chat is a native child window. On the desktop stage, `createCharacterAnchor` uses her home rectangle (`homeBounds` of the published `StageCharacterPlacement`), never her live rectangle, so a walk or a drag in progress does not drag the chat along. The chat attention target derives from the same anchor. Unfolding the chat reports its window after `show()`, so `approach-chat` starts at once.

### Tools

`createBodyTools` (`packages/stage-ui/src/tools/body.ts`) registers `come_here`, `go_home`, and `look_at` (camera, cursor, chat, or away) with the same pattern as the expression tools. `MMDBodyToolPort` (`packages/stage-ui-mmd/src/composables/mmd/body-tool-port.ts`) turns them into director requests. The movement tools share `MOVE_TOOL_REFRACTORY_MS`, and `look_at` has its own `LOOK_TOOL_REFRACTORY_MS`, so a glance does not block a walk. A refused request returns its reason and when to retry. A `come_here` while the chat is folded is refused with a reason the model can repeat to the user. ACT markers and expression tools never move her.

### Settings, diagnostics, and QA

Settings > Models shows a Desktop stage section for an MMD model: stage mode, home display, character height (`stageCharacterHeight` in the `useMMD` store, default 560 DIP), and roam mode (`roamMode`, stay or roam). The `mmd-motion-diagnostics` snapshot appends `characterPlacement`, `stageModel`, `world`, `locomotion`, and `arms`, and its `director` block gains the locomotion reason, goal, pace, pending goal, and tool refractories. The Motion Lab shows them and draws the floor, ground-line, home, goal, and arm-capsule overlays. `pnpm qa:stage` (`packages/qa-tools/src/stage/`) measures window/desktop pairs and judges `stage-walk-skate`, `stage-arm-penetration`, and `stage-frame-budget`.

### What stays out

Cross-display walking and hand-off, windows as terrain, perching, drag dangle, props, a gesture or dance clip library, a `perform_action` tool, the VRM adapter, a Live2D stage mode, closeness state, and any behaviour that uses depth are out of scope. The Live2D path and the Natural numbers are unchanged, and no Ammo internals are read.

## Consequences

The character can live on the desktop without blocking it: clicks pass through everywhere except her pixels, and the stage never takes focus. The world and camera contract is renderer-neutral, so a VRM adapter can stand on the same floor with the same calibration. Locomotion, rest pose, and clip masks run in Node Vitest with explicit time and seeded randomness.

Every `userFacingMainWindow` consumer must handle the stage: the tray, the single-instance guard, centring, onboarding, and the tray layout actions all check `isStageWindow`. A new consumer that moves, resizes, or focuses the main window must do the same.

Two hosts now coexist. The classic window keeps today's behaviour for Live2D, VRM, Spine, Linux, and any user who prefers it. Both host pages (`apps/stage-tamagotchi/src/renderer/pages/index.vue` and `apps/stage-tamagotchi/src/renderer/pages/stage.vue`) carry the same host-service wiring.

The hit-test readback passes its gate with a thin margin. The frame rate on this Mac is bound by Ammo physics on the renderer thread in both modes, not by the stage window.

## Follow-ups

- Display hand-off: walking from one display to another, and moving the stage window with her. Today she lives on one home display at a time.
- Terrain: windows as surfaces she can stand on or perch on.
- Remove the classic window mode after roaming, chat anchoring, and display hand-off ship and one feedback cycle on the desktop stage has passed. The removal condition is recorded in the `// NOTICE:` block of `apps/stage-tamagotchi/src/main/windows/stage/mode.ts`. The Linux branch keeps its own removal condition.
- Replace the GPU readback with a CPU silhouette mask if `stage-frame-budget` fails its readback-max criterion again. Do not change the threshold.
- Landed: the second wander on arrival. A wander deadline that fell due while another goal was walking stayed due, so the wander fired in the frame the goal ended. `decideBody` now draws a new deadline from the arrival instead.
- Landed: roaming at the default height. At 560 DIP on a 1440 DIP wide work area, three leg lengths of ground fit on neither side of home. When three legs do not fit, the minimum wander distance is now half the longer free side, but never less than one leg length.
- Extract the host-service wiring duplicated by `index.vue` and `stage.vue` (roughly 105 lines) into a shared composable after this plan.
- Make the `qa-tools` pnpm resolver work with a standalone pnpm binary, such as the one mise installs, so `qa:stage measure --pairs` launches without a scratch shim.
- Luke-run checks that agents could not perform on this host: the two-display home switch, real OS clicks through the stage with another app frontmost, an OS-level screen capture, and the Windows re-measure of the spike and gates, including the 125 % and 150 % display scales.
