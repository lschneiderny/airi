import type { Server, Socket } from 'node:net'

import type { LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pid } from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { encodeFrame } from './backends/sway/ipc'
import { X11BackendError } from './backends/x11/binding'
import { mapDisplaysToOutputs } from './geometry/outputs'
import { CoordinateVerifier } from './geometry/verification'
import { createLinuxDesktopBridge } from './index'
import { PrivateBus } from './session/private-bus.test-helper'

const facts = vi.hoisted(() => vi.fn())
const x11 = vi.hoisted(() => ({ options: [] as unknown[], start: vi.fn(), active: vi.fn() }))
vi.mock('../electron/host-capabilities', () => ({ reportLinuxDesktop: facts }))
vi.mock('electron', () => ({ app: { getAppMetrics: () => [{ pid }] } }))
// The fake keeps the bridge test off libX11; the real binding has its own suite.
vi.mock('./backends/x11', () => ({
  X11EwmhBackend: class {
    constructor(options: unknown) {
      x11.options.push(options)
    }

    start() { return x11.start() }
    stop() { return Promise.resolve() }
    activeWindow() { return x11.active() }
  },
}))

const rect = { x: 0, y: 0, width: 800, height: 600 }

describe('linux desktop backend registration', () => {
  let bus: PrivateBus
  let directory: string
  let bridge: ReturnType<typeof createLinuxDesktopBridge> | undefined
  const servers: Server[] = []
  const sockets = new Set<Socket>()

  beforeEach(async () => {
    bus = new PrivateBus()
    await bus.start()
    directory = await mkdtemp(join(tmpdir(), 'airi-registration-'))
    facts.mockReset()
    x11.options.length = 0
    x11.start.mockReset()
    x11.active.mockReset()
  })

  afterEach(async () => {
    await bridge?.stop()
    bridge = undefined
    for (const socket of sockets)
      socket.destroy()
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    await bus.close()
    await rm(directory, { recursive: true, force: true })
  })

  function create(env: Record<string, string>) {
    bridge = createLinuxDesktopBridge({
      env: { XDG_RUNTIME_DIR: directory, ...env },
      tempDir: directory,
      sessionBus: bus.client,
      systemBus: bus.client,
    })
    return bridge
  }

  async function listen(path: string, onSocket: (socket: Socket) => void) {
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => socket.destroy())
      socket.on('close', () => sockets.delete(socket))
      onSocket(socket)
    })
    servers.push(server)
    server.listen(path)
    await once(server, 'listening')
  }

  function nextFact(match: (patch: Partial<LinuxDesktopFacts>) => boolean) {
    const reached = Promise.withResolvers<void>()
    facts.mockImplementation((patch: Partial<LinuxDesktopFacts>) => {
      if (match(patch))
        reached.resolve()
    })
    return Promise.race([reached.promise, new Promise((_, reject) => AbortSignal.timeout(3000).addEventListener('abort', () => reject(new Error('fact timeout'))))])
  }

  const lastFailure = () => facts.mock.calls.filter(([patch]) => patch.bridge === 'failed').at(-1)?.[0]

  describe('x11-ewmh', () => {
    it('opens the injected display and reads the active window on demand', async () => {
      x11.start.mockResolvedValue(undefined)
      x11.active.mockReturnValue({ caption: 'Shell', resourceClass: 'konsole', pid: 7, fullScreen: true })
      const bridge = create({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':91' })
      await bridge.start()
      expect(x11.options).toEqual([{ sessionType: 'x11', display: ':91' }])
      expect(facts).toHaveBeenCalledWith(expect.objectContaining({ backend: 'x11-ewmh', bridge: 'ready' }))
      const pushed = vi.fn()
      bridge.onActive(pushed)
      expect(bridge.activeWindow()).toEqual({ caption: 'Shell', resourceClass: 'konsole', desktopFileName: '', pid: 7, fullScreen: true })
      expect(bridge.activeWindow()).toMatchObject({ pid: 7 })
      expect(pushed).toHaveBeenCalledOnce()
    })

    it('never constructs the X11 backend on XWayland', async () => {
      const bridge = create({ XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':91' })
      await bridge.start()
      expect(bridge.backend).toBe('none')
      expect(x11.options).toEqual([])
    })

    it('fails with the reason when the display is missing', async () => {
      x11.start.mockRejectedValue(new X11BackendError('display-unavailable'))
      const bridge = create({ XDG_SESSION_TYPE: 'x11' })
      await bridge.start()
      expect(x11.options).toEqual([{ sessionType: 'x11', display: '' }])
      expect(lastFailure()).toMatchObject({ backend: 'x11-ewmh', bridgeFailure: 'other', foregroundVerified: false })
      expect(bridge.activeWindow()).toBeNull()
    })

    it('revokes readiness when a read fails instead of keeping the last window', async () => {
      x11.start.mockResolvedValue(undefined)
      x11.active.mockReturnValueOnce({ caption: 'Shell', resourceClass: 'konsole', pid: 7, fullScreen: false })
      const bridge = create({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':91' })
      await bridge.start()
      expect(bridge.activeWindow()).toMatchObject({ pid: 7 })
      x11.active.mockImplementation(() => {
        throw new Error('connection lost')
      })
      expect(bridge.activeWindow()).toBeNull()
      expect(lastFailure()).toMatchObject({ backend: 'x11-ewmh', bridge: 'failed' })
    })
  })

  describe('sway', () => {
    const screen = { x: 0, y: 0, width: 1920, height: 1080 }
    const tree = { id: 1, type: 'root', rect: screen, nodes: [{ id: 2, type: 'output', rect: screen, scale: 1, nodes: [{ id: 9, type: 'con', pid, name: 'AIRI', app_id: 'airi', rect, focused: true }] }] }
    const outputs = [{ name: 'HEADLESS-1', active: true, rect: screen, scale: 1 }]
    let reply = { tree: tree as unknown }

    async function compositor(path: string) {
      await listen(path, (socket) => {
        let buffered = Buffer.alloc(0)
        socket.on('data', (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk])
          while (buffered.length >= 14 && buffered.length >= 14 + buffered.readUInt32LE(6)) {
            const type = buffered.readUInt32LE(10)
            buffered = buffered.subarray(14 + buffered.readUInt32LE(6))
            socket.write(type === 2 ? encodeFrame(2, { success: true }) : type === 3 ? encodeFrame(3, outputs) : encodeFrame(4, reply.tree))
          }
        })
      })
    }

    it('connects to the injected socket, delivers readings, and fails when sway exits', async () => {
      const path = join(directory, 'sway.sock')
      await compositor(path)
      const bridge = create({ SWAYSOCK: path })
      await bridge.start()
      expect(facts).toHaveBeenCalledWith(expect.objectContaining({ backend: 'sway', bridge: 'ready' }))
      expect(bridge.activeWindow()).toEqual({ caption: 'AIRI', resourceClass: 'airi', desktopFileName: 'airi', pid, fullScreen: false })
      expect(bridge.ownWindows()).toEqual([expect.objectContaining({ id: '9', pid, ...rect })])
      const failed = nextFact(patch => patch.bridge === 'failed')
      for (const socket of sockets)
        socket.destroy()
      await failed
      expect(lastFailure()).toMatchObject({ backend: 'sway', bridgeFailure: 'other', foregroundVerified: false })
      expect(bridge.activeWindow()).toBeNull()
      expect(bridge.ownWindows()).toBeNull()
    })

    it('publishes sway outputs, so a bound window of matching size verifies geometry', async () => {
      const path = join(directory, 'sway.sock')
      reply = { tree: { ...tree, nodes: [{ ...tree.nodes[0], nodes: [{ ...tree.nodes[0].nodes[0], name: 'airi-bind-1' }] }] } }
      await compositor(path)
      const bridge = create({ SWAYSOCK: path })
      await bridge.start()
      expect(bridge.outputs()).toEqual([{ name: 'HEADLESS-1', ...screen, scale: 1 }])
      // The same evidence coordinates.ts hands the verifier: a bound window whose size matches, and mapped displays.
      const bound = bridge.ownWindows()?.find(window => window.caption === 'airi-bind-1')
      const displays = mapDisplaysToOutputs([{ bounds: screen, workArea: screen, scaleFactor: 1 }], bridge.outputs() ?? [])
      const report = vi.fn()
      const verifier = new CoordinateVerifier({ report, log: () => {}, now: () => 0 })
      verifier.observeGeometry({ sizeMatches: bound?.width === rect.width && bound.height === rect.height, displaysKnown: displays !== null })
      expect(report).toHaveBeenCalledWith({ geometryVerified: true })
      reply = { tree }
    })

    it('fails startup when the injected socket does not exist', async () => {
      const bridge = create({ SWAYSOCK: join(directory, 'missing.sock') })
      await bridge.start()
      expect(lastFailure()).toMatchObject({ backend: 'sway', bridgeFailure: 'other' })
      expect(bridge.activeWindow()).toBeNull()
    })
  })

  describe('hyprland', () => {
    const window = { address: '0xabc', at: [0, 0], size: [800, 600], class: 'konsole', title: 'Shell', pid: 42, fullscreen: 0 }
    const own = { ...window, address: '0xdef', class: 'airi', title: 'AIRI', pid }

    async function compositor(signature: string) {
      const path = join(directory, 'hypr', signature)
      await mkdir(path, { recursive: true })
      const replies: Record<string, unknown> = { 'j/activewindow': window, 'j/clients': [own, window] }
      const events: Socket[] = []
      const requests: string[] = []
      await listen(join(path, '.socket.sock'), socket => socket.once('data', (chunk) => {
        requests.push(chunk.toString())
        socket.end(JSON.stringify(replies[chunk.toString()] ?? null))
      }))
      await listen(join(path, '.socket2.sock'), socket => events.push(socket))
      return { replies, events, requests }
    }

    it('connects under the injected runtime directory and follows events', async () => {
      const { replies, events } = await compositor('instance')
      const bridge = create({ HYPRLAND_INSTANCE_SIGNATURE: 'instance' })
      await bridge.start()
      expect(facts).toHaveBeenCalledWith(expect.objectContaining({ backend: 'hyprland', bridge: 'ready' }))
      expect(bridge.activeWindow()).toEqual({ caption: 'Shell', resourceClass: 'konsole', desktopFileName: '', pid: 42, fullScreen: false })
      expect(bridge.ownWindows()).toEqual([{ id: '0xdef', pid, caption: 'AIRI', x: 0, y: 0, width: 800, height: 600 }])
      const focused = Promise.withResolvers<void>()
      bridge.onActive(active => active?.pid === pid && focused.resolve())
      replies['j/activewindow'] = own
      events[0].write('activewindowv2>>def\n')
      await focused.promise
      expect(bridge.activeWindow()).toMatchObject({ pid, caption: 'AIRI' })
    })

    it('reads the cursor on each tick only while streaming, through the bridge cursor path', async () => {
      const { replies, requests } = await compositor('instance')
      replies['j/cursorpos'] = { x: -120, y: 340 }
      const bridge = create({ HYPRLAND_INSTANCE_SIGNATURE: 'instance' })
      await bridge.start()
      const reads = () => requests.filter(command => command === 'j/cursorpos').length
      await bridge.requestCursor()
      expect(reads()).toBe(0)
      await bridge.setCursorStreaming(true)
      const cursor = vi.fn()
      bridge.onCursor(cursor)
      await bridge.requestCursor()
      expect(reads()).toBe(1)
      expect(bridge.cursor()).toEqual({ x: -120, y: 340 })
      expect(cursor).toHaveBeenCalledWith({ x: -120, y: 340 })
      await bridge.setCursorStreaming(false)
      await bridge.requestCursor()
      expect(reads()).toBe(1)
      expect(bridge.cursor()).toBeNull()
    })

    it('fails and clears readings when the event socket closes', async () => {
      const { events } = await compositor('instance')
      const bridge = create({ HYPRLAND_INSTANCE_SIGNATURE: 'instance' })
      await bridge.start()
      const failed = nextFact(patch => patch.bridge === 'failed')
      events[0].destroy()
      await failed
      expect(lastFailure()).toMatchObject({ backend: 'hyprland', bridgeFailure: 'other' })
      expect(bridge.activeWindow()).toBeNull()
      expect(bridge.ownWindows()).toBeNull()
    })

    it('rejects a signature that escapes the runtime directory before connecting', async () => {
      const bridge = create({ HYPRLAND_INSTANCE_SIGNATURE: '../instance' })
      await bridge.start()
      expect(lastFailure()).toMatchObject({ backend: 'hyprland', bridgeFailure: 'other' })
      expect(sockets.size).toBe(0)
    })
  })
})
