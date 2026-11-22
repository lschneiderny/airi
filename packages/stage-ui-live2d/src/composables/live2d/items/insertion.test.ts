import type { Live2DItemInsertion } from './insertion'

import { describe, expect, it } from 'vitest'

import { resolveInsertionSegments } from './insertion'

const drawableIds = ['Body', 'Hair', 'Face', 'Bangs']
const indexById = (id: string) => drawableIds.indexOf(id)

describe('resolveInsertionSegments', () => {
  it('returns no segments for no items, so the caller leaves the hook unset', () => {
    expect(resolveInsertionSegments([], [0, 1, 2, 3], indexById)).toEqual({ segments: [], missingLayer: [] })
  })

  it('places behind items first, above items after their drawable, and front items last', () => {
    // Render order by drawable index: Body 1, Hair 0, Face 2, Bangs 3.
    const items: Live2DItemInsertion[] = [
      { id: 'item:front', layer: { kind: 'front' } },
      { id: 'item:above-face', layer: { kind: 'above', drawableId: 'Face' } },
      { id: 'item:behind', layer: { kind: 'behind' } },
      { id: 'item:above-hair', layer: { kind: 'above', drawableId: 'Hair' } },
    ]

    expect(resolveInsertionSegments(items, [1, 0, 2, 3], indexById).segments).toEqual([
      { kind: 'insert', itemIds: ['item:behind'] },
      { kind: 'model', from: 0, to: 1 },
      { kind: 'insert', itemIds: ['item:above-hair'] },
      { kind: 'model', from: 1, to: 3 },
      { kind: 'insert', itemIds: ['item:above-face'] },
      { kind: 'model', from: 3, to: 4 },
      { kind: 'insert', itemIds: ['item:front'] },
    ])
  })

  it('keeps list order for items at the same position', () => {
    const items: Live2DItemInsertion[] = [
      { id: 'item:a', layer: { kind: 'front' } },
      { id: 'item:b', layer: { kind: 'above', drawableId: 'Bangs' } },
      { id: 'item:c', layer: { kind: 'above', drawableId: 'Body' } },
      { id: 'item:d', layer: { kind: 'above', drawableId: 'Body' } },
    ]

    expect(resolveInsertionSegments(items, [0, 1, 2, 3], indexById).segments).toEqual([
      { kind: 'model', from: 0, to: 1 },
      { kind: 'insert', itemIds: ['item:c', 'item:d'] },
      { kind: 'model', from: 1, to: 4 },
      { kind: 'insert', itemIds: ['item:a', 'item:b'] },
    ])
  })

  it('draws an item above a missing drawable in front and reports it', () => {
    const items: Live2DItemInsertion[] = [
      { id: 'item:lost', layer: { kind: 'above', drawableId: 'Tail' } },
      { id: 'item:behind', layer: { kind: 'behind' } },
    ]

    expect(resolveInsertionSegments(items, [0, 1, 2, 3], indexById)).toEqual({
      segments: [
        { kind: 'insert', itemIds: ['item:behind'] },
        { kind: 'model', from: 0, to: 4 },
        { kind: 'insert', itemIds: ['item:lost'] },
      ],
      missingLayer: ['item:lost'],
    })
  })

  it('treats an index outside the render orders as missing', () => {
    const items: Live2DItemInsertion[] = [{ id: 'item:x', layer: { kind: 'above', drawableId: 'Bangs' } }]

    expect(resolveInsertionSegments(items, [0, 1], indexById).missingLayer).toEqual(['item:x'])
  })

  it('re-resolves a render order that changed between calls', () => {
    const items: Live2DItemInsertion[] = [{ id: 'item:hat', layer: { kind: 'above', drawableId: 'Hair' } }]
    const orders = [0, 1, 2, 3]

    expect(resolveInsertionSegments(items, orders, indexById).segments[1]).toEqual({ kind: 'insert', itemIds: ['item:hat'] })
    // A motion moves the hair to the top of the draw order.
    orders[1] = 3
    orders[3] = 1
    expect(resolveInsertionSegments(items, orders, indexById).segments).toEqual([
      { kind: 'model', from: 0, to: 4 },
      { kind: 'insert', itemIds: ['item:hat'] },
    ])
  })

  it('handles a model with no drawables', () => {
    const items: Live2DItemInsertion[] = [
      { id: 'item:front', layer: { kind: 'front' } },
      { id: 'item:behind', layer: { kind: 'behind' } },
    ]

    expect(resolveInsertionSegments(items, [], () => -1).segments).toEqual([
      { kind: 'insert', itemIds: ['item:front', 'item:behind'] },
    ])
  })
})
