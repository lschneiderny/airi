import type { Point, Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { cursorScreenPoint, electron, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { screen } from 'electron'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { attachLinuxCoordinates } from './coordinates'
import { getCurrentHostCapabilities, reportLinuxDesktop } from './host-capabilities'
import { createScreenService } from './screen'

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => '' }, on: vi.fn(), off: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  screen: {
    on: vi.fn(),
    off: vi.fn(),
    getCursorScreenPoint: vi.fn(),
    dipToScreenPoint: vi.fn((point: Point) => ({ x: point.x * 2, y: point.y * 2 })),
    screenToDipPoint: vi.fn((point: Point) => ({ x: point.x / 2, y: point.y / 2 })),
    dipToScreenRect: vi.fn((_window: unknown, rect: Rectangle) => ({ ...rect, width: rect.width * 2 })),
    screenToDipRect: vi.fn((_window: unknown, rect: Rectangle) => ({ ...rect, width: rect.width / 2 })),
  },
}))

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>()
  return { default: { ...actual, platform: 'linux' } }
})

vi.mock('@proj-airi/electron-vueuse/main', () => ({
  createRendererLoop: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))

/** The window events and checks that the renderer loop reads. The window stays visible and alive. */
class FakeWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, isCrashed: () => false })
  isDestroyed() { return false }
  isVisible() { return true }
  getBounds() { return { x: 0, y: 0, width: 500, height: 500 } }
}

function setupScreen() {
  const context = createContext()
  const window = new FakeWindow()
  createScreenService({ context: context as never, window: window as never })
  onTestFinished(() => {
    window.emit('closed')
  })
  const sent: Array<Point | null | undefined> = []
  context.on(cursorScreenPoint, event => sent.push(event.body))
  const [loop] = vi.mocked(createRendererLoop).mock.calls.at(-1) ?? []
  if (!loop)
    throw new Error('Screen service did not register its renderer loop')
  return { sent, window, context, tick: loop.run, startLoop: defineInvoke(context, startLoopGetCursorScreenPoint) }
}

