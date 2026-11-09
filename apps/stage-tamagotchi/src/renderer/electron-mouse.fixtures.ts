import type { BrowserWindow, IpcMain, IpcMainEvent, IpcRendererEvent, Point, WebContents } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { bounds, cursorScreenPoint, startLoopGetBounds, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { afterAll, vi } from 'vitest'
import { nextTick } from 'vue'

type RendererIpc = NonNullable<Parameters<typeof getElectronEventaContext>[0]>
type RendererListener = Parameters<RendererIpc['on']>[1]
type MainListener = Parameters<IpcMain['on']>[1]

/**
 * Connects the shared renderer context to a main process context through in-memory IPC.
 *
 * `@proj-airi/electron-vueuse` has no Vitest project. These suites resolve the package as the renderer does.
 */
function connectMain() {
  const mainListeners = new Map<string, MainListener>()
  const rendererListeners = new Map<string, RendererListener>()
  const ipcMain: Pick<IpcMain, 'on' | 'off'> = {
    on: vi.fn((channel: string, listener: MainListener) => {
      mainListeners.set(channel, listener)
      return ipcMain as IpcMain
    }),
    off: vi.fn((channel: string) => {
      mainListeners.delete(channel)
      return ipcMain as IpcMain
    }),
  }
  const webContents: Pick<WebContents, 'id' | 'isDestroyed' | 'send'> = {
    id: 1,
    isDestroyed: () => false,
    send: vi.fn((channel: string, body: unknown) => {
      const message = structuredClone(body)
      queueMicrotask(() => rendererListeners.get(channel)?.({} as IpcRendererEvent, message))
    }),
  }
  const browserWindow: Pick<BrowserWindow, 'webContents' | 'isDestroyed'> = { webContents: webContents as WebContents, isDestroyed: () => false }
  const ipcRenderer: Pick<RendererIpc, 'on' | 'removeListener' | 'send'> = {
    on: vi.fn((channel: string, listener: RendererListener) => {
      rendererListeners.set(channel, listener)
      return () => rendererListeners.delete(channel)
    }),
    removeListener: vi.fn((channel: string) => {
      rendererListeners.delete(channel)
      return ipcRenderer as RendererIpc
    }),
    send: vi.fn((channel: string, body: unknown) => {
      const message = structuredClone(body)
      queueMicrotask(() => mainListeners.get(channel)?.({ sender: webContents as WebContents } as IpcMainEvent, message))
    }),
  }
  const connection = createMainContext(ipcMain as IpcMain, browserWindow as BrowserWindow)
  getElectronEventaContext(ipcRenderer as RendererIpc)
  afterAll(() => connection.dispose())
  return connection.context
}

// The package owns one context and mouse subscription for the renderer's lifetime.
export const main = connectMain()
defineInvokeHandler(main, startLoopGetCursorScreenPoint, () => {})
defineInvokeHandler(main, startLoopGetBounds, () => {})

/** Await the exact renderer delivery, including nulls that must not dispatch a mousemove. */
export async function sendCursor(point: Point | null) {
  const received = Promise.withResolvers<void>()
  getElectronEventaContext().once(cursorScreenPoint, () => received.resolve())
  await main.emit(cursorScreenPoint, point)
  await received.promise
  await nextTick()
}

export async function sendBounds(value: { x: number, y: number, width: number, height: number }) {
  const received = Promise.withResolvers<void>()
  getElectronEventaContext().once(bounds, () => received.resolve())
  await main.emit(bounds, value)
  await received.promise
  await nextTick()
}
