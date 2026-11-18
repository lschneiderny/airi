import type { StopReason } from '@anthropic-ai/sdk/resources/messages'

interface MessagesUsage {
  input_tokens: number | null
  output_tokens: number
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
}

/** The fields of a content block that the translator reads. Every block of the SDK's `Message` satisfies it. */
interface MessagesContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
}

/** The fields of a response that the translator reads. The SDK's `Message` satisfies it. */
export interface MessagesResponse {
  id: string
  model: string
  content: readonly MessagesContentBlock[]
  stop_reason: StopReason | null
  usage: MessagesUsage
}

/** The fields of a stream event that the translator reads. The SDK's `RawMessageStreamEvent` satisfies it. */
export type MessagesStreamEvent
  = | { type: 'message_start', message: Pick<MessagesResponse, 'id' | 'model' | 'usage'> }
    | { type: 'content_block_start', index: number, content_block: MessagesContentBlock }
    | { type: 'content_block_delta', index: number, delta: { type: 'text_delta', text: string } | { type: 'thinking_delta', thinking: string } | { type: 'input_json_delta', partial_json: string } | { type: 'citations_delta' | 'signature_delta' } }
    | { type: 'content_block_stop', index: number }
    | { type: 'message_stop' }
    | { type: 'message_delta', delta: { stop_reason: StopReason | null }, usage: MessagesUsage }

/** Chat Completions finish reasons that xsAI reads. */
export type ChatFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter'

/** Chat Completions usage, with the prompt cache split that OpenRouter also reports. */
export interface ChatUsage {
  /** Every prompt token: uncached, written to the cache, and read from it. */
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details: { cached_tokens: number, cache_write_tokens: number }
}

interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export interface ChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: [{
    index: 0
    message: { role: 'assistant', content: string | null, reasoning_content?: string, tool_calls?: ChatToolCall[] }
    finish_reason: ChatFinishReason
  }]
  usage: ChatUsage
}

export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: 0
    delta: { role?: 'assistant', content?: string, reasoning_content?: string, tool_calls?: Array<ChatToolCall & { index: number }> }
    finish_reason: ChatFinishReason | null
  }>
  usage?: ChatUsage
}

/**
 * Nothing reads the creation time of a translated response, and the Messages API does not report one.
 * A fixed value keeps translated responses deterministic.
 */
const CREATED = 0

export function finishReason(stopReason: StopReason | null): ChatFinishReason {
  switch (stopReason) {
    case 'tool_use': return 'tool_calls'
    case 'max_tokens':
    case 'model_context_window_exceeded': return 'length'
    case 'refusal': return 'content_filter'
    default: return 'stop'
  }
}

/**
 * Whether the tool calls of a response may run. A call cut off by the output cap can still parse as valid partial
 * input, and a refusal can stop a call mid-input, so neither runs.
 */
function toolCallsMayRun(stopReason: StopReason | null) {
  return stopReason !== 'max_tokens' && stopReason !== 'model_context_window_exceeded' && stopReason !== 'refusal'
}

function chatUsage(usage: MessagesUsage): ChatUsage {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const prompt = (usage.input_tokens ?? 0) + cacheWrite + cacheRead
  return {
    prompt_tokens: prompt,
    completion_tokens: usage.output_tokens,
    total_tokens: prompt + usage.output_tokens,
    prompt_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite },
  }
}

/** Translates a complete Messages API response into a Chat Completions response. */
export function toChatCompletion(message: MessagesResponse): ChatCompletion {
  const text = message.content.flatMap(block => block.type === 'text' && block.text ? [block.text] : []).join('')
  const reasoning = message.content.flatMap(block => block.type === 'thinking' && block.thinking ? [block.thinking] : []).join('')
  const toolCalls = toolCallsMayRun(message.stop_reason)
    ? message.content.flatMap(block => block.type === 'tool_use' && block.id && block.name
        ? [{ id: block.id, type: 'function' as const, function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }]
        : [])
    : []
  return {
    id: message.id,
    object: 'chat.completion',
    created: CREATED,
    model: message.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason(message.stop_reason),
    }],
    usage: chatUsage(message.usage),
  }
}

/**
 * Translates a Messages API event stream into Chat Completions chunks.
 *
 * Text and reasoning stream as they arrive. Each tool call is sent whole after the model stops, because only the stop
 * reason tells whether its input is complete; the calls are short, so the delay is small. The stream ends with a
 * finish chunk and a usage chunk.
 */
export async function* toChatCompletionChunks(events: AsyncIterable<MessagesStreamEvent>): AsyncGenerator<ChatCompletionChunk> {
  let id = ''
  let model = ''
  let usage: MessagesUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let stopReason: StopReason | null = null
  const toolCalls = new Map<number, { id: string, name: string, input: string }>()
  const chunk = (delta: ChatCompletionChunk['choices'][number]['delta'], finish: ChatFinishReason | null = null): ChatCompletionChunk =>
    ({ id, object: 'chat.completion.chunk', created: CREATED, model, choices: [{ index: 0, delta, finish_reason: finish }] })

  for await (const event of events) {
    switch (event.type) {
      case 'message_start':
        id = event.message.id
        model = event.message.model
        usage = { ...event.message.usage }
        yield chunk({ role: 'assistant' })
        break
      case 'content_block_start':
        if (event.content_block.type === 'tool_use' && event.content_block.id && event.content_block.name)
          toolCalls.set(event.index, { id: event.content_block.id, name: event.content_block.name, input: '' })
        break
      case 'content_block_delta': {
        const delta = event.delta
        if (delta.type === 'text_delta' && delta.text) {
          yield chunk({ content: delta.text })
        }
        else if (delta.type === 'thinking_delta' && delta.thinking) {
          yield chunk({ reasoning_content: delta.thinking })
        }
        else if (delta.type === 'input_json_delta') {
          const call = toolCalls.get(event.index)
          if (call)
            call.input += delta.partial_json
        }
        break
      }
      case 'message_delta':
        stopReason = event.delta.stop_reason
        usage = {
          input_tokens: event.usage.input_tokens ?? usage.input_tokens,
          output_tokens: event.usage.output_tokens,
          cache_creation_input_tokens: event.usage.cache_creation_input_tokens ?? usage.cache_creation_input_tokens,
          cache_read_input_tokens: event.usage.cache_read_input_tokens ?? usage.cache_read_input_tokens,
        }
        break
      case 'content_block_stop':
      case 'message_stop':
        break
    }
  }

  if (toolCallsMayRun(stopReason)) {
    let index = 0
    for (const call of [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call))
      yield chunk({ tool_calls: [{ index: index++, id: call.id, type: 'function', function: { name: call.name, arguments: call.input || '{}' } }] })
  }
  yield chunk({}, finishReason(stopReason))
  yield { id, object: 'chat.completion.chunk', created: CREATED, model, choices: [], usage: chatUsage(usage) }
}
