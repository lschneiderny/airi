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

interface BridgeOptions {
  readonly backend: LinuxDesktopBackend
  readonly connect: () => Promise<{ sessionBus: DbusTransport, systemBus: DbusTransport | null }>
  readonly createBackend: (bus: DbusTransport, callbacks: Pick<KwinBackendOptions, 'onMessage' | 'onFailure' | 'onState'>) => KwinBackend | undefined
  readonly report: (patch: Partial<LinuxDesktopFacts>) => void
  readonly ownPids: () => readonly number[]
}

/** Owns the connections, backend and session sources for one app lifetime. */
export class LinuxDesktopBridge {
  readonly backend: LinuxDesktopBackend
  private readonly log = useLogg('linux-desktop').useGlobalConfig()
  private readonly events = new EventEmitter<{ active: [Active], own: [OwnWindows], cursor: [Cursor], lock: [boolean] }>()
  private active: Active = null
  private own: OwnWindows = null
  private pointer: Cursor = null
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

  async setCursorStreaming(on: boolean): Promise<void> {
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
    this.events.emit('active', null)
    this.events.emit('own', null)
    this.events.emit('cursor', null)
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
      return
    }
    this.options.report({ backend: this.backend, bridge, bridgeFailure: null })
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
        this.pointer = message.payload
        this.events.emit('cursor', this.pointer)
        break
    }
  }
}
