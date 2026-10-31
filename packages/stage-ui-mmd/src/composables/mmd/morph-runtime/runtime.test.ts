import type { PmxObject } from '@moeru/three-mmd'

import { MMD } from '@moeru/three-mmd'
import { MMDToonMaterial } from '@moeru/three-mmd/materials/toon'
import { Bone, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Skeleton, SkinnedMesh } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { disposeMMDObject } from '../../../utils/mmd-materials'
import { bone, descriptor, element, group, materialMorph, uv, vertex } from './fixtures'
import { createMMDMorphRuntime } from './index'
import { MaterialMorphApplier } from './material'

function fixture() {
  const morphs: PmxObject.Morph[] = [
    group([1, 2, 3, 4], [1, 1, 1, 1]),
    vertex,
    bone,
    materialMorph([element(-1)]),
    uv,
  ]
  const pmx: PmxObject = {
    header: {
      signature: 'PMX ',
      version: 2,
      encoding: 1,
      additionalVec4Count: 0,
      vertexIndexSize: 1,
      textureIndexSize: 1,
      materialIndexSize: 1,
      boneIndexSize: 1,
      morphIndexSize: 1,
      rigidBodyIndexSize: 1,
      modelName: '',
      englishModelName: '',
      comment: '',
      englishComment: '',
    },
    vertices: [],
    indices: new Uint8Array(),
    textures: [],
    materials: [],
    bones: [{
      name: 'brow',
      englishName: '',
      position: [0, 0, 0],
      parentBoneIndex: -1,
      transformOrder: 0,
      flag: 0,
      tailPosition: [0, 1, 0],
      appendTransform: undefined,
      axisLimit: undefined,
      localVector: undefined,
      externalParentTransform: undefined,
      ik: undefined,
    }],
    morphs,
    displayFrames: [],
    rigidBodies: [],
    joints: [],
    softBodies: [],
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0.5, 0.5]), 2))
  // three-mmd allocates one position target per PMX morph, including empty
  // bone/material/UV targets. Group vertex offsets are baked into target 0.
  geometry.morphAttributes.position = morphs.map(morph => Object.assign(
    new BufferAttribute(new Float32Array([0, 0, 0]), 3),
    { name: morph.name },
  ))
  const material = new MMDToonMaterial(descriptor())
  const mesh = new SkinnedMesh(geometry, [material])
  const brow = new Bone()
  mesh.add(brow)
  mesh.bind(new Skeleton([brow]))
  const mmd = new MMD(pmx, mesh)
  return { mmd, mesh, material, brow }
}

