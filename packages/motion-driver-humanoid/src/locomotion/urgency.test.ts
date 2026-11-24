import { describe, expect, it } from 'vitest'

import { STROLL_URGENCY, WALK_URGENCY } from '../types'
import { urgencySpeedShare } from './urgency'

describe('urgencySpeedShare', () => {
  it('keeps the former stroll and walk speeds bit for bit', () => {
    expect(urgencySpeedShare(STROLL_URGENCY)).toBe(0.6)
    expect(urgencySpeedShare(WALK_URGENCY)).toBe(1)
  })

  it('passes through the amble and hurry anchors and is linear between them', () => {
    expect(urgencySpeedShare(0)).toBe(0.4)
    expect(urgencySpeedShare(1)).toBeCloseTo(1.35, 12)
    expect(urgencySpeedShare(0.15)).toBeCloseTo(0.5, 12)
    expect(urgencySpeedShare(0.45)).toBeCloseTo(0.8, 12)
    expect(urgencySpeedShare(0.8)).toBeCloseTo(1.175, 12)
  })

  it('clamps an urgency outside [0, 1] and reads NaN as the walk', () => {
    expect(urgencySpeedShare(-1)).toBe(0.4)
    expect(urgencySpeedShare(Number.NEGATIVE_INFINITY)).toBe(0.4)
    expect(urgencySpeedShare(2)).toBeCloseTo(1.35, 12)
    expect(urgencySpeedShare(Number.POSITIVE_INFINITY)).toBeCloseTo(1.35, 12)
    expect(urgencySpeedShare(Number.NaN)).toBe(1)
  })
})
