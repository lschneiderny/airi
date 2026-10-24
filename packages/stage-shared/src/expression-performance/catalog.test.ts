import type { CatalogEntry, ExpressionKind } from '.'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { CatalogEntrySchema, ComboDocumentSchema, CuratedCatalogDocumentSchema, customEntryFromDocument, CustomExpressionDocumentSchema, isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet } from '.'

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

  it.each(['love', 'flustered', 'sleepy'])('accepts a mapping for the newer emotion %s', (emotion) => {
    expect(parse(CatalogEntrySchema, { ...entry(), mappings: [{ emotion }] }).mappings).toEqual([{ emotion, weight: 1, minBand: 'clear' }])
  })

  it.each(['lovey', 'Love', 'sleepy ', ''])('rejects a mapping for the malformed emotion name %j', (emotion) => {
    expect(safeParse(CatalogEntrySchema, { ...entry(), mappings: [{ emotion }] }).success).toBe(false)
  })

  it.each(['face', 'effect', 'prop', 'outfit', 'system', 'unsorted', 'combo'] as const)('enforces LLM kind policy for %s', (kind) => {
    expect(isLlmEligible(entry(kind))).toBe(['face', 'effect', 'prop'].includes(kind))
    expect(isLlmEligible({ ...entry(kind), confirmed: false })).toBe(['face', 'effect', 'prop'].includes(kind))
    expect(isLlmEligible({ ...entry(kind), exposedToLlm: false })).toBe(false)
  })

  it.each(['face', 'effect', 'prop', 'outfit', 'system', 'unsorted', 'combo'] as const)('enforces automatic kind policy for %s', (kind) => {
    expect(isAutoEligible(entry(kind))).toBe(kind === 'face' || kind === 'effect')
    expect(isAutoEligible({ ...entry(kind), confirmed: false })).toBe(kind === 'face' || kind === 'effect')
  })

  it('accepts inverted on entries and overrides and rejects a non-boolean', () => {
    expect(parse(CatalogEntrySchema, { ...entry(), inverted: true }).inverted).toBe(true)
    expect(parse(CatalogEntrySchema, entry()).inverted).toBeUndefined()
    expect(safeParse(CatalogEntrySchema, { ...entry(), inverted: 'yes' }).success).toBe(false)
    expect(parseCuratedCatalogDocument({ version: 1, overrides: [{ id: 'a', inverted: true }] }).success).toBe(true)
    expect(parseCuratedCatalogDocument({ version: 1, overrides: [{ id: 'a', inverted: 'yes' }] }).success).toBe(false)
  })

  it('parses a stored document with no inverted field', () => {
    expect(parseCuratedCatalogDocument({ version: 1, overrides: [{ id: 'a', confirmed: true, exposedToLlm: false, mappings: [] }] }).success).toBe(true)
  })

  it('keeps derived mappings and LLM exposure for a confirm-all profile', () => {
    const derived = [
      { ...entry(), id: 'a', exposedToLlm: false, mappings: [{ emotion: 'happy' as const, weight: 1, minBand: 'clear' as const }] },
      { ...entry('effect'), id: 'b', confirmed: false, exposedToLlm: true, mappings: [{ emotion: 'sad' as const, weight: 2, minBand: 'strong' as const }] },
    ]
    const curated = parseCuratedCatalogDocument({ version: 1, overrides: derived.map(({ id }) => ({ id, confirmed: true })) })
    expect(curated.success).toBe(true)
    if (!curated.success)
      throw new Error('Expected valid curated document')
    const merged = mergeCatalog(derived, curated.value)
    expect(merged).toEqual(derived.map(item => ({ ...item, confirmed: true })))
  })

  it('merges an inverted override', () => {
    const curated = parseCuratedCatalogDocument({ version: 1, overrides: [{ id: entry().id, inverted: true }] })
    if (!curated.success)
      throw new Error('Expected valid curated document')
    expect(mergeCatalog([entry()], curated.value)[0].inverted).toBe(true)
  })

  const combo = { id: 'combo:smile', label: 'Smile and sparkle', members: [{ expressionId: entry().id, strength: 0.7 }], mappings: [{ emotion: 'happy' as const }], exposedToLlm: true }
  const custom = { id: 'custom:earphones', label: 'Earphones', kind: 'prop' as const, area: 'props' as const, parameterId: 'Param7', delta: 1, mappings: [], exposedToLlm: false }

  it('parses optional combos and customs without changing version 1', () => {
    const parsed = parseCuratedCatalogDocument({ version: 1, overrides: [], combos: [combo], customs: [custom] })
    expect(parsed.success).toBe(true)
    if (!parsed.success)
      throw new Error('Expected valid document')
    expect(parsed.value.combos?.[0].members).toEqual(combo.members)
    expect(parsed.value.customs?.[0].parameterId).toBe('Param7')
  })

  it.each([
    { ...combo, members: [] },
    { ...combo, members: [{ expressionId: 'a', strength: 1.5 }] },
    { ...combo, members: [{ expressionId: 'a', strength: -0.1 }] },
    { ...combo, members: [{ expressionId: 'a', strength: Number.NaN }] },
    { ...combo, members: [{ expressionId: 'a', strength: Number.POSITIVE_INFINITY }] },
    { ...combo, id: 'smile' },
    { ...combo, label: '' },
  ])('rejects malformed combo documents %j', (document) => {
    expect(safeParse(ComboDocumentSchema, document).success).toBe(false)
    expect(parseCuratedCatalogDocument({ version: 1, overrides: [], combos: [document] }).success).toBe(false)
  })

  it.each([
    { ...custom, kind: 'combo' },
    { ...custom, id: 'earphones' },
    { ...custom, label: '' },
    { ...custom, delta: Number.POSITIVE_INFINITY },
  ])('rejects malformed custom documents %j', (document) => {
    expect(safeParse(CustomExpressionDocumentSchema, document).success).toBe(false)
    expect(parseCuratedCatalogDocument({ version: 1, overrides: [], customs: [document] }).success).toBe(false)
  })

  it.each([
    { slots: ['face', 'effect'] as const, auto: true, llm: true },
    { slots: ['face', 'prop'] as const, auto: false, llm: true },
    { slots: [] as const, auto: false, llm: false },
  ])('enforces eligibility for combo slots $slots', ({ slots, auto, llm }) => {
    const candidate = { ...entry('combo'), slots: [...slots] }
    expect(isAutoEligible(candidate)).toBe(auto)
    expect(isLlmEligible(candidate)).toBe(llm)
    expect(isLlmEligible({ ...candidate, exposedToLlm: false })).toBe(false)
  })

  it.each(['face', 'effect', 'prop', 'combo'] as const)('excludes duplicate %s entries from automatic and LLM use', (kind) => {
    const duplicate = { ...entry(kind), duplicateOf: 'primary', slots: ['face' as const] }
    expect(isAutoEligible(duplicate)).toBe(false)
    expect(isLlmEligible(duplicate)).toBe(false)
  })

  it('adopts the first alias override as a whole without replacing the primary id', () => {
    const primary = { ...entry(), aliases: ['missing', 'alias-a', 'alias-b'] }
    const curated = parse(CuratedCatalogDocumentSchema, { version: 1, overrides: [
      { id: 'alias-b', label: 'Second', kind: 'effect' },
      { id: 'alias-a', label: 'First', area: 'cheeks', keepSeparate: false },
    ] })
    expect(mergeCatalog([primary], curated)).toEqual([{ ...primary, label: 'First', area: 'cheeks' }])
    expect(curated.overrides).toHaveLength(2)
    curated.overrides.push({ id: primary.id, confirmed: false })
    expect(mergeCatalog([primary], curated)).toEqual([{ ...primary, confirmed: false }])
  })

  it('appends custom entries then combos with computed slots, area, parameters and mapping defaults', () => {
    const face = { ...entry(), area: 'whole-look' as const, aliases: ['alias'], parameterIds: ['Shared', 'Face'] }
    const effect = { ...entry('effect'), id: 'effect', area: 'effects' as const, parameterIds: ['Shared', 'Effect'] }
    const customEntry = customEntryFromDocument(parse(CustomExpressionDocumentSchema, custom))
    const curated = parse(CuratedCatalogDocumentSchema, { version: 1, overrides: [], combos: [
      { ...combo, members: [{ expressionId: 'effect', strength: 0.5 }, { expressionId: 'alias', strength: 1 }] },
      { ...combo, id: 'combo:single', area: 'cheeks' },
      { ...combo, id: 'combo:shared-area' },
    ] })
    const merged = mergeCatalog([face, effect], curated, [customEntry])
    expect(merged.map(candidate => candidate.id)).toEqual([face.id, effect.id, custom.id, combo.id, 'combo:single', 'combo:shared-area'])
    expect(merged[3]).toMatchObject({
      kind: 'combo',
      slots: ['face', 'effect'],
      area: 'whole-look',
      parameterIds: ['Shared', 'Effect', 'Face'],
      group: null,
      confirmed: true,
      fileName: '',
      labelSource: 'user',
      mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }],
      members: curated.combos![0].members,
    })
    expect(merged[4].area).toBe('cheeks')
    expect(merged[5].area).toBe('whole-look')
    expect(customEntry).toEqual({
      id: custom.id,
      label: custom.label,
      kind: 'prop',
      area: 'props',
      parameterIds: ['Param7'],
      mappings: [],
      exposedToLlm: false,
      group: null,
      confirmed: true,
      fileName: '',
      labelSource: 'user',
    })
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
