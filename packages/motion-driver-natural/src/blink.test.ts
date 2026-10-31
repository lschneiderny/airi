import { describe, expect, it } from 'vitest'

import { NaturalBlinkScheduler } from './blink'
import { createRandomStream } from './random'

const dt = 1 / 120

interface Blink {
  start: number
  reopen: number
}

/** Steps `seconds` and returns each blink's start (first frame below 1) and reopening (first frame back at 1). */
function record(scheduler: NaturalBlinkScheduler, seconds: number, beforeStep?: (time: number) => void) {
  const blinks: Blink[] = []
  const factors: number[] = []
  let previous = 1
  for (let i = 0; i < seconds / dt; i++) {
    beforeStep?.(i * dt)
    const factor = scheduler.step(dt)
    const time = (i + 1) * dt
    if (previous === 1 && factor < 1)
      blinks.push({ start: time, reopen: Number.NaN })
    if (previous < 1 && factor === 1)
      blinks[blinks.length - 1].reopen = time
    factors.push(factor)
    previous = factor
  }
  return { blinks, factors }
}

describe('natural blink scheduler', () => {
  it('blinks at a human rate with spec lid timing and about 8% double blinks', () => {
    const { blinks, factors } = record(new NaturalBlinkScheduler(createRandomStream(1)), 2 * 60 * 60)
    const complete = blinks.filter(blink => Number.isFinite(blink.reopen))
    const ratePerMinute = blinks.length / 120
    expect(ratePerMinute).toBeGreaterThan(9)
    expect(ratePerMinute).toBeLessThan(15)
    expect(factors.reduce((a, b) => Math.min(a, b))).toBeLessThan(0.05)
    // Closing 60-90 ms plus opening 160-260 ms, within one grid step at each edge.
    const durations = complete.map(blink => blink.reopen - blink.start)
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(0.22 - dt)
    expect(Math.max(...durations)).toBeLessThanOrEqual(0.35 + dt)
    // Single blinks wait at least 0.6 s after reopening, so a shorter gap marks the second blink of a double.
    const gaps = complete.slice(0, -1).map((blink, i) => blinks[i + 1].start - blink.reopen)
    const doubles = gaps.filter(gap => gap < 0.6)
    expect(Math.min(...gaps.filter(gap => gap >= 0.6))).toBeGreaterThanOrEqual(0.6 - dt)
    expect(Math.min(...doubles)).toBeGreaterThanOrEqual(0.12 - dt)
    expect(Math.max(...doubles)).toBeLessThanOrEqual(0.22 + dt)
    // Share of first blinks that start a double: 8%.
    const share = doubles.length / (blinks.length - doubles.length)
    expect(share).toBeGreaterThan(0.05)
    expect(share).toBeLessThan(0.11)
    // A double never chains into a third blink.
    expect(gaps.some((gap, i) => gap < 0.6 && gaps[i + 1] < 0.6)).toBe(false)
  })

  it('advances a blink due within 0.8 s onto a large gaze shift, but not on every shift', () => {
    const scheduler = new NaturalBlinkScheduler(createRandomStream(2))
    const shiftEvery = 1.37
    let shifts = 0
    let advanced = 0
    let previous = 1
    for (let i = 0; i < 30 * 60 / dt; i++) {
      const shifted = i % Math.round(shiftEvery / dt) === 0
      if (shifted) {
        shifts++
        scheduler.onGazeShift(0.3)
      }
      const factor = scheduler.step(dt)
      if (shifted && previous === 1 && factor < 1)
        advanced++
      previous = factor
    }
    // Without advancement a blink would start in the exact shift step about 0.2% of the time.
    expect(advanced / shifts).toBeGreaterThan(0.05)
    expect(advanced / shifts).toBeLessThan(0.4)
  })

  it('ignores gaze shifts at or below 0.15 normalized', () => {
    const reference = record(new NaturalBlinkScheduler(createRandomStream(3)), 10 * 60).factors
    const small = new NaturalBlinkScheduler(createRandomStream(3))
    expect(record(small, 10 * 60, () => small.onGazeShift(0.15)).factors).toEqual(reference)
  })

  it('stays open while disabled and resumes the running schedule', () => {
    const reference = record(new NaturalBlinkScheduler(createRandomStream(4)), 120).factors
    const toggled = new NaturalBlinkScheduler(createRandomStream(4))
    toggled.enabled = false
    const disabled = record(toggled, 60).factors
    toggled.enabled = true
    const resumed = record(toggled, 60).factors
    expect(Math.min(...disabled)).toBe(1)
    expect(resumed).toEqual(reference.slice(disabled.length))
  })
})
