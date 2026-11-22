import { describe, expect, it } from 'vitest'

import { EXPRESSION_TILT_WEIGHT, NaturalMotion } from './natural-motion'

describe('expression tilt input', () => {
  it('keeps every frame and body intent identical at the declared zero weight', () => {
    const reference = new NaturalMotion({ seed: 41 })
    const actual = new NaturalMotion({ seed: 41 })
    for (const atSeconds of [0, 0.01, 0.1, 0.5, 1, 2, 5]) {
      expect(actual.advance(atSeconds, { headX: 0.3, headY: -0.4, headZ: 0.2, weight: EXPRESSION_TILT_WEIGHT }))
        .toEqual(reference.advance(atSeconds))
      expect(actual.bodyIntent()).toEqual(reference.bodyIntent())
    }
  })

  it('composes all head axes at weight one and releases on the next frame without an input', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const base = motion.advance(0)
    const tilted = motion.advance(0, { headX: 0.2, headY: -0.1, headZ: 0.15, weight: 1 })
    expect(tilted.pose.headX).toBeCloseTo(base.pose.headX + 0.2)
    expect(tilted.pose.headY).toBeCloseTo(base.pose.headY - 0.1)
    expect(tilted.pose.headZ).toBeCloseTo(base.pose.headZ + 0.15)
    expect(tilted.pose.eyeX).not.toBe(base.pose.eyeX)
    expect(tilted.pose.eyeY).not.toBe(base.pose.eyeY)
    expect(tilted.face).toEqual(base.face)
    expect(tilted.breath).toEqual(base.breath)
    expect(motion.advance(0)).toEqual(base)
  })

  it('clamps weighted tilt to the existing head range', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const frame = motion.advance(0, { headX: 3, headY: -3, headZ: 3, weight: 1 })
    expect(frame.pose.headX).toBe(1)
    expect(frame.pose.headY).toBe(-1)
    expect(frame.pose.headZ).toBe(1)
  })
})
