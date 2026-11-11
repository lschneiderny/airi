import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it, vi } from 'vitest'

import { gateMotion3d } from '../cli/gate'
import { CORE } from '../metrics/bones'
import { analyticTrace, angleX, detectors } from '../metrics/test-trace'
import { fitClass } from './reference-fit'

import * as bandsLoader from './load'

describe('emotion directory pooling', () => {
  it('judges sufficient pooled placebo trials and records every contributing directory', async () => {
    const repoRoot = resolve(import.meta.dirname, '../../../../..')
    const bands = await bandsLoader.loadBands(repoRoot)
    const emotion = fitClass([], 'emotion', detectors(CORE), 0.05)
    const loader = vi.spyOn(bandsLoader, 'loadBands').mockResolvedValue({ ...bands, classes: { emotion } })
    const dirs = await Promise.all([1, 2].map(() => mkdtemp(join(tmpdir(), 'motion3d-emotion-'))))
    try {
      for (const [seed, dir] of dirs.entries()) {
        // Per seed: three happy pulses, three placebos, then two neutral pulses.
        const events: MotionTraceEvent[] = Array.from({ length: 8 }, (_, i) => ({
          kind: 'emotion',
          t: 5 + 12 * i,
          phase: i < 3 || i >= 6 ? 'pulse' : 'placebo',
          emotion: i >= 6 ? 'neutral' : 'happy',
          band: 'clear',
          trialId: `${seed}/${i}`,
        }))
        const input = analyticTrace({
          seconds: 100,
          bones: CORE,
          scenario: 'emotion',
          events,
          world: (bone, t) => {
            const i = events.findIndex(e => t >= e.t + 1 && t <= e.t + 5)
            const arm = /Arm|Hand|Shoulder/.test(bone)
            const a = i < 0 || !arm ? 0 : (i < 3 ? 0.3 : i >= 6 ? -0.3 : 0) + (i % 3 - 1 + seed * 0.2) * 0.01
            // Seeded drift keeps every observation's measured frames distinct.
            return angleX(arm ? a + 1e-4 * Math.sin(1.7 * t + seed + CORE.findIndex(b => b === bone)) : a)
          },
        })
        await writeFile(join(dir, 'trace.json'), JSON.stringify({ ...input.trace, rot: encodeBlock(input.rot), root: encodeBlock(input.root), channels: encodeBlock(input.channels) }))
      }
      expect(await gateMotion3d(dirs, { repoRoot, cwd: repoRoot, signal: new AbortController().signal })).toBe(0)
      for (const dir of dirs) {
        const verdict = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))
        expect(verdict.verdict).toBe('PASS')
        expect(verdict.pooledFrom).toMatchObject({ traces: dirs.map(directory => ({ directory })), trialCounts: { happy: 6, neutral: 4, placebo: 6 } })
        expect(verdict.metrics).toContainEqual(expect.objectContaining({ id: 'emotion.minSeparationFromNeutral', status: 'PASS', basis: 'declared' }))
        expect(verdict.metrics).toContainEqual(expect.objectContaining({ id: 'emotion.armShare', status: 'PASS', value: 1 }))
      }
    }
    finally {
      loader.mockRestore()
      await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
    }
  }, 30000)
})
