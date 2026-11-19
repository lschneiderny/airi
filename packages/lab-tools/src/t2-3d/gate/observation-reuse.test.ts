import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'

import { describe, expect, it } from 'vitest'

import { gateMotion3d } from '../cli/gate'
import { context, emotionInput, encoded, frameRange, readVerdicts, withTraces } from './pool-fixture'

const base = emotionInput(1)
const frames = base.trace.frames

function relabel(trace: MotionTraceV1, copy: number): MotionTraceV1 {
  return { ...trace, events: trace.events.map(e => e.kind === 'emotion' ? { ...e, trialId: `${e.trialId}-copy-${copy}` } : e) }
}

async function expectDuplicate(traces: readonly MotionTraceV1[]) {
  await withTraces(traces, async (dirs) => {
    expect(await gateMotion3d(dirs, context)).toBe(2)
    for (const verdict of await readVerdicts(dirs))
      expect(verdict).toMatchObject({ verdict: 'REFUSED', refusal: { name: 'pool-duplicate' }, metrics: [] })
  })
}

/** Self-attack: every recorded frame repeated half a frame later, so the capture claims 120 Hz. */
function repeated(input: DecodedMotionTrace): DecodedMotionTrace {
  const width = input.trace.rig.bones.length * 4
  const n = input.trace.frames
  const rot = new Float32Array(2 * n * width)
  const root = new Float32Array(2 * n * 4)
  const channels = new Float32Array(2 * n * 9)
  for (let j = 0; j < n; j++) {
    for (const k of [2 * j, 2 * j + 1]) {
      rot.set(input.rot.subarray(j * width, (j + 1) * width), k * width)
      root.set(input.root.subarray(j * 4, (j + 1) * 4), k * 4)
      channels.set(input.channels.subarray(j * 9, (j + 1) * 9), k * 9)
    }
    channels[(2 * j + 1) * 9] += 1 / 120
    channels[(2 * j + 1) * 9 + 1] += 1 / 120
  }
  return { trace: { ...input.trace, frames: 2 * n, hz: 120 }, rot, root, channels }
}

describe('emotion observation reuse', () => {
  it('refuses relabelled copies that differ only in nominal hz', async () => {
    await expectDuplicate([60, 61, 62].map((hz, i) => relabel({ ...encoded(base), hz }, i)))
  })

  it('refuses relabelled copies with unused tail frames trimmed', async () => {
    await expectDuplicate([0, 1, 2].map(n => relabel(encoded(frameRange(base, 0, frames - n)), n)))
  })

  it('refuses tail-trimmed copies whose event times also shift by one frame', async () => {
    await expectDuplicate([0, 1, 2].map((n) => {
      const trace = relabel(encoded(frameRange(base, 0, frames - n)), n)
      return { ...trace, events: trace.events.map(e => ({ ...e, t: e.t + n / 60 })) }
    }))
  })

  it('refuses copies with leading frames removed so frame indices shift', async () => {
    await expectDuplicate([0, 3, 6].map(n => relabel(encoded(frameRange(base, n, frames)), n)))
  })

  it('refuses two trials in one trace whose windows overlap', async () => {
    await expectDuplicate([encoded(emotionInput(1, { trials: [{ t: 12, phase: 'pulse' }, { t: 13, phase: 'placebo' }] }))])
  })

  it.each([
    ['negated quaternions', (input: DecodedMotionTrace) => ({ ...input, rot: input.rot.map(v => -v) })],
    ['rewritten root position and yaw', (input: DecodedMotionTrace) => ({ ...input, root: input.root.map((v, i) => i % 4 === 0 ? v + 0.5 : i % 4 === 3 ? v + 0.3 : v) })],
    ['every frame repeated at a claimed 120 Hz', repeated],
  ])('refuses the self-attack copy with %s', async (_, edit) => {
    await expectDuplicate([encoded(base), relabel(encoded(edit(base)), 1)])
  })

  it('scores a single trace whose trials are well separated', async () => {
    const trials = Array.from({ length: 11 }, (_, i) => ({ t: 12 + 10 * i, phase: i < 6 ? 'pulse' as const : 'placebo' as const, emotion: i < 3 ? 'happy' as const : 'neutral' as const }))
    await withTraces([encoded(emotionInput(1, { trials, seconds: 130 }))], async (dirs) => {
      await gateMotion3d(dirs, context)
      const [verdict] = await readVerdicts(dirs)
      expect(verdict.refusal).toBeNull()
      expect(verdict.pooledFrom.trialCounts).toEqual({ happy: 3, neutral: 3, placebo: 5 })
      expect(verdict.metrics).toContainEqual(expect.objectContaining({ id: 'emotion.minSeparationFromNeutral', status: 'PASS' }))
    })
  })
})
