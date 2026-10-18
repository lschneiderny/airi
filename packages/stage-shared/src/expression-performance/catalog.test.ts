import type { CatalogEntry, ExpressionKind } from '.'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { CatalogEntrySchema, isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet } from '.'

function entry(kind: ExpressionKind = 'face'): CatalogEntry {
  return { id: 'expressions/smile.exp3.json', label: 'Smile', kind, group: null, confirmed: true, exposedToLlm: true, mappings: [], fileName: 'smile.exp3.json', parameterIds: ['ParamSmile'] }
}

describe('catalog', () => {
  it('applies curated fields, preserves omitted fields, and ignores unknown ids', () => {
    const derived = [entry()]
    const curated = parseCuratedCatalogDocument({ version: 1, overrides: [
      { id: derived[0].id, label: 'Sparkle', kind: 'effect', group: 'effects', mappings: [{ emotion: 'happy' }] },
      { id: 'missing', label: 'Ignored' },
    ] })
    expect(curated.success).toBe(true)
    if (!curated.success)
      throw new Error('Expected valid curated document')
    const merged = mergeCatalog(derived, curated.value)
    expect(merged).toEqual([{ ...derived[0], label: 'Sparkle', kind: 'effect', group: 'effects', mappings: [{ emotion: 'happy', weight: 1, minBand: 'strong' }] }])
    expect(derived[0].label).toBe('Smile')
    expect(mergeCatalog(derived, null)).toEqual(derived)
  })

  it('defaults mapping bands by kind and preserves explicit bands', () => {
    expect(parse(CatalogEntrySchema, { ...entry(), mappings: [{ emotion: 'happy' }] }).mappings).toEqual([{ emotion: 'happy', weight: 1, minBand: 'clear' }])
    expect(parse(CatalogEntrySchema, { ...entry('effect'), mappings: [{ emotion: 'happy' }] }).mappings[0].minBand).toBe('strong')
    expect(parse(CatalogEntrySchema, { ...entry('effect'), mappings: [{ emotion: 'happy', minBand: 'slight' }] }).mappings[0].minBand).toBe('slight')
  })

  it.each(['face', 'effect', 'prop', 'outfit', 'system'] as const)('enforces LLM kind policy for %s', (kind) => {
    expect(isLlmEligible(entry(kind))).toBe(['face', 'effect', 'prop'].includes(kind))
    expect(isLlmEligible({ ...entry(kind), confirmed: false })).toBe(false)
    expect(isLlmEligible({ ...entry(kind), exposedToLlm: false })).toBe(false)
  })

  it.each(['face', 'effect', 'prop', 'outfit', 'system'] as const)('enforces automatic kind policy for %s', (kind) => {
    expect(isAutoEligible(entry(kind))).toBe(kind === 'face' || kind === 'effect')
    expect(isAutoEligible({ ...entry(kind), confirmed: false })).toBe(false)
  })

  it.each([null, [], { version: 2, overrides: [] }, { version: 1, overrides: [], extra: true }, { version: 1, overrides: [{ id: 3 }] }, { version: 1, overrides: [{ id: 'x', mappings: [{ emotion: 'happy', weight: Number.NaN }] }] }].map(input => [input]))('rejects malformed curated documents %j', (input) => {
    expect(parseCuratedCatalogDocument(input).success).toBe(false)
  })

  it.each([null, { ...entry(), extra: 1 }, { ...entry(), confirmed: 'true' }, ...[0, -1, Number.NaN, Number.POSITIVE_INFINITY].map(weight => ({ ...entry(), mappings: [{ emotion: 'happy', weight }] })), { ...entry(), mappings: [{ emotion: 'neutral' }] }])('rejects malformed catalog entries %j', (input) => {
    expect(safeParse(CatalogEntrySchema, input).success).toBe(false)
  })

  it('validates rest sets without accepting extra fields or non-string ids', () => {
    expect(parseRestSet({ version: 1, active: ['smile'] })).toEqual({ success: true, value: { version: 1, active: ['smile'] } })
    expect(parseRestSet(null).success).toBe(false)
    expect(parseRestSet({ version: 1, active: [1] }).success).toBe(false)
    expect(parseRestSet({ version: 1, active: [], extra: 1 }).success).toBe(false)
  })
})
