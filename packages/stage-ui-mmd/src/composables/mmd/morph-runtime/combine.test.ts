import type { MorphLayer } from './combine'

import { describe, expect, it } from 'vitest'

import { combineMorphChannels } from './combine'

describe('morph channel composition', () => {
  it.each<[MorphLayer, MorphLayer, 'vowel' | 'eye' | 'other']>([
    ['clip', 'naturalFace', 'other'],
    ['expression', 'clip', 'other'],
    ['blink', 'clip', 'eye'],
    ['lipSync', 'expression', 'vowel'],
    ['devtools', 'lipSync', 'vowel'],
    ['devtools', 'blink', 'eye'],
  ])('%s wins over %s', (upper, lower, role) => {
    expect(combineMorphChannels([
      { layer: upper, weight: 0.25 },
      { layer: lower, weight: 0.9 },
    ], { role, speakEnv: 1 })).toBe(0.25)
  })

  it('takes max within a layer and lerps by upper alpha across layers', () => {
    expect(combineMorphChannels([
      { layer: 'clip', weight: 0.8 },
      { layer: 'expression', weight: 0.2, alpha: 0.5 },
      { layer: 'expression', weight: 0.4, alpha: 0.5 },
    ])).toBeCloseTo(0.6)
  })

  it.each([0, 0.25, 1])('lerps expression vowels to lip sync at speech envelope %s', (speakEnv) => {
    expect(combineMorphChannels([
      { layer: 'expression', weight: 0.8 },
      { layer: 'lipSync', weight: 0.2 },
    ], { role: 'vowel', speakEnv })).toBeCloseTo(0.8 + (0.2 - 0.8) * speakEnv)
  })

  it('ducks other mouth expressions and ignores lip sync on non-mouth morphs', () => {
    expect(combineMorphChannels([{ layer: 'expression', weight: 1 }], { role: 'mouth', speakEnv: 1 })).toBeCloseTo(0.3)
    expect(combineMorphChannels([
      { layer: 'expression', weight: 0.7 },
      { layer: 'lipSync', weight: 1 },
    ])).toBe(0.7)
  })

  it('lets lip sync own custom PMX Lip-category vowels without a standard name', () => {
    expect(combineMorphChannels([
      { layer: 'expression', weight: 0.8 },
      { layer: 'lipSync', weight: 0.2 },
    ], { role: 'mouth', speakEnv: 0.5 })).toBeCloseTo(0.5)
  })

  it('honors lip sync priority when the caller omits an optional speech envelope', () => {
    expect(combineMorphChannels([
      { layer: 'expression', weight: 0.8 },
      { layer: 'lipSync', weight: 0.2 },
    ], { role: 'vowel' })).toBeCloseTo(0.2)
  })

  it('attenuates automatic blink by eye closure while preserving expression blink', () => {
    expect(combineMorphChannels([
      { layer: 'expression', weight: 0.2 },
      { layer: 'blink', weight: 1 },
    ], { role: 'eye', exprEyeClosure: 0.6 })).toBeCloseTo(0.4)
    expect(combineMorphChannels([
      { layer: 'expression', weight: 0.8 },
      { layer: 'blink', weight: 1 },
    ], { role: 'eye', exprEyeClosure: 0.6 })).toBe(0.8)
  })

  it('sums additive channels after composition and clamps the final result', () => {
    expect(combineMorphChannels([
      { layer: 'clip', weight: 0.7 },
      { layer: 'naturalFace', weight: 0.4, additive: true },
      { layer: 'naturalFace', weight: 0.3, additive: true },
    ])).toBe(1)
    expect(combineMorphChannels([{ layer: 'clip', weight: -1, additive: true }])).toBe(0)
  })
})
