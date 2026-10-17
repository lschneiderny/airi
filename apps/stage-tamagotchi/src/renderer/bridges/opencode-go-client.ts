import type { createContext } from '@moeru/eventa/adapters/electron/renderer'

import { defineInvoke } from '@moeru/eventa'

import { goCancelRequest, goGetConfiguration, goOpenRequest, goReadChunk, goSetConfiguration } from '../../shared/eventa/opencode-go'

/** Adapts restricted IPC operations to the fetch contract used by the existing chat SDK. */
export class GoClient {
  constructor(private readonly context: ReturnType<typeof createContext>['context']) {}

  getConfiguration(providerId: string) {
    return defineInvoke(this.context, goGetConfiguration)({ providerId })
  }

  async isConfigured(providerId: string): Promise<boolean> {
    return (await this.getConfiguration(providerId)).configured
  }

  setConfiguration(providerId: string, apiKey: string) {
    return defineInvoke(this.context, goSetConfiguration)({ providerId, apiKey })
  }

  /** The provider selects its credential reference. Request bodies never select a destination or credentials. */
  fetch(providerId: string): typeof globalThis.fetch {
    return async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const operation = url.pathname === '/inference/go/v1/models' && request.method === 'GET'
        ? 'models'
        : url.pathname === '/inference/go/v1/chat/completions' && request.method === 'POST'
          ? 'chat'
          : undefined
      if (url.origin !== 'https://opencode.ai' || url.search || !operation)
        throw new TypeError('Unsupported OpenCode Go request')
      request.signal.throwIfAborted()

      const requestId = crypto.randomUUID()
      const cancelRequest = defineInvoke(this.context, goCancelRequest)
      const read = defineInvoke(this.context, goReadChunk)
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      let finished = false
      const release = () => {
        finished = true
        request.signal.removeEventListener('abort', onAbort)
      }
      const cancel = async () => {
        if (finished)
          return
        release()
        await cancelRequest({ requestId })
      }
      function onAbort() {
        controller?.error(request.signal.reason)
        // Main independently owns window-close cleanup. A closed IPC context
        // can reject cancellation after the original abort already settled the body.
        void cancel().catch(error => controller?.error(error))
      }
      request.signal.addEventListener('abort', onAbort, { once: true })

      try {
        const metadata = await defineInvoke(this.context, goOpenRequest)({
          providerId,
          requestId,
          operation,
          sessionId: request.headers.get('x-opencode-session') ?? `validation:${providerId}`,
          body: operation === 'chat' ? await request.text() : undefined,
        }, { signal: request.signal })
        request.signal.throwIfAborted()
        if ([204, 205, 304].includes(metadata.status)) {
          await cancel()
          return new Response(null, metadata)
        }
        const body = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value
          },
          async pull(value) {
            try {
              const chunk = await read({ requestId }, { signal: request.signal })
              if (finished)
                return
              if (chunk.done) {
                release()
                value.close()
              }
              else {
                value.enqueue(chunk.data)
              }
            }
            catch (error) {
              value.error(error)
              await cancel()
            }
          },
          cancel,
        }, { highWaterMark: 0 })
        return new Response(body, metadata)
      }
      catch (error) {
        await cancel()
        throw error
      }
    }
  }
}
