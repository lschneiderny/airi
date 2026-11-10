import type { BrowserWindow, Display, Point, Rectangle } from 'electron'

import type { LinuxDesktopBridge, LinuxDesktopBridgeState } from '../linux-desktop'
import type { PointerSample } from '../linux-desktop/geometry/verification'

import { useLogg } from '@guiiai/logg'
import { acceptCursorReading } from '@proj-airi/stage-shared/host-capabilities'
import { app, BrowserWindow as ElectronBrowserWindow, screen } from 'electron'

import { findDominantDisplayArea } from '../../../shared/utils/electron/display'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { KeepAboveVerifier, LatestValueActuator } from '../linux-desktop/geometry/actuators'
import { OwnWindowBinder } from '../linux-desktop/geometry/binding'
import { mapDisplaysToOutputs } from '../linux-desktop/geometry/outputs'
import { coordinateOwners } from '../linux-desktop/geometry/ownership'
import { CoordinateVerifier } from '../linux-desktop/geometry/verification'
import { getCurrentHostCapabilities, reportLinuxDesktop, setPointerSampleSink } from './host-capabilities'

export type CoordinateWindow = Pick<BrowserWindow, 'getBounds'>

export type LinuxCoordinateBridge = Pick<LinuxDesktopBridge, 'backend' | 'ready' | 'cursor' | 'ownWindows' | 'outputs' | 'onCursor' | 'onOwnWindows' | 'onOutputs' | 'onState' | 'setCursorStreaming' | 'requestCursor' | 'setKeepAbove' | 'placeWindow'>

type OwnWindowEntry = NonNullable<ReturnType<LinuxCoordinateBridge['ownWindows']>>[number]

const log = useLogg('linux-desktop').useGlobalConfig()
const cursorLoops = new Set<object>()
const rectListeners = new WeakMap<object, Set<() => void>>()
const placementSettleMs = 1000
let linux: LinuxCoordinates | undefined

function owners() {
  return coordinateOwners(getCurrentHostCapabilities().host, linux?.bridge.ready() ? linux.bridge.backend : null)
}

/**
 * Owns the Linux bridge's part of the coordinate contract: which compositor
 * window is which AIRI window, the display mapping, and the verification
 * facts. Facts live only in this process.
 */
class LinuxCoordinates {
  private readonly windows = new Set<BrowserWindow>()
  private readonly verifier = new CoordinateVerifier({
    report: patch => reportLinuxDesktop(patch),
    log: message => log.warn(message),
    now: () => Date.now(),
  })

  private readonly binder: OwnWindowBinder<BrowserWindow, OwnWindowEntry>
  private readonly disposers: Array<() => void> = []
  /** The last keep-above value each window asked for, applied again whenever the window (re)binds. */
  private readonly keepAboveWanted = new WeakMap<object, boolean>()
  private readonly keepAbove = new KeepAboveVerifier({ report: verified => reportLinuxDesktop({ keepAboveVerified: verified }) })
  private readonly keepAboveActuator = new LatestValueActuator<BrowserWindow, boolean>({
    apply: (window, on) => this.applyKeepAbove(window, on),
    onError: error => log.withError(error).warn('linux-desktop: keep-above request failed'),
  })

  private readonly placer = new LatestValueActuator<BrowserWindow, Rectangle>({
    apply: (window, rect) => this.applyPlacement(window, rect),
    onError: error => log.withError(error).warn('linux-desktop: placement request failed'),
  })

  private readonly lastRects = new WeakMap<BrowserWindow, string>()
  /** Placements asked for before the window proved its compositor identity; applied when it binds. */
  private readonly deferredPlacements = new WeakMap<BrowserWindow, Rectangle>()
  /** The rectangle a placement asked for; rectangle listeners wait for it, so an interim one is never persisted. */
  private readonly placementTargets = new WeakMap<BrowserWindow, { rect: Rectangle, timer: ReturnType<typeof setTimeout> }>()
  /** Set by a revocation: the next show or focus proves every visible window again, not just that one. */
  private rebindAll = false
  /** A batch of handshakes in flight; geometry is not granted until every one of them settles. */
  private batch: object | undefined

