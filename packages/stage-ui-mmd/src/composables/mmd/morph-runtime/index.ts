import type { MMD } from '@moeru/three-mmd'

import type { MorphBonePose } from './bone-morph'
import type { MorphChannel, MorphComposition, MorphLayer } from './combine'

import { isMMDMaterial } from '@moeru/three-mmd/materials'
import { BufferAttribute, Mesh, ShaderMaterial } from 'three'

import { MORPH_CANDIDATES, VOWEL_SLOTS } from '../../../constants/morphs'
import { applyBoneMorphs, convertBoneMorphs } from './bone-morph'
import { combineMorphChannels } from './combine'
import { createMorphExpansion } from './expand'
import { MaterialMorphApplier } from './material'
import { UvMorphApplier } from './uv'

export type { MorphBonePose } from './bone-morph'
export type { MorphChannel, MorphComposition, MorphLayer } from './combine'

/**
 * Owns PMX morph layers for one loaded model. Channels persist until replaced
 * or cleared. The frame pipeline must supply a clean pose and clip influences
 * before the bone stage; the surface stage consumes that same evaluation.
 */
export function createMMDMorphRuntime(mmd: MMD) {
  const { mesh, pmx } = mmd
  const expansion = createMorphExpansion(pmx.morphs)
  const boneMorphs = convertBoneMorphs(pmx.morphs)
  const basePose = mesh.skeleton.bones.map(bone => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
  }))
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => {
    if (!isMMDMaterial(material))
      throw new TypeError('MMD morph runtime requires loader-owned MMD materials')
    return material
  })
  // No outline pass is manufactured here. Bind generated shader outlines only
  // when the loaded part supplies one with the standard Three outline uniforms.
  const outlines = materials.map((material) => {
    let outline: ShaderMaterial | undefined
    mesh.traverse((object) => {
      if (!(object instanceof Mesh))
        return
      const candidates = Array.isArray(object.material) ? object.material : [object.material]
      outline ??= candidates.find((candidate): candidate is ShaderMaterial =>
        candidate instanceof ShaderMaterial && candidate.name === `${material.name}:outline`)
    })
    return outline
  })
  const materialApplier = new MaterialMorphApplier(materials, pmx.morphs, outlines)
  const uvAttribute = mesh.geometry.getAttribute('uv')
  const uvApplier = uvAttribute instanceof BufferAttribute ? new UvMorphApplier(uvAttribute, pmx.morphs) : undefined
  const channels = new Map<string, Map<MorphLayer, MorphChannel>>()
  let composition: Omit<MorphComposition, 'role'> = {}
  let materialOverrides: Readonly<Record<string, number>> = {}
  let effective: number[] = []
  let boneStageReady = false
  const vowelNames = new Set(VOWEL_SLOTS.flatMap(slot => MORPH_CANDIDATES[slot]))
  const morphs = pmx.morphs.map((morph, index) => ({
    index,
    name: morph.name,
    englishName: morph.englishName,
    type: morph.type,
    category: morph.category,
    role: vowelNames.has(morph.name) ? 'vowel' : morph.category === 3 ? 'mouth' : morph.category === 2 ? 'eye' : 'other',
  } satisfies { index: number, name: string, englishName: string, type: number, category: number, role: NonNullable<MorphComposition['role']> }))

  function evaluate() {
    return expansion(morphs.map((morph) => {
      const layers = Array.from(channels.get(morph.name)?.values() ?? [])
      const clipWeight = mesh.morphTargetInfluences?.[morph.index] ?? 0
      if (clipWeight !== 0 && !layers.some(channel => channel.layer === 'clip'))
        layers.push({ layer: 'clip', weight: clipWeight })
      return combineMorphChannels(layers, { ...composition, role: morph.role })
    }))
  }

  function writeBones(pose: readonly MorphBonePose[]) {
    pose.forEach((entry, index) => {
      mesh.skeleton.bones[index].position.copy(entry.position)
      mesh.skeleton.bones[index].quaternion.copy(entry.quaternion)
    })
  }

  return {
    morphs,
    setChannel(layer: MorphLayer, morphName: string, weight: number, options: Pick<MorphChannel, 'alpha' | 'additive'> = {}) {
      let layers = channels.get(morphName)
      if (!layers) {
        layers = new Map()
        channels.set(morphName, layers)
      }
      layers.set(layer, { layer, weight, ...options })
    },
    clearChannel(layer: MorphLayer, morphName: string) {
      channels.get(morphName)?.delete(layer)
    },
    setComposition(context: Omit<MorphComposition, 'role'>) {
      composition = context
    },
    setMaterialOpacityOverrides(overrides: Readonly<Record<string, number>>) {
      materialOverrides = overrides
    },
    applyBoneStage(cleanPose: readonly MorphBonePose[]) {
      effective = evaluate()
      writeBones(applyBoneMorphs(cleanPose, boneMorphs, effective))
      boneStageReady = true
    },
    applySurfaceStage() {
      if (!boneStageReady)
        effective = evaluate()
      const influences = mesh.morphTargetInfluences
      if (influences) {
        morphs.forEach((morph) => {
          // Only groups and vertices have non-empty baked position targets.
          influences[morph.index] = morph.type === 0 || morph.type === 1 ? effective[morph.index] : 0
        })
      }
      materialApplier.apply(effective, materialOverrides)
      uvApplier?.apply(effective)
      boneStageReady = false
    },
    resetToBase() {
      channels.clear()
      composition = {}
      materialOverrides = {}
      effective = []
      boneStageReady = false
      mesh.morphTargetInfluences?.fill(0)
      writeBones(basePose)
      materialApplier.resetToBase()
      uvApplier?.resetToBase()
    },
  }
}
