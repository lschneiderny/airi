import type { LinuxDesktopBackend, LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import type { KwinBackend, KwinBackendOptions, KwinFailure } from './backends/kwin'
import type { KwinMessage } from './backends/kwin/protocol'
import type { DbusTransport } from './dbus/transport'

import { EventEmitter } from 'node:events'

import { useLogg } from '@guiiai/logg'

import { KwinBackendError } from './backends/kwin'
import { BusySource } from './session/busy'
import { LockSource } from './session/lock'

type Active = Extract<KwinMessage, { method: 'Active' }>['payload']
type OwnWindows = Extract<KwinMessage, { method: 'OwnWindows' }>['payload'] | null
type Cursor = Extract<KwinMessage, { method: 'Cursor' }>['payload'] | null
type Outputs = Extract<KwinMessage, { method: 'Outputs' }>['payload'] | null
export type LinuxDesktopBridgeState = 'starting' | 'ready' | 'failed' | 'stopped'

interface BridgeOptions {
  readonly backend: LinuxDesktopBackend
  readonly connect: () => Promise<{ sessionBus: DbusTransport, systemBus: DbusTransport | null }>
  readonly createBackend: (bus: DbusTransport, callbacks: Pick<KwinBackendOptions, 'onMessage' | 'onFailure' | 'onState' | 'onCursorReset'>) => KwinBackend | undefined
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
  private driver: KwinBackend | undefined
  private lock: LockSource | undefined
  private busy: BusySource | undefined
  private buses: { sessionBus: DbusTransport, systemBus: DbusTransport | null } | undefined
  private starting: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private generation = 0
  private running = false
  private api: string | undefined

  constructor(private readonly options: BridgeOptions) {
    this.backend = options.backend
  }

  activeWindow(): Active { return this.active }
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
          this.failure(error instanceof KwinBackendError ? error.bridgeFailure : 'transport-failed')
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

  /** Without a running cursor script the last position has no source, so stopping drops it. */
  async setCursorStreaming(on: boolean): Promise<void> {
    this.cursorStreaming = on
    if (!on)
      this.dropCursor()
    await this.driver?.setCursorStreaming(on)
  }

  async setKeepAbove(windowPid: number, on: boolean): Promise<void> {
    if (!Number.isSafeInteger(windowPid) || !this.options.ownPids().includes(windowPid))
      throw new TypeError('Keep-above requires an AIRI process')
    if (!this.driver)
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
    this.driver = this.options.createBackend(buses.sessionBus, {
      onMessage: message => this.message(message),
      onFailure: reason => this.failure(reason),
      onState: state => this.state(state),
      onCursorReset: () => this.dropCursor(),
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

  private failure(reason: KwinFailure) {
    if (!this.running)
      return
    this.clear()
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

  private message(message: KwinMessage) {
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
