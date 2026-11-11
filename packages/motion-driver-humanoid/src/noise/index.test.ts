import { describe, expect, it } from 'vitest'

import { createRandomStream } from '../random'
import { createActivityGate, createDriftNoise, deriveSeed, gaussian } from './index'

function samples(seed: number, count: number) {
  const noise = createDriftNoise({ seed })
  for (let i = 0; i < 2048; i++)
    noise.step(1 / 16)
  return Array.from({ length: count }, () => noise.step(1 / 16))
}

// Averaged Hann-window periodograms reduce the variance of individual OU bins.
function spectrum(values: readonly number[]) {
  const size = 4096
  const blocks = values.length / size
  const power = new Float64Array(769)
  for (let block = 0; block < blocks; block++) {
    for (let bin = 1; bin < power.length; bin++) {
      const angle = 2 * Math.PI * bin / size
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      let re = 0
      let im = 0
      let cos = 1
      let sin = 0
      for (let i = 0; i < size; i++) {
        const value = values[block * size + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / size))
        re += value * cos
        im += value * sin
        const nextCos = cos * c - sin * s
        sin = sin * c + cos * s
        cos = nextCos
      }
      power[bin] += (re * re + im * im) / blocks
    }
  }
  return power
}

describe('seeded drift noise', () => {
  it('replays equal seeds and separates different seeds', () => {
    const first = samples(42, 256)
    expect(samples(42, 256)).toEqual(first)
    expect(samples(43, 256)).not.toEqual(first)
  })

  it('has a near-zero long-run mean', () => {
    const values = samples(7, 131072)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    expect(Math.abs(mean)).toBeLessThan(0.15)
  })

  it('has decreasing broadband power and no dominant in-band spectral line', () => {
    const power = spectrum(samples(47, 32768))
    function band(low: number, high: number) {
      const bins = Array.from(power.slice(Math.ceil(low * 256), Math.floor(high * 256) + 1))
      return bins.reduce((sum, value) => sum + value, 0) / bins.length
    }
    expect(band(0.04, 0.06)).toBeGreaterThan(band(0.4, 0.6))
    expect(band(0.4, 0.6)).toBeGreaterThan(band(2.8, 3))
    // Compare local medians: a 1/f slope itself is not a spectral line.
    for (const [low, high] of [[0.01, 0.02], [0.02, 0.04], [0.04, 0.08], [0.08, 0.16], [0.16, 0.2]]) {
      const bins = Array.from(power.slice(Math.ceil(low * 256), Math.floor(high * 256) + 1)).sort((a, b) => a - b)
      expect(bins[bins.length - 1] / bins[Math.floor(bins.length / 2)]).toBeLessThan(8)
    }
  })

  it('keeps existing channels unchanged when another indexed stream is added', () => {
    const existing = createDriftNoise({ seed: deriveSeed(99, 0) })
    const replay = createDriftNoise({ seed: deriveSeed(99, 0) })
    const added = createDriftNoise({ seed: deriveSeed(99, 1) })
    let differs = false
    for (let i = 0; i < 1000; i++) {
      const value = existing.step(1 / 120)
      const extra = added.step(1 / 120)
      expect(replay.step(1 / 120)).toBe(value)
      differs ||= extra !== value
    }
    expect(differs).toBe(true)
  })

  it('does not advance state or consume draws on a zero-duration tick', () => {
    const first = createDriftNoise({ seed: 123 })
    const second = createDriftNoise({ seed: 123 })
    expect(first.step(0)).toBe(0)
    for (let i = 0; i < 100; i++) {
      const value = first.step(0.01)
      expect(first.step(0)).toBe(value)
      expect(second.step(0.01)).toBe(value)
    }
  })
})

describe('gaussian draws and activity gate', () => {
  it('produces centred unit-variance Gaussian draws from a seeded stream', () => {
    const random = createRandomStream(42)
    let sum = 0
    let squares = 0
    const count = 100000
    for (let i = 0; i < count; i++) {
      const value = gaussian(random)
      sum += value
      squares += value * value
    }
    expect(Math.abs(sum / count)).toBeLessThan(0.02)
    expect(squares / count).toBeGreaterThan(0.95)
    expect(squares / count).toBeLessThan(1.05)
  })

  it('replays bounded spells of activity with a configurable floor', () => {
    const gate = createActivityGate({ seed: 4, floor: 0.2, tau: 2 })
    const replay = createActivityGate({ seed: 4, floor: 0.2, tau: 2 })
    let quiet = 0
    let active = 0
    for (let i = 0; i < 12000; i++) {
      const value = gate.step(1 / 120)
      expect(replay.step(1 / 120)).toBe(value)
      expect(gate.step(0)).toBe(value)
      expect(value).toBeGreaterThanOrEqual(0.2)
      expect(value).toBeLessThanOrEqual(1)
      if (value < 0.4)
        quiet++
      if (value > 0.8)
        active++
    }
    expect(quiet / 12000).toBeGreaterThan(0.05)
    expect(active / 12000).toBeGreaterThan(0.05)
  })
})
