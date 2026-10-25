import { describe, expect, it } from 'vitest'

import { NaturalPostureLayers } from './posture'
import { createRandomStream } from './random'

function layers(continuousScale: number) {
  const posture = new NaturalPostureLayers([0, 0, 0], { drift: createRandomStream(1), continuous: createRandomStream(2), gain: createRandomStream(3), shift: createRandomStream(4) })
  posture.continuousScale = continuousScale
  return posture
}

describe('posture continuous scale', () => {
  it('scales only the continuous term: output is linear in the scale and shifts never move', () => {
    const a = layers(1)
    const b = layers(0)
    const c = layers(0.6)
    let compared = 0
    let spread = 0
    for (let i = 0; i < 120 * 60; i++) {
      const poseA = a.step(1 / 120)
      const poseB = b.step(1 / 120)
      const poseC = c.step(1 / 120)
      expect(b.shiftTarget).toEqual(a.shiftTarget)
      expect(c.shiftTarget).toEqual(a.shiftTarget)
      expect(b.secondsUntilShift).toBe(a.secondsUntilShift)
      expect(c.secondsUntilShift).toBe(a.secondsUntilShift)
      spread = Math.max(spread, ...poseA.map((value, axis) => Math.abs(value - poseB[axis])))
      // softLimit is the identity only inside 0.8, so compare only while all three poses are inside it.
      if (![...poseA, ...poseB, ...poseC].every(value => Math.abs(value) <= 0.8))
        continue
      compared++
      for (const axis of [0, 1, 2])
        expect(Math.abs(poseC[axis] - poseB[axis] - 0.6 * (poseA[axis] - poseB[axis]))).toBeLessThanOrEqual(1e-12)
    }
    // The scale must act: full and zero continuous motion cannot be the same pose.
    expect(spread).toBeGreaterThan(1e-3)
    expect(compared).toBeGreaterThan(120 * 30)
  })
})
