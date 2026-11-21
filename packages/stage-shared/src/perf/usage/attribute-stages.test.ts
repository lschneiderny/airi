import type { BenchRunRecord } from './records'

import { describe, expect, it } from 'vitest'

import { attributeStages, compareBench, judgeDifference } from './index'

const offsets = [-0.1, -0.05, 0, 0.05, 0.1]

function runs(sha: string, centres: Record<string, number>, spread = offsets, t = 100): BenchRunRecord[] {
  return spread.map((offset, run) => ({
    v: 1,
    kind: 'bench-run',
    t,
    sessionId: `bench-${sha}-${run}`,
    matrix: 'bench-v1',
    scenario: 'mmd-idle',
    scenarioVersion: 1,
    run,
    sha,
    dirty: false,
    diffHash: null,
    modelFingerprint: 'fixture',
    host: { platform: 'linux', arch: 'x64', cpuModel: 'fixture', cores: 4, totalMemKb: 1_000_000, gpu: null },
    buildMode: 'dev',
    electronVersion: '1',
    valid: true,
    metrics: {
      fps: 60,
      p50FrameMs: 16,
      p95FrameMsApprox: 16 + (centres.body ?? 0) + offset,
      share21: 0,
      share36: 0,
      share100: 0,
      stageWindowCpuPct: 10,
      stageWindowCpuMsPerFrame: 1,
      gpuCpuPct: 0,
      browserCpuPct: 0,
      stageWindowWorkingSetKb: 100_000,
      stageSumMeanMs: null,
      recorderMs: 0,
    },
    stages: Object.fromEntries(Object.entries(centres).map(([id, centre]) => [id, { msPerFrame: centre + offset, p95MsApprox: centre + offset, n: 60 }])),
  }))
}

