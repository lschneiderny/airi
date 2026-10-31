import { describe, expect, it } from 'vitest'

import { applyBoneMorphs, convertBoneMorphs } from './bone-morph'
import { bone } from './fixtures'

describe('bone morphs', () => {
  it('converts untouched PMX offsets to renderer handedness at load', () => {
    expect(convertBoneMorphs([bone])[0].elements[0]).toEqual({
      index: 0,
      position: { x: 1, y: 2, z: -3 },
      quaternion: { x: -0.5, y: -0.5, z: 0.5, w: 0.5 },
    })
    expect(Array.from(bone.positions)).toEqual([1, 2, 3])
  })

  it('composes absolutely from the clean pose without drift over 1000 applications', () => {
    const clean = [{ position: { x: 10, y: 20, z: 30 }, quaternion: { x: 0, y: 0, z: 1, w: 0 } }]
    const converted = convertBoneMorphs([bone])
    const expected = {
      position: { x: 11, y: 22, z: 27 },
      quaternion: { x: 0.5, y: -0.5, z: 0.5, w: -0.5 },
    }
    for (let i = 0; i < 1000; i++)
      expect(applyBoneMorphs(clean, converted, [1])[0]).toEqual(expected)
    expect(applyBoneMorphs(clean, converted, [0])).toEqual(clean)
  })

  it('slerps rotations and applies noncommuting morphs in morph-index order', () => {
    const x = { ...bone, rotations: new Float32Array([1, 0, 0, 0]) }
    const y = { ...bone, rotations: new Float32Array([0, 1, 0, 0]) }
    const clean = [{ position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }]
    const result = applyBoneMorphs(clean, convertBoneMorphs([x, y]), [0.5, 0.5])[0]
    expect(result.position).toEqual({ x: 1, y: 2, z: -3 })
    expect(result.quaternion.x).toBeCloseTo(-0.5)
    expect(result.quaternion.y).toBeCloseTo(-0.5)
    expect(result.quaternion.z).toBeCloseTo(0.5)
    expect(result.quaternion.w).toBeCloseTo(0.5)
  })
})
