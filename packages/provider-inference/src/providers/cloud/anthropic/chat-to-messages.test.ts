import type { ChatRequest } from './chat-to-messages'

import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_TOKENS, toMessagesParams } from './chat-to-messages'

const ephemeral = { type: 'ephemeral' }

function request(overrides: Partial<ChatRequest>): ChatRequest {
  return { model: 'claude-haiku-5-5', messages: [], ...overrides }
}

describe('toMessagesParams', () => {
  it('joins system and developer messages into the system prompt in order, as the compatibility endpoint does', () => {
    const params = toMessagesParams(request({
      messages: [
        { role: 'system', content: 'Card.' },
        { role: 'user', content: 'Hi.' },
        { role: 'developer', content: [{ type: 'text', text: 'Later rule.' }] },
      ],
    }))

    expect(params.system).toEqual([{ type: 'text', text: 'Card.' }, { type: 'text', text: 'Later rule.', cache_control: ephemeral }])
    expect(params.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi.' }] }])
  })

  it('carries a tool round as tool use and tool result blocks, with tool results first in their user message', () => {
    const params = toMessagesParams(request({
      messages: [
        { role: 'user', content: 'Remember my cat.' },
        { role: 'assistant', content: 'Saving.', tool_calls: [{ id: 'call-1', function: { name: 'remember', arguments: '{"fact":"cat"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
        { role: 'user', content: 'Thanks.' },
      ],
    }))

    expect(params.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Remember my cat.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Saving.' }, { type: 'tool_use', id: 'call-1', name: 'remember', input: { fact: 'cat' }, cache_control: ephemeral }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: '{"ok":true}' }] }, { type: 'text', text: 'Thanks.' }] },
    ])
  })

  it('keeps a stored tool call with malformed arguments, with an empty input', () => {
    const params = toMessagesParams(request({
      messages: [
        { role: 'user', content: 'Hi.' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', function: { name: 'remember', arguments: '{"fact":"ca' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'Invalid arguments' },
      ],
    }))

    expect(params.messages[1]?.content).toEqual([{ type: 'tool_use', id: 'call-1', name: 'remember', input: {} }])
  })

  it('drops text without visible characters, which the Messages API rejects', () => {
    const params = toMessagesParams(request({
      messages: [
        { role: 'user', content: 'Hi.' },
        { role: 'assistant', content: '  ' },
        { role: 'user', content: [{ type: 'text', text: '' }, { type: 'text', text: 'Still there?' }] },
      ],
    }))

    expect(params.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi.' }, { type: 'text', text: 'Still there?' }] }])
  })

  it('sends inline images as base64 and linked images as URLs', () => {
    const params = toMessagesParams(request({
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.webp' } },
      ] }],
    }))

    expect(params.messages[0]?.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/cat.webp' } },
    ])
  })

  it('refuses audio input instead of dropping it', () => {
    expect(() => toMessagesParams(request({ messages: [{ role: 'user', content: [{ type: 'input_audio' }] }] })))
      .toThrow('does not accept audio input')
  })

  it('caches the system prompt and the history before the newest input, not the newest input itself', () => {
    const params = toMessagesParams(request({
      messages: [
        { role: 'system', content: 'Card.' },
        { role: 'user', content: 'First.' },
        { role: 'assistant', content: 'Reply.' },
        { role: 'user', content: 'Second, with the situation block.' },
      ],
    }))

    expect(params.messages.map(message => (message.content as Array<{ cache_control?: unknown }>).at(-1)?.cache_control))
      .toEqual([undefined, ephemeral, undefined])
  })

  it('caches the end of a request that ends with tool results, for the next step of the tool loop', () => {
    const params = toMessagesParams(request({
      tools: [{ type: 'function', function: { name: 'remember', parameters: { type: 'object', properties: {} } } }],
      messages: [
        { role: 'user', content: 'Remember.' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', function: { name: 'remember', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
      ],
    }))

    expect(params.tools).toEqual([{ name: 'remember', description: undefined, input_schema: { type: 'object', properties: {} }, cache_control: ephemeral }])
    expect(params.messages.at(-1)?.content).toEqual([{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'ok' }], cache_control: ephemeral }])
  })

  it('maps tool choice, output cap, stop sequences, and reasoning effort', () => {
    const tools = [{ type: 'function' as const, function: { name: 'remember' } }]
    expect(toMessagesParams(request({ tools, tool_choice: 'required', parallel_tool_calls: false })).tool_choice)
      .toEqual({ type: 'any', disable_parallel_tool_use: true })
    expect(toMessagesParams(request({ tools, tool_choice: { type: 'function', function: { name: 'remember' } } })).tool_choice)
      .toEqual({ type: 'tool', name: 'remember' })
    expect(toMessagesParams(request({ tool_choice: 'required' })).tool_choice).toBeUndefined()

    expect(toMessagesParams(request({})).max_tokens).toBe(DEFAULT_MAX_TOKENS)
    expect(toMessagesParams(request({ max_tokens: 320, stop: 'END' }))).toMatchObject({ max_tokens: 320, stop_sequences: ['END'] })

    expect(toMessagesParams(request({ reasoning_effort: 'none' })).thinking).toEqual({ type: 'disabled' })
    expect(toMessagesParams(request({ reasoning_effort: 'minimal' })).output_config).toEqual({ effort: 'low' })
    expect(toMessagesParams(request({ reasoning_effort: 'high' })).output_config).toEqual({ effort: 'high' })
  })
})
