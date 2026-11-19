import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionVerdict, VerdictMetric } from '../gate/types'
import type { Quat } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { Motion3dRunSummary } from '../runner/measurement'
import type { LoadedRun } from './report'

import { minJerk } from '@proj-airi/motion-driver-humanoid/dynamics'

import { prepareTrace } from '../metrics'
import { multiply } from '../metrics/math'
import { analyticTrace } from '../metrics/test-trace'

/** Analytic test input only: no asset, clip or captured trace. */
export const TEST_BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand']

/** A sum of minimum-jerk moves on warped time `u^0.8` (architecture 4a), each from `start` over `duration` by `by`. */
export function moves(list: readonly { readonly start: number, readonly duration: number, readonly by: number }[]): (t: number) => number {
  return t => list.reduce((sum, m) => sum + m.by * minJerk(Math.min(1, Math.max(0, (t - m.start) / m.duration)) ** 0.8), 0)
}

export const rotX = (a: number): Quat => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
export const rotY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]

/** Per-side arm angles: upper arm about X, the elbow about X on top of it, the hand's twist about the forearm (Y). */
export interface ArmMotion {
  readonly upper?: (t: number) => number
  readonly elbow?: (t: number) => number
  readonly twist?: (t: number) => number
}

export function armWorld(left: ArmMotion, right: ArmMotion, extra: (bone: MotionTraceBone, t: number) => Quat | null = () => null) {
  return (bone: MotionTraceBone, t: number): Quat => {
    const own = extra(bone, t)
    if (own)
      return own
    const side = bone.startsWith('left') ? left : bone.startsWith('right') ? right : null
    if (!side || bone.endsWith('Shoulder'))
      return [0, 0, 0, 1]
    const upper = rotX(side.upper?.(t) ?? 0)
    if (bone.endsWith('UpperArm'))
      return upper
    const lower = multiply(upper, rotX(side.elbow?.(t) ?? 0))
    return bone.endsWith('LowerArm') ? lower : multiply(lower, rotY(side.twist?.(t) ?? 0))
  }
}

export function trace(options: { seconds: number, scenario: 'talk' | 'emotion', events?: MotionTraceEvent[], world?: (bone: MotionTraceBone, t: number) => Quat, speaking?: (t: number) => number }): DecodedMotionTrace {
  return analyticTrace({ bones: TEST_BONES, ...options, events: [...options.events ?? []].sort((a, b) => a.t - b.t) })
}

export function summaryStub(input: DecodedMotionTrace, overrides: Partial<Motion3dRunSummary> = {}): Motion3dRunSummary {
  const frames = input.trace.frames
  const zeros = Array.from<number>({ length: frames }).fill(0)
  return {
    kind: 'motion3d-run-summary',
    version: 1,
    model: 'analytic',
    scenario: { id: 'analytic', class: 'talk', seed: 1, seconds: frames / 60, warmupSeconds: 0 },
    provenance: {},
    timing: { headless: true, frames, stages: {}, poseStageP95Ms: 0, airiStageP95Ms: 0, wallMs: 0, realtime: 1 },
    perFrameSeries: { columns: ['t_ms', 'mode', 'skate', 'feetMaxError'], rows: [] },
    perFrame: { t_ms: zeros, penL: zeros, penR: zeros, clothL: zeros, clothR: zeros },
    collisions: { count: 0, last: null },
    corrector: { capHits: 0, guardScans: 0, holds: 0 },
    owned: { groups: ['root', 'leftLegIk', 'rightLegIk', 'lowerBody', 'leftArm', 'rightArm', 'leftFingers', 'rightFingers', 'upperBody', 'head'], perFrame: Array.from({ length: frames }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
    ownership: { groups: ['hips', 'torso', 'head', 'leftArm', 'rightArm', 'leftFingers', 'rightFingers'], deviationRad: Array.from({ length: frames }, () => [0, 0, 0, 0, 0, 0, 0]), activation: { left: zeros, right: zeros }, armDeg: { left: [], right: [] }, restArmDeg: { left: [], right: [] } },
    clip: null,
    ...overrides,
  }
}

/** A gate verdict listing the given metric statuses; bands are GATED unless stated, values as given. */
export function gateStub(metrics: Readonly<Record<string, { status: VerdictMetric['status'], value?: number | null, gated?: boolean }>>, verdict: MotionVerdict['verdict'] = 'PASS'): MotionVerdict {
  return {
    kind: 'mmd-motion-verdict',
    gate: { id: 'mmd-motion-quality', version: 2, fileSha256: '', bandsSha256: '' },
    trace: { path: 'analytic', sha256: '', level: 't2-3d', scenario: 'analytic', class: 'talk', seed: 1, scoredSeconds: 0, hz: 60 },
    verdict,
    refusal: null,
    metrics: Object.entries(metrics).map(([id, m]) => ({
      id,
      family: id.split('.')[0],
      status: m.status,
      value: m.value ?? null,
      unit: '',
      basis: 'fitted',
      band: { side: 'upper', domain: [null, null], transform: 'none', unit: 'clip', basis: 'fitted', status: m.gated === false ? 'REPORT' : 'GATED', detail: '', n: 0, p5: null, p50: null, p95: null, lo: null, hi: null },
      detail: '',
    })),
    counts: { pass: 0, fail: 0, report: 0, skipped: 0 },
    limitation: '',
  }
}

export function loadedRun(input: DecodedMotionTrace, summary: Motion3dRunSummary | null, gate: MotionVerdict | null, dir = 'analytic-run'): LoadedRun {
  return { dir, input, p: prepareTrace(input), summary, gate }
}
