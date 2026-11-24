import type { Resampled, Series } from './track'

import { describe, expect, it } from 'vitest'

import { fingerprint, reversalExtremes } from './fingerprint'

const HZ = 60

function series(seconds: number, channels: Partial<Record<'tilt' | 'eyeOpen' | 'scale', (t: number) => number | null>>, voiced: (t: number) => boolean = () => false, source: Resampled['source'] = 'natural'): Resampled {
  const n = seconds * HZ
  const sample = (f: ((t: number) => number | null) | undefined, fallback: number): Series => Array.from({ length: n }, (_, i) => f ? f(i / HZ) : fallback)
  return {
    source,
    channels: { tilt: sample(channels.tilt, 0), x: sample(undefined, 0), y: sample(undefined, 0), scale: sample(channels.scale, 1), eyeOpen: sample(channels.eyeOpen, 0.3) },
    level: Array.from({ length: n }, (_, i) => voiced(i / HZ) ? 1 : 0),
    voiced: Array.from({ length: n }, (_, i) => voiced(i / HZ)),
  }
}

/** A raised-cosine move from 0 to 1 over [0, 1]. */
const ease = (u: number): number => u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u)

describe('fingerprint', () => {
  it('measures a 1 Hz, 10 degree sine tilt', () => {
    const print = fingerprint(series(120, { tilt: t => 10 * Math.sin(2 * Math.PI * t) }))
    expect(print.tiltSdDeg).toBeCloseTo(10 / Math.SQRT2, 1)
    expect(print.tiltRangeDeg).toBeCloseTo(20 * Math.sin(0.45 * Math.PI), 0)
    // Two reversals per cycle, each completing a 20 degree swing.
    expect(print.swingsPerMin).toBeCloseTo(120, -1)
    expect(print.swingSizeDeg).toBeCloseTo(20, 0)
    expect(print.swingSeconds).toBeCloseTo(0.5, 1)
    // A sine's peak speed over its mean speed is pi / 2.
    expect(print.swingSharpness).toBeCloseTo(Math.PI / 2, 1)
    expect(print.midBandShare).toBeGreaterThan(0.95)
    expect(print.stillShare).toBeLessThan(0.05)
    expect(print.coverage).toBe(1)
  })

  it('measures holds and the swings between them', () => {
    // Holds of 5 s at 0 and 10 degrees, joined by 0.5 s moves.
    const tilt = (t: number) => {
      const cycle = t % 11
      return cycle < 5 ? 0 : cycle < 5.5 ? 10 * ease((cycle - 5) / 0.5) : cycle < 10.5 ? 10 : 10 * (1 - ease((cycle - 10.5) / 0.5))
    }
    const print = fingerprint(series(66, { tilt }))
    expect(print.stillShare).toBeGreaterThan(0.85)
    expect(print.swingSizeDeg).toBeCloseTo(10, 0)
    expect(print.swingSeconds).toBeCloseTo(5.5, 0)
    expect(print.midBandShare).toBeLessThan(0.5)
  })

  it('counts blinks, long closures and the closed share', () => {
    // A 0.15 s blink every 3 s, and a 1 s closure at 31 s and at 91 s.
    const eyeOpen = (t: number) => t % 3 < 0.15 || (t >= 31 && t < 32) || (t >= 91 && t < 92) ? 0.05 : 0.3
    const print = fingerprint(series(120, { eyeOpen }))
    expect(print.blinksPerMin).toBeCloseTo(20, 5)
    expect(print.blinkSeconds).toBeCloseTo(0.15, 5)
    expect(print.longClosuresPerMin).toBeCloseTo(1, 5)
    expect(print.eyesClosedShare).toBeCloseTo((40 * 0.15 + 2) / 120, 2)
  })

  it('counts a video frame with a face but no eyes as closed, and one without a face as not', () => {
    const eyeOpen = (t: number) => t % 3 < 0.15 || (t % 3 >= 1.5 && t % 3 < 1.65) ? null : 0.3
    const scale = (t: number) => t % 3 >= 1.5 && t % 3 < 1.65 ? null : 1
    const print = fingerprint(series(60, { eyeOpen, scale }, () => false, 'video'))
    expect(print.blinksPerMin).toBeCloseTo(20, 5)
  })

  it('relates tilt speed to speech', () => {
    // Voiced for 2 s out of every 4; a 5 degree nod 0.05 to 0.55 s after each onset, over a slow drift.
    const voiced = (t: number) => t % 4 < 2
    const tilt = (t: number) => Math.sin(2 * Math.PI * 0.2 * t) + 5 * ease((t % 4 - 0.05) / 0.5)
    const print = fingerprint(series(120, { tilt }, voiced))
    expect(print.talkShare).toBeCloseTo(2.4 / 4, 2)
    expect(print.onsetResponse).toBeGreaterThan(2)
    expect(print.talkSpeedRatio).toBeGreaterThan(1)
  })

  it('reports null, not 0, for measures it cannot compute', () => {
    const print = fingerprint(series(30, { tilt: t => Math.sin(t) }))
    expect(print.talkShare).toBeNull()
    expect(print.talkSpeedRatio).toBeNull()
    expect(print.onsetResponse).toBeNull()
    expect(print.blinkSeconds).toBeNull()
  })
})

describe('reversalExtremes', () => {
  it('turns only after a swing of the given size', () => {
    expect(reversalExtremes([0, 5, 2, 9, 0, 3], 8)).toEqual([0, 3])
    expect(reversalExtremes([0, 5, 2, 9, 0, 3], 2)).toEqual([0, 1, 2, 3, 4])
  })
})
