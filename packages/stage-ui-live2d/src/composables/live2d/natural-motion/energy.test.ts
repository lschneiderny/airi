import { describe, expect, it } from 'vitest'

import { NaturalPerformanceEnergy } from './energy'

const step = 1 / 120

function settle(energy: NaturalPerformanceEnergy, seconds: number) {
  for (let i = 0; i < Math.round(seconds / step); i++)
    energy.step(step)
}

function state(mode: 'idle' | 'watching' | 'listening' | 'thinking' | 'talking', extra: { attention?: 'camera' | 'screen' | 'cursor' | 'aside', away?: boolean } = {}) {
  return { mode, attention: extra.attention ?? 'camera', away: extra.away ?? false } as const
}

describe('natural performance energy', () => {
  it('updates watching immediately even while screen attention holds through a cue gap', () => {
    const energy = new NaturalPerformanceEnergy()
    expect(energy.watching).toBe(false)
    energy.setState(state('talking', { attention: 'screen' }), 0.5)
    energy.setState(state('watching'), 0.5)
    expect(energy.watching).toBe(true)
    expect(energy.screen).toBe(true)
    energy.setState(state('idle'), 0.5)
    expect(energy.watching).toBe(false)
    expect(energy.screen).toBe(true)
  })

  it('does not stack overlapping reactions', () => {
    const stacked = new NaturalPerformanceEnergy()
    const single = new NaturalPerformanceEnergy()
    stacked.react(0)
    stacked.react(0)
    single.react(0)
    settle(stacked, 1)
    settle(single, 1)
    expect(stacked.amplitudeScale).toBe(single.amplitudeScale)
    expect(stacked.shiftRateScale).toBe(single.shiftRateScale)
  })

  it('preserves desktop x1.3/x1.5 targets for two seconds', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.react(0)
    energy.step(1)
    expect(energy.amplitudeScale).toBeCloseTo(1.3 - 0.3 * Math.exp(-1), 12)
    expect(energy.shiftRateScale).toBeCloseTo(1.5 - 0.5 * Math.exp(-1), 12)
    energy.step(0.99)
    const amplitude = energy.amplitudeScale
    const rate = energy.shiftRateScale
    energy.step(0.02)
    expect(energy.amplitudeScale).toBeCloseTo(1 + (amplitude - 1) * Math.exp(-0.02), 12)
    expect(energy.shiftRateScale).toBeCloseTo(1 + (rate - 1) * Math.exp(-0.02), 12)
  })

  it('keeps idle at the default energy exactly neutral', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.setState(state('idle'), 0.5)
    settle(energy, 10)
    expect(energy.amplitudeScale).toBe(1)
    expect(energy.shiftRateScale).toBe(1)
    expect(energy.cameraFixationProbability).toBe(0.5)
    expect(energy.emphasisAcceptance).toBeCloseTo(0.25, 12)
  })

  it('settles on each preset', () => {
    const presets = { watching: [0.8, 0.7, 0.25], listening: [0.75, 0.6, 0.85], thinking: [1, 1.1, 0.3], talking: [1.15, 1.3, 0.65] } as const
    for (const [mode, [amplitude, shiftRate, camera]] of Object.entries(presets)) {
      const energy = new NaturalPerformanceEnergy()
      energy.setState(state(mode as keyof typeof presets), 0.5)
      settle(energy, 30)
      expect(energy.amplitudeScale).toBeCloseTo(amplitude, 6)
      expect(energy.shiftRateScale).toBeCloseTo(shiftRate, 6)
      expect(energy.cameraFixationProbability).toBeCloseTo(camera, 6)
    }
  })

  it('cross-fades with 0.7 s into talking, 1.5 s out of it, and 1 s otherwise', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.setState(state('talking'), 0.5)
    settle(energy, 0.7)
    // One time constant covers 1 - 1/e of the distance.
    expect(energy.amplitudeScale).toBeCloseTo(1 + 0.15 * (1 - Math.exp(-1)), 3)
    settle(energy, 30)
    energy.setState(state('idle'), 0.5)
    settle(energy, 1.5)
    expect(energy.amplitudeScale).toBeCloseTo(1 + 0.15 * Math.exp(-1), 3)
    settle(energy, 30)
    energy.setState(state('listening'), 0.5)
    settle(energy, 1)
    expect(energy.amplitudeScale).toBeCloseTo(1 - 0.25 * (1 - Math.exp(-1)), 3)
  })

  it('maps user energy onto amplitude, shift rate, and emphasis acceptance', () => {
    const calm = new NaturalPerformanceEnergy()
    const lively = new NaturalPerformanceEnergy()
    calm.setState(state('idle'), 0)
    lively.setState(state('idle'), 1)
    settle(calm, 30)
    settle(lively, 30)
    expect(calm.amplitudeScale).toBeCloseTo(0.7, 6)
    expect(calm.shiftRateScale).toBeCloseTo(0.6, 6)
    expect(calm.emphasisAcceptance).toBeCloseTo(0.15, 12)
    expect(lively.amplitudeScale).toBeCloseTo(1.3, 6)
    expect(lively.shiftRateScale).toBeCloseTo(1.4, 6)
    expect(lively.emphasisAcceptance).toBeCloseTo(0.35, 12)
  })

  it('applies the away and reacting overlays', () => {
    const away = new NaturalPerformanceEnergy()
    away.setState(state('idle', { away: true }), 0.5)
    settle(away, 30)
    expect(away.amplitudeScale).toBeCloseTo(0.7, 6)
    expect(away.shiftRateScale).toBeCloseTo(0.6, 6)

    const reacting = new NaturalPerformanceEnergy()
    reacting.react(0)
    settle(reacting, 1.9)
    expect(reacting.amplitudeScale).toBeGreaterThan(1.2)
    expect(reacting.shiftRateScale).toBeGreaterThan(1.3)
    settle(reacting, 15)
    expect(reacting.amplitudeScale).toBeCloseTo(1, 6)
  })

  it('selects state gaze targets', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.setState(state('watching', { attention: 'screen' }), 0.5)
    expect(energy.targetWeights).toEqual({ desk: 2, peripheral: 1, peripheralUp: 0 })
    energy.setState(state('thinking'), 0.5)
    expect(energy.targetWeights).toEqual({ desk: 1, peripheral: 1, peripheralUp: 1 })
    energy.setState(state('watching', { attention: 'cursor' }), 0.5)
    expect(energy.targetWeights).toEqual({ desk: 1, peripheral: 1, peripheralUp: 0 })
  })

  it('maps ACT cue attention while talking or thinking', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.setState(state('talking', { attention: 'screen' }), 0.5)
    expect(energy.targetWeights).toEqual({ desk: 2, peripheral: 1, peripheralUp: 0 })
    expect(energy.aside).toBe(false)
    energy.setState(state('talking', { attention: 'aside' }), 0.5)
    expect(energy.aside).toBe(true)
    expect(energy.targetWeights).toEqual({ desk: 1, peripheral: 1, peripheralUp: 0 })
    energy.setState(state('talking'), 0.5)
    expect(energy.aside).toBe(false)
  })

  it('holds an ACT screen cue through a short pause and releases it after 0.6 s', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.setState(state('talking', { attention: 'screen' }), 0.5)
    energy.setState(state('watching', { attention: 'cursor' }), 0.5)
    settle(energy, 0.5)
    // Repeated reports during the pause do not extend the hold.
    energy.setState(state('watching', { attention: 'cursor' }), 0.5)
    expect(energy.targetWeights).toEqual({ desk: 2, peripheral: 1, peripheralUp: 0 })
    settle(energy, 0.15)
    expect(energy.targetWeights).toEqual({ desk: 1, peripheral: 1, peripheralUp: 0 })
  })

  it('never holds attention through a pause without an ACT cue', () => {
    const energy = new NaturalPerformanceEnergy()
    energy.setState(state('watching', { attention: 'screen' }), 0.5)
    energy.setState(state('idle'), 0.5)
    expect(energy.targetWeights).toEqual({ desk: 1, peripheral: 1, peripheralUp: 0 })
    energy.setState(state('talking'), 0.5)
    energy.setState(state('watching', { attention: 'cursor' }), 0.5)
    expect(energy.aside).toBe(false)
    expect(energy.targetWeights).toEqual({ desk: 1, peripheral: 1, peripheralUp: 0 })
  })
})
