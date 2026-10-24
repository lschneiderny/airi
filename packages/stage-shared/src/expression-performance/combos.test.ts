import type { CatalogEntry, ComboDocument, ExpressionKind } from '.'

import { describe, expect, it } from 'vitest'

import { entrySlots, expandEntry, resolveAlias, usableMembers, validateComboDocument } from '.'

function entry(id: string, kind: ExpressionKind = 'face'): CatalogEntry {
  return { id, label: id, kind, group: null, confirmed: true, exposedToLlm: true, mappings: [], fileName: '', parameterIds: [] }
}

const catalog = [{ ...entry('face'), aliases: ['alias'] }, entry('effect', 'effect'), entry('prop', 'prop'), entry('outfit', 'outfit'), entry('system', 'system'), entry('unsorted', 'unsorted'), entry('combo:nested', 'combo')]
function combo(members: { expressionId: string, strength: number }[]): CatalogEntry {
  return { ...entry('combo:test', 'combo'), members }
}
function document(members: { expressionId: string, strength: number }[]): ComboDocument {
  return { id: 'combo:test', label: 'Test', mappings: [], exposedToLlm: true, members }
}

describe('combos', () => {
  it('resolves aliases to primary ids and preserves unknown and primary ids', () => {
    expect(resolveAlias('alias', catalog)).toBe('face')
    expect(resolveAlias('face', catalog)).toBe('face')
    expect(resolveAlias('unknown', catalog)).toBe('unknown')
  })

  it('drops unknown, combo, zero-strength and repeated resolved members while preserving order and strength', () => {
    const candidate = combo([
      { expressionId: 'unknown', strength: 1 },
      { expressionId: 'combo:nested', strength: 1 },
      { expressionId: 'prop', strength: 0 },
      { expressionId: 'alias', strength: 0.7 },
      { expressionId: 'face', strength: 1 },
      { expressionId: 'effect', strength: 0.4 },
      { expressionId: 'effect', strength: 0.8 },
    ])
    expect(usableMembers(candidate, catalog)).toEqual([{ expressionId: 'face', strength: 0.7 }, { expressionId: 'effect', strength: 0.4 }])
    expect(usableMembers(entry('plain'), catalog)).toEqual([])
  })

  it.each(['face', 'effect', 'prop', 'outfit', 'system', 'unsorted'] as const)('resolves slots and expansion for a plain %s entry', (kind) => {
    const candidate = entry('plain', kind)
    expect(entrySlots(candidate, catalog)).toEqual(['face', 'effect', 'prop'].includes(kind) ? [kind] : [])
    expect(expandEntry(candidate, catalog)).toEqual([{ expressionId: 'plain', strength: 1 }])
  })

  it('orders combo slots face then effect then prop independently of member order', () => {
    const candidate = combo([{ expressionId: 'effect', strength: 1 }, { expressionId: 'face', strength: 0.7 }])
    expect(entrySlots(candidate, catalog)).toEqual(['face', 'effect'])
    candidate.members!.unshift({ expressionId: 'prop', strength: 1 })
    expect(entrySlots(candidate, catalog)).toEqual(['face', 'effect', 'prop'])
    expect(expandEntry(candidate, catalog)).toEqual(candidate.members)
  })

  it.each(['outfit', 'system', 'unsorted'])('blocks every slot when a usable %s member is present', (expressionId) => {
    const candidate = combo([{ expressionId: 'face', strength: 1 }, { expressionId, strength: 1 }])
    expect(entrySlots(candidate, catalog)).toEqual([])
    candidate.members![1].strength = 0
    expect(entrySlots(candidate, catalog)).toEqual(['face'])
  })

  it('returns no slots for empty or unusable members', () => {
    expect(entrySlots(combo([]), catalog)).toEqual([])
    expect(entrySlots(combo([{ expressionId: 'unknown', strength: 1 }]), catalog)).toEqual([])
  })

  it.each([
    [{ expressionId: 'combo:unknown', strength: 1 }],
    [{ expressionId: 'face', strength: 1 }, { expressionId: 'face', strength: 0.7 }],
    [{ expressionId: 'unknown', strength: 1 }],
    [{ expressionId: 'face', strength: 0 }],
    [],
  ].map(members => [members]))('rejects invalid combo membership %j', (members) => {
    expect(validateComboDocument(document(members), catalog)).toMatchObject({ success: false, error: expect.any(String) })
  })

  it('accepts a usable member and resolves aliases for validation', () => {
    expect(validateComboDocument(document([{ expressionId: 'alias', strength: 0.7 }]), catalog)).toEqual({ success: true })
  })
})
