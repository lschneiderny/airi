import type { LinuxDesktopBackend } from '@proj-airi/stage-shared/host-capabilities'
import type { Display, Rectangle } from 'electron'

import type { LinuxDesktopBridgeState } from '../linux-desktop'

import { EventEmitter } from 'node:events'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  switches: {} as Record<string, string>,
  windows: [] as unknown[],
  created: undefined as ((event: unknown, window: unknown) => void) | undefined,
  warn: vi.fn<(message: string) => void>(),
}))

const electronDisplays: Display[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 } as Display,
  { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, workArea: { x: 1920, y: 0, width: 1280, height: 720 }, scaleFactor: 1 } as Display,
]

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    commandLine: { getSwitchValue: (name: string) => host.switches[name] ?? '' },
    on: (event: string, listener: (event: unknown, window: unknown) => void) => {
      if (event === 'browser-window-created')
        host.created = listener
    },
    off: () => {
      host.created = undefined
    },
  },
  BrowserWindow: { getAllWindows: () => host.windows },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 7, y: 8 })),
    // A scale of 2 keeps X11 server pixels and DIP apart in assertions.
    screenToDipPoint: vi.fn((point: { x: number, y: number }) => ({ x: point.x / 2, y: point.y / 2 })),
    getAllDisplays: vi.fn(() => electronDisplays),
    getPrimaryDisplay: vi.fn(() => electronDisplays[0]),
    getDisplayMatching: vi.fn(() => electronDisplays[1]),
    getDisplayNearestPoint: vi.fn(() => electronDisplays[1]),
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({ warn: host.warn, log: vi.fn(), withError: () => ({ warn: vi.fn() }) }) }),
}))

interface Entry { id: string, pid: number, x: number, y: number, width: number, height: number, keepAbove: boolean, outputScale: number, caption: string }

class FakeBridge {
  state: LinuxDesktopBridgeState = 'ready'
  point: { x: number, y: number } | null = null
  own: Entry[] | null = []
  screens: Array<{ name: string, x: number, y: number, width: number, height: number, scale: number }> | null = [
    { name: 'DP-1', x: 0, y: 500, width: 1920, height: 1080, scale: 1 },
    { name: 'DP-2', x: 1920, y: 0, width: 1280, height: 720, scale: 1 },
  ]

  readonly setCursorStreaming = vi.fn(async (_on: boolean) => {})
  readonly requestCursor = vi.fn(async () => {})
  readonly setKeepAbove = vi.fn(async (_id: string, _on: boolean) => {})
  readonly placeWindow = vi.fn(async (_id: string, _rect: Rectangle) => {})
  private readonly events = new EventEmitter()
  constructor(readonly backend: LinuxDesktopBackend) {}
  ready() { return this.state === 'ready' }
  cursor() { return this.point }
  ownWindows() { return this.own }
  outputs() { return this.screens }
  onCursor(listener: (value: unknown) => void) { return this.subscribe('cursor', listener) }
  onOwnWindows(listener: (value: unknown) => void) { return this.subscribe('own', listener) }
  onOutputs(listener: (value: unknown) => void) { return this.subscribe('outputs', listener) }
  onState(listener: (value: unknown) => void) { return this.subscribe('state', listener) }
  pushCursor(point: { x: number, y: number } | null) {
    this.point = point
    this.events.emit('cursor', point)
  }

  pushOwn(own: Entry[] | null) {
    this.own = own
    this.events.emit('own', own)
  }

  setState(state: LinuxDesktopBridgeState) {
    this.state = state
    if (state !== 'ready') {
      this.pushOwn(null)
      this.pushCursor(null)
    }
    this.events.emit('state', state)
  }

  private subscribe(event: string, listener: (value: unknown) => void) {
    this.events.on(event, listener)
    return () => {
      this.events.off(event, listener)
    }
  }
}

class FakeWindow extends EventEmitter {
  title = 'AIRI'
  destroyed = false
  visible = true
  constructor(
    readonly electronBounds: Rectangle,
    readonly compositorRect: Rectangle,
    private readonly bridge: FakeBridge,
    readonly id: string,
  ) {
    super()
  }

