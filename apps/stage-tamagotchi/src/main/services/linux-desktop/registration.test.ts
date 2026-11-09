import type { Server, Socket } from 'node:net'

import type { LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pid } from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLinuxDesktopBridge } from './index'
import { PrivateBus } from './session/private-bus.test-helper'

const facts = vi.hoisted(() => vi.fn())
vi.mock('../electron/host-capabilities', () => ({ reportLinuxDesktop: facts }))
vi.mock('electron', () => ({ app: { getAppMetrics: () => [{ pid }] } }))

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

  describe('hyprland', () => {
    const window = { address: '0xabc', at: [0, 0], size: [800, 600], class: 'konsole', title: 'Shell', pid: 42, fullscreen: 0 }
    const own = { ...window, address: '0xdef', class: 'airi', title: 'AIRI', pid }

    async function compositor(signature: string) {
      const path = join(directory, 'hypr', signature)
      await mkdir(path, { recursive: true })
      const replies: Record<string, unknown> = { 'j/activewindow': window, 'j/clients': [own, window] }
      const events: Socket[] = []
      await listen(join(path, '.socket.sock'), socket => socket.once('data', chunk => socket.end(JSON.stringify(replies[chunk.toString()] ?? null))))
      await listen(join(path, '.socket2.sock'), socket => events.push(socket))
      return { replies, events }
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