  constructor(readonly bridge: LinuxCoordinateBridge) {
    this.binder = new OwnWindowBinder<BrowserWindow, OwnWindowEntry>({ source: bridge })
    const onCreated = (_event: unknown, window: BrowserWindow) => this.track(window)
    const refresh = () => this.refresh()
    app.on('browser-window-created', onCreated)
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'] as const)
      screen.on(event as 'display-added', refresh)
    this.disposers.push(
      () => app.off('browser-window-created', onCreated),
      () => {
        for (const event of ['display-added', 'display-removed', 'display-metrics-changed'] as const)
          screen.off(event as 'display-added', refresh)
      },
      bridge.onOwnWindows(refresh),
      bridge.onOwnWindows(windows => this.keepAbove.observe(windows)),
      bridge.onOutputs(refresh),
      bridge.onCursor(point => this.verifier.observeCursor(point)),
      bridge.onState(state => this.onState(state)),
      () => this.binder.dispose(),
    )
    for (const window of ElectronBrowserWindow.getAllWindows())
      this.track(window)
    if (bridge.ready())
      this.onState('ready')
  }

  dispose() {
    for (const dispose of this.disposers.splice(0))
      dispose()
  }

  entryFor(window: CoordinateWindow): OwnWindowEntry | undefined {
    return this.windows.has(window as BrowserWindow) ? this.binder.entryFor(window as BrowserWindow) : undefined
  }

  mappedDisplays(): Display[] | null {
    return mapDisplaysToOutputs(screen.getAllDisplays(), this.bridge.outputs() ?? [])
  }

  syncCursorStreaming() {
    if (!this.bridge.ready())
      return
    this.bridge.setCursorStreaming(cursorLoops.size > 0).catch((error: unknown) => {
      log.withError(error).warn('linux-desktop: cursor streaming request failed')
    })
  }

  requestKeepAbove(window: object, on: boolean) {
    this.keepAboveWanted.set(window, on)
    if (this.kwinTarget(window))
      this.keepAboveActuator.submit(window as BrowserWindow, on)
  }

  placeOwnWindow(window: object, rect: Rectangle): boolean {
    if (!windowOriginTrusted() || !this.kwinRoute(window))
      return false
    const target = window as BrowserWindow
    if (!this.binder.entryFor(target)) {
      // Electron applies the size now; KWin moves the window once it proves its identity.
      this.deferredPlacements.set(target, rect)
      this.expectPlacement(target, rect)
      return false
    }
    this.deferredPlacements.delete(target)
    this.expectPlacement(target, rect)
    this.placer.submit(target, rect)
    return true
  }

  recordPointerSample(window: CoordinateWindow, sample: PointerSample) {
    if (!this.binds())
      return
    if (owners().windowRect === 'electron') {
      const { x, y } = window.getBounds()
      this.verifier.observeWindowOrigin(window, { x, y })
    }
    if (this.verifier.comparePointer(window, sample) === 'revoked') {
      // A disagreeing sample means the window identities or spaces are wrong; prove them again.
      this.binder.clear()
      this.rebindAll = true
    }
  }

  private binds() {
    const { backend } = this.bridge
    return this.bridge.ready() && (backend === 'kwin' || backend === 'sway' || backend === 'hyprland')
  }

  /**
   * The compositor id of a bound AIRI window that KWin actuators may write, or
   * `undefined`. Actuators run only on kwin in a native Wayland session, where
   * Electron cannot apply keep-above or a position itself.
   */
  private kwinTarget(window: object): string | undefined {
    return this.kwinRoute(window) ? this.binder.entryFor(window as BrowserWindow)?.id : undefined
  }

