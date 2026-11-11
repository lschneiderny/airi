import type { MetricResult } from '../metrics'
import type { MeasuredReference } from './reference-measure'

import { describe, expect, it } from 'vitest'

import { prepareTrace } from '../metrics'
import { CORE } from '../metrics/bones'
import { analyticTrace, angleX, detectors } from '../metrics/test-trace'
import { fitDetectors } from './detectors'
import { fitClass } from './reference-fit'
import { measureReference, referenceInput } from './reference-measure'

function clip(index: number, split: 'fit' | 'holdout', value: number, role: 'window' | 'episode-only' = 'window'): MeasuredReference {
  const metric: MetricResult = { id: 'chain.spine-chest.zeroLagCorr', family: 'chain', value, unit: 'correlation', status: 'ok', detail: '', basis: 'window', samples: [] }
  return {
    entry: { file: `${index}.bvh`, dataset: 'analytic', class: 'idle', profile: 'cmu', subject: `subject-${index}`, split, role },
    clipSha256: `${index}`,
    seconds: 10,
    hasFingers: false,
    metrics: [metric],
    pools: {},
  }
}

describe('reference fitting integrity', () => {
  it('records a failed held-out clip without widening the fitted band or using episode-only activity', () => {
    const input = analyticTrace({ seconds: 12, bones: CORE, world: (b, t) => angleX(t * (CORE.findIndex(name => name === b) + 1) * 0.01) })
    const quantities = referenceInput(clip(0, 'fit', 0).entry, input).quantities
    const params = fitDetectors(Array.from<typeof quantities>({ length: 10 }).fill(quantities))
    const fitting = Array.from({ length: 10 }, (_, i) => clip(i, 'fit', 0.2 + i * 0.04))
    const actual = fitClass([...fitting, clip(10, 'fit', 0.9999, 'episode-only'), clip(11, 'holdout', 0.9999)], 'idle', params, null)
    expect(actual.metrics['chain.spine-chest.zeroLagCorr']).toMatchObject({ n: 10, status: 'GATED', basis: 'fitted', transform: 'fisher-z' })
    expect(actual.metrics['chain.spine-chest.zeroLagCorr'].hi).toBeLessThan(Math.atanh(0.9))
    expect(actual.holdout).toContainEqual(expect.objectContaining({ clipSha256: '11', verdict: 'FAIL', failed: ['chain.spine-chest.zeroLagCorr'] }))
  })

  it('fits activity floors and move speeds from per-clip values before measurement', () => {
    const p = prepareTrace(analyticTrace({ seconds: 12, bones: CORE, world: (b, t) => angleX(t * (CORE.findIndex(name => name === b) + 1) * 0.01) }))
    const q = referenceInput(clip(0, 'fit', 0).entry, p.input).quantities
    const params = fitDetectors([q])
    expect(params.floors.hips).toBeCloseTo((q.activity.hips ?? Infinity) * 0.5, 12)
    expect(params.moveSpeed.body).toBe(q.medianSpeed.body)
    expect(params.moveSpeed.head).toBe(q.medianSpeed.head)
    expect(params.floors.leftIndexProximal).toBeUndefined()
  })

  it('keeps strict declared loop limits and the lead separation threshold', () => {
    const params = { floors: {}, moveSpeed: { body: 1, head: 1, trunk: 1, armL: 1, armR: 1, legs: 1 } }
    const idle = fitClass([], 'idle', params, null)
    const emotion = fitClass([], 'emotion', params, 0.12)
    expect(idle.metrics['period.rootForeAft.loopPeak']).toMatchObject({ basis: 'declared', hi: 0.3, exclusiveHi: true, status: 'GATED' })
    expect(emotion.metrics['emotion.minSeparation']).toMatchObject({ basis: 'declared', lo: 2, status: 'GATED' })
    expect(emotion.metrics['emotion.armShare']).toMatchObject({ basis: 'declared', lo: 0.12, status: 'GATED' })
    expect(emotion.metrics['emotion.medianSeparation']).toMatchObject({ status: 'REPORT' })
  })

  it('recomputes pooled episodes with the detector scales of the class being judged', () => {
    const times = Array.from({ length: 10 }, (_, i) => 2 + 4 * i)
    const input = analyticTrace({ seconds: 42, bones: CORE, world: (bone, t) => angleX(bone === 'head' ? times.reduce((s, e) => s + 0.3 * Math.tanh((t - e) / 0.15), 0) : 0) })
    const params = detectors(CORE)
    const high = { ...params, moveSpeed: { body: 1000, head: 1000, trunk: 1000, armL: 1000, armR: 1000, legs: 1000 } }
    const c = referenceInput(clip(0, 'fit', 0).entry, input)
    const measured = measureReference(c, params, { idle: params, talk: high, shared: params })
    expect(measured.pools.idle?.find(m => m.id === 'smooth.head.ldlj')?.samples).toHaveLength(10)
    expect(measured.pools.talk?.find(m => m.id === 'smooth.head.ldlj')).toMatchObject({ value: null, status: 'undefined: no-motion', samples: [] })
  })
})
