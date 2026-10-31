import type { Rectangle } from 'electron'

import type { ChatAnchor } from './anchor'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { electronChatFloatingContentHidden } from '../../../shared/eventa'
import { createCharacterAnchor } from './anchor'
import { setupFloatingChatWindow } from './floating'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')

  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = { id: 1, isDestroyed: () => false, isCrashed: () => false }
    bounds: Rectangle
    visible = false
    destroyed = false

    constructor(options: { width?: number, height?: number } = {}) {
      super()
      this.bounds = { x: 0, y: 0, width: options.width ?? 450, height: options.height ?? 600 }
    }

    getBounds = () => ({ ...this.bounds })
    setBounds = (bounds: Rectangle) => {
      this.bounds = { ...bounds }
      this.emit('move')
    }

    isVisible = () => this.visible
    isMinimized = () => false
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

    close = () => {
      this.destroyed = true
      this.visible = false
      this.emit('closed')
    }

    destroy = this.close
    focus = () => {}
    moveTop = () => {}
    restore = () => {}
    setAlwaysOnTop = () => {}
    setParentWindow = () => {}
    setIgnoreMouseEvents = () => {}
    setFullScreenable = () => {}
    setWindowButtonVisibility = () => {}
  }

  const handlers = new Map<unknown, (payload?: unknown) => unknown>()
  return { FakeBrowserWindow, handlers, workArea: { x: 0, y: 25, width: 1440, height: 801 } }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeBrowserWindow,
  screen: {
    getDisplayMatching: () => ({ workArea: mocks.workArea }),
    getAllDisplays: () => [{ bounds: mocks.workArea, workArea: mocks.workArea }],
  },
}))
vi.mock('std-env', () => ({ isMacOS: false }))
vi.mock('../../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<object>(),
  defineInvokeHandler: (_context: object, definition: unknown, handler: (payload?: unknown) => unknown) => {
    mocks.handlers.set(definition, handler)
  },
}))
vi.mock('../../libs/electron/window-context', () => ({ createWindowContext: () => ({ context: { emit: () => {} } }) }))
vi.mock('../../libs/electron/location', () => ({
  baseUrl: () => 'http://localhost',
  getElectronMainDirname: () => '/main',
  withHashRoute: (_base: string, route: string) => route,
  load: async () => {},
}))
vi.mock('../shared/window', () => ({
  protectPrivilegedWindowNavigation: () => {},
  resizeBoundsByDelta: (bounds: Rectangle) => bounds,
  transparentWindowConfig: () => ({}),
}))
vi.mock('../shared/app-icon', () => ({ showWindowOnAllWorkspaces: () => {} }))

const chatSize = { width: 380, height: 560 }
const characterSize = { width: 156, height: 558 }

/** An anchor that a test moves by hand, as the stage publishes a new home. */
function createManualAnchor(initial: Rectangle | null) {
  let rect = initial
  const listeners = new Set<() => void>()
  const anchor: ChatAnchor = {
    getRect: () => rect && { ...rect },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    nativeChild: false,
  }
  return {
    anchor,
    listenerCount: () => listeners.size,
    moveTo(next: Rectangle | null) {
      rect = next
      for (const listener of [...listeners])
        listener()
    },
  }
}

/** A character home rectangle standing on the work-area floor, left edge at `x`. */
function homeAt(x: number): Rectangle {
  return { x, y: mocks.workArea.y + mocks.workArea.height - 8 - characterSize.height, ...characterSize }
}

function setup(anchor: () => ChatAnchor | undefined) {
  const onWindowChange = vi.fn()
  const floating = setupFloatingChatWindow({
    getMainWindow: () => new mocks.FakeBrowserWindow() as never,
    getAnchor: anchor,
    getPlacement: () => 'attached',
    getPinned: () => true,
    getBounds: () => chatSize,
    saveBounds: () => {},
    setupChatInvokes: async () => {},
    onFoldedChange: () => {},
    onWindowChange,
  })
  return { floating, onWindowChange }
}

