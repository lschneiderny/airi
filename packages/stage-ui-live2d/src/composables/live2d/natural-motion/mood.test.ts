import type { ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { createHash } from 'node:crypto'

import { defaultExpressionPerformanceSettings as defaults } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { Live2DNaturalMotion } from '../natural-motion'
import { NaturalMood } from './mood'

function episode(overrides: Partial<ReactionEpisode> = {}): ReactionEpisode {
  return { id: 'one', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'strong', escalation: false, ...overrides }
}

function dimensions(mood: NaturalMood) {
  return [mood.valence, mood.arousal, mood.tension]
}

describe('natural mood', () => {
  it('keeps seeded ten-minute idle bit-identical to bypassed modulation', () => {
    const enabled = new Live2DNaturalMotion({ seed: 41 })
    const disabled = new Live2DNaturalMotion({ seed: 41 })
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
    a.add(episode({ emotion: 'angry' }))
    b.add(episode({ emotion: 'angry' }))
    a.step(2)
    b.step(1)
    b.step(1)
    dimensions(a).forEach((value, i) => expect(Math.abs(value - dimensions(b)[i])).toBeLessThan(1e-12))
  })

  it('bounds fifty strong angry doses', () => {
    const mood = new NaturalMood()
    for (let i = 0; i < 50; i++) {
      mood.add(episode({ id: String(i), emotion: 'angry' }))
      expect(mood.valence).toBeGreaterThanOrEqual(-1)
      expect(mood.valence).toBeLessThanOrEqual(1)
      expect(mood.arousal).toBeGreaterThanOrEqual(-1)
      expect(mood.arousal).toBeLessThanOrEqual(1)
      expect(mood.tension).toBeGreaterThanOrEqual(0)
      expect(mood.tension).toBeLessThanOrEqual(1)
    }
    expect(dimensions(mood)).toEqual([-1, 1, 1])
  })

  it('adds only the escalation dose delta after decay and ignores duplicates and stale ids', () => {
    const mood = new NaturalMood()
    mood.add(episode({ band: 'clear', intensity: 0.6 }))
    mood.step(2)
    const before = mood.valence
    mood.add(episode({ escalation: true }))
    expect(mood.valence).toBeCloseTo(before + (0.4 * 0.9 - 0.25 * 0.6) * 0.7, 14)
    const after = dimensions(mood)
    mood.add(episode({ escalation: true }))
    mood.add(episode())
    mood.add(episode({ id: 'missing', escalation: true }))
    expect(dimensions(mood)).toEqual(after)
  })

  it('ignores NaN intensity and invalid dt and releases zero taus', () => {
    const mood = new NaturalMood()
    mood.add(episode({ intensity: Number.NaN }))
    expect(dimensions(mood)).toEqual([0, 0, 0])
    mood.add(episode({ emotion: 'angry' }))
    const before = dimensions(mood)
    for (const dt of [Number.NaN, -1, 0])
      mood.step(dt)
    expect(dimensions(mood)).toEqual(before)
    mood.setPerformanceSettings({ ...defaults.moodDynamics, valenceTau: 0, arousalTau: 0, tensionTau: 0 })
    mood.step(1)
    expect(dimensions(mood)).toEqual([0, 0, 0])
  })

  it('bypasses mood after episodes and when toggled during decay', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    control.setPerformanceSettings({ ...defaults, mood: false })
    motion.impulse(episode(), 0)
    control.impulse(episode(), 0)
    // Already-modulated posture retains its history; disabling removes the additive mouth bias.
    motion.advance(2 / 120)
    control.advance(2 / 120)
    motion.setPerformanceSettings({ ...defaults, mood: false })
    for (let i = 4; i <= 120; i++)
      expect(motion.advance(i / 120).face.mouthForm).toBe(control.advance(i / 120).face.mouthForm)
    motion.setPerformanceSettings(defaults)
    expect(motion.advance(122 / 120).face.mouthForm).not.toBe(control.advance(122 / 120).face.mouthForm)
  })

  it('is identity with mood disabled even after episodes', () => {
    const disabled = new Live2DNaturalMotion({ seed: 41 })
    const zeroDose = new Live2DNaturalMotion({ seed: 41 })
    disabled.setPerformanceSettings({ ...defaults, mood: false })
    zeroDose.setPerformanceSettings({ ...defaults, moodDynamics: { ...defaults.moodDynamics, strongGain: 0 } })
    disabled.impulse(episode(), 0)
    zeroDose.impulse(episode(), 0)
    for (let i = 0; i <= 120 * 20; i++)
      expect(disabled.advance(i / 120)).toEqual(zeroDose.advance(i / 120))
  })
})
