import type { ItemExpressionDocument, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionPanelItem } from './source'

import { describe, expect, it, vi } from 'vitest'

import {
  createFramePatchQueue,
  degreesOf,
  itemFrame,
  normalizeDegrees,
  pinnedPlacement,
  placementFieldPatch,
  previewItemsFor,
  rotationFromHandle,
  scaleFromHandle,
  unpinnedPlacement,
  withFieldPatch,
} from './item-placement'

const placement: StageItemPlacement = { x: 100, y: 200, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' } }

function document(id: string, assetId = `asset-${id}`): ItemExpressionDocument {
  return { id: `item:${id}`, assetId, label: id, kind: 'prop', mappings: [], exposedToLlm: false, placement, hides: [], link: 'none' }
}

function shown(id: string, overrides: Partial<ExpressionPanelItem> = {}): ExpressionPanelItem {
  return { document: document(id), available: true, shown: true, state: 'attached', ...overrides }
}

describe('previewItemsFor', () => {
  it('draws the shown available items and puts the draft in place of its stored document', () => {
    const draft = { ...document('hat'), placement: { ...placement, x: 5 } }
    const { documents, refusal } = previewItemsFor([shown('hat'), shown('book'), shown('ghost', { available: false }), shown('off', { shown: false })], draft, () => false)
    expect(documents.map(item => item.id)).toEqual(['item:hat', 'item:book'])
    expect(documents[0]).toBe(draft)
    expect(refusal).toBeNull()
  })

  it('adds an unshown draft while the caps allow and refuses it past them without dropping a shown item', () => {
    const fifteen = Array.from({ length: 15 }, (_, index) => shown(`i${index}`))
    expect(previewItemsFor(fifteen, document('new'), () => false).documents).toHaveLength(16)
    const sixteen = [...fifteen, shown('i15')]
    const full = previewItemsFor(sixteen, document('new'), () => false)
    expect(full.refusal).toBe('item-limit')
    expect(full.documents.map(item => item.id)).toEqual(sixteen.map(item => item.document.id))
  })

  it('refuses a fifth Live2D item while a fifth image still fits', () => {
    const four = Array.from({ length: 4 }, (_, index) => shown(`l${index}`))
    const isLive2D = (assetId: string) => assetId.startsWith('asset-l') || assetId === 'asset-outfit'
    expect(previewItemsFor(four, document('outfit'), isLive2D).refusal).toBe('item-limit')
    expect(previewItemsFor(four, document('hat'), isLive2D).refusal).toBeNull()
  })
})

describe('placement fields', () => {
  it('wraps degrees into (-180, 180] and converts to radians', () => {
    expect(normalizeDegrees(370)).toBe(10)
    expect(normalizeDegrees(-190)).toBe(170)
    expect(normalizeDegrees(180)).toBe(180)
    expect(normalizeDegrees(-180)).toBe(180)
    expect(degreesOf(Math.PI / 2)).toBeCloseTo(90)
    expect(placementFieldPatch('rotationDegrees', '450')!.rotation).toBeCloseTo(Math.PI / 2)
  })

  it('rejects NaN, empty text, and a scale at or below zero, and clamps the anchor and scale', () => {
    expect(placementFieldPatch('x', 'abc')).toBeUndefined()
    expect(placementFieldPatch('y', '')).toBeUndefined()
    expect(placementFieldPatch('scale', '0')).toBeUndefined()
    expect(placementFieldPatch('scale', '-2')).toBeUndefined()
    expect(placementFieldPatch('scale', 'Infinity')).toBeUndefined()
    expect(placementFieldPatch('scale', '0.0001')).toEqual({ scale: 0.01 })
    expect(placementFieldPatch('scale', '1000')).toEqual({ scale: 100 })
    expect(placementFieldPatch('anchorX', '1.5')).toEqual({ anchorX: 1 })
    expect(placementFieldPatch('anchorY', '-3')).toEqual({ anchorY: 0 })
    expect(placementFieldPatch('x', '12.5')).toEqual({ x: 12.5 })
  })

  it('folds anchor coordinates into the anchor and keeps the rest of the placement', () => {
    expect(withFieldPatch(placement, { anchorX: 0 })).toEqual({ ...placement, anchor: { x: 0, y: 0.5 } })
    expect(withFieldPatch(placement, { rotation: 1 })).toEqual({ ...placement, rotation: 1 })
  })
})

describe('handles', () => {
  it('scales by the pointer distance ratio from the center and clamps', () => {
    const center = { x: 0, y: 0 }
    expect(scaleFromHandle(2, center, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(4)
    expect(scaleFromHandle(2, center, { x: 10, y: 0 }, { x: 0, y: 0 })).toBe(0.01)
    expect(scaleFromHandle(2, center, { x: 0, y: 0 }, { x: 5, y: 5 })).toBe(2)
  })

  it('rotates by the angle the pointer swept around the center', () => {
    const center = { x: 0, y: 0 }
    expect(rotationFromHandle(0.5, center, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0.5 + Math.PI / 2)
  })
})

describe('itemFrame', () => {
  it('places the corners around the anchor, scaled, flipped, and rotated', () => {
    const size = { width: 20, height: 10 }
    expect(itemFrame({ x: 100, y: 50, rotation: 0, scale: 2 }, size, { x: 0.5, y: 0.5 }, false)).toEqual([
      { x: 80, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
    ])
    expect(itemFrame({ x: 0, y: 0, rotation: 0, scale: 1 }, size, { x: 0, y: 0 }, true)[1]).toEqual({ x: -20, y: 0 })
    const turned = itemFrame({ x: 0, y: 0, rotation: Math.PI / 2, scale: 1 }, size, { x: 0, y: 0 }, false)
    expect(turned[1].x).toBeCloseTo(0)
    expect(turned[1].y).toBeCloseTo(20)
  })
})

describe('pin changes', () => {
  const pin = { drawableId: 'Head', vertices: [0, 1, 2] as [number, number, number], weights: [0.2, 0.3, 0.5] as [number, number, number], reference: [0, 0, 1, 0, 0, 1] as [number, number, number, number, number, number], vertexCount: 3, modelPoint: { x: 7, y: 8 } }

  it('pins at the clicked point and unpins where the item draws now', () => {
    const pinned = pinnedPlacement(placement, pin)
    expect(pinned).toEqual({ ...placement, pin, x: 7, y: 8 })
    const released = unpinnedPlacement(pinned, { x: 30, y: 40, rotation: 0.25, scale: 1.5 })
    expect(released).toEqual({ ...placement, x: 30, y: 40, rotation: 0.25, scale: 1.5 })
    expect(released).not.toHaveProperty('pin')
    expect(unpinnedPlacement(pinned, undefined)).toEqual({ ...placement, x: 7, y: 8 })
  })
})

describe('createFramePatchQueue', () => {
  function fakeFrames() {
    const callbacks = new Map<number, () => void>()
    let next = 1
    return {
      schedule: (callback: () => void) => {
        callbacks.set(next, callback)
        return next++
      },
      cancel: (handle: number) => {
        callbacks.delete(handle)
      },
      tick: () => {
        const due = [...callbacks.values()]
        callbacks.clear()
        for (const callback of due)
          callback()
      },
      pending: () => callbacks.size,
    }
  }

  it('sends one merged patch per item per frame, the last value winning', () => {
    const frames = fakeFrames()
    const emit = vi.fn()
    const queue = createFramePatchQueue(emit, frames.schedule, frames.cancel)
    queue.push('item:a', { placement: { ...placement, x: 1 } })
    queue.push('item:a', { placement: { ...placement, x: 2 } })
    queue.push('item:a', { hides: ['PartHair'] })
    queue.push('item:b', { link: 'parameters' })
    expect(emit).not.toHaveBeenCalled()
    expect(frames.pending()).toBe(1)
    frames.tick()
    expect(emit.mock.calls).toEqual([
      ['item:a', { placement: { ...placement, x: 2 }, hides: ['PartHair'] }],
      ['item:b', { link: 'parameters' }],
    ])
    frames.tick()
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('flushes on demand and drops a cancelled frame', () => {
    const frames = fakeFrames()
    const emit = vi.fn()
    const queue = createFramePatchQueue(emit, frames.schedule, frames.cancel)
    queue.push('item:a', { placement })
    queue.flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(frames.pending()).toBe(0)
    queue.push('item:a', { placement })
    queue.cancel()
    frames.tick()
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
