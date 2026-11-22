import { describe, expect, it } from 'vitest'

import { gifFrameAt } from './gif-clock'

describe('gifFrameAt', () => {
  it('steps through frames by their durations and wraps around', () => {
    const durations = [100, 50, 200]

    expect(gifFrameAt(durations, 0)).toBe(0)
    expect(gifFrameAt(durations, 99.9)).toBe(0)
    expect(gifFrameAt(durations, 100)).toBe(1)
    expect(gifFrameAt(durations, 149)).toBe(1)
    expect(gifFrameAt(durations, 150)).toBe(2)
    expect(gifFrameAt(durations, 349)).toBe(2)
    expect(gifFrameAt(durations, 350)).toBe(0)
    expect(gifFrameAt(durations, 350 * 3 + 120)).toBe(1)
  })

  it('counts zero, negative, and unreadable durations as 100 ms', () => {
    expect(gifFrameAt([0, 0], 99)).toBe(0)
    expect(gifFrameAt([0, 0], 150)).toBe(1)
    expect(gifFrameAt([0, 0], 250)).toBe(0)
    expect(gifFrameAt([-20, Number.NaN, 50], 150)).toBe(1)
    expect(gifFrameAt([-20, Number.NaN, 50], 220)).toBe(2)
    expect(gifFrameAt([-20, Number.NaN, 50], 250)).toBe(0)
  })

  it('shows the first frame for an empty or single-frame image', () => {
    expect(gifFrameAt([], 500)).toBe(0)
    expect(gifFrameAt([40], 500)).toBe(0)
  })

  it('shows the first frame for negative or unreadable elapsed time', () => {
    expect(gifFrameAt([100, 100], -50)).toBe(0)
    expect(gifFrameAt([100, 100], Number.NaN)).toBe(0)
    expect(gifFrameAt([100, 100], Number.POSITIVE_INFINITY)).toBe(0)
  })
})
