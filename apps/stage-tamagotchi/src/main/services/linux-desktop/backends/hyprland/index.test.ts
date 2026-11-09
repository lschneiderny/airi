import type { Socket } from 'node:net'

import type { HyprlandMessage } from './protocol'

import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HyprlandBackend } from './index'

describe('hyprland socket backend', () => {
  let directory: string
  let backend: HyprlandBackend
  let eventSocket: Socket
  let replies: Record<string, string>
  let requests: string[]
  let held: string | undefined
  let reached: ReturnType<typeof Promise.withResolvers<void>>
  const sockets = new Set<Socket>()
  const requestServer = createServer()
  const eventServer = createServer()
  const messages: HyprlandMessage[] = []
  const failures = vi.fn()
  let receive: ((message: HyprlandMessage) => void) | undefined

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-hypr-'))
    const path = join(directory, 'hypr', 'test')
    await mkdir(path, { recursive: true })
    replies = Object.fromEntries(await Promise.all(
      [['j/activewindow', 'activewindow'], ['j/clients', 'clients'], ['j/cursorpos', 'cursorpos'], ['j/monitors', 'monitors']].map(async ([command, name]) =>
        [command, await readFile(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8')]),
    ))
    requests = []
    messages.length = 0
    held = undefined
    reached = Promise.withResolvers<void>()
    failures.mockClear()
    receive = undefined
    requestServer.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('error', () => socket.destroy())
      socket.on('close', () => sockets.delete(socket))
      socket.once('data', (chunk) => {
        const command = chunk.toString()
        requests.push(command)
        if (command === held) {
          reached.resolve()
          return
        }
        socket.end(replies[command] ?? 'unknown request')
      })
    })
    eventServer.on('connection', (socket) => {
      eventSocket = socket
      sockets.add(socket)
      socket.on('error', () => socket.destroy())
      socket.on('close', () => sockets.delete(socket))
    })
    requestServer.listen(join(path, '.socket.sock'))
    eventServer.listen(join(path, '.socket2.sock'))
    await Promise.all([once(requestServer, 'listening'), once(eventServer, 'listening')])
    backend = new HyprlandBackend({
      env: { XDG_RUNTIME_DIR: directory, HYPRLAND_INSTANCE_SIGNATURE: 'test' },
      ownPids: () => [100],
      onMessage: (message) => {
        messages.push(message)
        receive?.(message)
      },
      onFailure: failures,
    })
  })

  afterEach(async () => {
    await backend.stop()
    vi.useRealTimers()
    for (const socket of sockets)
      socket.destroy()
    await Promise.all([new Promise<void>(resolve => requestServer.close(() => resolve())), new Promise<void>(resolve => eventServer.close(() => resolve()))])
    requestServer.removeAllListeners()
    eventServer.removeAllListeners()
    await rm(directory, { recursive: true, force: true })
  })

  function nextActive() {
    const next = Promise.withResolvers<HyprlandMessage>()
    receive = (message) => {
      if (message.method === 'Active')
        next.resolve(message)
    }
    return next.promise
  }

  it('refreshes Active after a split event and writes only the four read requests', async () => {
    await backend.start()
    expect(backend.ownWindows()).toEqual([{ id: '0xdef', pid: 100, caption: 'airi-bind-1', x: -10, y: 50, width: 400, height: 500 }])
    replies['j/activewindow'] = replies['j/activewindow'].replace('org.kde.konsole', 'new.app')
    const active = nextActive()
    eventSocket.write('activewindowv')
    eventSocket.write('2>>abc\n')
    expect(await active).toMatchObject({ method: 'Active', payload: { resourceClass: 'new.app' } })
    await backend.setCursorStreaming(true)
    await backend.requestCursor()
    expect(backend.cursor()).toEqual({ x: -120, y: 340 })
    // This guards the read-only compositor protocol boundary.
    expect(requests.every(command => ['j/activewindow', 'j/clients', 'j/cursorpos', 'j/monitors'].includes(command))).toBe(true)
    expect(new Set(requests)).toEqual(new Set(['j/activewindow', 'j/clients', 'j/cursorpos', 'j/monitors']))
  })

  it('publishes monitors as Outputs before the first snapshot completes and refreshes them on monitor events', async () => {
    await backend.start()
    const expected = [
      { name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      { name: 'HDMI-A-1', x: 1920, y: -100, width: 2560, height: 1440, scale: 1.5 },
    ]
    expect(backend.outputs()).toEqual(expected)
    expect(messages.filter(message => message.method === 'Outputs')).toEqual([{ method: 'Outputs', payload: expected }])
    expect(messages.findIndex(message => message.method === 'Outputs')).toBeLessThan(messages.findIndex(message => message.method === 'Active'))
    for (const event of ['monitoradded>>HDMI-A-1\n', 'monitorremovedv2>>1,HDMI-A-1,Vendor Panel\n']) {
      replies['j/monitors'] = JSON.stringify([{ ...JSON.parse(replies['j/monitors'])[0], width: 2560, height: 1440 }])
      const changed = Promise.withResolvers<HyprlandMessage>()
      receive = (message) => {
        if (message.method === 'Outputs')
          changed.resolve(message)
      }
      eventSocket.write(event)
      expect(await changed.promise).toEqual({ method: 'Outputs', payload: [{ name: 'DP-1', x: 0, y: 0, width: 2560, height: 1440, scale: 1 }] })
    }
    expect(failures).not.toHaveBeenCalled()
  })

  it('fails closed without publishing Outputs when the monitors reply is malformed', async () => {
    replies['j/monitors'] = 'private-name is not JSON'
    await expect(backend.start()).rejects.toMatchObject({ bridgeFailure: 'transport-failed' })
    expect(failures).toHaveBeenCalledExactlyOnceWith('transport-failed')
    expect(messages.some(message => message.method === 'Outputs')).toBe(false)
    expect(backend.outputs()).toBeNull()
  })

  it('publishes null without throwing for malformed activewindow replies', async () => {
    replies['j/activewindow'] = 'private-title is not JSON'
    await backend.start()
    expect(backend.activeWindow()).toBeNull()
    expect(messages).toContainEqual({ method: 'Active', payload: null })
    expect(failures).not.toHaveBeenCalled()
  })

  it.each(['windowtitlev2>>abc,title >> fullscreen>>0\n', 'fullscreen>>0\n', 'activewindowv2>>\n'])('refreshes on event %# without treating its title as a command', async (event) => {
    await backend.start()
    replies['j/activewindow'] = '{}'
    const active = nextActive()
    eventSocket.write(event)
    expect(await active).toEqual({ method: 'Active', payload: null })
  })

  it('keeps cursor requests off until streaming and coalesces overlapping ticks', async () => {
    await backend.start()
    await backend.requestCursor()
    expect(requests).toEqual(['j/activewindow', 'j/clients', 'j/monitors'])
    await backend.setCursorStreaming(true)
    held = 'j/cursorpos'
    const first = backend.requestCursor()
    await reached.promise
    const second = backend.requestCursor()
    await backend.setCursorStreaming(false)
    await Promise.all([first, second])
    expect(requests.filter(command => command === 'j/cursorpos')).toHaveLength(1)
    expect(messages.filter(message => message.method === 'Cursor')).toEqual([])
  })

  it('retains a resting cursor while streaming is disabled', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    await backend.requestCursor()
    await backend.setCursorStreaming(false)
    await backend.requestCursor()
    expect(backend.cursor()).toEqual({ x: -120, y: 340 })
    expect(requests.filter(command => command === 'j/cursorpos')).toHaveLength(1)
  })

  it('reports event socket closure and clears all cached readings', async () => {
    await backend.start()
    const failed = Promise.withResolvers<void>()
    failures.mockImplementationOnce(() => failed.resolve())
    eventSocket.end()
    await failed.promise
    expect(failures).toHaveBeenCalledExactlyOnceWith('transport-failed')
    expect([backend.activeWindow(), backend.ownWindows(), backend.cursor(), backend.outputs()]).toEqual([null, null, null, null])
    await backend.requestCursor()
  })

  it('rejects oversized replies and reports transport failure without publishing titles', async () => {
    replies['j/activewindow'] = 'x'.repeat(1048577)
    await expect(backend.start()).rejects.toMatchObject({ bridgeFailure: 'reply-too-large' })
    expect(failures).toHaveBeenCalledExactlyOnceWith('reply-too-large')
    expect(backend.activeWindow()).toBeNull()
  })

  it('bounds an unterminated oversized event', async () => {
    await backend.start()
    const failed = Promise.withResolvers<void>()
    failures.mockImplementationOnce(() => failed.resolve())
    eventSocket.write('x'.repeat(8193))
    await failed.promise
    expect(failures).toHaveBeenCalledExactlyOnceWith('reply-too-large')
  })

  it('fails closed for malformed cursor replies', async () => {
    await backend.start()
    await backend.setCursorStreaming(true)
    replies['j/cursorpos'] = 'not JSON'
    await backend.requestCursor()
    expect(backend.cursor()).toBeNull()
    expect(failures).toHaveBeenCalledExactlyOnceWith('transport-failed')
  })

  it('bounds a hung reply by an absolute two second deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    held = 'j/activewindow'
    const starting = backend.start()
    const rejected = expect(starting).rejects.toMatchObject({ bridgeFailure: 'request-timeout' })
    await reached.promise
    await vi.advanceTimersByTimeAsync(2000)
    await rejected
    expect(failures).toHaveBeenCalledExactlyOnceWith('request-timeout')
  })

  it('cancels an in-flight start on stop and can start again', async () => {
    held = 'j/activewindow'
    const starting = backend.start()
    const rejected = expect(starting).rejects.toMatchObject({ bridgeFailure: 'stopped' })
    await reached.promise
    await backend.stop()
    await rejected
    held = undefined
    await backend.start()
    expect(backend.activeWindow()?.pid).toBe(42)
    expect(failures).not.toHaveBeenCalled()
  })
})
