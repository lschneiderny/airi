import { describe, expect, it } from 'vitest'

import { ToolStubs } from './tool-stubs'

describe('toolStubs', () => {
  it('keeps written memory for reads within one conversation, and forgets it on reset', () => {
    const stubs = new ToolStubs()

    expect(JSON.parse(stubs.answer('builtIn_writeMemory', { entries: [{ text: 'The owner has a beagle.' }, { id: 'food', content: 'Likes carbonara.' }] }))).toEqual({ saved: ['m1', 'food'] })
    expect(JSON.parse(stubs.answer('builtIn_readMemory', { ids: ['food', 'missing'] }))).toEqual({ entries: [{ id: 'food', text: 'Likes carbonara.' }] })
    expect(JSON.parse(stubs.answer('builtIn_forgetMemory', { ids: ['m1'] }))).toEqual({ forgotten: ['m1'] })
    expect(JSON.parse(stubs.answer('builtIn_readMemory', {}))).toEqual({ entries: [{ id: 'food', text: 'Likes carbonara.' }] })

    stubs.reset()
    expect(JSON.parse(stubs.answer('builtIn_readMemory', {}))).toEqual({ entries: [] })
  })

  it('reports success for any other tool, and treats arguments that are not an object as none', () => {
    const stubs = new ToolStubs()

    expect(stubs.answer('builtIn_drawCard', { card: 'x' })).toBe('{"ok":true}')
    expect(JSON.parse(stubs.answer('builtIn_readMemory', '{broken'))).toEqual({ entries: [] })
  })
})
