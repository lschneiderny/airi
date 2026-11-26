import type { ChatProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ChatRequestOptions, ProviderInstance } from '../../../types'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { pickOllamaValidationModel, providerOllama, resolveOllamaReasoningEffort } from './index'

type OllamaChatProvider = ChatProviderWithExtraOptions<string, ChatRequestOptions>

function isOllamaChatProvider(provider: ProviderInstance): provider is OllamaChatProvider {
  return 'chat' in provider && typeof provider.chat === 'function'
}

async function createOllamaChatProvider(thinkingMode: 'auto' | 'disable' | 'enable'): Promise<OllamaChatProvider> {
  const provider = await providerOllama.createProvider({
    baseUrl: 'http://localhost:11434/v1/',
    thinkingMode,
  })
  if (!isOllamaChatProvider(provider))
    throw new Error('Ollama provider must support chat')

  return provider
}

describe('providerOllama.resolveOllamaReasoningEffort', () => {
  it('should return undefined for auto mode', () => {
    expect(resolveOllamaReasoningEffort('auto')).toBeUndefined()
  })

  it('should map disable/enable to OpenAI-compatible effort values', () => {
    expect(resolveOllamaReasoningEffort('disable')).toBe('none')
    expect(resolveOllamaReasoningEffort('enable')).toBe('medium')
  })

  it('should pass level modes through unchanged', () => {
    expect(resolveOllamaReasoningEffort('low')).toBe('low')
    expect(resolveOllamaReasoningEffort('medium')).toBe('medium')
    expect(resolveOllamaReasoningEffort('high')).toBe('high')
  })

  it('should fallback invalid values to auto mode', () => {
    expect(resolveOllamaReasoningEffort('invalid')).toBeUndefined()
  })
})

describe('providerOllama.createProvider chat options', () => {
  it('should not set reasoning effort when thinkingMode is auto', async () => {
    const provider = await createOllamaChatProvider('auto')

    expect(provider.chat('qwen3:8b')).not.toHaveProperty('reasoningEffort')
  })

  it('should set reasoning effort to none for non gpt-oss when thinkingMode is disable', async () => {
    const provider = await createOllamaChatProvider('disable')

    expect(provider.chat('qwen3:8b')).toMatchObject({ reasoningEffort: 'none' })
  })

  it('should set reasoning effort to medium when thinkingMode is enable', async () => {
    const provider = await createOllamaChatProvider('enable')

    expect(provider.chat('gpt-oss:20b')).toMatchObject({ reasoningEffort: 'medium' })
  })

  it('should set reasoning effort to none when thinkingMode is disable', async () => {
    const provider = await createOllamaChatProvider('disable')

    expect(provider.chat('gpt-oss:20b')).toMatchObject({ reasoningEffort: 'none' })
  })

  it('should apply request reasoning without checking the model name', async () => {
    const provider = await createOllamaChatProvider('auto')

    expect(provider.chat('llama3.2', { reasoning: 'disabled' })).toMatchObject({ reasoningEffort: 'none' })
    expect(provider.chat('gpt-oss:20b', { reasoning: 'enabled' })).toMatchObject({ reasoningEffort: 'medium' })
  })
})

describe('pickOllamaValidationModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const embeddings = new Set(['all-minilm', 'nomic-embed-text'])

  function stubOllama(lists: Record<string, Array<{ name: string, size?: number }>>) {
    const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith('/api/show')) {
        const { model } = JSON.parse(String(init?.body)) as { model: string }
        return new Response(JSON.stringify({ capabilities: embeddings.has(model) ? ['embedding'] : ['completion'] }))
      }
      return new Response(JSON.stringify({ models: lists[url.pathname.replace(/^.*\/api\//, '')] ?? [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('prefers a loaded chat model so the probe loads nothing', async () => {
    stubOllama({
      ps: [{ name: 'all-minilm' }, { name: 'gemma4:e4b-it-qat' }],
      tags: [{ name: 'gemma4:12b-it-qat', size: 8 }, { name: 'gemma4:e4b-it-qat', size: 4 }],
    })

    expect(await pickOllamaValidationModel({ baseUrl: 'http://localhost:11434/v1/' })).toBe('gemma4:e4b-it-qat')
  })

  it('falls back to the smallest installed chat model', async () => {
    const fetchMock = stubOllama({
      tags: [{ name: 'gemma4:12b-it-qat', size: 8 }, { name: 'all-minilm', size: 1 }, { name: 'gemma4:e4b-it-qat', size: 4 }],
    })

    expect(await pickOllamaValidationModel({ baseUrl: 'http://localhost:11434/v1' })).toBe('gemma4:e4b-it-qat')
    expect(fetchMock.mock.calls[0][0].href).toBe('http://localhost:11434/api/ps')
  })

  it('keeps a path prefix with or without a trailing slash', async () => {
    const fetchMock = stubOllama({ ps: [{ name: 'gemma4:e4b-it-qat' }] })

    await pickOllamaValidationModel({ baseUrl: 'https://example.com/proxy/v1' })
    await pickOllamaValidationModel({ baseUrl: 'https://example.com/proxy/v1/' })

    expect(fetchMock.mock.calls.map(([url]) => url.href).filter(href => href.endsWith('/ps'))).toEqual([
      'https://example.com/proxy/api/ps',
      'https://example.com/proxy/api/ps',
    ])
  })
})
