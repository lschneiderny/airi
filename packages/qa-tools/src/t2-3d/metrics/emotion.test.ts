import type { EmotionTrial } from './emotion'

import { describe, expect, it } from 'vitest'

import { emotionMetrics, emotionTrials } from './emotion'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX } from './test-trace'

describe('pooled emotion postures', () => {
  it('includes every emotion versus placebo in the minimum separation', () => {
    const trials: EmotionTrial[] = [
      ...['a', 'b', 'copy'].flatMap((condition, c) => [-0.01, 0, 0.01].map(noise => ({ condition, placebo: false, t: 0, frames: [], posture: { head: [c === 0 ? 0.8 + noise : c === 1 ? -0.8 + noise : noise, 0, 0] as const, leftUpperArm: [c === 0 ? 1 : c === 1 ? -1 : 0, 0, 0] as const } }))),
      ...[-0.02, -0.01, 0, 0.01, 0.02].map(noise => ({ condition: 'placebo', placebo: true, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftUpperArm: [0, 0, 0] as const } })),
    ]
    const m = emotionMetrics(trials)
    expect(m.find(m => m.id === 'emotion.minSeparation')?.value).toBeCloseTo(0, 12)
    expect(m.find(m => m.id === 'emotion.medianSeparation')?.value).toBeGreaterThan(50)
    expect(m.find(m => m.id === 'emotion.armShare')?.value).toBeCloseTo(1 / 1.64, 10)
  })

  it('extracts a baseline-relative quaternion posture once for a labelled held trial', () => {
    const p = prepareTrace(analyticTrace({
      seconds: 8,
      bones: ['hips', 'head'],
      scenario: 'emotion',
      events: [{ kind: 'emotion', t: 2, emotion: 'a', band: 'clear', phase: 'pulse', trialId: 'a' }, { kind: 'emotion', t: 3, emotion: 'a', band: 'clear', phase: 'hold-start', trialId: 'a' }],
      world: (b, t) => angleX(b === 'head' && t > 2 ? 0.5 : 0),
    }))
    const trials = emotionTrials(p)
    expect(trials.length).toBe(1)
    expect(trials[0].posture.head?.[0]).toBeCloseTo(0.5, 6)
  })
})
