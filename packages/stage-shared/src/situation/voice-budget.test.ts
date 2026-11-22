import { describe, expect, it } from 'vitest'

import { FLOOR_MS, HOUR_MS, SAFETY_CAP_PER_HOUR } from './urge'
import { initialUrgeMemory, recordExternalSpeech, recordNoticeSpeech, voiceBudgetHold } from './urge-gate'

const T0 = 1_700_000_000_000

describe('shared voice budget', () => {
  it('shares the exact floor while charging only owner-result speech among external lines', () => {
    const widget = recordExternalSpeech(initialUrgeMemory, T0)
    expect(widget.fires).toEqual([])
    const notice = recordNoticeSpeech(initialUrgeMemory, T0)
    expect(notice.fires).toEqual([T0])
    expect(notice.unanswered).toBe(0)
    expect(voiceBudgetHold(notice, T0 + FLOOR_MS - 1)).toBe('floor')
    expect(voiceBudgetHold(notice, T0 + FLOOR_MS)).toBeNull()
  })

  it('counts ordinary attempts together with notices and expires entries at exactly one hour', () => {
    const attempts = { ...initialUrgeMemory, fires: Array.from<number>({ length: SAFETY_CAP_PER_HOUR - 1 }).fill(T0) }
    const notice = recordNoticeSpeech(attempts, T0)
    expect(voiceBudgetHold(notice, T0 + FLOOR_MS)).toBe('safety-cap')
    expect(voiceBudgetHold(notice, T0 + HOUR_MS - 1)).toBe('safety-cap')
    expect(voiceBudgetHold(notice, T0 + HOUR_MS)).toBeNull()
  })

  it('normalizes backwards time without a negative hold or future cap entry', () => {
    const future = { ...initialUrgeMemory, lastFireAtMs: T0 + 100, fires: [T0 + 100] }
    expect(voiceBudgetHold(future, T0)).toBe('floor')
    const spoken = recordNoticeSpeech(future, T0)
    expect(spoken.lastFireAtMs).toBe(T0)
    expect(spoken.fires).toEqual([T0, T0])
  })
})
