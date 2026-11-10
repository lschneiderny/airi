# Display hand-off for the desktop stage

Date: 2026-11-10
Status: accepted. Unit tests cover the decisions, and a crossing passed its gate in a headless KWin session with two outputs. No crossing has been run on physical displays yet; see Verification.

## Context

[The full-screen stage ADR](2026-10-31-fullscreen-stage-and-locomotion.md) put an MMD character on the work area of one home display and left display hand-off as a follow-up. She could not leave that display: the stage window covered one work area, world x = 0 was its left edge, and every goal of the director clamped to its ground line.

The goal is that she walks from one display to another and is seen on each. The constraints are the ones the stage already has. Root motion from locomotion never teleports and never resets physics. The stage window is click-through except over her pixels. A user with one display must see no change.

Two shapes were considered. One window per display draws her on both sides of a seam, but it doubles the transparent surfaces that the stage spike measured as the main compositing cost, and it needs two scenes or a shared context. One window that moves between displays keeps one scene and one surface, and it cannot draw her on two displays at once. This ADR takes the second shape and hides the moment the window moves.

## Decision

### One row of displays with wings

`layoutStageRow` (`packages/stage-shared/src/stage-world/row.ts`) lays every display out left to right on one world x axis. The order is the centre x of the work area, then the centre y. Each display gets a slot: its own `CameraCalibration` with an `originX` (the world x of its left edge), its ground line, and its `visible` range, which is the root x range in which that display draws some of her.

Neighbours are separated by a wing that no display shows. A wing is both neighbours' half widths plus an unseen stretch of `0.3 * modelHeight`, about 0.6 leg lengths. She walks off one display's edge, crosses the unseen stretch in under a second at a walk, and walks in from the next display's edge. The wing is the same for displays that touch, displays with a gap between them, and stacked displays: the arrangement decides only the order. A full-screen app on the destination display gets no special case.

The first slot's origin is 0, so a row of one is the calibration a single display always had.

Root motion is continuous across a crossing. Nothing teleports, the gait is not re-based, and physics is not reset. Only the camera and the window change.

### The stage display, apart from the home display

The home display stays what it was: the persisted display she lives on. The main process now also tracks the stage display, the display the stage window is confirmed to cover (`bindStageWindowToDisplay`, `apps/stage-tamagotchi/src/main/windows/stage/displays.ts`). It is runtime state, never persisted, and `StageHostState.stageDisplayId` reports it. It is the home display at launch.

`electronStageMoveToDisplay` moves the window. Main places it on the other work area and waits until the window's rectangle is read back there, within 1 DIP. It then re-applies `setIgnoreMouseEvents(true, { forward: true })` and returns the state with the new `stageDisplayId`. After 1.5 s without that rectangle, main places the window on the display it came from and returns the old `stageDisplayId`.

How strong the confirmation is depends on the host. On KWin in a native Wayland session, the compositor reports the rectangle after the KWin placement actuator ran, so it is a real confirmation. Elsewhere it is the bounds Electron reports after `setBounds`. X11 applies a move asynchronously, so there the confirmation can precede the move.

The camera changes only on a confirmed state. A late move makes her appear late. It never draws her in the wrong place.

### The page follows her root

`useStageHandOff` (`apps/stage-tamagotchi/src/renderer/composables/use-stage-hand-off.ts`) runs once per animation frame on the stage page. It asks `stageDisplayFor(row, currentId, rootX, heading)` which display the window should cover and invokes the move when the answer changes. The answer stays the current display while that display shows any of her, so the window never leaves while she is seen.

While no display shows her, the page forces click-through. While a move is in flight, it also hides the canvas, because the window may be between two displays and she may turn round. After a confirmed move the page resets its click-through state to match the window.

### Which goals cross

The director input has an optional `reach`: every display's ground line. Goals with a destination clamp to the nearest zone, so they can cross: the cursor chase, the chat approach, the `come_here` and `go_home` tools, the return home, and the debug goal. A wander stays on the ground line she stands on, and a drag clamps to the display the window covers. Without `reach`, every decision is unchanged.

Two rules cover the wing. A clip that stops her (an action or a dance) is refused as `busy` while her root is outside every zone, because it would play unseen. A root at rest outside every zone gets an `enter-stage` goal to the nearest zone.

With a row, the MMD scene places the cursor and the chat by their screen positions (`rowInputs`, `packages/stage-ui-mmd/src/composables/mmd/stage-world.ts`), so a cursor on another display is on the stage and chases her there.

### Home

`homeX` is her home on the home display, in that display's slot. The chat anchor's `homeBounds` are computed in the home display's frame (`placementRectAt`), so the chat stays where she lives while she is on another display.

A drag release on a display she walked to makes that display the home display through `electronStageRehome`, which changes the home display and leaves the window where it is. The Home display control in Settings keeps moving the window at once, as before.

### Follow me

