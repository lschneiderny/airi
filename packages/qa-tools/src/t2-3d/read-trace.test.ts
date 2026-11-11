import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it } from 'vitest'

import { MotionTraceRefusal, parseTrace, readTrace } from './read-trace'

function fixture(): MotionTraceV1 {
  const channels = new Float32Array(18).fill(Number.NaN)
  channels[0] = 0
  channels[9] = 1 / 60
  return {
    kind: 'motion-trace',
    version: 1,
    source: { level: 't2-3d', scenario: { id: 'test', class: 'idle', seed: 1 }, gitSha: null, dirty: null, stages: { pose: [], surface: [] }, omitted: [], detail: {} },
    rig: { id: 'test', assetSha256: null, legLength: 1, bones: ['hips'], parents: [-1], restOffsets: [[0, 0, 0]], physicsOwned: [], eyeSource: 'none', hasFingers: false },
    hz: 60,
    frames: 2,
    scoredFrom: 0,
    rot: encodeBlock(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])),
    root: encodeBlock(new Float32Array(8)),
    channels: encodeBlock(channels),
    events: [],
  }
}

describe('motion trace boundary', () => {
  it('reads a trace file and retains permitted missing scalar channels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-trace-'))
    try {
      const path = join(dir, 'trace.json')
      await writeFile(path, `${JSON.stringify(fixture())}\n`)
      const result = await readTrace(path)
      expect(result.trace.frames).toBe(2)
      expect([...result.rot]).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
      expect(result.channels[9]).toBeCloseTo(1 / 60, 7)
      expect(result.channels[2]).toBeNaN()
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses missing or non-JSON files as trace-unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-trace-'))
    try {
      const path = join(dir, 'trace.json')
      await expect(readTrace(path)).rejects.toMatchObject({ name: 'trace-unreadable' })
      await writeFile(path, '{')
      await expect(readTrace(path)).rejects.toBeInstanceOf(MotionTraceRefusal)
      await expect(readTrace(path)).rejects.toMatchObject({ name: 'trace-unreadable' })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  const cases: [string, (trace: MotionTraceV1) => unknown][] = [
    ['trace-kind', trace => ({ ...trace, version: 2 })],
    ['trace-kind', trace => ({ ...trace, kind: 'other' })],
    ['trace-shape', trace => ({ ...trace, rot: '' })],
    ['trace-shape', trace => ({ ...trace, root: '!!!!' })],
    ['trace-shape', trace => ({ ...trace, rig: { ...trace.rig, parents: [0] } })],
    ['trace-shape', trace => ({ ...trace, rig: { ...trace.rig, restOffsets: [] } })],
    ['trace-shape', trace => ({ ...trace, source: { ...trace.source, level: 'unknown' } })],
    ['trace-nonfinite', trace => ({ ...trace, rot: encodeBlock(new Float32Array([Number.NaN, 0, 0, 1, 0, 0, 0, 1])) })],
    ['trace-nonfinite', trace => ({ ...trace, root: encodeBlock(new Float32Array(8).fill(Infinity)) })],
    ['trace-nonfinite', trace => ({ ...trace, channels: encodeBlock(new Float32Array(18).fill(Number.NaN)) })],
    ['trace-unnormalized', trace => ({ ...trace, rot: encodeBlock(new Float32Array([0, 0, 0, 2, 0, 0, 0, 1])) })],
    ['time-nonmonotonic', trace => ({ ...trace, channels: encodeBlock(new Float32Array(18)) })],
  ]
  it.each(cases)('returns the typed %s refusal without scoring malformed input', (name, malformed) => {
    expect(() => parseTrace(malformed(fixture()))).toThrow(MotionTraceRefusal)
    expect(() => parseTrace(malformed(fixture()))).toThrow(expect.objectContaining({ name }))
  })
})
