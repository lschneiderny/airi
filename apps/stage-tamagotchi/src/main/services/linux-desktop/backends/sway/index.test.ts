import type { Socket } from 'node:net'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SwayBackend } from './index'
import { encodeFrame } from './ipc'

const rect = { x: 10, y: 20, width: 800, height: 600 }
const node = { id: 9, type: 'con', pid: 123, name: 'first', app_id: 'foot', rect, focused: true }
const output = { name: 'HEADLESS-1', active: true, rect: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1 }
const cleanups: (() => Promise<void>)[] = []
const next = (events: EventEmitter, name: string) => once(events, name, { signal: AbortSignal.timeout(3000) })

async function fixture(options: { tree?: unknown, outputs?: unknown, replyTree?: boolean, subscribe?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'airi-sway-'))
  const path = join(directory, 'ipc.sock')
  const events = new EventEmitter()
  const sockets = new Set<Socket>()
  const requests: { type: number, body: string }[] = []
  let tree: unknown = options.tree ?? node
  let outputs: unknown = options.outputs ?? [output]
  const server = createServer((socket) => {
    sockets.add(socket)
    // The backend under test destroys its socket on failure; the fake compositor sees that as a reset.
    socket.on('error', () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 14) {
        const length = buffered.readUInt32LE(6)
        if (buffered.length < 14 + length)
          return
        const type = buffered.readUInt32LE(10)
        requests.push({ type, body: buffered.subarray(14, 14 + length).toString() })
        buffered = buffered.subarray(14 + length)
        if (type === 2 && options.subscribe !== false)
          socket.write(encodeFrame(2, { success: true }))
        if (type === 3)
          socket.write(encodeFrame(3, outputs))
        if (type === 4 && options.replyTree !== false)
          socket.write(encodeFrame(4, tree))
        events.emit('request', type)
      }
    })
    events.emit('connection', socket)
  })
  server.listen(path)
  await once(server, 'listening')
  const backend = new SwayBackend({
    socketPath: path,
    ownPids: () => [123],
    onFailure: reason => events.emit('failure', reason),
  })
  backend.onActive(active => events.emit('active', active))
  backend.onOwnWindows(windows => events.emit('own', windows))
  backend.onOutputs(value => events.emit('outputs', value))
  cleanups.push(async () => {
    await backend.stop()
    for (const socket of sockets)
      socket.destroy()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    path,
    backend,
    events,
    requests,
    setTree: (value: unknown) => {
      tree = value
    },
    setOutputs: (value: unknown) => {
      outputs = value
    },
  }
}

afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
})

