import type { PmxObject } from '@moeru/three-mmd'
import type { MMDMaterial } from '@moeru/three-mmd/materials'
import type { Color, ShaderMaterial } from 'three'

import { applyMMDMaterialMorph, createMMDMaterialEvaluatedState } from '@moeru/three-mmd/materials'

import { composeMMDMaterialOpacity } from '../../../utils/mmd-materials'

type MaterialMorphElement = PmxObject.Morph.MaterialMorph['elements'][number]

/** The authored appearance that every evaluation starts from. */
interface BaseAppearance {
  ambient: Color
  color: Color
  opacity: number
  shininess: number
  specular: Color
}

/** The edge of a generated outline, which three-mmd's evaluated state does not carry. */
interface EdgeState {
  color: Color
  alpha: number
  width: number
}

/** Applies one PMX material morph element to an edge, with the PMX multiply (0) and add (1) operations. */
function applyEdgeMorph(edge: EdgeState, element: MaterialMorphElement, weight: number): void {
  const [r, g, b, a] = element.edgeColor
  if (element.type === 0) {
    edge.color.r += (edge.color.r * r - edge.color.r) * weight
    edge.color.g += (edge.color.g * g - edge.color.g) * weight
    edge.color.b += (edge.color.b * b - edge.color.b) * weight
    edge.alpha += (edge.alpha * a - edge.alpha) * weight
    edge.width += (edge.width * element.edgeSize - edge.width) * weight
  }
  else {
    edge.color.r += r * weight
    edge.color.g += g * weight
    edge.color.b += b * weight
    edge.alpha += a * weight
    edge.width += element.edgeSize * weight
  }
}

/** Reads the edge of an outline that has the standard Three outline uniforms. */
function readEdge(outline: ShaderMaterial | undefined): EdgeState | undefined {
  const uniforms = outline?.uniforms
  if (!uniforms?.outlineColor || !uniforms.outlineAlpha || !uniforms.outlineThickness)
    return undefined
  return {
    color: (uniforms.outlineColor.value as Color).clone(),
    alpha: uniforms.outlineAlpha.value as number,
    width: uniforms.outlineThickness.value as number,
  }
}

/**
 * Loader material indices, not traversal indices, determine PMX targets.
 *
 * three-mmd evaluates a morph against the material's current values, so the applier snapshots each material's
 * authored appearance, and each outline's edge, when it is built, before any morph runs.
 */
export class MaterialMorphApplier {
  private dirty = new Set<number>()
  private readonly evaluatedOpacities: number[]
  private readonly bases: BaseAppearance[]
  private readonly edges: (EdgeState | undefined)[]

  constructor(
    private readonly materials: readonly MMDMaterial[],
    private readonly morphs: readonly PmxObject.Morph[],
    private readonly outlines: readonly (ShaderMaterial | undefined)[] = [],
  ) {
    this.bases = materials.map(material => snapshotAppearance(material))
    this.evaluatedOpacities = this.bases.map(base => base.opacity)
    this.edges = materials.map((_, index) => readEdge(outlines[index]))
    for (const morph of morphs) {
      if (morph.type !== 8)
        continue
      for (const element of morph.elements) {
        const targets = element.index === -1 ? materials : materials.slice(element.index, element.index + 1)
        for (const material of targets) {
          // The loader misses index -1 alpha morphs. Enable the same policy for every target.
          if (element.type === 0 ? element.diffuse[3] !== 1 : element.diffuse[3] !== 0) {
            material.alphaMorph = true
            material.updateAlpha()
          }
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
      const state = createMMDMaterialEvaluatedState(this.bases[index])
      const baseEdge = this.edges[index]
      const edge = baseEdge && { ...baseEdge, color: baseEdge.color.clone() }
      this.morphs.forEach((morph, i) => {
        if (morph.type !== 8 || !weights[i])
          return
        for (const element of morph.elements) {
          if (element.index !== -1 && element.index !== index)
            continue
          applyMMDMaterialMorph(state, element, weights[i])
          if (edge)
            applyEdgeMorph(edge, element, weights[i])
        }
      })
      material.applyMMDMaterialState(state)
      this.evaluatedOpacities[index] = state.opacity
      const outline = this.outlines[index]
      if (outline && edge) {
        outline.uniforms.outlineColor.value.copy(edge.color)
        outline.uniforms.outlineAlpha.value = edge.alpha
        outline.uniforms.outlineThickness.value = edge.width
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

/** Copies the authored values of a material that `createMMDMaterialEvaluatedState` reads. */
function snapshotAppearance(material: MMDMaterial): BaseAppearance {
  // Every three-mmd material backend extends a Phong or physical material, which carry these fields.
  const surface = material as MMDMaterial & BaseAppearance
  return {
    ambient: surface.ambient.clone(),
    color: surface.color.clone(),
    opacity: surface.opacity,
    shininess: surface.shininess,
    specular: surface.specular.clone(),
  }
}
