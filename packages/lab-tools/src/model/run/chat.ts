import type { ModelScenarioConfig } from './scenario'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

/** A tool call as an assistant message carries it back to the endpoint in a later step. */
export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export type ChatMessage
  = | { role: 'system' | 'user', content: string }
    | { role: 'assistant', content: string, tool_calls?: ChatToolCall[] }
    | { role: 'tool', tool_call_id: string, content: string }

/** The extra fields of an app-conditions request: the app's tools and its reply budget. */
export interface ChatRequestExtras {
  tools?: readonly unknown[]
  max_tokens?: number
}

export type ChatRequestBody = ModelScenarioConfig & {
  model: string
  messages: ChatMessage[]
  tools?: unknown[]
  stream: true
  stream_options: { include_usage: true }
}

/**
 * Builds the body of one chat completion request. The config keys reach the body unchanged, and the request streams
 * with usage, as the app's requests do. Every key except `model` and `messages` is a request option of the record.
 */
export function buildChatRequest(model: string, messages: readonly ChatMessage[], config: ModelScenarioConfig, extras: ChatRequestExtras = {}): ChatRequestBody {
  return {
    model,
    messages: [...messages],
    // The app's reply budget applies unless the scenario config sets its own.
    ...(extras.max_tokens === undefined ? {} : { max_tokens: extras.max_tokens }),
    ...config,
    ...(extras.tools?.length ? { tools: [...extras.tools] } : {}),
    stream: true,
    stream_options: { include_usage: true },
  }
}

/** What one request returned. A field the endpoint did not report stays `null`. */
export interface ChatOutcome {
  /** HTTP status, or `null` when no response arrived. */
  status: number | null
  id: string | null
  model: string | null
  systemFingerprint: string | null
  text: string
  thinkingText: string
  toolCalls: { name: string, arguments: unknown }[]
  /** The endpoint's id for each entry of `toolCalls`, which a tool result must answer; `null` when it sent none. */
  toolCallIds: (string | null)[]
  /** The raw argument text of each entry of `toolCalls`, as a later step sends it back. */
  toolCallArguments: string[]
  /** `[elapsed ms, text length]` after each text delta, so a caller can find when speech first became audible. */
  textMarks: [ms: number, length: number][]
  finish: string | null
  usage: Record<string, unknown> | null
  error: string | null
  /** Time until the first text, reasoning, or tool-call delta. */
  ttftMs: number | null
  totalMs: number
}

const chunkSchema = v.object({
  id: v.optional(v.nullable(v.string())),
  model: v.optional(v.nullable(v.string())),
  system_fingerprint: v.optional(v.nullable(v.string())),
  choices: v.optional(v.array(v.object({
    delta: v.optional(v.object({
      content: v.optional(v.nullable(v.string())),
      // Ollama names streamed reasoning `reasoning`; other compatible servers name it `reasoning_content`.
      reasoning: v.optional(v.nullable(v.string())),
      reasoning_content: v.optional(v.nullable(v.string())),
      tool_calls: v.optional(v.nullable(v.array(v.object({
        index: v.optional(v.number()),
        id: v.optional(v.nullable(v.string())),
        function: v.optional(v.object({ name: v.optional(v.nullable(v.string())), arguments: v.optional(v.nullable(v.string())) })),
      })))),
    })),
    finish_reason: v.optional(v.nullable(v.string())),
  }))),
  usage: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  error: v.optional(v.unknown()),
})

function errorText(value: unknown): string {
  const parsed = v.safeParse(v.object({ error: v.union([v.string(), v.object({ message: v.string() })]) }), value)
  if (!parsed.success)
    return JSON.stringify(value)
  return typeof parsed.output.error === 'string' ? parsed.output.error : parsed.output.error.message
}

