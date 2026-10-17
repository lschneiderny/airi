import { describe, expect, it } from 'vitest'

import { Live2DNaturalMotion } from './natural-motion'

type Frame = ReturnType<Live2DNaturalMotion['advance']>

function maximumDelta(a: Frame, b: Frame, axes = Object.keys(a.pose) as (keyof Frame['pose'])[]) {
  return Math.max(...axes.map(axis => Math.abs(a.pose[axis] - b.pose[axis])))
}

function standardDeviation(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

describe('natural motion', () => {
  it('establishes its time origin and home posture on first advance', () => {
    const late = new Live2DNaturalMotion({ seed: 7 })
    const early = new Live2DNaturalMotion({ seed: 7 })
    const initial = late.advance(100)
    expect(initial.pose.headX).toBe(0)
    expect(initial.pose.headY).toBeCloseTo(-0.1, 12)
    expect(initial.fixation).toEqual({ x: 0, y: 0 })
    early.advance(0)
    expect(late.advance(102.5)).toEqual(early.advance(2.5))
  })

  it('keeps zero-duration advances idempotent', () => {
    const motion = new Live2DNaturalMotion({ seed: 3 })
    motion.advance(0)
    const frame = motion.advance(4.2)
    expect(motion.advance(4.2)).toEqual(frame)
    motion.setCursor(null, 4.2)
    expect(motion.advance(4.2)).toEqual(frame)
  })

  it('keeps every output finite and within normalized bounds', () => {
    const motion = new Live2DNaturalMotion({ seed: 11 })
    let finite = true
    let maximum = 0
    for (let frame = 0; frame <= 10 * 60 * 60; frame++) {
      const time = frame / 60
      // Alternate extreme cursor attention with autonomous motion.
      if (frame % 600 === 0)
        motion.setCursor(frame % 1200 === 0 ? { x: 1, y: -1 } : null, time)
      for (const value of Object.values(motion.advance(time).pose)) {
        finite &&= Number.isFinite(value)
        maximum = Math.max(maximum, Math.abs(value))
      }
    }
    expect(finite).toBe(true)
    expect(maximum).toBeLessThanOrEqual(1)
  })

  it('freezes during suspension and resumes without a jump or reset', () => {
    const suspended = new Live2DNaturalMotion({ seed: 5 })
    const continuous = new Live2DNaturalMotion({ seed: 5 })
    suspended.advance(0)
    continuous.advance(0)
    suspended.advance(30)
    suspended.setSuspended(true, 30)
    const frozen = suspended.advance(30)
    expect(suspended.advance(100)).toEqual(frozen)
    suspended.setSuspended(false, 100)
    expect(suspended.advance(100)).toEqual(frozen)
    const resumed = suspended.advance(100 + 1 / 60)
    expect(maximumDelta(resumed, frozen)).toBeLessThan(0.02)
    // Active time continues where it stopped, so the path matches an uninterrupted run.
    expect(maximumDelta(resumed, continuous.advance(30 + 1 / 60))).toBeLessThan(1e-9)
  })

  it('returns from cursor expiry gradually without resetting followers', () => {
    const motion = new Live2DNaturalMotion({ seed: 9 })
    motion.advance(0)
    motion.setCursor({ x: 1, y: 1 }, 2)
    const attended = motion.advance(2.5)
    motion.setCursor(null, 2.5)
    expect(motion.advance(2.5)).toEqual(attended)
    const released = motion.advance(2.5 + 1 / 60)
    // Eyes may saccade back; head and body must not snap.
    expect(maximumDelta(released, attended, ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ'])).toBeLessThan(0.02)
    expect(released.fixation.x).toBeGreaterThan(0.5)
    expect(motion.advance(3.5).fixation.x).toBeLessThan(0.1)
  })

  it('keeps disabled cursor input equivalent to autonomous output', () => {
    const motion = new Live2DNaturalMotion({ seed: 13 })
    const reference = new Live2DNaturalMotion({ seed: 13 })
    motion.advance(0)
    reference.advance(0)
    for (const time of [0.1, 1.4, 1.8, 5, 10]) {
      motion.setCursor(null, time)
      expect(motion.advance(time)).toEqual(reference.advance(time))
    }
  })

  it('keeps head variability independent of frame partition', () => {
    const deviations = [1 / 30, 1 / 60, 1 / 144].map((frameStep) => {
      const motion = new Live2DNaturalMotion({ seed: 21 })
      const axes: number[][] = [[], [], []]
      for (let frame = 0; frame * frameStep <= 10 * 60; frame++) {
        const { pose } = motion.advance(frame * frameStep)
        axes[0].push(pose.headX)
        axes[1].push(pose.headY)
        axes[2].push(pose.headZ)
      }
      return axes.map(standardDeviation)
    })
    for (const axis of [0, 1, 2]) {
      const values = deviations.map(deviation => deviation[axis])
      expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.05)
    }
  })
})
