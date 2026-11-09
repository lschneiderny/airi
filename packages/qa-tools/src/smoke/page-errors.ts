import type { DebugTarget } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { errorMessageFrom } from '@moeru/std'
import { CdpClient, fetchJson, isRecord } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

/** `exception`: an uncaught error or unhandled rejection. `console`: `console.error` or a failed `console.assert`. `log`: a browser-reported error such as a failed resource load. */
export type PageErrorKind = 'exception' | 'console' | 'log'

export interface PageError {
  kind: PageErrorKind
  /** The window, as the hash route of its URL (`#/`, `#/chat-floating`), or the full URL without a hash route. */
  target: string
  text: string
  /** `url:line` of the first stack frame or the reporting resource, when known. */
  source?: string
  at: number
}

/** Names a window by its hash route, so the stage, chat, and settings windows stay distinguishable in a report. */
export function targetLabel(url: string): string {
  const hash = url.indexOf('#')
  return hash === -1 ? url : url.slice(hash)
}

function remoteObjectText(value: unknown): string {
  if (!isRecord(value))
    return String(value)
  if (value.value !== undefined)
    return typeof value.value === 'string' ? value.value : JSON.stringify(value.value)
  if (typeof value.unserializableValue === 'string')
    return value.unserializableValue
  if (typeof value.description === 'string')
    return value.description
  return String(value.type ?? 'unknown')
}

function frameSource(stackTrace: unknown): string | undefined {
  if (!isRecord(stackTrace) || !Array.isArray(stackTrace.callFrames))
    return undefined
  const frame: unknown = stackTrace.callFrames[0]
  if (!isRecord(frame) || typeof frame.url !== 'string' || !frame.url)
    return undefined
  return `${frame.url}:${Number(frame.lineNumber ?? 0) + 1}`
}

/** Converts one CDP event into a page error, or `null` when the event is not an error. */
export function pageErrorFrom(method: string, params: Record<string, unknown>, target: string, at: number): PageError | null {
  if (method === 'Runtime.exceptionThrown') {
    const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : {}
    const description = isRecord(details.exception) && typeof details.exception.description === 'string' ? details.exception.description : undefined
    const text = description ?? (typeof details.text === 'string' ? details.text : 'Uncaught exception')
    const source = typeof details.url === 'string' && details.url ? `${details.url}:${Number(details.lineNumber ?? 0) + 1}` : frameSource(details.stackTrace)
    return { kind: 'exception', target, text, source, at }
  }
  if (method === 'Runtime.consoleAPICalled') {
    if (params.type !== 'error' && params.type !== 'assert')
      return null
    const args = Array.isArray(params.args) ? params.args : []
    return { kind: 'console', target, text: args.map(remoteObjectText).join(' '), source: frameSource(params.stackTrace), at }
  }
  if (method === 'Log.entryAdded') {
    const entry = isRecord(params.entry) ? params.entry : {}
    if (entry.level !== 'error')
      return null
    const source = typeof entry.url === 'string' && entry.url ? entry.url : undefined
    return { kind: 'log', target, text: String(entry.text ?? ''), source, at }
  }
  return null
}

const watchedEvents = ['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'] as const

/**
 * Collects renderer errors from every app window over CDP, including windows opened after `start`. Enabling the
 * Runtime and Log domains replays the messages V8 and the browser buffered before the attach, so errors from the
 * first paint still count. Devtools frontends are skipped.
 */
export class PageErrorCollector {
  readonly errors: PageError[] = []
  /** Every window the collector attached to, as `targetLabel` values. */
  readonly targets: string[] = []
  private readonly failures = new Map<string, string>()
  private readonly clients = new Map<string, CdpClient>()
  private timer: ReturnType<typeof setInterval> | undefined
  private polling: Promise<void> | undefined

  constructor(private readonly port: number, private readonly now: () => number = Date.now) {}

  /** Windows that could never be attached. Any entry makes a clean result unproven. */
  get attachErrors(): string[] {
    return [...this.failures.values()]
  }

  start(intervalMs = 500): Promise<void> {
    this.timer = setInterval(() => void this.poll(), intervalMs)
    return this.poll()
  }

  /** Attaches to new page targets. Overlapping calls share one pass. */
  poll(): Promise<void> {
    this.polling ??= this.attachNew().finally(() => {
      this.polling = undefined
    })
    return this.polling
  }

  /** Attaches to any last windows, then closes every connection. */
  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.poll()
    for (const client of this.clients.values())
      client.close()
    this.clients.clear()
  }

  private async attachNew(): Promise<void> {
    let list: DebugTarget[]
    try {
      list = await fetchJson<DebugTarget[]>(`http://127.0.0.1:${this.port}/json/list`, AbortSignal.timeout(5_000))
    }
    catch {
      // The endpoint disappears during teardown; windows that are already attached keep reporting.
      return
    }
    for (const target of list) {
      if (target.type !== 'page' || !target.webSocketDebuggerUrl || target.url.startsWith('devtools://') || this.clients.has(target.id))
        continue
      const label = targetLabel(target.url)
      let client: CdpClient | undefined
      try {
        client = await CdpClient.connect(target.webSocketDebuggerUrl, 5_000)
        for (const method of watchedEvents) {
          client.on(method, (params) => {
            const error = pageErrorFrom(method, params, label, this.now())
            if (error)
              this.errors.push(error)
          })
        }
        await client.send('Runtime.enable', {}, 5_000)
        await client.send('Log.enable', {}, 5_000)
        this.clients.set(target.id, client)
        this.failures.delete(target.id)
        this.targets.push(label)
      }
      catch (error) {
        // A window that is still loading can refuse the attach; the next poll retries it.
        client?.close()
        this.failures.set(target.id, `${label}: ${errorMessageFrom(error) ?? 'attach failed'}`)
      }
    }
  }
}
