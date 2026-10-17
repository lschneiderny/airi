import { describe, expect, it } from 'vitest'

import { Live2DNaturalMotion } from './natural-motion'

function randomSource() {
  let seed = 42
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function expectNear(actual: ReturnType<Live2DNaturalMotion['advance']>, expected: ReturnType<Live2DNaturalMotion['advance']>) {
  for (const axis of Object.keys(actual.pose) as (keyof typeof actual.pose)[])
    expect(Math.abs(actual.pose[axis] - expected.pose[axis])).toBeLessThan(1e-9)
  expect(Math.abs(actual.fixation.x - expected.fixation.x)).toBeLessThan(1e-9)
  expect(Math.abs(actual.fixation.y - expected.fixation.y)).toBeLessThan(1e-9)
}

describe('natural motion', () => {
  it('preserves posture and frame partition invariance', () => {
    const reference = new Live2DNaturalMotion(randomSource())
    reference.advance(0)
    const samples = [1.4, 1.58, 2, 4, 10, 30, 120]
    const expected = samples.map(time => ({ time, frame: reference.advance(time) }))
    for (const step of [1 / 30, 1 / 60, 1 / 144, 0.137]) {
      const motion = new Live2DNaturalMotion(randomSource())
      motion.advance(0)
      let time = 0
      let allValuesFinite = true
      let maximumMagnitude = 0
      for (const { time: sample, frame: expectedFrame } of expected) {
        while (time + step < sample) {
          time += step
          const frame = motion.advance(time)
          for (const value of Object.values(frame.pose)) {
            allValuesFinite &&= Number.isFinite(value)
            maximumMagnitude = Math.max(maximumMagnitude, Math.abs(value))
          }
        }
        time = sample
        expectNear(motion.advance(time), expectedFrame)
      }
      expect(allValuesFinite).toBe(true)
      expect(maximumMagnitude).toBeLessThanOrEqual(0.95)
    }
    const restingFrame = expected.find(sample => sample.time === 2)
    expect(restingFrame).toBeDefined()
    if (restingFrame)
      expect(Math.abs(restingFrame.frame.pose.headX)).toBeGreaterThan(0.001)
  })

  it('establishes its origin on first advance and preserves zero-duration output', () => {
    const motion = new Live2DNaturalMotion(() => 0.9)
    const initial = motion.advance(100)
    const boundary = motion.advance(101.4)
    expectNear(boundary, initial)
    expect(motion.advance(101.4)).toEqual(boundary)
    expect(motion.advance(102).pose.headX).toBeGreaterThan(0)
  })

  it('follows exact targets and retains a nonneutral resting posture', () => {
    // First event: r=(0.8,0.8,0.8), a=0.565, no fixation or follow-up.
    const motion = new Live2DNaturalMotion(() => 0.9)
    motion.advance(0)
    motion.advance(1.4)
    const frame = motion.advance(2)
    const target = 0.8 * 0.565 * 0.36
    const h = 0.6 / 0.14
    expect(frame.pose.headX).toBeCloseTo(target * (1 - (1 + h) * Math.exp(-h)), 12)
    expect(motion.advance(5).pose.headX).toBeCloseTo(target, 8)
    expect(motion.advance(5).fixation).toEqual({ x: 0, y: 0 })
  })

  it('preserves continuity through cursor reversal and suspension', () => {
    const motion = new Live2DNaturalMotion(randomSource())
    motion.advance(0)
    motion.setCursor({ x: 1, y: -1 }, 0)
    const before = motion.advance(0.2)
    motion.setCursor({ x: -1, y: 1 }, 0.2)
    expect(motion.advance(0.2)).toEqual(before)
    const epsilon = 1e-6
    const after = motion.advance(0.2 + epsilon)
    expect(after.pose.headX).toBeGreaterThan(before.pose.headX)
    motion.setSuspended(true, 0.3)
    const frozen = motion.advance(0.3)
    expect(motion.advance(100)).toEqual(frozen)
    motion.setSuspended(false, 100)
    expect(motion.advance(100)).toEqual(frozen)
    motion.setCursor(null, 100)
    expect(motion.advance(100)).toEqual(frozen)
  })

  it('cancels stale follow-ups across repeated suspension and resumes with a fresh hold', () => {
    // r=.9, a=.25, fixation selected, follow-up selected at +.18, b=.08.
    const values = [0.95, 0.95, 0.95, 0, 0, 0, 0, 0, 0, 0]
    const motion = new Live2DNaturalMotion(() => values.shift() ?? 0.9)
    motion.advance(0)
    motion.advance(1.5)
    for (const [pause, resume] of [[1.5, 20], [20.1, 40], [40.2, 60]]) {
      motion.setSuspended(true, pause!)
      const frozen = motion.advance(pause!)
      motion.setSuspended(false, resume!)
      expect(motion.advance(resume!)).toEqual(frozen)
    }
    const held = motion.advance(61.39)
    expect(held.pose.headX).toBeCloseTo(0.225 * 0.36, 5)
    expect(held.fixation.x).toBeCloseTo(0.09, 12)
    expect(motion.advance(61.4).pose.headX).toBeCloseTo(held.pose.headX, 5)
    expect(motion.advance(62).pose.headX).toBeGreaterThan(held.pose.headX)
  })

  it('returns to retained fixation on cursor expiry without resetting followers', () => {
    const motion = new Live2DNaturalMotion(() => 0)
    motion.advance(0)
    motion.advance(2)
    motion.setCursor({ x: 1, y: 1 }, 2)
    const attended = motion.advance(2.1)
    motion.setCursor(null, 2.1)
    expect(motion.advance(2.1)).toEqual(attended)
    expect(motion.advance(2.100001).fixation.x).toBeGreaterThan(attended.fixation.x)
    expect(motion.advance(3).fixation.x).toBeCloseTo(-0.1, 8)
  })

  it('keeps disabled cursor input equivalent to autonomous output', () => {
    const motion = new Live2DNaturalMotion(randomSource())
    const reference = new Live2DNaturalMotion(randomSource())
    motion.advance(0)
    reference.advance(0)
    for (const time of [0.1, 1.4, 1.8, 5, 10]) {
      motion.setCursor(null, time)
      expectNear(motion.advance(time), reference.advance(time))
    }
  })

  it('applies one follow-up to the retained destination without changing fixation', () => {
    const motion = new Live2DNaturalMotion(() => 0)
    motion.advance(0)
    motion.advance(1.58)
    const frame = motion.advance(2)
    // Superpose primary and follow-up steps through the exact two-stage follower.
    const response = (dt: number) => 1 - (1 + dt / 0.14) * Math.exp(-dt / 0.14)
    const expected = -0.25 * 0.36 * response(0.6) - 0.06 * 0.36 * response(0.42)
    expect(frame.pose.headX).toBeCloseTo(expected, 12)
    expect(frame.fixation.x).toBeCloseTo(-0.1, 9)
    expect(motion.advance(5).pose.headX).toBeCloseTo(-0.31 * 0.36, 8)
  })
})
