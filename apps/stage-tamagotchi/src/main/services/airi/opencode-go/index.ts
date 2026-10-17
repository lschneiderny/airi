import type { BrowserWindow, IpcMainEvent } from 'electron'
import type { BaseIssue, BaseSchema } from 'valibot'

import type { GoResponse } from '../../../../shared/eventa/opencode-go'

import { randomUUID } from 'node:crypto'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'
import { maxLength, minLength, optional, parse, picklist, pipe, regex, strictObject, string } from 'valibot'

import { goCancelRequest, goGetConfiguration, goOpenRequest, goReadChunk, goSetConfiguration } from '../../../../shared/eventa/opencode-go'
import { Credentials } from './credentials'

const identifier = pipe(string(), minLength(1), maxLength(256), regex(/^[\w.:/-]+$/))
const profileSchema = strictObject({ providerId: identifier })
const updateSchema = strictObject({ providerId: identifier, apiKey: pipe(string(), maxLength(16384)) })
const requestSchema = strictObject({
  providerId: identifier,
  requestId: identifier,
  operation: picklist(['models', 'chat']),
  sessionId: optional(identifier),
  body: optional(pipe(string(), maxLength(16 * 1024 * 1024))),
})
const pullSchema = strictObject({ requestId: identifier })
function parseInput<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(schema: TSchema, input: unknown) {
  try {
    return parse(schema, input)
  }
  catch {
    // Valibot issues contain original input. Never serialize them through IPC.
    throw new Error('Invalid OpenCode Go input')
  }
}

interface Binding {
  window: BrowserWindow
  adapter: ReturnType<typeof createContext>
  close: () => void
  navigate: (_event: Electron.Event, url: string, isInPlace: boolean, isMainFrame: boolean) => void
  gone: () => void
}
interface RequestState {
  owner: Binding
  providerId: string
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  reader?: ReadableStreamDefaultReader<Uint8Array>
  reading: boolean
  opened: boolean
}

/**
 * Main owns encrypted profiles and live requests. Each request is scoped to its
 * window, not just its renderer-selected ID. No response is read before a pull.
 */
class GoNetworkService {
  private readonly credentials = new Credentials()
  private readonly bindings = new Map<BrowserWindow, Binding>()
  private readonly requests = new Map<Binding, Map<string, RequestState>>()
  private readonly validationSession = `airi-validation-${randomUUID()}`
  private disposed = false

  private authorize(binding: Binding, options?: { raw?: { ipcMainEvent?: IpcMainEvent } }) {
    const event = options?.raw?.ipcMainEvent
    const requests = this.requests.get(binding)
    if (this.disposed || !requests || !this.bindings.has(binding.window) || binding.window.isDestroyed()
      || !event || event.sender !== binding.window.webContents
      || !event.senderFrame || event.senderFrame !== binding.window.webContents.mainFrame) {
      throw new Error('OpenCode Go caller is not authorized')
    }
    return requests
  }

  private cancel(binding: Binding, requestId: string) {
    const state = this.requests.get(binding)?.get(requestId)
    if (!state)
      return
    this.requests.get(binding)?.delete(requestId)
    clearTimeout(state.timer)
    state.controller.abort()
    if (state.reader) {
      const reader = state.reader
      void reader.cancel().catch((error) => {
        // Abort already owns the request outcome. A reader can reject its
        // cancellation because the upstream was aborted before this call.
        if (!state.controller.signal.aborted)
          throw error
      }).finally(() => reader.releaseLock())
    }
  }

  private cancelMatching(predicate: (state: RequestState) => boolean) {
    for (const [binding, requests] of this.requests) {
      for (const [id, state] of requests) {
        if (predicate(state))
          this.cancel(binding, id)
      }
    }
  }

  bindWindow(window: BrowserWindow): void {
    if (this.disposed)
      throw new Error('OpenCode Go service is disposed')
    if (this.bindings.has(window))
      return
    // The native window cannot supply webContents after `closed`.
    const contents = window.webContents
    const adapter = createContext(ipcMain, window, { onlySameWindow: true })
    const binding: Binding = {
      window,
      adapter,
      close: () => {
        this.cancelMatching(state => state.owner === binding)
        adapter.dispose()
        window.off('closed', binding.close)
        contents.off('did-start-navigation', binding.navigate)
        contents.off('render-process-gone', binding.gone)
        this.bindings.delete(window)
        this.requests.delete(binding)
      },
      navigate: (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace)
          this.cancelMatching(state => state.owner === binding)
      },
      gone: () => this.cancelMatching(state => state.owner === binding),
    }
    this.bindings.set(window, binding)
    this.requests.set(binding, new Map())
    window.on('closed', binding.close)
    contents.on('did-start-navigation', binding.navigate)
    contents.on('render-process-gone', binding.gone)

