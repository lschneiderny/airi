import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace } from '../metrics'
import type { Pop } from './kinematics'
import type { CriterionReport, LoadedRun } from './report'

import { isFinger } from '../metrics/bones'
import { POP_CONSTANTS, pops, traceParent } from './kinematics'
import { criterionReport, formatReport, requirement } from './report'

export const POPS_VERSION = 2

/**
 * Unit M3: the spine, chest, upper chest, neck, head and the shoulder, upper arm, lower arm and hand of both sides are
 * required; fingers are reported only. A rig without one of these bones skips it.
 */
export const upperBodyPopBones: readonly MotionTraceBone[] = [
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  ...(['left', 'right'] as const).flatMap(side => (['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const).map(joint => `${side}${joint}` as const)),
]

/**
 * Unit M3 attribution: a pop is charged to the bone that stepped. A bone's pop is dropped when its direct trace parent
 * pops on the same frame, because only the parent's own step reaches the child's relative velocity; chains follow
 * transitively. A grandparent's velocity step that the parent carries smoothly does not count.
 */
export function popEvents(p: PreparedTrace, bones: readonly MotionTraceBone[], from = Number.NEGATIVE_INFINITY, to = Number.POSITIVE_INFINITY): Pop[] {
  const parentFrames = (bone: MotionTraceBone): Set<number> => {
    const parent = traceParent(p, bone)
    return new Set(parent ? pops(p, parent).map(pop => pop.index) : [])
  }
  return bones.flatMap((bone) => {
    const inherited = parentFrames(bone)
    return pops(p, bone).filter(pop => !inherited.has(pop.index))
  }).filter(pop => pop.t >= from && pop.t <= to)
}

export function popCount(p: PreparedTrace, bones: readonly MotionTraceBone[], from?: number, to?: number): number {
  return popEvents(p, bones, from, to).length
}

export interface PopsDetail {
  readonly upperBody: readonly Pop[]
  readonly fingers: readonly Pop[]
}

/**
 * What the 60 Hz classifier cannot see, printed in every pops report: unit M's injection control (controls/pops-injection.txt).
 * The corrector's 6 degree cap and guard scan, the known source of such steps, are counted per run and required to be 0.
 */
export const POPS_DETECTION_LIMIT = {
  name: 'detection limit',
  value: 'a one-frame 2.3 deg step in the middle of a stroke of 150 ms or less (110 ms: 6 of 11 injected phases missed; 150 ms: 5 of 11; 200 and 250 ms: none missed)',
  unit: '',
  source: 'unit M controls/pops-injection.txt; summary.json corrector capHits and guardScans, required 0 by gesture-timing and ownership, count the known source of such steps',
} as const

export function popsReport(run: LoadedRun): CriterionReport<PopsDetail> {
  const upperBody = popEvents(run.p, upperBodyPopBones)
  const fingers = popEvents(run.p, run.input.trace.rig.bones.filter(isFinger))
  return criterionReport('pops', POPS_VERSION, [run.dir], [...Object.entries(POP_CONSTANTS).map(([name, c]) => ({ name, ...c })), POPS_DETECTION_LIMIT], [
    requirement('upper-body-pops', 'pops on the spine, chest, upper chest, neck, head and both shoulders, upper arms, lower arms and hands = 0 (a step charged to the bone that stepped)', `${upperBody.length}`, upperBody.length === 0),
  ], { upperBody, fingers })
}

export function formatPops(report: CriterionReport<PopsDetail>): string {
  const line = (pop: Pop) => `  ${pop.t.toFixed(3)}\t${pop.bone}\t${pop.kind}\t${pop.size.toFixed(1)} deg/s`
  const counts = (list: readonly Pop[]) => {
    const by = new Map<string, number>()
    for (const pop of list)
      by.set(pop.bone, (by.get(pop.bone) ?? 0) + 1)
    return [...by].map(([bone, n]) => `${bone} ${n}`).join(', ') || 'none'
  }
  return formatReport(report, [
    `upper-body pops by bone: ${counts(report.detail.upperBody)}`,
    ...report.detail.upperBody.map(line),
    `finger pops (report only): ${report.detail.fingers.length}; ${counts(report.detail.fingers)}`,
  ])
}
