import type { PmxObject } from '@moeru/three-mmd'
import type { MMDMaterial } from '@moeru/three-mmd/materials'
import type { ShaderMaterial } from 'three'

import { applyMMDMaterialMorph, createMMDMaterialEvaluatedState } from '@moeru/three-mmd/materials'

import { composeMMDMaterialOpacity } from '../../../utils/mmd-materials'

/** Loader material indices, not traversal indices, determine PMX targets. */
export class MaterialMorphApplier {
  private dirty = new Set<number>()
  private readonly evaluatedOpacities: number[]

  constructor(
    private readonly materials: readonly MMDMaterial[],
    private readonly morphs: readonly PmxObject.Morph[],
    private readonly outlines: readonly (ShaderMaterial | undefined)[] = [],
  ) {
    this.evaluatedOpacities = materials.map(material => material.descriptor.opacity)
    for (const morph of morphs) {
      if (morph.type !== 8)
        continue
      for (const element of morph.elements) {
        const targets = element.index === -1 ? materials : materials.slice(element.index, element.index + 1)
        for (const material of targets) {
          // The loader misses index -1 alpha morphs. Enable the same policy for
          // every target; descriptor opacity remains immutable.
          if (element.type === 0 ? element.diffuse[3] !== 1 : element.diffuse[3] !== 0)
            material.setMMDAlphaMorphEnabled(true)
        }
      }
    }
  }

  apply(weights: readonly number[], overrides: Readonly<Record<string, number>> = {}): void {
    const active = new Set<number>()
    this.morphs.forEach((morph, i) => {
      if (morph.type !== 8 || !weights[i])
        return
      for (const element of morph.elements) {
        if (element.index === -1)
          this.materials.forEach((_, index) => active.add(index))
        else
          active.add(element.index)
      }
    })
    const touched = new Set([...this.dirty, ...active])
    for (const index of touched) {
      const material = this.materials[index]
      const state = createMMDMaterialEvaluatedState(material.descriptor)
      this.morphs.forEach((morph, i) => {
        if (morph.type !== 8 || !weights[i])
          return
        for (const element of morph.elements) {
          if (element.index === -1 || element.index === index)
            applyMMDMaterialMorph(state, element, weights[i])
        }
      })
      material.applyMMDMaterialState(state)
      this.evaluatedOpacities[index] = state.opacity
      const outline = this.outlines[index]
      if (outline) {
        if (outline.uniforms.outlineColor)
          outline.uniforms.outlineColor.value.copy(state.edgeColor)
        if (outline.uniforms.outlineAlpha)
          outline.uniforms.outlineAlpha.value = state.edgeAlpha
        if (outline.uniforms.outlineThickness)
          outline.uniforms.outlineThickness.value = state.edgeWidth
      }
    }
    this.materials.forEach((material, index) => {
      composeMMDMaterialOpacity(material, this.evaluatedOpacities[index], overrides[material.name])
    })
    this.dirty = active
  }

  resetToBase(): void {
    this.apply([])
  }
}
