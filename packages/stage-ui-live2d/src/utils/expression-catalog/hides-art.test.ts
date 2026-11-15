import type { ArtProbeModel } from './hides-art'

import { describe, expect, it } from 'vitest'

import { expressionOnlyHidesArt } from './hides-art'

/** A model whose drawable opacities are functions of its parameters, recomputed on `update` as in the Cubism core. */
function model(defaults: Record<string, number>, opacities: ((parameters: Record<string, number>) => number)[]) {
  const parameters = { ...defaults }
  let drawn = opacities.map(opacity => opacity(parameters))
  const core: ArtProbeModel = {
    getDrawableCount: () => drawn.length,
    getDrawableOpacity: index => drawn[index],
    getParameterValueById: id => parameters[id],
    setParameterValueById: (id, value) => {
      parameters[id] = value
    },
    update: () => {
      drawn = opacities.map(opacity => opacity(parameters))
    },
  }
  return { core, parameters, drawn: () => drawn }
}

describe('expressionOnlyHidesArt', () => {
  it('reads a switch that hides a drawn watermark, and leaves the model as it was', () => {
    const rig = model({ watermark: 0, blush: 0 }, [() => 1, p => 1 - p.watermark, p => p.blush])
    expect(expressionOnlyHidesArt(rig.core, [{ id: 'watermark', value: 1, blend: 'Add' }])).toBe(true)
    expect(rig.parameters).toEqual({ watermark: 0, blush: 0 })
    expect(rig.drawn()).toEqual([1, 1, 0])
  })

  it('does not read a switch that draws the watermark, changes nothing visible, or swaps one drawable for another', () => {
    const rig = model({ watermark: 0, hair: 0 }, [p => p.watermark, p => 1 - p.hair, p => p.hair])
    expect(expressionOnlyHidesArt(rig.core, [{ id: 'watermark', value: 1, blend: 'Overwrite' }])).toBe(false)
    expect(expressionOnlyHidesArt(rig.core, [{ id: 'watermark', value: 1, blend: 'Multiply' }])).toBe(false)
    expect(expressionOnlyHidesArt(rig.core, [{ id: 'hair', value: 1, blend: 'Add' }])).toBe(false)
  })
})
