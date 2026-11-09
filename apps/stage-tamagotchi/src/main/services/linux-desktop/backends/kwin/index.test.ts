import type { KwinBusTransport } from './index'

import process from 'node:process'

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KwinBackend } from './index'

type Call = Parameters<KwinBusTransport['call']>[0]
type Exported = Parameters<KwinBusTransport['exportObject']>[1]

class FakeTransport implements KwinBusTransport {
  owner: string | null = ':1.10'
  api = 'plasma6'
  sendHello = true
  exported: Exported | undefined
  allowedSender: (() => string | null) | undefined
  ownerChanged: ((oldOwner: string, newOwner: string) => void) | undefined
  readonly loaded = new Map<number, string>()
  readonly sources = new Map<string, string>()
  readonly unregistered: string[] = []
  readonly running = new Set<string>()
  readonly runReached = Promise.withResolvers<void>()
  readonly loadReached = Promise.withResolvers<void>()
  readonly nameReached = Promise.withResolvers<void>()
  readonly unloadReached = Promise.withResolvers<void>()
  nameGate: Promise<void> | undefined
  loadGate: Promise<void> | undefined
  runGate: Promise<void> | undefined
  onRun: (() => void) | undefined
  refuseUnload: string | undefined
  private nextId = 1

  async call<T>(msg: Call): Promise<T> {
    let value: unknown
    const name = String(msg.body?.[0])
    switch (msg.member) {
      case 'isScriptLoaded':
        value = [...this.loaded.values()].includes(name)
        break
      case 'unloadScript':
        if (name === this.refuseUnload)
          return false as T
        for (const [id, plugin] of this.loaded) {
          if (plugin === name)
            this.loaded.delete(id)
        }
        this.running.delete(name)
        this.unregistered.push(name)
        this.unloadReached.resolve()
        value = true
        break
      case 'loadScript': {
        this.loadReached.resolve()
        await this.loadGate
        const id = this.nextId++
        const plugin = String(msg.body?.[1])
        this.sources.set(plugin, await readFile(name, 'utf8'))
        this.loaded.set(id, plugin)
        value = id
        break
      }
      case 'run': {
        const id = Number(/\/Script(\d+)$/.exec(msg.path)?.[1])
        const plugin = this.loaded.get(id)
        if (!plugin)
          throw new Error('Missing script')
        this.running.add(plugin)
        this.runReached.resolve()
        this.onRun?.()
        await this.runGate
        if (plugin.startsWith('airi-desktop-bridge-') && this.sendHello)
          this.receive('Hello', JSON.stringify({ api: this.api }))
        break
      }
      default:
        throw new Error(`Unexpected method ${msg.member}`)
    }
    // The fake implements the same typed wire boundary as the real transport.
    return value as T
  }

  exportObject(_path: string, iface: Exported, opts: { allowedSender: () => string | null }) {
    this.exported = iface
    this.allowedSender = opts.allowedSender
    return () => {
      this.exported = undefined
    }
  }

  async requestName(_name: string) {
    this.nameReached.resolve()
    await this.nameGate
    return true
  }

  async getNameOwner(name: string) { return name === 'org.kde.KWin' || name === this.owner ? this.owner : null }
  onNameOwnerChanged(_name: string, callback: (oldOwner: string, newOwner: string) => void) {
    this.ownerChanged = callback
    return () => {
      this.ownerChanged = undefined
    }
  }

  receive(method: string, payload?: string, sender = this.owner) {
    if (!sender || sender !== this.allowedSender?.())
      throw new Error('org.freedesktop.DBus.Error.AccessDenied')
    const exported = this.exported?.methods[method]
    if (!exported)
      throw new Error('Method not exported')
    const result = exported.handler(...(payload === undefined ? [] : [payload]))
    // Like DbusTransport, only a method with an output signature replies with data.
    return exported.outSignature ? result : undefined
  }

  changeOwner(next: string | null) {
    const old = this.owner
    this.owner = next
    this.loaded.clear()
    this.running.clear()
    this.ownerChanged?.(old ?? '', next ?? '')
  }
}

