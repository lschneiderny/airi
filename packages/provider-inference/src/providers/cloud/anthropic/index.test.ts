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
    expect(headers.get('authorization')).toBe('Bearer sk-ant-test')
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
})
