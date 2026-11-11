import type { MotionScenarioClass, MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'
import type { DetectorParameters, Quat, Vec3 } from './types'

import { motionTraceParents } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { conjugate, multiply } from './math'

export interface AnalyticTraceOptions {
  readonly seconds: number
  readonly hz?: number
  readonly bones: readonly MotionTraceBone[]
  readonly world?: (bone: MotionTraceBone, t: number) => Quat
  readonly position?: (t: number) => Vec3
  readonly yaw?: (t: number) => number
  readonly scenario?: MotionScenarioClass
  readonly events?: MotionTraceEvent[]
  readonly speaking?: (t: number) => number
  readonly mode?: (t: number) => number
}

/** Analytic input only; never loads an asset, clip, or captured trace. */
export function analyticTrace(options: AnalyticTraceOptions): DecodedMotionTrace {
  const hz = options.hz ?? 60
  const frames = Math.round(options.seconds * hz) + 1
  const bones = [...options.bones]
  const parents = motionTraceParents(bones)
  const rot = new Float32Array(frames * bones.length * 4)
  const root = new Float32Array(frames * 4)
  const channels = new Float32Array(frames * 9)
  for (let i = 0; i < frames; i++) {
    const t = i / hz
    const poses = bones.map(b => options.world?.(b, t) ?? [0, 0, 0, 1] satisfies Quat)
    for (let b = 0; b < bones.length; b++) {
      const yaw = options.yaw?.(t) ?? 0
      const parent: Quat = parents[b] < 0 ? [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] : poses[parents[b]]
      rot.set(multiply(conjugate(parent), poses[b]), (i * bones.length + b) * 4)
    }
    const p = options.position?.(t) ?? [0, 0, 0]
    root.set([p[0], p[1], p[2], options.yaw?.(t) ?? 0], i * 4)
    channels.set([t, t, 0, options.speaking?.(t) ?? 0, Number.NaN, Number.NaN, Number.NaN, options.mode?.(t) ?? 0, 0], i * 9)
  }
  return {
    trace: {
      kind: 'motion-trace',
      version: 1,
      source: { level: 't2-3d', scenario: { id: 'analytic', class: options.scenario ?? 'idle', seed: 1 }, gitSha: null, dirty: false, stages: { pose: [], surface: [] }, omitted: [], detail: {} },
      rig: { id: 'analytic', assetSha256: null, legLength: 1, bones, parents, restOffsets: bones.map(() => [0, 0.1, 0]), physicsOwned: [], hasFingers: bones.some(b => b.includes('Proximal')), eyeSource: bones.includes('leftEye') ? 'eyes' : 'none' },
      hz,
      frames,
      scoredFrom: 0,
      rot: '',
      root: '',
      channels: '',
      events: options.events ?? [],
    },
    rot,
    root,
    channels,
  }
}

export const angleX = (a: number): Quat => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
export const angleY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]
export function detectors(bones: readonly MotionTraceBone[]): DetectorParameters {
  return {
    floors: Object.fromEntries(bones.map(b => [b, 0.001])),
    moveSpeed: { body: 0.02, head: 0.02, trunk: 0.02, armL: 0.02, armR: 0.02, legs: 0.02 },
  }
}
