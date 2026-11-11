import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { measureTrace } from '../metrics'
import { CORE } from '../metrics/bones'
import { conjugate, multiply } from '../metrics/math'
import { analyticTrace, angleX, angleY, detectors } from '../metrics/test-trace'
import { readManifest } from '../reference/manifest'
import { motionQualityGate } from './definition'
import { heldoutFailureUnits, HOLDOUT_VALIDATION } from './holdouts'
import { judgeTrace } from './judge'
import { loadBands, parseBands } from './load'
import { buildReference } from './reference'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const bands = parseBands(JSON.parse(await readFile(resolve(repoRoot, motionQualityGate.bandsFile), 'utf8')))
const identity = { path: 'analytic/trace.json', sha256: 'analytic' }

function sine() {
  return analyticTrace({ seconds: 90, bones: CORE, world: (b, t) => angleX((1 + CORE.findIndex(name => name === b)) * 0.02 * Math.sin(2 * Math.PI * 0.4 * t)) })
}

function richMotion(hz = 60, noise = false): DecodedMotionTrace {
  let seed = 20261111
  const uniform = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed + 0.5) / 4294967296
  }
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const i = CORE.findIndex(b => b === bone) + 1
    const angle = 0.2 * Math.sin(t * (1.3 + i * 0.17)) + 0.1 * Math.cos(t * (0.7 + i * 0.11))
    const gaussian = noise ? Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()) * 0.2 * Math.PI / 180 : 0
    return angleX(angle + gaussian)
  }
  return analyticTrace({ seconds: 22, hz, bones: CORE, world })
}

describe('gate validity with committed bands', () => {
  it('enforces the approved held-out rule on frozen human bands and optionally re-ingested clips', async () => {
    const committed = await loadBands(repoRoot)
    expect(committed.fixture).toBe(false)
    expect(Object.values(committed.classes).flatMap(c => c.holdout)).not.toHaveLength(0)
    for (const [scenario, c] of Object.entries(committed.classes)) {
      for (const [id, band] of Object.entries(c.metrics)) {
        const failures = heldoutFailureUnits(c, id).length
        if (band.status === 'GATED')
          expect(failures, `${scenario} ${id}`).toBeLessThan(HOLDOUT_VALIDATION.reportAtFailures)
        if (band.basis === 'fitted' && failures >= HOLDOUT_VALIDATION.reportAtFailures) {
          expect(band.status, `${scenario} ${id}`).toBe('REPORT')
          expect(band.detail).toBe(`holdout-failures: ${failures}`)
        }
      }
    }
    expect(motionQualityGate.gatedMetrics).toEqual(Object.fromEntries(Object.entries(committed.classes).map(([scenario, c]) => [
      scenario,
      Object.fromEntries(Object.entries(c.metrics).filter(([, band]) => band.status === 'GATED').map(([id, band]) => [id, band.side])),
    ])))
    const directory = process.env.AIRI_QA_MOCAP_DIR
    if (directory) {
      const manifest = await readManifest(resolve(directory, 'clips.json'))
      const rebuilt = await buildReference({ directory, manifest, gitSha: committed.tool.gitSha, signal: new AbortController().signal })
      expect(rebuilt.classes).toEqual(committed.classes)
    }
  }, 300000)

  it('fails the in-phase sine in both chain and dimensionality families', () => {
    const verdict = judgeTrace(sine(), bands, identity)
    expect(verdict.verdict).toBe('FAIL')
    expect(verdict.metrics.filter(m => m.status === 'FAIL').map(m => m.family)).toEqual(expect.arrayContaining(['chain', 'dim']))
    const chain = verdict.metrics.filter(m => m.id.endsWith('zeroLagCorr'))
    expect(chain.every(m => (m.value ?? 0) >= 0.999)).toBe(true)
    expect(verdict.metrics.find(m => m.id === 'dim.upper')?.value).toBeLessThanOrEqual(1.05)
    expect(verdict.metrics.find(m => m.id === 'spectral.head.peakShare')?.value).toBeGreaterThanOrEqual(0.95)
  }, 30000)

  it('fails a frozen trace in coverage and intermittency', () => {
    const verdict = judgeTrace(analyticTrace({ seconds: 90, bones: CORE }), bands, identity)
    expect(verdict.verdict).toBe('FAIL')
    expect(verdict.metrics.filter(m => m.status === 'FAIL').map(m => m.family)).toEqual(expect.arrayContaining(['coverage', 'inter']))
    expect(verdict.metrics.find(m => m.id === 'coverage.core')?.value).toBe(0)
  }, 30000)

  it('produces identical serialized verdicts for repeated judging', () => {
    const input = richMotion()
    expect(JSON.stringify(judgeTrace(input, bands, identity))).toBe(JSON.stringify(judgeTrace(input, bands, identity)))
  })

  it('keeps gated chain dimensionality and intermittency statuses under 0.2 degree Gaussian noise', () => {
    const clean = judgeTrace(richMotion(), bands, identity)
    const noisy = judgeTrace(richMotion(60, true), bands, identity)
    const statuses = (v: typeof clean) => v.metrics.filter(m => m.band?.status === 'GATED' && ['chain', 'dim', 'inter'].includes(m.family)).map(m => [m.id, m.status])
    expect(statuses(noisy)).toEqual(statuses(clean))
  })

  it('preserves velocity metrics under a 35 degree rest-pose change', () => {
    const params = detectors(CORE)
    // Finite float32 blocks must resolve jerk above quantization noise. Use
    // a 2 Hz analytic signal and noncommuting rest factors, retaining 1e-6.
    const input = analyticTrace({
      seconds: 62,
      bones: CORE,
      world: (b, t) => angleX((1 + CORE.findIndex(name => name === b)) * 0.2 * Math.sin(2 * Math.PI * 2 * t + 0.37)),
      events: Array.from({ length: 20 }, (_, i) => ({ kind: 'emphasis', t: 1 + 3 * i, strength: 1, source: 'scenario' })),
    })
    const rot = new Float32Array(input.rot)
    const factors = CORE.map(b => angleY(/Shoulder|UpperArm/.test(b) ? 35 * Math.PI / 180 : 0))
    for (let frame = 0; frame < input.trace.frames; frame++) {
      for (let b = 0; b < CORE.length; b++) {
        const offset = (frame * CORE.length + b) * 4
        const parent = input.trace.rig.parents[b]
        const q: Quat = [input.rot[offset], input.rot[offset + 1], input.rot[offset + 2], input.rot[offset + 3]]
        rot.set(multiply(multiply(parent < 0 ? [0, 0, 0, 1] : conjugate(factors[parent]), q), factors[b]), offset)
      }
    }
    for (const scenario of ['idle', 'gaze', 'talk'] as const) {
      const source = { ...input.trace.source, scenario: { ...input.trace.source.scenario, class: scenario } }
      const channels = new Float32Array(input.channels)
      for (let frame = 0; frame < input.trace.frames; frame++)
        channels[frame * 9 + 3] = scenario === 'talk' ? 1 : 0
      const trace = { ...input.trace, source }
      const base = measureTrace({ ...input, trace, channels }, params)
      const changed = measureTrace({ ...input, trace, channels, rot }, params)
      for (const metric of base) {
        const actual = changed.find(m => m.id === metric.id)
        expect(actual?.status, `${scenario} ${metric.id}`).toBe(metric.status)
        if (metric.value !== null)
          expect(Math.abs((actual?.value ?? Infinity) - metric.value), `${scenario} ${metric.id}`).toBeLessThan(1e-6)
      }
    }
  }, 30000)
})
