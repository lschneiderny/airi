import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { idleActivityEntries, isAutoEligible, isLlmEligible, itemEntryFromDocument, ItemExpressionDocumentSchema, parseCuratedCatalogDocument, StageItemPinSchema, StageItemPlacementSchema } from '.'

const pin = {
  drawableId: 'ArtMesh12',
  vertices: [3, 4, 9],
  weights: [0.2, 0.3, 0.5],
  reference: [10, 20, 30, 20, 20, 40],
  vertexCount: 48,
  modelPoint: { x: 21, y: 26 },
}

const placement = {
  x: 512,
  y: 300,
  rotation: 0.5,
  scale: 1.5,
  flipX: false,
  anchor: { x: 0.5, y: 1 },
  layer: { kind: 'above', drawableId: 'ArtMesh30' },
  pin,
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item:hat',
    assetId: 'asset-hat',
    label: 'Hat',
    kind: 'prop',
    mappings: [],
    exposedToLlm: false,
    placement,
    ...overrides,
  }
}

describe('item documents', () => {
  it('parses a valid document and fills the optional hide list and link', () => {
    const parsed = parse(ItemExpressionDocumentSchema, item({ idleUse: 'activity', occasions: ['morning'], moments: ['peering'] }))
    expect(parsed.placement).toEqual(placement)
    expect(parsed.hides).toEqual([])
    expect(parsed.link).toBe('none')
    expect(parse(ItemExpressionDocumentSchema, item({ kind: 'outfit', hides: ['PartBody'], link: 'parameters' })).hides).toEqual(['PartBody'])
    expect(parse(ItemExpressionDocumentSchema, item({ placement: { ...placement, layer: { kind: 'behind' }, pin: undefined, fadeWithMesh: true } })).placement.layer).toEqual({ kind: 'behind' })
  })

  it.each([
    ['weights that do not sum to 1', item({ placement: { ...placement, pin: { ...pin, weights: [0.2, 0.3, 0.4] } } })],
    ['NaN weights', item({ placement: { ...placement, pin: { ...pin, weights: [Number.NaN, 0.5, 0.5] } } })],
    ['infinite weights', item({ placement: { ...placement, pin: { ...pin, weights: [Number.POSITIVE_INFINITY, 0, 0] } } })],
    ['a negative weight', item({ placement: { ...placement, pin: { ...pin, weights: [-0.5, 0.5, 1] } } })],
    ['two weights', item({ placement: { ...placement, pin: { ...pin, weights: [0.5, 0.5] } } })],
    ['a fractional vertex index', item({ placement: { ...placement, pin: { ...pin, vertices: [1.5, 2, 3] } } })],
    ['a reference with five numbers', item({ placement: { ...placement, pin: { ...pin, reference: [1, 2, 3, 4, 5] } } })],
    ['an id without the item: prefix', item({ id: 'custom:hat' })],
    ['kind face', item({ kind: 'face' })],
    ['kind combo', item({ kind: 'combo' })],
    ['an empty label', item({ label: '' })],
    ['a negative scale', item({ placement: { ...placement, scale: -1 } })],
    ['a zero scale', item({ placement: { ...placement, scale: 0 } })],
    ['anchor 1.5', item({ placement: { ...placement, anchor: { x: 1.5, y: 0 } } })],
    ['anchor -0.1', item({ placement: { ...placement, anchor: { x: 0.5, y: -0.1 } } })],
    ['an above layer without a drawable', item({ placement: { ...placement, layer: { kind: 'above' } } })],
    ['an unknown link', item({ link: 'motion' })],
    ['an asset URL field', item({ url: 'blob:example' })],
  ])('rejects %s', (_case, input) => {
    expect(safeParse(ItemExpressionDocumentSchema, input).success).toBe(false)
  })

  it('accepts weights that sum to 1 within rounding and rejects a pin with fewer than three vertices', () => {
    expect(safeParse(StageItemPinSchema, { ...pin, weights: [0.1, 0.2, 0.7000000001] }).success).toBe(true)
    expect(safeParse(StageItemPinSchema, { ...pin, vertexCount: 2 }).success).toBe(false)
    expect(safeParse(StageItemPlacementSchema, { ...placement, x: Number.NaN }).success).toBe(false)
  })
})

describe('item catalog entries', () => {
  function entryOf(overrides: Record<string, unknown>) {
    return itemEntryFromDocument(parse(ItemExpressionDocumentSchema, item(overrides)))
  }

  it('builds a user entry with no parameters', () => {
    expect(entryOf({ kind: 'effect', area: 'effects', mappings: [{ emotion: 'happy' }] })).toEqual({
      id: 'item:hat',
      label: 'Hat',
      kind: 'effect',
      area: 'effects',
      mappings: [{ emotion: 'happy', weight: 1, minBand: 'strong' }],
      exposedToLlm: false,
      fileName: '',
      parameterIds: [],
      group: null,
      confirmed: true,
      labelSource: 'user',
    })
  })

  it('offers a pastime item to her idle use', () => {
    expect(idleActivityEntries([entryOf({ idleUse: 'activity', occasions: ['gaming'] })])).toEqual([{ id: 'item:hat', label: 'Hat', occasions: ['gaming'] }])
  })

  it('keeps outfits away from automatic use and the chat model, and exposes an opted-in prop', () => {
    const outfit = entryOf({ kind: 'outfit', exposedToLlm: true })
    expect(outfit.exposedToLlm).toBe(false)
    expect(isAutoEligible(outfit)).toBe(false)
    expect(isLlmEligible(outfit)).toBe(false)
    expect(isLlmEligible(entryOf({ kind: 'prop', exposedToLlm: true }))).toBe(true)
  })
})

describe('curated catalog document with items', () => {
  it('parses a stored document without items unchanged', () => {
    const stored = { version: 1, overrides: [{ id: 'a', label: 'A' }], customs: [] }
    expect(parseCuratedCatalogDocument(stored)).toEqual({ success: true, value: stored })
  })

  it('parses item documents and rejects an invalid one', () => {
    const parsed = parseCuratedCatalogDocument({ version: 1, overrides: [], items: [item()] })
    expect(parsed.success && parsed.value.items?.[0].link).toBe('none')
    expect(parseCuratedCatalogDocument({ version: 1, overrides: [], items: [item({ kind: 'face' })] }).success).toBe(false)
  })
})
