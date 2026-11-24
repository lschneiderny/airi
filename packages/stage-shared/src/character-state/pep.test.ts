import { describe, expect, it } from 'vitest'

import { DEFAULT_CHARACTER_PROFILE, normalizePep, pepOf } from '.'

describe('pep', () => {
  it('reads an absent pep as 0', () => {
    expect(pepOf(undefined)).toBe(0)
    expect(pepOf(DEFAULT_CHARACTER_PROFILE)).toBe(0)
    expect(pepOf({ ...DEFAULT_CHARACTER_PROFILE, pep: 0.6 })).toBe(0.6)
  })

  it('rounds and clamps a pep, and drops a calm one', () => {
    expect(normalizePep(0.30000000000000004)).toBe(0.3)
    expect(normalizePep(1.4)).toBe(1)
    expect(normalizePep(-0.2)).toBeUndefined()
    expect(normalizePep(0.004)).toBeUndefined()
    expect(normalizePep(0)).toBeUndefined()
  })
})
