import { describe, expect, it } from 'vitest'

import { EMOTION_ACTION_NAME } from './actions'
import { Emotion, EMOTION_VALUES } from './emotions'
import { EMOTION_MORPHS, MORPH_CANDIDATES, VOWEL_SLOTS } from './morphs'

describe('mmd emotion/morph constants', () => {
  it('defines a morph state for every emotion', () => {
    for (const emotion of EMOTION_VALUES)
      expect(EMOTION_MORPHS[emotion]).toBeDefined()
  })

  it('defines an action name for every emotion', () => {
    for (const emotion of EMOTION_VALUES)
      expect(typeof EMOTION_ACTION_NAME[emotion]).toBe('string')
  })

  it('reuses the Happy, Awkward, and Neutral entries for love, flustered, and sleepy', () => {
    expect(EMOTION_MORPHS[Emotion.Love]).toEqual(EMOTION_MORPHS[Emotion.Happy])
    expect(EMOTION_MORPHS[Emotion.Flustered]).toEqual(EMOTION_MORPHS[Emotion.Awkward])
    expect(EMOTION_MORPHS[Emotion.Sleepy]).toEqual(EMOTION_MORPHS[Emotion.Neutral])
    expect(EMOTION_ACTION_NAME[Emotion.Love]).toBe(EMOTION_ACTION_NAME[Emotion.Happy])
    expect(EMOTION_ACTION_NAME[Emotion.Flustered]).toBe(EMOTION_ACTION_NAME[Emotion.Awkward])
    expect(EMOTION_ACTION_NAME[Emotion.Sleepy]).toBe(EMOTION_ACTION_NAME[Emotion.Neutral])
  })

  it('keeps emotion morph influence weights within [0, 1]', () => {
    for (const emotion of EMOTION_VALUES) {
      for (const influence of EMOTION_MORPHS[emotion].influences) {
        expect(influence.value).toBeGreaterThanOrEqual(0)
        expect(influence.value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('provides candidate names for every vowel slot', () => {
    for (const slot of VOWEL_SLOTS) {
      expect(MORPH_CANDIDATES[slot].length).toBeGreaterThan(0)
    }
  })

  it('lists the canonical あいうえお as the first vowel candidates', () => {
    expect(MORPH_CANDIDATES.vowelA[0]).toBe('あ')
    expect(MORPH_CANDIDATES.vowelI[0]).toBe('い')
    expect(MORPH_CANDIDATES.vowelU[0]).toBe('う')
    expect(MORPH_CANDIDATES.vowelE[0]).toBe('え')
    expect(MORPH_CANDIDATES.vowelO[0]).toBe('お')
  })
})
