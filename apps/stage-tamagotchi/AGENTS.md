# STAGE TAMAGOTCHI KNOWLEDGE BASE

## CONVENTIONS
- Main owns native processes, extension sessions, credentials, and cleanup. Renderers use typed Eventa operations.
- Main supplies `synced-leader=true` or `false` before Pinia initialization.
- `stage-runtime=minimal` omits full Stage startup in lightweight windows.
- Register window RPC before renderer load.
- Get a main-process Eventa context from `src/main/libs/electron/window-context.ts`: `createWindowContext(window)` for one window, `createAppContext()` for a request from any window. A window has one shared context, which the window owns.
- Clean up after a window with `onWindowClosed(window, callback)` from `src/main/libs/electron/on-window-closed.ts`.
- Shared window helpers own navigation protection, persistence, and platform-specific layering.
- Home Assistant transport and secrets stay in main. Renderers receive only token presence and masked previews, never addresses or tokens.
- Extension directory import separates prepare/review from serialized commit.
- Managed extension sessions retain ownership until runtime and asset cleanup finish.

## COMMANDS
The root config runs the node tests as the `stage-tamagotchi:node` project, one file at a time.
From the repository root, `pnpm exec vitest run --config vitest.browser.config.ts --project stage-tamagotchi:browser` runs only the browser project. Use `dev:xwayland` to force X11 on Linux.

## ANTI-PATTERNS
- Do not append Chromium `enable-features` switches separately. Chromium replaces the previous value.
- Do not enable Vulkan for native Wayland until Electron supports its surface presentation.
- Do not make Chat directly depend on Settings. Settings reaches Chat through Spotlight.
- Do not execute extensions during directory-import preparation.
- Do not accept symlinks, escaping entrypoints, or changed packages after directory-import review.
- Do not replace the iframe request queue with one latest value. Vue batches prop updates.
- Do not gate VRM transparency sampling on Auto Hide.
- Do not detect Wayland or Linux to answer a capability question; read `useHostCapabilitiesStore` or the main host capability service.
- Do not use uncertain native cursor state to disable Wayland window interaction.
- Do not move the desktop stage window from the renderer or with `setBounds`. Only `bindStageWindowToDisplay` moves it, and the stage page changes its camera only on a `stageDisplayId` that main confirmed. See the [display hand-off ADR](../../docs/ai/adr/2026-11-10-display-hand-off.md).
- Do not remove main-owned shortcuts during renderer shortcut resets.
- Floating chat uses the default pin level to preserve input-method candidate visibility.
- `UPDATE_SERVER_URL` is development-only. It must not control production update routing.
- Do not read `percentCPUUsage` from `app.getAppMetrics()`; other callers share its interval. The perf recorder diffs `cumulativeCPUUsage`.
- Do not call the Eventa main adapter's `createContext`, `ipcMain.on`, `window.on('closed')`, or `setMaxListeners` in `src/main`. See the [IPC and window listener ADR](../../docs/ai/adr/2026-11-10-electron-main-ipc-listeners.md).
