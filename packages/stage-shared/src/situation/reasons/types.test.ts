import type { SituationEventKind } from '../types'

import { describe, expect, it } from 'vitest'

import {
  GATE_ELIGIBLE_EVENT_KINDS,
  REASON_TEXT,
  RITUAL_TUNING,
  SCREEN_SELECTION_WEIGHT,
  THREAD_TUNING,
} from './types'

describe('situation reason contracts and tuning', () => {
  it('freezes every reason-source table', () => {
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
