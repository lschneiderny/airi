import type { LivelinessTrace } from './liveliness'

import { describe, expect, it } from 'vitest'

import { scoreLiveliness } from './liveliness'
import { referenceStats } from './reference-stats'

const ranges = Object.fromEntries(['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].map(id => [id, { min: -30, max: 30, default: 0 }]))

function signal(hz: number, seconds: number, sample: (t: number) => number, jitter = false): LivelinessTrace {
  const t = Array.from({ length: hz * seconds + 1 }, (_, i) => i / hz + (jitter && i > 0 ? Math.sin(i * 1.7) * 0.003 : 0))
  return { t, channels: { ParamAngleX: t.map(sample), ParamAngleY: t.map(() => 0), ParamAngleZ: t.map(() => 0) } }
}

describe('liveliness score', () => {
  it('averages squared submetric distances within rows', () => {
    const trace: LivelinessTrace = {
      t: [0, 1 / 30, 2 / 30],
      channels: { ParamAngleX: [-8, 0, 8], ParamBodyAngleX: [0.1, 0.2, 0.3] },
    }
    // Three gated rows: channelSd d=-0.5537009848; pose p5 d=1.8958636170 and
    // p95 d=-2.2; nearLimit d=-1. Missing metrics and report-only body SD have no vote.
    // S=100*exp(-(0.5537009848^2+(1.8958636170^2+2.2^2)/2+1)/6).
    const report = scoreLiveliness(trace, ranges)
    expect(report.score).toBeCloseTo(39.82710927710652, 9)
  })

  it('does not let opposite-signed errors in one row cancel', () => {
    // Alternating +/-sd samples have exactly that population SD. Only the channelSd row votes.
    const center = (id: string) => {
      const [low, high] = referenceStats.bands[id].band!
      return Math.sqrt(low * high)
    }
    const t = Array.from({ length: 60 }, (_, i) => i / 30)
    const score = (brow: number, mouth: number) => scoreLiveliness({
      t,
      channels: {
        ParamBrowLY: t.map((_, i) => (i % 2 ? 1 : -1) * brow * center('sd:ParamBrowLY')),
        ParamMouthForm: t.map((_, i) => (i % 2 ? 1 : -1) * mouth * center('sd:ParamMouthForm')),
      },
    }, ranges).score
    const none = score(1, 1)
    const one = score(1.5, 1)
    const two = score(1.5, 1 / 1.5)
    expect(none).toBeCloseTo(100, 9)
    expect(one).toBeLessThan(none)
    expect(two).toBeLessThan(one)
  })

  it('rejects a frozen trace', () => {
    expect(scoreLiveliness(signal(30, 10, () => 0), ranges).hardFailures).toContain('frozen')
  })

  it('detects a four second signed head loop', () => {
    const report = scoreLiveliness(signal(30, 180, t => 5 * Math.sin(t * Math.PI / 2)), ranges)
    expect(report.hardFailures).toContain('looping')
    expect(report.metrics.loopPeak.value).toBeGreaterThan(0.9)
  })

  it('rejects head values pinned at the limit', () => {
    expect(scoreLiveliness(signal(30, 10, () => 30), ranges).hardFailures).toContain('clipped')
  })

  it('warns about reference clipping while preserving generated clipping and shared hard failures', () => {
    const trace = signal(30, 10, () => 30)
    const generated = scoreLiveliness(trace, ranges, { mode: 'generated' })
    const reference = scoreLiveliness(trace, ranges, { mode: 'reference' })
    expect(generated.hardFailures).toContain('clipped')
    expect(generated.warnings).not.toContain('clipped')
    expect(reference.hardFailures).not.toContain('clipped')
    expect(reference.warnings).toEqual(['clipped'])
    expect(reference.metrics.nearLimitOccupancy.value).toBe(generated.metrics.nearLimitOccupancy.value)
    expect(reference.metrics.nearLimitOccupancy.band).toBeNull()
    expect(reference.metrics.nearLimitOccupancy.pass).toBeNull()
    expect(reference.hardFailures).toContain('frozen')
    expect(reference.pass).toBe(false)
  })

  it('measures synthetic summed OU channel deviations within five percent', () => {
    let seed = 1
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0
      return (seed + 0.5) / 2 ** 32
    }
    const gaussian = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())
    const deviations: Record<string, number> = { ParamAngleX: 7.65, ParamAngleY: 6.42, ParamAngleZ: 2.27, ParamEyeBallX: 0.094, ParamEyeBallY: 0.123, ParamBrowLY: 0.043, ParamMouthOpenY: 0.025, ParamMouthForm: 0.05 }
    const trace: LivelinessTrace = { t: Array.from({ length: 30 * 1800 }, (_, i) => i / 30), channels: {} }
    for (const [id, deviation] of Object.entries(deviations)) {
      let fast = 0
      let slow = 0
      trace.channels[id] = Array.from(trace.t, () => {
        fast = Math.exp(-1 / 6) * fast + Math.sqrt(1 - Math.exp(-1 / 3)) * gaussian()
        slow = Math.exp(-1 / 30) * slow + Math.sqrt(1 - Math.exp(-1 / 15)) * gaussian()
        return deviation * (fast + slow) / Math.SQRT2
      })
    }
    const report = scoreLiveliness(trace, ranges)
    for (const [id, deviation] of Object.entries(deviations))
      expect(Math.abs(report.metrics[`sd:${id}`].value! / deviation - 1)).toBeLessThan(0.05)
  })

  it('resamples jittered 27 Hz and 60 Hz continuous signals consistently', () => {
    const sample = (t: number) => 0.9 * Math.sin(t * 1.1) + 0.4 * Math.sin(t * 2.7)
    const low = scoreLiveliness(signal(27, 120, sample, true), ranges)
    const high = scoreLiveliness(signal(60, 120, sample), ranges)
    for (const id of ['still05', 'still2'])
      expect(Math.abs(low.metrics[id].value! - high.metrics[id].value!)).toBeLessThan(0.01)
  })

  it('separates heavy-tailed posture shift amplitudes from constant and uniform ones', () => {
    let seed = 7
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0
      return (seed + 0.5) / 2 ** 32
    }
    // Min-jerk yaw shifts of 0.6 s on the 30 Hz grid with 1-2 s holds, so peaks stay over 1 s apart.
    // Each move crosses back over zero.
    const shifts = (amplitude: () => number): LivelinessTrace => {
      const x: number[] = [0]
      while (x.length < 30 * 1200) {
        const from = x[x.length - 1]
        const to = from - Math.sign(from || 1) * amplitude()
        for (let i = 1; i <= 18; i++) {
          const u = i / 18
          x.push(from + (to - from) * (10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5))
        }
        for (let i = 30 + Math.floor(random() * 30); i > 0; i--)
          x.push(to)
      }
      const t = x.map((_, i) => i / 30)
      return { t, channels: { ParamAngleX: x, ParamAngleY: t.map(() => 0), ParamAngleZ: t.map(() => 0) } }
    }
    const gaussian = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())
    const constant = scoreLiveliness(shifts(() => 8), ranges).metrics
    // Uniform [2.7, 13.3] has wide spread and no tail.
    const uniform = scoreLiveliness(shifts(() => 8 * (1 / 3 + (4 / 3) * random())), ranges).metrics
    // An offset lognormal is right-skewed in log space, like the recordings.
    const heavy = scoreLiveliness(shifts(() => 4 + 8 * Math.exp(0.9 * gaussian())), ranges).metrics
    expect(constant.speedPeakP90P50.value).toBeCloseTo(1, 9)
    expect(constant.speedPeakP90P50.pass).toBe(false)
    expect(constant.speedPeakLogAsymmetry.value).toBeNull()
    expect(uniform.speedPeakLogAsymmetry.pass).toBe(false)
    expect(heavy.speedPeakP90P50.pass).toBe(true)
    expect(heavy.speedPeakLogAsymmetry.pass).toBe(true)
  })

  it('reports no peak dispersion with fewer than twenty peaks', () => {
    // A 7.9 units/s speed peak every 4 s gives 14 peaks in one minute.
    const report = scoreLiveliness(signal(30, 60, t => 10 * Math.sin(t * Math.PI / 4)), ranges)
    expect(report.metrics.speedPeakP90P50.value).toBeNull()
    expect(report.metrics.speedPeakLogAsymmetry.value).toBeNull()
  })

  it('never differentiates across source gaps or invalid samples', () => {
    const trace: LivelinessTrace = {
      t: [0, 1 / 30, 2 / 30, 10, 10 + 1 / 30, 10 + 2 / 30, 11, 11 + 1 / 30],
      channels: { ParamAngleX: [0, 0, 0, 20, 20, 20, -20, 0], ParamAngleY: Array.from<number>({ length: 8 }).fill(0), ParamAngleZ: Array.from<number>({ length: 8 }).fill(0) },
      valid: [true, true, true, true, true, true, false, true],
    }
    const report = scoreLiveliness(trace, ranges)
    expect(report.metrics.still05.value).toBe(1)
    expect(report.metrics.still2.value).toBe(1)
    expect(report.hardFailures).toContain('frozen')
  })
})
