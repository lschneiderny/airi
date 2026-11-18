import { generateText } from '@xsai/generate-text'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'zod/v4/core'

import { providerAnthropic } from './index'

afterEach(() => vi.unstubAllGlobals())

describe('anthropic provider', () => {
  it('lists the live model catalog without retired models', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      data: [
        {
          id: 'claude-opus-5-5',
          display_name: 'Claude Opus 5.5',
          lifecycle: 'active',
          max_input_tokens: 1_000_000,
          capabilities: { image_input: { supported: true } },
        },
        {
          id: 'claude-haiku-4-5-20251001',
          display_name: 'Claude Haiku 4.5',
          lifecycle: 'deprecated',
          max_input_tokens: null,
          capabilities: null,
        },
        { id: 'claude-2.1', display_name: 'Claude 2.1', lifecycle: 'retired' },
      ],
      has_more: false,
    }))
    vi.stubGlobal('fetch', fetch)
    const schema = await providerAnthropic.createProviderConfig({ t: text => text })
    const config = parse(schema, { apiKey: 'sk-ant-test' })
    const provider = await providerAnthropic.createProvider(config)
    const models = await providerAnthropic.extraMethods?.listModels?.(config, provider, { t: text => text })

    expect(models).toEqual([
      {
        id: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        provider: 'anthropic',
        metadata: { abilities: { vision: true } },
        contextLength: 1_000_000,
        deprecated: false,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        provider: 'anthropic',
        deprecated: true,
      },
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/models?limit=1000')
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-api-key')).toBe('sk-ant-test')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
  })

  it('reports a rejected key instead of an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () => new Response('invalid x-api-key', { status: 401 })))
    const schema = await providerAnthropic.createProviderConfig({ t: text => text })
    const config = parse(schema, { apiKey: 'sk-ant-wrong' })
    const provider = await providerAnthropic.createProvider(config)

    await expect(providerAnthropic.extraMethods!.listModels!(config, provider, { t: text => text }))
      .rejects
      .toThrow('HTTP 401')
  })

  it.each([
    [undefined, 'https://api.anthropic.com/v1/chat/completions'],
    ['messages', 'https://api.anthropic.com/v1/messages'],
  ] as const)('sends chat with api %s to %s', async (api, endpoint) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(endpoint.endsWith('/messages')
      ? { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Hi.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      : { id: 'chat_1', object: 'chat.completion', created: 0, model: 'claude-haiku-5-5', choices: [{ index: 0, message: { role: 'assistant', content: 'Hi.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    vi.stubGlobal('fetch', fetch)
    const schema = await providerAnthropic.createProviderConfig({ t: text => text })
    const config = parse(schema, { apiKey: 'sk-ant-test', ...(api ? { api } : {}) })
    const provider = await providerAnthropic.createProvider(config)
    if (!('chat' in provider))
      throw new Error('Anthropic provider must support chat')

    const result = await generateText({ ...provider.chat('claude-haiku-5-5'), messages: [{ role: 'user', content: 'Hi' }] })

    expect(result.text).toBe('Hi.')
    expect(String(fetch.mock.calls[0]?.[0])).toBe(endpoint)
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('anthropic-dangerous-direct-browser-access')).toBe('true')
  })
})
