import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLLM } from '../../stores/ai/chat-llm/llm'
import { useConsciousnessStore } from '../../stores/modules/consciousness'
import { NoChatModelError, requestExpressionTagSuggestions } from './expression-tag-suggestions'

const stream = vi.fn<ReturnType<typeof useLLM>['stream']>()
const provider: GenerationProvider = {
  generation: model => ({ protocol: 'responses', webSearch: false, config: { model, apiKey: 'test-key', baseURL: 'https://example.com/v1/' } }),
}
// The consciousness store reads translations when it is created.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const entry = (id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, label: id, kind: 'prop', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch })

describe('requestExpressionTagSuggestions', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    stream.mockReset()
    vi.spyOn(useLLM(), 'stream').mockImplementation(stream)
    const consciousness = useConsciousnessStore()
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    consciousness.activeProvider = 'openai'
    consciousness.activeModel = 'mock-model'
  })

  afterEach(() => {
    disposePinia(pinia)
    vi.restoreAllMocks()
  })

  it('asks the chat model once, without tools, and returns its suggestions', async () => {
    stream.mockImplementation(async (model, _provider, conversation, options) => {
      expect(model).toBe('mock-model')
      expect(options?.supportsTools).toBe(false)
      expect(conversation.turns.map(turn => turn.type)).toEqual(['system', 'user'])
      await options?.onStreamEvent?.({ type: 'text-delta', text: '{"entries":[{"n":1,"pastime":true,' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '"occasions":["morning"]}]}' })
    })
    const suggestions = await requestExpressionTagSuggestions([entry('bread')])
    expect(suggestions).toEqual([{ id: 'bread', label: 'bread', idleUse: 'activity', occasions: ['morning'], moments: [], reason: '', replaces: false }])
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('sends no request for a model without anything a suggestion may touch', async () => {
    await expect(requestExpressionTagSuggestions([entry('coat', { kind: 'outfit' })])).resolves.toEqual([])
    expect(stream).not.toHaveBeenCalled()
  })

  it('rejects without a chat model, and on a reply that is not the JSON', async () => {
    stream.mockImplementation(async (_model, _provider, _conversation, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Sure! The bread suits the morning.' })
    })
    await expect(requestExpressionTagSuggestions([entry('bread')])).rejects.toThrow()
    useConsciousnessStore().activeModel = ''
    await expect(requestExpressionTagSuggestions([entry('bread')])).rejects.toBeInstanceOf(NoChatModelError)
    expect(stream).toHaveBeenCalledTimes(1)
  })
})