describe('stage attribution', () => {
  it.each(['regression', 'improvement'] as const)('ranks the largest signed movement first for %s', (direction) => {
    const sign = direction === 'regression' ? 1 : -1
    const result = attributeStages({
      runsA: runs('a', { smaller: 2, body: 2, opposite: 2 }),
      runsB: runs('b', { smaller: 2 + sign * 0.4, body: 2 + sign, opposite: 2 - sign }),
      history: [],
      direction,
    })

    expect(result.stages.map(stage => stage.id)).toEqual(['body', 'smaller'])
    expect(result.stages[0].deltaMsPerFrame).toBe(sign)
    expect(result.stages[0].z).toBeCloseTo(sign / (1.4826 * 0.05))
    expect(result.noStageMoved).toBe(false)
    expect(result.timed).toBe(true)
  })

  it('reports no movement for unchanged, sub-floor, and noise-sized stages', () => {
    const result = attributeStages({
      runsA: runs('a', { same: 2, tiny: 0.5, noisy: 2 }),
      runsB: runs('b', { same: 2, tiny: 0.51, noisy: 2.05 }),
      history: [],
      direction: 'regression',
    })

    expect(result).toEqual({ stages: [], timed: true, noStageMoved: true })
  })

  it.each(['a', 'b', 'both'])('reports timings unavailable when %s has no stages', (side) => {
    const withoutStages = (entries: BenchRunRecord[]) => entries.map(({ stages: _stages, ...entry }) => entry)
    const runsA = runs('a', { body: 2 })
    const runsB = runs('b', { body: 3 })
    const result = attributeStages({
      runsA: side === 'b' ? runsA : withoutStages(runsA),
      runsB: side === 'a' ? runsB : withoutStages(runsB),
      history: [],
      direction: 'regression',
    })

    expect(result).toEqual({ stages: [], timed: false, noStageMoved: true })
  })

  it('skips stages present on only one side and limits attribution to five', () => {
    const result = attributeStages({
      runsA: runs('a', { onlyA: 2, one: 2, two: 2, three: 2, four: 2, five: 2, six: 2 }),
      runsB: runs('b', { onlyB: 20, one: 3, two: 4, three: 5, four: 6, five: 7, six: 8 }),
      history: [],
      direction: 'regression',
    })

    expect(result.stages.map(stage => stage.id)).toEqual(['six', 'five', 'four', 'three', 'two'])
  })

  it.each(['regression', 'improvement'] as const)('ranks zero-noise stages first by size, with no z, for %s', (direction) => {
    const sign = direction === 'regression' ? 1 : -1
    const flat = (entries: BenchRunRecord[], centres: Record<string, number>) => entries.map(entry => ({
      ...entry,
      stages: { ...entry.stages, ...Object.fromEntries(Object.entries(centres).map(([id, centre]) => [id, { msPerFrame: centre, p95MsApprox: centre, n: 60 }])) },
    }))
    const result = attributeStages({
      runsA: flat(runs('a', { body: 2 }), { flat: 2, flatter: 2, tiny: 2, opposite: 2 }),
      runsB: flat(runs('b', { body: 2 + sign * 3 }), { flat: 2 + sign, flatter: 2 + sign * 0.5, tiny: 2 + sign * 0.01, opposite: 2 - sign }),
      history: [],
      direction,
    })

    expect(result.stages).toEqual([
      { id: 'flat', deltaMsPerFrame: sign, z: null, zeroNoise: true },
      { id: 'flatter', deltaMsPerFrame: sign * 0.5, z: null, zeroNoise: true },
      { id: 'body', deltaMsPerFrame: sign * 3, z: expect.closeTo(sign * 3 / (1.4826 * 0.05)), zeroNoise: false },
    ])
    expect(JSON.stringify(result)).toContain(`{"id":"flat","deltaMsPerFrame":${sign},"z":null,"zeroNoise":true}`)
  })

  it('pools residuals within each history commit rather than its shifted centre', () => {
    const result = attributeStages({
      runsA: runs('a', { body: 2 }),
      runsB: runs('b', { body: 3 }),
      history: Array.from({ length: 4 }, (_, index) => runs(`h${index}`, { body: 20 + index }, [-0.4, -0.2, 0, 0.2, 0.4], index)).flat(),
      direction: 'regression',
    })

    expect(result.stages[0].z).toBeCloseTo(1 / (1.4826 * 0.2))
  })

  it('uses pair-local noise when fewer than three history runs carry the stage', () => {
    const result = attributeStages({
      runsA: runs('a', { body: 2 }),
      runsB: runs('b', { body: 3 }),
      history: [...runs('h', { body: 20 }, [-10, 10], 0), ...runs('h', {}, [0], 0)],
      direction: 'regression',
    })

    expect(result.stages[0].z).toBeCloseTo(1 / (1.4826 * 0.05))
  })
})

describe('judgeDifference', () => {
  it.each([false, true])('reproduces every comparison field with pooled history %s', (pooled) => {
    const runsA = runs('a', { body: 2 })
    const runsB = runs('b', { body: 3 })
    const groups = Array.from({ length: pooled ? 10 : 2 }, (_, index) => runs(`h${index}`, { body: 20 + index }, offsets, index))
    const result = compareBench({ runsA, runsB, history: groups.flat(), metric: 'p95FrameMsApprox' })
    const judgment = judgeDifference({
      valuesA: runsA.map(run => run.metrics.p95FrameMsApprox),
      valuesB: runsB.map(run => run.metrics.p95FrameMsApprox),
      historyGroups: groups.map(group => group.map(run => run.metrics.p95FrameMsApprox)),
      floor: 0.5,
      higherIsWorse: true,
    })

    expect(result).toEqual({
      status: 'compared',
      metric: 'p95FrameMsApprox',
      groupA: { sha: 'a', diffHash: null, dirty: false },
      groupB: { sha: 'b', diffHash: null, dirty: false },
      valuesA: runsA.map(run => ({ run: run.run, t: run.t, value: run.metrics.p95FrameMsApprox })),
      valuesB: runsB.map(run => ({ run: run.run, t: run.t, value: run.metrics.p95FrameMsApprox })),
      ...judgment,
      stale: false,
    })
    expect(judgment.verdict).toBe('regression')
    expect(judgment.difference).toBe(1)
    expect(judgment.sigma).toBeCloseTo(1.4826 * 0.05)
  })
})
