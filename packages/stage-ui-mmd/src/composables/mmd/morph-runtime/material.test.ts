import { MMDToonMaterial } from '@moeru/three-mmd/materials/toon'
import { describe, expect, it, vi } from 'vitest'

import { descriptor, element, materialMorph } from './fixtures'
import { MaterialMorphApplier } from './material'

describe('material dirty tracking', () => {
  it('composes authored opacity every frame even on a material with no active morph', () => {
    const material = new MMDToonMaterial(descriptor())
    const apply = vi.spyOn(material, 'applyMMDMaterialState')
    const runtime = new MaterialMorphApplier([material], [])
    try {
      material.opacity = 0.2
      runtime.apply([])
      expect(material.opacity).toBe(1)
      runtime.apply([], { surface: 0.5 })
      expect(material.opacity).toBe(0.5)
      runtime.apply([])
      expect(material.opacity).toBe(1)
      expect(apply).not.toHaveBeenCalled()
    }
    finally {
      material.dispose()
      material.descriptor.toonMap?.dispose()
    }
  })

  it('restores on the first zero-weight frame then leaves clean materials alone', () => {
    const material = new MMDToonMaterial(descriptor())
    const apply = vi.spyOn(material, 'applyMMDMaterialState')
    const runtime = new MaterialMorphApplier([material], [materialMorph()])
    runtime.apply([1])
    expect(material.opacity).toBe(0)
    runtime.apply([0])
    expect(material.opacity).toBe(1)
    expect(material.color).toEqual(material.descriptor.diffuse)
    expect(apply).toHaveBeenCalledTimes(2)
    runtime.apply([0])
    expect(apply).toHaveBeenCalledTimes(2)
    material.dispose()
  })

  it('targets every material for index -1 and restores both', () => {
    const materials = [new MMDToonMaterial(descriptor('a')), new MMDToonMaterial(descriptor('b'))]
    const runtime = new MaterialMorphApplier(materials, [materialMorph([element(-1)])])
    runtime.apply([1])
    expect(materials.map(m => m.opacity)).toEqual([0, 0])
    runtime.apply([0])
    expect(materials.map(m => m.opacity)).toEqual([1, 1])
    materials.forEach(m => m.dispose())
  })
})
