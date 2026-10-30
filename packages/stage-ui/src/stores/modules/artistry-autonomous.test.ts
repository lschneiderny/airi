import type { StreamFromOptions } from '@proj-airi/core-agent'

import type { AiriCard } from './airi-card'

import { renderConversationPreview } from '@proj-airi/core-agent'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { memoryRepo } from '../../database/repos/memory.repo'
import { useMemoryStore } from '../memory'
import { useProviderStore } from '../providers/provider'
import { useAiriCardStore } from './airi-card'
import { useAutonomousArtistryStore } from './artistry-autonomous'

const captured: StreamFromOptions[] = []

vi.mock('../../database/repos/memory.repo')

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('en'),
    t: (key: string) => key,
    te: () => true,
  }),
}))

vi.mock('../chat/session-store', () => ({
  useChatSessionStore: () => ({
    activeSessionId: 's1',
    sessionMetas: { s1: { characterId: 'c1' } },
  }),
}))

vi.mock('@proj-airi/core-agent', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/core-agent')>(),
  streamFrom: vi.fn(async (options: StreamFromOptions) => {
    captured.push(options)
  }),
}))

function cardWithAutonomousArtistry(): AiriCard {
  return {
    name: 'Hero',
    version: '1.0',
    personality: 'Brave.',
    extensions: {
      airi: {
        agents: {},
        modules: {
          consciousness: { provider: 'mock-provider', model: 'mock-model' },
          vision: { provider: 'mock-provider', model: 'mock-model' },
          speech: { provider: 'mock-provider', model: 'mock-model', voice_id: 'alloy' },
          artistry: { autonomousEnabled: true, autonomousThreshold: 70 },
        },
      },
    },
  } satisfies AiriCard
}

describe('store artistry-autonomous director prompt', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(async () => {
    captured.length = 0
    await memoryRepo.clear()
    pinia = createPinia()
    setActivePinia(pinia)

    useProviderStore(pinia).getChatProviderInstance = vi.fn().mockResolvedValue({})
    const cards = useAiriCardStore(pinia)
    cards.cards = new Map([['c1', cardWithAutonomousArtistry()]])
    cards.moduleDefaults = {
      consciousness: { provider: 'mock-provider', model: 'mock-model' },
      vision: { provider: 'mock-provider', model: 'mock-model' },
      speech: { provider: 'mock-provider', model: 'mock-model', voice_id: 'alloy' },
      displayModelId: '',
    }

    const memory = useMemoryStore(pinia)
    await memory.write({ description: 'Card one fact.', body: 'One.' }, 'c1')
    await memory.write({ description: 'Card two fact.', body: 'Two.' }, 'c2')
    const general = (await memory.write({ description: 'General fact.', body: 'All.' }, 'c1'))!
    await memory.makeGeneral(general)
    await memory.ready()
  })

  afterEach(() => {
    useMemoryStore(pinia).enabled = true
    vi.useRealTimers()
  })

  function directorSystemMessage() {
    expect(captured).toHaveLength(1)
    return String(renderConversationPreview(captured[0].conversation)[0].content)
  }

  function expectIndexOfCardOneAndGeneral(system: string) {
    expect(system).toContain('Memory index:')
    expect(system).toContain('Card one fact.')
    expect(system).toContain('General fact.')
    expect(system).not.toContain('Card two fact.')
  }

  it('gives the assistant-target director the index of the session card and the general entries', async () => {
    await useAutonomousArtistryStore(pinia).runArtistTask('text', [], 'assistant')

    expectIndexOfCardOneAndGeneral(directorSystemMessage())
  })

  it('gives the user-target director the same index after its delay', async () => {
    vi.useFakeTimers()
    const task = useAutonomousArtistryStore(pinia).runArtistTask('text', [], 'user')
    await vi.advanceTimersByTimeAsync(10_000)
    await task

    expectIndexOfCardOneAndGeneral(directorSystemMessage())
  })

  it('leaves the memory prompt out of the director when memory is off', async () => {
    useMemoryStore(pinia).enabled = false

    await useAutonomousArtistryStore(pinia).runArtistTask('text', [], 'assistant')

    expect(directorSystemMessage()).not.toContain('Long-term memory.')
  })
})