describe('sway socket client', () => {
  it('rejects an omitted socket path without reading ambient SWAYSOCK', async () => {
    const ambient = await fixture()
    const explicit = await fixture()
    const ambientConnections = vi.fn()
    ambient.events.on('connection', ambientConnections)
    // Isolate the environment proxy in a child; never use the host socket.
    const { stdout } = await promisify(execFile)(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import { SwayBackend, SwayBackendError } from ${JSON.stringify(new URL('./index.ts', import.meta.url).href)}
        let ambientReads = 0
        process.env = new Proxy(process.env, {
          get(target, key) {
            if (key === 'SWAYSOCK')
              ambientReads++
            return Reflect.get(target, key)
          },
        })
        const options = { ownPids: () => [], onFailure: () => {} }
        const omitted = Reflect.construct(SwayBackend, [options])
        let outcome = 'ready'
        try {
          await omitted.start()
        }
        catch (error) {
          if (!(error instanceof SwayBackendError))
            throw error
          outcome = error.bridgeFailure
        }
        finally {
          await omitted.stop()
        }
        const explicit = new SwayBackend({ ...options, socketPath: ${JSON.stringify(explicit.path)} })
        try {
          await explicit.start()
        }
        finally {
          await explicit.stop()
        }
        console.log(JSON.stringify({ outcome, ambientReads }))
      `,
    ], { env: { ...process.env, SWAYSOCK: ambient.path }, timeout: 5000 })
    expect(JSON.parse(stdout)).toEqual({ outcome: 'socket-unavailable', ambientReads: 0 })
    expect(ambientConnections).not.toHaveBeenCalled()
    expect(explicit.requests).toEqual([{ type: 2, body: '["window","output"]' }, { type: 3, body: '' }, { type: 4, body: '' }])
  })

  it('delivers snapshots for focus, title and fullscreen events using only read-only requests', async () => {
    const { backend, events, requests, setTree } = await fixture()
    const connection = next(events, 'connection')
    const first = next(events, 'active')
    const own = next(events, 'own')
    const start = backend.start()
    expect(backend.start()).toBe(start)
    const [socket] = await connection
    await start
    expect(await first).toEqual([{ caption: 'first', resourceClass: 'foot', desktopFileName: 'foot', pid: 123, fullScreen: false }])
    expect(await own).toEqual([[{ id: '9', caption: 'first', pid: 123, ...rect, keepAbove: false, outputScale: 1 }]])
    for (const change of ['focus', 'title', 'fullscreen_mode']) {
      setTree({ ...node, name: change, app_id: 'org.kde.konsole', fullscreen_mode: 1 })
      const updated = next(events, 'active')
      socket.write(encodeFrame(0x80000003, { change, container: node }))
      expect(await updated).toEqual([{ caption: change, resourceClass: 'org.kde.konsole', desktopFileName: 'org.kde.konsole', pid: 123, fullScreen: true }])
    }
    expect(requests).toEqual([
      { type: 2, body: '["window","output"]' },
      { type: 3, body: '' },
      ...Array.from({ length: 4 }, () => ({ type: 4, body: '' })),
    ])
  })

  it('reads outputs before startup resolves and refreshes them on output events', async () => {
    const { backend, events, requests, setOutputs } = await fixture()
    const order: string[] = []
    events.on('outputs', () => order.push('outputs'))
    const connection = next(events, 'connection')
    const first = next(events, 'outputs')
    const start = backend.start().then(() => order.push('ready'))
    const [socket] = await connection
    expect(await first).toEqual([[{ name: 'HEADLESS-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 }]])
    await start
    expect(order).toEqual(['outputs', 'ready'])
    setOutputs([{ ...output, rect: { x: 0, y: 0, width: 1280, height: 720 }, scale: 1.5 }])
    const updated = next(events, 'outputs')
    socket.write(encodeFrame(0x80000001, { change: 'unspecified' }))
    expect(await updated).toEqual([[{ name: 'HEADLESS-1', x: 0, y: 0, width: 1280, height: 720, scale: 1.5 }]])
    expect(requests.map(request => request.type)).toEqual([2, 3, 4, 3])
  })

  it('reports invalid outputs without leaking payloads', async () => {
    const { backend, events } = await fixture({ outputs: [{ ...output, rect: 'private title' }] })
    const failure = next(events, 'failure')
    await expect(backend.start()).rejects.toThrow('Sway bridge failed: protocol-failed')
    expect(await failure).toEqual(['protocol-failed'])
  })

  it.each([false, true])('reports a closed socket (partial frame: %s) and can restart', async (partial) => {
    const { backend, events } = await fixture()
    const connection = next(events, 'connection')
    await backend.start()
    const [socket] = await connection
    const failure = next(events, 'failure')
    socket.end(partial ? encodeFrame(4, node).subarray(0, 18) : undefined)
    expect(await failure).toEqual([partial ? 'protocol-failed' : 'socket-closed'])
    const active = next(events, 'active')
    await backend.start()
    expect(await active).toEqual([expect.objectContaining({ pid: 123 })])
  })

  it('closes the socket on stop without reporting transport failure', async () => {
    const { backend, events } = await fixture()
    const failures = vi.fn()
    events.on('failure', failures)
    const connection = next(events, 'connection')
    await backend.start()
    const [socket] = await connection
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(3000) })
    await backend.stop()
    await closed
    expect(failures).not.toHaveBeenCalled()
  })

  it('cancels startup on stop and permits a fresh connection', async () => {
    const { backend, events } = await fixture()
    const connection = next(events, 'connection')
    const outcome = backend.start().catch((error: unknown) => error)
    await connection
    await backend.stop()
    expect(await outcome).toMatchObject({ bridgeFailure: 'stopped' })
    await expect(backend.start()).resolves.toBeUndefined()
  })

  it.each(['tree', 'subscribe'] as const)('bounds a hung %s reply by a deadline', async (phase) => {
    const { backend, events } = await fixture(phase === 'tree' ? { replyTree: false } : { subscribe: false })
    const reached = Promise.withResolvers<void>()
    events.on('request', (type: number) => {
      if (type === (phase === 'tree' ? 4 : 2))
        reached.resolve()
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const outcome = backend.start().catch((error: unknown) => error)
    await reached.promise
    const failure = next(events, 'failure')
    await vi.advanceTimersByTimeAsync(2000)
    expect(await outcome).toMatchObject({ bridgeFailure: 'request-timeout' })
    expect(await failure).toEqual(['request-timeout'])
  })

  it('reports invalid tree data without leaking private titles', async () => {
    const { backend, events } = await fixture({ tree: { ...node, rect: 'private title' } })
    const failure = next(events, 'failure')
    await expect(backend.start()).rejects.toThrow('Sway bridge failed: protocol-failed')
    expect(await failure).toEqual(['protocol-failed'])
  })
})
