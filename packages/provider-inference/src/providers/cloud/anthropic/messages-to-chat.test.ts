import type { StopReason } from '@anthropic-ai/sdk/resources/messages'

import type { MessagesResponse, MessagesStreamEvent } from './messages-to-chat'

import { describe, expect, it } from 'vitest'

import { toChatCompletion, toChatCompletionChunks } from './messages-to-chat'

const startUsage = { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 200, cache_read_input_tokens: 4000 }

function start(): MessagesStreamEvent {
  return {
    type: 'message_start',
    message: { id: 'msg_1', model: 'claude-haiku-5-5', usage: startUsage },
  }
}

function end(stopReason: StopReason, outputTokens: number): MessagesStreamEvent[] {
  return [
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { input_tokens: null, output_tokens: outputTokens, cache_creation_input_tokens: null, cache_read_input_tokens: null } },
    { type: 'message_stop' },
  ]
}

async function collect(events: MessagesStreamEvent[]) {
  async function* source() {
    yield* events
  }
  const chunks = []
  for await (const chunk of toChatCompletionChunks(source()))
    chunks.push(chunk)
  return chunks
}

const toolUse = [
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'remember', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"fact":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"cat"}' } },
  { type: 'content_block_stop', index: 1 },
] satisfies MessagesStreamEvent[]

const text = [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Saving ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'that.' } },
  { type: 'content_block_stop', index: 0 },
] satisfies MessagesStreamEvent[]

describe('toChatCompletionChunks', () => {
  it('streams text, then sends each tool call whole, the finish reason, and usage with the cache split', async () => {
    const chunks = await collect([start(), ...text, ...toolUse, ...end('tool_use', 42)])

    expect(chunks.map(chunk => chunk.choices[0]?.delta)).toEqual([
      { role: 'assistant' },
      { content: 'Saving ' },
      { content: 'that.' },
      { tool_calls: [{ index: 0, id: 'toolu_1', type: 'function', function: { name: 'remember', arguments: '{"fact":"cat"}' } }] },
      {},
      undefined,
    ])
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe('tool_calls')
    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 4210,
      completion_tokens: 42,
      total_tokens: 4252,
      prompt_tokens_details: { cached_tokens: 4000, cache_write_tokens: 200 },
    })
  })

  it('drops the tool calls of a reply that the output cap cut off, so none runs on partial input', async () => {
    const chunks = await collect([start(), ...text, ...toolUse, ...end('max_tokens', 320)])

    expect(chunks.some(chunk => chunk.choices[0]?.delta.tool_calls)).toBe(false)
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe('length')
  })

  it('drops the tool calls of a refused reply and reports a content filter stop', async () => {
    const chunks = await collect([start(), ...toolUse, ...end('refusal', 5)])

    expect(chunks.some(chunk => chunk.choices[0]?.delta.tool_calls)).toBe(false)
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe('content_filter')
  })

  it('sends a tool call without input deltas as an empty object', async () => {
    const chunks = await collect([
      start(),
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'look', input: {} } },
      ...end('tool_use', 3),
    ])

    expect(chunks[1]?.choices[0]?.delta.tool_calls?.[0]?.function.arguments).toBe('{}')
  })
})

describe('toChatCompletion', () => {
  it('translates a complete response', () => {
    const message = {
      id: 'msg_1',
      model: 'claude-haiku-5-5',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Saved.' },
        { type: 'tool_use', id: 'toolu_1', name: 'remember', input: { fact: 'cat' } },
      ],
      stop_reason: 'tool_use',
      usage: { ...startUsage, output_tokens: 7 },
    } satisfies MessagesResponse

    expect(toChatCompletion(message).choices[0]).toEqual({
      index: 0,
      message: {
        role: 'assistant',
        content: 'Saved.',
        tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'remember', arguments: '{"fact":"cat"}' } }],
      },
      finish_reason: 'tool_calls',
    })
  })
})
