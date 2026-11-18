import type { Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { createContext } from '@moeru/eventa'
import { bounds } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  electronGetWindowControlsState,
  electronWindowCenterSystemControls,
  electronWindowControlsStateChanged,
  electronWindowMinimize,
  electronWindowToggleMaximize,
} from '../../../shared/eventa'
import { readRendererWindowBounds } from './coordinates'
import { createWindowService } from './window'

const mocks = vi.hoisted(() => ({
  handlers: new Map<unknown, (payload: unknown, options: unknown) => unknown>(),
  platform: { isMacOS: false },
}))

// NOTICE:
// The handlers read the sender of the Electron IPC event, and a plain eventa context carries no such event.
// The double keeps each handler, so the test can call it as a chosen sender.
// Removal condition: eventa can supply raw IPC options to a handler in a test.
vi.mock('@moeru/eventa', async (importOriginal) => {
  return {
    ...await importOriginal<typeof import('@moeru/eventa')>(),
    defineInvokeHandler: (_context: unknown, event: unknown, handler: (payload: unknown, options: unknown) => unknown) => {
      mocks.handlers.set(event, handler)
    },
  }
})

vi.mock('@proj-airi/electron-vueuse/main', () => ({
  createRendererLoop: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  safeClose: vi.fn(),
}))

vi.mock('./coordinates', () => ({ readRendererWindowBounds: vi.fn() }))

vi.mock('std-env', () => ({
  get isMacOS() { return mocks.platform.isMacOS },
  isWindows: false,
}))

vi.mock('../../libs/bootkit/lifecycle', () => ({
  onAppBeforeQuit: () => () => {},
  onAppWindowAllClosed: () => () => {},
}))

vi.mock('../../windows/shared/window', () => ({
  resizeWindowByDelta: vi.fn(),
  setWindowAlwaysOnTop: vi.fn(),
}))

const ownSender = { raw: { ipcMainEvent: { sender: { id: 7 } } } }
const otherSender = { raw: { ipcMainEvent: { sender: { id: 8 } } } }

class FakeWindow extends EventEmitter {
  readonly webContents = { id: 7 }
  maximized = false
  fullscreen = false
  minimize = vi.fn()
  maximize = vi.fn()
  unmaximize = vi.fn()
  isFullScreen = () => this.fullscreen
  isMaximized = () => this.maximized
  isMinimizable = () => false
  isMaximizable = () => true
  isClosable = () => true
  buttonPosition: { x: number, y: number } | null = { x: 16, y: 15 }
  getWindowButtonPosition = () => this.buttonPosition
  setWindowButtonPosition = vi.fn((position: { x: number, y: number } | null) => {
    this.buttonPosition = position
  })
}

function setupService() {
  const window = new FakeWindow()
  const emit = vi.fn()
  createWindowService({ context: { emit } as never, window: window as never })
  return { emit, window }
}

function invoke(event: unknown, sender: unknown = ownSender, payload?: unknown) {
  return mocks.handlers.get(event)!(payload, sender)
}

describe('window controls', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.platform.isMacOS = false
  })

  it('reports the buttons that the window allows', () => {
    setupService()

    expect(invoke(electronGetWindowControlsState)).toEqual({
      systemControls: false,
      fullscreen: false,
      maximized: false,
      minimizable: false,
      maximizable: true,
      closable: true,
    })
  })

  it('reports system controls on macOS', () => {
    mocks.platform.isMacOS = true
    setupService()

    expect(invoke(electronGetWindowControlsState)).toMatchObject({ systemControls: true })
  })

  it('centers the traffic lights on a taller title bar, and restores them', () => {
    mocks.platform.isMacOS = true
    const { window } = setupService()

    invoke(electronWindowCenterSystemControls, ownSender, { centerY: 26 })
    expect(window.buttonPosition).toEqual({ x: 16, y: 19 })

    invoke(electronWindowCenterSystemControls, ownSender, {})
    expect(window.buttonPosition).toEqual({ x: 16, y: 15 })
  })

  it('leaves the window buttons alone on other platforms and for another window', () => {
    const { window } = setupService()
    invoke(electronWindowCenterSystemControls, ownSender, { centerY: 26 })

    mocks.platform.isMacOS = true
    const mac = setupService()
    invoke(electronWindowCenterSystemControls, otherSender, { centerY: 26 })

    expect(window.setWindowButtonPosition).not.toHaveBeenCalled()
    expect(mac.window.setWindowButtonPosition).not.toHaveBeenCalled()
  })

  it('maximizes a normal window and restores a maximized window', () => {
    const { window } = setupService()

    invoke(electronWindowToggleMaximize)
    expect(window.maximize).toHaveBeenCalledTimes(1)
    expect(window.unmaximize).not.toHaveBeenCalled()

    window.maximized = true
    invoke(electronWindowToggleMaximize)
    expect(window.unmaximize).toHaveBeenCalledTimes(1)
    expect(window.maximize).toHaveBeenCalledTimes(1)
  })

  it('ignores requests from another window', () => {
    const { window } = setupService()

    invoke(electronWindowMinimize, otherSender)
    invoke(electronWindowToggleMaximize, otherSender)

    expect(window.minimize).not.toHaveBeenCalled()
    expect(window.maximize).not.toHaveBeenCalled()
    expect(invoke(electronGetWindowControlsState, otherSender)).toBeUndefined()
  })

  it.each([
    ['maximize', { maximized: true }],
    ['unmaximize', { maximized: false }],
    ['enter-full-screen', { fullscreen: true }],
    ['leave-full-screen', { fullscreen: false }],
  ])('sends the new state when the window fires %s', (eventName, expected) => {
    const { emit, window } = setupService()
    Object.assign(window, expected)

    window.emit(eventName)

    expect(emit).toHaveBeenCalledWith(electronWindowControlsStateChanged, expect.objectContaining(expected))
  })
})

describe('window service bounds loop', () => {
  it('tells the renderer once when its rectangle is withheld, then resumes with the trusted one', async () => {
    const context = createContext()
    const window = Object.assign(new EventEmitter(), { webContents: { id: 1 } })
    createWindowService({ context: context as never, window: window as never })
    const sent: Array<Rectangle | null | undefined> = []
    context.on(bounds, event => sent.push(event.body))
    const [loop] = vi.mocked(createRendererLoop).mock.calls.at(-1) ?? []
    if (!loop)
      throw new Error('Window service did not register its bounds loop')

    const trusted = { x: 50, y: 560, width: 300, height: 400 }
    vi.mocked(readRendererWindowBounds).mockReturnValue(trusted)
    await loop.run()
    vi.mocked(readRendererWindowBounds).mockReturnValue(null)
    await loop.run()
    await loop.run()
    vi.mocked(readRendererWindowBounds).mockReturnValue(trusted)
    await loop.run()

    expect(sent).toEqual([trusted, null, trusted])
  })
})
