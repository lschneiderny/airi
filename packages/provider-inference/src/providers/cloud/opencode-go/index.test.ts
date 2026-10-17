import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'zod/v4/core'

import { providerOpenCodeGo } from './index'

afterEach(() => vi.unstubAllGlobals())

describe('opencode go provider', () => {
  it('sends DeepSeek and GLM chat requests to the current Go endpoint', async () => {
    const schema = await providerOpenCodeGo.createProviderConfig({ t: text => text })
    const config = parse(schema, { apiKey: 'test-key' })
    const provider = await providerOpenCodeGo.createProvider(config)
    if (!('generation' in provider))
      throw new Error('OpenCode Go must support chat generation')

    for (const model of ['deepseek-v4-pro', 'glm-5.3']) {
      const request = provider.generation(model)
      expect(request.protocol).toBe('chat-completions')
      expect(request.config).toMatchObject({
        apiKey: 'test-key',
        baseURL: 'https://opencode.ai/inference/go/v1',
        model,
      })
      expect(new Headers(request.config.headers).get('user-agent')).toBe('Project-AIRI')
    }
  })

  it('lists only available Go models supported by its chat protocol', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      data: [
        { id: 'glm-5.3' },
        { id: 'deepseek-v4-pro' },
        { id: 'gpt-6-luna' },
      ],
    }))
    vi.stubGlobal('fetch', fetch)
    const schema = await providerOpenCodeGo.createProviderConfig({ t: text => text })
    const config = parse(schema, { apiKey: 'test-key' })
    const provider = await providerOpenCodeGo.createProvider(config)
    const models = await providerOpenCodeGo.extraMethods?.listModels?.(config, provider, { t: text => text })

    expect(models?.map(model => model.id)).toEqual(['glm-5.3', 'deepseek-v4-pro'])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://opencode.ai/inference/go/v1/models')
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('user-agent')).toBe('Project-AIRI')
  })
})
