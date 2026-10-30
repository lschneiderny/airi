import { describe, expect, it } from 'vitest'

import {
  ACCRUAL_DT_MAX_MS,
  accrue,
  BASE_RATE_AT_HALF_PER_HOUR,
  baseRatePerHour,
  CLEAR_SCALE_MS,
  clearFactor,
  CONTINUATION_K,
  CONTINUATION_TAU_MS,
  CONTINUATION_WINDOW_MS,
  continuationHazardPerHour,
  drawThreshold,
  EXCHANGE_ZERO_MS,
  exchangeFactor,
  expectedWaitMs,
  HOUR_MS,
  pressure,
  RECOVERY_HALF_LIFE_MS,
  recoveryFactor,
  unansweredPhase,
} from './urge'

const MINUTE_MS = 60_000

describe('situation urge rate and multipliers', () => {
  it('maps Chattiness to the calibrated base rate and the fixed exponential span', () => {
    expect(baseRatePerHour(0.5)).toBe(BASE_RATE_AT_HALF_PER_HOUR)
    for (const c of [0, 0.25, 0.75, 1])
      expect(baseRatePerHour(c) / BASE_RATE_AT_HALF_PER_HOUR).toBeCloseTo(26 ** (c - 0.5), 12)
    for (let step = 1; step <= 100; step++)
      expect(baseRatePerHour(step / 100)).toBeGreaterThan(baseRatePerHour((step - 1) / 100))
  })

  it('clamps out-of-range and non-finite Chattiness', () => {
    expect(baseRatePerHour(-1)).toBe(baseRatePerHour(0))
    expect(baseRatePerHour(2)).toBe(baseRatePerHour(1))
    for (const c of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(baseRatePerHour(c)).toBe(baseRatePerHour(0))
  })

  it('holds during the exchange zero window then recovers over 30 minutes', () => {
    expect(exchangeFactor(null)).toBe(1)
    expect(exchangeFactor(-1)).toBe(0)
    expect(exchangeFactor(EXCHANGE_ZERO_MS - 1)).toBe(0)
    expect(exchangeFactor(EXCHANGE_ZERO_MS)).toBeGreaterThan(0)
    expect(exchangeFactor(5 * MINUTE_MS)).toBeCloseTo(0.105, 3)
    expect(exchangeFactor(15 * MINUTE_MS)).toBeCloseTo(0.632, 3)
    expect(exchangeFactor(30 * MINUTE_MS)).toBeCloseTo(0.982, 3)
  })

  it('recovers from a hard hold at the configured exponential scale', () => {
    expect(clearFactor(null)).toBe(1)
    expect(clearFactor(0)).toBe(0)
    expect(clearFactor(CLEAR_SCALE_MS)).toBeCloseTo(1 - Math.exp(-1), 12)
    expect(clearFactor(2 * CLEAR_SCALE_MS)).toBeGreaterThan(clearFactor(CLEAR_SCALE_MS))
  })

  it('adds thread pressure without changing the base rate', () => {
    expect(pressure(0)).toBe(0.6)
    expect(pressure(0.5)).toBe(1)
    expect(pressure(1)).toBeCloseTo(1.4, 12)
  })
})

describe('situation unanswered phases', () => {
  it('allows open topics without an unanswered opening', () => {
    expect(unansweredPhase(0, 0)).toEqual({ allows: 'open', damping: 1 })
  })

  it.each([
    { unanswered: 1, quietMs: 90 * MINUTE_MS, allows: 'continuation', damping: 0.5 },
    { unanswered: 2, quietMs: 4 * HOUR_MS, allows: 'urgent', damping: 0.3 },
    { unanswered: 3, quietMs: 8 * HOUR_MS, allows: 'urgent', damping: 0.2 },
    { unanswered: 7, quietMs: 8 * HOUR_MS, allows: 'urgent', damping: 0.2 },
  ])('reopens after the quiet window for $unanswered unanswered openings', ({ unanswered, quietMs, allows, damping }) => {
    expect(unansweredPhase(unanswered, quietMs - 1)).toEqual({ allows, damping })
    expect(unansweredPhase(unanswered, quietMs)).toEqual({ allows: 'open', damping })
  })

  it('recovers monotonically after a reply, halving the remaining depth each hour', () => {
    const damp = Object.freeze({ depth: 0.8, sinceMs: HOUR_MS })
    expect(recoveryFactor(null, HOUR_MS)).toBe(1)
    expect(recoveryFactor(damp, damp.sinceMs)).toBeCloseTo(0.2, 12)
    expect(recoveryFactor(damp, damp.sinceMs + RECOVERY_HALF_LIFE_MS)).toBeCloseTo(0.6, 12)
    let previous = recoveryFactor(damp, damp.sinceMs)
    for (let step = 1; step <= 24; step++) {
      const next = recoveryFactor(damp, damp.sinceMs + step * RECOVERY_HALF_LIFE_MS / 4)
      expect(next).toBeGreaterThan(previous)
      expect(next).toBeLessThanOrEqual(1)
      previous = next
    }
  })

  it('decays the continuation hazard and closes it exactly at 90 minutes', () => {
    const initial = CONTINUATION_K / (CONTINUATION_TAU_MS / HOUR_MS)
    expect(continuationHazardPerHour(-1)).toBe(0)
    expect(continuationHazardPerHour(0)).toBe(initial)
    expect(continuationHazardPerHour(CONTINUATION_TAU_MS)).toBeCloseTo(initial / Math.E, 12)
    expect(continuationHazardPerHour(CONTINUATION_WINDOW_MS - 1)).toBeGreaterThan(0)
    expect(continuationHazardPerHour(CONTINUATION_WINDOW_MS)).toBe(0)
    expect(continuationHazardPerHour(2 * CONTINUATION_WINDOW_MS)).toBe(0)
  })
})

describe('situation integrated hazard', () => {
  it('accrues the same amount over five 2 second steps as one 10 second step', () => {
    let urge = 0.3
    for (let step = 0; step < 5; step++)
      urge = accrue(urge, 1.7, 2000)
    expect(Math.abs(urge - accrue(0.3, 1.7, 10_000))).toBeLessThan(1e-9)
    expect(accrue(0, 1, 10_000)).toBeCloseTo(10_000 / HOUR_MS, 12)
  })

  it('uses the explicit elapsed milliseconds without changing a zero-rate urge', () => {
    expect(accrue(0.3, 0, HOUR_MS)).toBe(0.3)
    expect(accrue(0.3, 2, ACCRUAL_DT_MAX_MS)).toBeCloseTo(0.3 + 2 * ACCRUAL_DT_MAX_MS / HOUR_MS, 12)
  })

  it('draws an exponential threshold from a unit ticket', () => {
    expect(drawThreshold(0)).toBeCloseTo(0, 12)
    expect(drawThreshold(1 - Math.exp(-1))).toBeCloseTo(1, 12)
    expect(drawThreshold(0.9)).toBeGreaterThan(drawThreshold(0.5))
    expect(Number.isFinite(drawThreshold(1 - Number.EPSILON))).toBe(true)
  })

  it('predicts the remaining wait from integrated hazard and handles a zero rate', () => {
    expect(expectedWaitMs(0.5, 1.5, 2)).toBe(HOUR_MS / 2)
    expect(expectedWaitMs(0.5, 1.5, 0)).toBeNull()
    expect(expectedWaitMs(1.5, 1.5, 2)).toBe(0)
    expect(expectedWaitMs(2, 1.5, 2)).toBe(-HOUR_MS / 4)
  })
})
