import type { Rectangle } from 'electron'

import type { ChatAttentionTarget, ChatFloatingPlacement, ChatWindowMode } from '../../../shared/eventa'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  electronChatFloatingContentHidden,
  electronChatFloatingMoveTo,
  electronChatWindowDraftSettled,
  electronChatWindowSetPreferences,
} from '../../../shared/eventa'
import { setupChatWindowManager } from './index'

const mocks = await vi.hoisted(async () => {
  // vi.hoisted runs before the imports of this file.
  const { EventEmitter } = await import('node:events')
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }

  /**
   * A BrowserWindow with the members the chat windows call. `show`, `hide`,
   * `minimize`, `restore`, `close`, and a `setBounds` that moves the window
   * emit their events synchronously, as Electron does on Windows.
   */
  class FakeBrowserWindow extends EventEmitter {
    static nextId = 1
    readonly webContents = { id: FakeBrowserWindow.nextId++, isDestroyed: () => false, isCrashed: () => false }
    bounds: Rectangle
    visible = false
    minimized = false
    destroyed = false

    constructor(options: { width?: number, height?: number } = {}) {
      super()
      this.bounds = { x: 0, y: 0, width: options.width ?? 450, height: options.height ?? 600 }
    }

    getBounds = () => ({ ...this.bounds })
    setBounds = (bounds: Rectangle) => {
      const moved = bounds.x !== this.bounds.x || bounds.y !== this.bounds.y
      const resized = bounds.width !== this.bounds.width || bounds.height !== this.bounds.height
      this.bounds = { ...bounds }
      if (moved)
        this.emit('move')
      if (resized)
        this.emit('resize')
    }

    isVisible = () => this.visible && !this.minimized
    isMinimized = () => this.minimized
    isDestroyed = () => this.destroyed
    isFocused = () => false
    isAlwaysOnTop = () => false
    show = () => {
      this.visible = true
      this.emit('show')
    }

    showInactive = this.show
    hide = () => {
      this.visible = false
      this.emit('hide')
    }

    minimize = () => {
      this.minimized = true
      this.emit('minimize')
    }

    restore = () => {
      this.minimized = false
      this.emit('restore')
    }

    close = () => {
      if (this.destroyed)
        return
      this.destroyed = true
      this.visible = false
      this.emit('closed')
    }

    destroy = this.close
    focus = () => {}
    moveTop = () => {}
    setAlwaysOnTop = () => {}
    setParentWindow = () => {}
    setIgnoreMouseEvents = () => {}
    setFullScreenable = () => {}
    setWindowButtonVisibility = () => {}
  }

  /** Invoke handlers that each window registered, keyed by the window, then by the Eventa definition. */
  const handlers = new Map<object, Map<unknown, (payload?: unknown) => unknown>>()
  const contextWindows = new WeakMap<object, FakeBrowserWindow>()

  return {
    FakeBrowserWindow,
    workArea,
    handlers,
    contextWindows,
    config: undefined as unknown,
    /** Whether a newly loaded chat page puts the handed over draft back. */
    restoresDraft: true,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeBrowserWindow,
  ipcMain: { setMaxListeners: () => {} },
  screen: {
    getDisplayMatching: () => ({ workArea: mocks.workArea }),
    getAllDisplays: () => [{ bounds: mocks.workArea, workArea: mocks.workArea }],
  },
}))
vi.mock('std-env', () => ({ isMacOS: false }))
vi.mock('../../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))

// Eventa is the IPC boundary: the test keeps each window's invoke handlers and
// calls them as that window's renderer would.
vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<object>(),
  defineInvokeHandler: (context: object, definition: unknown, handler: (payload?: unknown) => unknown) => {
    const window = mocks.contextWindows.get(context)!
    const windowHandlers = mocks.handlers.get(window) ?? new Map()
    windowHandlers.set(definition, handler)
    mocks.handlers.set(window, windowHandlers)
  },
  // A chat page with an empty composer has no draft to hand over.
  defineInvoke: () => async () => undefined,
}))
vi.mock('../../libs/electron/window-context', () => ({
  createWindowContext: (window: object) => {
    const context = { emit: () => {} }
    mocks.contextWindows.set(context, window as InstanceType<typeof mocks.FakeBrowserWindow>)
    return { context }
  },
}))
vi.mock('../../libs/electron/location', () => ({
  baseUrl: () => 'http://localhost',
  getElectronMainDirname: () => '/main',
  withHashRoute: (_base: string, route: string) => route,
  // The chat page mounts once loaded, and reports the draft handover as
  // useChatDraftHandover does.
  load: async (window: object) => {
    queueMicrotask(() => {
      mocks.handlers.get(window)?.get(electronChatWindowDraftSettled)?.({ restored: mocks.restoresDraft })
    })
  },
}))
vi.mock('../../libs/electron/persistence', () => ({
  createConfig: () => ({
    setup: () => {},
    get: () => mocks.config,
    update: (next: unknown) => mocks.config = next,
  }),
}))
vi.mock('../shared', () => ({ protectPrivilegedWindowNavigation: () => {} }))
vi.mock('../shared/window', () => ({
  protectPrivilegedWindowNavigation: () => {},
  resizeBoundsByDelta: (bounds: Rectangle) => bounds,
  transparentWindowConfig: () => ({}),
}))
vi.mock('../shared/app-icon', () => ({ showWindowOnAllWorkspaces: () => {} }))
vi.mock('./rpc/index.electron', () => ({ setupChatWindowElectronInvokes: async () => {} }))

