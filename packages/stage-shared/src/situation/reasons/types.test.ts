import type { ReasonCategory, ReasonKind, RitualKind, ThreadKind } from './types'

import { describe, expect, it } from 'vitest'

import {
  GATE_ELIGIBLE_EVENT_KINDS,
  LOGICAL_DAY_ROLLOVER_HOUR,
  LONG_SESSION_MIN_TIER,
  OWN_DAY_RECOVERY_HALF_LIFE_MS,
  OWN_DAY_SALIENCE,
  OWN_DAY_WEIGHT_MAX,
  REASON_TEXT,
  RITUAL_TUNING,
  SCREEN_SELECTION_WEIGHT,
  SELECTION_BETA,
  THREAD_CUE_MAX_CHARS,
  THREAD_MIN_RIPENESS,
  THREAD_SUMMARY_MAX_CHARS,
  THREAD_TUNING,
  THREADS_MAX,
} from './types'

describe('situation reason contracts and tuning', () => {
  it('provides frozen complete tables for each reason-source union', () => {
    const threadKinds = ['question', 'event', 'later', 'topic'] as const satisfies readonly ThreadKind[]
    const ritualKinds = ['greeting', 'sign-off', 'welcome-back'] as const satisfies readonly RitualKind[]
    const eventKinds = ['long-session', 'returned', 'notify'] as const
    const reasonCategories = ['open', 'continuation', 'ritual', 'due', 'double-text', 'urgent'] as const satisfies readonly ReasonCategory[]
    const reasonKinds = [
      'thread-question',
      'thread-event',
      'thread-later',
      'thread-topic',
      'ritual-greeting',
      'ritual-sign-off',
      'ritual-welcome-back',
      'own-day',
      'continuation',
      'double-text',
      'long-session',
      'returned',
      'notify',
    ] as const satisfies readonly ReasonKind[]

    expect(Object.keys(THREAD_TUNING).sort()).toEqual([...threadKinds].sort())
    expect(Object.keys(RITUAL_TUNING).sort()).toEqual([...ritualKinds].sort())
    expect(Object.keys(SCREEN_SELECTION_WEIGHT).sort()).toEqual([...eventKinds].sort())
    expect(Object.keys(REASON_TEXT).sort()).toEqual([
      'continuation',
      'double-text',
      'own-day',
      'ritual-greeting',
      'ritual-sign-off',
      'ritual-welcome-back',
    ])
    expect(reasonCategories).toHaveLength(6)
    expect(reasonKinds).toHaveLength(13)

    for (const table of [THREAD_TUNING, RITUAL_TUNING, SCREEN_SELECTION_WEIGHT, REASON_TEXT])
      expect(Object.isFrozen(table)).toBe(true)
    for (const value of Object.values(THREAD_TUNING))
      expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(THREAD_TUNING.event.minAgeMs)).toBe(true)
    for (const value of Object.values(RITUAL_TUNING))
      expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(GATE_ELIGIBLE_EVENT_KINDS)).toBe(true)
  })

  it('excludes event kinds that must never open a turn', () => {
    for (const kind of ['app-switch', 'switching-burst', 'wake', 'went-away', 'context'] as const)
      expect(GATE_ELIGIBLE_EVENT_KINDS.has(kind)).toBe(false)

    expect([...GATE_ELIGIBLE_EVENT_KINDS].sort()).toEqual(['long-session', 'notify', 'returned'])
  })

  it('pins the tuning values used by downstream reason collection', () => {
    expect(THREAD_TUNING).toMatchObject({
      question: { salience: 0.7, minAgeMs: 45 * 60_000, riseMs: 30 * 60_000, halfLifeMs: 4 * 60 * 60_000, selectionWeight: 1 },
      event: { salience: 0.85, minAgeMs: { defaultMs: 90 * 60_000, dueAtMsOffsetMs: 15 * 60_000 }, riseMs: 20 * 60_000, halfLifeMs: 6 * 60 * 60_000, selectionWeight: 1.2 },
      later: { salience: 0.8, minAgeMs: 'dueAtMs', riseMs: 10 * 60_000, halfLifeMs: 6 * 60 * 60_000, selectionWeight: 1.2 },
      topic: { salience: 0.5, minAgeMs: 2 * 60 * 60_000, riseMs: 60 * 60_000, halfLifeMs: 12 * 60 * 60_000, selectionWeight: 0.8 },
    })
    expect(RITUAL_TUNING).toMatchObject({
      'greeting': { ratePerHour: 12, windowMs: 45 * 60_000, startMinute: 300, endMinute: 900 },
      'sign-off': { ratePerHour: 1.5, windowMs: 3 * 60 * 60_000, startMinute: 1350, endMinute: 90 },
      'welcome-back': { ratePerHour: 6, windowMs: 20 * 60_000, startMinute: 0, endMinute: 1440 },
    })
    expect(SCREEN_SELECTION_WEIGHT).toEqual({ 'long-session': 0.15, 'returned': 0.25, 'notify': 0.4 })
    expect([OWN_DAY_SALIENCE, OWN_DAY_WEIGHT_MAX, OWN_DAY_RECOVERY_HALF_LIFE_MS]).toEqual([0.35, 0.6, 90 * 60_000])
    expect([LONG_SESSION_MIN_TIER, LOGICAL_DAY_ROLLOVER_HOUR, THREADS_MAX, THREAD_SUMMARY_MAX_CHARS, THREAD_CUE_MAX_CHARS, THREAD_MIN_RIPENESS, SELECTION_BETA])
      .toEqual([2, 4, 24, 160, 200, 0.15, 2])
  })
})
