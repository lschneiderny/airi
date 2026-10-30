import type { Tool } from '@xsai/shared-chat'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryTools, FORGET_MEMORY_TOOL_NAME, READ_MEMORY_TOOL_NAME, WRITE_MEMORY_TOOL_NAME } from '../../tools/memory'
import { useMemoryStore } from '../memory'
import { MEMORY_TOOL_HISTORY_MAX, useMemoryObservabilityStore } from './memory-observability'

vi.mock('../../database/repos/memory.repo')

// The card store pulls the whole module graph into Node; the inspector reads only its `cards` map.
vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', () => ({
      cards: new Map([['default', { name: 'ReLU' }], ['card-mochi', { name: 'Mochi' }]]),
    })),
  }
})

const context = { sessionId: 'session-1', origin: 'user' as const }

function toolNamed(tools: Tool[], name: string): Tool {
  const tool = tools.find(candidate => candidate.function.name === name)
  if (!tool)
    throw new Error(`No tool named ${name}`)
  return tool
}

/** The tools are called the way the chat runtime calls them, with the raw model input. */
function call(tool: Tool, input: unknown) {
  return tool.execute(input, { abortSignal: new AbortController().signal, messages: [], toolCallId: 'call' })
}

describe('memory observability store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps the newest records first, capped at the history maximum', () => {
    const store = useMemoryObservabilityStore()

    for (let index = 0; index < MEMORY_TOOL_HISTORY_MAX + 5; index++)
      store.record({ sessionId: `session-${index}`, origin: 'user', tool: 'read', ids: [`id-${index}`], outcome: 'ok', result: '' })

    expect(store.history).toHaveLength(MEMORY_TOOL_HISTORY_MAX)
    expect(store.history[0]?.sessionId).toBe(`session-${MEMORY_TOOL_HISTORY_MAX + 4}`)
    expect(store.history.at(-1)?.sessionId).toBe('session-5')
  })

  it('inspects the enabled flag and the index of every card', async () => {
    const memory = useMemoryStore()
    const store = useMemoryObservabilityStore()

    await memory.write({ description: 'The cat is Mochi.', body: 'The owner has a cat named Mochi.' }, 'card-mochi')
    await memory.ready()

    const inspection = await store.inspect()
    expect(inspection.enabled).toBe(true)
    expect(inspection.indexes.map(index => [index.cardId, index.name])).toEqual([['default', 'ReLU'], ['card-mochi', 'Mochi']])
    expect(inspection.indexes[1]?.index).toContain('The cat is Mochi.')
    expect(inspection.indexes[0]?.index).toBe('')
    expect(inspection.general).toBe('')
  })

  describe('one row per tool call', () => {
    it('records one row for a read of two ids', async () => {
      const store = useMemoryObservabilityStore()
      const read = vi.fn(() => undefined)
      const tools = store.observeMemoryTools(await createMemoryTools({ read, write: vi.fn(), forget: vi.fn() }), context)

      await call(toolNamed(tools, READ_MEMORY_TOOL_NAME), { ids: ['a', 'b'] })

      expect(read).toHaveBeenCalledTimes(2)
      expect(store.history).toHaveLength(1)
      expect(store.history[0]).toMatchObject({ sessionId: 'session-1', origin: 'user', tool: 'read', ids: ['a', 'b'], outcome: 'missing' })
    })

    it('records one row for a write of two entries', async () => {
      const store = useMemoryObservabilityStore()
      const write = vi.fn(async (entry: { id?: string, description: string, body: string }) => ({ id: entry.id ?? `new-${entry.body}`, description: entry.description, body: entry.body, persona: 'default', updatedAt: 0 }))
      const tools = store.observeMemoryTools(await createMemoryTools({ read: vi.fn(), write, forget: vi.fn() }), context)

      const result = await call(toolNamed(tools, WRITE_MEMORY_TOOL_NAME), {
        entries: [
          { id: 'existing', description: 'One.', body: 'one' },
          { id: null, description: 'Two.', body: 'two' },
        ],
      })

      expect(write).toHaveBeenCalledTimes(2)
      expect(store.history).toHaveLength(1)
      expect(store.history[0]).toMatchObject({ tool: 'write', ids: ['existing'], outcome: 'ok', result })
    })

    it('records a missing row for a read of an unknown id', async () => {
      const store = useMemoryObservabilityStore()
      const tools = store.observeMemoryTools(await createMemoryTools({ read: () => undefined, write: vi.fn(), forget: vi.fn() }), { sessionId: 'session-2', origin: 'unprompted' })

      await call(toolNamed(tools, READ_MEMORY_TOOL_NAME), { ids: ['nope'] })

      expect(store.history).toHaveLength(1)
      expect(store.history[0]).toMatchObject({ origin: 'unprompted', tool: 'read', ids: ['nope'], outcome: 'missing', result: 'No memory entry with id "nope".' })
    })

    it('records a refused row for a malformed write without calling the binding', async () => {
      const store = useMemoryObservabilityStore()
      const write = vi.fn()
      const forget = vi.fn(async () => false)
      const tools = store.observeMemoryTools(await createMemoryTools({ read: vi.fn(), write, forget }), context)

      await call(toolNamed(tools, WRITE_MEMORY_TOOL_NAME), { entries: 'nope' })
      await call(toolNamed(tools, FORGET_MEMORY_TOOL_NAME), { id: 'gone' })

      expect(write).not.toHaveBeenCalled()
      expect(store.history).toHaveLength(2)
      expect(store.history[1]).toMatchObject({ tool: 'write', ids: [], outcome: 'refused' })
      expect(store.history[0]).toMatchObject({ tool: 'forget', ids: ['gone'], outcome: 'refused', result: 'No memory entry with that id.' })
    })
  })
})
