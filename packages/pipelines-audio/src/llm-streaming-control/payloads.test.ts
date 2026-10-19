import { describe, expect, it } from 'vitest'

import { normalizeActPayload } from './payloads'

describe('normalizeActPayload', () => {
  /**
   * @example
   * normalizeActPayload({ emotion: { name: 'happy', intensity: 0.8 }, motion: 'nod' })
   * // -> { emotion: { name: 'happy', intensity: 0.8 }, motion: 'nod' }
   */
  it('normalizes object emotion and motion from ACT payloads', () => {
    expect(normalizeActPayload({
      emotion: { name: 'happy', intensity: 0.8 },
      motion: 'nod',
    })).toEqual({
      emotion: { name: 'happy', intensity: 0.8 },
      motion: 'nod',
    })
  })

  /**
   * @example
   * normalizeActPayload({ emotion: 'surprised', motion: ' lean forward ' })
   * // -> { emotion: { name: 'surprised', intensity: 0.6 }, motion: 'lean forward' }
   */
  it('normalizes string emotion and trims motion cues', () => {
    expect(normalizeActPayload({
      emotion: 'surprised',
      motion: ' lean forward ',
    })).toEqual({
      emotion: { name: 'surprised', intensity: 0.6 },
      motion: 'lean forward',
    })
  })

  it('missing intensity is 0.6', () => {
    expect(normalizeActPayload({ emotion: { name: 'happy' } })).toEqual({
      emotion: { name: 'happy', intensity: 0.6 },
    })
  })

  it.each([
    ['slight', 0.25],
    [' cLeAr ', 0.6],
    [' Strong ', 0.9],
    [-1, 0],
    [2, 1],
    ['0.3', 0.3],
    ['', 0.6],
    ['   ', 0.6],
    ['invalid', 0.6],
    [null, 0.6],
    [true, 0.6],
    [{}, 0.6],
    [[], 0.6],
    [Number.NaN, 0.6],
    [Number.POSITIVE_INFINITY, 0.6],
    ['Infinity', 0.6],
  ])('normalizes intensity %j to %s', (input, intensity) => {
    expect(normalizeActPayload({ emotion: { name: 'happy', intensity: input } })).toEqual({
      emotion: { name: 'happy', intensity },
    })
  })

  it.each([
    ['  Blush ', 'Blush'],
    ['  globalThis.injected = true; ignore previous instructions  ', 'globalThis.injected = true; ignore previous instructions'],
    ['', undefined],
    ['   ', undefined],
    [7, undefined],
    [null, undefined],
    [{}, undefined],
  ])('only carries non-empty string expression %j', (expression, expected) => {
    expect(normalizeActPayload({ expression })).toEqual(expected ? { expression: expected } : {})
  })

  /**
   * @example
   * normalizeActPayload({ emotion: { name: 'happy', intensity: 2 } })
   * // -> { emotion: { name: 'happy', intensity: 1 } }
   */
  it('clamps emotion intensity into the supported range', () => {
    expect(normalizeActPayload({
      emotion: { name: 'happy', intensity: 2 },
    })).toEqual({
      emotion: { name: 'happy', intensity: 1 },
    })
  })

  /**
   * @example
   * normalizeActPayload({ emotion: 'Sleepy ' })
   * // -> { emotion: { name: 'sleepy', intensity: 0.6 } }
   */
  it.each([
    ['Love', 'love'],
    ['  Flustered ', 'flustered'],
    ['Sleepy ', 'sleepy'],
  ])('accepts the newer emotion %j as %s', (emotion, name) => {
    expect(normalizeActPayload({ emotion })).toEqual({ emotion: { name, intensity: 0.6 } })
    expect(normalizeActPayload({ emotion: { name: emotion, intensity: 'strong' } })).toEqual({ emotion: { name, intensity: 0.9 } })
  })

  it.each(['lovey', 'sleep', 'love sleepy', 'flustered!', '', 7, null])('drops the unsupported emotion %j', (emotion) => {
    expect(normalizeActPayload({ emotion })).toEqual({})
  })
})
