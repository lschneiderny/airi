/**
 * Shared Chrome DevTools Protocol helpers for scripts that launch the real
 * Electron app (via `APP_REMOTE_DEBUG`) and talk to one of its renderers over
 * CDP: the stage-tamagotchi smoke scripts and the qa-tools T3 harness. Kept in
 * one module so the wait/retry and protocol-framing pieces stay in one place.
 * Every wait is bounded: `waitFor` by its timeout (an attempt still running at
 * the deadline is abandoned and its signal aborted, which cancels `fetchJson`),
 * `connect` and `send` by `timeoutMs`.
 */

/** Default bound for one CDP command; long-running evaluations pass their own. */
export const defaultCdpTimeoutMs = 30_000

export interface DebugTarget {
  id: string
  title: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function findAvailablePort(): Promise<number> {
  const { createServer } = await import('node:net')

  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolvePort(address.port)
        }
        else {
          reject(new Error('failed to allocate debug port'))
        }
      })
    })
    server.on('error', reject)
  })
}

/**
 * Polls `probe` until it returns a defined value or `timeoutMs` elapses.
 * Electron's remote-debug endpoint and a renderer's readiness both come up
 * asynchronously after the process starts, so callers throughout the smoke
 * scripts wait on this instead of a fixed sleep.
 *
 * The deadline is enforced even when an attempt never settles: the attempt is
 * raced against the remaining time, and its `signal` is aborted at the
 * deadline so a probe that passes it on (for example to `fetchJson`) cancels
 * its request.
 */
export async function waitFor<T>(
  label: string,
  probe: (signal: AbortSignal) => Promise<T | undefined> | T | undefined,
  timeoutMs: number,
  intervalMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  const timedOut = () => {
    const suffix = lastError instanceof Error ? `: ${lastError.message}` : ''
    return new Error(`${label} timed out after ${timeoutMs}ms${suffix}`)
  }

  while (Date.now() < deadline) {
    const attempt = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<'expired'>((resolveExpired) => {
      timer = setTimeout(resolveExpired, Math.max(0, deadline - Date.now()), 'expired')
    })
    const running = Promise.resolve().then(() => probe(attempt.signal))
    // An abandoned attempt may still reject later (for example with the abort error); that outcome is not needed.
    running.catch(() => {})
    try {
      const outcome = await Promise.race([running, expired])
      if (outcome === 'expired') {
        attempt.abort(new Error(`${label} attempt abandoned at the deadline`))
        lastError = lastError ?? new Error('the last attempt did not settle')
        throw timedOut()
      }
      if (outcome !== undefined)
        return outcome as T
    }
    catch (error) {
      if (attempt.signal.aborted)
        throw error
      lastError = error
    }
    finally {
      clearTimeout(timer)
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  }

  throw timedOut()
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok)
    throw new Error(`${url} returned ${response.status}`)
  return await response.json() as T
}

export async function waitForRemoteDebug(debugPort: number, timeoutMs = 120_000): Promise<string> {
  return await waitFor('Electron remote debug endpoint', async (signal) => {
    const data = await fetchJson<{ webSocketDebuggerUrl?: string }>(`http://127.0.0.1:${debugPort}/json/version`, signal)
    return data.webSocketDebuggerUrl
  }, timeoutMs, 500)
}

export async function findDebugTarget(debugPort: number, label: string, predicate: (target: DebugTarget) => boolean, timeoutMs = 120_000): Promise<DebugTarget> {
  return await waitFor(label, async (signal) => {
    const targets = await fetchJson<DebugTarget[]>(`http://127.0.0.1:${debugPort}/json/list`, signal)
    return targets.find(predicate)
  }, timeoutMs, 500)
}

/**
 * Minimal CDP client: enough to send commands, await their matching
 * response by id, and observe protocol events by method name. Smoke scripts
 * only ever drive one target at a time, so events are not scoped by
 * `sessionId`.
 */
export class CdpClient {
  private socket?: WebSocket
  private nextId = 1
  private eventListeners = new Map<string, Set<(params: Record<string, unknown>) => void>>()
  private pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void
    reject: (error: Error) => void
  }>()

  constructor(socket: WebSocket) {
    this.socket = socket
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>
      const id = typeof payload.id === 'number' ? payload.id : undefined
      if (id === undefined) {
        // Messages without `id` are protocol events, not command responses.
        if (typeof payload.method === 'string')
          this.emitEvent(payload.method, isRecord(payload.params) ? payload.params : {})
        return
      }

      const pending = this.pending.get(id)
      if (!pending)
        return

      this.pending.delete(id)
      if (payload.error) {
        pending.reject(new Error(JSON.stringify(payload.error)))
      }
      else {
        pending.resolve(payload)
      }
    })
    this.socket.addEventListener('close', () => {
      this.failPending('CDP socket closed')
    })
    this.socket.addEventListener('error', () => {
      this.failPending('CDP socket errored')
    })
  }

  static async connect(url: string, timeoutMs = defaultCdpTimeoutMs): Promise<CdpClient> {
    const socket = new WebSocket(url)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolveOpen, reject) => {
        timer = setTimeout(() => {
          socket.close()
          reject(new Error(`CDP connect to ${url} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        socket.addEventListener('open', () => resolveOpen(), { once: true })
        socket.addEventListener('error', () => reject(new Error(`failed to connect CDP target: ${url}`)), { once: true })
      })
    }
    finally {
      clearTimeout(timer)
    }
    return new CdpClient(socket)
  }

  /**
   * Subscribes to a CDP event such as `Runtime.exceptionThrown`. The caller
   * must still enable the owning domain (e.g. `Runtime.enable`). Returns an
   * unsubscribe function.
   */
  on(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    let listeners = this.eventListeners.get(method)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(method, listeners)
    }
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Sends one command and awaits its response; rejects when no response arrives within `timeoutMs`. */
  async send(method: string, params?: Record<string, unknown>, timeoutMs = defaultCdpTimeoutMs): Promise<Record<string, unknown>> {
    if (!this.socket) {
      throw new Error('CDP socket is closed')
    }

    const id = this.nextId++
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<Record<string, unknown>>((resolveMessage, reject) => {
      this.pending.set(id, { resolve: resolveMessage, reject })
      timer = setTimeout(() => {
        if (this.pending.delete(id))
          reject(new Error(`CDP ${method} (request ${id}) timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    this.socket.send(JSON.stringify({ id, method, params: params ?? {} }))
    try {
      return await promise
    }
    finally {
      clearTimeout(timer)
    }
  }

  async evaluate<T>(expression: string, timeoutMs = defaultCdpTimeoutMs): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs)
    const result = response.result
    if (!isRecord(result))
      throw new Error('Runtime.evaluate missing result')

    const exceptionDetails = result.exceptionDetails
    if (exceptionDetails) {
      throw new Error(JSON.stringify(exceptionDetails))
    }

    const remoteObject = result.result
    if (!isRecord(remoteObject))
      throw new Error('Runtime.evaluate missing remote object')

    return remoteObject.value as T
  }

  close() {
    this.failPending('CDP socket closed')
    this.socket?.close()
    this.socket = undefined
  }

  private emitEvent(method: string, params: Record<string, unknown>) {
    for (const listener of this.eventListeners.get(method) ?? [])
      listener(params)
  }

  private failPending(reason: string) {
    if (this.pending.size === 0) {
      return
    }

    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      pending.reject(new Error(`${reason} before completing request ${id}`))
    }
  }
}
