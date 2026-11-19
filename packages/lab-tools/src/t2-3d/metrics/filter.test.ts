import { describe, expect, it } from 'vitest'

import { butterworth } from './filter'
import { mean } from './math'

describe('zero-phase Butterworth preprocessing', () => {
  it('preserves a constant including its edges', () => {
    expect(Math.max(...butterworth(Array.from<number>({ length: 600 }).fill(3.4), 6).map(v => Math.abs(v - 3.4)))).toBeLessThan(1e-12)
  })

  it('attenuates 20 Hz while passing 1 Hz at the 6 Hz cutoff', () => {
    const amplitude = (hz: number) => {
      const output = butterworth(Array.from({ length: 600 }, (_, i) => Math.sin(2 * Math.PI * hz * i / 60)), 6).slice(60, -60)
      return Math.sqrt(2 * mean(output.map(v => v * v)))
    }
    expect(amplitude(1)).toBeGreaterThan(0.99)
    expect(amplitude(20)).toBeLessThan(0.01)
  })

  it('keeps a symmetric pulse centred with no phase shift', () => {
    const output = butterworth(Array.from({ length: 601 }, (_, i) => Math.exp(-(((i - 300) / 10) ** 2))), 6)
    expect(output.indexOf(Math.max(...output))).toBe(300)
    expect(Math.max(...output.map((v, i) => Math.abs(v - output[600 - i])))).toBeLessThan(1e-12)
  })
})
