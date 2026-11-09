import type { Buffer } from 'node:buffer'
import type { Socket } from 'node:net'

import type { Frame } from './ipc'
import type { Active, OwnWindow } from './tree'

import { createConnection } from 'node:net'

import { object, safeParse, string } from 'valibot'

import { encodeRequest, FrameDecoder, SwayProtocolError } from './ipc'
import { readTree } from './tree'

export type SwayFailure = 'socket-unavailable' | 'transport-failed' | 'socket-closed' | 'protocol-failed' | 'request-timeout' | 'stopped'

export class SwayBackendError extends Error {
  constructor(readonly bridgeFailure: SwayFailure) {
    super(`Sway bridge failed: ${bridgeFailure}`)
    this.name = 'SwayBackendError'
  }
}

export interface SwayBackendOptions {
  readonly socketPath: string
  readonly ownPids: () => readonly number[]
  readonly onFailure: (reason: SwayFailure) => void
}

/** Read-only, event-driven IPC. A failed connection requires an explicit start. */
export class SwayBackend {
  private socket: Socket | undefined
  private starting: Promise<void> | undefined
  private startup: ReturnType<typeof Promise.withResolvers<void>> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  private pendingTree = false
  private dirty = false
  private subscribed = false
  private readonly activeListeners = new Set<(active: Active) => void>()
  private readonly ownListeners = new Set<(windows: readonly OwnWindow[]) => void>()

  constructor(private readonly options: SwayBackendOptions) {}

  onActive(listener: (active: Active) => void): () => void {
    this.activeListeners.add(listener)
    return () => {
      this.activeListeners.delete(listener)
    }
  }

  onOwnWindows(listener: (windows: readonly OwnWindow[]) => void): () => void {
    this.ownListeners.add(listener)
    return () => {
      this.ownListeners.delete(listener)
    }
  }

  start(): Promise<void> {
    if (this.starting)
      return this.starting
    const path = this.options.socketPath
    if (!path) {
      this.options.onFailure('socket-unavailable')
      return Promise.reject(new SwayBackendError('socket-unavailable'))
    }
    this.startup = Promise.withResolvers<void>()
    this.starting = this.startup.promise
    this.pendingTree = false
    this.dirty = false
    this.subscribed = false
    const decoder = new FrameDecoder()
    const socket = createConnection(path)
    this.socket = socket
    this.armDeadline()
    socket.on('connect', () => {
      if (this.socket === socket)
        socket.write(encodeRequest(2))
    })
    socket.on('data', (chunk: Buffer) => {
      if (this.socket !== socket)
        return
      try {
        for (const frame of decoder.push(chunk)) {
          if (this.socket !== socket)
            break
          this.receive(frame)
        }
      }
      catch (error) {
        if (error instanceof SwayProtocolError)
          this.fail('protocol-failed')
        else
          throw error
      }
    })
    socket.on('error', () => {
      if (this.socket === socket)
        this.fail('transport-failed')
    })
    socket.on('close', () => {
      if (this.socket !== socket)
        return
      try {
        decoder.finish()
        this.fail('socket-closed')
      }
      catch (error) {
        if (error instanceof SwayProtocolError)
          this.fail('protocol-failed')
        else
          throw error
      }
    })
    return this.starting
  }

  async stop(): Promise<void> {
    const socket = this.socket
    const closed = socket && !socket.closed
      ? new Promise<void>(resolve => socket.once('close', () => resolve()))
      : Promise.resolve()
    this.clear()
    this.startup?.reject(new SwayBackendError('stopped'))
    this.startup = undefined
    socket?.destroy()
    await closed
  }

  private clear() {
    clearTimeout(this.deadline)
    this.deadline = undefined
    this.socket = undefined
    this.starting = undefined
  }

  private fail(reason: SwayFailure) {
    const socket = this.socket
    this.clear()
    this.startup?.reject(new SwayBackendError(reason))
    this.startup = undefined
    socket?.destroy()
    this.options.onFailure(reason)
  }

  private armDeadline() {
    clearTimeout(this.deadline)
    this.deadline = setTimeout(() => this.fail('request-timeout'), 2000)
  }

  private requestTree() {
    if (this.pendingTree) {
      this.dirty = true
      return
    }
    this.pendingTree = true
    this.armDeadline()
    this.socket?.write(encodeRequest(4))
  }

  private receive(frame: Frame) {
    switch (frame.type) {
      case 2:
        if (this.subscribed || typeof frame.payload !== 'object' || !frame.payload || !('success' in frame.payload) || frame.payload.success !== true)
          throw new SwayProtocolError()
        this.subscribed = true
        this.requestTree()
        break
      case 4: {
        if (!this.pendingTree)
          throw new SwayProtocolError()
        const snapshot = readTree(frame.payload, this.options.ownPids())
        this.pendingTree = false
        clearTimeout(this.deadline)
        for (const listener of this.activeListeners)
          listener(snapshot.active)
        for (const listener of this.ownListeners)
          listener(snapshot.ownWindows)
        this.startup?.resolve()
        this.startup = undefined
        if (this.dirty) {
          this.dirty = false
          this.requestTree()
        }
        break
      }
      case 0x80000003: {
        const result = safeParse(object({ change: string() }), frame.payload)
        if (!result.success || !this.subscribed)
          throw new SwayProtocolError()
        // New/close/move/floating also change own-window binding or geometry.
        this.requestTree()
        break
      }
      default:
        throw new SwayProtocolError()
    }
  }
}
