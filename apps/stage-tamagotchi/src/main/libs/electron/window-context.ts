import type { BrowserWindow } from 'electron'

import { createContext } from '@moeru/eventa/adapters/electron/main'

import { ipcRouter } from './ipc-router'
import { onWindowClosed } from './on-window-closed'

type WindowContext = ReturnType<typeof createContext>['context']

const contexts = new WeakMap<BrowserWindow, WindowContext>()

/**
 * Returns the one Eventa context that serves the renderer of `window`.
 *
 * Every caller for the same window gets the same context. The first call creates it.
 *
 * All windows share one `ipcMain`. The context from this function hears only IPC from `window`, so one invoke runs
 * one handler. A context that heard every window would run the handler of each open window for one invoke, and each
 * copy would answer its own window. The IPC router delivers the messages (see `./ipc-router`), so the context adds
 * no listener to `ipcMain` itself.
 *
 * Events that the main process emits on the context go to `window`, and to every main-process listener that any
 * service of the window registered for the same event. A request that is not about one window can use
 * {@link createAppContext} instead, because that context answers the sender.
 *
 * The window owns the context. The context disposes when the window closes: it aborts pending invokes and stops
 * hearing IPC. No caller may dispose it. A service that stops before its window closes removes only its own handlers,
 * with the functions that `defineInvokeHandler` and `context.on` return.
 *
 * @param window A live window. A destroyed window, or one whose `webContents` is destroyed, throws a `TypeError`.
 */
export function createWindowContext(window: BrowserWindow): { context: WindowContext } {
  const existing = contexts.get(window)
  if (existing)
    return { context: existing }

  // A destroyed window cannot supply the `webContents` id that the router needs.
  if (window.isDestroyed())
    throw new TypeError('createWindowContext requires a live BrowserWindow')

  const { context } = createContext(ipcRouter().forWindow(window.webContents.id), window, { onlySameWindow: true })
  contexts.set(window, context)
  // The adapter disposes the context on the same event, through its own `closed` listener. A later call for this
  // window must be refused as a destroyed window, instead of returning the disposed context.
  onWindowClosed(window, () => contexts.delete(window))
  return { context }
}

/**
 * Creates an Eventa context that serves the renderers of all windows.
 *
 * The context hears the IPC of every window and answers the sender of each invoke. Use it for a request that is not
 * about one window, registered once for the app: one invoke then runs one handler, whichever window sends it. An
 * event that the main process emits on it without an incoming call reaches no renderer; push such an event on the
 * context of each window instead.
 *
 * The caller owns the context and calls `dispose` when the service stops before the app does.
 */
export function createAppContext() {
  return createContext(ipcRouter().forApp())
}
