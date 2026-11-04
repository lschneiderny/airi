import { describe, expect, it } from 'vitest'

import { parseNaturalEmotionStrengths } from './emotion-strengths'

describe('parseNaturalEmotionStrengths', () => {
  it('keeps finite strengths per model and clamps them to 0..2', () => {
    expect(parseNaturalEmotionStrengths(JSON.stringify({ a: { happy: 1.5, sad: 3, angry: -1 }, b: { love: 0 } })))
      .toEqual({ a: { happy: 1.5, sad: 2, angry: 0 }, b: { love: 0 } })
  })

  it('drops entries that are not finite numbers and models left without entries', () => {
    expect(parseNaturalEmotionStrengths(JSON.stringify({ a: { happy: 'x', sad: null }, b: [1], c: { love: 1 } })))
      .toEqual({ c: { love: 1 } })
  })

  it.each(['not json', '[]', 'null', '1'])('reads %s as no strengths', (raw) => {
    expect(parseNaturalEmotionStrengths(raw)).toEqual({})
  })
})
