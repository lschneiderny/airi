# STAGE TAMAGOTCHI KNOWLEDGE BASE

## OVERVIEW
Electron desktop host for Stage, native services, and extension runtimes. Score: 12, distinct process and packaging boundary.

Parent guidance: [root AGENTS.md](../../AGENTS.md). Its task-routing skills also apply here.

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| Dependency graph | `src/main/index.ts` | injeca composition, windows, services, platform flags |
| Host capability snapshot | `src/main/services/electron/host-capabilities.ts` | Main-process host facts, per-window capability delivery, and runtime status updates |
| Linux desktop bridge | `src/main/services/linux-desktop/AGENTS.md` | Backend selection, private bus transport, compositor scripts, session sources and runtime verification |
| Electron integration | `src/main/services/electron/` | Permissions, shortcuts, updater, assets, screens |
| AIRI services | `src/main/services/airi/` | Channel, MCP, plugins, widgets, authentication |
| Native windows | `src/main/windows/` | Managers, geometry, navigation, RPC adapters |
| Renderer startup | `src/renderer/main.ts`, `src/renderer/App.vue` | Leadership and full/minimal runtime |
| Desktop UI | `src/renderer/pages/`, `src/renderer/layouts/` | Local settings layout and window routes |
| IPC contracts | `src/shared/eventa/` | Domain contracts and plugin subdomains |
| Godot process | `src/main/services/airi/godot-stage/` | Sidecar lifecycle, model materialization, loopback transport |
| Extension host | `src/main/services/airi/plugins/host/` | Activation, asset sessions, `directory-import.ts` review/commit |
| MCP and computer use | `src/main/services/airi/mcp-servers/`, `src/main/services/airi/computer-use/` | Server manager; one lazy private daemon with serialized desktop operations |
| Loopback HTTP | `src/main/services/airi/http-server/` | Static asset sessions and the authentication loopback callback |
| IO traces | `src/main/services/airi/io-trace-recording/` | JSONL recording; `register.ts` filters spans by sender window |
| Renderer tool stores | `src/renderer/stores/tools/index.ts` | Built-in, Home Assistant, MCP, plugin, and selection stores |
| Build and install | `electron.vite.config.ts`, `electron-builder.config.ts` | Native dependencies, model assets, sidecar exports |
| Release evidence | `scripts/`, `scripts/update-test/` | Artifact metadata, smoke tools, updater fixtures |

## CONVENTIONS
- Main owns native processes, extension sessions, credentials, and cleanup. Renderers use typed Eventa operations.
- Main supplies `synced-leader=true` or `false` before Pinia initialization.
- `stage-runtime=minimal` omits full Stage startup in lightweight windows.
- Register window RPC before renderer load.
- Get a main-process Eventa context from `src/main/libs/electron/window-context.ts`: `createWindowContext(window)` for one window, `createAppContext()` for a request from any window. A window has one shared context, which the window owns.
- Clean up after a window with `onWindowClosed(window, callback)` from `src/main/libs/electron/on-window-closed.ts`.
- Shared window helpers own navigation protection, persistence, and platform-specific layering.
- Home Assistant transport and secrets stay in main. Renderers receive only token presence and masked previews.
- Extension directory import separates prepare/review from serialized commit.
- Managed extension sessions retain ownership until runtime and asset cleanup finish.
- The desktop build and typecheck are separate scripts.

## COMMANDS
```sh
pnpm -F @proj-airi/stage-tamagotchi dev
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm -F @proj-airi/stage-tamagotchi exec vitest run
pnpm -F @proj-airi/stage-tamagotchi build
pnpm -F @proj-airi/stage-tamagotchi build:unpack
```
`vitest.config.ts` separates node and Chromium browser coverage. Browser setup loads the shipped Cubism core.
The node project runs files serially. `vitest.node.config.ts` defines the same node scope as the standalone `stage-tamagotchi:node` project.
From the repository root, `pnpm test-stage-tamagotchi:run` runs only the browser project. Use `dev:xwayland` to force X11 on Linux.

## HOTSPOTS
These files exceed 500 lines. Read the owning module before editing them: `godot-stage/index.ts`, `plugins/host/index.ts`, `main/windows/widgets/index.ts`, `services/electron/auto-updater.ts`, `renderer/components/InteractiveArea.vue`, and `stage-islands/controls-island/index.vue`.

## ANTI-PATTERNS
- Do not append Chromium `enable-features` switches separately. Chromium replaces the previous value.
- Do not enable Vulkan for native Wayland until Electron supports its surface presentation.
- Do not make Chat directly depend on Settings. Settings reaches Chat through Spotlight.
- Do not expose Home Assistant addresses or tokens to renderer transport.
- Do not execute extensions during directory-import preparation.
- Do not accept symlinks, escaping entrypoints, or changed packages after directory-import review.
- Do not replace the iframe request queue with one latest value. Vue batches prop updates.
- Do not gate VRM transparency sampling on Auto Hide.
- Do not detect Wayland or Linux to answer a capability question; read `useHostCapabilitiesStore` or the main host capability service.
- Do not use uncertain native cursor state to disable Wayland window interaction.
- Do not remove main-owned shortcuts during renderer shortcut resets.
- Floating chat uses the default pin level to preserve input-method candidate visibility.
- `UPDATE_SERVER_URL` is development-only. It must not control production update routing.
- Do not call the Eventa main adapter's `createContext`, `ipcMain.on`, `window.on('closed')`, or `setMaxListeners` in `src/main`. See the [IPC and window listener ADR](../../docs/ai/adr/2026-11-10-electron-main-ipc-listeners.md).
