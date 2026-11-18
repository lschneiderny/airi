import type Anthropic from '@anthropic-ai/sdk'
import type { APIError } from '@anthropic-ai/sdk'

import type { ChatCompletionChunk } from './messages-to-chat'

import * as v from 'valibot'

import { ChatRequestSchema, toMessagesParams } from './chat-to-messages'
import { toChatCompletion, toChatCompletionChunks } from './messages-to-chat'

export interface AnthropicMessagesFetchOptions {
  apiKey: string
  /** The provider's base URL, such as `https://api.anthropic.com/v1/`. */
  baseURL: string
  /** Sends every HTTP request. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch
}

/** Lets a browser renderer call the API directly. The SDK sets it too; requests that pass through need it here. */
const BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access'

/**
 * The API version of every translated request.
 *
 * Version `2026-10-21`, the SDK's default, rejects `temperature`, `top_p`, and `top_k` on every model, even at their
 * defaults. AIRI forwards a card's or a user's temperature, and the compatibility endpoint accepts it wherever the
 * model does, so the translator keeps the version whose sampling rules match. Prompt caching, effort, and thinking
 * work on it. This is supported policy, not a fallback: move to `2026-10-21` when AIRI stops sending sampling
 * parameters to Anthropic or when Anthropic announces the retirement of `2023-06-01`.
 */
export const MESSAGES_API_VERSION = '2023-06-01'

/** Headers that the SDK owns: the credential and the body framing. */
const SDK_HEADERS = new Set(['authorization', 'x-api-key', 'content-type', 'content-length'])

/**
 * The SDK appends `/v1/messages` to its base URL, while the provider's base URL ends with the version, as the OpenAI
 * compatibility endpoint needs. A base URL without a trailing `/v1` is used as it is.
 */
export function messagesBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

function requestURL(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input)
}

/** Keeps request header overrides, such as a beta header, and drops the headers that the SDK sets. */
function forwardedHeaders(init: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, name) => {
    if (!SDK_HEADERS.has(name))
      headers[name] = value
  })
  return headers
}

function readRequest(init: RequestInit) {
  const result = v.safeParse(ChatRequestSchema, JSON.parse(String(init.body)))
  if (!result.success)
    throw new Error(`Anthropic Messages cannot translate the chat request: ${v.summarize(result.issues)}`)
  return result.output
}

/** Returns the API's error as an HTTP response, so that xsAI reports its status and the chat runtime can retry it. */
function errorResponse(error: APIError & { status: number }): Response {
  return new Response(JSON.stringify(error.error ?? { type: 'error', error: { message: error.message } }), {
    status: error.status,
    headers: error.headers,
  })
}

function eventStreamResponse(chunks: AsyncGenerator<ChatCompletionChunk>, cancel: () => void): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next()
        if (next.done) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      }
      catch (error) {
        controller.error(error)
      }
    },
    cancel,
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/**
 * Creates a `fetch` that sends Chat Completions requests to Anthropic's native Messages API.
 *
 * Use when:
 * - An xsAI chat provider must reach Claude through `/v1/messages`, for prompt caching, effort control, and proxies
 *   that serve only the native API. Callers keep sending OpenAI-shaped requests.
 *
 * Expects:
 * - `POST <baseURL>chat/completions` with a JSON body. Every other request passes through with the browser access
 *   header, so model listing keeps working.
 *
 * Returns:
 * - A Chat Completions response or event stream. An API error becomes an HTTP response with the API's status,
 *   headers, and body. The SDK makes no retries; the chat runtime owns retry policy.
 */
export function createAnthropicMessagesFetch(options: AnthropicMessagesFetchOptions): typeof globalThis.fetch {
  // The SDK loads on the first translated request, so a renderer whose Anthropic provider uses the compatibility
  // endpoint never downloads it.
  let sdk: Promise<{ client: Anthropic, APIError: typeof APIError }> | undefined
  const loadSdk = () => sdk ??= import('@anthropic-ai/sdk').then(({ default: AnthropicClient, APIError }) => ({
    APIError,
    client: new AnthropicClient({
      apiKey: options.apiKey,
      baseURL: messagesBaseURL(options.baseURL),
      fetch: options.fetch,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
      openTelemetry: false,
      defaultHeaders: { 'anthropic-version': MESSAGES_API_VERSION },
    }),
  }))

  return async (input, init) => {
    const send = options.fetch ?? globalThis.fetch
    if (init?.method !== 'POST' || !requestURL(input).endsWith('/chat/completions')) {
      const headers = new Headers(init?.headers)
      headers.set(BROWSER_ACCESS_HEADER, 'true')
      return send(input, { ...init, headers })
    }

    const body = readRequest(init)
    const params = toMessagesParams(body)
    const requestOptions = { signal: init.signal ?? undefined, headers: forwardedHeaders(init) }
    const { client, APIError } = await loadSdk()
    try {
      if (!body.stream)
        return Response.json(toChatCompletion(await client.messages.create({ ...params, stream: false }, requestOptions)))
      const stream = await client.messages.create({ ...params, stream: true }, requestOptions)
      return eventStreamResponse(toChatCompletionChunks(stream), () => stream.controller.abort())
    }
    catch (error) {
      if (error instanceof APIError && error.status !== undefined)
        return errorResponse(error as APIError & { status: number })
      if (init.signal?.aborted)
        throw init.signal.reason
      throw error
    }
  }
}
