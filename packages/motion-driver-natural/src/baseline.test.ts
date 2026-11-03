import type { FaceBaseline } from './baseline'

import { defaultExpressionPerformanceSettings as defaults } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { faceBaselineTau, neutralFaceBaseline } from './baseline'
import { NaturalMotion } from './natural-motion'

const seed = 41

function run(motion: NaturalMotion, fromStep: number, toStep: number) {
  let frame = motion.advance(fromStep / 120)
  for (let i = fromStep + 1; i <= toStep; i++)
    frame = motion.advance(i / 120)
  return frame
}

function blinkCount(motion: NaturalMotion, fromStep: number, toStep: number) {
  let closed = false
  let count = 0
  for (let i = fromStep; i <= toStep; i++) {
    const shut = motion.advance(i / 120).blink.blinkFactor < 0.5
    if (shut && !closed)
      count++
    closed = shut
  }
  return count
}

const target: FaceBaseline = { mouthForm: 0.2, eyeOpen: 0.1, blinkRateOffset: 0.25, browAngle: 0.15 }

describe('external face baseline', () => {
  it.each([
    ['idle', (_: NaturalMotion) => {}],
    ['a held sad emotion', (motion: NaturalMotion) => motion.setHeldEmotion({ emotion: 'sad', strength: 1 }, 0)],
  ])('keeps 600 seeded steps deep-equal to no baseline when the baseline is zero during %s', (_, setup) => {
    const untouched = new NaturalMotion({ seed })
    const zero = new NaturalMotion({ seed })
    zero.setFaceBaseline(neutralFaceBaseline())
    setup(untouched)
    setup(zero)
    for (let i = 0; i <= 600; i++)
      expect(zero.advance(i / 120)).toEqual(untouched.advance(i / 120))
  })

  it('reaches its target within five filter time constants and moves each channel in its direction', () => {
    const neutral = new NaturalMotion({ seed })
    const shifted = new NaturalMotion({ seed })
    shifted.setFaceBaseline(target)
    const settled = Math.round(5 * faceBaselineTau * 120)
    const a = run(neutral, 0, settled)
    const b = run(shifted, 0, settled)
    const reached = 1 - Math.exp(-5)
    expect(b.face.mouthForm - a.face.mouthForm).toBeCloseTo(target.mouthForm * reached, 3)
    expect(b.face.mouthForm - a.face.mouthForm).toBeGreaterThan(0.99 * target.mouthForm)
    expect(b.face.eyeOpenMultiplier / a.face.eyeOpenMultiplier).toBeCloseTo(1 + target.eyeOpen * reached, 3)
    for (const key of ['browAngle', 'browLAngle', 'browRAngle'] as const)
      expect(b.face[key] - a.face[key]).toBeCloseTo(target.browAngle * reached, 3)
    // The sad held brow is positive, so a positive offset reads as worried.
    expect(b.face.browAngle).toBeGreaterThan(a.face.browAngle)
    expect(shifted.blinkIntervalScale).toBeCloseTo(1 / (1 + target.blinkRateOffset * reached), 4)
    expect(blinkCount(shifted, settled + 1, settled + 120 * 120)).toBeGreaterThan(blinkCount(neutral, settled + 1, settled + 120 * 120))
  })

  it('keeps the held-emotion blink modulation with a baseline set', () => {
    const neutral = new NaturalMotion({ seed })
    const shifted = new NaturalMotion({ seed })
    for (const motion of [neutral, shifted]) {
      motion.setPerformanceSettings({ ...defaults, heldEmotions: true })
      motion.setHeldEmotion({ emotion: 'sad', strength: 1 }, 0)
    }
    shifted.setFaceBaseline({ ...neutralFaceBaseline(), blinkRateOffset: 0.25 })
    run(neutral, 0, 120 * 120)
    run(shifted, 0, 120 * 120)
    // The held sad emotion lengthens blink intervals; the baseline divides that held scale.
    const held = neutral.blinkIntervalScale
    expect(held).toBeGreaterThan(1)
    expect(shifted.blinkIntervalScale).toBeCloseTo(held / 1.25, 9)
  })

  it.each([true, false])('changes the blink interval with held emotions set to %s', (heldEmotions) => {
    const neutral = new NaturalMotion({ seed })
    const shifted = new NaturalMotion({ seed })
    for (const motion of [neutral, shifted]) {
      motion.setPerformanceSettings({ ...defaults, heldEmotions })
      motion.setHeldEmotion({ emotion: 'sad', strength: 1 }, 0)
    }
    shifted.setFaceBaseline({ ...neutralFaceBaseline(), blinkRateOffset: -0.25 })
    run(neutral, 0, 120 * 120)
    run(shifted, 0, 120 * 120)
    const base = neutral.blinkIntervalScale
    if (heldEmotions)
      expect(base).toBeGreaterThan(1)
    else
      expect(base).toBe(1)
    expect(shifted.blinkIntervalScale).toBeCloseTo(base / 0.75, 9)
  })

  it('recomputes the blink interval scale each step instead of compounding it', () => {
    const motion = new NaturalMotion({ seed })
    motion.setPerformanceSettings({ ...defaults, heldEmotions: false })
    motion.setFaceBaseline({ ...neutralFaceBaseline(), blinkRateOffset: 0.25 })
    // Two minutes is 80 filter time constants, so the filtered offset has stopped changing.
    const start = 120 * 120
    run(motion, 0, start)
    run(motion, start + 1, start + 60)
    const after60 = motion.blinkIntervalScale
    run(motion, start + 61, start + 600)
    expect(motion.blinkIntervalScale).toBe(after60)
    expect(after60).toBeCloseTo(1 / 1.25, 12)
  })
})
