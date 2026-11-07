import type { RandomStream } from './random'

import { describe, expect, it } from 'vitest'

import { NaturalPostureLayers } from './posture'
import { createRandomStream } from './random'

function layers(continuousScale: number) {
  const posture = new NaturalPostureLayers([0, 0, 0], { drift: createRandomStream(1), continuous: createRandomStream(2), gain: createRandomStream(3), shift: createRandomStream(4), regime: createRandomStream(5) })
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

/** Constant uniform 0.25: its gaussian is about 4.6e-17, so an OU process on it stays at its zero start. */
const silent: RandomStream = () => 0.25
/** `activityGain(0)`: with a silent gain stream the continuous-motion gain stays at this value. */
const restingGain = 0.2 + 1.3 / 2

/**
 * The continuous term per step, read as the pose difference between continuous scales 1 and 0 under a silent gain
 * stream, divided by the resting gain. Steps outside softLimit's identity range (|pose| > 0.8) are `null`.
 */
function continuousTerm(seconds: number, regimeSeed = 5) {
  const make = (continuousScale: number) => {
    const posture = new NaturalPostureLayers([0, 0, 0], { drift: createRandomStream(1), continuous: createRandomStream(2), gain: silent, shift: createRandomStream(4), regime: createRandomStream(regimeSeed) })
    posture.continuousScale = continuousScale
    return posture
  }
  const full = make(1)
  const still = make(0)
  const terms: (number[] | null)[] = []
  for (let i = 0; i < 120 * seconds; i++) {
    const a = full.step(1 / 120)
    const b = still.step(1 / 120)
    terms.push([...a, ...b].every(value => Math.abs(value) <= 0.8) ? a.map((value, axis) => (value - b[axis]) / restingGain) : null)
  }
  return terms
}

describe('posture continuous motion', () => {
  it('keeps each continuous axis at its configured stationary SD', () => {
    // Two hours at 120 Hz: over 2,000 correlation times of the slowest axis (tau 1.6 s).
    const terms = continuousTerm(7200).filter(term => term !== null)
    const expected = [0.0192, 0.016, 0.008]
    for (const axis of [0, 1, 2]) {
      const values = terms.map(term => term[axis])
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
      expect(Math.abs(sd / expected[axis] - 1)).toBeLessThan(0.05)
    }
    expect(terms.length).toBeGreaterThan(120 * 7000)
  })
})

describe('posture holds', () => {
  it('draws each hold from exactly one gaussian and keeps it inside the clamp', () => {
    // The constructor draws the first hold and nothing else from the shift stream, so each new layer is one draw.
    const holds: number[] = []
    for (let seed = 1; seed <= 5000; seed++) {
      let draws = 0
      const stream = createRandomStream(seed)
      const posture = new NaturalPostureLayers([0, 0, 0], { drift: createRandomStream(1), continuous: createRandomStream(2), gain: createRandomStream(3), shift: () => {
        draws++
        return stream()
      }, regime: createRandomStream(5) })
      expect(draws).toBe(2)
      holds.push(posture.secondsUntilShift)
    }
    for (const hold of holds) {
      expect(hold).toBeGreaterThanOrEqual(0.1 / 1.5)
      expect(hold).toBeLessThanOrEqual(15 / 1.5)
    }
    const median = [...holds].sort((a, b) => a - b)[2500]
    expect(Math.abs(median / (Math.exp(-0.82) / 1.5) - 1)).toBeLessThan(0.1)
  })
})

describe('posture activity regime', () => {
  /** Steps 20 minutes at 120 Hz, recording each pose and the shift-stream draws at each shift start. */
  function record(regimeSeed: number, options: { disabled?: boolean } = {}) {
    let shiftDraws = 0
    const shiftStream = createRandomStream(4)
    let regimeDraws = 0
    const regimeStream = createRandomStream(regimeSeed)
    const posture = new NaturalPostureLayers([0, 0, 0], {
      drift: createRandomStream(1),
      continuous: createRandomStream(2),
      gain: createRandomStream(3),
      shift: () => {
        shiftDraws++
        return shiftStream()
      },
      regime: () => {
        regimeDraws++
        return regimeStream()
      },
    }, options.disabled ? { regime: { rateSd: 0, ampSd: 0 } } : {})
    const poses: number[][] = []
    const drawsAtShift: number[] = []
    let shifts = posture.shiftCount
    const steps = 120 * 1200
    for (let i = 0; i < steps; i++) {
      poses.push(posture.step(1 / 120))
      if (posture.shiftCount !== shifts) {
        shifts = posture.shiftCount
        drawsAtShift.push(shiftDraws)
      }
    }
    return { poses, drawsAtShift, regimeDraws, steps }
  }

  it('leaves motion bit-identical when disabled, whatever the regime seed', () => {
    const a = record(5, { disabled: true })
    const b = record(6, { disabled: true })
    expect(b.poses).toEqual(a.poses)
    expect(a.drawsAtShift.length).toBeGreaterThan(100)
  })

  it('keeps the shift stream aligned across regime seeds', () => {
    const a = record(5)
    const b = record(6)
    const shared = Math.min(a.drawsAtShift.length, b.drawsAtShift.length)
    expect(shared).toBeGreaterThan(100)
    expect(b.drawsAtShift.slice(0, shared)).toEqual(a.drawsAtShift.slice(0, shared))
    // The regime must act: different seeds give different shift timing.
    expect(b.poses).not.toEqual(a.poses)
  })

  it('draws one gaussian from the regime stream per step', () => {
    const { regimeDraws, steps } = record(5)
    // A gaussian uses two uniforms.
    expect(regimeDraws).toBe(2 * steps)
  })

  it('never changes the continuous motion', () => {
    const a = continuousTerm(600, 5)
    const b = continuousTerm(600, 6)
    let compared = 0
    let largest = 0
    a.forEach((term, i) => {
      const other = b[i]
      if (!term || !other)
        return
      compared++
      term.forEach((value, axis) => largest = Math.max(largest, Math.abs(value - other[axis])))
    })
    expect(compared).toBeGreaterThan(120 * 500)
    // Only rounding differs: the shift positions subtracted out differ between the regime seeds.
    expect(largest).toBeLessThan(1e-12)
  })
})

describe('posture postponement', () => {
  it.each([false, true])('realigns a same-seed twin after a postponement (regime neutral: %s)', (neutral) => {
    const make = () => new NaturalPostureLayers([0, 0, 0], { drift: createRandomStream(1), continuous: createRandomStream(2), gain: createRandomStream(3), shift: createRandomStream(4), regime: createRandomStream(5) }, neutral ? { regime: { rateSd: 0, ampSd: 0 } } : {})
    const a = make()
    const b = make()
    let diverged = false
    let postponedAt = -1
    for (let i = 0; i < 120 * 60; i++) {
      // As the facade does for a gesture: postpone the first shift due after 10 s by 2 s, in one run only.
      if (postponedAt < 0 && i >= 120 * 10 && a.secondsUntilShift <= 1 / 120) {
        a.postponeShift(2)
        postponedAt = i
      }
      const poseA = a.step(1 / 120)
      const poseB = b.step(1 / 120)
      if (postponedAt >= 0 && i < postponedAt + 120 * 2)
        diverged ||= poseA.some((value, axis) => Math.abs(value - poseB[axis]) > 1e-3)
      if (i >= 120 * 30) {
        expect(a.shiftCount).toBe(b.shiftCount)
        expect(a.secondsUntilShift).toBeCloseTo(b.secondsUntilShift, 9)
        poseA.forEach((value, axis) => expect(value).toBeCloseTo(poseB[axis], 9))
      }
    }
    expect(postponedAt).toBeLessThan(120 * 20)
    expect(diverged).toBe(true)
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
