import { createMMDMaterialEvaluatedState } from '@moeru/three-mmd/materials'
import { MMDToonMaterial } from '@moeru/three-mmd/materials/toon'
import { BufferGeometry, Mesh } from 'three'
import { describe, expect, it } from 'vitest'

import { composeMMDMaterialOpacity, disposeMMDObject } from '../../../utils/mmd-materials'
import { descriptor, element, materialMorph } from './fixtures'
import { MaterialMorphApplier } from './material'

describe('real MMDToonMaterial morph composition', () => {
  it('composes a scalar evaluated opacity and restores authored transparency', () => {
    const material = new MMDToonMaterial(descriptor())
    try {
      composeMMDMaterialOpacity(material, 0, 0.5)
      expect(material.opacity).toBe(0.5)
      expect(material.transparent).toBe(true)
      composeMMDMaterialOpacity(material, 0)
      expect(material.opacity).toBe(0)
      composeMMDMaterialOpacity(material, 1)
      expect(material.opacity).toBe(1)
      expect(material.transparent).toBe(false)
    }
    finally {
      material.dispose()
      material.descriptor.toonMap?.dispose()
    }
  })

  it.each([0, 1] as const)('applies operation %s tints and restores every descriptor field exactly', (operation) => {
    const material = new MMDToonMaterial(descriptor())
    const root = new Mesh(new BufferGeometry(), material)
    const base = createMMDMaterialEvaluatedState(material.descriptor)
    const runtime = new MaterialMorphApplier([material], [materialMorph([element(0, operation)])])
    try {
      runtime.apply([1])
      const tint = operation === 0 ? 'textureMultiplicativeColor' : 'textureAdditiveColor'
      expect(material[tint].toArray()).toEqual([expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6), expect.closeTo(0.8)])
      expect(material[operation === 0 ? 'sphereTextureMultiplicativeColor' : 'sphereTextureAdditiveColor'].toArray()).toEqual([
        expect.closeTo(0.3),
        expect.closeTo(0.5),
        expect.closeTo(0.7),
        expect.closeTo(0.9),
      ])
      expect(material[operation === 0 ? 'toonTextureMultiplicativeColor' : 'toonTextureAdditiveColor'].toArray()).toEqual([
        expect.closeTo(0.4),
        expect.closeTo(0.6),
        expect.closeTo(0.8),
        1,
      ])
      runtime.apply([0])
      expect(material.color.toArray()).toEqual(base.diffuse.toArray())
      expect(material.specular.toArray()).toEqual(base.specular.toArray())
      expect(material.ambient.toArray()).toEqual(base.ambient.toArray())
      expect(material.shininess).toBe(base.shininess)
      expect(material.opacity).toBe(base.opacity)
      for (const key of ['textureMultiplicativeColor', 'textureAdditiveColor', 'sphereTextureMultiplicativeColor', 'sphereTextureAdditiveColor', 'toonTextureMultiplicativeColor', 'toonTextureAdditiveColor'] as const)
        expect(material[key].toArray()).toEqual(base[key].toArray())
    }
    finally {
      disposeMMDObject(root)
      material.descriptor.toonMap?.dispose()
    }
  })

  it('lets user opacity win, removes it back to the live morph, and finally restores authored opacity', () => {
    const material = new MMDToonMaterial(descriptor())
    const root = new Mesh(new BufferGeometry(), material)
    const runtime = new MaterialMorphApplier([material], [materialMorph()])
    try {
      runtime.apply([1])
      expect(material.opacity).toBe(0)
      expect(material.transparent).toBe(true)
      runtime.apply([1], { surface: 0.5 })
      expect(material.opacity).toBe(0.5)
      runtime.apply([1])
      expect(material.opacity).toBe(0)
      runtime.apply([0])
      expect(material.opacity).toBe(1)
      expect(material.descriptor.opacity).toBe(1)
    }
    finally {
      disposeMMDObject(root)
      material.descriptor.toonMap?.dispose()
    }
  })
})
