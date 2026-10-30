import type { RitualDay, RitualKind } from './types'

import { describe, expect, it } from 'vitest'

import { advanceRituals, logicalDayKey, markRitualDone, openRituals, ritualHazardPerHour } from './rituals'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const T0 = Date.UTC(2026, 9, 30)

function facts(minute: number, overrides: Partial<Parameters<typeof advanceRituals>[1]> = {}): Parameters<typeof advanceRituals>[1] {
  return {
    nowMs: T0 + minute * MIN,
    local: { dayKey: '2026-10-30', minuteOfDay: minute },
    presence: 'here',
    userSpokeToday: false,
    awayEndedAtMs: null,
    awayDurationMs: null,
    ...overrides,
  }
}

describe('logicalDayKey', () => {
  it('rolls over at 04:00 rather than midnight', () => {
    expect(logicalDayKey({ year: 2026, month: 10, day: 30, hour: 3 })).toBe('2026-10-29')
    expect(logicalDayKey({ year: 2026, month: 10, day: 30, hour: 4 })).toBe('2026-10-30')
  })

  it.each([
    [{ year: 2026, month: 1, day: 1, hour: 3 }, '2025-12-31'],
    [{ year: 2024, month: 3, day: 1, hour: 3 }, '2024-02-29'],
    [{ year: 2026, month: 3, day: 1, hour: 3 }, '2026-02-28'],
  ])('handles calendar boundaries for %j', (local, expected) => {
    expect(logicalDayKey(local)).toBe(expected)
  })
})

