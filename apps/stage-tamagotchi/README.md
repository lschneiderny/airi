# Stage Tamagotchi

The Electron desktop app runs AIRI characters, chat, voice, and desktop tools.
Shared character behavior belongs in `packages/stage-ui`. Use `stage-web` for browser-only features.

## Development

From the repository root, run `pnpm install`, then `pnpm dev:tamagotchi`.
Run `pnpm -F @proj-airi/stage-tamagotchi build` to build the app.

## Local model files

Sherpaw downloads remote model files into the app user data directory. The main
process serves installed files to the renderer through `airi-model`. The desktop
release bundles X-ASR through `airi-sherpaw`. Sherpaw settings control
remote downloads. The Resource Status Island shows transfer progress and errors.

## Foreground window sensor

Situational presence runs in the Electron desktop app on Windows and macOS. The foreground sample tells the character which app is in front, so her situation block can name it and the opportunity gate can stay quiet during calls, games, presentations, and full-screen apps.

- The main process service `createForegroundWindowService` answers the Eventa invoke `electron.foregroundWindow.sample`. On Windows it reads the foreground window and maps the shell notification state to the sample's host-neutral `busy` field. On macOS it reads the front app from `NSWorkspace`, checks CoreGraphics window geometry for full-screen coverage, and reads the focused window title through the Accessibility API.
- On macOS, window-title reading requires the launching app to have Accessibility permission. The sampler checks `AXIsProcessTrusted` and never requests permission. Without trust, the app name and category still reach the model, but the title is empty. A user who already granted Accessibility to the launching app for push-to-talk can also use that permission for window-title reading. No new consent screen appears.
- Full-screen detection on macOS uses window geometry. On a notched display, native full screen may stop below the camera band, so the geometry check can miss it and the sample may report `accepts`. This limitation applies regardless of Accessibility trust; no Accessibility-based full-screen fallback is implemented.
- macOS does not provide this app with Focus or Do Not Disturb status, so the sensor does not detect either. It does not infer call or microphone activity from microphone use.
- koffi loads lazily on the first sample and is imported only under `src/main`. `electron.vite.config.ts` externalizes it, and electron-builder unpacks its `.node` binary from ASAR.
- The sample marks AIRI's own windows with `ownProcess: true` by process id, including the Godot stage sidecar. Focusing the sidecar was not exercised live on macOS. The service never logs titles.
- On hosts without a sampler, or when koffi fails to load, the invoke returns `null`. The situation then has no foreground app, and the gate holds with `stale-signal`. Web, Pocket and Kirie exclude presence.
- The renderer producer `useForegroundWindowProducerStore` polls once per second, also while the stage is hidden or minimized. `pages/index.vue` runs it in the main window only, and only while **Share the foreground app and window titles** is on. Turning that setting off stops the poll and clears the last sample.
- `App.vue` declares the `unprompted` host capability and reports stage visibility to the situation store.
- macOS sampling was tested on one arm64 Mac without a notch. A frozen front app costs about a quarter-second main-thread stall every 10 seconds. Memory stayed under 20 MiB in a 33-minute run at 1 Hz, but accelerated cold runs exceeded that per batch and no multi-hour run was done. [macOS foreground sensor](../../docs/ai/adr/2026-10-25-macos-foreground-sensor.md) records the measurements and untested cases.

Window titles reach the chat model, including cloud providers. Add password managers and other sensitive apps to the title denylist in **Settings > Presence**; their app name and category still reach the model.
To send no app or title at all, turn off **Share the foreground app and window titles** in **Settings > Presence**. The character then stops speaking up on her own, because the gate holds with `stale-signal`. She still answers when you talk to her.
The AIRI web extension sends page and video titles, links, and subtitles on its own. That switch does not cover it. To keep them from the model, turn off **Share browser activity** in **Settings > Presence**.
Use this sensor for awareness of the user's foreground app. Do not use it to capture screen content, and do not call koffi from the renderer.

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
