import type { Point } from 'electron'

import { EventEmitter } from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { cursorScreenPoint, electron, hostCapabilitiesChanged, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { screen } from 'electron'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { emitAppBeforeQuit, emitAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { getCurrentHostCapabilities } from './host-capabilities'
import { createScreenService } from './screen'

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => '' } },
  screen: {
    getCursorScreenPoint: vi.fn(),
    dipToScreenPoint: vi.fn((point: Point) => ({ x: point.x * 2, y: point.y * 2 })),
    screenToDipPoint: vi.fn((point: Point) => ({ x: point.x / 2, y: point.y / 2 })),
  },
}))

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
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('windows'))
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

  it('invalidates a cached point once on a runtime change without waiting for a tick, then resumes the same point', async () => {
    const caps = getCurrentHostCapabilities()
    const { sent, tick, context, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })
    await startLoop()
    await tick()

    Object.assign(caps, capabilitiesForHost('linux-xwayland'))
    await context.emit(hostCapabilitiesChanged, caps)
    expect(sent).toEqual([{ x: 10, y: 20 }, null])
    await context.emit(hostCapabilitiesChanged, caps)
    await tick()
    expect(sent).toEqual([{ x: 10, y: 20 }, null])

    Object.assign(caps, capabilitiesForHost('windows'))
    await context.emit(hostCapabilitiesChanged, caps)
    await tick()
    await tick()
    expect(sent).toEqual([{ x: 10, y: 20 }, null, { x: 10, y: 20 }])
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

  it.each(['closed', 'before-quit', 'all-closed'])('stops capability invalidation after %s', async (event) => {
    const { sent, tick, window, context, startLoop } = setupScreen()
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 10, y: 20 })
    await startLoop()
    await tick()

    if (event === 'closed')
      window.emit('closed')
    else if (event === 'before-quit')
      await emitAppBeforeQuit()
    else
      await emitAppWindowAllClosed()
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
    await context.emit(hostCapabilitiesChanged, getCurrentHostCapabilities())

    expect(sent).toEqual([{ x: 10, y: 20 }])
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
