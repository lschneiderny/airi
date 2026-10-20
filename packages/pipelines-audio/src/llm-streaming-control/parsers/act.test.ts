import { describe, expect, it } from 'vitest'

import { normalizeActPayload } from '../payloads'
import { tokenAct } from './act'

describe('tokenAct', () => {
  const parser = tokenAct()

  it.each([
    '<|ACT happy|>',
    '<|ACT:happy|>',
    '<|ACT Happy strong|>',
    '<|ACT sad 0.3|>',
    '<|ACT love|>',
    '<|ACT sleepy slight|>',
    '<|ACT flustered strong|>',
  ])('matches bare and JSON ACT tokens: %s', (special) => {
    expect(parser.match(special)).toBe(true)
  })

  it.each([
    ['<|ACT happy|>', { emotion: { name: 'happy', intensity: 0.6 } }],
    ['<|ACT:happy|>', { emotion: { name: 'happy', intensity: 0.6 } }],
    ['<|ACT Happy strong|>', { emotion: { name: 'happy', intensity: 0.9 } }],
    ['<|ACT sad 0.3|>', { emotion: { name: 'sad', intensity: 0.3 } }],
    ['<|ACT:sad 0.3|>', { emotion: { name: 'sad', intensity: 0.3 } }],
    ['<|ACT love|>', { emotion: { name: 'love', intensity: 0.6 } }],
    ['<|ACT sleepy slight|>', { emotion: { name: 'sleepy', intensity: 0.25 } }],
    ['<|ACT flustered strong|>', { emotion: { name: 'flustered', intensity: 0.9 } }],
  ])('parses bare ACT emotion token %s into the normalized payload shape', (special, expected) => {
    const parsed = parser.parse(special)

    expect(parsed?.type).toBe('act')
    expect(normalizeActPayload(parsed?.payload ?? {})).toEqual(expected)
  })

  it.each([
    '<|ACT banana|>',
    '<|ACT |>',
    '<|ACT:|>',
    '<|ACT happy strong extra|>',
    '<|ACT ＨＡＰＰＹ|>',
    '<|ACT sad slightly|>',
    '<|ACT sad -1|>',
    '<|ACT sad 0.3.1|>',
    '<|ACT:{"emotion":"happy"}|>',
  ])('rejects invalid bare ACT token %s', (special) => {
    expect(parser.parse(special)).toBeUndefined()
  })
})
