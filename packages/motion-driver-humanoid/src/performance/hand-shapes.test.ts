import type { HandShape } from './hand-shapes'

import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_CHANNELS, DEG, limitChannel } from './channels'
import { addHandShape, blendHand, HAND_SHAPES, writeHandShape } from './hand-shapes'

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

  it.each(['cup', 'comb'] as const)('bends %s mostly at the knuckles, so its fingertips do not hook', (shape) => {
    for (const [knuckle, middle, tip] of HAND_SHAPES[shape].fingers)
      expect(knuckle).toBeGreaterThan(middle + tip)
  })

  it('raises the thinking hand\'s index over loosely curled fingers', () => {
    const { thinking, fist } = HAND_SHAPES
    const sum = ([a, b, c]: readonly number[]) => a + b + c
    expect(sum(thinking.fingers[0])).toBeLessThan(30)
    for (let finger = 1; finger < 4; finger++) {
      expect(sum(thinking.fingers[finger])).toBeGreaterThan(0.5 * sum(fist.fingers[finger]))
      expect(sum(thinking.fingers[finger])).toBeLessThan(0.8 * sum(fist.fingers[finger]))
    }
  })

  it('closes a hand knuckles first and rolls the fingertips in last', () => {
    const half = new Float64Array(26)
    const [relaxed, fist] = [pose('relaxed'), pose('fist')]
    blendHand(relaxed, fist, 0.5, half)
    const gone = (j: number) => (half[j] - relaxed[j]) / (fist[j] - relaxed[j])
    for (let digit = 1; digit < 5; digit++) {
      const first = 9 + digit * 3
      expect(gone(first)).toBeGreaterThan(gone(first + 1))
      expect(gone(first + 1)).toBeGreaterThan(gone(first + 2))
    }
    // The fingers come together as the knuckles close; the thumb folds over them last.
    expect(gone(24)).toBeGreaterThan(0.5)
    for (const thumb of [9, 10, 11, 25])
      expect(gone(thumb)).toBeLessThan(0.5)
  })

  it('opens a hand by retracing the way it closed', () => {
    const [relaxed, fist] = [pose('relaxed'), pose('fist')]
    const closing = new Float64Array(26)
    const opening = new Float64Array(26)
    for (const share of [0.2, 0.5, 0.8]) {
      blendHand(relaxed, fist, share, closing)
      blendHand(fist, relaxed, 1 - share, opening)
      for (let j = 9; j < 26; j++)
        expect(opening[j]).toBeCloseTo(closing[j], 12)
    }
  })

  it('moves a hand a share of the way to a shape in the closing order, and the whole way at a share of 1', () => {
    const rest = new Float64Array(BODY_CHANNELS.length)
    const relaxed = pose('relaxed')
    const start = ARM_START.right
    rest.set(relaxed.subarray(9), start + 9)
    const fist = pose('fist')
    fist[24] *= 0.5
    const half = new Float64Array(BODY_CHANNELS.length)
    addHandShape('fist', 0.5, rest, half, start, 0.5)
    const blended = new Float64Array(26)
    blendHand(relaxed, fist, 0.5, blended)
    for (let j = 9; j < 26; j++)
      expect(half[start + j]).toBeCloseTo(blended[j] - relaxed[j])
    const whole = new Float64Array(BODY_CHANNELS.length)
    addHandShape('fist', 1, rest, whole, start, 0.5)
    for (let j = 9; j < 26; j++)
      expect(whole[start + j]).toBeCloseTo(fist[j] - relaxed[j])
    expect(half[ARM_START.left + 12]).toBe(0)
  })
})
