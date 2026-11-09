import type { Socket } from 'node:net'

import type { HyprlandMessage } from './protocol'
import type { HyprlandFailure } from './socket'

import { Buffer } from 'node:buffer'
import { createConnection } from 'node:net'
import { join } from 'node:path'

import { parseActive, parseCursor, parseEvent, parseOutputs, parseOwnWindows } from './protocol'
import { HyprlandBackendError, HyprlandRequests } from './socket'

export interface HyprlandBackendOptions {
  readonly env: { readonly XDG_RUNTIME_DIR?: string, readonly HYPRLAND_INSTANCE_SIGNATURE?: string }
  readonly ownPids: () => readonly number[]
  readonly onMessage: (message: HyprlandMessage) => void
  readonly onFailure: (reason: HyprlandFailure) => void
}

/** Part B owns bridge registration. This backend never starts its own cursor loop. */
export class HyprlandBackend {
  private eventSocket: Socket | undefined
  private requests: HyprlandRequests | undefined
  private lifecycle = new AbortController()
  private cursorRequest = new AbortController()
  private running = false
  private streaming = false
  private starting: Promise<void> | undefined
  private refreshing: Promise<void> | undefined
  private cursorPending: Promise<void> | undefined
  private dirty = false
  private active: ReturnType<typeof parseActive> = null
  private own: ReturnType<typeof parseOwnWindows> = null
  private point: ReturnType<typeof parseCursor> = null
  private screens: ReturnType<typeof parseOutputs> = null

  constructor(private readonly options: HyprlandBackendOptions) {}

  activeWindow() { return this.active }
  ownWindows() { return this.own }
  cursor() { return this.point }
  outputs() { return this.screens }

  start(): Promise<void> {
    if (this.starting)
      return this.starting
    const { XDG_RUNTIME_DIR: runtime, HYPRLAND_INSTANCE_SIGNATURE: signature } = this.options.env
    if (!runtime || !signature || signature.includes('/') || signature === '..')
      return Promise.reject(new HyprlandBackendError('transport-failed'))
    this.running = true
    this.lifecycle = new AbortController()
    const signal = this.lifecycle.signal
    const directory = join(runtime, 'hypr', signature)
    this.requests = new HyprlandRequests(join(directory, '.socket.sock'))
    this.starting = this.connectEvents(join(directory, '.socket2.sock'), signal)
      .then(() => this.refresh(signal))
      .catch((error: unknown) => {
        this.reportFailure(error, signal)
        throw error
      })
    return this.starting
  }

  async stop() {
    this.running = false
    this.streaming = false
    this.lifecycle.abort()
    this.cursorRequest.abort()
    this.eventSocket?.destroy()
    this.eventSocket = undefined
    this.requests = undefined
    this.starting = undefined
    this.refreshing = undefined
    this.cursorPending = undefined
    this.active = null
    this.own = null
    this.point = null
    this.screens = null
  }

  async setCursorStreaming(on: boolean) {
    if (this.streaming === on)
      return
    this.streaming = on
    this.cursorRequest.abort()
    this.cursorRequest = new AbortController()
    // A resting pointer remains valid. Only transport loss clears its value.
  }

  /** Called once by each renderer-paced tick; overlapping ticks share one request. */
  requestCursor(): Promise<void> {
    if (!this.running || !this.streaming)
      return Promise.resolve()
    if (this.cursorPending)
      return this.cursorPending
    const signal = this.lifecycle.signal
    const stream = this.cursorRequest.signal
    const request = this.requests
    if (!request)
      return Promise.resolve()
    const pending = request.request('j/cursorpos', AbortSignal.any([signal, stream]))
      .then((reply) => {
        if (signal.aborted || stream.aborted)
          return
        const point = parseCursor(reply)
        if (point) {
          this.point = point
          this.options.onMessage({ method: 'Cursor', payload: point })
        }
        else {
          this.reportFailure(new HyprlandBackendError('transport-failed'), signal)
        }
      })
      .catch((error: unknown) => {
        if (!stream.aborted)
          this.reportFailure(error, signal)
      })
      .finally(() => {
        if (this.cursorPending === pending)
          this.cursorPending = undefined
      })
    this.cursorPending = pending
    return pending
  }

  private connectEvents(path: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path)
      this.eventSocket = socket
      let buffer = ''
      const cancel = () => reject(new HyprlandBackendError('stopped'))
      const deadline = setTimeout(() => {
        reject(new HyprlandBackendError('request-timeout'))
        socket.destroy()
      }, 2000)
      const clean = () => {
        clearTimeout(deadline)
        signal.removeEventListener('abort', cancel)
      }
      signal.addEventListener('abort', cancel, { once: true })
      socket.setEncoding('utf8')
      socket.once('connect', () => {
        clean()
        resolve()
      })
      socket.once('error', () => {
        clean()
        reject(new HyprlandBackendError('transport-failed'))
        this.reportFailure(new HyprlandBackendError('transport-failed'), signal)
      })
      socket.once('close', () => {
        clean()
        reject(new HyprlandBackendError('transport-failed'))
        this.reportFailure(new HyprlandBackendError('transport-failed'), signal)
      })
      socket.on('data', (chunk: string) => {
        if (signal.aborted)
          return
        buffer += chunk
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          if (newline > 4096)
            return this.reportFailure(new HyprlandBackendError('reply-too-large'), signal)
          const event = parseEvent(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          if (event)
            void this.refresh(signal).catch((error: unknown) => this.reportFailure(error, signal))
          newline = buffer.indexOf('\n')
        }
        if (Buffer.byteLength(buffer) > 8192)
          this.reportFailure(new HyprlandBackendError('reply-too-large'), signal)
      })
    })
  }

  private refresh(signal: AbortSignal): Promise<void> {
    this.dirty = true
    if (this.refreshing)
      return this.refreshing
    const requests = this.requests
    if (!requests || signal.aborted)
      return Promise.reject(new HyprlandBackendError('stopped'))
    const refreshing = (async () => {
      while (this.dirty && !signal.aborted) {
        this.dirty = false
        const active = await requests.request('j/activewindow', signal)
        const own = await requests.request('j/clients', signal)
        const monitors = await requests.request('j/monitors', signal)
        if (signal.aborted)
          return
        const screens = parseOutputs(monitors)
        // A reply that cannot be read must not leave stale geometry behind, so it fails the backend as a bad cursor reply does.
        if (!screens)
          throw new HyprlandBackendError('transport-failed')
        this.screens = screens
        this.options.onMessage({ method: 'Outputs', payload: screens })
        this.active = parseActive(active)
        this.own = parseOwnWindows(own, this.options.ownPids())
        this.options.onMessage({ method: 'Active', payload: this.active })
        this.options.onMessage({ method: 'OwnWindows', payload: this.own })
      }
    })().finally(() => {
      if (this.refreshing === refreshing)
        this.refreshing = undefined
    })
    this.refreshing = refreshing
    return refreshing
  }

  private reportFailure(error: unknown, signal: AbortSignal) {
    if (signal.aborted || !this.running)
      return
    const failure = error instanceof HyprlandBackendError ? error.bridgeFailure : 'transport-failed'
    void this.stop()
    this.options.onFailure(failure)
  }
}
