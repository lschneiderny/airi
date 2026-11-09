import { describe, expect, it } from 'vitest'

import { activeCanvasPointer, canvasPointerFreshMs } from './canvas-pointer'

describe('activeCanvasPointer', () => {
  const sample = { x: 10, y: 20, atMs: 1_000 }
  const fresh = 1_000 + canvasPointerFreshMs - 1
  const stale = 1_000 + canvasPointerFreshMs + 500

  it('uses a fresh sample with or without a host cursor', () => {
    expect(activeCanvasPointer(sample, fresh, { hostCursor: true, pointerOver: true })).toBe(sample)
    expect(activeCanvasPointer(sample, fresh, { hostCursor: false, pointerOver: false })).toBe(sample)
  })

  it('hands a stale sample over to the host cursor', () => {
    expect(activeCanvasPointer(sample, stale, { hostCursor: true, pointerOver: true })).toBeUndefined()
  })

  it('holds a resting hand without a host cursor until the pointer leaves the canvas', () => {
    expect(activeCanvasPointer(sample, stale, { hostCursor: false, pointerOver: true })).toBe(sample)
    expect(activeCanvasPointer(sample, stale, { hostCursor: false, pointerOver: false })).toBeUndefined()
  })

  it('has nothing to report before the first move', () => {
    expect(activeCanvasPointer(undefined, fresh, { hostCursor: false, pointerOver: true })).toBeUndefined()
  })
})
