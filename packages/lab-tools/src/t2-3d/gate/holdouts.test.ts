import type { MetricResult } from '../metrics'
import type { MeasuredReference } from './reference-measure'

import { expect, it } from 'vitest'

import { CORE } from '../metrics/bones'
import { median } from '../metrics/math'
import { result } from '../metrics/result'
import { detectors } from '../metrics/test-trace'
import { fitClass } from './reference-fit'

function measured(split: 'fit' | 'holdout', index: number, metric: MetricResult): MeasuredReference {
  return {
    entry: { file: `${split}-${index}.bvh`, dataset: 'analytic', class: 'idle', profile: 'cmu', subject: `${index}`, split, role: split === 'holdout' && metric.basis === 'episode' ? 'episode-only' : 'window' },
    clipSha256: `${split}-${index}`,
    seconds: 10,
    hasFingers: false,
    metrics: metric.basis === 'episode' ? [] : [metric],
    pools: { idle: [metric] },
  }
}

it('keeps 0 or 1 failed held-out units gated and reports 2 without changing any fitted bound or verdict', () => {
  for (const unit of ['clip', 'episode'] as const) {
    const id = unit === 'clip' ? 'chain.spine-chest.zeroLagCorr' : 'smooth.head.ldlj'
    const fitting = Array.from({ length: 10 }, (_, index) => {
      const values = Array.from({ length: 4 }, (_, t) => 10 + 4 * index + t)
      const metric = unit === 'clip'
        ? result(id, 'correlation', 'window', 0.2 + index * 0.02)
        : result(id, 'log-ratio', 'episode', median(values), 'ok', '', values.map((value, t) => ({ start: t, end: t + 1, value })))
      return measured('fit', index, metric)
    })
    const heldOut = (failures: number) => Array.from({ length: 3 }, (_, index) => {
      const value = index < failures ? unit === 'clip' ? 0.9999 : 200 : unit === 'clip' ? 0.3 : 30
      const metric = unit === 'clip'
        ? result(id, 'correlation', 'window', value)
        : result(id, 'log-ratio', 'episode', value, 'ok', '', Array.from({ length: 8 }, (_, t) => ({ start: t, end: t + 1, value })))
      return measured('holdout', index, metric)
    })
    const referenceBand = fitClass([...fitting, ...heldOut(0)], 'idle', detectors(CORE), null).metrics[id]
    for (const failures of [0, 1, 2]) {
      const actual = fitClass([...fitting, ...heldOut(failures)], 'idle', detectors(CORE), null)
      expect(actual.metrics[id].status, `${unit}: ${failures}`).toBe(failures < 2 ? 'GATED' : 'REPORT')
      expect(actual.metrics[id].detail, `${unit}: ${failures}`).toBe(failures < 2 ? referenceBand.detail : 'holdout-failures: 2')
      expect(actual.metrics[id].lo).toBe(referenceBand.lo)
      expect(actual.metrics[id].hi).toBe(referenceBand.hi)
      expect(actual.metrics[id].p5).toBe(referenceBand.p5)
      expect(actual.metrics[id].p50).toBe(referenceBand.p50)
      expect(actual.metrics[id].p95).toBe(referenceBand.p95)
      expect(actual.holdout.filter(h => h.failed.includes(id))).toHaveLength(failures)
      expect(actual.holdout).toHaveLength(3)
    }
  }
})
