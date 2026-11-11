import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it, vi } from 'vitest'

import { gateMotion3d } from '../cli/gate'
import { CORE } from '../metrics/bones'
import { analyticTrace, angleX } from '../metrics/test-trace'
import { motionQualityGate } from './definition'

import * as bandsLoader from './load'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const fixture = () => analyticTrace({ seconds: 12, bones: CORE })
function encoded(input: DecodedMotionTrace): MotionTraceV1 {
  return { ...input.trace, rot: encodeBlock(input.rot), root: encodeBlock(input.root), channels: encodeBlock(input.channels) }
}

describe('cLI named refusals', () => {
  const cases: readonly { name: string, input: () => unknown }[] = [
    { name: 'trace-kind', input: () => ({ ...encoded(fixture()), version: 2 }) },
    { name: 'trace-shape', input: () => ({ ...encoded(fixture()), rot: '' }) },
    { name: 'trace-shape', input: () => {
      const trace = encoded(fixture())
      return { ...trace, rig: { ...trace.rig, legLength: 0 } }
    } },
    { name: 'trace-shape', input: () => {
      const trace = encoded(fixture())
      return { ...trace, rig: { ...trace.rig, parents: trace.rig.parents.map(() => -1) } }
    } },
    { name: 'trace-nonfinite', input: () => {
      const input = fixture()
      for (let i = 0; i < input.trace.frames; i++)
        input.channels[i * 9 + 1] = Infinity
      return encoded(input)
    } },
    { name: 'trace-nonfinite', input: () => {
      const input = analyticTrace({ seconds: 22, bones: CORE, position: t => [0, 0, t] })
      const trace = encoded(input)
      return { ...trace, rig: { ...trace.rig, legLength: Number.MIN_VALUE } }
    } },
    { name: 'trace-nonfinite', input: () => {
      const input = fixture()
      input.root[0] = Number.NaN
      return encoded(input)
    } },
    { name: 'trace-unnormalized', input: () => {
      const input = fixture()
      input.rot[3] = 2
      return encoded(input)
    } },
    { name: 'time-nonmonotonic', input: () => {
      const input = fixture()
      input.channels[9] = 0
      return encoded(input)
    } },
    { name: 'rate-too-low', input: () => encoded(analyticTrace({ seconds: 12, hz: 20, bones: CORE })) },
    { name: 'frame-gap', input: () => {
      const input = fixture()
      for (let i = 100; i < input.trace.frames; i++)
        input.channels[i * 9] += 0.05
      return encoded(input)
    } },
    { name: 'trace-too-short', input: () => encoded(analyticTrace({ seconds: 9, bones: CORE })) },
    { name: 'rig-incomplete', input: () => encoded(analyticTrace({ seconds: 12, bones: CORE.filter(b => b !== 'leftHand') })) },
    { name: 'non-upright', input: () => encoded(analyticTrace({ seconds: 12, bones: CORE, world: b => angleX(b === 'hips' ? Math.PI / 2 : 0) })) },
  ]
  it.each(cases)('writes $name as REFUSED and exits 2', async ({ name, input }) => {
    const dir = await mkdtemp(join(tmpdir(), 'motion3d-refusal-'))
    try {
      await writeFile(join(dir, 'trace.json'), JSON.stringify(input()))
      const code = await gateMotion3d([dir], { repoRoot, cwd: dir, signal: new AbortController().signal })
      const verdict = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))
      expect(code).toBe(2)
      expect(verdict).toMatchObject({ verdict: 'REFUSED', refusal: { name }, counts: { pass: 0, fail: 0 } })
      expect(verdict.metrics).toEqual([])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns class-unknown and exit 2 when a valid bands artifact lacks the trace class', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion3d-class-'))
    const bands = await bandsLoader.loadBands(repoRoot)
    // The artifact boundary may supply any subset of classes. Hash enforcement
    // is exercised separately with real altered bytes, not by this boundary fake.
    const loader = vi.spyOn(bandsLoader, 'loadBands').mockResolvedValue({ ...bands, classes: {} })
    try {
      await writeFile(join(dir, 'trace.json'), JSON.stringify(encoded(fixture())))
      expect(await gateMotion3d([dir], { repoRoot, cwd: dir, signal: new AbortController().signal })).toBe(2)
      expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'class-unknown' } })
    }
    finally {
      loader.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each(['missing', 'malformed'])('writes trace-unreadable for a %s trace and exits 2', async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), 'motion3d-unreadable-'))
    try {
      if (kind === 'malformed')
        await writeFile(join(dir, 'trace.json'), '{')
      expect(await gateMotion3d([dir], { repoRoot, cwd: dir, signal: new AbortController().signal })).toBe(2)
      expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'trace-unreadable' } })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses altered band bytes before scoring and exits 2', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion3d-hash-'))
    try {
      const path = join(dir, motionQualityGate.bandsFile)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${await readFile(join(repoRoot, motionQualityGate.bandsFile), 'utf8')} `)
      await writeFile(join(dir, 'trace.json'), JSON.stringify(encoded(fixture())))
      expect(await gateMotion3d([dir], { repoRoot: dir, cwd: dir, signal: new AbortController().signal })).toBe(2)
      expect(JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'bands-hash-mismatch' } })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns argument and interrupt exit codes without judging', async () => {
    const controller = new AbortController()
    const context = { repoRoot, cwd: repoRoot, signal: controller.signal }
    expect(await gateMotion3d([], context)).toBe(2)
    expect(await gateMotion3d(['--unknown'], context)).toBe(2)
    controller.abort()
    expect(await gateMotion3d(['unused'], context)).toBe(130)
  })
})
