import type { PerformanceEmotion } from './types'

import { describe, expect, it } from 'vitest'

import { acceptReaction, bandOf, createReactionState, defaultExpressionPerformanceSettings } from '.'

const settings = { ...defaultExpressionPerformanceSettings, intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0 } }

describe('reaction strength', () => {
  it('uses exact band boundaries', () => {
    expect([0, 0.499, 0.5, 0.799, 0.8, 1].map(n => bandOf(n, settings))).toEqual([null, 'slight', 'clear', 'clear', 'strong', 'strong'])
  })

  it('keeps jitter inside the nominal band, including open endpoints', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const nominal of [1e-9, 0.499999999, 0.5, 0.799999999, 0.8, 1]) {
        const { episode } = acceptReaction(createReactionState(seed), 'happy', nominal, 0, defaultExpressionPerformanceSettings)
        expect(episode?.band).toBe(bandOf(nominal, settings))
        expect(bandOf(episode!.intensity, settings)).toBe(episode?.band)
        expect(episode!.intensity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('habituates new episodes and reaches the floor', () => {
    let state = createReactionState(1)
    for (let n = 0; n < 10; n++) {
      const result = acceptReaction(state, 'happy', 0.9, n * 2, settings)
      expect(result.episode?.intensity).toBeCloseTo(0.9 * Math.max(0.35, 0.8 ** Math.min(n, 7)), 12)
      state = result.state
    }
  })

  it('excludes history at exactly 15 seconds', () => {
    const first = acceptReaction(createReactionState(1), 'happy', 0.9, 0, settings)
    expect(acceptReaction(first.state, 'happy', 0.9, 14.999, settings).episode?.intensity).toBeCloseTo(0.72)
    expect(acceptReaction(first.state, 'happy', 0.9, 15, settings).episode?.intensity).toBe(0.9)
  })

  it('clears history on different emotions, neutral, and zero', () => {
    const first = acceptReaction(createReactionState(1), 'happy', 0.9, 0, settings)
    for (const [emotion, nominal] of [['sad', 0.6], ['neutral', 0.6], ['happy', 0]] as const) {
      const middle = acceptReaction(first.state, emotion, nominal, 3, settings)
      expect(acceptReaction(middle.state, 'happy', 0.9, 6, settings).episode?.intensity).toBe(0.9)
    }
  })

  it('escalates with the same id, h and jitter draw without growing history', () => {
    const first = acceptReaction(createReactionState(123), 'happy', 0.5, 0, defaultExpressionPerformanceSettings)
    const second = acceptReaction(first.state, 'happy', 0.9, 1, defaultExpressionPerformanceSettings)
    expect(second.episode?.id).toBe(first.episode?.id)
    expect(second.episode?.escalation).toBe(true)
    expect(second.episode!.intensity).toBeGreaterThanOrEqual(first.episode!.intensity)
    expect(second.state.random).toBe(first.state.random)
    expect(second.state.starts).toEqual([0])
    expect(second.state.current?.h).toBe(first.state.current?.h)
    expect(second.state.current?.u).toBe(first.state.current?.u)
    expect(acceptReaction(second.state, 'happy', 0.9, 1.5, settings).episode).toBeNull()
    expect(acceptReaction(second.state, 'happy', 0.4, 1.5, settings).episode).toBeNull()
  })

  it('does not restart the escalation window', () => {
    const first = acceptReaction(createReactionState(1), 'happy', 0.5, 0, settings)
    const second = acceptReaction(first.state, 'happy', 0.9, 1, settings)
    const third = acceptReaction(second.state, 'happy', 0.9, 2, settings)
    expect(third.episode?.id).toBe('happy-2')
    expect(third.episode?.escalation).toBe(false)
    expect(third.episode?.intensity).toBeCloseTo(0.72)
  })

  it('replays identical seeded sequences across a JSON checkpoint', () => {
    let state = createReactionState(42)
    state = acceptReaction(state, 'happy', 0.5, 0, settings).state
    let restored = JSON.parse(JSON.stringify(state))
    let identical = acceptReaction(createReactionState(42), 'happy', 0.5, 0, settings).state
    for (const [emotion, nominal, at] of [['happy', 0.9, 1], ['happy', 0.6, 3], ['sad', 0.6, 4], ['happy', 0.9, 20]] as const) {
      const result = acceptReaction(state, emotion, nominal, at, defaultExpressionPerformanceSettings)
      const replay = acceptReaction(restored, emotion, nominal, at, defaultExpressionPerformanceSettings)
      const seeded = acceptReaction(identical, emotion, nominal, at, defaultExpressionPerformanceSettings)
      expect(replay).toEqual(result)
      expect(seeded).toEqual(result)
      state = result.state
      restored = replay.state
      identical = seeded.state
    }
  })

  it('clamps malformed doses and treats non-finite doses as clearing zero', () => {
    const first = acceptReaction(createReactionState(1), 'happy', 2, 0, settings)
    expect(first.episode?.nominal).toBe(1)
    for (const nominal of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = acceptReaction(first.state, 'happy', nominal, 3, settings)
      expect(result.episode).toBeNull()
      expect(result.state.starts).toEqual([])
    }
  })

  it('ignores unknown emotions and invalid or backwards timestamps without changing state', () => {
    const first = acceptReaction(createReactionState(1), 'happy', 0.6, 10, settings)
    for (const [emotion, at] of [['bogus', 11], ['happy', 9], ['happy', Number.NaN], ['happy', Number.POSITIVE_INFINITY]] as const) {
      expect(acceptReaction(first.state, emotion as PerformanceEmotion, 0.9, at, settings)).toEqual({ episode: null, state: first.state })
    }
  })

  it('accepts love, flustered, and sleepy and ignores malformed spellings of them', () => {
    for (const emotion of ['love', 'flustered', 'sleepy'] as const)
      expect(acceptReaction(createReactionState(1), emotion, 0.9, 0, settings).episode?.emotion).toBe(emotion)
    for (const emotion of ['lovey', 'Love', 'sleepy ']) {
      const state = createReactionState(1)
      expect(acceptReaction(state, emotion as PerformanceEmotion, 0.9, 0, settings)).toEqual({ episode: null, state })
    }
  })

  it('does not mutate the input checkpoint', () => {
    const state = createReactionState(1)
    const before = JSON.stringify(state)
    acceptReaction(state, 'happy', 0.9, 0, settings)
    expect(JSON.stringify(state)).toBe(before)
  })
})
