# Electron main process IPC and window listeners

Date: 2026-11-10
Status: accepted

## Context

The Electron main process raised Node's listener limit in 17 places:
16 `ipcMain.setMaxListeners(...)` calls, most with a TODO comment, and one
`window.setMaxListeners(32)` in `setupBaseWindowElectronInvokes`. The limit
was not the problem. Listeners piled up for three reasons.

- The `@moeru/eventa` 1.0.2 main adapter keeps all state in the closure of one
  `createContext` call. Each context adds its own `eventa-message` and
  `eventa-error` listener to the shared `ipcMain` and, with `onlySameWindow`,
  its own `closed` listener to the window. It has no dispatcher and no
  namespace.
- Window setup, the app version service, the OpenCode Go binding, screen
  capture, the Sherpaw model status push, and the IO trace viewer each created
  a context for the same window.
- Each window service registered its own `window.once('closed', ...)`.

A clean start measured on 2026-11-10, with the main, beat sync, and inlay
windows open, had 17 `eventa-message` listeners on `ipcMain` and 25 `closed`
listeners on the main window (27 on the desktop stage window).

The library stays at 1.0.2 and is not patched. The fix is in the application.

## Decisions

### One Eventa context per window

`createWindowContext(window)` in
`apps/stage-tamagotchi/src/main/libs/electron/window-context.ts` returns the
same context for the same `BrowserWindow`. The first call creates it with
`onlySameWindow: true`; a `WeakMap` holds it until the window closes.

The window owns its context. The adapter disposes it when the window closes,
and the function does not return `dispose`, so no service can end the context
of its siblings. A service that stops before its window closes removes only
its own handlers with the functions that `defineInvokeHandler` and
`context.on` return. The OpenCode Go binding does this on application
shutdown.

Every main-process module that needs the context of a window calls
`createWindowContext`. No other module under `apps/stage-tamagotchi/src/main`
calls the adapter's `createContext` with a window. `@proj-airi/electron-screen-capture`
takes the context as a parameter of `initScreenCaptureForWindow` instead of
creating one.

Sharing has one visible rule. An event that the main process emits on a
window's context reaches the renderer of that window and every main-process
listener that any service of the window registered for the same event. Before,
it reached only the listeners of the emitting service's own context. On
2026-11-10 the main process had two such listeners
(`widgetsIframeRequestResultEvent` and
`electronStageCharacterPlacementChanged`), and it emits neither event, so no
behaviour changed. A new main-side `context.on` must expect emits from sibling
services.

### One `ipcMain` listener per channel

`IpcRouter` in `apps/stage-tamagotchi/src/main/libs/electron/ipc-router.ts`
owns the only real listener of each IPC channel. It looks up the
`webContents` id of the sender and calls the listeners of that window, then
the listeners that hear every sender. A message from one window no longer
passes through the sender check of every other window's context.

A context never receives the real `ipcMain`. It receives a target from the
router that has only `on` and `off`:

- `createWindowContext(window)` uses `forWindow(window.webContents.id)`.
- `createAppContext()` uses `forApp()`. It replaces every
  `createContext(ipcMain)` call: the tray, the channel server, the extension
  host, the IO trace hub, the Sherpaw model assets, computer use, Home
  Assistant, and the Apple speech and vision services. These contexts stay
  separate, because each has its own owner and lifetime.

The adapter types its transport as Electron's `IpcMain`, so the router casts
the target once and marks the cast with a `NOTICE` comment.

The adapter removes its listeners when it disposes, which for a window context
is when the window closes. The router then drops the window's entry. It
attaches to a channel with the first listener and detaches with the last one,
so `ipcMain.listenerCount('eventa-message')` is 1 while any context exists and
0 after the last one is gone.

Delivery order changed in one respect. `ipcMain` called the contexts in the
order of their creation. The router calls the window's context before the app
contexts. The order is visible only when a window context and an app context
both handle the same invoke, which would already run two handlers for one
request; no such pair was found on 2026-11-10.

All 16 `ipcMain.setMaxListeners(...)` calls and their TODO comments are
removed.

## Scope

The renderer side is unchanged. `ipcRenderer.setMaxListeners(0)` in
`apps/stage-tamagotchi/src/preload/shared.ts` stays, and renderer modules keep
their own contexts.
