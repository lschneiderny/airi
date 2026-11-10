# Stage Tamagotchi

The Electron desktop app runs AIRI characters, chat, voice, and desktop tools.
Shared character behavior belongs in `packages/stage-ui`. Use `stage-web` for browser-only features.

## Development

From the repository root, run `pnpm install`, then `pnpm dev:tamagotchi`.
Run `pnpm -F @proj-airi/stage-tamagotchi build` to build the app.

### Linux desktop file

On Linux, the XDG portals identify AIRI by its desktop file `ai.moeru.airi.desktop`, whose basename is the app id `ai.moeru.airi`. The deb and rpm packages install it in `/usr/share/applications`, because `desktopName` in `package.json` and `linux.syncDesktopName` in `electron-builder.config.ts` name it. The main process calls `app.setDesktopName('ai.moeru.airi.desktop')` at startup.

A development build has no installed desktop file. On Linux, it writes `${XDG_DATA_HOME:-~/.local/share}/applications/ai.moeru.airi.desktop` at startup when that file is absent, and logs `Installed the development desktop entry <path>`. The entry runs the current Electron binary with the app path and is hidden from application menus. An existing file is never replaced, so delete it after you move the checkout. Automated QA must set `XDG_DATA_HOME` to a private directory, such as the `<session dir>/data` of `pnpm qa:display`, so that a test run never writes to your data home.

Push-to-talk and other key-up shortcuts use the GlobalShortcuts portal on Wayland and XWayland (`src/main/services/electron/global-shortcut.ts`). Native X11 uses the uiohook driver and falls back to the portal when uiohook fails to load or start.

## Local model files

Sherpaw downloads remote model files into the app user data directory. The main
process serves installed files to the renderer through `airi-model`. The desktop
release bundles X-ASR through `airi-sherpaw`. Sherpaw settings control
remote downloads. The Resource Status Island shows transfer progress and errors.

## Desktop stage window

