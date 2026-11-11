import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { describe, expect, it } from 'vitest'

import { coreMetrics } from './core'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX, detectors } from './test-trace'

const bones = ['hips', 'leftHand', 'leftIndexProximal', 'leftMiddleProximal', 'leftRingProximal', 'leftLittleProximal'] as const satisfies readonly MotionTraceBone[]

describe('conditional finger coverage', () => {
  it('counts exactly half the fingers moving at wrist speed with an active wrist', () => {
    const p = prepareTrace(analyticTrace({ seconds: 20, bones, world: (b, t) => angleX(b === 'hips' ? 0 : (b === 'leftIndexProximal' || b === 'leftMiddleProximal' ? 2 : 1) * 0.1 * Math.sin(2 * Math.PI * t)) }))
    expect(coreMetrics(p, detectors(bones)).find(m => m.id === 'coverage.fingers')?.value).toBe(0.5)
  })

  it('reports completely frozen fingers independently of wrist eligibility', () => {
    const p = prepareTrace(analyticTrace({ seconds: 20, bones }))
    const m = coreMetrics(p, detectors(bones))
    expect(m.find(m => m.id === 'fingers.frozen')?.value).toBe(1)
    expect(m.find(m => m.id === 'coverage.fingers')?.status).toBe('skipped: hand-inactive')
  })
})
