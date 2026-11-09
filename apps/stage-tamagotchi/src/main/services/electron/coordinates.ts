import type { BrowserWindow, Display, Point, Rectangle } from 'electron'

import type { LinuxDesktopBridge, LinuxDesktopBridgeState } from '../linux-desktop'
import type { PointerSample } from '../linux-desktop/geometry/verification'

import { useLogg } from '@guiiai/logg'
import { acceptCursorReading } from '@proj-airi/stage-shared/host-capabilities'
import { app, BrowserWindow as ElectronBrowserWindow, screen } from 'electron'

import { findDominantDisplayArea } from '../../../shared/utils/electron/display'
import { OwnWindowBinder } from '../linux-desktop/geometry/binding'
import { mapDisplaysToOutputs } from '../linux-desktop/geometry/outputs'
import { coordinateOwners } from '../linux-desktop/geometry/ownership'
import { CoordinateVerifier } from '../linux-desktop/geometry/verification'
import { getCurrentHostCapabilities, reportLinuxDesktop, setPointerSampleSink } from './host-capabilities'

export type CoordinateWindow = Pick<BrowserWindow, 'getBounds'>

export type LinuxCoordinateBridge = Pick<LinuxDesktopBridge, 'backend' | 'ready' | 'cursor' | 'ownWindows' | 'outputs' | 'onCursor' | 'onOwnWindows' | 'onOutputs' | 'onState' | 'setCursorStreaming' | 'requestCursor'>

type OwnWindowEntry = NonNullable<ReturnType<LinuxCoordinateBridge['ownWindows']>>[number]

const log = useLogg('linux-desktop').useGlobalConfig()
const cursorLoops = new Set<object>()
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
    window.once('closed', () => {
      window.off('show', bind)
      window.off('focus', bindUnbound)
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
    void this.binder.bind(window).then(() => this.refresh())
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
      this.refresh()
    })
  }

  private onState(state: LinuxDesktopBridgeState) {
    if (state !== 'ready') {
      this.binder.clear()
      this.verifier.reset()
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
      if (bridgeRects)
        this.verifier.observeWindowOrigin(window, { x: entry.x, y: entry.y })
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
    case 'bridge':
      return linux?.bridge.cursor() ?? null
    case 'none':
      return null
  }
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
