import { BufferAttribute } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { uv } from './fixtures'
import { UvMorphApplier } from './uv'

describe('base UV surface stage', () => {
  it('sums offsets absolutely, marks affected ranges, and restores the base once', () => {
    const attribute = new BufferAttribute(new Float32Array([0.5, 0.5, 1, 1]), 2)
    const update = vi.spyOn(attribute, 'addUpdateRange')
    const applier = new UvMorphApplier(attribute, [uv, uv])
    applier.apply([1, 0.5])
    expect(Array.from(attribute.array)).toEqual([0.875, -0.25, 1, 1])
    applier.apply([1, 0.5])
    expect(Array.from(attribute.array)).toEqual([0.875, -0.25, 1, 1])
    expect(update).toHaveBeenCalledWith(0, 2)
    expect(attribute.version).toBe(2)
    applier.apply([0, 0])
    expect(Array.from(attribute.array)).toEqual([0.5, 0.5, 1, 1])
    applier.apply([0, 0])
    expect(attribute.version).toBe(3)
  })

  it('does not apply additional UV channels to the base UV buffer', () => {
    const attribute = new BufferAttribute(new Float32Array([0.5, 0.5]), 2)
    new UvMorphApplier(attribute, [{ ...uv, type: 4 }]).apply([1])
    expect(Array.from(attribute.array)).toEqual([0.5, 0.5])
    expect(attribute.version).toBe(0)
  })
})
