import { describe, expect, it } from 'vitest'

import { sanitizeNaturalEmotionStrengths } from './emotion-strengths'

describe('sanitizeNaturalEmotionStrengths', () => {
  it('keeps finite strengths per model and clamps them to 0..2', () => {
    expect(sanitizeNaturalEmotionStrengths({ a: { happy: 1.5, sad: 3, angry: -1 }, b: { love: 0 } }))
      .toEqual({ a: { happy: 1.5, sad: 2, angry: 0 }, b: { love: 0 } })
  })

  it('drops entries that are not finite numbers and models left without entries', () => {
    expect(sanitizeNaturalEmotionStrengths({ a: { happy: 'x', sad: null, angry: Number.NaN }, b: [1], c: { love: 1 } }))
      .toEqual({ c: { love: 1 } })
  })

  it.each([['a string', 'not a record'], ['an array', []], ['null', null], ['a number', 1], ['undefined', undefined]])('reads %s as no strengths', (_name, stored) => {
    expect(sanitizeNaturalEmotionStrengths(stored)).toEqual({})
  })
})
