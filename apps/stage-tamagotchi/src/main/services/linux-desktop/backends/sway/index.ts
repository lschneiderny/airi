import type { Buffer } from 'node:buffer'
import type { Socket } from 'node:net'

import type { Frame } from './ipc'
import type { Active, Output, OwnWindow } from './tree'

import { createConnection } from 'node:net'

import { object, safeParse, string } from 'valibot'

import { encodeRequest, FrameDecoder, SwayProtocolError } from './ipc'
import { readOutputs, readTree } from './tree'

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
  private pendingOutputs = false
  private outputsDirty = false
  private subscribed = false
  private readonly activeListeners = new Set<(active: Active) => void>()
  private readonly ownListeners = new Set<(windows: readonly OwnWindow[]) => void>()
  private readonly outputListeners = new Set<(outputs: readonly Output[]) => void>()

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

  onOutputs(listener: (outputs: readonly Output[]) => void): () => void {
    this.outputListeners.add(listener)
    return () => {
      this.outputListeners.delete(listener)
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
    this.pendingOutputs = false
    this.outputsDirty = false
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

  private requestOutputs() {
    if (this.pendingOutputs) {
      this.outputsDirty = true
      return
    }
    this.pendingOutputs = true
    this.armDeadline()
    this.socket?.write(encodeRequest(3))
  }

  /** Replies arrive in request order; the deadline stays armed while either request is unanswered. */
  private settleDeadline() {
    if (this.pendingTree || this.pendingOutputs)
      this.armDeadline()
    else
      clearTimeout(this.deadline)
  }

  private receive(frame: Frame) {
    switch (frame.type) {
      case 2:
        if (this.subscribed || typeof frame.payload !== 'object' || !frame.payload || !('success' in frame.payload) || frame.payload.success !== true)
          throw new SwayProtocolError()
        this.subscribed = true
        // Outputs are requested first, so they reach the bridge before the tree reply makes it ready.
        this.requestOutputs()
        this.requestTree()
        break
      case 3: {
        if (!this.pendingOutputs)
          throw new SwayProtocolError()
        const outputs = readOutputs(frame.payload)
        this.pendingOutputs = false
        this.settleDeadline()
        for (const listener of this.outputListeners)
          listener(outputs)
        if (this.outputsDirty) {
          this.outputsDirty = false
          this.requestOutputs()
        }
        break
      }
      case 4: {
        if (!this.pendingTree)
          throw new SwayProtocolError()
        const snapshot = readTree(frame.payload, this.options.ownPids())
        this.pendingTree = false
        this.settleDeadline()
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
      case 0x80000001: {
        // Output events: an output was added, removed or changed mode, scale or position.
        if (!this.subscribed)
          throw new SwayProtocolError()
        this.requestOutputs()
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
