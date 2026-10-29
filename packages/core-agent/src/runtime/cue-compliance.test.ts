import { describe, expect, it } from 'vitest'

import { cueComplianceOutcome, cueComplianceRates } from './cue-compliance'

function counts(overrides: Partial<{ act: number, recovered: number, rejected: number, stripped: number, declined: boolean }> = {}) {
  return { act: 0, recovered: 0, rejected: 0, stripped: 0, declined: false, ...overrides }
}

describe('cueComplianceOutcome', () => {
  it('lets a stage rejection win over recovery and native cues', () => {
    expect(cueComplianceOutcome(counts({ act: 1, recovered: 1, rejected: 1 }))).toBe('rejected')
  })

  it('buckets recovered, parsed and none in that order', () => {
    expect(cueComplianceOutcome(counts({ act: 1, recovered: 1 }))).toBe('recovered')
    expect(cueComplianceOutcome(counts({ act: 1 }))).toBe('parsed')
    expect(cueComplianceOutcome(counts())).toBe('none')
  })

  it('counts a turn whose only cues the runtime stripped as rejected, below native and recovered cues', () => {
    expect(cueComplianceOutcome(counts({ stripped: 1 }))).toBe('rejected')
    expect(cueComplianceOutcome(counts({ act: 1, stripped: 2 }))).toBe('parsed')
    expect(cueComplianceOutcome(counts({ act: 1, recovered: 1, stripped: 2 }))).toBe('recovered')
  })
})

describe('cueComplianceRates', () => {
  it('excludes declined turns from every rate', () => {
    const rates = cueComplianceRates([
      counts({ declined: true, stripped: 1 }),
      counts({ act: 1 }),
      counts(),
    ], 50)

    expect(rates).toEqual({ turns: 2, declined: 1, parsed: 1, recovered: 0, rejected: 0, none: 1 })
  })

  it('counts only the newest records inside the window', () => {
    const records = [counts({ act: 1 }), counts({ act: 1 }), counts(), counts({ rejected: 1 })]

    expect(cueComplianceRates(records, 2)).toEqual({ turns: 2, declined: 0, parsed: 2, recovered: 0, rejected: 0, none: 0 })
    expect(cueComplianceRates(records, 10)).toEqual({ turns: 4, declined: 0, parsed: 2, recovered: 0, rejected: 1, none: 1 })
  })

  it('returns zero rates for no records', () => {
    expect(cueComplianceRates([], 50)).toEqual({ turns: 0, declined: 0, parsed: 0, recovered: 0, rejected: 0, none: 0 })
  })
})
