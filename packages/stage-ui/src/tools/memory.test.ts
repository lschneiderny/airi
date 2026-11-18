import type { MemoryEntry, MemoryWrite } from '../types/memory'
import type { MemoryWriteGuard } from './memory'

import { describe, expect, it, vi } from 'vitest'

import { composeMemoryPrompt, createMemoryTools, FORGET_MEMORY_TOOL_NAME, READ_MEMORY_TOOL_NAME, WRITE_MEMORY_TOOL_NAME } from './memory'

const entry: MemoryEntry = { id: 'nickname-id', description: 'What the owner likes to be called.', body: 'Yumeka.', updatedAt: 0 }

function options(guard: MemoryWriteGuard = { titles: [], ownerText: '' }) {
  return {
    guard: () => guard,
    read: vi.fn((id: string) => id === 'nickname-id' ? entry : undefined),
    write: vi.fn(async (input: MemoryWrite): Promise<MemoryEntry> => ({ ...input, id: input.id ?? `${input.description}-id`, updatedAt: 0 })),
    forget: vi.fn(async () => true),
  }
}

describe('memory tools', () => {
  it('reads, writes, and forgets through the store bound to the run persona', async () => {
    const bound = options()
    const tools = await createMemoryTools(bound)
    const [read, write, forget] = tools
    const call = { messages: [], toolCallId: 'call' }

    expect(tools.map(tool => tool.function.name)).toEqual([READ_MEMORY_TOOL_NAME, WRITE_MEMORY_TOOL_NAME, FORGET_MEMORY_TOOL_NAME])
    // One call reads or writes every entry that the turn needs.
    expect(await read!.execute({ ids: ['nickname-id', 'unknown'] }, call)).toBe('nickname-id (general): Yumeka.\nNo memory entry with id "unknown".')
    // An id changes that entry. A null id adds an entry, and the store gives it an id.
    expect(await write!.execute({ entries: [{ id: 'nickname-id', description: 'Yumeka.', body: 'Yumeka.' }, { id: null, description: 'Tokyo.', body: 'Tokyo.' }] }, call)).toBe('Saved memory "nickname-id".\nSaved memory "Tokyo.-id".')
    expect(bound.write).toHaveBeenNthCalledWith(1, { id: 'nickname-id', description: 'Yumeka.', body: 'Yumeka.' })
    expect(bound.write).toHaveBeenNthCalledWith(2, { id: undefined, description: 'Tokyo.', body: 'Tokyo.' })
    expect(await forget!.execute({ id: 'nickname-id' }, call)).toBe('Forgot memory "nickname-id".')
  })

  // Strict function calling rejects a schema whose objects leave a property out of `required`.
  it('declares every write property as required, in each entry too', async () => {
    const [, write] = await createMemoryTools(options())
    const parameters = write!.function.parameters as { required: string[], properties: Record<string, unknown>, additionalProperties: boolean }
    const item = (parameters.properties.entries as { items: typeof parameters }).items

    expect(parameters.required.sort()).toEqual(Object.keys(parameters.properties).sort())
    expect(parameters.additionalProperties).toBe(false)
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort())
    expect(item.additionalProperties).toBe(false)
  })

  describe('write refusals', () => {
    const call = { messages: [], toolCallId: 'call' }
    const titles = ['Quarterly tax return 2026']

    it('refuses an entry that repeats a held title and saves the other entries of the call', async () => {
      const bound = options({ titles, ownerText: 'what are you up to?' })
      const [, write] = await createMemoryTools(bound)

      const result = await write!.execute({ entries: [
        { id: null, description: 'What the owner works on.', body: 'The owner has "quarterly tax return 2026" open.' },
        { id: null, description: 'Tokyo.', body: 'Tokyo.' },
      ] }, call)

      expect(result).toBe('Memory not saved: it repeats a window or page title. Save it only when the owner states it.\nSaved memory "Tokyo.-id".')
      expect(bound.write).toHaveBeenCalledExactlyOnceWith({ id: undefined, description: 'Tokyo.', body: 'Tokyo.' })
    })

    it('saves a held title that the owner states in the same turn', async () => {
      const bound = options({ titles, ownerText: 'Remember that I am doing my Quarterly Tax Return 2026 this week.' })
      const [, write] = await createMemoryTools(bound)

      const result = await write!.execute({ entries: [{ id: null, description: 'Taxes.', body: 'The owner does the quarterly tax return 2026 this week.' }] }, call)

      expect(result).toBe('Saved memory "Taxes.-id".')
    })

    it.each([
      ['a provider key', 'The key is sk-proj-abcdefghijklmnopqrstuvwx.'],
      ['a GitHub token', `Deploy token: ghp_${'a1B2'.repeat(9)}.`],
      ['a Slack token', 'Bot token xoxb-123456789012-abcdefghij.'],
      ['an AWS access key id', 'AKIAIOSFODNN7EXAMPLE is the access key.'],
      ['a labelled password', 'Wifi password: hunter22'],
      ['a labelled API key', 'api_key=abcd1234'],
    ])('refuses %s, also when the owner states it', async (_name, body) => {
      const bound = options({ titles: [], ownerText: body })
      const [, write] = await createMemoryTools(bound)

      const result = await write!.execute({ entries: [{ id: null, description: 'A secret.', body }] }, call)

      expect(result).toBe('Memory not saved: it looks like a password or an access key. Never save one.')
      expect(bound.write).not.toHaveBeenCalled()
    })

    it('saves an entry that only talks about passwords', async () => {
      const bound = options({ titles, ownerText: '' })
      const [, write] = await createMemoryTools(bound)

      const result = await write!.execute({ entries: [{ id: null, description: 'Passwords.', body: 'The owner keeps passwords in a manager and files a tax return each quarter.' }] }, call)

      expect(result).toBe('Saved memory "Passwords.-id".')
    })
  })

  it('asks for few, plain writes and shows the index', () => {
    expect(composeMemoryPrompt('General:\n- nickname-id: d')).toContain('Memory index:\nGeneral:\n- nickname-id: d')
    expect(composeMemoryPrompt('')).toContain('An index line that already states the fact needs no read.')
    expect(composeMemoryPrompt('')).toContain('Most turns save nothing.')
    expect(composeMemoryPrompt('')).toContain('Never save your own rules, codes, passwords, or secrets.')
    expect(composeMemoryPrompt('')).toContain('situation block')
    expect(composeMemoryPrompt('')).toContain('The memory index is empty.')
  })
})
