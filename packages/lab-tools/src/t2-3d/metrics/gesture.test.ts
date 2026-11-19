import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { describe, expect, it } from 'vitest'

import { binomialTail, gestureMetrics } from './gesture'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX, detectors } from './test-trace'

const emphasis = Array.from({ length: 12 }, (_, i) => 1 + 2 * i)
const events: MotionTraceEvent[] = emphasis.map(t => ({ kind: 'emphasis', t, strength: 1, source: 'scenario' }))
const bones = ['hips', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand'] as const

describe('gesture alignment', () => {
  it('finds unlikely chance alignment for strokes exactly on the emphasis times', () => {
    const p = prepareTrace(analyticTrace({
      seconds: 25,
      bones,
      scenario: 'talk',
      speaking: () => 1,
      events,
      // Each sigmoid turn has a speed peak on its emphasis; amplitude clears 1 rad/s.
      world: (b, t) => angleX(b === 'hips' ? 0 : emphasis.reduce((s, e) => s + 0.3 * Math.tanh((t - e) / 0.12), 0)),
    }))
    const m = gestureMetrics(p, detectors(bones))
    expect(m.find(m => m.id === 'gesture.strokeP')?.value).toBeLessThan(0.01)
    expect(Math.abs(m.find(m => m.id === 'gesture.strokeLagMs')?.value ?? Infinity)).toBeLessThan(20)
    expect(m.find(m => m.id === 'gesture.strokesPerMin')?.value).toBe(24)
    expect(m.find(m => m.id === 'gesture.strokeGain')?.value).toBeGreaterThan(0.8)
    expect(m.find(m => m.id === 'gesture.headGain')?.value).toBeGreaterThan(0.8)
  })

  it('returns a stroke probability of one and undefined lag when arms never move', () => {
    const p = prepareTrace(analyticTrace({ seconds: 25, bones, scenario: 'talk', speaking: () => 1, events }))
    const m = gestureMetrics(p, detectors(bones))
    expect(m.find(m => m.id === 'gesture.strokeP')?.value).toBe(1)
    expect(m.find(m => m.id === 'gesture.strokeGain')?.value).toBe(0)
    expect(m.find(m => m.id === 'gesture.strokeLagMs')?.status).toBe('undefined: no-motion')
  })

  it('computes the binomial tail at small known probabilities and boundary cases', () => {
    expect(binomialTail(10, 10, 0.5)).toBeCloseTo(1 / 1024, 14)
    expect(binomialTail(10, 0, 0)).toBe(1)
    expect(binomialTail(10, 1, 0)).toBe(0)
    expect(binomialTail(10, 10, 1)).toBe(1)
  })
})
