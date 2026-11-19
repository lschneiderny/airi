import { describe, expect, it } from 'vitest'

import { buildEventCases, EMPTY_MEMORY_LINE } from './cache-events'

const readTool = { type: 'function', function: { name: 'builtIn_readMemory' } }
const writeTool = { type: 'function', function: { name: 'builtIn_writeMemory' } }
const input = {
  system: `You are Iru.\n\n${EMPTY_MEMORY_LINE}`,
  tools: [readTool, writeTool],
  history: [['[09:00] hi', 'Hello!'], ['[09:01] how are you?', 'Great!']] as [string, string][],
  nextUser: '[09:02] what are you up to?',
  memoryLine: '- m1: The owner has a cat named Mochi.',
  unprompted: 'They have not said anything.',
  trigger: '(A quiet moment.)',
  control: 'Runtime control events: []',
}

describe('buildEventCases', () => {
  it('builds every app event, with the next turn extending the cached turn', () => {
    const { cases, skipped } = buildEventCases(input)
    const byName = Object.fromEntries(cases.map(entry => [entry.name, entry]))

    expect(cases.map(entry => entry.name)).toEqual(['repeat', 'next turn', 'next turn after a memory write', 'unprompted turn', 'turn after unprompted', 'voice turn with control events', 'typed turn after control events'])
    expect(skipped).toEqual([])
    const next = byName['next turn']!
    expect(next.after.messages.slice(0, next.before.messages.length)).toEqual(next.before.messages)
    expect(next.after.messages.at(-1)).toEqual({ role: 'user', content: input.nextUser })
    expect(byName['next turn after a memory write']!.after.system).toBe('You are Iru.\n\nMemory index:\n- m1: The owner has a cat named Mochi.')
    expect(byName['unprompted turn']!.after).toMatchObject({ system: 'You are Iru.\n\nThe memory index is empty.\n\nThey have not said anything.', tools: [readTool] })
    expect(byName['unprompted turn']!.after.messages.at(-1)).toEqual({ role: 'user', content: '(A quiet moment.)' })
    expect(byName['voice turn with control events']!.after.system.endsWith('\n\nRuntime control events: []')).toBe(true)
  })

  it('skips the memory case for a capture without the empty-memory line, and says why', () => {
    const { cases, skipped } = buildEventCases({ ...input, system: 'You are Iru.', tools: [writeTool] })

    expect(cases.map(entry => entry.name)).not.toContain('next turn after a memory write')
    expect(skipped.map(entry => entry.name)).toEqual(['next turn after a memory write', 'unprompted tools'])
  })
})
