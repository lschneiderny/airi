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

describe('posture slow pose', () => {
  it('is the step output with only the continuous term removed, for the same step', () => {
    const wobbly = layers(1)
    const still = layers(0)
    wobbly.amplitudeScale = still.amplitudeScale = 1.3
    let spread = 0
    for (let i = 0; i < 120 * 60; i++) {
      const bias: [number, number, number] = [0.1 * Math.sin(i / 50), 0.05, 0]
      const pose = wobbly.step(1 / 120, bias)
      const quiet = still.step(1 / 120, bias)
      // Read after the same step: a pose cached from the previous step would differ from the quiet output.
      expect(wobbly.slowPose).toEqual(quiet)
      expect(still.slowPose).toEqual(quiet)
      spread = Math.max(spread, ...pose.map((value, axis) => Math.abs(value - wobbly.slowPose[axis])))
    }
    expect(spread).toBeGreaterThan(1e-3)
  })
})