  getTitle() { return this.title }
  setTitle(title: string) {
    this.title = title
    const others = (this.bridge.own ?? []).filter(entry => entry.id !== this.id)
    this.bridge.pushOwn([...others, { id: this.id, pid: 1, keepAbove: false, outputScale: 1, caption: title, ...this.compositorRect }])
  }

  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  getBounds() { return { ...this.electronBounds } }
  getSize() { return [this.electronBounds.width, this.electronBounds.height] }
  setBounds = vi.fn()
}

function flush() {
  return new Promise(resolve => setImmediate(resolve))
}

describe('coordinate provider', () => {
  let coordinates: typeof import('./coordinates')
  let capabilities: typeof import('./host-capabilities')
  let electron: typeof import('electron')
  let detach: (() => void) | undefined

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    host.switches = {}
    host.windows = []
    host.created = undefined
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    capabilities = await import('./host-capabilities')
    coordinates = await import('./coordinates')
    electron = await import('electron')
  })

  afterEach(() => {
    detach?.()
    detach = undefined
    vi.unstubAllEnvs()
  })

  function session(name: 'linux-x11' | 'linux-xwayland' | 'linux-wayland') {
    if (name === 'linux-x11') {
      vi.stubEnv('WAYLAND_DISPLAY', '')
      vi.stubEnv('XDG_SESSION_TYPE', 'x11')
    }
    if (name === 'linux-xwayland')
      host.switches['ozone-platform'] = 'x11'
  }

  function attach(bridge: FakeBridge, ...windows: FakeWindow[]) {
    host.windows = windows
    detach = coordinates.attachLinuxCoordinates(bridge as never)
  }

  function verify(backend: LinuxDesktopBackend) {
    capabilities.reportLinuxDesktop({ backend, bridge: 'ready', geometryVerified: true, cursorVerified: true })
  }

  describe('without a ready bridge', () => {
    it.each(['windows', 'macos', 'linux-x11', 'linux-xwayland', 'linux-wayland'] as const)('returns exactly what Electron returns, gated as today, on %s', (name) => {
      Object.assign(capabilities.getCurrentHostCapabilities(), capabilitiesForHost(name))
      const window = { getBounds: vi.fn(() => ({ x: 10, y: 20, width: 300, height: 400 })) }
      const cursorLive = name === 'windows' || name === 'macos' || name === 'linux-x11'
      const originLive = name !== 'linux-wayland'

      expect(coordinates.readCursor()).toEqual(cursorLive ? { x: 7, y: 8 } : null)
      expect(coordinates.readWindowRect(window)).toEqual(originLive ? { x: 10, y: 20, width: 300, height: 400 } : null)
      expect(coordinates.readDisplays()).toBe(electronDisplays)
      expect(coordinates.readPrimaryDisplay()).toBe(electronDisplays[0])
      expect(coordinates.displayForWindow(window)).toBe(originLive ? electronDisplays[1] : electronDisplays[0])
      expect(window.getBounds).toHaveBeenCalledTimes(originLive ? 2 : 0)
      expect(electron.screen.getCursorScreenPoint).toHaveBeenCalledTimes(cursorLive ? 1 : 0)
    })

    it('rechecks origin trust after status loss and recovery', () => {
      const snapshot = capabilities.getCurrentHostCapabilities()
      const getBounds = vi.fn(() => ({ x: 10, y: 20, width: 300, height: 400 }))
      Object.assign(snapshot, capabilitiesForHost('windows'))
      expect(coordinates.displayForWindow({ getBounds }).id).toBe(2)
      Object.assign(snapshot, capabilitiesForHost('linux-wayland'))
      expect(coordinates.displayForWindow({ getBounds }).id).toBe(1)
      expect(getBounds).toHaveBeenCalledTimes(1)
      Object.assign(snapshot, capabilitiesForHost('windows'))
      expect(coordinates.displayForWindow({ getBounds }).id).toBe(2)
      expect(electron.screen.getDisplayMatching).toHaveBeenCalledTimes(2)
    })

    it('ignores an attached bridge until it is ready', async () => {
      const bridge = new FakeBridge('kwin')
      bridge.state = 'starting'
      bridge.point = { x: 900, y: 500 }
      const window = new FakeWindow({ x: 1, y: 2, width: 300, height: 400 }, { x: 50, y: 60, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      capabilities.reportLinuxDesktop({ backend: 'kwin', bridge: 'starting' })
      await flush()
      expect(window.title).toBe('AIRI')
      expect(coordinates.readCursor()).toBeNull()
      expect(coordinates.readDisplays()).toBe(electronDisplays)
    })
  })

  describe('ownership rows with a ready bridge', () => {
    it('reads the X11 cursor from the server, in DIP, and keeps Electron geometry', async () => {
      session('linux-x11')
      const bridge = new FakeBridge('x11-ewmh')
      bridge.point = { x: 900, y: 500 }
      const window = new FakeWindow({ x: 1, y: 2, width: 300, height: 400 }, { x: 50, y: 60, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      verify('x11-ewmh')
      await flush()
      expect(window.title).toBe('AIRI')
      expect(coordinates.readCursor()).toEqual({ x: 450, y: 250 })
      expect(electron.screen.getCursorScreenPoint).not.toHaveBeenCalled()
      expect(coordinates.readWindowRect(window)).toEqual({ x: 1, y: 2, width: 300, height: 400 })
      expect(coordinates.readDisplays()).toBe(electronDisplays)
      expect(coordinates.readPrimaryDisplay()).toBe(electronDisplays[0])
    })

    it.each(['gnome', 'none'] as const)('leaves every %s reading byte-for-byte equal to Electron', async (backend) => {
      session('linux-x11')
      const bridge = new FakeBridge(backend)
      bridge.point = { x: 900, y: 500 }
      const window = new FakeWindow({ x: 1, y: 2, width: 300, height: 400 }, { x: 50, y: 60, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      verify(backend)
      await flush()
      expect(window.title).toBe('AIRI')
      // GNOME withholds the cursor by status; `none` reads Electron's native X11 cursor.
      expect(coordinates.readCursor()).toEqual(backend === 'gnome' ? null : { x: 7, y: 8 })
      expect(coordinates.readWindowRect(window)).toEqual({ x: 1, y: 2, width: 300, height: 400 })
      expect(coordinates.readDisplays()).toBe(electronDisplays)
      expect(coordinates.readPrimaryDisplay()).toBe(electronDisplays[0])
    })

    it.each(['kwin', 'hyprland'] as const)('reads the %s cursor and Electron geometry under XWayland', async (backend) => {
      session('linux-xwayland')
      const bridge = new FakeBridge(backend)
      bridge.point = { x: 900, y: 500 }
      const window = new FakeWindow({ x: 1, y: 2, width: 300, height: 400 }, { x: 50, y: 60, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      verify(backend)
      await flush()
      expect(coordinates.readCursor()).toEqual({ x: 900, y: 500 })
      expect(coordinates.readWindowRect(window)).toEqual({ x: 1, y: 2, width: 300, height: 400 })
      expect(coordinates.readDisplays()).toBe(electronDisplays)
      expect(electron.screen.getCursorScreenPoint).not.toHaveBeenCalled()
    })

    it.each(['kwin', 'hyprland'] as const)('reads every %s coordinate from the compositor on native Wayland', async (backend) => {
      const bridge = new FakeBridge(backend)
      bridge.point = { x: 900, y: 500 }
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      verify(backend)
      await flush()
      expect(window.title).toBe('AIRI')
      expect(coordinates.readCursor()).toEqual({ x: 900, y: 500 })
      expect(coordinates.readWindowRect(window)).toEqual({ x: 50, y: 560, width: 300, height: 400 })
      expect(coordinates.readDisplays().map(display => display.bounds)).toEqual([
        { x: 0, y: 500, width: 1920, height: 1080 },
        { x: 1920, y: 0, width: 1280, height: 720 },
      ])
      expect(coordinates.readPrimaryDisplay().bounds).toEqual({ x: 0, y: 500, width: 1920, height: 1080 })
      expect(coordinates.displayMatching({ x: 1930, y: 10, width: 100, height: 100 }).id).toBe(2)
      expect(coordinates.displayNearestPoint({ x: 5000, y: 600 }).id).toBe(2)
      expect(coordinates.displayForWindow(window).id).toBe(1)
      expect(electron.screen.getDisplayMatching).not.toHaveBeenCalled()
      expect(electron.screen.getDisplayNearestPoint).not.toHaveBeenCalled()
    })

    it.each([
      ['linux-xwayland', { x: 1, y: 2, width: 300, height: 400 }, electronDisplays[0]!.bounds],
      ['linux-wayland', { x: 50, y: 560, width: 300, height: 400 }, { x: 0, y: 500, width: 1920, height: 1080 }],
    ] as const)('reads no sway cursor on %s and the owner geometry', async (name, rect, primary) => {
      if (name === 'linux-xwayland')
        session(name)
      const bridge = new FakeBridge('sway')
      bridge.point = { x: 900, y: 500 }
      const window = new FakeWindow({ x: 1, y: 2, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      capabilities.reportLinuxDesktop({ backend: 'sway', bridge: 'ready', geometryVerified: true })
      await flush()
      Object.assign(capabilities.getCurrentHostCapabilities().signals, { cursorScreenPoint: { kind: 'live' } })
      expect(coordinates.readCursor()).toBeNull()
      expect(coordinates.readWindowRect(window)).toEqual(rect)
      expect(coordinates.readPrimaryDisplay().bounds).toEqual(primary)
    })

    it('never trusts geometry from an unbound window, even while the origin is live', async () => {
      const bridge = new FakeBridge('kwin')
      const bound = new FakeWindow({ x: 0, y: 0, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, 'w1')
      const unbound = new FakeWindow({ x: 0, y: 0, width: 640, height: 480 }, { x: 900, y: 600, width: 640, height: 480 }, bridge, 'w2')
      unbound.setTitle = vi.fn()
      attach(bridge, bound, unbound)
      verify('kwin')
      await flush()
      expect(coordinates.readWindowRect(bound)).toEqual({ x: 50, y: 560, width: 300, height: 400 })
      expect(coordinates.readWindowRect(unbound)).toBeNull()
      expect(coordinates.readRendererWindowBounds(unbound)).toBeNull()
      capabilities.reportLinuxDesktop({ geometryVerified: false })
      // Before the origin is live, renderers get Electron bounds and ignore their origin, as they do today.
      expect(coordinates.readRendererWindowBounds(unbound)).toEqual({ x: 0, y: 0, width: 640, height: 480 })
    })

    it('keeps Electron displays and withholds geometry when the outputs do not map', async () => {
      const bridge = new FakeBridge('kwin')
      bridge.screens = [{ name: 'DP-1', x: 0, y: 0, width: 2560, height: 1440, scale: 1 }]
      const window = new FakeWindow({ x: 0, y: 0, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      capabilities.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready' })
      await flush()
      expect(coordinates.readDisplays()).toBe(electronDisplays)
      expect(capabilities.getCurrentHostCapabilities().signals.windowOrigin).toEqual({ kind: 'unavailable', reason: 'linux-geometry-verifying' })
    })
  })

  describe('verification', () => {
    async function verifiedSession() {
      const bridge = new FakeBridge('kwin')
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 800, y: 400, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      capabilities.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready' })
      await flush()
      bridge.pushCursor({ x: 100, y: 100 })
      bridge.pushCursor({ x: 900, y: 500 })
      return { bridge, window, signals: () => capabilities.getCurrentHostCapabilities().signals }
    }

    it('grants geometry from a bound window and the cursor from two distinct positions', async () => {
      const bridge = new FakeBridge('kwin')
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 800, y: 400, width: 300, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      capabilities.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready' })
      const signals = () => capabilities.getCurrentHostCapabilities().signals
      await flush()
      expect(signals().windowOrigin).toEqual({ kind: 'live' })
      expect(signals().displayOrigins).toEqual({ kind: 'live' })
      expect(signals().cursorScreenPoint).toEqual({ kind: 'unavailable', reason: 'linux-cursor-verifying' })
      bridge.pushCursor({ x: 100, y: 100 })
      bridge.pushCursor({ x: 100, y: 100 })
      expect(signals().cursorScreenPoint.kind).toBe('unavailable')
      bridge.pushCursor({ x: 900, y: 500 })
      expect(signals().cursorScreenPoint).toEqual({ kind: 'live' })
      expect(coordinates.readCursor()).toEqual({ x: 900, y: 500 })
    })

    it('does not grant geometry when the compositor size differs from Electron by more than a pixel', async () => {
      const bridge = new FakeBridge('kwin')
      const window = new FakeWindow({ x: 0, y: 0, width: 300, height: 400 }, { x: 800, y: 400, width: 302, height: 400 }, bridge, 'w1')
      attach(bridge, window)
      capabilities.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready' })
      await flush()
      expect(capabilities.getCurrentHostCapabilities().signals.windowOrigin.kind).toBe('unavailable')
    })

    it('keeps a resting pointer live and accepts matching samples', async () => {
      const { window, signals } = await verifiedSession()
      coordinates.recordPointerSample(window as never, { clientX: 100, clientY: 100, atMs: Date.now() })
      coordinates.recordPointerSample(window as never, { clientX: 101, clientY: 99, atMs: Date.now() })
      expect(signals().cursorScreenPoint).toEqual({ kind: 'live' })
      expect(coordinates.readCursor()).toEqual({ x: 900, y: 500 })
      expect(host.warn).not.toHaveBeenCalled()
    })

    it('revokes both facts on two offset samples, logs, and needs a new handshake', async () => {
      const { bridge, window, signals } = await verifiedSession()
      coordinates.recordPointerSample(window as never, { clientX: 140, clientY: 100, atMs: Date.now() })
      expect(signals().windowOrigin).toEqual({ kind: 'live' })
      coordinates.recordPointerSample(window as never, { clientX: 140, clientY: 100, atMs: Date.now() })
      expect(signals().windowOrigin).toEqual({ kind: 'unavailable', reason: 'linux-geometry-verifying' })
      expect(signals().cursorScreenPoint).toEqual({ kind: 'unavailable', reason: 'linux-cursor-verifying' })
      expect(host.warn).toHaveBeenCalledWith('linux-desktop: coordinate mismatch revoked verification')
      bridge.pushOwn([...bridge.own!])
      expect(signals().windowOrigin.kind).toBe('unavailable')
      expect(coordinates.readWindowRect(window)).toBeNull()
      window.emit('focus')
      await flush()
      expect(signals().windowOrigin).toEqual({ kind: 'live' })
    })

    it('rebinds every visible window after a revocation before geometry is granted again', async () => {
      const bridge = new FakeBridge('kwin')
      const main = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 800, y: 400, width: 300, height: 400 }, bridge, 'w1')
      const caption = new FakeWindow({ x: 10, y: 20, width: 480, height: 180 }, { x: 1200, y: 900, width: 480, height: 180 }, bridge, 'w2')
      attach(bridge, main, caption)
      capabilities.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready' })
      await flush()
      bridge.pushCursor({ x: 100, y: 100 })
      bridge.pushCursor({ x: 900, y: 500 })
      const signals = () => capabilities.getCurrentHostCapabilities().signals
      expect(coordinates.readWindowRect(caption)).toEqual({ x: 1200, y: 900, width: 480, height: 180 })

      coordinates.recordPointerSample(main as never, { clientX: 140, clientY: 100, atMs: Date.now() })
      coordinates.recordPointerSample(main as never, { clientX: 140, clientY: 100, atMs: Date.now() })
      expect(signals().windowOrigin.kind).toBe('unavailable')
      expect(coordinates.readRendererWindowBounds(caption)).toEqual({ x: 10, y: 20, width: 480, height: 180 })

      // Only the main window regains focus; the caption is neither shown nor focused again.
      main.emit('focus')
      expect(signals().windowOrigin.kind).toBe('unavailable')
      await flush()
      expect(signals().windowOrigin).toEqual({ kind: 'live' })
      expect(coordinates.readWindowRect(main)).toEqual({ x: 800, y: 400, width: 300, height: 400 })
      expect(coordinates.readWindowRect(caption)).toEqual({ x: 1200, y: 900, width: 480, height: 180 })
      expect(coordinates.readRendererWindowBounds(caption)).toEqual({ x: 1200, y: 900, width: 480, height: 180 })
    })

    it.each([
      { clientX: Number.NaN, clientY: 0, atMs: 0 },
      { clientX: 0, clientY: Number.POSITIVE_INFINITY, atMs: 0 },
      { clientX: 0, clientY: 0 },
      null,
      'pointer',
    ])('ignores a malformed renderer sample %j', async (sample) => {
      const { window, signals } = await verifiedSession()
      coordinates.recordPointerSample(window as never, sample as never)
      coordinates.recordPointerSample(window as never, sample as never)
      expect(signals().windowOrigin).toEqual({ kind: 'live' })
    })

    it('clears the cursor, bindings and facts when the compositor restarts', async () => {
      const { bridge, window, signals } = await verifiedSession()
      bridge.setState('starting')
      capabilities.reportLinuxDesktop({ bridge: 'starting' })
      expect(coordinates.readCursor()).toBeNull()
      bridge.setState('ready')
      capabilities.reportLinuxDesktop({ bridge: 'ready' })
      await flush()
      expect(signals().windowOrigin).toEqual({ kind: 'live' })
      expect(signals().cursorScreenPoint.kind).toBe('unavailable')
      expect(coordinates.readWindowRect(window)).toEqual({ x: 800, y: 400, width: 300, height: 400 })
    })
  })

  describe('cursor streaming', () => {
    it('streams while at least one cursor loop runs, including rapid toggles', async () => {
      const bridge = new FakeBridge('kwin')
      attach(bridge)
      expect(bridge.setCursorStreaming.mock.calls).toEqual([[false]])
      bridge.setCursorStreaming.mockClear()
      const first = {}
      const second = {}
      coordinates.setCursorLoopActive(first, true)
      coordinates.setCursorLoopActive(second, true)
      coordinates.setCursorLoopActive(first, true)
      expect(bridge.setCursorStreaming.mock.calls).toEqual([[true]])
      coordinates.setCursorLoopActive(first, false)
      expect(bridge.setCursorStreaming.mock.calls).toEqual([[true]])
      for (let index = 0; index < 5; index++) {
        coordinates.setCursorLoopActive(second, false)
        coordinates.setCursorLoopActive(second, true)
      }
      coordinates.setCursorLoopActive(second, false)
      expect(bridge.setCursorStreaming.mock.calls.at(-1)).toEqual([false])
      expect(bridge.setCursorStreaming.mock.calls.filter(([on]) => on)).toHaveLength(6)
    })

    it('requests streaming again when a restarted bridge becomes ready, and never while it is not', () => {
      const bridge = new FakeBridge('kwin')
      bridge.state = 'starting'
      attach(bridge)
      coordinates.setCursorLoopActive({}, true)
      expect(bridge.setCursorStreaming).not.toHaveBeenCalled()
      bridge.setState('ready')
      expect(bridge.setCursorStreaming.mock.calls).toEqual([[true]])
    })

    it('is a no-op without a Linux bridge', () => {
      expect(() => coordinates.setCursorLoopActive({}, true)).not.toThrow()
    })
  })

  describe('kwin actuators', () => {
    const rect = { x: 200, y: 200, width: 300, height: 400 }

    function setKeepAboveOnPush(bridge: FakeBridge, value: (on: boolean) => boolean) {
      bridge.setKeepAbove.mockImplementation(async (id, on) => {
        bridge.pushOwn((bridge.own ?? []).map(entry => entry.id === id ? { ...entry, keepAbove: value(on) } : entry))
      })
    }

    async function boundKwinWindow() {
      const bridge = new FakeBridge('kwin')
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, '{w1}')
      attach(bridge, window)
      verify('kwin')
      await flush()
      return { bridge, window }
    }

    function alwaysOnTop() {
      return capabilities.getCurrentHostCapabilities().signals.alwaysOnTop
    }

    it('writes keep-above on the bound window and turns alwaysOnTop live once KWin shows it', async () => {
      const { bridge, window } = await boundKwinWindow()
      setKeepAboveOnPush(bridge, on => on)
      expect(alwaysOnTop()).toEqual({ kind: 'unavailable', reason: 'linux-keep-above-verifying' })
      coordinates.requestKeepAbove(window, true)
      await flush()
      expect(bridge.setKeepAbove).toHaveBeenCalledExactlyOnceWith('{w1}', true)
      expect(alwaysOnTop()).toEqual({ kind: 'live' })
    })

    it('applies a keep-above request made before binding once the window is bound', async () => {
      const bridge = new FakeBridge('kwin')
      bridge.state = 'starting'
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, '{w1}')
      attach(bridge, window)
      coordinates.requestKeepAbove(window, true)
      expect(bridge.setKeepAbove).not.toHaveBeenCalled()
      verify('kwin')
      bridge.setState('ready')
      await flush()
      expect(bridge.setKeepAbove).toHaveBeenCalledExactlyOnceWith('{w1}', true)
    })

    it('keeps alwaysOnTop verifying when KWin does not show the requested value within 1 s', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const { bridge, window } = await boundKwinWindow()
        setKeepAboveOnPush(bridge, () => false)
        coordinates.requestKeepAbove(window, true)
        await flush()
        vi.advanceTimersByTime(1000)
        expect(alwaysOnTop()).toEqual({ kind: 'unavailable', reason: 'linux-keep-above-verifying' })
        expect(capabilities.getCurrentHostCapabilities()).toMatchObject({ signals: { alwaysOnTop: { kind: 'unavailable' } } })
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('revokes a verified keep-above when a later request fails', async () => {
      const { bridge, window } = await boundKwinWindow()
      setKeepAboveOnPush(bridge, on => on)
      coordinates.requestKeepAbove(window, true)
      await flush()
      expect(alwaysOnTop()).toEqual({ kind: 'live' })
      bridge.setKeepAbove.mockRejectedValueOnce(new Error('refused'))
      coordinates.requestKeepAbove(window, false)
      await flush()
      expect(alwaysOnTop()).toEqual({ kind: 'unavailable', reason: 'linux-keep-above-verifying' })
    })

    it('applies only the latest keep-above value when requests arrive while one runs', async () => {
      const { bridge, window } = await boundKwinWindow()
      const gate = Promise.withResolvers<void>()
      bridge.setKeepAbove.mockImplementationOnce(() => gate.promise)
      for (const on of [true, false, true, false])
        coordinates.requestKeepAbove(window, on)
      gate.resolve()
      await flush()
      await flush()
      expect(bridge.setKeepAbove.mock.calls).toEqual([['{w1}', true], ['{w1}', false]])
    })

    it.each([
      ['hyprland on native Wayland', 'linux-wayland', 'hyprland'],
      ['kwin under XWayland', 'linux-xwayland', 'kwin'],
    ] as const)('leaves keep-above and placement to Electron for %s', async (_name, name, backend) => {
      session(name)
      const bridge = new FakeBridge(backend)
      const window = new FakeWindow({ x: 50, y: 560, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, '{w1}')
      attach(bridge, window)
      verify(backend)
      await flush()
      coordinates.requestKeepAbove(window, true)
      expect(coordinates.placeOwnWindow(window, rect)).toBe(false)
      await flush()
      expect(bridge.setKeepAbove).not.toHaveBeenCalled()
      expect(bridge.placeWindow).not.toHaveBeenCalled()
    })

    it('places a bound window through KWin only while the origin is live', async () => {
      const { bridge, window } = await boundKwinWindow()
      expect(coordinates.placeOwnWindow(window, rect)).toBe(true)
      await flush()
      expect(bridge.placeWindow).toHaveBeenCalledExactlyOnceWith('{w1}', rect)
      capabilities.reportLinuxDesktop({ geometryVerified: false })
      expect(coordinates.placeOwnWindow(window, rect)).toBe(false)
    })

    it('never places a window that has not proved its compositor identity', async () => {
      const { bridge } = await boundKwinWindow()
      const stranger = { getBounds: () => rect, setBounds: vi.fn() }
      expect(coordinates.placeOwnWindow(stranger, rect)).toBe(false)
      await flush()
      expect(bridge.placeWindow).not.toHaveBeenCalled()
    })

    it('drops a queued placement for a window that closed before it ran', async () => {
      const { bridge, window } = await boundKwinWindow()
      const gate = Promise.withResolvers<void>()
      bridge.placeWindow.mockImplementationOnce(() => gate.promise)
      coordinates.placeOwnWindow(window, rect)
      coordinates.placeOwnWindow(window, { ...rect, x: 300 })
      window.destroyed = true
      window.emit('closed')
      gate.resolve()
      await flush()
      expect(bridge.placeWindow).toHaveBeenCalledOnce()
    })

    it('applies a placement requested before binding once the window proves its identity', async () => {
      const bridge = new FakeBridge('kwin')
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, '{w1}')
      window.visible = false
      attach(bridge, window)
      verify('kwin')
      await flush()
      expect(coordinates.placeOwnWindow(window, rect)).toBe(false)
      expect(bridge.placeWindow).not.toHaveBeenCalled()
      window.visible = true
      window.emit('show')
      await flush()
      expect(bridge.placeWindow).toHaveBeenCalledExactlyOnceWith('{w1}', rect)
    })

    it('holds rectangle notifications until KWin shows the requested placement', async () => {
      const bridge = new FakeBridge('kwin')
      const window = new FakeWindow({ x: 1796, y: 420, width: 300, height: 400 }, { x: 50, y: 560, width: 300, height: 400 }, bridge, '{w1}')
      window.visible = false
      attach(bridge, window)
      verify('kwin')
      await flush()
      const listener = vi.fn()
      coordinates.onCompositorWindowRect(window, listener)
      coordinates.placeOwnWindow(window, rect)
      window.visible = true
      window.emit('show')
      await flush()
      expect(listener).not.toHaveBeenCalled()
      bridge.pushOwn((bridge.own ?? []).map(entry => ({ ...entry, ...rect })))
      expect(listener).toHaveBeenCalledOnce()
      expect(coordinates.readWindowRect(window)).toEqual(rect)
    })

    it('reports no stale rectangle after KWin never shows the requested placement', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const { window } = await boundKwinWindow()
        const listener = vi.fn()
        coordinates.onCompositorWindowRect(window, listener)
        coordinates.placeOwnWindow(window, rect)
        await flush()
        expect(listener).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1000)
        expect(listener).not.toHaveBeenCalled()
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('notifies listeners when the compositor reports a new rectangle for a bound window', async () => {
      const { bridge, window } = await boundKwinWindow()
      const listener = vi.fn()
      const off = coordinates.onCompositorWindowRect(window, listener)
      bridge.pushOwn((bridge.own ?? []).map(entry => ({ ...entry })))
      expect(listener).not.toHaveBeenCalled()
      bridge.pushOwn((bridge.own ?? []).map(entry => ({ ...entry, x: 200, y: 200 })))
      expect(listener).toHaveBeenCalledOnce()
      off()
      bridge.pushOwn((bridge.own ?? []).map(entry => ({ ...entry, x: 210 })))
      expect(listener).toHaveBeenCalledOnce()
    })
  })
})