describe('morph runtime stages', () => {
  it('leaves natural face active without a clip and honors an explicitly owned zero clip weight', () => {
    const { mmd, mesh, material } = fixture()
    const runtime = createMMDMorphRuntime(mmd)
    try {
      runtime.setChannel('naturalFace', 'vertex', 0.4)
      runtime.applySurfaceStage()
      expect(mesh.morphTargetInfluences?.[1]).toBe(0.4)
      runtime.setChannel('clip', 'vertex', 0)
      runtime.applySurfaceStage()
      expect(mesh.morphTargetInfluences?.[1]).toBe(0)
    }
    finally {
      mmd.dispose()
      disposeMMDObject(mesh)
      material.descriptor.toonMap?.dispose()
    }
  })

  it('applies group non-vertex children once, keeps baked group targets, and resets every surface and bone', () => {
    const { mmd, mesh, material, brow } = fixture()
    const runtime = createMMDMorphRuntime(mmd)
    const clean = [{ position: brow.position.clone(), quaternion: brow.quaternion.clone() }]
    try {
      runtime.setChannel('expression', 'group', 0.5)
      runtime.applyBoneStage(clean)
      runtime.applySurfaceStage()
      expect(brow.position.toArray()).toEqual([0.5, 1, -1.5])
      expect(mesh.morphTargetInfluences).toEqual([0.5, 0, 0, 0, 0])
      expect(mesh.geometry.getAttribute('uv').getX(0)).toBe(0.625)
      expect(material.opacity).toBe(0.5)
      runtime.resetToBase()
      expect(brow.position.toArray()).toEqual([0, 0, 0])
      expect(brow.quaternion.toArray()).toEqual([0, 0, 0, 1])
      expect(mesh.morphTargetInfluences).toEqual([0, 0, 0, 0, 0])
      expect(mesh.geometry.getAttribute('uv').getX(0)).toBe(0.5)
      expect(material.opacity).toBe(1)
    }
    finally {
      mmd.dispose()
      disposeMMDObject(mesh)
      material.descriptor.toonMap?.dispose()
    }
  })

  it('composes clip weights and user overrides without retaining removed overrides', () => {
    const { mmd, mesh, material } = fixture()
    const runtime = createMMDMorphRuntime(mmd)
    try {
      runtime.setChannel('clip', 'group', 0.25)
      runtime.setChannel('expression', 'material', 1)
      runtime.setMaterialOpacityOverrides({ surface: 0.5 })
      runtime.applySurfaceStage()
      expect(material.opacity).toBe(0.5)
      runtime.setMaterialOpacityOverrides({})
      runtime.applySurfaceStage()
      // Group contributes another 0.25 after direct morph composition.
      expect(material.opacity).toBe(-0.25)
      runtime.setChannel('clip', 'group', 0)
      runtime.setChannel('expression', 'material', 0)
      runtime.applySurfaceStage()
      expect(material.opacity).toBe(1)
      runtime.clearChannel('expression', 'material')
      expect(runtime.morphs.map(morph => morph.type)).toEqual([0, 1, 2, 8, 3])
    }
    finally {
      mmd.dispose()
      disposeMMDObject(mesh)
      material.descriptor.toonMap?.dispose()
    }
  })

  it('reports additional UV once at model load and never changes the UV buffer', () => {
    const { mmd, mesh, material } = fixture()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const original = mmd.pmx.morphs[4]
      if (original.type !== 3)
        throw new TypeError('fixture UV morph missing')
      mmd.pmx = { ...mmd.pmx, morphs: [{ ...original, type: 4 }, { ...original, type: 7 }] }
      const runtime = createMMDMorphRuntime(mmd)
      runtime.setChannel('expression', 'uv', 1)
      runtime.applySurfaceStage()
      runtime.applySurfaceStage()
      expect(mesh.geometry.getAttribute('uv').getX(0)).toBe(0.5)
      expect(warn).toHaveBeenCalledTimes(1)
    }
    finally {
      warn.mockRestore()
      mmd.dispose()
      disposeMMDObject(mesh)
      material.descriptor.toonMap?.dispose()
    }
  })
})

describe('material outline binding', () => {
  it('applies and restores edge colour, alpha and width on a generated outline', () => {
    const material = new MMDToonMaterial(descriptor())
    const outline = new ShaderMaterial({
      uniforms: {
        outlineColor: { value: new Color() },
        outlineAlpha: { value: 0 },
        outlineThickness: { value: 0 },
      },
    })
    const runtime = new MaterialMorphApplier([material], [materialMorph()], [outline])
    try {
      runtime.apply([1])
      expect(outline.uniforms.outlineColor.value.toArray()).toEqual([expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.4)])
      expect(outline.uniforms.outlineAlpha.value).toBeCloseTo(0.75)
      expect(outline.uniforms.outlineThickness.value).toBeCloseTo(0.03)
      runtime.apply([0])
      expect(outline.uniforms.outlineColor.value.toArray()).toEqual([0.1, 0.1, 0.1])
      expect(outline.uniforms.outlineAlpha.value).toBe(0.35)
      expect(outline.uniforms.outlineThickness.value).toBe(0.01)
    }
    finally {
      material.dispose()
      material.descriptor.toonMap?.dispose()
      outline.dispose()
    }
  })
})