type FakeWindow = InstanceType<typeof mocks.FakeBrowserWindow>

const hidden: ChatAttentionTarget = { visible: false, bounds: null }

/**
 * A chat manager beside a main window with room on both sides, in `mode` and
 * `placement`. `targets` records every target the main window would receive.
 */
function setup(mode: ChatWindowMode, placement: ChatFloatingPlacement) {
  mocks.config = { mode, placement, pinned: true, floating: { width: 380, height: 560, x: 1200, y: 200 } }
  const main = new mocks.FakeBrowserWindow()
  main.bounds = { x: 700, y: 300, width: 450, height: 600 }
  const manager = setupChatWindowManager({
    getMainWindow: () => main as never,
    openSettingsWindow: async () => {},
    widgetsManager: {} as never,
    serverChannel: {} as never,
    mcpManager: {} as never,
    i18n: {} as never,
  })
  const targets: ChatAttentionTarget[] = []
  manager.onAttentionTargetChange(target => targets.push(target))
  return { main, manager, targets }
}

/** The chat window of the current test, which the manager creates on open. */
function chatWindows() {
  return [...mocks.handlers.keys()] as FakeWindow[]
}

function handlerOf(window: FakeWindow, definition: unknown) {
  return mocks.handlers.get(window)!.get(definition)!
}

