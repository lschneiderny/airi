import type { IpcMain, IpcMainEvent } from 'electron'

import { ipcMain } from 'electron'

type IpcListener = (event: IpcMainEvent, ...args: unknown[]) => void

/** The two `ipcMain` members that the router and the Eventa main adapter call. */
interface IpcListeners {
  on: (channel: string, listener: IpcListener) => unknown
  off: (channel: string, listener: IpcListener) => unknown
}

/** The sender that a listener hears: one `webContents` by its id, or every sender. */
type Audience = number | 'every-sender'

interface Route {
  /** The one listener that this channel has on the real `ipcMain`. */
  dispatch: IpcListener
  listeners: Map<Audience, Set<IpcListener>>
}

/**
 * Routes `ipcMain` traffic to Eventa contexts through one real listener per channel.
 *
 * The Eventa main adapter adds one `ipcMain` listener per context and channel, and each of them checks the sender of
 * every message. The router owns the only real listener of a channel instead. It looks up the sender's `webContents`
 * id and calls the listeners of that window, then the listeners that hear every sender. So the listener count on
 * `ipcMain` stays at one per channel, however many windows and services exist.
 *
 * A context takes part through a target from {@link IpcRouter.forWindow} or {@link IpcRouter.forApp}, which it uses
 * in place of `ipcMain`. The context that added a listener removes it: the adapter does so when it disposes. The
 * router attaches its real listener with the first listener of a channel and detaches it with the last one, and it
 * keeps no entry for a window that has no listener left.
 *
 * A listener that throws stops the listeners after it for that message, as on `ipcMain` itself.
 */
export class IpcRouter {
  private readonly routes = new Map<string, Route>()

  constructor(private readonly ipc: IpcListeners) {}

  /**
   * Returns a target whose listeners hear only IPC from one `webContents`.
   *
   * @param webContentsId Read it while the window is alive. A closed window cannot supply its `webContents`.
   */
  forWindow(webContentsId: number): IpcMain {
    return this.target(webContentsId)
  }

  /** Returns a target whose listeners hear IPC from every sender. */
  forApp(): IpcMain {
    return this.target('every-sender')
  }

  private target(audience: Audience): IpcMain {
    const target: IpcListeners = {
      on: (channel, listener) => {
        const route = this.attach(channel)
        const listeners = route.listeners.get(audience) ?? new Set()
        route.listeners.set(audience, listeners.add(listener))
      },
      off: (channel, listener) => {
        const route = this.routes.get(channel)
        const listeners = route?.listeners.get(audience)
        if (!route || !listeners?.delete(listener))
          return
        if (listeners.size === 0)
          route.listeners.delete(audience)
        if (route.listeners.size === 0) {
          this.routes.delete(channel)
          this.ipc.off(channel, route.dispatch)
        }
      },
    }
    // NOTICE:
    // The target stands in for `ipcMain` without implementing all of it.
    // The Eventa 1.0.2 main adapter types its transport as Electron's `IpcMain` but calls only `on` and `off`.
    // Source: node_modules/@moeru/eventa/dist/adapters/electron/main.mjs (`withRemoval`).
    // Removal condition: Eventa accepts a narrower transport type, or dispatches by window itself.
    return target as IpcMain
  }

  private attach(channel: string): Route {
    const existing = this.routes.get(channel)
    if (existing)
      return existing

    const route: Route = {
      dispatch: (event, ...args) => {
        // A listener can remove itself or others while the message is delivered, so the delivery uses a copy.
        const listeners = [...route.listeners.get(event.sender.id) ?? [], ...route.listeners.get('every-sender') ?? []]
        for (const listener of listeners)
          listener(event, ...args)
      },
      listeners: new Map(),
    }
    this.routes.set(channel, route)
    this.ipc.on(channel, route.dispatch)
    return route
  }
}

let router: IpcRouter | undefined

/** The router on Electron's `ipcMain`. Every main-process Eventa context of the app goes through it. */
export function ipcRouter(): IpcRouter {
  // Created on first use, so importing this module does not read `ipcMain` before the app, or a test, needs it.
  router ??= new IpcRouter(ipcMain)
  return router
}
