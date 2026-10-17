import { describe, expect, it } from 'vitest'

import { Emotion, EMOTION_VALUES } from '../../../constants/emotions'
import { impulseEnvelope, NaturalImpulses } from './impulses'
import { createRandomStream } from './random'

const step = 1 / 120

function peakHead(impulses: NaturalImpulses, seconds = 4) {
  let peak = 0
  for (let i = 0; i <= seconds / step; i++)
    peak = Math.max(peak, Math.hypot(...impulses.headOffset(i * step)))
  return peak
}

describe('natural emotion impulses', () => {
  it('starts with zero slope and peaks at tau', () => {
    expect(impulseEnvelope(0, 0.3)).toBe(0)
    expect(impulseEnvelope(0.3, 0.3)).toBeCloseTo(1, 12)
    expect(impulseEnvelope(step, 0.25)).toBeLessThan(0.01)
  })

  it('keeps every head peak within 0.12 I^0.7 x 1.2', () => {
    for (const name of EMOTION_VALUES) {
      for (const intensity of [0.2, 0.6, 1]) {
        for (let seed = 1; seed <= 20; seed++) {
          const impulses = new NaturalImpulses(createRandomStream(seed))
          impulses.trigger(name, intensity, 0)
          expect(peakHead(impulses)).toBeLessThanOrEqual(0.12 * intensity ** 0.7 * 1.2)
        }
      }
    }
  })

  it('treats neutral as a no-op', () => {
    const impulses = new NaturalImpulses(createRandomStream(1))
    expect(impulses.trigger(Emotion.Neutral, 1, 0)).toBeNull()
    expect(peakHead(impulses)).toBe(0)
    expect(Object.values(impulses.hints(0.5)).every(value => value === 0)).toBe(true)
  })

  it('ignores the same emotion within 2 s but not other emotions', () => {
    const impulses = new NaturalImpulses(createRandomStream(2))
    expect(impulses.trigger(Emotion.Happy, 1, 0)).not.toBeNull()
    expect(impulses.trigger(Emotion.Happy, 1, 1.9)).toBeNull()
    expect(impulses.trigger(Emotion.Sad, 1, 1.9)).not.toBeNull()
    expect(impulses.trigger(Emotion.Happy, 1, 2)).not.toBeNull()
  })

  it('adds decaying face hints in the emotion direction', () => {
    const impulses = new NaturalImpulses(createRandomStream(3))
    impulses.trigger(Emotion.Happy, 1, 0)
    const early = impulses.hints(0.4)
    expect(early.eyeSmile).toBeGreaterThan(0.35)
    expect(early.mouthForm).toBeGreaterThan(0.35)
    expect(early.browY).toBeGreaterThan(0.2)
    // tau 1.5 s: about 13% remains after 3 s.
    expect(impulses.hints(3).eyeSmile).toBeLessThan(0.08)

    const surprised = new NaturalImpulses(createRandomStream(4))
    surprised.trigger(Emotion.Surprise, 1, 0)
    expect(surprised.hints(0.3).eyeOpen).toBeGreaterThan(0.1)
    expect(surprised.headOffset(0.4)[1]).toBeGreaterThan(0)
  })

  it('requests side glances for think and awkward', () => {
    const think = new NaturalImpulses(createRandomStream(5)).trigger(Emotion.Think, 1, 0)
    expect(Math.abs(think!.glance!.point.x)).toBeCloseTo(0.3, 12)
    expect(think!.glance!.point.y).toBeCloseTo(0.25, 12)
    expect(think!.glance!.hold).toBeGreaterThanOrEqual(1.2)
    expect(think!.glance!.hold).toBeLessThanOrEqual(2.5)
    const awkward = new NaturalImpulses(createRandomStream(6)).trigger(Emotion.Awkward, 1, 0)
    expect(awkward!.glance!.point.y).toBeCloseTo(-0.2, 12)
    expect(new NaturalImpulses(createRandomStream(7)).trigger(Emotion.Happy, 1, 0)!.glance).toBeNull()
  })
})