describe('chat attention target', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.restoresDraft = true
  })

  describe.each(['attached', 'free', 'danmaku'] as const)('%s floating chat', (placement) => {
    it('points at the chat window while it is shown and unfolded', async () => {
      const { manager, targets } = setup('floating', placement)

      await manager.open()
      const [chat] = chatWindows()

      expect(manager.getAttentionTarget()).toEqual({ visible: true, bounds: chat.getBounds() })
      expect(targets.at(-1)).toEqual({ visible: true, bounds: chat.getBounds() })
    })

    it('stops pointing at the chat as soon as it folds', async () => {
      const { manager, targets } = setup('floating', placement)
      await manager.open()

      // The window stays shown while the renderer animates the fold.
      await manager.toggle()

      expect(chatWindows()[0].isVisible()).toBe(true)
      expect(targets.at(-1)).toEqual(hidden)
      expect(manager.getAttentionTarget()).toEqual(hidden)
    })
  })

  it('follows an attached chat that moves with the main window, once per move', async () => {
    const { main, manager, targets } = setup('floating', 'attached')
    await manager.open()
    const [chat] = chatWindows()
    const before = chat.getBounds()
    targets.length = 0

    main.setBounds({ ...main.bounds, x: main.bounds.x + 40, y: main.bounds.y + 10 })

    expect(chat.getBounds()).toEqual({ ...before, x: before.x + 40, y: before.y + 10 })
    expect(targets).toEqual([{ visible: true, bounds: chat.getBounds() }])
  })

  it.each(['free', 'danmaku'] as const)('leaves a %s chat where it is when the main window moves', async (placement) => {
    const { main, manager, targets } = setup('floating', placement)
    await manager.open()
    targets.length = 0

    main.setBounds({ ...main.bounds, x: main.bounds.x + 40 })

    expect(targets).toEqual([])
  })

  it('follows a free chat that its drag handle moves', async () => {
    const { manager, targets } = setup('floating', 'free')
    await manager.open()
    const [chat] = chatWindows()
    targets.length = 0

    await handlerOf(chat, electronChatFloatingMoveTo)({ x: 300, y: 120 })

    expect(targets).toEqual([{ visible: true, bounds: { x: 300, y: 120, width: 380, height: 560 } }])
  })

  it('hides an attached chat while it moves to the other side of the main window', async () => {
    const { main, manager, targets } = setup('floating', 'attached')
    await manager.open()
    const [chat] = chatWindows()
    const leftSide = chat.getBounds()
    targets.length = 0

    // The left side of the work area is too narrow for the chat now.
    main.setBounds({ ...main.bounds, x: 100 })

    expect(targets).toEqual([hidden])

    await handlerOf(chat, electronChatFloatingContentHidden)()

    expect(chat.getBounds().x).toBeGreaterThan(leftSide.x)
    expect(targets).toEqual([hidden, { visible: true, bounds: chat.getBounds() }])
  })

  it('points at a shown legacy chat window and not at a minimized one', async () => {
    const { manager, targets } = setup('legacy', 'attached')
    await manager.open()
    const [legacy] = chatWindows()

    expect(targets.at(-1)).toEqual({ visible: true, bounds: legacy.getBounds() })

    legacy.minimize()
    expect(targets.at(-1)).toEqual(hidden)

    legacy.restore()
    expect(targets.at(-1)).toEqual({ visible: true, bounds: legacy.getBounds() })
  })

  describe('mode switch', () => {
    it('moves the target from the floating chat to the legacy window', async () => {
      const { manager, targets } = setup('floating', 'attached')
      await manager.open()
      const [floating] = chatWindows()
      targets.length = 0

      await handlerOf(floating, electronChatWindowSetPreferences)({ mode: 'legacy', placement: 'attached', pinned: true })
      const legacy = chatWindows().find(window => window !== floating)!

      expect(floating.isDestroyed()).toBe(true)
      expect(targets).toEqual([hidden, { visible: true, bounds: legacy.getBounds() }])
      expect(manager.getAttentionTarget()).toEqual({ visible: true, bounds: legacy.getBounds() })
    })

    it('ignores the floating chat once the legacy mode is saved', async () => {
      const { manager, targets } = setup('legacy', 'attached')
      await manager.open()
      const [legacy] = chatWindows()

      await handlerOf(legacy, electronChatWindowSetPreferences)({ mode: 'floating', placement: 'attached', pinned: true })
      const floating = chatWindows().find(window => window !== legacy)!
      expect(targets.at(-1)).toEqual({ visible: true, bounds: floating.getBounds() })
      await handlerOf(floating, electronChatWindowSetPreferences)({ mode: 'legacy', placement: 'attached', pinned: true })
      const reopened = chatWindows().at(-1)!
      targets.length = 0

      // The closed floating window and the closed first legacy window send nothing.
      floating.emit('move')
      legacy.emit('show')
      reopened.minimize()

      expect(targets).toEqual([hidden])
    })

    it('points back at the floating chat when the legacy window cannot take the draft', async () => {
      const { manager, targets } = setup('floating', 'attached')
      await manager.open()
      const [floating] = chatWindows()
      const floatingTarget = { visible: true, bounds: floating.getBounds() }
      mocks.restoresDraft = false
      targets.length = 0

      await expect(handlerOf(floating, electronChatWindowSetPreferences)({ mode: 'legacy', placement: 'attached', pinned: true })).rejects.toThrow()

      expect(floating.isDestroyed()).toBe(false)
      expect(targets.at(-1)).toEqual(floatingTarget)
      expect(manager.getAttentionTarget()).toEqual(floatingTarget)
    })
  })
})
