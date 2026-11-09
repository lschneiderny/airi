import type { LinuxDesktopBackend, LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import type { HyprlandMessage } from './backends/hyprland/protocol'
import type { HyprlandFailure } from './backends/hyprland/socket'
import type { KwinFailure } from './backends/kwin'
import type { KwinMessage } from './backends/kwin/protocol'
import type { SwayFailure } from './backends/sway'
import type { DbusTransport } from './dbus/transport'

import { EventEmitter } from 'node:events'

import { useLogg } from '@guiiai/logg'

import { HyprlandBackendError } from './backends/hyprland/socket'
import { KwinBackendError } from './backends/kwin'
import { SwayBackendError } from './backends/sway'
import { X11BackendError } from './backends/x11/binding'
import { BusySource } from './session/busy'
import { LockSource } from './session/lock'

type Active = Extract<KwinMessage, { method: 'Active' }>['payload']
type OwnWindow = NonNullable<Extract<KwinMessage | HyprlandMessage, { method: 'OwnWindows' }>['payload']>[number]
type OwnWindows = readonly OwnWindow[] | null
type Cursor = Extract<KwinMessage, { method: 'Cursor' }>['payload'] | null
type Outputs = Extract<KwinMessage, { method: 'Outputs' }>['payload'] | null
export type LinuxDesktopBridgeState = 'starting' | 'ready' | 'failed' | 'stopped'

export type BridgeMessage = KwinMessage | HyprlandMessage
export type BridgeFailure = KwinFailure | SwayFailure | HyprlandFailure | X11BackendError['reason']

export interface BridgeCallbacks {
  readonly onMessage: (message: BridgeMessage) => void
  readonly onFailure: (reason: BridgeFailure) => void
  readonly onState: (state: 'starting' | 'ready') => void
  readonly onCursorReset: () => void
}

/**
 * One compositor backend as the bridge drives it.
 *
 * Push backends deliver readings through `onMessage`. A pull backend (X11
 * EWMH) supplies `readActive`, which the bridge calls on each active-window
 * read. Every driver reports `ready` through `onState` once its first reading
 * is trustworthy.
 */
export interface DesktopDriver {
  start: () => Promise<void>
  stop: () => Promise<void>
  setCursorStreaming?: (on: boolean) => Promise<void>
  /** KWin only: trusted actuator source. */
  runOneShot?: (source: string) => Promise<void>
  readActive?: () => Active
}

function failureOf(error: unknown): BridgeFailure {
  if (error instanceof KwinBackendError || error instanceof SwayBackendError || error instanceof HyprlandBackendError)
    return error.bridgeFailure
  if (error instanceof X11BackendError)
    return error.reason
  return 'transport-failed'
}

function sameActive(left: Active, right: Active) {
  return left === right || (left !== null && right !== null && left.pid === right.pid && left.caption === right.caption
    && left.resourceClass === right.resourceClass && left.desktopFileName === right.desktopFileName && left.fullScreen === right.fullScreen)
}

interface BridgeOptions {
  readonly backend: LinuxDesktopBackend
  readonly connect: () => Promise<{ sessionBus: DbusTransport, systemBus: DbusTransport | null }>
  readonly openSessionBus: () => Promise<DbusTransport>
  readonly createBackend: (bus: DbusTransport, callbacks: BridgeCallbacks) => DesktopDriver | undefined
  readonly report: (patch: Partial<LinuxDesktopFacts>) => void
  readonly ownPids: () => readonly number[]
}

/** Owns the connections, backend and session sources for one app lifetime. */
export class LinuxDesktopBridge {
  readonly backend: LinuxDesktopBackend
  private readonly log = useLogg('linux-desktop').useGlobalConfig()
  private readonly events = new EventEmitter<{ active: [Active], own: [OwnWindows], cursor: [Cursor], outputs: [Outputs], lock: [boolean], state: [LinuxDesktopBridgeState] }>()
  private active: Active = null
  private own: OwnWindows = null
  private pointer: Cursor = null
  private screens: Outputs = null
  private status: LinuxDesktopBridgeState = 'starting'
  private cursorStreaming = false
  private driver: DesktopDriver | undefined
  private lock: LockSource | undefined
  private busy: BusySource | undefined
  private buses: { sessionBus: DbusTransport, systemBus: DbusTransport | null } | undefined
  private starting: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private generation = 0
  private running = false
  /** Pull drivers are read only between `ready` and the next failure, restart or stop. */
  private pullReady = false
  private api: string | undefined

  constructor(private readonly options: BridgeOptions) {
    this.backend = options.backend
  }

  activeWindow(): Active {
    const read = this.driver?.readActive
    if (read && this.pullReady) {
      const next = read()
      if (!sameActive(next, this.active)) {
        this.active = next
        this.events.emit('active', next)
      }
    }
    return this.active
  }

  ownWindows(): OwnWindows { return this.own }
  cursor(): Cursor { return this.pointer }
  outputs(): Outputs { return this.screens }
  /** Only a ready bridge owns readings; until then Electron's gated readings apply. */
  ready(): boolean { return this.status === 'ready' }
  busyHint(): 'busy' | 'quiet' | null { return this.busy?.hint() ?? null }
  onActive(listener: (value: Active) => void) {
    this.events.on('active', listener)
    return () => {
      this.events.off('active', listener)
    }
  }

  onOwnWindows(listener: (value: OwnWindows) => void) {
    this.events.on('own', listener)
    return () => {
      this.events.off('own', listener)
    }
  }

  onCursor(listener: (value: Cursor) => void) {
    this.events.on('cursor', listener)
    return () => {
      this.events.off('cursor', listener)
    }
  }

  onOutputs(listener: (value: Outputs) => void) {
    this.events.on('outputs', listener)
    return () => {
      this.events.off('outputs', listener)
    }
  }

  onState(listener: (state: LinuxDesktopBridgeState) => void) {
    this.events.on('state', listener)
    return () => {
      this.events.off('state', listener)
    }
  }

  onLock(listener: (locked: boolean) => void) {
    this.events.on('lock', listener)
    return () => {
      this.events.off('lock', listener)
    }
  }

  start(): Promise<void> {
    if (this.starting)
      return this.starting
    if (this.stopping)
      return Promise.resolve()
    this.running = true
    const generation = ++this.generation
    this.state('starting')
    let timeout: ReturnType<typeof setTimeout> | undefined
    this.starting = Promise.race([
      this.connect(generation).catch((error: unknown) => {
        if (this.running && generation === this.generation) {
          this.failure(failureOf(error))
          this.log.withError(error).warn('linux-desktop: startup failed')
        }
      }),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          ++this.generation
          this.failure('hello-timeout')
          // Lock and busy sources are independent of the compositor; they keep
          // running, exactly as when KWin has no owner.
          void this.driver?.stop().catch(error => this.log.withError(error).warn('linux-desktop: startup cleanup failed'))
          resolve()
        }, 2000)
      }),
    ]).finally(() => clearTimeout(timeout))
    return this.starting
  }

  stop(): Promise<void> {
    this.running = false
    this.pullReady = false
    ++this.generation
    this.lock?.stop()
    this.busy?.stop()
    this.clear()
    this.setStatus('stopped')
    this.stopping ??= (async () => {
      try {
        await this.driver?.stop()
      }
      finally {
        await Promise.all([...new Set([this.buses?.sessionBus, this.buses?.systemBus])].map(bus => bus?.close()))
        this.events.removeAllListeners()
      }
    })()
    return this.stopping
  }

  /**
   * Opens another connection to the bridge's session bus, owned by the caller. The GlobalShortcuts
   * portal needs its own connection, because Registry.Register must be its first portal call.
   */
  openSessionBus(): Promise<DbusTransport> {
    return this.options.openSessionBus()
  }

  /** Without a running cursor script the last position has no source, so stopping drops it. */
  async setCursorStreaming(on: boolean): Promise<void> {
    this.cursorStreaming = on
    if (!on)
      this.dropCursor()
    await this.driver?.setCursorStreaming?.(on)
  }

  async setKeepAbove(windowPid: number, on: boolean): Promise<void> {
    if (!Number.isSafeInteger(windowPid) || !this.options.ownPids().includes(windowPid))
      throw new TypeError('Keep-above requires an AIRI process')
    if (!this.driver?.runOneShot)
      return
    // Only pid is inspected before ownership is established inside KWin.
    await this.driver.runOneShot(`(() => {
      const windows = 'activeWindow' in workspace ? workspace.stackingOrder : workspace.clientList();
      for (const window of windows) {
        if (window.pid === ${windowPid}) window.keepAbove = ${on === true};
      }
    })()`)
  }

  private async connect(generation: number): Promise<void> {
    const buses = await this.options.connect()
    if (!this.running || generation !== this.generation) {
      await Promise.all([...new Set([buses.sessionBus, buses.systemBus])].map(bus => bus?.close()))
      return
    }
    this.buses = buses
    const lock = new LockSource({ ...buses, onLock: locked => this.events.emit('lock', locked) })
    this.lock = lock
    this.busy = new BusySource({ sessionBus: buses.sessionBus })
    // Session sources have their own bounded probes and never delay windows.
    // A compositor timeout does not stop them, so only stop() withholds the report.
    void lock.start().then((lockSource) => {
      if (this.running && this.lock === lock)
        this.options.report({ lockSource })
    }).catch(error => this.log.withError(error).warn('linux-desktop: lock source failed'))
    void this.busy.start().catch(error => this.log.withError(error).warn('linux-desktop: busy source failed'))
    // A stopped or timed-out generation can never publish readings or facts.
    const live = () => this.running && generation === this.generation
    this.driver = this.options.createBackend(buses.sessionBus, {
      onMessage: message => live() && this.message(message),
      onFailure: reason => live() && this.failure(reason),
      onState: state => live() && this.state(state),
      onCursorReset: () => live() && this.dropCursor(),
    })
    if (!this.driver) {
      this.state('ready')
      return
    }
    // The backend confirms org.kde.KWin ownership before loading any script.
    await this.driver.start()
  }

  private clear() {
    this.active = null
    this.own = null
    this.pointer = null
    this.screens = null
    this.events.emit('active', null)
    this.events.emit('own', null)
    this.events.emit('cursor', null)
    this.events.emit('outputs', null)
  }

  private dropCursor() {
    if (this.pointer === null)
      return
    this.pointer = null
    this.events.emit('cursor', null)
  }

  private setStatus(status: LinuxDesktopBridgeState) {
    if (this.status === status)
      return
    this.status = status
    this.events.emit('state', status)
  }

  private state(bridge: 'starting' | 'ready') {
    if (!this.running)
      return
    this.pullReady = bridge === 'ready'
    if (bridge === 'starting') {
      this.clear()
      this.options.report({
        backend: this.backend,
        bridge,
        bridgeFailure: null,
        foregroundVerified: false,
        cursorVerified: false,
        geometryVerified: false,
        keepAboveVerified: false,
      })
      this.setStatus('starting')
      return
    }
    this.options.report({ backend: this.backend, bridge, bridgeFailure: null })
    this.setStatus('ready')
    this.log.log(`linux-desktop: backend ${this.backend} ready${this.api ? ` (api ${this.api})` : ''}`)
  }

  private failure(reason: BridgeFailure) {
    if (!this.running)
      return
    this.pullReady = false
    this.clear()
    this.log.warn(`linux-desktop: backend ${this.backend} failed (${reason})`)
    this.options.report({
      backend: this.backend,
      bridge: 'failed',
      bridgeFailure: reason === 'api-unsupported' ? 'api-unsupported' : 'other',
      foregroundVerified: false,
      cursorVerified: false,
      geometryVerified: false,
      keepAboveVerified: false,
    })
    this.setStatus('failed')
  }

  private message(message: BridgeMessage) {
    if (!this.running)
      return
    switch (message.method) {
      case 'Hello':
        this.api = message.payload.api
        break
      case 'Active':
        this.active = message.payload
        this.events.emit('active', this.active)
        break
      case 'OwnWindows':
        this.own = message.payload
        this.events.emit('own', this.own)
        break
      case 'Cursor':
        // A push still in flight when streaming stopped must not resurrect a reading.
        if (!this.cursorStreaming)
          break
        this.pointer = message.payload
        this.events.emit('cursor', this.pointer)
        break
      case 'Outputs':
        this.screens = message.payload
        this.events.emit('outputs', this.screens)
        break
    }
  }
}