describe('kwinBackend lifecycle', () => {
  let directory: string
  let bus: FakeTransport
  let backend: KwinBackend
  const messages = vi.fn()
  const failures = vi.fn()

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-kwin-test-'))
    bus = new FakeTransport()
    backend = new KwinBackend({
      transport: bus,
      tempDir: directory,
      ownPids: () => [process.pid],
      onMessage: messages,
      onFailure: failures,
    })
    messages.mockClear()
    failures.mockClear()
  })

  afterEach(async () => {
    await backend.stop()
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('templates per-process names, delivers parsed messages and rejects other senders', async () => {
    await backend.start()
    expect(bus.sources.get(`airi-desktop-bridge-${process.pid}`)).toContain(`ai.moeru.airi.LinuxDesktop.p${process.pid}`)
    expect(messages).toHaveBeenCalledWith({ method: 'Hello', payload: { api: 'plasma6' } })
    expect(bus.receive('OwnPids')).toBe(JSON.stringify([process.pid]))
    expect(() => bus.receive('Cursor', '{"x":1,"y":2}', ':1.intruder')).toThrow('AccessDenied')
    expect(() => bus.receive('Active', '{private-title')).toThrow('Invalid KWin payload')
  })

  it('unloads dead-pid manifest entries while leaving live-pid files untouched', async () => {
    const manifest = join(directory, 'airi-kwin')
    await mkdir(manifest)
    const dead = 'airi-desktop-bridge-2147483647'
    const deadActuator = 'airi-desktop-actuator-2147483647-1'
    const live = `airi-desktop-bridge-${process.ppid}`
    for (const name of [dead, deadActuator, live]) {
      await writeFile(join(manifest, `${name}.js`), '// stale')
      bus.loaded.set(bus.loaded.size + 100, name)
    }
    await backend.start()
    expect(bus.unregistered).toEqual(expect.arrayContaining([dead, deadActuator]))
    expect(bus.unregistered).not.toContain(live)
    expect(await readdir(manifest)).toEqual(expect.arrayContaining([`${live}.js`, `airi-desktop-bridge-${process.pid}.js`]))
    expect(await readdir(manifest)).not.toContain(`${dead}.js`)
    expect(await readdir(manifest)).not.toContain(`${deadActuator}.js`)
  })

  it('fails at exactly two seconds without Hello and unloads the bridge', async () => {
    vi.useFakeTimers()
    bus.sendHello = false
    const starting = backend.start()
    const rejected = expect(starting).rejects.toMatchObject({ bridgeFailure: 'hello-timeout' })
    await bus.runReached.promise
    await vi.advanceTimersByTimeAsync(1999)
    expect(failures).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(bus.loaded.size).toBe(0)
  })

  it.each(['name', 'load', 'run'] as const)('reports the Hello deadline while the %s reply is pending, then cleans late completion', async (phase) => {
    vi.useFakeTimers()
    bus.sendHello = false
    const gate = Promise.withResolvers<void>()
    switch (phase) {
      case 'name':
        bus.nameGate = gate.promise
        break
      case 'load':
        bus.loadGate = gate.promise
        break
      case 'run':
        bus.runGate = gate.promise
        break
    }
    const starting = backend.start().then(() => undefined, (error: unknown) => error)
    await ({ name: bus.nameReached, load: bus.loadReached, run: bus.runReached }[phase]).promise
    try {
      await vi.advanceTimersByTimeAsync(1999)
      expect(failures).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(failures).toHaveBeenCalledExactlyOnceWith('hello-timeout')
      expect(await starting).toMatchObject({ bridgeFailure: 'hello-timeout' })
      expect(() => bus.receive('Hello', '{"api":"plasma6"}')).toThrow('AccessDenied')
    }
    finally {
      gate.resolve()
    }
    if (phase !== 'name') {
      // This completion comes from the late startup operation, before stop.
      await bus.unloadReached.promise
      expect(bus.loaded.size).toBe(0)
    }
    await backend.stop()
    expect(await readdir(join(directory, 'airi-kwin'))).toEqual([])
    expect(failures).toHaveBeenCalledTimes(1)
  })

  it('cancels the Hello deadline after a handshake even while run is pending', async () => {
    vi.useFakeTimers()
    bus.sendHello = false
    const gate = Promise.withResolvers<void>()
    bus.runGate = gate.promise
    const starting = backend.start()
    await bus.runReached.promise
    try {
      bus.receive('Hello', '{"api":"plasma6"}')
      await vi.advanceTimersByTimeAsync(2000)
      expect(failures).not.toHaveBeenCalled()
      expect([...bus.loaded.values()]).toEqual([backend.bridgeName])
    }
    finally {
      gate.resolve()
      await starting
    }
  })

  it.each(['plasma5', 'unsupported'])('handles the %s Hello fixture', async (api) => {
    bus.api = api
    if (api === 'unsupported') {
      await expect(backend.start()).rejects.toMatchObject({ bridgeFailure: 'api-unsupported' })
      expect(bus.loaded.size).toBe(0)
    }
    else {
      await backend.start()
      expect(messages).toHaveBeenCalledWith({ method: 'Hello', payload: { api } })
    }
  })

  it('fails with no KWin owner without loading scripts', async () => {
    bus.owner = null
    await expect(backend.start()).rejects.toThrow('org.kde.KWin has no owner')
    expect(bus.loaded.size).toBe(0)
  })

  it('reloads the bridge and requested cursor stream for a new owner', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    bus.changeOwner(':1.20')
    expect(() => bus.receive('Cursor', '{"x":1,"y":2}', ':1.10')).toThrow('AccessDenied')
    // A public operation joins the serialized reload rather than racing it.
    await backend.setCursorStreaming(true)
    expect([...bus.running].sort()).toEqual([
      `airi-desktop-bridge-${process.pid}`,
      `airi-desktop-cursor-${process.pid}`,
    ])
    expect(messages.mock.calls.filter(([message]) => message.method === 'Hello')).toHaveLength(2)
    expect(bus.allowedSender?.()).toBe(':1.20')
  })

  it('cancels a pending Hello when the owner changes and reloads without waiting two seconds', async () => {
    bus.sendHello = false
    const starting = backend.start()
    const rejected = expect(starting).rejects.toMatchObject({ bridgeFailure: 'owner-changed' })
    await bus.runReached.promise
    bus.sendHello = true
    bus.changeOwner(':1.20')
    await rejected
    await backend.setCursorStreaming(true)
    expect([...bus.running]).toContain(`airi-desktop-bridge-${process.pid}`)
  })

  it('unloads both scripts, removes files and unexports on stop', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    await backend.stop()
    expect(bus.loaded.size).toBe(0)
    expect(bus.unregistered).toEqual(expect.arrayContaining([
      `airi-desktop-bridge-${process.pid}`,
      `airi-desktop-cursor-${process.pid}`,
    ]))
    expect(await readdir(join(directory, 'airi-kwin'))).toEqual([])
    expect(bus.exported).toBeUndefined()
    expect(bus.ownerChanged).toBeUndefined()
  })

  it('finishes repeated owner interruptions with only the final generation running', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    bus.changeOwner(null)
    bus.changeOwner(':1.20')
    bus.changeOwner(':1.30')
    await backend.setCursorStreaming(true)
    expect(bus.allowedSender?.()).toBe(':1.30')
    expect([...bus.loaded.values()].sort()).toEqual([backend.bridgeName, backend.cursorName])
    expect(failures).not.toHaveBeenCalled()
  })

  it('retains a failed-unload manifest and still cleans the other script', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    bus.refuseUnload = backend.bridgeName
    await expect(backend.stop()).rejects.toThrow('KWin script cleanup failed')
    expect([...bus.loaded.values()]).toEqual([backend.bridgeName])
    expect(await readdir(join(directory, 'airi-kwin'))).toEqual([`${backend.bridgeName}.js`])
    bus.refuseUnload = undefined
    await backend.stop()
    expect(bus.loaded.size).toBe(0)
  })

  it('cleans a script whose load completes after stop interrupts start', async () => {
    const gate = Promise.withResolvers<void>()
    bus.loadGate = gate.promise
    const starting = backend.start()
    const rejected = expect(starting).rejects.toMatchObject({ bridgeFailure: 'stopped' })
    await bus.loadReached.promise
    const stopping = backend.stop()
    gate.resolve()
    await Promise.all([rejected, stopping])
    expect(bus.loaded.size).toBe(0)
    expect(bus.exported).toBeUndefined()
  })

  it('stops during a pending Hello without waiting for the timeout', async () => {
    bus.sendHello = false
    const starting = backend.start()
    const rejected = expect(starting).rejects.toMatchObject({ bridgeFailure: 'stopped' })
    await bus.runReached.promise
    await backend.stop()
    await rejected
    expect(bus.loaded.size).toBe(0)
  })

  it('repairs an externally unloaded cursor script and disables the stream', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    for (const [id, name] of bus.loaded) {
      if (name.includes('cursor'))
        bus.loaded.delete(id)
    }
    await backend.setCursorStreaming(true)
    expect([...bus.loaded.values()]).toContain(`airi-desktop-cursor-${process.pid}`)
    await backend.setCursorStreaming(false)
    expect([...bus.loaded.values()]).toEqual([`airi-desktop-bridge-${process.pid}`])
  })

  it('unloads one-shot scripts after execution and when execution rejects', async () => {
    await backend.start()
    await backend.runOneShot('workspace.activeWindow.keepAbove = true')
    expect([...bus.loaded.values()]).toEqual([`airi-desktop-bridge-${process.pid}`])
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    bus.runGate = gate.promise
    bus.onRun = reached.resolve
    const running = backend.runOneShot('throw new Error("failed")')
    const rejected = expect(running).rejects.toThrow('Script failed')
    await reached.promise
    gate.reject(new Error('Script failed'))
    await rejected
    expect([...bus.loaded.values()]).toEqual([`airi-desktop-bridge-${process.pid}`])
    expect(await readdir(join(directory, 'airi-kwin'))).toEqual([`airi-desktop-bridge-${process.pid}.js`])
  })
})
