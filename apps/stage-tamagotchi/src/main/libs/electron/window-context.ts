import type { BrowserWindow } from 'electron'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

type WindowContext = ReturnType<typeof createContext>['context']

const contexts = new WeakMap<BrowserWindow, WindowContext>()

/**
 * Returns the one Eventa context that serves the renderer of `window`.
 *
 * Every caller for the same window gets the same context, so a window costs one pair of `ipcMain` listeners however
 * many services it runs. The first call creates the context.
 *
 * All windows share one `ipcMain`. A context without `onlySameWindow` hears the IPC of every window. Then one invoke
 * runs once in each window that registered the handler, and each copy answers its own window. The context from this
 * function hears only IPC from `window`, so one invoke runs one handler.
 *
 * Events that the main process emits on the context go to `window`, and to every main-process listener that any
 * service of the window registered for the same event. A request that is not about one window can use a context
 * without a window instead, because that context answers the sender.
 *
 * The window owns the context. The context disposes when the window closes: it aborts pending invokes and stops
 * hearing IPC. No caller may dispose it. A service that stops before its window closes removes only its own handlers,
 * with the functions that `defineInvokeHandler` and `context.on` return.
 *
 * @param window A live window. Eventa throws a `TypeError` if the window or its `webContents` is destroyed.
 */
export function createWindowContext(window: BrowserWindow): { context: WindowContext } {
  const existing = contexts.get(window)
  if (existing)
    return { context: existing }

  const { context } = createContext(ipcMain, window, { onlySameWindow: true })
  contexts.set(window, context)
  // The adapter disposes the context on the same event. A later call for this window must reach the adapter again,
  // which refuses a destroyed window, instead of returning the disposed context.
  window.once('closed', () => contexts.delete(window))
  return { context }
}
