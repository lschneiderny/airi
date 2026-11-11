import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { gateMotion3d } from '../cli/gate'
import { context, emotionInput, emotionTrace, encoded, happyAndPlaceboTrials, runnerTrace, withTraces } from './pool-fixture'

describe('emotion pool admission', () => {
  it('refuses three copied directories rather than multiplying insufficient evidence', async () => {
    const trace = emotionTrace(1)
    await withTraces([trace, trace, trace], async (dirs) => {
      expect(await gateMotion3d([dirs[0]], context)).toBe(2)
      const single = JSON.parse(await readFile(join(dirs[0], 'gate.json'), 'utf8'))
      expect(single).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'no-gated-metrics' } })
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs) {
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({
          verdict: 'REFUSED',
          refusal: { name: 'pool-duplicate' },
          metrics: [],
        })
      }
    })
  })

  it('refuses the reviewer relabelled copies with identical measured blocks', async () => {
    const trace = emotionTrace(1)
    const copies = [1, 2, 3].map(copy => ({
      ...trace,
      events: trace.events.map(event => event.kind === 'emotion' ? { ...event, trialId: `${event.trialId}-copy-${copy}` } : event),
    }))
    await withTraces(copies, async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs)
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-duplicate' }, metrics: [] })
    })
  })

  it.each(['rig.assetSha256', 'source.level', 'source.gitSha'])('refuses incompatible %s cohorts', async (field) => {
    const first = emotionTrace(1)
    const other = emotionTrace(2)
    switch (field) {
      case 'rig.assetSha256':
        first.rig.assetSha256 = 'a'.repeat(64)
        other.rig.assetSha256 = 'b'.repeat(64)
        break
      case 'source.level':
        other.source.level = 'rendered'
        break
      case 'source.gitSha':
        other.source.gitSha = 'different-revision'
        break
    }
    await withTraces([first, other], async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs)
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-mismatch' }, metrics: [] })
    })
  })

  it('refuses repeated trial ids even when the traces have different digests', async () => {
    await withTraces([emotionTrace(1), emotionTrace(2, 'seed-1')], async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs)
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-duplicate' }, metrics: [] })
    })
  })

  it('scores distinct seeds and records digest provenance and condition counts', async () => {
    await withTraces([emotionTrace(1), emotionTrace(2), emotionTrace(3)], async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(0)
      for (const dir of dirs) {
        const verdict = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))
        expect(verdict).toMatchObject({ verdict: 'PASS', pooledFrom: { trialCounts: { happy: 6, neutral: 3, placebo: 6 } } })
        expect(verdict.pooledFrom.traces).toEqual(dirs.map(directory => ({
          directory,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        })))
        expect(new Set(verdict.pooledFrom.traces.map((trace: { sha256: string }) => trace.sha256)).size).toBe(3)
        expect(new Set(verdict.pooledFrom.traces.map((trace: { fingerprint: string }) => trace.fingerprint)).size).toBe(3)
      }
    })
  })
})

describe('runner seed cohorts', () => {
  it.each([false, true])('scores different runner seed ids with matching structure, unknown first asset=%s', async (unknownFirst) => {
    const traces = [1, 2, 3].map(runnerTrace)
    if (unknownFirst)
      traces[0].rig.assetSha256 = null
    await withTraces(traces, async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(0)
      for (const dir of dirs) {
        const verdict = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))
        expect(verdict).toMatchObject({ verdict: 'PASS', pooledFrom: { trialCounts: { happy: 6, neutral: 3, placebo: 6 } } })
        expect(verdict.metrics).toContainEqual(expect.objectContaining({ id: 'emotion.minSeparationFromNeutral', status: 'PASS' }))
      }
    })
  })

  it.each(['asset hash', 'rest offset'])('refuses a runner seed pool with a different %s', async (field) => {
    const traces = [1, 2, 3].map(runnerTrace)
    if (field === 'asset hash')
      traces[2].rig.assetSha256 = 'b'.repeat(64)
    else
      traces[2].rig.restOffsets[0][0] += 0.01
    await withTraces(traces, async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs)
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-mismatch' }, metrics: [] })
    })
  })

  it.each(['restOffsets', 'legLength'])('checks rig structure even when display ids match: %s', async (field) => {
    const traces = [1, 2, 3].map(seed => emotionTrace(seed))
    if (field === 'restOffsets')
      traces[2].rig.restOffsets[0][0] += 0.01
    else
      traces[2].rig.legLength *= 2
    await withTraces(traces, async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs)
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-mismatch' }, metrics: [] })
    })
  })

  it('refuses conflicting known assets even when the first asset is null', async () => {
    const traces = [1, 2, 3].map(seed => emotionTrace(seed))
    traces[1].rig.assetSha256 = 'a'.repeat(64)
    traces[2].rig.assetSha256 = 'b'.repeat(64)
    await withTraces(traces, async (dirs) => {
      expect(await gateMotion3d(dirs, context)).toBe(2)
      for (const dir of dirs)
        expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-mismatch' }, metrics: [] })
    })
  })
})

describe('required gate metrics', () => {
  it.each([
    { ids: 'emotion.minSeparationFromNeutral', passed: true, code: 0 },
    { ids: 'emotion.minSeparationFromNeutral,emotion.armShare', passed: true, code: 0 },
    { ids: 'emotion.minSeparation', passed: false, code: 1 },
    { ids: 'onset.attackFraction', passed: false, code: 1 },
    { ids: 'emotion.medianSeparation', passed: false, code: 1 },
    { ids: 'gait.headLeadMs', passed: false, code: 1 },
  ])('requires PASS rather than skipped, reported or absent: $ids', async ({ ids, passed, code }) => {
    await withTraces([emotionTrace(1), emotionTrace(2), emotionTrace(3)], async (dirs) => {
      expect(await gateMotion3d([...dirs, '--require', ids], context)).toBe(code)
      for (const dir of dirs) {
        const verdict = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))
        expect(verdict).toMatchObject({ verdict: 'PASS', requirements: { metrics: ids.split(','), passed } })
      }
    })
  })

  it('fails a pool without a neutral condition on the separation from neutral', async () => {
    const traces = [1, 2, 3].map(seed => encoded(emotionInput(seed, { trials: happyAndPlaceboTrials })))
    await withTraces(traces, async (dirs) => {
      expect(await gateMotion3d([...dirs, '--require', 'emotion.minSeparationFromNeutral,emotion.armShare'], context)).toBe(1)
      for (const dir of dirs) {
        const verdict = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))
        expect(verdict).toMatchObject({ verdict: 'FAIL', pooledFrom: { trialCounts: { happy: 6, placebo: 6 } }, requirements: { passed: false } })
        expect(verdict.metrics).toContainEqual(expect.objectContaining({ id: 'emotion.minSeparationFromNeutral', status: 'FAIL', value: null, detail: 'no-neutral-condition' }))
        expect(verdict.metrics).toContainEqual(expect.objectContaining({ id: 'emotion.armShare', status: 'PASS' }))
      }
    })
  })

  it('rejects an unknown required metric as a usage error before writing verdicts', async () => {
    await withTraces([emotionTrace(1)], async (dirs) => {
      expect(await gateMotion3d([...dirs, '--require', 'unknown.metric'], context)).toBe(2)
      await expect(readFile(join(dirs[0], 'gate.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
