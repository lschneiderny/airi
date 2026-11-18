import type { PerformanceEmotion } from './types'

import { describe, expect, it, vi } from 'vitest'

import { acceptReaction, bandOf, createReactionState, defaultExpressionPerformanceSettings, drawRandom } from '.'

const settings = { ...defaultExpressionPerformanceSettings, intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0 } }

/** The draw of the cases without jitter, where its value cannot show. */
const mid = () => 0.5

/** A Mulberry32 stream from `seed`, like the random source a caller owns. */
function seededDraw(seed: number): () => number {
  let checkpoint = seed >>> 0
  return () => {
    const { random, value } = drawRandom(checkpoint)
    checkpoint = random
    return value
  }
}

describe('reaction strength', () => {
  it('uses exact band boundaries', () => {
    expect([0, 0.499, 0.5, 0.799, 0.8, 1].map(n => bandOf(n, settings))).toEqual([null, 'slight', 'clear', 'clear', 'strong', 'strong'])
  })

  it('keeps jitter inside the nominal band, including open endpoints', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const nominal of [1e-9, 0.499999999, 0.5, 0.799999999, 0.8, 1]) {
        const { episode } = acceptReaction(createReactionState(), 'happy', nominal, 0, defaultExpressionPerformanceSettings, seededDraw(seed))
        expect(episode?.band).toBe(bandOf(nominal, settings))
        expect(bandOf(episode!.intensity, settings)).toBe(episode?.band)
        expect(episode!.intensity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('habituates new episodes and reaches the floor', () => {
    let state = createReactionState()
    for (let n = 0; n < 10; n++) {
      const result = acceptReaction(state, 'happy', 0.9, n * 2, settings, mid)
      expect(result.episode?.intensity).toBeCloseTo(0.9 * Math.max(0.35, 0.8 ** Math.min(n, 7)), 12)
      state = result.state
    }
  })

  it('excludes history at exactly 15 seconds', () => {
    const first = acceptReaction(createReactionState(), 'happy', 0.9, 0, settings, mid)
    expect(acceptReaction(first.state, 'happy', 0.9, 14.999, settings, mid).episode?.intensity).toBeCloseTo(0.72)
    expect(acceptReaction(first.state, 'happy', 0.9, 15, settings, mid).episode?.intensity).toBe(0.9)
  })

  it('clears history on different emotions, neutral, and zero', () => {
    const first = acceptReaction(createReactionState(), 'happy', 0.9, 0, settings, mid)
    for (const [emotion, nominal] of [['sad', 0.6], ['neutral', 0.6], ['happy', 0]] as const) {
      const middle = acceptReaction(first.state, emotion, nominal, 3, settings, mid)
      expect(acceptReaction(middle.state, 'happy', 0.9, 6, settings, mid).episode?.intensity).toBe(0.9)
    }
  })

  it('escalates with the same id, h and jitter draw without growing history or drawing again', () => {
    const draw = vi.fn(seededDraw(123))
    const first = acceptReaction(createReactionState(), 'happy', 0.5, 0, defaultExpressionPerformanceSettings, draw)
    expect(draw).toHaveBeenCalledTimes(1)
    const second = acceptReaction(first.state, 'happy', 0.9, 1, defaultExpressionPerformanceSettings, draw)
    expect(second.episode?.id).toBe(first.episode?.id)
    expect(second.episode?.escalation).toBe(true)
    expect(second.episode!.intensity).toBeGreaterThanOrEqual(first.episode!.intensity)
    expect(second.state.starts).toEqual([0])
    expect(second.state.current?.h).toBe(first.state.current?.h)
    expect(second.state.current?.u).toBe(first.state.current?.u)
    expect(acceptReaction(second.state, 'happy', 0.9, 1.5, settings, draw).episode).toBeNull()
    expect(acceptReaction(second.state, 'happy', 0.4, 1.5, settings, draw).episode).toBeNull()
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('does not restart the escalation window', () => {
    const first = acceptReaction(createReactionState(), 'happy', 0.5, 0, settings, mid)
    const second = acceptReaction(first.state, 'happy', 0.9, 1, settings, mid)
    const third = acceptReaction(second.state, 'happy', 0.9, 2, settings, mid)
    expect(third.episode?.id).toBe('happy-2')
    expect(third.episode?.escalation).toBe(false)
    expect(third.episode?.intensity).toBeCloseTo(0.72)
  })

  it('replays identical sequences across a JSON checkpoint when the draws are the same', () => {
    // The state holds no random source, so each run gets its own stream from the same seed.
    const draws = [seededDraw(42), seededDraw(42), seededDraw(42)] as const
    let state = acceptReaction(createReactionState(), 'happy', 0.5, 0, settings, draws[0]).state
    let restored = JSON.parse(JSON.stringify(acceptReaction(createReactionState(), 'happy', 0.5, 0, settings, draws[1]).state))
    let identical = acceptReaction(createReactionState(), 'happy', 0.5, 0, settings, draws[2]).state
    expect(restored).toEqual(state)
    for (const [emotion, nominal, at] of [['happy', 0.9, 1], ['happy', 0.6, 3], ['sad', 0.6, 4], ['happy', 0.9, 20]] as const) {
      const result = acceptReaction(state, emotion, nominal, at, defaultExpressionPerformanceSettings, draws[0])
      const replay = acceptReaction(restored, emotion, nominal, at, defaultExpressionPerformanceSettings, draws[1])
      const seeded = acceptReaction(identical, emotion, nominal, at, defaultExpressionPerformanceSettings, draws[2])
      expect(replay).toEqual(result)
      expect(seeded).toEqual(result)
      state = result.state
      restored = replay.state
      identical = seeded.state
    }
  })

  it('clamps malformed doses and treats non-finite doses as clearing zero', () => {
    const first = acceptReaction(createReactionState(), 'happy', 2, 0, settings, mid)
    expect(first.episode?.nominal).toBe(1)
    for (const nominal of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = acceptReaction(first.state, 'happy', nominal, 3, settings, mid)
      expect(result.episode).toBeNull()
      expect(result.state.starts).toEqual([])
    }
  })

  it('ignores unknown emotions and invalid or backwards timestamps without changing state or drawing', () => {
    const first = acceptReaction(createReactionState(), 'happy', 0.6, 10, settings, mid)
    const draw = vi.fn(mid)
    for (const [emotion, at] of [['bogus', 11], ['happy', 9], ['happy', Number.NaN], ['happy', Number.POSITIVE_INFINITY]] as const) {
      expect(acceptReaction(first.state, emotion as PerformanceEmotion, 0.9, at, settings, draw)).toEqual({ episode: null, state: first.state })
    }
    expect(draw).not.toHaveBeenCalled()
  })

  it('accepts love, flustered, and sleepy and ignores malformed spellings of them', () => {
    for (const emotion of ['love', 'flustered', 'sleepy'] as const)
      expect(acceptReaction(createReactionState(), emotion, 0.9, 0, settings, mid).episode?.emotion).toBe(emotion)
    for (const emotion of ['lovey', 'Love', 'sleepy ']) {
      const state = createReactionState()
      expect(acceptReaction(state, emotion as PerformanceEmotion, 0.9, 0, settings, mid)).toEqual({ episode: null, state })
    }
  })

  it('does not mutate the input checkpoint', () => {
    const state = createReactionState()
    const before = JSON.stringify(state)
    acceptReaction(state, 'happy', 0.9, 0, settings, mid)
    expect(JSON.stringify(state)).toBe(before)
  })
})