describe('advanceRituals', () => {
  it('opens greeting on first present input, and expires exactly after 45 minutes without reopening', () => {
    const away = advanceRituals(null, facts(8 * 60, { presence: 'away' }))
    expect(away.firstPresentAtMs).toBeNull()
    expect(openRituals(away, T0 + 8 * 60 * MIN)).toEqual([])

    const first = advanceRituals(away, facts(9 * 60, { presence: 'idle' }))
    expect(first.firstPresentAtMs).toBe(T0 + 9 * 60 * MIN)
    expect(openRituals(first, T0 + (9 * 60 + 45) * MIN - 1)).toEqual(['greeting'])
    expect(openRituals(first, T0 + (9 * 60 + 45) * MIN)).toEqual([])

    const expired = advanceRituals(first, facts(9 * 60 + 45))
    expect(expired.states.greeting).toBe('expired')
    expect(advanceRituals(expired, facts(10 * 60)).states.greeting).toBe('expired')
    expect(first.states.greeting).toBe('open')
  })

  it.each([5 * 60, 15 * 60])('allows the greeting boundary at minute %i', (minute) => {
    const day = advanceRituals(null, facts(minute))
    expect(openRituals(day, T0 + minute * MIN)).toEqual(['greeting'])
  })

  it.each([4 * 60, 15 * 60 + 1])('never opens a late greeting after first presence at minute %i', (minute) => {
    const first = advanceRituals(null, facts(minute))
    expect(first.states.greeting).toBe('expired')
    expect(openRituals(advanceRituals(first, facts(10 * 60)), T0 + 10 * 60 * MIN)).toEqual([])
  })

  it('expires greeting when the user speaks first, before or during its window', () => {
    const spokeFirst = advanceRituals(null, facts(9 * 60, { userSpokeToday: true }))
    expect(spokeFirst.states.greeting).toBe('expired')
    const opened = advanceRituals(null, facts(9 * 60))
    const spoke = advanceRituals(opened, facts(9 * 60 + 1, { userSpokeToday: true }))
    expect(openRituals(spoke, T0 + (9 * 60 + 1) * MIN)).toEqual([])
    expect(advanceRituals(spoke, facts(10 * 60)).states.greeting).toBe('expired')
  })

  it('opens sign-off only while present, wrapping midnight and ending at 01:30', () => {
    let day = advanceRituals(null, facts(22 * 60 + 29))
    expect(openRituals(day, T0 + (22 * 60 + 29) * MIN)).toEqual([])
    day = advanceRituals(day, facts(22 * 60 + 30, { presence: 'unknown' }))
    expect(day.windowOpenedAtMs['sign-off']).toBeNull()
    day = advanceRituals(day, facts(23 * 60, { presence: 'idle' }))
    expect(openRituals(day, T0 + 23 * 60 * MIN)).toEqual(['sign-off'])
    day = advanceRituals(day, facts(89, { nowMs: T0 + DAY + 89 * MIN }))
    expect(openRituals(day, T0 + DAY + 90 * MIN - 1)).toEqual(['sign-off'])
    expect(openRituals(day, T0 + DAY + 90 * MIN)).toEqual([])
    day = advanceRituals(day, facts(90, { nowMs: T0 + DAY + 90 * MIN }))
    expect(day.states['sign-off']).toBe('expired')
    expect(advanceRituals(day, facts(23 * 60)).states['sign-off']).toBe('expired')
  })

  it('opens sign-off for a first appearance after midnight without extending the deadline', () => {
    const day = advanceRituals(null, facts(60, { nowMs: T0 + DAY + 60 * MIN + 25_000 }))
    expect(openRituals(day, T0 + DAY + 89 * MIN)).toEqual(['sign-off'])
    expect(openRituals(day, T0 + DAY + 90 * MIN)).toEqual([])
    expect(advanceRituals(null, facts(90)).states['sign-off']).toBe('expired')
  })

  it('requires three hours away and expires welcome-back from the return time, not the evaluation time', () => {
    const short = advanceRituals(null, facts(16 * 60, { awayEndedAtMs: T0 + 16 * 60 * MIN, awayDurationMs: 180 * MIN - 1 }))
    expect(openRituals(short, T0 + 16 * 60 * MIN)).toEqual([])
    const returnedAt = T0 + 17 * 60 * MIN
    const returned = advanceRituals(short, facts(17 * 60 + 5, { awayEndedAtMs: returnedAt, awayDurationMs: 180 * MIN }))
    expect(returned.windowOpenedAtMs['welcome-back']).toBe(returnedAt)
    expect(openRituals(returned, returnedAt + 20 * MIN - 1)).toEqual(['welcome-back'])
    expect(openRituals(returned, returnedAt + 20 * MIN)).toEqual([])
    const expired = advanceRituals(returned, facts(18 * 60, { awayEndedAtMs: returnedAt, awayDurationMs: 180 * MIN }))
    expect(expired.states['welcome-back']).toBe('expired')
    expect(advanceRituals(expired, facts(21 * 60, { awayEndedAtMs: T0 + 21 * 60 * MIN, awayDurationMs: 180 * MIN })).states['welcome-back']).toBe('expired')
  })

  it('opens only the greeting after an overnight absence across the rollover', () => {
    // Away 23:00 -> 09:00.
    const returnedAt = T0 + 9 * 60 * MIN
    const day = advanceRituals(null, facts(9 * 60, { awayEndedAtMs: returnedAt, awayDurationMs: 10 * 60 * MIN }))
    expect(openRituals(day, returnedAt)).toEqual(['greeting'])
    expect(day.windowOpenedAtMs['welcome-back']).toBeNull()
    expect(day.states['welcome-back']).toBe('open')
  })

  it('still opens welcome-back after a same-day absence of 3.5 hours', () => {
    // Away 10:00 -> 13:30.
    const returnedAt = T0 + (13 * 60 + 30) * MIN
    const present = markRitualDone(advanceRituals(null, facts(9 * 60)), 'greeting')
    const day = advanceRituals(present, facts(13 * 60 + 30, { awayEndedAtMs: returnedAt, awayDurationMs: 210 * MIN }))
    expect(day.windowOpenedAtMs['welcome-back']).toBe(returnedAt)
    expect(openRituals(day, returnedAt)).toEqual(['welcome-back'])
  })

  it('skips welcome-back for an absence that starts before 04:00 and ends after it', () => {
    // Away 03:30 -> 07:30 crosses the rollover; the same return after leaving at 04:00 does not.
    const returnedAt = T0 + (7 * 60 + 30) * MIN
    const crossed = advanceRituals(null, facts(7 * 60 + 30, { awayEndedAtMs: returnedAt, awayDurationMs: 240 * MIN }))
    expect(crossed.windowOpenedAtMs['welcome-back']).toBeNull()
    expect(openRituals(crossed, returnedAt)).not.toContain('welcome-back')
    const sameDay = advanceRituals(null, facts(7 * 60 + 30, { awayEndedAtMs: returnedAt, awayDurationMs: 210 * MIN }))
    expect(sameDay.windowOpenedAtMs['welcome-back']).toBe(returnedAt)
  })

  it('does not open welcome-back while away or restart it on repeated or older returns', () => {
    const returnFacts = facts(16 * 60, { awayEndedAtMs: T0 + 16 * 60 * MIN, awayDurationMs: 180 * MIN })
    const away = advanceRituals(null, { ...returnFacts, presence: 'away' })
    expect(away.lastAwayEndedAtMs).toBeNull()
    expect(openRituals(away, returnFacts.nowMs)).toEqual([])
    const returned = advanceRituals(away, returnFacts)
    expect(advanceRituals(returned, returnFacts)).toEqual(returned)
    const older = advanceRituals(returned, { ...returnFacts, awayEndedAtMs: returnFacts.nowMs - MIN })
    expect(older.lastAwayEndedAtMs).toBe(returnFacts.nowMs)
    expect(older.windowOpenedAtMs).toEqual(returned.windowOpenedAtMs)
  })

  it('keeps done terminal and counts exactly one completion per kind on each of two logical days', () => {
    const kinds: readonly RitualKind[] = ['greeting', 'sign-off', 'welcome-back']
    let day: RitualDay | null = null
    const counts: Record<string, Partial<Record<RitualKind, number>>> = {}
    for (const [dayIndex, dayKey] of ['2026-10-30', '2026-10-31'].entries()) {
      counts[dayKey] = {}
      for (const minute of [9 * 60, 16 * 60, 23 * 60]) {
        const input = facts(minute, {
          nowMs: T0 + dayIndex * DAY + minute * MIN,
          local: { dayKey, minuteOfDay: minute },
          awayEndedAtMs: minute === 16 * 60 ? T0 + dayIndex * DAY + minute * MIN : null,
          awayDurationMs: minute === 16 * 60 ? 180 * MIN : null,
        })
        day = advanceRituals(day, input)
        for (const kind of openRituals(day, input.nowMs)) {
          counts[dayKey][kind] = (counts[dayKey][kind] ?? 0) + 1
          day = markRitualDone(day, kind)
        }
        day = advanceRituals(day, input)
        expect(openRituals(day, input.nowMs)).toEqual([])
      }
      for (const kind of kinds) {
        expect(counts[dayKey][kind]).toBe(1)
        expect(day?.states[kind]).toBe('done')
      }
      const snapshot = structuredClone(day)
      expect(advanceRituals(day, facts(9 * 60, { local: { dayKey, minuteOfDay: 9 * 60 } })).states).toEqual(day?.states)
      expect(day).toEqual(snapshot)
    }
  })

  it('resets all state at a new logical day even while absent', () => {
    const old = markRitualDone(advanceRituals(null, facts(9 * 60)), 'greeting')
    const next = advanceRituals(old, facts(4 * 60, { local: { dayKey: '2026-10-31', minuteOfDay: 4 * 60 }, presence: 'away' }))
    expect(next).toEqual({
      dayKey: '2026-10-31',
      firstPresentAtMs: null,
      lastAwayEndedAtMs: null,
      states: { 'greeting': 'open', 'sign-off': 'open', 'welcome-back': 'open' },
      windowOpenedAtMs: { 'greeting': null, 'sign-off': null, 'welcome-back': null },
    })
  })

  it('does not surface a window before its opening time on a backward clock jump', () => {
    const input = facts(9 * 60)
    const day = advanceRituals(null, input)
    expect(openRituals(day, input.nowMs - 1)).toEqual([])
  })
})

describe('ritualHazardPerHour', () => {
  it('provides the per-hour competing rates for open rituals', () => {
    expect(ritualHazardPerHour('greeting')).toBe(12)
    expect(ritualHazardPerHour('sign-off')).toBe(1.5)
    expect(ritualHazardPerHour('welcome-back')).toBe(6)
  })
})
