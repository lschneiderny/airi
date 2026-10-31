import type { PmxObject } from '@moeru/three-mmd'
import type { MMDMaterialDescriptor } from '@moeru/three-mmd/materials'

import { Color, Texture } from 'three'

// Synthetic PMX fixtures use the installed parser's public contracts.
export const vertex: PmxObject.Morph.VertexMorph = {
  name: 'vertex',
  englishName: '',
  category: 4,
  type: 1,
  indices: new Int32Array([0]),
  positions: new Float32Array([1, 2, 3]),
}

export const bone: PmxObject.Morph.BoneMorph = {
  name: 'bone',
  englishName: '',
  category: 1,
  type: 2,
  indices: new Int32Array([0]),
  positions: new Float32Array([1, 2, 3]),
  rotations: new Float32Array([0.5, 0.5, 0.5, 0.5]),
}

export const uv: PmxObject.Morph.UvMorph = {
  name: 'uv',
  englishName: '',
  category: 4,
  type: 3,
  indices: new Int32Array([0]),
  offsets: new Float32Array([0.25, -0.5, 0, 0]),
}

export function group(indices: number[], ratios: number[]): PmxObject.Morph.GroupMorph {
  return {
    name: 'group',
    englishName: '',
    category: 4,
    type: 0,
    indices: new Int32Array(indices),
    ratios: new Float32Array(ratios),
  }
}

export function element(index = 0, type: 0 | 1 = 1): PmxObject.Morph.MaterialMorph['elements'][number] {
  return {
    index,
    type,
    diffuse: [0.2, 0.3, 0.4, -1],
    specular: [0.1, 0.2, 0.3],
    shininess: 2,
    ambient: [0.3, 0.2, 0.1],
    edgeColor: [0.1, 0.2, 0.3, 0.4],
    edgeSize: 0.02,
    textureColor: [0.2, 0.4, 0.6, 0.8],
    sphereTextureColor: [0.3, 0.5, 0.7, 0.9],
    toonTextureColor: [0.4, 0.6, 0.8, 1],
  }
}

export function materialMorph(elements = [element()]): PmxObject.Morph.MaterialMorph {
  return { name: 'material', englishName: '', category: 4, type: 8, elements }
}

export function descriptor(name = 'surface'): MMDMaterialDescriptor {
  return {
    name,
    ambient: new Color(0.1, 0.2, 0.3),
    diffuse: new Color(0.4, 0.5, 0.6),
    specular: new Color(0.2, 0.3, 0.4),
    shininess: 16,
    opacity: 1,
    doubleSided: false,
    fog: true,
    isDefaultToonTexture: true,
    toonMap: new Texture(),
    toonMapFileName: 'toon01.bmp',
    outline: { alpha: 0.35, color: new Color(0.1, 0.1, 0.1), visible: true, width: 0.01 },
  }
}
