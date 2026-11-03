import type { ClipBoneMask, ClipMaskGroup } from '../clip-mask'

import { describe, expect, it } from 'vitest'

import { CLIP_LABEL_PATTERN, DANCE_MIN_MS, deriveClipMeta, effectiveLayer, GESTURE_MAX_MS, slugLabel } from './index'

function maskOf(...on: ClipMaskGroup[]): ClipBoneMask {
  const groups: Record<ClipMaskGroup, boolean> = {
    root: false,
    leftLegIk: false,
    rightLegIk: false,
    lowerBody: false,
    leftArm: false,
    rightArm: false,
    leftFingers: false,
    rightFingers: false,
    upperBody: false,
    head: false,
  }
  for (const group of on)
    groups[group] = true
  return { animatedBones: on.length > 0 ? ['x'] : [], groups }
}

describe('deriveClipMeta', () => {
  it('derives an upper gesture from a short arm-only clip', () => {
    const meta = deriveClipMeta(maskOf('leftArm'), 2_000, 'wave')
    expect(meta).toMatchObject({ layer: 'upper', kind: 'gesture', loop: false, durationMs: 2_000, label: 'wave', notes: [] })
  })

  it('derives a full dance from a long root clip and never loops it', () => {
    const meta = deriveClipMeta(maskOf('root'), 45_000, 'dance')
    expect(meta).toMatchObject({ layer: 'full', kind: 'dance', loop: false })
  })

  it('derives a full action from a leg IK clip and keeps a gesture override on the upper layer', () => {
    const meta = deriveClipMeta(maskOf('leftLegIk'), 3_000, 'step')
    expect(meta).toMatchObject({ layer: 'full', kind: 'action' })
    expect(effectiveLayer(meta, 'gesture')).toBe('upper')
    expect(effectiveLayer(meta, null)).toBe('full')
    expect(effectiveLayer(meta, 'dance')).toBe('full')
  })

  it('derives a full action from a lowerBody-only clip', () => {
    expect(deriveClipMeta(maskOf('lowerBody'), 2_000, 'kick')).toMatchObject({ layer: 'full', kind: 'action' })
  })

  it('marks a clip with no animated group or a bad duration unusable', () => {
    expect(deriveClipMeta(maskOf(), 2_000, 'empty')).toMatchObject({ layer: 'none', kind: 'unusable', notes: ['no-animated-bones'] })
    expect(deriveClipMeta(maskOf('leftArm'), Number.NaN, 'nan')).toMatchObject({ layer: 'none', kind: 'unusable', notes: ['bad-duration'] })
    expect(deriveClipMeta(maskOf('leftArm'), 0, 'zero')).toMatchObject({ kind: 'unusable', notes: ['bad-duration'] })
    expect(deriveClipMeta(maskOf('leftArm'), Number.POSITIVE_INFINITY, 'inf')).toMatchObject({ kind: 'unusable' })
  })

  it('derives a looping stance from a stance name and gives a non-ascii name no label', () => {
    const meta = deriveClipMeta(maskOf('leftArm', 'upperBody'), 4_000, '待機ループ')
    expect(meta).toMatchObject({ layer: 'upper', kind: 'stance', loop: true, label: null })
    expect(meta.notes).toEqual(['stance-name', 'non-ascii-name'])
    expect(deriveClipMeta(maskOf('root'), 4_000, 'idle').layer).toBe('full')
  })

  it('switches at the documented duration boundaries and applies the loop-name heuristic', () => {
    expect(deriveClipMeta(maskOf('leftArm'), GESTURE_MAX_MS, 'a').kind).toBe('gesture')
    const longArm = deriveClipMeta(maskOf('leftArm'), GESTURE_MAX_MS + 1, 'arm_loop')
    expect(longArm).toMatchObject({ layer: 'upper', kind: 'action', loop: true })
    expect(longArm.notes).toContain('loop-name')
    expect(deriveClipMeta(maskOf('root'), DANCE_MIN_MS - 1, 'a').kind).toBe('action')
    expect(deriveClipMeta(maskOf('root'), DANCE_MIN_MS, 'a').kind).toBe('dance')
  })
})

describe('slugLabel', () => {
  it('slugs a name into a valid label', () => {
    expect(slugLabel('Wave Hello!!')).toBe('wave-hello')
    expect(slugLabel('a'.repeat(40))).toBe('a'.repeat(32))
    expect(slugLabel('ＷＡＶＥ')).toBe('wave')
  })

  it('returns null when nothing ascii survives and every label matches the pattern', () => {
    expect(slugLabel('待機')).toBeNull()
    expect(slugLabel('---')).toBeNull()
    for (const name of ['Wave Hello!!', '__x__', 'Dance 01', 'a'.repeat(50)])
      expect(CLIP_LABEL_PATTERN.test(slugLabel(name)!)).toBe(true)
  })
})