  private kwinRoute(window: object): boolean {
    if (!this.windows.has(window as BrowserWindow) || (window as BrowserWindow).isDestroyed())
      return false
    return this.bridge.ready() && this.bridge.backend === 'kwin' && getCurrentHostCapabilities().host === 'linux-wayland'
  }

  private expectPlacement(window: BrowserWindow, rect: Rectangle) {
    clearTimeout(this.placementTargets.get(window)?.timer)
    const timer = setTimeout(() => {
      if (this.placementTargets.get(window)?.timer !== timer)
        return
      this.placementTargets.delete(window)
      this.refresh()
    }, placementSettleMs)
    this.placementTargets.set(window, { rect, timer })
  }

  /** Runs once a window binds: actuator requests made before its identity was proved apply now. */
  private afterBind(window: BrowserWindow) {
    this.reapplyKeepAbove(window)
    const rect = this.deferredPlacements.get(window)
    if (rect && this.kwinTarget(window)) {
      this.deferredPlacements.delete(window)
      this.placer.submit(window, rect)
    }
  }

  private async applyKeepAbove(window: BrowserWindow, on: boolean) {
    // The binding may have ended while this request waited behind another one.
    const id = this.kwinTarget(window)
    if (!id)
      return
    this.keepAbove.expect(id, on)
    try {
      await this.bridge.setKeepAbove(id, on)
    }
    catch (error) {
      this.keepAbove.failed(id, on)
      throw error
    }
    this.keepAbove.applied(id, on, this.bridge.ownWindows())
  }

  private async applyPlacement(window: BrowserWindow, rect: Rectangle) {
    const id = this.kwinTarget(window)
    if (id)
      await this.bridge.placeWindow(id, rect)
  }

  private reapplyKeepAbove(window: BrowserWindow) {
    const on = this.keepAboveWanted.get(window)
    if (on !== undefined)
      this.requestKeepAbove(window, on)
  }

  private track(window: BrowserWindow) {
    if (this.windows.has(window))
      return
    this.windows.add(window)
    const bind = () => this.bind(window)
    const bindUnbound = () => {
      if (!this.binder.entryFor(window))
        this.bind(window)
    }
    window.on('show', bind)
    window.on('focus', bindUnbound)
    onWindowClosed(window, () => {
      window.off('show', bind)
      window.off('focus', bindUnbound)
      this.placer.cancel(window)
      this.keepAboveActuator.cancel(window)
      this.deferredPlacements.delete(window)
      clearTimeout(this.placementTargets.get(window)?.timer)
      this.placementTargets.delete(window)
      const entry = this.binder.entryFor(window)
      if (entry)
        this.keepAbove.forget(entry.id)
      rectListeners.delete(window)
      this.windows.delete(window)
      this.binder.unbind(window)
      this.verifier.forgetWindow(window)
      this.refresh()
    })
    if (window.isVisible())
      this.bind(window)
  }

  private bind(window: BrowserWindow) {
    if (!this.binds() || window.isDestroyed())
      return
    if (this.rebindAll) {
      this.bindVisible()
      return
    }
    void this.binder.bind(window).then((id) => {
      if (id)
        this.afterBind(window)
      this.refresh()
    })
  }

  private bindVisible() {
    this.rebindAll = false
    const visible = [...this.windows].filter(window => !window.isDestroyed() && window.isVisible())
    // Set before the first handshake: a compositor push during it must not grant early.
    const batch = {}
    this.batch = batch
    void Promise.allSettled(visible.map(window => this.binder.bind(window))).then(() => {
      if (this.batch === batch)
        this.batch = undefined
      for (const window of visible)
        this.afterBind(window)
      this.refresh()
    })
  }

  private onState(state: LinuxDesktopBridgeState) {
    if (state !== 'ready') {
      this.binder.clear()
      this.verifier.reset()
      this.keepAbove.reset()
      this.batch = undefined
      this.rebindAll = false
      return
    }
    this.syncCursorStreaming()
    if (this.binds())
      this.bindVisible()
  }

