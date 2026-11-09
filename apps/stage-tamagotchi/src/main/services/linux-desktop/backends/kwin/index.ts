import type { KwinMessage } from './protocol'

import process from 'node:process'

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import bridgeSource from './bridge-script.js?raw'
import cursorSource from './cursor-script.js?raw'

import { parseActive, parseCursor, parseHello, parseOutputs, parseOwnPids, parseOwnWindows } from './protocol'

/**
 * Structural subset of DbusTransport (`../../dbus/transport`) that tests can fake;
 * the caller owns the connection. `outSignature` is the reply's D-Bus signature.
 */
export interface KwinBusTransport {
  call: <T>(msg: {
    destination: string
    path: string
    interface: string
    member: string
    signature?: string
    body?: unknown[]
  }) => Promise<T>
  exportObject: (path: string, iface: {
    name: string
    methods: Record<string, { signature: string, outSignature: string, handler: (...args: unknown[]) => unknown }>
  }, opts: { allowedSender: () => string | null }) => () => void
  requestName: (name: string) => Promise<boolean>
  getNameOwner: (name: string) => Promise<string | null>
  onNameOwnerChanged: (name: string, cb: (oldOwner: string, newOwner: string) => void) => () => void
}

export type KwinFailure = 'api-unsupported' | 'hello-timeout' | 'owner-changed' | 'stopped' | 'no-owner' | 'name-unavailable' | 'script-load-failed' | 'script-unload-failed' | 'transport-failed'

export class KwinBackendError extends Error {
  constructor(readonly bridgeFailure: KwinFailure) {
    super(bridgeFailure === 'no-owner' ? 'org.kde.KWin has no owner' : `KWin bridge failed: ${bridgeFailure}`)
    this.name = 'KwinBackendError'
  }
}

export interface KwinBackendOptions {
  readonly transport: KwinBusTransport
  readonly tempDir: string
  readonly ownPids: () => readonly number[]
  readonly onMessage: (message: KwinMessage) => void
  readonly onFailure: (reason: KwinFailure) => void
  readonly onState?: (state: 'starting' | 'ready') => void
  /** The cursor script was found unloaded, so the last position has no live source. */
  readonly onCursorReset?: () => void
}

/** Serializes script ownership; stop and owner changes invalidate in-flight work. */
export class KwinBackend {
  readonly busName = `ai.moeru.airi.LinuxDesktop.p${process.pid}`
  readonly bridgeName = `airi-desktop-bridge-${process.pid}`
  readonly cursorName = `airi-desktop-cursor-${process.pid}`
  private readonly directory: string
  private readonly scripts = new Map<string, string>()
  private queue: Promise<void> = Promise.resolve()
  private starting: Promise<void> | undefined
  private running = false
  private ready = false
  private cursorStreaming = false
  private generation = 0
  private actuator = 0
  private owner: string | null = null
  private unexport: (() => void) | undefined
  private unwatch: (() => void) | undefined
  private hello: ReturnType<typeof Promise.withResolvers<void>> | undefined

  constructor(private readonly options: KwinBackendOptions) {
    this.directory = join(options.tempDir, 'airi-kwin')
  }

  start(): Promise<void> {
    if (this.running && this.starting)
      return this.starting
    this.running = true
    const generation = ++this.generation
    this.starting = this.beginStart(generation, async (hello) => {
      this.check(generation)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      if (!await this.options.transport.requestName(this.busName))
        throw new KwinBackendError('name-unavailable')
      this.check(generation)
      this.exportBridge()
      this.unwatch = this.options.transport.onNameOwnerChanged('org.kde.KWin', (_oldOwner, newOwner) => {
        if (!this.running)
          return
        this.owner = newOwner || null
        this.ready = false
        this.options.onState?.('starting')
        const next = ++this.generation
        this.hello?.reject(new KwinBackendError('owner-changed'))
        // beginStart reports reload failures; this operation has no caller.
        void this.beginStart(next, hello => this.reload(next, hello), false)
      })
      const owner = await this.options.transport.getNameOwner('org.kde.KWin')
      this.check(generation)
      this.owner = owner
      if (!owner)
        throw new KwinBackendError('no-owner')
      await this.cleanStale()
      await this.reload(generation, hello)
    })
    return this.starting
  }

