import type { MotionTraceEvent, MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { CORE } from '../metrics/bones'
import { analyticTrace, angleX } from '../metrics/test-trace'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
export const context = { repoRoot, cwd: repoRoot, signal: new AbortController().signal }

export interface FixtureTrial {
  readonly t: number
  readonly phase: 'pulse' | 'placebo'
}

const fourTrials: readonly FixtureTrial[] = [12, 24, 40, 52].map((t, i) => ({ t, phase: i < 2 ? 'pulse' : 'placebo' }))

/**
 * Arm bones carry a seeded sub-milliradian drift, so distinct seeds and distinct
 * trials never share a measured pose; held arm angles separate pulse from placebo.
 */
export function emotionInput(seed: number, options: { readonly prefix?: string, readonly trials?: readonly FixtureTrial[], readonly seconds?: number } = {}): DecodedMotionTrace {
  const trials = options.trials ?? fourTrials
  const events: MotionTraceEvent[] = trials.map((trial, i) => ({
    t: trial.t + seed * 0.05,
    kind: 'emotion',
    emotion: 'happy',
    band: 'clear',
    phase: trial.phase,
    trialId: `${options.prefix ?? `seed-${seed}`}/${i}`,
  }))
  const input = analyticTrace({
    seconds: options.seconds ?? 60,
    bones: CORE,
    scenario: 'emotion',
    events,
    world: (bone, t) => {
      if (!/Arm|Hand|Shoulder/.test(bone))
        return angleX(0)
      const i = events.findIndex(e => t >= e.t + 1 && t <= e.t + 5)
      const held = i < 0 ? 0 : (trials[i].phase === 'pulse' ? 0.3 : 0) + (i % 2 ? 0.01 : -0.01) + seed * 0.001
      return angleX(held + 1e-4 * Math.sin(1.7 * t + seed + CORE.findIndex(b => b === bone)))
    },
  })
  return { ...input, trace: { ...input.trace, source: { ...input.trace.source, scenario: { ...input.trace.source.scenario, seed } } } }
}

export function encoded(input: DecodedMotionTrace): MotionTraceV1 {
  return { ...input.trace, rot: encodeBlock(input.rot), root: encodeBlock(input.root), channels: encodeBlock(input.channels) }
}

/** Frames [start, end) with their recorded times unchanged. */
export function frameRange(input: DecodedMotionTrace, start: number, end: number): DecodedMotionTrace {
  const width = input.trace.rig.bones.length * 4
  return {
    trace: { ...input.trace, frames: end - start },
    rot: input.rot.slice(start * width, end * width),
    root: input.root.slice(start * 4, end * 4),
    channels: input.channels.slice(start * 9, end * 9),
  }
}

export function emotionTrace(seed: number, prefix?: string): MotionTraceV1 {
  return encoded(emotionInput(seed, { prefix }))
}

/** The production runner's header convention: seed-specific display id, one asset and revision. */
export function runnerTrace(seed: number): MotionTraceV1 {
  const trace = emotionTrace(seed)
  return {
    ...trace,
    rig: { ...trace.rig, id: `qa-${seed}`, assetSha256: 'a'.repeat(64) },
    source: { ...trace.source, gitSha: '1'.repeat(40) },
  }
}

export async function withTraces(traces: readonly MotionTraceV1[], check: (dirs: string[]) => Promise<void>) {
  const dirs = await Promise.all(traces.map(() => mkdtemp(join(tmpdir(), 'motion3d-pool-admission-'))))
  try {
    await Promise.all(dirs.map((dir, i) => writeFile(join(dir, 'trace.json'), JSON.stringify(traces[i]))))
    await check(dirs)
  }
  finally {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
  }
}

export async function readVerdicts(dirs: readonly string[]) {
  return Promise.all(dirs.map(async dir => JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'))))
}
