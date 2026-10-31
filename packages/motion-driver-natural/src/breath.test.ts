import { describe, expect, it } from 'vitest'

import { NaturalBreathLayer } from './breath'
import { createRandomStream } from './random'

const dt = 1 / 120

function standardDeviation(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

describe('natural breath', () => {
  it('keeps every breath within 3.5-6.5 s over 30 min while the period wanders', () => {
    const breath = new NaturalBreathLayer(createRandomStream(1))
    // Upward crossings of the breath center delimit whole cycles.
    const crossings: number[] = []
    let previous = 0
    for (let i = 1; i <= 30 * 60 / dt; i++) {
      const wave = breath.step(dt).value - 0.45
      if (previous < 0 && wave >= 0)
        crossings.push(i * dt)
      previous = wave
    }
    const periods = crossings.slice(1).map((time, i) => time - crossings[i])
    expect(periods.length).toBeGreaterThan(300)
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(3.5)
    expect(Math.max(...periods)).toBeLessThanOrEqual(6.5)
    const mean = periods.reduce((sum, period) => sum + period, 0) / periods.length
    expect(mean).toBeGreaterThan(4.4)
    expect(mean).toBeLessThan(5.3)
    // Log-period OU SD 0.15, slightly narrowed by the reflecting bounds and cycle averaging.
    const logSpread = standardDeviation(periods.map(period => Math.log(period)))
    expect(logSpread).toBeGreaterThan(0.08)
    expect(logSpread).toBeLessThan(0.2)
  })

  it('shallows while speaking and keeps head coupling at most 0.001', () => {
    const breath = new NaturalBreathLayer(createRandomStream(2))
    const sample = (seconds: number) => Array.from({ length: Math.round(seconds / dt) }, () => breath.step(dt))
    const idle = sample(60)
    breath.speaking = true
    sample(5)
    const speaking = sample(60)
    const depth = (frames: typeof idle) => Math.max(...frames.map(frame => Math.abs(frame.value - 0.45)))
    expect(depth(idle)).toBeCloseTo(0.12, 3)
    expect(depth(speaking)).toBeCloseTo(0.072, 3)
    expect(Math.max(...[...idle, ...speaking].map(frame => Math.abs(frame.headY)))).toBeLessThanOrEqual(0.001)
  })
})
