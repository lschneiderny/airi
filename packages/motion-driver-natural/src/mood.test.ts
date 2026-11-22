import type { ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { createHash } from 'node:crypto'

import { defaultExpressionPerformanceSettings as defaults } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { NaturalMood } from './mood'
import { NaturalMotion } from './natural-motion'

function episode(overrides: Partial<ReactionEpisode> = {}): ReactionEpisode {
  return { id: 'one', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'strong', escalation: false, ...overrides }
}

function dimensions(mood: NaturalMood) {
  return [mood.valence, mood.arousal, mood.tension]
}

describe('natural mood', () => {
  it('applies external doses once even after decay and intervening doses or episodes', () => {
    const mood = new NaturalMood()
    const dose = { id: 'touch-1', valence: 0.2, arousal: -0.1, tension: 0.3 }
    mood.addDose(dose)
    expect(dimensions(mood)).toEqual([0.2, -0.1, 0.3])
    mood.step(2)
    mood.addDose({ id: 'episode', valence: 0.3, arousal: 0.2, tension: 0 })
    mood.addDose({ id: 'touch-2', valence: 0.1, arousal: 0, tension: -0.1 })
    const before = dimensions(mood)
    mood.addDose(dose)
    mood.addDose({ ...dose, valence: 1 })
    expect(dimensions(mood)).toEqual(before)
  })

  it('clamps external doses like episodes and ignores nonfinite dimensions without consuming the id', () => {
    const mood = new NaturalMood()
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const dimension of ['valence', 'arousal', 'tension'] as const) {
        mood.addDose({ id: 'dose', valence: 0, arousal: 0, tension: 0, [dimension]: invalid })
        expect(dimensions(mood)).toEqual([0, 0, 0])
      }
    }
    mood.addDose({ id: 'dose', valence: 5, arousal: -5, tension: 5 })
    expect(dimensions(mood)).toEqual([1, -1, 1])
    mood.addDose({ id: 'opposite', valence: -5, arousal: 5, tension: -5 })
    expect(dimensions(mood)).toEqual([-1, 1, 0])
  })

  it('accepts external doses on the next grid step only while mood is enabled', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const dose = { id: 'touch', valence: 0.2, arousal: -0.1, tension: 0.3 }
    motion.setPerformanceSettings({ ...defaults, mood: false })
    motion.addMood(dose, 0)
    motion.advance(0.1)
    expect(motion.moodState).toEqual({ valence: 0, arousal: 0, tension: 0 })
    motion.setPerformanceSettings(defaults)
    motion.addMood(dose, 0.1)
    expect(motion.moodState.valence).toBe(0)
    motion.advance(0.2)
    expect(motion.moodState.valence).toBeGreaterThan(0)
    const before = motion.moodState
    motion.addMood(dose, 0.2)
    motion.advance(0.3)
    expect(motion.moodState.valence).toBeLessThan(before.valence)
  })

  it('keeps seeded ten-minute idle bit-identical to bypassed modulation', () => {
    const enabled = new NaturalMotion({ seed: 41 })
    const disabled = new NaturalMotion({ seed: 41 })
    disabled.setPerformanceSettings({ ...defaults, mood: false })
    const a = createHash('sha256')
    const b = createHash('sha256')
    for (let i = 0; i <= 600 * 120; i++) {
      a.update(JSON.stringify(enabled.advance(i / 120)))
      b.update(JSON.stringify(disabled.advance(i / 120)))
    }
    expect(a.digest('hex')).toBe(b.digest('hex'))
  })

  it('decays independently of step partition to 1e-12', () => {
    const a = new NaturalMood()
    const b = new NaturalMood()
    const dose = { id: 'angry', valence: -0.3, arousal: 0.3, tension: 0.3 }
    a.addDose(dose)
    b.addDose(dose)
    a.step(2)
    b.step(1)
    b.step(1)
    dimensions(a).forEach((value, i) => expect(Math.abs(value - dimensions(b)[i])).toBeLessThan(1e-12))
  })

  it('replaces the level with a seed, clamped, and ignores a nonfinite one', () => {
    const mood = new NaturalMood()
    mood.set({ valence: 0.2, arousal: -0.3, tension: 0.4 })
    expect(dimensions(mood)).toEqual([0.2, -0.3, 0.4])
    mood.set({ valence: 2, arousal: -2, tension: -1 })
    expect(dimensions(mood)).toEqual([1, -1, 0])
    mood.set({ valence: Number.NaN, arousal: 0, tension: 0 })
    expect(dimensions(mood)).toEqual([1, -1, 0])
  })

  it('seeds the level on the next grid step only while mood is enabled, and doses no episode itself', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.advance(0)
    motion.impulse(episode(), 0)
    motion.setMood({ valence: 0.5, arousal: 0.2, tension: 0.1 }, 0)
    expect(motion.moodState.valence).toBe(0)
    motion.advance(0.1)
    expect(motion.moodState.valence).toBeCloseTo(0.5, 2)
    expect(motion.moodState.valence).toBeLessThanOrEqual(0.5)
    const off = new NaturalMotion({ seed: 41 })
    off.setPerformanceSettings({ ...defaults, mood: false })
    off.advance(0)
    off.impulse(episode(), 0)
    off.setMood({ valence: 0.5, arousal: 0.2, tension: 0.1 }, 0)
    off.advance(0.1)
    expect(off.moodState).toEqual({ valence: 0, arousal: 0, tension: 0 })
    const episodeOnly = new NaturalMotion({ seed: 41 })
    episodeOnly.impulse(episode(), 0)
    episodeOnly.advance(1)
    expect(episodeOnly.moodState).toEqual({ valence: 0, arousal: 0, tension: 0 })
  })

  it('ignores invalid dt and releases zero taus', () => {
    const mood = new NaturalMood()
    mood.addDose({ id: 'angry', valence: -0.3, arousal: 0.3, tension: 0.3 })
    const before = dimensions(mood)
    for (const dt of [Number.NaN, -1, 0])
      mood.step(dt)
    expect(dimensions(mood)).toEqual(before)
    mood.setPerformanceSettings({ ...defaults.moodDynamics, valenceTau: 0, arousalTau: 0, tensionTau: 0 })
    mood.step(1)
    expect(dimensions(mood)).toEqual([0, 0, 0])
  })

  it('bypasses mood after doses and when toggled during decay', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const control = new NaturalMotion({ seed: 41 })
    control.setPerformanceSettings({ ...defaults, mood: false })
    const dose = { id: 'happy', valence: 0.25, arousal: 0.18, tension: 0 }
    motion.impulse(episode(), 0)
    control.impulse(episode(), 0)
    motion.addMood(dose, 0)
    control.addMood(dose, 0)
    // Already-modulated posture retains its history; disabling removes the additive mouth bias.
    motion.advance(2 / 120)
    control.advance(2 / 120)
    motion.setPerformanceSettings({ ...defaults, mood: false })
    for (let i = 4; i <= 120; i++)
      expect(motion.advance(i / 120).face.mouthForm).toBe(control.advance(i / 120).face.mouthForm)
    motion.setPerformanceSettings(defaults)
    expect(motion.advance(122 / 120).face.mouthForm).not.toBe(control.advance(122 / 120).face.mouthForm)
  })

  it('is identity with mood disabled even after doses', () => {
    const disabled = new NaturalMotion({ seed: 41 })
    const undosed = new NaturalMotion({ seed: 41 })
    disabled.setPerformanceSettings({ ...defaults, mood: false })
    disabled.impulse(episode(), 0)
    undosed.impulse(episode(), 0)
    disabled.addMood({ id: 'happy', valence: 0.25, arousal: 0.18, tension: 0 }, 0)
    for (let i = 0; i <= 120 * 20; i++)
      expect(disabled.advance(i / 120)).toEqual(undosed.advance(i / 120))
  })
})
