import { generateText } from '@xsai/generate-text'
import { describe, expect, it, vi } from 'vitest'

import { createAnthropicMessagesFetch, messagesBaseURL } from './messages-fetch'

const usage = { input_tokens: 12, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function message(content: unknown[], stopReason: string | null) {
  return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason: stopReason, stop_sequence: null, usage }
}

function eventStream(events: unknown[]) {
  return new Response(events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function chatRequest(body: Record<string, unknown>): RequestInit {
  return { method: 'POST', headers: { 'Authorization': 'Bearer sk-ant-test', 'Content-Type': 'application/json', 'anthropic-beta': 'example-beta' }, body: JSON.stringify(body) }
}

describe('messagesBaseURL', () => {
  it('removes the version that the SDK appends itself', () => {
    expect(messagesBaseURL('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com')
    expect(messagesBaseURL('https://proxy.example.com/anthropic/v1')).toBe('https://proxy.example.com/anthropic')
    expect(messagesBaseURL('https://proxy.example.com/anthropic')).toBe('https://proxy.example.com/anthropic')
  })
})

describe('createAnthropicMessagesFetch', () => {
  it('runs an xsAI tool loop against the native API', async () => {
    const send = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(message([{ type: 'tool_use', id: 'toolu_1', name: 'remember', input: { fact: 'cat' } }], 'tool_use')))
      .mockResolvedValueOnce(Response.json(message([{ type: 'text', text: 'Saved.' }], 'end_turn')))
    const execute = vi.fn(async () => 'ok')

    const result = await generateText({
      baseURL: 'https://api.anthropic.com/v1/',
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-5-5',
      fetch: createAnthropicMessagesFetch({ apiKey: 'sk-ant-test', baseURL: 'https://api.anthropic.com/v1/', fetch: send }),
      messages: [{ role: 'system', content: 'Card.' }, { role: 'user', content: 'Remember my cat.' }],
      tools: [{ type: 'function', function: { name: 'remember', parameters: { type: 'object', properties: { fact: { type: 'string' } } } }, execute }],
      stopWhen: ({ step }) => step.toolCalls.length === 0,
    })

    expect(result.text).toBe('Saved.')
    expect(execute).toHaveBeenCalledWith({ fact: 'cat' }, expect.anything())
    expect(String(send.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/messages')
    const headers = new Headers(send.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer sk-ant-test')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    const second = JSON.parse(String(send.mock.calls[1]?.[1]?.body))
    expect(second.system).toEqual([{ type: 'text', text: 'Card.', cache_control: { type: 'ephemeral' } }])
    expect(second.messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
  })

  it('streams a native event stream as Chat Completions chunks', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => eventStream([
      { type: 'message_start', message: message([], null) },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]))
    const translate = createAnthropicMessagesFetch({ apiKey: 'sk-ant-test', baseURL: 'https://api.anthropic.com/v1/', fetch: send })

    const response = await translate('https://api.anthropic.com/v1/chat/completions', chatRequest({ model: 'claude-haiku-5-5', stream: true, messages: [{ role: 'user', content: 'Hi' }] }))
    const lines = (await response.text()).split('\n\n').filter(Boolean)

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(lines.at(-1)).toBe('data: [DONE]')
    expect(lines.map(line => line.startsWith('data: {') ? JSON.parse(line.slice(6)).choices[0]?.delta?.content : undefined))
      .toContain('Hi.')
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('anthropic-beta')).toBe('example-beta')
  })

  it('returns an API error as an HTTP response with its status and headers, so the chat runtime can retry it', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => Response.json(
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      { status: 529, headers: { 'retry-after': '2' } },
    ))
    const translate = createAnthropicMessagesFetch({ apiKey: 'sk-ant-test', baseURL: 'https://api.anthropic.com/v1/', fetch: send })

    const response = await translate('https://api.anthropic.com/v1/chat/completions', chatRequest({ model: 'claude-haiku-5-5', stream: true, messages: [{ role: 'user', content: 'Hi' }] }))

    expect(send).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(529)
    expect(response.headers.get('retry-after')).toBe('2')
    expect(await response.json()).toEqual({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
  })

  it('passes other requests through with the browser access header', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }))
    const translate = createAnthropicMessagesFetch({ apiKey: 'sk-ant-test', baseURL: 'https://api.anthropic.com/v1/', fetch: send })

    await translate('https://api.anthropic.com/v1/models', { headers: { Authorization: 'Bearer sk-ant-test' } })

    expect(String(send.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/models')
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('anthropic-dangerous-direct-browser-access')).toBe('true')
  })
})