    defineInvokeHandler(adapter.context, goGetConfiguration, async (input, options) => {
      this.authorize(binding, options)
      const { providerId } = parseInput(profileSchema, input)
      return this.credentials.get(providerId)
    })
    defineInvokeHandler(adapter.context, goSetConfiguration, async (input, options) => {
      this.authorize(binding, options)
      const { providerId, apiKey } = parseInput(updateSchema, input)
      const result = await this.credentials.set(providerId, apiKey)
      this.cancelMatching(state => state.providerId === providerId)
      return result
    })
    defineInvokeHandler(adapter.context, goOpenRequest, async (input, options): Promise<GoResponse> => {
      const requests = this.authorize(binding, options)
      const request = parseInput(requestSchema, input)
      if (request.operation === 'models' && request.body !== undefined)
        throw new Error('OpenCode Go models requests cannot contain a body')
      if (request.operation === 'chat' && request.body === undefined)
        throw new Error('OpenCode Go chat requires a JSON body')
      if (request.body !== undefined) {
        try {
          const body: unknown = JSON.parse(request.body)
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new Error('Invalid body')
        }
        catch {
          throw new Error('OpenCode Go chat requires a JSON object')
        }
      }
      if (requests.has(request.requestId))
        throw new Error('OpenCode Go request ID is already active')
      const controller = new AbortController()
      const state: RequestState = {
        owner: binding,
        providerId: request.providerId,
        controller,
        // The deadline covers connect and streaming, including idle consumers.
        timer: setTimeout(() => this.cancel(binding, request.requestId), 120_000),
        reading: false,
        opened: false,
      }
      requests.set(request.requestId, state)
      const invocationSignal = options?.abortController?.signal
      const abort = () => this.cancel(binding, request.requestId)
      invocationSignal?.addEventListener('abort', abort, { once: true })
      try {
        invocationSignal?.throwIfAborted()
        const key = await this.credentials.key(request.providerId)
        controller.signal.throwIfAborted()
        const response = await fetch(`https://opencode.ai/inference/go/v1/${request.operation === 'models' ? 'models' : 'chat/completions'}`, {
          method: request.operation === 'models' ? 'GET' : 'POST',
          redirect: 'error',
          headers: {
            'Authorization': `Bearer ${key}`,
            'User-Agent': 'Project-AIRI',
            'x-opencode-session': request.sessionId ?? this.validationSession,
            ...(request.operation === 'chat' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: request.body,
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          await response.body?.cancel()
          throw new Error('Cancelled')
        }
        state.reader = response.body?.getReader()
        state.opened = true
        const headers: [string, string][] = []
        for (const name of ['content-type', 'retry-after']) {
          const value = response.headers.get(name)
          if (value !== null)
            headers.push([name, value])
        }
        return { status: response.status, statusText: '', headers }
      }
      catch {
        this.cancel(binding, request.requestId)
        throw new Error('OpenCode Go request failed or was cancelled')
      }
      finally {
        invocationSignal?.removeEventListener('abort', abort)
      }
    })
    defineInvokeHandler(adapter.context, goReadChunk, async (input, options) => {
      this.authorize(binding, options)
      const { requestId } = parseInput(pullSchema, input)
      const state = this.requests.get(binding)?.get(requestId)
      if (!state)
        throw new Error('OpenCode Go request is not active')
      if (!state.opened)
        throw new Error('OpenCode Go request is still opening')
      if (state.reading)
        throw new Error('OpenCode Go request already has a pending read')
      state.reading = true
      try {
        const chunk = await state.reader?.read()
        state.controller.signal.throwIfAborted()
        if (!chunk || chunk.done) {
          this.cancel(binding, requestId)
          return { done: true as const }
        }
        return { done: false as const, data: chunk.value }
      }
      catch {
        this.cancel(binding, requestId)
        throw new Error('OpenCode Go response failed or was cancelled')
      }
      finally {
        state.reading = false
      }
    })
    defineInvokeHandler(adapter.context, goCancelRequest, (input, options) => {
      this.authorize(binding, options)
      this.cancel(binding, parseInput(pullSchema, input).requestId)
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const binding of this.bindings.values())
      binding.close()
    await this.credentials.dispose()
  }
}

/**
 * Construct after app.whenReady(). Bind only main/settings before renderer load,
 * and await dispose during application shutdown.
 */
export function createGoNetworkService(): { bindWindow: (window: BrowserWindow) => void, dispose: () => Promise<void> } {
  return new GoNetworkService()
}
