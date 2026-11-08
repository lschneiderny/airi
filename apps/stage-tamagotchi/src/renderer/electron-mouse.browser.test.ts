import type { BrowserWindow, IpcMain, IpcMainEvent, IpcRendererEvent, Point, WebContents } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { bounds, cursorScreenPoint, startLoopGetBounds, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { getElectronEventaContext, useElectronCursorAvailable, useElectronMouse, useElectronMouseEventTarget, useElectronMouseInElement, useElectronRelativeMouse } from '@proj-airi/electron-vueuse'
import { afterAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

type RendererIpc = NonNullable<Parameters<typeof getElectronEventaContext>[0]>
type RendererListener = Parameters<RendererIpc['on']>[1]
type MainListener = Parameters<IpcMain['on']>[1]

/**
 * Connects the shared renderer context to a main process context through in-memory IPC.
 *
 * `@proj-airi/electron-vueuse` has no Vitest project. This project resolves the package as the renderer does.
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
  const main = createMainContext(ipcMain as IpcMain, browserWindow as BrowserWindow)
  getElectronEventaContext(ipcRenderer as RendererIpc)
  afterAll(() => main.dispose())

  return main.context
}

// The package owns one context and mouse subscription for the renderer's lifetime.
const main = connectMain()
defineInvokeHandler(main, startLoopGetCursorScreenPoint, () => {})
defineInvokeHandler(main, startLoopGetBounds, () => {})

function mountMouse() {
  let state: {
    mouse: ReturnType<typeof useElectronMouse>
    relative: ReturnType<typeof useElectronRelativeMouse>
    available: ReturnType<typeof useElectronCursorAvailable>
  } | undefined
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      state = {
        mouse: useElectronMouse(),
        relative: useElectronRelativeMouse(),
        available: useElectronCursorAvailable(),
      }
      return () => null
    },
  })
  app.mount(host)
  onTestFinished(() => {
    app.unmount()
    host.remove()
  })
  if (!state)
    throw new Error('Mouse host did not mount')
  return state
}

/** Await the exact renderer delivery, including nulls that must not dispatch a mousemove. */
async function sendCursor(point: Point | null) {
  const received = Promise.withResolvers<void>()
  getElectronEventaContext().once(cursorScreenPoint, () => received.resolve())
  await main.emit(cursorScreenPoint, point)
  await received.promise
  await nextTick()
}

beforeEach(async () => {
  useElectronCursorAvailable()
  await sendCursor(null)
})

describe('useElectronMouse', () => {
  it('gives a consumer that mounts while the cursor stays still the last position', async () => {
    const { mouse: first } = mountMouse()

    // The main process sends a position only when it changes, so no message follows while the cursor stays still.
    await sendCursor({ x: 10, y: 20 })
    expect(first.x.value).toBe(10)

    const { mouse: late, available } = mountMouse()
    expect(late.x.value).toBe(10)
    expect(late.y.value).toBe(20)
    expect(available.value).toBe(true)
  })

  it('marks a null body unavailable without moving either screen or relative coordinates', async () => {
    const { mouse, relative, available } = mountMouse()
    const receivedBounds = Promise.withResolvers<void>()
    getElectronEventaContext().once(bounds, () => receivedBounds.resolve())
    await main.emit(bounds, { x: 100, y: 200, width: 500, height: 500 })
    await receivedBounds.promise
    await sendCursor({ x: 140, y: 260 })
    expect(relative.available.value).toBe(true)
    expect([relative.x.value, relative.y.value]).toEqual([40, 60])
    const mousemove = vi.fn()
    const target = useElectronMouseEventTarget().value
    target.addEventListener('mousemove', mousemove)
    onTestFinished(() => target.removeEventListener('mousemove', mousemove))

    await sendCursor(null)

    expect(available.value).toBe(false)
    expect(relative.available.value).toBe(false)
    expect([mouse.x.value, mouse.y.value]).toEqual([140, 260])
    expect([relative.x.value, relative.y.value]).toEqual([40, 60])
    expect(mousemove).not.toHaveBeenCalled()
    const late = mountMouse()
    expect(late.available.value).toBe(false)
    expect([late.mouse.x.value, late.mouse.y.value]).toEqual([140, 260])
  })

  it('restores availability and coordinates when a trusted point arrives again', async () => {
    const { mouse, available } = mountMouse()
    await sendCursor({ x: 10, y: 20 })
    await sendCursor(null)

    await sendCursor({ x: -30, y: 40 })

    expect(available.value).toBe(true)
    expect([mouse.x.value, mouse.y.value]).toEqual([-30, 40])
  })
})

async function mountHitTest() {
  const target = ref<HTMLElement>()
  let state: ReturnType<typeof useElectronMouseInElement> | undefined
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      state = useElectronMouseInElement(target)
      return () => h('div', { ref: target, style: 'position:fixed;left:100px;top:100px;width:100px;height:100px' })
    },
  })
  app.mount(host)
  onTestFinished(() => {
    app.unmount()
    host.remove()
  })
  await nextTick()
  if (!state || !target.value)
    throw new Error('Hit-test host did not mount')
  return { state, target: target.value }
}

describe('useElectronMouseInElement', () => {
  it('retains pointer-only entry when native availability is withdrawn mid-hover', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()
    expect(state.isOutside.value).toBe(true)

    await sendCursor(null)

    expect(state.isOutside.value).toBe(false)
  })

  it('uses a DOM pointerenter while withheld without changing Electron coordinates', async () => {
    const { state, target } = await mountHitTest()
    expect(state.isOutside.value).toBe(true)
    const position = [state.x.value, state.y.value]

    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()

    expect(state.isOutside.value).toBe(false)
    expect([state.x.value, state.y.value]).toEqual(position)
    target.dispatchEvent(new PointerEvent('pointerleave'))
    await nextTick()
    expect(state.isOutside.value).toBe(true)
  })

  it('keeps native hit-testing authoritative while DOM reports inside', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()

    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 140 }))
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()

    expect(state.isOutside.value).toBe(true)

    await sendCursor(null)
    expect(state.isOutside.value).toBe(false)
  })

  it('returns to native hit-testing when availability resumes mid-hover', async () => {
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()
    expect(state.isOutside.value).toBe(false)

    await sendCursor({ x: 900, y: 900 })

    expect(state.isOutside.value).toBe(true)
  })

  it('retains pointer exit while native availability is still live', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new PointerEvent('pointerenter', { clientX: 130, clientY: 140 }))
    await nextTick()
    await sendCursor(null)
    expect(state.isOutside.value).toBe(false)
    await sendCursor({ x: 900, y: 900 })

    target.dispatchEvent(new PointerEvent('pointerleave'))
    await nextTick()
    await sendCursor(null)

    expect(state.isOutside.value).toBe(true)
  })

  it('selects the current hit-test when availability flips during a DOM hover', async () => {
    await sendCursor({ x: 900, y: 900 })
    const { state, target } = await mountHitTest()
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 140 }))
    await nextTick()
    expect(state.isOutside.value).toBe(true)

    await sendCursor(null)
    expect(state.isOutside.value).toBe(false)

    // The same cached native point becomes trusted again without a new DOM move.
    await sendCursor({ x: 900, y: 900 })
    expect(state.isOutside.value).toBe(true)
  })
})
