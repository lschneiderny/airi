import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { resolve } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it } from 'vitest'

import { CORE } from '../metrics/bones'
import { analyticTrace, angleX } from '../metrics/test-trace'
import { MotionTraceRefusal, parseTrace } from '../read-trace'
import { judgeTrace } from './judge'
import { loadBands } from './load'

const bands = await loadBands(resolve(import.meta.dirname, '../../../../..'))
const identity = { path: 'synthetic/trace.json', sha256: 'synthetic' }
const input = analyticTrace({
  seconds: 32,
  bones: CORE,
  position: t => [0.02 * Math.sin(2 * Math.PI * 0.4 * t), 0, 0.02 * Math.cos(2 * Math.PI * 0.4 * t)],
  world: (bone, t) => angleX((CORE.findIndex(name => name === bone) + 1) * 0.02 * Math.sin(2 * Math.PI * 0.4 * t)),
})
const trace: MotionTraceV1 = {
  ...input.trace,
  scoredFrom: 10,
  source: { ...input.trace.source, scenario: { id: 'idle', class: 'idle', seed: 1 } },
  rig: { ...input.trace.rig, id: 'qa-1', assetSha256: 'a'.repeat(64) },
  rot: encodeBlock(input.rot),
  root: encodeBlock(input.root),
  channels: encodeBlock(input.channels),
}
const baseline = judgeTrace(parseTrace(trace), bands, identity)
const failures = baseline.metrics.filter(metric => metric.status === 'FAIL')

describe('normalization scale admission', () => {
  it.each([1e-200, 1e-150, 1e-100, 1e100, 1e200])('preserves all baseline failures or refuses scale %s by name', (legLength) => {
    expect(failures.map(metric => metric.family)).toEqual(expect.arrayContaining(['period', 'chain']))
    let verdict
    try {
      verdict = judgeTrace(parseTrace({ ...trace, rig: { ...trace.rig, legLength } }), bands, identity)
    }
    catch (error) {
      expect(error).toBeInstanceOf(MotionTraceRefusal)
      expect(error).toMatchObject({ name: 'trace-nonfinite' })
      return
    }
    for (const failed of failures)
      expect(verdict.metrics.find(metric => metric.id === failed.id)?.status, failed.id).toBe('FAIL')
  })

  it('refuses the reviewer legLength=1e-200 probe on a recorded-style idle trace', () => {
    expect(baseline.metrics.find(metric => metric.id === 'period.rootForeAft.acfPeak')?.status).toBe('FAIL')
    expect(() => judgeTrace(parseTrace({ ...trace, rig: { ...trace.rig, legLength: 1e-200 } }), bands, identity))
      .toThrow(expect.objectContaining({ name: 'trace-nonfinite' }))
  })
})
