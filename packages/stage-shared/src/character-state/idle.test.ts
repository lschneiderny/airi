import { describe, expect, it } from 'vitest'

import { idleDriveOf, NEUTRAL_IDLE_DRIVE, sleepinessAt } from './idle'

const HOUR = 3_600_000
const rest = { valence: 0.1, energy: 0, tension: 0.05 }

describe('sleepinessAt', () => {
  it('is zero through the day and one through the deep night', () => {
    for (const hour of [7, 9, 12, 18, 21.9])
      expect(sleepinessAt(hour)).toBe(0)
    for (const hour of [1, 2, 4.9])
      expect(sleepinessAt(hour)).toBe(1)
  })

  it('rises over the evening across midnight and falls over the morning', () => {
    expect(sleepinessAt(22)).toBe(0)
    expect(sleepinessAt(23.5)).toBeCloseTo(0.5)
    expect(sleepinessAt(0.25)).toBeCloseTo(0.75)
    expect(sleepinessAt(6)).toBeCloseTo(0.5)
    expect(sleepinessAt(24)).toBeCloseTo(sleepinessAt(0))
  })

  it('treats a bad hour as daytime', () => {
    expect(sleepinessAt(Number.NaN)).toBe(0)
  })
})

describe('idleDriveOf', () => {
  it('keeps the neutral mood without a reading but still follows the hour', () => {
    expect(idleDriveOf(null, 0, 12)).toEqual(NEUTRAL_IDLE_DRIVE)
    expect(idleDriveOf(null, 0, 2)).toEqual({ ...NEUTRAL_IDLE_DRIVE, sleepiness: 1 })
  })

  it('measures mood from the resting disposition and clamps it', () => {
    const drive = idleDriveOf({ mood: { valence: 0.5, energy: -0.4, tension: 0.05 }, resting: rest, lastInteractionAtMs: 0 }, 0, 12)
    expect(drive.valence).toBeCloseTo(0.4)
    expect(drive.energy).toBeCloseTo(-0.4)
    expect(drive.tension).toBe(0)
    expect(idleDriveOf({ mood: { valence: 5, energy: -5, tension: 0 }, resting: rest, lastInteractionAtMs: 0 }, 0, 12)).toMatchObject({ valence: 1, energy: -1 })
  })

  it('grows solitude with the time since the last interaction', () => {
    const at = (sinceMs: number | null) => idleDriveOf({ mood: rest, resting: rest, lastInteractionAtMs: sinceMs === null ? null : 10 * HOUR - sinceMs }, 10 * HOUR, 12).solitude
    expect(at(0)).toBe(0)
    expect(at(HOUR / 2)).toBeCloseTo(0.5)
    expect(at(3 * HOUR)).toBeGreaterThan(0.98)
    expect(at(null)).toBe(0.5)
    // An interaction stamped after now counts as just now.
    expect(at(-HOUR)).toBe(0)
  })
})