Follow me is an optional way to choose the home display, off by default (`followMe` in the stage config, the Follow me control under Settings > Models > Desktop stage). While it is on and hand-off is on, the stage page tracks the display the cursor is on. When the cursor has stayed on a display other than the home display for 30 s, that display becomes the home display through `electronStageRehome`. Nothing moves at that moment: the director's return home, `RETURN_HOME_DELAY_MS` after her last reason to be elsewhere, strolls her over, and the window follows her. The chat anchor moves with the home display at once, because it attaches to where she lives.

### When hand-off is on

Hand-off is on only while the row has more than one display and the host reports both `windowOrigin` and `cursorScreenPoint` as live. Otherwise the page passes no row to the scene: she stays on the display the window covers, and her home is on that display.

### Failures

A teleport to her home on the display the window covers, with one physics reset, happens in three cases:

- The row is laid out again: a display was added, removed, or changed, or the model height or the character height changed.
- Main placed the window on another display by itself. Every display change brings the window to the home display, and the Home display control moves it.
- Hand-off turns off while no display shows her. A move that was not confirmed turns hand-off off for 10 s.

On `powerMonitor` `resume`, main places the window on the stage display again when its rectangle differs.

## Changes to the approved design

- `stageDisplayFor` takes a fourth argument, the sign of her last movement. In the unseen stretch she is fully off both neighbours, so with the root alone each neighbour would hand her to the other, and the window would move back and forth until she left the wing.
- The row always holds every display. The approved design shrank it to the stage display while hand-off was off. Slot origins would then shift whenever a capability changed and at the end of each 10 s hold, and each shift would cost a teleport. With a stable row, turning hand-off off only withholds `reach`.
- The canvas is hidden while a move is in flight. Without it, a root that turns round during a move could be drawn by the old camera on a window that already sits on the new display.
- The unseen stretch is a share of the model height, not of the leg length. The page lays the row out and knows the model height; the leg length belongs to the scene's rig.
- A wing rule goal has its own reason, `enter-stage`, so the diagnostics do not report it as a return home.

## Consequences

A user with one display has a row of one: no `reach`, no move, and the single-display calibration. Two edge cases differ. The home teleport is keyed to the row, which includes the display id and the work area origin, so a display that reconnects under a new id with the same size, or a work area that moves without changing size, now teleports her home once.

A user with several displays sees one change that is not a crossing: plugging in or removing any display teleports her home, because the row is laid out again.

The stage drawing buffer follows the display. With a render scale below 1, the scene now re-applies the pixel ratio when the device pixel ratio changes.

Gestures can reach past the half width the wing assumes, so a wide arm pose is cut at the display edge during a crossing.

## Not built

- Windows-specific handling. Moving a window between displays with different scale factors can need a second `setBounds`, because the first one is converted with the source display's scale, and a `WM_DPICHANGED` resize can follow. The 1 DIP tolerance of the confirmation may be too tight there. None of this is handled or tested.
- Cross-display drag, straddling a seam, and one window per display.

## Verification

Unit tests cover the row layout, `stageDisplayFor`, the director's reach zones and wing rules, the main-process move (confirmed, timed out, display removed on the way, unknown display), the page's hand-off state, and the Follow me wait.

A crossing ran live on 2026-11-10 in the headless QA display: KWin 6.8.2, native Wayland, two outputs of 1600x900 side by side (`pnpm qa:display run --outputs 2 -- pnpm qa:stage handoff`, see `packages/qa-tools/README.md`, Stage gates). She walked 80 model units to the second output and back.

- `stage-handoff` passed: the camera origin went 0 -> 71.76 -> 0, she reached both goals, her rectangle was inside the window at the end, and the largest root step between two 100 ms samples was 0.98 model units, so nothing teleported her.
- `stage-walk-skate` passed over the same walk: the largest `locomotion.skate` was 0.00055 and the largest `feet.maxError` 0.0021 model units, against limits of 0.05. Foot contact holds across the change of camera.
- The window arrived in time. Each way, the new camera origin appeared in the diagnostics sample that followed the one in which she left the display, 100 to 200 ms later, and she entered the next display's visible range 500 to 600 ms after that.

This run confirms the move on the KWin placement actuator path. It does not cover physical displays, displays of different sizes or scale factors, X11, macOS, or Windows. It also does not cover a real pointer: the scenario uses the debug walk goal, so the cursor chase across displays, click-through after a crossing, Follow me, and the chat approach to another display were not run live. Those are the owner's two-display checks on KDE Wayland, KDE X11, and macOS.

## Follow-ups

- Run the two-display check on KDE Wayland, KDE X11, and macOS with physical displays, and record the result here.
- Measure the move time on each host. If a move regularly outlasts the unseen stretch, widen `STAGE_ROW_OFFSTAGE_MODEL_HEIGHTS`.
- Windows: the mixed-scale `setBounds` behaviour above.
- Extend the `stage-handoff` scenario to outputs of different sizes and to a pointer-driven chase.
