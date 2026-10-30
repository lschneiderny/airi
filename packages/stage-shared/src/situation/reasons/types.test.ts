import type { SituationEventKind } from '../types'
import type { ReasonKind, ReasonTextKey, RitualKind, ThreadKind } from './types'

import { describe, expect, it } from 'vitest'

import {
  GATE_ELIGIBLE_EVENT_KINDS,
  REASON_TEXT,
  RITUAL_TUNING,
  SCREEN_SELECTION_WEIGHT,
  THREAD_TUNING,
} from './types'

const threadKindKeys = {
  question: true,
  event: true,
  later: true,
  topic: true,
} satisfies Record<ThreadKind, true>

const ritualKindKeys = {
  'greeting': true,
  'sign-off': true,
  'welcome-back': true,
} satisfies Record<RitualKind, true>

const screenReasonKindKeys = {
  'long-session': true,
  'returned': true,
  'notify': true,
} satisfies Record<Extract<ReasonKind, 'long-session' | 'returned' | 'notify'>, true>

const reasonTextKeys = {
  'own-day': true,
  'continuation': true,
  'double-text': true,
  'ritual-greeting': true,
  'ritual-sign-off': true,
  'ritual-welcome-back': true,
} satisfies Record<ReasonTextKey, true>

describe('situation reason contracts and tuning', () => {
  it('provides frozen complete tables for each reason-source union', () => {
    expect(Object.keys(THREAD_TUNING).sort()).toEqual(Object.keys(threadKindKeys).sort())
    expect(Object.keys(RITUAL_TUNING).sort()).toEqual(Object.keys(ritualKindKeys).sort())
    expect(Object.keys(SCREEN_SELECTION_WEIGHT).sort()).toEqual(Object.keys(screenReasonKindKeys).sort())
    expect(Object.keys(REASON_TEXT).sort()).toEqual(Object.keys(reasonTextKeys).sort())

    for (const table of [THREAD_TUNING, RITUAL_TUNING, SCREEN_SELECTION_WEIGHT, REASON_TEXT])
      expect(Object.isFrozen(table)).toBe(true)
    for (const value of Object.values(THREAD_TUNING))
      expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(THREAD_TUNING.event.minAgeMs)).toBe(true)
    expect(Object.isFrozen(THREAD_TUNING.later.minAgeMs)).toBe(true)
    for (const value of Object.values(RITUAL_TUNING))
      expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(GATE_ELIGIBLE_EVENT_KINDS)).toBe(true)
  })

  it('excludes event kinds that must never open a turn', () => {
    const excludedKinds = ['app-switch', 'switching-burst', 'wake', 'went-away', 'context'] as const satisfies readonly SituationEventKind[]

    for (const kind of excludedKinds)
      expect(GATE_ELIGIBLE_EVENT_KINDS.has(kind)).toBe(false)
  })
})
