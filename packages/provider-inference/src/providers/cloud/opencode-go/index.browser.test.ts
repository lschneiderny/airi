import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'zod/v4/core'

import { providerOpenCodeGo } from './index'

afterEach(() => vi.unstubAllGlobals())

describe('opencode go browser transport', () => {
  it('leaves the user agent to the browser for chat generation', async () => {
    const schema = await providerOpenCodeGo.createProviderConfig({ t: key => key })
    const config = parse(schema, { apiKey: 'test-key' })
    const provider = await providerOpenCodeGo.createProvider(config)
    if (!('generation' in provider))
      throw new Error('OpenCode Go must support chat generation')

    const request = provider.generation('glm-5.3')

    expect(new Headers(request.config.headers).has('user-agent')).toBe(false)
    expect(request.config).toMatchObject({ apiKey: 'test-key', model: 'glm-5.3' })
  })

  it('keeps model discovery and validation within the allowed CORS headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      data: [{ id: 'glm-5.3' }],
    }))
    vi.stubGlobal('fetch', fetch)
    const schema = await providerOpenCodeGo.createProviderConfig({ t: key => key })
    const config = parse(schema, { apiKey: 'test-key' })
    const provider = await providerOpenCodeGo.createProvider(config)
    const extraMethods = providerOpenCodeGo.extraMethods
    if (!extraMethods)
      throw new Error('OpenCode Go must support model discovery')
    const models = await extraMethods.listModels?.(config, provider, { t: key => key })
    const validators = await Promise.all((providerOpenCodeGo.validators?.validateProvider ?? []).map(create => create({ t: key => key })))

    expect(models?.map(model => model.id)).toEqual(['glm-5.3'])
    for (const id of ['openai-compatible:check-connectivity', 'openai-compatible:check-model-list']) {
      const validator = validators.find(validator => validator.id === id)
      if (!validator)
        throw new Error(`Missing provider validator: ${id}`)
      const result = await validator.validator(config, provider, extraMethods, { t: key => key })
      expect(result.valid).toBe(true)
    }

    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [, options] of fetch.mock.calls) {
      const headers = new Headers(options?.headers)
      expect(headers.has('user-agent')).toBe(false)
      expect(headers.get('authorization')).toBe('Bearer test-key')
    }
  })
})
