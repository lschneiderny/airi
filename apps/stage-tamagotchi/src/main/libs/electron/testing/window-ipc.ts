import type { BrowserWindow } from 'electron'

import { EventEmitter } from 'node:events'

import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'

let nextWebContentsId = 1

/**
 * Connects one fake window to a shared fake `ipcMain`, as Electron connects a renderer to the main process.
 *
 * The renderer side sends with the window's `webContents` as the IPC sender. The main side sends to the window
 * through `webContents.send`. `close()` destroys the window and then emits `closed`, in Electron's order.
 *
 * @example
 * vi.mock('electron', async () => ({ ipcMain: new (await import('node:events')).EventEmitter() }))
 *
 * const { ipcMain } = await import('electron')
 * const main = createWindowIpc(ipcMain)
 * defineInvokeHandler(createWindowContext(main.window).context, someInvoke, handler)
 * await defineInvoke(main.context, someInvoke)()
 */
export function createWindowIpc(ipcMain: EventEmitter) {
  const rendererIpc = new EventEmitter()
  let destroyed = false
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    isVisible: () => !destroyed,
    webContents: Object.assign(new EventEmitter(), {
      id: nextWebContentsId++,
      isCrashed: () => false,
      isDestroyed: () => destroyed,
      send: (channel: string, payload: unknown) => rendererIpc.emit(channel, {}, payload),
    }),
  })
  // The fakes carry only the members that the Eventa adapters call and that the window services read when they
  // register.
  const { context } = createRendererContext({
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      rendererIpc.on(channel, listener)
      return () => rendererIpc.off(channel, listener)
    },
    send: (channel: string, payload: unknown) => ipcMain.emit(channel, { sender: window.webContents }, payload),
  } as never)

  const browserWindow: BrowserWindow = window as never
  return {
    window: browserWindow,
    context,
    close() {
      destroyed = true
      window.emit('closed')
    },
  }
}
