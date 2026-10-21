import type { AddressInfo } from 'node:net'

import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CdpClient, waitFor, waitForRemoteDebug } from './remote-debug'

afterEach(() => {
  vi.restoreAllMocks()
})

function createMockSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    addEventListener: (event: string, listener: (...args: unknown[]) => void) => void
  }
  socket.send = vi.fn()
  socket.close = vi.fn(() => {
    socket.emit('close')
  })
  socket.addEventListener = (event, listener) => {
    socket.on(event, listener)
  }
  return socket
}

describe('waitFor', () => {
  it('rejects at its deadline when an attempt never settles, and aborts that attempt', async () => {
    vi.useFakeTimers()
    try {
      let seen: AbortSignal | undefined
      const waiting = waitFor('never-settling probe', (signal) => {
        seen = signal
        return new Promise<undefined>(() => {})
      }, 20, 1)
      const assertion = expect(waiting).rejects.toThrow('never-settling probe timed out after 20ms')
      await vi.advanceTimersByTimeAsync(20)
      await assertion
      expect(seen?.aborted).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('waitForRemoteDebug', () => {
  it('rejects at its bound against an endpoint that accepts the request and never answers, and cancels the request', async () => {
    const server = createServer(() => {})
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      // The aborted request emits `error: aborted` before `close`; that error is the expected outcome here.
      const requestClosed = once(server, 'request').then(([request]) => new Promise<void>((resolveClosed) => {
        request.on('error', () => {})
        request.on('close', () => resolveClosed())
      }))
      const port = (server.address() as AddressInfo).port
      await expect(waitForRemoteDebug(port, 300)).rejects.toThrow('Electron remote debug endpoint timed out after 300ms')
      // The aborted fetch closes its connection, so the hung request ends instead of lingering.
      await requestClosed
    }
    finally {
      server.closeAllConnections()
      server.close()
    }
  })
})

describe('cdpClient', () => {
  it('rejects pending requests when the socket closes', async () => {
    const socket = createMockSocket()
    const client = new CdpClient(socket as never)

    const pending = client.send('Runtime.evaluate', { expression: '1 + 1' })
    expect(socket.send).toHaveBeenCalledTimes(1)

    client.close()

    await expect(pending).rejects.toThrow('CDP socket closed before completing request 1')
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('rejects a request that gets no response within its timeout and forgets it', async () => {
    vi.useFakeTimers()
    try {
      const socket = createMockSocket()
      const client = new CdpClient(socket as never)

      const pending = client.send('Runtime.evaluate', { expression: 'new Promise(() => {})' }, 1_000)
      const assertion = expect(pending).rejects.toThrow('CDP Runtime.evaluate (request 1) timed out after 1000ms')
      await vi.advanceTimersByTimeAsync(1_000)
      await assertion

      // A late response for the timed-out id is ignored instead of resolving anything.
      socket.emit('message', { data: JSON.stringify({ id: 1, result: {} }) })
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('dispatches protocol events to method listeners without touching pending requests', async () => {
    const socket = createMockSocket()
    const client = new CdpClient(socket as never)
    const listener = vi.fn()
    const unsubscribe = client.on('Runtime.exceptionThrown', listener)

    const pending = client.send('Runtime.enable')
    socket.emit('message', { data: JSON.stringify({ method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'boom' } } }) })
    socket.emit('message', { data: JSON.stringify({ id: 1, result: {} }) })

    await expect(pending).resolves.toEqual({ id: 1, result: {} })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ exceptionDetails: { text: 'boom' } })

    unsubscribe()
    socket.emit('message', { data: JSON.stringify({ method: 'Runtime.exceptionThrown', params: {} }) })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