  private refresh() {
    if (!this.binds())
      return
    const bridgeRects = owners().windowRect === 'bridge'
    let sizeMatches = false
    for (const window of this.windows) {
      const entry = this.binder.entryFor(window)
      if (!entry || window.isDestroyed())
        continue
      if (bridgeRects) {
        this.verifier.observeWindowOrigin(window, { x: entry.x, y: entry.y })
        this.notifyRect(window, entry)
      }
      const { width, height } = window.getBounds()
      if (Math.abs(entry.width - width) <= 1 && Math.abs(entry.height - height) <= 1)
        sizeMatches = true
    }
    const displaysKnown = owners().displays === 'bridge'
      ? this.mappedDisplays() !== null
      : (this.bridge.outputs()?.length ?? 0) > 0
    // Displays that stop mapping revoke at once; a grant waits for the whole handshake batch.
    this.verifier.observeGeometry({ sizeMatches: sizeMatches && !this.batch, displaysKnown })
  }

  private notifyRect(window: BrowserWindow, rect: Rectangle) {
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`
    const target = this.placementTargets.get(window)
    if (target) {
      const wanted = target.rect
      if (key !== `${Math.round(wanted.x)},${Math.round(wanted.y)},${Math.round(wanted.width)},${Math.round(wanted.height)}`)
        return
      clearTimeout(target.timer)
      this.placementTargets.delete(window)
    }
    if (this.lastRects.get(window) === key)
      return
    this.lastRects.set(window, key)
    for (const listener of rectListeners.get(window) ?? [])
      listener()
  }
}

/**
 * Starts the Linux bridge's coordinate ownership and verification. Returns the
 * function that stops it. Call once, before the first window.
 */
export function attachLinuxCoordinates(bridge: LinuxCoordinateBridge): () => void {
  getCurrentHostCapabilities()
  const attached = new LinuxCoordinates(bridge)
  linux = attached
  setPointerSampleSink((window, sample) => recordPointerSample(window, sample))
  return () => {
    attached.dispose()
    if (linux === attached) {
      linux = undefined
      setPointerSampleSink(undefined)
    }
  }
}

/** Renderer samples cross a process boundary, so their shape is checked here. */
export function recordPointerSample(window: CoordinateWindow, sample: PointerSample) {
  if (typeof sample !== 'object' || sample === null)
    return
  const { clientX, clientY, atMs } = sample
  if (![clientX, clientY, atMs].every(value => typeof value === 'number' && Number.isFinite(value)))
    return
  linux?.recordPointerSample(window, { clientX, clientY, atMs })
}

/**
 * Asks the compositor to keep a window above others. Only kwin on native
 * Wayland acts on it, on the window's proved compositor id; the request is
 * remembered and applied again whenever the window binds.
 */
export function requestKeepAbove(window: object, on: boolean) {
  linux?.requestKeepAbove(window, on)
}

/**
 * Places a bound AIRI window through KWin when kwin on native Wayland owns a
 * live origin. Returns `false` when the caller must place it through Electron.
 */
export function placeOwnWindow(window: object, rect: Rectangle): boolean {
  return linux?.placeOwnWindow(window, rect) ?? false
}

/**
 * Calls `listener` when the compositor reports a new rectangle for the bound
 * window, including its first after binding. Electron emits no `move` there,
 * because it never learns a native Wayland window's position. Listeners end
 * when the window closes.
 */
export function onCompositorWindowRect(window: object, listener: () => void): () => void {
  const listeners = rectListeners.get(window) ?? new Set()
  rectListeners.set(window, listeners)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setCursorLoopActive(loop: object, active: boolean) {
  const before = cursorLoops.size
  if (active)
    cursorLoops.add(loop)
  else
    cursorLoops.delete(loop)
  if ((before === 0) !== (cursorLoops.size === 0))
    linux?.syncCursorStreaming()
}

/** One tick of the cursor loop: pull-based compositors read the cursor now; the result arrives through `onCursor`. */
export function requestBridgeCursor() {
  void linux?.bridge.requestCursor()
}

/** The global cursor from its owner, or `null` while the host cannot vouch for it. */
export function readCursor(): Point | null {
  if (!acceptCursorReading(getCurrentHostCapabilities().signals.cursorScreenPoint))
    return null
  switch (owners().cursor) {
    case 'electron':
      return screen.getCursorScreenPoint()
    case 'bridge': {
      const point = linux?.bridge.cursor() ?? null
      // X11 reports server pixels; Electron's window rectangles, which X11 keeps, are DIP.
      return point && linux?.bridge.backend === 'x11-ewmh' ? screen.screenToDipPoint(point) : point
    }
    case 'none':
      return null
  }
}

/**
 * Calls `listener` with each compositor cursor reading, ungated by verification, while a Linux bridge is attached.
 * Use it only as a sign that the user moves the pointer, never as a position. Returns the function that stops it.
 */
export function onCompositorCursor(listener: (point: Point | null) => void): () => void {
  return linux?.bridge.onCursor(listener) ?? (() => {})
}

/** Global positions are usable only while the host reports a live window origin. */
export function windowOriginTrusted(): boolean {
  return getCurrentHostCapabilities().signals.windowOrigin.kind === 'live'
}

/**
 * The window rectangle from its owner, or `null` while the origin is not live.
 * On compositor-owned rows a window that has not proved its identity also
 * reads `null`.
 */
export function readWindowRect(window: CoordinateWindow): Rectangle | null {
  if (!windowOriginTrusted())
    return null
  if (owners().windowRect === 'electron')
    return window.getBounds()
  const entry = linux?.entryFor(window)
  return entry ? { x: entry.x, y: entry.y, width: entry.width, height: entry.height } : null
}

/**
 * Bounds for a renderer. While the origin is not live, renderers receive
 * Electron's bounds and use only the size, as they always have. While it is
 * live, a window without a readable rectangle reads `null`; the bounds loop
 * forwards that, and the renderer drops its cached origin's availability.
 */
export function readRendererWindowBounds(window: CoordinateWindow): Rectangle | null {
  return windowOriginTrusted() ? readWindowRect(window) : window.getBounds()
}

export function readDisplays(): Display[] {
  if (owners().displays === 'electron')
    return screen.getAllDisplays()
  return linux?.mappedDisplays() ?? screen.getAllDisplays()
}

export function readPrimaryDisplay(): Display {
  const primary = screen.getPrimaryDisplay()
  if (owners().displays === 'electron')
    return primary
  return readDisplays().find(display => display.id === primary.id) ?? primary
}

function distanceToRect(point: Point, rect: Rectangle) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

export function displayNearestPoint(point: Point): Display {
  if (owners().displays === 'electron')
    return screen.getDisplayNearestPoint(point)
  const displays = readDisplays()
  return displays.reduce((best, display) => distanceToRect(point, display.bounds) < distanceToRect(point, best.bounds) ? display : best, displays[0]!)
}

/** The display that holds most of `rect`, or the one nearest its center when none does, like Electron's `getDisplayMatching`. */
export function displayMatching(rect: Rectangle): Display {
  if (owners().displays === 'electron')
    return screen.getDisplayMatching(rect)
  const overlapping = readDisplays().filter(({ bounds }) => rect.x < bounds.x + bounds.width && bounds.x < rect.x + rect.width
    && rect.y < bounds.y + bounds.height && bounds.y < rect.y + rect.height)
  return findDominantDisplayArea(rect, overlapping) ?? displayNearestPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
}

/** A hidden origin cannot identify the window's display. */
export function displayForWindow(window: CoordinateWindow): Display {
  const rect = readWindowRect(window)
  return rect ? displayMatching(rect) : readPrimaryDisplay()
}
