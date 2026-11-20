import { describe, expect, it } from 'vitest'

import { EMOTION_VALUES } from './emotion'
import { PERFORMANCE_EMOTIONS } from './types'

describe('emotion', () => {
  it('declares the performance emotions in order', () => {
    expect(EMOTION_VALUES).toEqual([...PERFORMANCE_EMOTIONS])
  })
})
