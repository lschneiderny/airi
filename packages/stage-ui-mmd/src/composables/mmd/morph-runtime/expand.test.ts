import type { PmxObject } from '@moeru/three-mmd'

import { describe, expect, it, vi } from 'vitest'

import { createMorphExpansion } from './expand'
import { bone, group, materialMorph, uv, vertex } from './fixtures'

describe('group morph expansion', () => {
  it('keeps baked vertex children separate and adds own bone, material and UV weights without clamping', () => {
    const expand = createMorphExpansion([group([1, 2, 3, 4], [1, 2, -2, 3]), vertex, bone, materialMorph(), uv])
    expect(expand([0.5, 0.2, 0.3, 0.1, 0.25])).toEqual([0.5, 0.2, 1.3, -0.9, 1.75])
  })

  it('refuses nested groups without recursion and warns only at load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const expand = createMorphExpansion([group([1, 1], [1, 1]), group([2], [1]), bone])
      expect(expand([1, 0, 0])).toEqual([1, 0, 0])
      expand([1, 0, 0])
      expect(warn).toHaveBeenCalledTimes(1)
    }
    finally {
      warn.mockRestore()
    }
  })

  it('ignores Flip and Impulse morphs and warns once for each unsupported type', () => {
    const flip: PmxObject.Morph.FlipMorph = { ...group([], []), type: 9 }
    const impulse: PmxObject.Morph.ImpulseMorph = {
      name: 'impulse',
      englishName: '',
      category: 4,
      type: 10,
      indices: new Int32Array(),
      isLocals: [],
      velocities: new Float32Array(),
      torques: new Float32Array(),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const expand = createMorphExpansion([flip, flip, impulse])
      expect(expand([1, 1, 1])).toEqual([0, 0, 0])
      expand([1, 1, 1])
      expect(warn).toHaveBeenCalledTimes(2)
    }
    finally {
      warn.mockRestore()
    }
  })
})