  setCursorStreaming(on: boolean): Promise<void> {
    this.cursorStreaming = on
    const generation = this.generation
    return this.enqueue(() => this.guard(generation, async () => {
      this.check(generation)
      if (!this.ready)
        throw new KwinBackendError('no-owner')
      if (!this.cursorStreaming) {
        await this.unload(this.cursorName)
        return
      }
      if (!await this.scripting<boolean>('isScriptLoaded', 's', [this.cursorName])) {
        this.options.onCursorReset?.()
        await this.load(this.cursorName, cursorSource, generation)
      }
    }))
  }

  /** Source is trusted actuator code, never window captions or renderer input. */
  runOneShot(source: string): Promise<void> {
    const generation = this.generation
    return this.enqueue(async () => {
      this.check(generation)
      if (!this.ready)
        throw new KwinBackendError('no-owner')
      const name = `airi-desktop-actuator-${process.pid}-${++this.actuator}`
      try {
        await this.load(name, source, generation)
      }
      finally {
        await this.unload(name)
      }
    })
  }

  stop(): Promise<void> {
    this.running = false
    this.ready = false
    this.cursorStreaming = false
    this.starting = undefined
    ++this.generation
    this.hello?.reject(new KwinBackendError('stopped'))
    this.unwatch?.()
    this.unwatch = undefined
    return this.enqueue(async () => {
      try {
        await this.unloadAll()
      }
      finally {
        this.unexport?.()
        this.unexport = undefined
        if (this.scripts.size === 0)
          this.owner = null
      }
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation)
    // Only the scheduling tail absorbs rejection. The operation's caller gets
    // the original result; failed starts must not prevent a later stop/reload.
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private beginStart(generation: number, operation: (hello: Promise<unknown>) => Promise<void>, propagate = true): Promise<void> {
    const hello = Promise.withResolvers<void>()
    const deadline = Promise.withResolvers<never>()
    this.hello = hello
    // Report the deadline independently of the queue: loadScript/run replies
    // may hang. Invalidate their generation but retain ownership until their
    // queued operation settles, checks its generation, and unloads its scripts.
    const timeout = setTimeout(() => {
      const error = new KwinBackendError('hello-timeout')
      hello.reject(error)
      deadline.reject(error)
      if (this.running && generation === this.generation) {
        ++this.generation
        this.ready = false
        if (this.hello === hello)
          this.hello = undefined
        this.options.onFailure('hello-timeout')
      }
    }, 2000)
    const outcome = hello.promise.then(
      () => {
        clearTimeout(timeout)
        return undefined
      },
      (error: unknown) => {
        clearTimeout(timeout)
        return error
      },
    )
    const work = this.enqueue(() => this.guard(generation, () => operation(outcome)))
    const result = Promise.race([work, deadline.promise]).finally(() => {
      clearTimeout(timeout)
      if (this.hello === hello)
        this.hello = undefined
    })
    // Both the deadline and guard report failures. Owner-change restarts have
    // no promise consumer; explicit start callers still receive the rejection.
    return propagate ? result : result.then(() => undefined, () => undefined)
  }

  private check(generation: number) {
    if (!this.running)
      throw new KwinBackendError('stopped')
    if (generation !== this.generation)
      throw new KwinBackendError('owner-changed')
  }

  private async guard(generation: number, operation: () => Promise<void>) {
    try {
      await operation()
    }
    catch (error) {
      this.ready = false
      let failure = error
      try {
        await this.unloadAll()
      }
      catch (cleanupError) {
        failure = new AggregateError([error, cleanupError], 'KWin bridge failed during cleanup')
      }
      if (this.running && generation === this.generation)
        this.options.onFailure(failure instanceof KwinBackendError ? failure.bridgeFailure : 'transport-failed')
      throw failure
    }
  }

  private exportBridge() {
    const push = (message: KwinMessage) => {
      this.options.onMessage(message)
    }
    this.unexport = this.options.transport.exportObject('/bridge', {
      name: 'ai.moeru.airi.LinuxDesktop1',
      methods: {
        Hello: {
          signature: 's',
          outSignature: '',
          handler: (json) => {
            const payload = parseHello(json)
            if (payload.api === 'unsupported')
              this.hello?.reject(new KwinBackendError('api-unsupported'))
            else
              this.hello?.resolve()
            return push({ method: 'Hello', payload })
          },
        },
        Active: { signature: 's', outSignature: '', handler: json => push({ method: 'Active', payload: parseActive(json) }) },
        OwnWindows: { signature: 's', outSignature: '', handler: json => push({ method: 'OwnWindows', payload: parseOwnWindows(json) }) },
        Cursor: { signature: 's', outSignature: '', handler: json => push({ method: 'Cursor', payload: parseCursor(json) }) },
        Outputs: { signature: 's', outSignature: '', handler: json => push({ method: 'Outputs', payload: parseOutputs(json) }) },
        OwnPids: { signature: '', outSignature: 's', handler: () => JSON.stringify(parseOwnPids(JSON.stringify(this.options.ownPids()))) },
      },
    }, { allowedSender: () => this.running && (this.ready || this.hello !== undefined) ? this.owner : null })
  }

  private async reload(generation: number, hello: Promise<unknown>) {
    this.check(generation)
    await this.unloadAll()
    this.check(generation)
    if (!this.owner)
      throw new KwinBackendError('no-owner')
    await this.load(this.bridgeName, bridgeSource, generation)
    const error = await hello
    if (error)
      throw error
    this.check(generation)
    this.ready = true
    if (this.cursorStreaming)
      await this.load(this.cursorName, cursorSource, generation)
    this.options.onState?.('ready')
  }

  private scripting<T>(member: string, signature: string, body: unknown[], owner = this.owner): Promise<T> {
    if (!owner)
      throw new KwinBackendError('no-owner')
    return this.options.transport.call<T>({
      destination: owner,
      path: '/Scripting',
      interface: 'org.kde.kwin.Scripting',
      member,
      signature,
      body,
    })
  }

  private async load(name: string, source: string, generation: number) {
    this.check(generation)
    const path = join(this.directory, `${name}.js`)
    const owner = this.owner
    if (!owner)
      throw new KwinBackendError('no-owner')
    this.scripts.set(name, owner)
    await writeFile(path, source.replaceAll('__AIRI_BUS_NAME__', this.busName), { mode: 0o600 })
    this.check(generation)
    const id = await this.scripting<number>('loadScript', 'ss', [path, name], owner)
    this.check(generation)
    if (!Number.isInteger(id) || id < 0)
      throw new KwinBackendError('script-load-failed')
    await this.options.transport.call<void>({
      destination: owner,
      path: `/Scripting/Script${id}`,
      interface: 'org.kde.kwin.Script',
      member: 'run',
    })
    this.check(generation)
  }

  private async unload(name: string) {
    const owner = this.scripts.get(name) ?? this.owner
    if (owner && await this.options.transport.getNameOwner(owner)) {
      if (await this.scripting<boolean>('isScriptLoaded', 's', [name], owner)
        && !await this.scripting<boolean>('unloadScript', 's', [name], owner)) {
        throw new KwinBackendError('script-unload-failed')
      }
    }
    await rm(join(this.directory, `${name}.js`), { force: true })
    this.scripts.delete(name)
  }

  private async unloadAll() {
    const results = await Promise.allSettled([...this.scripts.keys()].map(name => this.unload(name)))
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length)
      throw new AggregateError(errors, 'KWin script cleanup failed')
  }

  private async cleanStale() {
    for (const file of await readdir(this.directory)) {
      const match = /^airi-desktop-(?:bridge|cursor|actuator)-(\d+)(?:-\d+)?\.js$/.exec(file)
      if (!match)
        continue
      const pid = Number(match[1])
      if (!Number.isSafeInteger(pid) || pid <= 0)
        continue
      try {
        process.kill(pid, 0)
        continue
      }
      catch (error) {
        if (typeof error !== 'object' || !error || !('code' in error))
          throw error
        if (error.code === 'EPERM')
          continue
        if (error.code !== 'ESRCH')
          throw error
      }
      await this.unload(file.slice(0, -3))
    }
    // Same-pid leftovers can exist after a failed start in this process.
    for (const name of [this.bridgeName, this.cursorName])
      await this.unload(name)
  }
}