An MMD character can live on a full-screen desktop stage instead of the classic 450x600 window. `src/main/windows/stage/` builds that host: one frameless, transparent, always-on-top window over the work area of the home display. With more than one display, the window follows her when she walks to another one (see [Display hand-off](#display-hand-off)). It stays out of the taskbar, is shown with `showInactive()` so it never takes focus, and starts click-through (`setIgnoreMouseEvents(true, { forward: true })`). The stage page (`src/renderer/pages/stage.vue`, route `#/stage`) captures the mouse only over her pixels. Outside her padded placement rect, the answer is click-through without a read. Inside it, an asynchronous canvas alpha read decides, at most once per read interval (`src/renderer/composables/stage-click-through.ts`). The classic window (`src/main/windows/main/`) is unchanged.

`selectHostMode` (`src/main/windows/stage/mode.ts`) picks the host once per launch:

1. In a development build (`import.meta.env.DEV`, for example `pnpm dev:tamagotchi`), `AIRI_STAGE_HOST=window` or `AIRI_STAGE_HOST=desktop` overrides everything. Use it for QA runs, for example `pnpm qa:stage measure`. A production build ignores it and obeys the setting.
2. While the **Experimental 3D stage** setting is off (the default), the classic window. A Live2D user who never turns it on keeps the classic window and its input.
3. On Linux, the tested KWin Wayland and XWayland sessions and the tested EWMH X11 session are eligible for the desktop stage with Electron 43.7.6 or later. Isolated clean-start stage smokes passed in those sessions. The X11 host reported emulated click-through, and its Xvfb stage smoke needed SwiftShader because the virtual display has no GPU. Raw X11 and XWayland pointerdown and five-second rest-timing receipts were not retained, so those routing checks remain pending F3. Sway, Hyprland, GNOME and unsupported desktops use the classic window. The headless sway run verified geometry but could not verify foreground or idle. Hyprland has not had a live run. Linux has no forwarded click-through, so the stage page captures the pointer only while the desktop bridge emulates it (`clickThroughForward` is `degraded(linux-click-through-emulated)`), and lets every click through otherwise. Main offers once to relaunch into the classic window (`src/main/windows/stage/click-through-fallback.ts`) when the desktop bridge fails, when emulation is revoked, or when emulation is still not usable 15 seconds after the pointer first moves; an untouched pointer gets no offer.
4. A stage model that is not MMD, or that has never been reported, gets the classic window.
5. Otherwise the saved stage mode applies.

`bindStageWindowToDisplay` (`src/main/windows/stage/displays.ts`) keeps the window on the work area of the stage display. The stage display is the display the window is confirmed to cover. It is runtime state, never persisted, and `StageHostState.stageDisplayId` reports it. It is the home display at launch and after every display change (`display-added`, `display-removed`, `display-metrics-changed`), so a display change always brings the window home. `electronStageMoveToDisplay` moves the window to another connected display without changing the home display: main places the window, waits until its rectangle is read back on the new work area, and re-applies click-through. After 1.5 s without that rectangle (`stageMoveTimeoutMs`) main places the window on the display it came from, and the returned state keeps the old `stageDisplayId`. On `powerMonitor` `resume`, main places the window on the stage display again when its rectangle differs.

### Display hand-off

She can walk from one display to another, and the one stage window follows her. [The display hand-off ADR](../../docs/ai/adr/2026-11-10-display-hand-off.md) records the design. No crossing has been run on two real displays yet; that check is listed there.

- The stage page (`src/renderer/pages/stage.vue`) lays every display out on one world x axis with `layoutStageRow` from `@proj-airi/stage-shared/stage-world`. Neighbours are separated by a wing that no display shows. Her camera is the slot of the stage display, and her home is on the home display's slot.
- `useStageHandOff` (`src/renderer/composables/use-stage-hand-off.ts`) runs each frame. Once she has walked fully off the stage display, it invokes `electronStageMoveToDisplay` for the display she is heading to. The camera changes only when main confirmed the move, so her root, gait, and physics continue across the crossing. The pure decisions are in `src/renderer/composables/stage-hand-off.ts`.
- While no display shows her, the page lets every click through, and while the window moves it also hides the canvas.
- Hand-off is on only while there is more than one display and the host reports both `windowOrigin` and `cursorScreenPoint` as live. Otherwise she stays on the display the window covers.
- The cursor chase, the chat approach, `come_here`, `go_home`, the return home, and the Motion Lab's walk goal can cross. A wander and a drag stay on the display she is on.
- A move that main could not confirm turns hand-off off for 10 s (`stageHandOffHoldMs`) and teleports her to her home on the display the window covers. The same teleport happens when the displays change and when main places the window by itself.
- A drag release on a display she walked to makes it the home display through `electronStageRehome`, which leaves the window where it is.

The setting gates only this host: the transparent full-screen window, click-through, drag, locomotion, home persistence, and floating-chat anchoring. MMD clips, curation, and the MMD body work in the classic window whether it is on or off.

Whichever window is built becomes `userFacingMainWindow`. The desktop stage must never be moved, resized, or focused, so every consumer checks `isStageWindow` (`src/main/windows/stage/identity.ts`):

| Consumer | Classic window | Desktop stage |
| --- | --- | --- |
| Single-instance guard (`src/main/app/single-instance.ts`) | Restores, shows, and focuses it. | `showUserFacingWindow` shows it inactive. |
| Tray Show, click, and double-click (`src/main/tray/index.ts`) | Restores, shows, and focuses it. | `showUserFacingWindow` shows it inactive. |
| Tray Adjust sizes and Align to (`src/main/tray/window-layout.ts`) | Resizes and moves it. | The items are hidden, and both actions return early. |
| `electronCenterMainWindow` (main and settings window invokes) | Centres it on its display. | `centerUserFacingWindow` returns its bounds without moving it. |
| Onboarding guard (`src/main/services/airi/onboarding/index.ts`) | Slides it beside the onboarding window. | Leaves it in place; it already covers the work area. |
| Floating chat (`src/main/windows/chat/anchor.ts`) | Attaches to its bounds as a native child window. | Attaches to her home rect on the home display (`createCharacterAnchor`), never to her live rect, also while she is on another display. |

The architecture and the removal condition for the classic window mode are recorded in [the full-screen stage ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).

## Desktop stage settings

**Settings > Models** shows a **Desktop stage** section for an MMD model. It edits the stage config (`stage/config.json` under the user data directory) through the stage eventa contracts, which `setupWindowStageInvokes` registers on the settings window as well as on the classic window. Every config change is broadcast as `electronStageStateChanged` to each registered window (`createStageStateBroadcast`), because one window's eventa context emits only to its own renderer.

- **Experimental 3D stage** (`experimental` in the stage config, off by default) is the first control. While it is off, the section shows only this toggle, and `selectHostMode` builds the classic window. It is saved through `electronStageSetExperimental` and applies at the next launch; turning it off while the desktop stage runs shows **Relaunch to apply**.
- **Stage mode** is saved at once but applies at the next launch. When the saved mode differs from the running host, a **Relaunch to apply** button appears. An unsent chat draft is not carried across the relaunch: drafts live in memory (`windows/chat/index.ts`), and the button's description says so. This is the supported policy, not a gap to close.
- **Home display** calls `electronStageSetHomeDisplay`, which writes `homeDisplayId`, keeps every saved home x, and re-bounds the desktop stage window to the new display's work area at once, wherever she is; the stage page then teleports her to her home there. On a host with one display the control is disabled.
- **Follow me** (`followMe` in the stage config, off by default) is saved through `electronStageSetFollowMe` and applies at once. While it is on and hand-off is on, the stage page watches which display the cursor is on (`followCursor` in `src/renderer/composables/stage-hand-off.ts`). After 30 s on a display that is not the home display, the page makes it the home display through `electronStageRehome`. The window stays, her return home walks her there, and the window follows her. On a host with one display the control is disabled.
- **Character height** and **Roam** write the MMD store (`settings/mmd/stage-character-height`, `settings/mmd/roam-mode`); the stage page re-calibrates from them.
- Scale, position and rotation under the scene controls apply in the classic window only; the section says so.
- Only an MMD model can stand on the desktop stage. The stage pages record the stage model's renderer in the stage config (`activeRenderer`). When it is not MMD while the saved mode is `desktop`, the settings page writes the mode back to `window` and shows "Desktop stage supports MMD models; the classic window is used". `selectHostMode` enforces the same rule at launch. A running desktop stage is never torn down: when its page reports a renderer that is not MMD, the stage stays until the next launch, and the main process shows a native notice that offers **Relaunch into the classic window** (`src/main/windows/stage/leave-mmd-notice.ts`).
- The desktop stage page shows the Controls Island only. The hearing and resource status islands stay hidden there: the stage is a transparent, click-through window over the whole work area, so each island would need its own rect gate to keep desktop clicks working, and the same information is reachable from the Controls Island and the settings window. Revisit this if a desktop-stage user cannot tell that the microphone is live.

## Foreground window sensor

Situational presence runs in the Electron desktop app on Windows, macOS, and the Linux desktop-bridge backends whose foreground signal is live. The character reaches out a few times a day for her own reasons, with long quiet stretches between messages. She stays quiet during calls, games, presentations, and full-screen apps. Eligible long sessions, returns, and notifications can also prompt a turn; app switches alone cannot.

- The main process service `createForegroundWindowService` answers the Eventa invoke `electron.foregroundWindow.sample`. On Windows it reads the foreground window and maps the shell notification state to the sample's host-neutral `busy` field. On macOS it reads the front app from `NSWorkspace`, checks CoreGraphics window geometry for full-screen coverage, and reads the focused window title through the Accessibility API.
- On Linux it reads the active window that the desktop bridge (`src/main/services/linux-desktop/`) last pushed: the caption, the pid, and the executable from `/proc/<pid>/exe`, falling back to the window's resource class when that link is unreadable. It never reads `/proc/<pid>/cmdline` or `environ`. A full-screen window reports `fullscreen`, then the session's busy hint reports `busy` or `quiet`, and anything else reports `accepts`. The KWin backend samples today; X11 EWMH, sway, and Hyprland sample once their backends register. GNOME and unrecognized desktops have no sampler. The signal stays unavailable (`linux-foreground-verifying`) until an AIRI window's focus event is matched by an AIRI pid in the bridge's active-window report within 1 s, and three consecutive unmatched focus events revoke it again.
- On macOS, window-title reading requires the launching app to have Accessibility permission. The sampler checks `AXIsProcessTrusted` and never requests permission. Without trust, the app name and category still reach the model, but the title is empty. A user who already granted Accessibility to the launching app for push-to-talk can also use that permission for window-title reading. No new consent screen appears.
- Full-screen detection on macOS uses window geometry. On a notched display, native full screen may stop below the camera band, so the geometry check can miss it and the sample may report `accepts`. This limitation applies regardless of Accessibility trust; no Accessibility-based full-screen fallback is implemented.
- macOS does not provide this app with Focus or Do Not Disturb status, so the sensor does not detect either. It does not infer call or microphone activity from microphone use.
- koffi loads lazily on the first sample and is imported only under `src/main`. `electron.vite.config.ts` externalizes it, and electron-builder unpacks its `.node` binary from ASAR.
- The sample marks AIRI's own windows with `ownProcess: true` by process id, including the Godot stage sidecar. Focusing the sidecar was not exercised live on macOS. The service never logs titles.
- On hosts without a sampler, while the Linux signal is unverified, or when koffi fails to load, the invoke returns `null`. The situation then has no foreground app, and the gate holds with `stale-signal`. Web and Pocket exclude presence.
- The renderer producer `useForegroundWindowProducerStore` polls once per second, also while the stage is hidden or minimized. `useStageHostWiring` (`src/renderer/composables/use-stage-host-wiring.ts`) runs it only in the window that hosts the character (`pages/index.vue` or `pages/stage.vue`), and only while **Share the foreground app and window titles** is on. Turning that setting off stops the poll and clears the last sample.
- `App.vue` declares the `unprompted` host capability and reports stage visibility to the situation store.
- macOS sampling was tested on one arm64 Mac without a notch. A frozen front app costs about a quarter-second main-thread stall every 10 seconds. Memory stayed under 20 MiB in a 33-minute run at 1 Hz, but accelerated cold runs exceeded that per batch and no multi-hour run was done. [macOS foreground sensor](../../docs/ai/adr/2026-10-25-macos-foreground-sensor.md) records the measurements and untested cases.

Window titles reach the chat model, including cloud providers. Add password managers and other sensitive apps to the title denylist in **Settings > Presence**; their app name and category still reach the model.
To send no app or title at all, turn off **Share the foreground app and window titles** in **Settings > Presence**. The character then stops speaking up on her own, because the gate holds with `stale-signal`. She still answers when you talk to her.
The AIRI web extension sends page and video titles, links, and subtitles on its own. That switch does not cover it. To keep them from the model, turn off **Share browser activity** in **Settings > Presence**.
Use this sensor for awareness of the user's foreground app. Do not use it to capture screen content, and do not call koffi from the renderer.

## Window-rect sensor spike

`src/main/services/electron/window-rects-spike.ts` measures what reading the other windows' rectangles costs before the M4 sensor is designed. It runs only on Windows with `AIRI_WINDOW_SENSOR_SPIKE=1`; `AIRI_WINDOW_SENSOR_SPIKE_MODE=main|async|worker` picks its default strategy, and `packages/qa-tools/src/window-rects/measure.ts` drives it. The 2026-11-04 results are in `window-rects-spike.md` beside it: a 4 Hz worker poll takes about 0.75 ms per sample, under 0.5% of one core, and leaves the main thread unaffected.

## Computer use

The desktop chat composer starts with **Use computer** on. Turn it off to send a request without desktop access.
The selection is local to the composer. A new composer starts with it on. While a request runs, its selection is locked.
Turn it off before sending messages that must not receive computer-use tools.

Only the current selection grants access, including retries and tool reruns. Historical messages do not grant access.
The selected request receives `computer_use` and `computer_use_read_image`.
The first tool accepts AUV arguments, such as `["invoke", "window.list"]`.
Use `["invoke", "--help"]` and command-specific help to discover supported operations.
The image tool returns a screenshot as model image content. It accepts only PNG and JPEG artifacts inside the app's computer-use store.
Use a model and provider that support tool calls for visual tasks.
With **Use the vision model for tool images** on, the vision model reads the screenshot first for a chat model whose provider does not report image input.
The chat model then gets a text description. It has the visible text and layout, but no pixel positions.
Use AUV commands such as `screen.findText` to get coordinates.

Electron starts the matching AUV SDK and CLI 0.0.16 on demand, over a private Unix socket or Windows named pipe.
It serializes commands across windows, stores artifacts under the app's user-data directory, and stops the daemon during app shutdown.
The CLI runs without a shell. Model arguments cannot change the device, endpoint, run, or storage root.
Nonzero exits retain AUV output and failure details as tool errors. A zero exit code does not prove that the intended UI change occurred.

On macOS, grant Accessibility and Screen Recording permissions to the launching app when the OS requests them.
Some application actions also need Automation permission. If `app.probePermissions` reports missing screen-recording permission, a capture can contain only the desktop background despite exit code zero. Available commands depend on the OS and AUV backend.
Use this feature for local native applications. It does not expose a remote-device gateway or replace the separate `services/computer-use-mcp` service.

The desktop package includes the platform CLI as an optional dependency and unpacks its executable from ASAR.
Do not omit optional dependencies when building an installer. Windows ARM64 and Linux musl do not have a matching CLI in this version.

## Packaging

The installer bundles the Godot stage sidecar from `engines/stage-tamagotchi-godot/out/<win|mac|linux>` as `resources/godot-stage`. Exporting it needs the Godot editor version that the root `global.json` pins as `Godot.NET.Sdk`, with export templates, and the .NET 10 SDK (see the engine README, "Exporting").

`electron-builder.config.ts` checks that output in `beforePack`. By default a missing or empty directory logs a warning and the package is built without the sidecar, so the Godot renderer cannot start. Set `AIRI_REQUIRE_GODOT_STAGE=true` to fail packaging instead; the release workflows do.

Windows installers are x64 only (`--windows --x64`), so only `@koromix/koffi-win32-x64` is bundled.

## Verification

Run the focused runtime tests:

```sh
pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/main/services/airi/computer-use/runtime.test.ts
```

Set `AIRI_COMPUTER_USE_LIVE=1` to include the bundled CLI/private-daemon test.
It invokes help and an invalid argument, without injecting desktop input.
For renderer verification, launch with `APP_REMOTE_DEBUG=true` and an unused `APP_REMOTE_DEBUG_PORT`, then attach `agent-browser` to the chat CDP target.