describe('screen service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WAYLAND_DISPLAY', '')
    vi.stubEnv('XDG_SESSION_TYPE', 'x11')
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('windows'))
  })

  it('resends the cursor when a status change invalidates the cached point', async () => {
    const { sent, tick, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })
    await startLoop()
    await tick()
    expect(sent).toEqual([{ x: 10, y: 20 }])
    reportLinuxDesktop({ lockSource: 'logind' })
    expect(getCurrentHostCapabilities().host).toBe('linux-x11')
    expect(sent).toEqual([{ x: 10, y: 20 }, { x: 10, y: 20 }])
  })

  it('streams the compositor cursor from the first started loop until the last one stops', async () => {
    const bridge = {
      backend: 'kwin' as const,
      ready: () => true,
      cursor: () => null,
      ownWindows: () => null,
      outputs: () => null,
      onCursor: () => () => {},
      onOwnWindows: () => () => {},
      onOutputs: () => () => {},
      onState: () => () => {},
      setCursorStreaming: vi.fn(async (_on: boolean) => {}),
      requestCursor: vi.fn(async () => {}),
      setKeepAbove: vi.fn(async () => {}),
      placeWindow: vi.fn(async () => {}),
    }
    const detach = attachLinuxCoordinates(bridge)
    onTestFinished(detach)
    bridge.setCursorStreaming.mockClear()
    const first = setupScreen()
    const second = setupScreen()
    await first.startLoop()
    await second.startLoop()
    await first.startLoop()
    expect(bridge.setCursorStreaming.mock.calls).toEqual([[true]])
    first.window.emit('closed')
    expect(bridge.setCursorStreaming.mock.calls).toEqual([[true]])
    second.window.webContents.emit('render-process-gone')
    expect(bridge.setCursorStreaming.mock.calls).toEqual([[true], [false]])
  })

  it('asks the compositor bridge for the cursor on each tick of a started loop', async () => {
    const bridge = {
      backend: 'hyprland' as const,
      ready: () => true,
      cursor: () => null,
      ownWindows: () => null,
      outputs: () => null,
      onCursor: () => () => {},
      onOwnWindows: () => () => {},
      onOutputs: () => () => {},
      onState: () => () => {},
      setCursorStreaming: vi.fn(async (_on: boolean) => {}),
      requestCursor: vi.fn(async () => {}),
      setKeepAbove: vi.fn(async () => {}),
      placeWindow: vi.fn(async () => {}),
    }
    const detach = attachLinuxCoordinates(bridge)
    onTestFinished(detach)
    const { tick, startLoop } = setupScreen()
    await startLoop()
    await tick()
    await tick()
    expect(bridge.requestCursor).toHaveBeenCalledTimes(2)
  })

  it.each(['windows', 'macos'] as const)('preserves exact live values and dedupe on %s, including a resting cursor', async (host) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))
    const { sent, tick, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })

    await startLoop()
    await tick()
    await tick()
    expect(sent).toEqual([{ x: 10, y: 20 }])

    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 11, y: 20 })
    await tick()
    await tick()
    expect(sent).toEqual([{ x: 10, y: 20 }, { x: 11, y: 20 }])

    // Live readings outside this window, including negative display coordinates, stay unchanged.
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: -100, y: 900 })
    await tick()
    await tick()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 0, y: 0 })
    await tick()
    await tick()
    expect(sent).toEqual([{ x: 10, y: 20 }, { x: 11, y: 20 }, { x: -100, y: 900 }, { x: 0, y: 0 }])
  })

  it('sends the same position again when a reloaded renderer starts the loop', async () => {
    const { sent, tick, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })
    await startLoop()
    await tick()

    await startLoop()
    await tick()

    expect(sent).toEqual([{ x: 10, y: 20 }, { x: 10, y: 20 }])
  })

  it('withholds a stale XWayland point inside the window after the pointer leaves for a native surface', async () => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-xwayland'))
    const { sent, tick, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })

    await startLoop()
    await tick()
    await tick()
    await tick()

    expect(sent).toEqual([null])
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled()
  })

  it('withholds a degraded cursor outside the window once', async () => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('web'))
    const { sent, tick, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: -800, y: 900 })

    await startLoop()
    await tick()
    await tick()

    expect(sent).toEqual([null])
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled()
  })

  it('resends withheld state when a renderer reloads', async () => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
    const { sent, tick, startLoop } = setupScreen()
    await startLoop()
    await tick()
    await tick()
    await startLoop()
    await tick()
    await tick()
    expect(sent).toEqual([null, null])
  })

  it('returns null from all three cursor invokes on native Wayland', async () => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
    const { context } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })

    await expect(defineInvoke(context, electron.screen.getCursorScreenPoint)()).resolves.toBeNull()
    await expect(defineInvoke(context, electron.screen.dipToScreenPoint)(undefined)).resolves.toBeNull()
    await expect(defineInvoke(context, electron.screen.screenToDipPoint)(undefined)).resolves.toBeNull()
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled()
  })

  it.each(['windows', 'linux-wayland'] as const)('uses only trusted bounds for omitted rectangle invokes on %s', async (host) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))
    const { context, window } = setupScreen()
    const getBounds = vi.spyOn(window, 'getBounds')
    const expected = host === 'windows' ? { x: 0, y: 0, width: 500, height: 500 } : null

    await expect(defineInvoke(context, electron.screen.dipToScreenRect)(undefined)).resolves.toEqual(expected)
    await expect(defineInvoke(context, electron.screen.screenToDipRect)(undefined)).resolves.toEqual(expected)
    expect(getBounds).toHaveBeenCalledTimes(host === 'windows' ? 2 : 0)

    const rect = { x: -10, y: 20, width: 300, height: 400 }
    await expect(defineInvoke(context, electron.screen.dipToScreenRect)(rect)).resolves.toEqual({ ...rect, width: 600 })
    await expect(defineInvoke(context, electron.screen.screenToDipRect)(rect)).resolves.toEqual({ ...rect, width: 150 })
  })

  it.each(['windows', 'macos'] as const)('keeps omitted-point invoke values identical on %s', async (host) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))
    const { context } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: -100, y: 900 })

    await expect(defineInvoke(context, electron.screen.getCursorScreenPoint)()).resolves.toEqual({ x: -100, y: 900 })
    await expect(defineInvoke(context, electron.screen.dipToScreenPoint)(undefined)).resolves.toEqual({ x: -100, y: 900 })
    await expect(defineInvoke(context, electron.screen.screenToDipPoint)(undefined)).resolves.toEqual({ x: -100, y: 900 })
    expect(screen.dipToScreenPoint).not.toHaveBeenCalled()
    expect(screen.screenToDipPoint).not.toHaveBeenCalled()
  })

  it.each(['windows', 'macos', 'linux-wayland'] as const)('keeps explicit point conversion on %s independent of cursor availability', async (host) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))
    const { context } = setupScreen()
    await expect(defineInvoke(context, electron.screen.dipToScreenPoint)({ x: 10, y: 20 })).resolves.toEqual({ x: 20, y: 40 })
    await expect(defineInvoke(context, electron.screen.screenToDipPoint)({ x: 10, y: 20 })).resolves.toEqual({ x: 5, y: 10 })
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled()
  })
})