/**
 * Sends one streaming request to `<baseUrl>/chat/completions` and collects the reply.
 *
 * Never throws for a failed request: a refused connection, an HTTP error, an error event, a timeout, and a stream
 * that ends without a finish reason all return an outcome whose `error` says what happened. Whatever arrived before
 * the failure is kept. It sends credentials only when `apiKey` is given, as a bearer token. `send` makes the request;
 * a run against Anthropic's native API passes the provider's translating fetch, so the request stays Chat Completions.
 */
export async function requestChat(baseUrl: string, body: string, timeoutMs: number, apiKey?: string, send: typeof globalThis.fetch = fetch): Promise<ChatOutcome> {
  const outcome: ChatOutcome = { status: null, id: null, model: null, systemFingerprint: null, text: '', thinkingText: '', toolCalls: [], toolCallIds: [], toolCallArguments: [], textMarks: [], finish: null, usage: null, error: null, ttftMs: null, totalMs: 0 }
  const calls: { id: string | null, name: string, arguments: string }[] = []
  const started = performance.now()
  try {
    const response = await send(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }) },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    outcome.status = response.status
    if (!response.ok) {
      const text = await response.text()
      let detail = text
      try {
        detail = errorText(JSON.parse(text))
      }
      catch {
        // The body is not JSON; report its text as it came.
      }
      outcome.error = `HTTP ${response.status}: ${detail}`
    }
    else if (response.body) {
      const decoder = new TextDecoder()
      let pending = ''
      const read = (line: string) => {
        if (!line.startsWith('data:'))
          return
        const data = line.slice(5).trim()
        if (data === '' || data === '[DONE]')
          return
        const chunk = v.parse(chunkSchema, JSON.parse(data))
        if (chunk.error !== undefined && chunk.error !== null) {
          outcome.error = errorText(chunk)
          return
        }
        outcome.id ??= chunk.id ?? null
        outcome.model ??= chunk.model ?? null
        outcome.systemFingerprint ??= chunk.system_fingerprint ?? null
        outcome.usage = chunk.usage ?? outcome.usage
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta
          const reasoning = delta?.reasoning ?? delta?.reasoning_content
          if (delta?.content || reasoning || delta?.tool_calls?.length)
            outcome.ttftMs ??= Math.round(performance.now() - started)
          if (delta?.content) {
            outcome.text += delta.content
            outcome.textMarks.push([Math.round(performance.now() - started), outcome.text.length])
          }
          outcome.thinkingText += reasoning ?? ''
          for (const [position, call] of (delta?.tool_calls ?? []).entries()) {
            const entry = calls[call.index ?? position] ??= { id: null, name: '', arguments: '' }
            entry.id ??= call.id ?? null
            entry.name += call.function?.name ?? ''
            entry.arguments += call.function?.arguments ?? ''
          }
          outcome.finish = choice.finish_reason ?? outcome.finish
        }
      }
      for await (const bytes of response.body) {
        pending += decoder.decode(bytes, { stream: true })
        let end = pending.indexOf('\n')
        while (end !== -1) {
          read(pending.slice(0, end).replace(/\r$/, ''))
          pending = pending.slice(end + 1)
          end = pending.indexOf('\n')
        }
      }
      read(pending)
      if (outcome.error === null && outcome.finish === null)
        outcome.error = 'the stream ended without a finish reason'
    }
    else {
      outcome.error = 'the response has no body'
    }
  }
  catch (error) {
    const cause = error instanceof Error && error.cause !== undefined ? errorMessageFrom(error.cause) : undefined
    outcome.error = [errorMessageFrom(error) ?? 'request failed', cause].filter(Boolean).join(': ')
  }
  outcome.totalMs = Math.round(performance.now() - started)
  const present = calls.filter(Boolean)
  outcome.toolCallIds = present.map(call => call.id)
  outcome.toolCallArguments = present.map(call => call.arguments)
  outcome.toolCalls = present.map((call) => {
    try {
      return { name: call.name, arguments: JSON.parse(call.arguments) }
    }
    catch {
      // Arguments that are not JSON are recorded as the endpoint sent them.
      return { name: call.name, arguments: call.arguments }
    }
  })
  return outcome
}
