import type { Band, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { EMOTION_VALUES } from '../../../constants/emotions'
import { headPulseOffset, impulseEnvelope, NaturalImpulses } from './impulses'
import { createRandomStream } from './random'

const step = 1 / 120
function episode(band: Band, intensity: number, id = 'happy', escalation = false): ReactionEpisode {
  return { id, emotion: 'happy', nominal: intensity, intensity, band, escalation }
}
function sample(band: Band, intensity: number) {
  const impulses = new NaturalImpulses(createRandomStream(41))
  const result = impulses.trigger(episode(band, intensity), 0)
  let head = 0
  let body = 0
  let face = 0
  let jump = 0
  let previous = [0, 0, 0]
  for (let i = 0; i <= 8 / step; i++) {
    const time = i * step
    const offset = impulses.headOffset(time)
    head = Math.max(head, Math.hypot(...offset))
    body = Math.max(body, Math.hypot(...impulses.bodyOffset(time)))
    face = Math.max(face, impulses.hints(time).eyeSmile)
    jump = Math.max(jump, ...offset.map((value, axis) => Math.abs(value - previous[axis])))
    previous = offset
  }
  return { head, body, face, jump, result }
}

describe('band-driven Natural episodes', () => {
  it('preserves random draws and face hints when gestures replace head and body pulses', () => {
    const normalRandom = createRandomStream(41)
    const gestureRandom = createRandomStream(41)
    const normal = new NaturalImpulses(normalRandom)
    const gesture = new NaturalImpulses(gestureRandom)

    normal.trigger(episode('strong', 0.9), 0)
    gesture.trigger(episode('strong', 0.9), 0, { head: false })

    expect(gestureRandom()).toBe(normalRandom())
    expect(gesture.hints(0.5)).toEqual(normal.hints(0.5))
    expect(gesture.headOffset(0.5)).toEqual([0, 0, 0])
    expect(gesture.bodyOffset(0.5)).toEqual([0, 0, 0])
    expect(Math.hypot(...normal.headOffset(0.5))).toBeGreaterThan(0)
    expect(Math.hypot(...normal.bodyOffset(0.5))).toBeGreaterThan(0)
  })

  it('isolates recruitment and keeps onset continuous', () => {
    const slight = sample('slight', 0.25)
    const clear = sample('clear', 0.6)
    const strong = sample('strong', 0.9)
    expect(slight.face).toBeGreaterThan(0)
    expect(slight.result?.glance).toBeNull()
    expect(clear.result?.glance?.hold).toBe(1.2)
    expect(Math.max(slight.jump, clear.jump, strong.jump)).toBeLessThan(0.02)
  })

  it('keeps every head peak within 0.12 I^0.7 x 1.2', () => {
    for (const emotion of EMOTION_VALUES) {
      for (const intensity of [0.2, 0.6, 1]) {
        for (let seed = 1; seed <= 20; seed++) {
          const impulses = new NaturalImpulses(createRandomStream(seed))
          impulses.trigger({ id: 'sweep', emotion, nominal: intensity, intensity, band: 'clear', escalation: false }, 0)
          let peak = 0
          for (let i = 0; i <= 4 / step; i++)
            peak = Math.max(peak, Math.hypot(...impulses.headOffset(i * step)))
          expect(peak).toBeLessThanOrEqual(0.12 * intensity ** 0.7 * 1.2)
        }
      }
    }
  })

  it('starts at zero slope and overshoots in the opposite direction', () => {
    expect(impulseEnvelope(0, 0.3)).toBe(0)
    expect(impulseEnvelope(0.3, 0.3)).toBeCloseTo(1, 12)
    expect(impulseEnvelope(step, 0.3)).toBeLessThan(0.01)
    const pulses = [{ start: 0, tau: 0.3, peak: [0, 1, 0] as [number, number, number], overshoot: 0.16 }]
    expect(headPulseOffset(pulses, 1.2)[1]).toBeLessThan(0)
    headPulseOffset(pulses, 4.6)
    expect(pulses).toHaveLength(0)
  })

  it('adds only missing escalation amplitude without a face discontinuity', () => {
    const escalated = new NaturalImpulses(createRandomStream(17))
    const fresh = new NaturalImpulses(createRandomStream(17))
    escalated.trigger(episode('clear', 0.6), 0)
    fresh.trigger(episode('strong', 0.9), 0)
    const before = escalated.hints(0.1)
    const headBefore = escalated.headOffset(0.1)
    escalated.trigger(episode('strong', 0.9, 'happy', true), 0.1)
    expect(escalated.hints(0.1)).toEqual(before)
    expect(escalated.headOffset(0.1)).toEqual(headBefore)
    let escalatedPeak = 0
    let freshPeak = 0
    for (let i = 0; i <= 6 / step; i++) {
      escalatedPeak = Math.max(escalatedPeak, Math.hypot(...escalated.headOffset(i * step)))
      freshPeak = Math.max(freshPeak, Math.hypot(...fresh.headOffset(i * step)))
    }
    expect(escalatedPeak).toBeLessThanOrEqual(freshPeak + 1e-6)
  })

  it('does not deduplicate new ids and ignores unknown or expired escalations and NaN', () => {
    const impulses = new NaturalImpulses(createRandomStream(1))
    expect(impulses.trigger(episode('clear', 0.6), 0)).not.toBeNull()
    expect(impulses.trigger(episode('clear', 0.6, 'next'), 0)).not.toBeNull()
    expect(impulses.trigger(episode('strong', 0.9, 'missing', true), 0)).toBeNull()
    expect(impulses.trigger(episode('strong', 0.9, 'happy', true), 16)).toBeNull()
    expect(impulses.trigger(episode('strong', Number.NaN), 17)).toBeNull()
  })

  it('snapshots settings in flight and treats all bands as clear when disabled', () => {
    const impulses = new NaturalImpulses(createRandomStream(5))
    const reference = new NaturalImpulses(createRandomStream(5))
    impulses.trigger(episode('clear', 0.6), 0)
    reference.trigger(episode('clear', 0.6), 0)
    impulses.setPerformanceSettings({ ...defaultExpressionPerformanceSettings.naturalBands, headGain: 0 }, false)
    expect(impulses.headOffset(0.38)).toEqual(reference.headOffset(0.38))
    expect(impulses.hints(0.5)).toEqual(reference.hints(0.5))
    const disabled = new NaturalImpulses(createRandomStream(5))
    disabled.setPerformanceSettings(defaultExpressionPerformanceSettings.naturalBands, false)
    disabled.trigger(episode('slight', 0.6), 0)
    expect(disabled.headOffset(0.38)).toEqual(reference.headOffset(0.38))
    expect(disabled.bodyOffset(0.38)).toEqual([0, 0, 0])
  })

  it('shapes the face for love, flustered, and sleepy', () => {
    const cases = [['love', 'eyeSmile', 1], ['flustered', 'eyeSmile', 1], ['sleepy', 'eyeOpen', -1]] as const
    for (const [emotion, hint, sign] of cases) {
      const impulses = new NaturalImpulses(createRandomStream(41))
      impulses.trigger({ ...episode('clear', 0.6), emotion }, 0)
      let extreme = 0
      for (let i = 0; i <= 8 / step; i++)
        extreme = Math.max(extreme, sign * impulses.hints(i * step)[hint])
      expect(extreme).toBeGreaterThan(0)
    }
  })
})
