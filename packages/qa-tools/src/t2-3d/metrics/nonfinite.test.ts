import { describe, expect, it } from 'vitest'

import { butterworth } from './filter'
import { cv, dot, laggedCorrelation, mean, median, norm, principalAxis, rms } from './math'
import { acfPeak, loopPeak } from './period'
import { spectralEstimate } from './spectral'

describe('nonfinite detector arithmetic', () => {
  const large = Array.from({ length: 600 }, (_, i) => 1e200 * Math.sin(2 * Math.PI * i / 150))
  it.each([
    { name: 'mean sum', measure: () => mean([Number.MAX_VALUE, Number.MAX_VALUE]) },
    { name: 'median midpoint', measure: () => median([Number.MAX_VALUE, Number.MAX_VALUE]) },
    { name: 'vector energy', measure: () => dot([1e200, 0, 0], [1e200, 0, 0]) },
    { name: 'vector norm', measure: () => norm([Number.MAX_VALUE, Number.MAX_VALUE, 0]) },
    { name: 'RMS', measure: () => rms([[1e200, 0, 0]]) },
    { name: 'variance', measure: () => cv([1e200, 2e200]) },
    { name: 'principal axis', measure: () => principalAxis([[1e200, 0, 0], [-1e200, 0, 0]]) },
    { name: 'correlation accumulator', measure: () => laggedCorrelation(large, large, 30) },
    { name: 'correlation energy product', measure: () => laggedCorrelation(large.map(value => value * 1e-100), large.map(value => value * 1e-100), 30) },
    { name: 'ACF accumulator', measure: () => acfPeak(large) },
    { name: 'ACF energy product', measure: () => acfPeak(large.map(value => value * 1e-100)) },
    { name: 'loop covariance', measure: () => loopPeak(large.map(value => [value, 0, 0])) },
    { name: 'filter recurrence', measure: () => butterworth([Number.MAX_VALUE, -Number.MAX_VALUE], 6) },
    { name: 'spectral energy', measure: () => spectralEstimate([...large, ...large, ...large]) },
  ])('refuses $name before comparisons can erase overflow', ({ measure }) => {
    expect(measure).toThrow(expect.objectContaining({ name: 'trace-nonfinite' }))
  })
})
