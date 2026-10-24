import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../../composables/live2d/expression/compose'

import { describe, expect, it } from 'vitest'

import { deduplicateCatalog } from './dedupe'
import { deriveCatalog } from './derive'

function definition(id: string, value = 1): ExpressionDefinition {
  return { id, parameters: [{ id: 'switch', blend: 'Add', value }] }
}

describe('duplicate expression writes', () => {
  it.each([
    [['鼓脸', 'Puff Cheeks'], 'Puff Cheeks'],
    [['expression58', 'Tear Mouth Cancel'], 'Tear Mouth Cancel'],
    [['expression70', '初始状态', 'Watermark (Edit Key)'], 'Watermark (Edit Key)'],
  ])('chooses the primary for %j', (labels, primary) => {
    const entries = deriveCatalog(labels.map(label => definition(label)), [], {})
    const winner = entries.find(entry => entry.id === primary)!
    expect(winner.aliases).toHaveLength(labels.length - 1)
    for (const entry of entries.filter(entry => entry !== winner)) {
      expect(winner.aliases).toContain(entry.id)
      expect(entry).toMatchObject({ duplicateOf: primary, exposedToLlm: false, mappings: [], group: null, area: 'hidden' })
    }
    expect(entries.every(entry => entry.group === null)).toBe(true)
  })

  it('does not merge expression22 and Blush with different exact values', () => {
    const entries = deriveCatalog([definition('expression22', 1), definition('Blush', 0.7029)], [], {})
    expect(entries.every(entry => entry.duplicateOf === undefined && entry.aliases === undefined)).toBe(true)
  })

  it('excludes keepSeparate ids and leaves duplicate-only pairs out of groups', () => {
    const defs = [definition('Puff Cheeks'), definition('鼓脸')]
    expect(deriveCatalog(defs, [], {}).every(entry => entry.group === null)).toBe(true)
    const entries = deriveCatalog(defs, [], {}, undefined, new Set(['鼓脸']))
    expect(entries.every(entry => entry.duplicateOf === undefined && entry.aliases === undefined)).toBe(true)
    expect(entries[0].group).not.toBeNull()
    expect(entries[0].group).toBe(entries[1].group)
  })

  it('sorts writes and ignores neutral writes and fades but not blend modes', () => {
    const defs: ExpressionDefinition[] = [
      { id: 'Angry', fadeIn: 1, parameters: [{ id: 'b', blend: 'Add', value: 2 }, { id: 'a', blend: 'Overwrite', value: 0 }] },
      { id: '怒', fadeIn: 4, parameters: [{ id: 'a', blend: 'Overwrite', value: 0 }, { id: 'b', blend: 'Add', value: 2 }, { id: 'neutral-add', blend: 'Add', value: 0 }, { id: 'neutral-mul', blend: 'Multiply', value: 1 }] },
      { id: 'different', parameters: [{ id: 'b', blend: 'Multiply', value: 2 }, { id: 'a', blend: 'Overwrite', value: 0 }] },
    ]
    const entries = deriveCatalog(defs, [], {})
    expect(entries[0].aliases).toEqual(['怒'])
    expect(entries[2].duplicateOf).toBeUndefined()
  })

  it('never merges empty signatures but always retains Overwrite writes', () => {
    const defs: ExpressionDefinition[] = [
      definition('empty', 0),
      { id: 'neutral', parameters: [{ id: 'switch', blend: 'Multiply', value: 1 }] },
      { id: 'overwrite-a', parameters: [{ id: 'switch', blend: 'Overwrite', value: 0 }] },
      { id: 'overwrite-b', parameters: [{ id: 'switch', blend: 'Overwrite', value: 0 }] },
    ]
    const entries = deriveCatalog(defs, [], {})
    expect(entries[0].duplicateOf).toBeUndefined()
    expect(entries[1].duplicateOf).toBeUndefined()
    expect(entries[2].aliases).toEqual(['overwrite-b'])
  })

  it('keeps the Bear hair set together after resolving the neutral-write duplicate', () => {
    const values = [
      ['Black braids', { Param14: 0, Param16: 1, Param15: 0, Param17: 0 }],
      ['White hair', { Param14: 1, Param16: 0, Param15: 1, Param17: 0 }],
      ['White hair braids', { Param14: 1, Param16: 0, Param15: 1, Param17: 1 }],
      ['White ponytail', { Param14: 1, Param15: 1 }],
    ] as const
    const entries = deriveCatalog(values.map(([id, parameters]) => ({
      id,
      parameters: Object.entries(parameters).map(([id, value]) => ({ id, value, blend: 'Add' })),
    })), [], {})
    expect(entries[1].aliases).toEqual(['White ponytail'])
    expect(entries[3]).toMatchObject({ duplicateOf: 'White hair', group: null })
    const primaryEntries = entries.filter(entry => entry.duplicateOf === undefined)
    expect(primaryEntries.map(entry => entry.group)).toEqual(Array.from({ length: 3 }).fill('group:Black braids'))
  })

  it('ranks system, meaningful labels, sources, model references and code points in order', () => {
    const entry = (id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry => ({
      id,
      label: 'Angry',
      kind: 'face',
      labelSource: 'file',
      fileName: id,
      parameterIds: ['switch'],
      mappings: [],
      group: null,
      confirmed: false,
      exposedToLlm: true,
      ...patch,
    })
    const entries = [
      entry('system', { kind: 'system', label: 'expression70' }),
      entry('generic', { label: 'expression1', labelSource: 'model' }),
      entry('model', { labelSource: 'model' }),
      entry('vtube', { labelSource: 'vtube' }),
      entry('file'),
      entry('referenced'),
      entry('\u{10000}'),
      entry('\uE000'),
    ]
    const defs = entries.map(entry => definition(entry.id))
    const derive = (candidates: CatalogEntry[]) => deduplicateCatalog(candidates, defs, new Set(['referenced']))
    expect(derive(entries)[0].aliases).toEqual(['model', 'vtube', 'referenced', 'file', '\uE000', '\u{10000}', 'generic'])
    expect(derive(entries.slice(1)).find(entry => entry.id === 'model')?.aliases?.[0]).toBe('vtube')
    expect(derive(entries.slice(4)).find(entry => entry.id === 'referenced')?.aliases).toEqual(['file', '\uE000', '\u{10000}'])
    expect(derive(entries.slice(6)).find(entry => entry.id === '\uE000')?.aliases).toEqual(['\u{10000}'])
    expect(derive(entries.toReversed()).find(entry => entry.id === 'system')?.aliases).toEqual(derive(entries)[0].aliases)
  })
})
