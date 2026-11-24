import type { HandShape } from './hand-shapes'

import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_CHANNELS, DEG, limitChannel } from './channels'
import { addHandShape, HAND_SHAPES, writeHandShape } from './hand-shapes'

const shapes = Object.keys(HAND_SHAPES) as HandShape[]

function pose(shape: HandShape): Float64Array {
  const out = new Float64Array(26)
  writeHandShape(shape, out)
  return out
}

describe('hand shapes', () => {
  it.each(shapes)('keeps every channel of %s inside the joint limits\' identity region', (shape) => {
    const p = pose(shape)
    for (let j = 9; j < 26; j++) {
      const c = ARM_START.left + j
      // At most the limits' soft knee: a recipe past it would ask for a curl the limiter does not deliver.
      expect(Math.abs(limitChannel(c, p[j]) - p[j]) / DEG).toBeLessThan(3)
    }
  })

  it.each(['relaxed', 'open', 'cup'] as const)('fans %s and curls it more toward the little finger', (shape) => {
    const { fingers, spread } = HAND_SHAPES[shape]
    expect(spread).toBeGreaterThan(0)
    for (let finger = 1; finger < 4; finger++) {
      for (let joint = 0; joint < 3; joint++)
        expect(fingers[finger][joint]).toBeGreaterThan(fingers[finger - 1][joint])
    }
  })

  it.each(['fist', 'point'] as const)('closes the %s with the thumb opposed and curled over the fingers', (shape) => {
    const { fingers, thumb, opposition, spread } = HAND_SHAPES[shape]
    for (const curl of fingers.slice(1))
      expect(curl[0] + curl[1] + curl[2]).toBeGreaterThan(240)
    expect(spread).toBe(0)
    expect(opposition).toBeGreaterThan(30)
    // The thumb bends at its outer joints, round the outside of the fingers, not into the palm at its base.
    expect(thumb[0]).toBeLessThan(thumb[1])
    expect(thumb[1]).toBeLessThan(thumb[2])
  })

  it('points with a straight index and the fist\'s other digits', () => {
    const { point, fist } = HAND_SHAPES
    expect(point.fingers[0][0] + point.fingers[0][1] + point.fingers[0][2]).toBeLessThan(10)
    expect(point.fingers.slice(1)).toEqual(fist.fingers.slice(1))
    expect(point.thumb).toEqual(fist.thumb)
    expect(point.opposition).toBe(fist.opposition)
  })

  it('moves a hand a share of the way to a shape, thumb, spread and opposition included', () => {
    const rest = new Float64Array(BODY_CHANNELS.length)
    const relaxed = pose('relaxed')
    const start = ARM_START.right
    rest.set(relaxed.subarray(9), start + 9)
    const channels = new Float64Array(BODY_CHANNELS.length)
    addHandShape('fist', 0.5, rest, channels, start, 0.5)
    const fist = pose('fist')
    for (let j = 9; j < 24; j++)
      expect(channels[start + j]).toBeCloseTo(0.5 * (fist[j] - relaxed[j]))
    expect(channels[start + 24]).toBeCloseTo(0.5 * (0.5 * fist[24] - relaxed[24]))
    expect(channels[start + 25]).toBeCloseTo(0.5 * (fist[25] - relaxed[25]))
    expect(channels[ARM_START.left + 12]).toBe(0)
  })
})