describe('floating chat attached to an anchor', () => {
  beforeEach(() => {
    mocks.handlers.clear()
  })

  it('sits flush left of a home at the bottom-right of the work area', async () => {
    const home = homeAt(mocks.workArea.width - characterSize.width)
    const { floating } = setup(() => createManualAnchor(home).anchor)

    await floating.open()

    const chat = floating.getOpenWindow()!.getBounds()
    expect(chat.x + chat.width).toBe(home.x)
    expect(chat.y + chat.height).toBe(home.y + home.height)
    expect(floating.attentionSnapshot().window?.bounds).toEqual(chat)
  })

  it('sits flush left of a home in the middle of the bottom edge', async () => {
    const home = homeAt(548)
    const { floating } = setup(() => createManualAnchor(home).anchor)

    await floating.open()

    const chat = floating.getOpenWindow()!.getBounds()
    expect(chat).toEqual({ x: 548 - chatSize.width, y: home.y + home.height - chatSize.height, ...chatSize })
  })

  it('flips to the right of a home at the bottom-left, where the left side does not fit', async () => {
    const home = homeAt(100)
    const { floating } = setup(() => createManualAnchor(home).anchor)

    await floating.open()

    const chat = floating.getOpenWindow()!.getBounds()
    expect(chat.x).toBe(home.x + home.width)
    expect(chat.y + chat.height).toBe(home.y + home.height)
  })

  it('follows the home when it changes', async () => {
    const manual = createManualAnchor(homeAt(800))
    const { floating, onWindowChange } = setup(() => manual.anchor)
    await floating.open()
    const before = floating.getOpenWindow()!.getBounds()
    onWindowChange.mockClear()

    manual.moveTo(homeAt(1100))

    expect(floating.getOpenWindow()!.getBounds()).toEqual({ ...before, x: before.x + 300 })
    expect(onWindowChange).toHaveBeenCalled()
    expect(floating.attentionSnapshot().window?.bounds).toEqual(floating.getOpenWindow()!.getBounds())
  })

  it('reports an unfolded chat as shown even when showing it sends no show event', async () => {
    const { floating, onWindowChange } = setup(() => createManualAnchor(homeAt(800)).anchor)
    await floating.open()
    await floating.toggle()
    mocks.handlers.get(electronChatFloatingContentHidden)!()
    const window = floating.getOpenWindow()!
    expect(window.isVisible()).toBe(false)
    // A macOS child window can become visible without a `show` event.
    window.show = () => {
      Object.assign(window, { visible: true })
    }
    const seen: ReturnType<typeof floating.attentionSnapshot>[] = []
    onWindowChange.mockImplementation(() => seen.push(floating.attentionSnapshot()))

    await floating.toggle()

    expect(seen.at(-1)).toMatchObject({ folded: false, relocating: false, window: { shown: true } })
  })

  it('moves a shown chat to the other side once its content has folded away', async () => {
    const manual = createManualAnchor(homeAt(500))
    const { floating } = setup(() => manual.anchor)
    await floating.open()

    manual.moveTo(homeAt(100))
    expect(floating.attentionSnapshot().relocating).toBe(true)
    mocks.handlers.get(electronChatFloatingContentHidden)!()

    const chat = floating.getOpenWindow()!.getBounds()
    expect(floating.attentionSnapshot().relocating).toBe(false)
    expect(chat.x).toBe(100 + characterSize.width)
  })

  it('returns to the left side only with the return margin to spare', async () => {
    const manual = createManualAnchor(homeAt(chatSize.width))
    const { floating } = setup(() => manual.anchor)
    await floating.open()
    const sideOf = () => (floating.getOpenWindow()!.getBounds().x < chatSize.width ? 'left' : 'right')

    manual.moveTo(homeAt(chatSize.width - 40))
    mocks.handlers.get(electronChatFloatingContentHidden)!()
    expect(sideOf()).toBe('right')

    manual.moveTo(homeAt(chatSize.width + 10))
    expect(floating.attentionSnapshot().relocating).toBe(false)
    expect(sideOf()).toBe('right')

    manual.moveTo(homeAt(chatSize.width + 30))
    mocks.handlers.get(electronChatFloatingContentHidden)!()
    expect(sideOf()).toBe('left')
  })

  it('leaves the chat where it is while there is no rectangle to attach to', async () => {
    const manual = createManualAnchor(null)
    const { floating } = setup(() => manual.anchor)
    await floating.open()
    const before = floating.getOpenWindow()!.getBounds()

    manual.moveTo(null)

    expect(floating.getOpenWindow()!.getBounds()).toEqual(before)
    manual.moveTo(homeAt(800))
    expect(floating.getOpenWindow()!.getBounds().x).toBe(800 - chatSize.width)
  })

  it('switches anchors on a new placement and stops listening to the old one', async () => {
    const first = createManualAnchor(homeAt(800))
    const second = createManualAnchor(homeAt(1000))
    let current = first.anchor
    const { floating } = setup(() => current)
    await floating.open()
    expect(first.listenerCount()).toBe(1)

    current = second.anchor
    floating.applyPlacement()

    expect(first.listenerCount()).toBe(0)
    expect(second.listenerCount()).toBe(1)
    expect(floating.getOpenWindow()!.getBounds().x).toBe(1000 - chatSize.width)
  })
})

describe('character anchor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createSource(homeBounds: Rectangle | null) {
    const listeners = new Set<(placement: never) => void>()
    const placement = homeBounds && { displayId: '1', bounds: homeBounds, homeBounds }
    return {
      source: {
        getCharacterPlacement: () => placement as never,
        onCharacterPlacementChange: (listener: (placement: never) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      publish: () => listeners.forEach(listener => listener(undefined as never)),
      listenerCount: () => listeners.size,
    }
  }

  it('reports the home rectangle in whole pixels, and null before the first placement', () => {
    expect(createCharacterAnchor(createSource(null).source).getRect()).toBeNull()

    const { source } = createSource({ x: 547.6, y: 233.4, width: 155.5, height: 558.1 })
    expect(createCharacterAnchor(source).getRect()).toEqual({ x: 548, y: 233, width: 156, height: 558 })
  })

  it('tells a listener once, 100 ms after the last placement', () => {
    const { source, publish } = createSource(homeAt(500))
    const listener = vi.fn()
    createCharacterAnchor(source).onChange(listener)

    publish()
    vi.advanceTimersByTime(60)
    publish()
    vi.advanceTimersByTime(99)
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('drops a pending notification when it stops', () => {
    const { source, publish, listenerCount } = createSource(homeAt(500))
    const listener = vi.fn()
    const stop = createCharacterAnchor(source).onChange(listener)

    publish()
    stop()
    vi.advanceTimersByTime(500)

    expect(listener).not.toHaveBeenCalled()
    expect(listenerCount()).toBe(0)
  })
})
