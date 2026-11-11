import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace } from '../metrics'
import type { Pop } from './kinematics'
import type { CriterionReport, LoadedRun } from './report'

import { isFinger } from '../metrics/bones'
import { POP_CONSTANTS, pops } from './kinematics'
import { criterionReport, formatReport, requirement } from './report'

export const POPS_VERSION = 1

/** Plan 2.6: the shoulder, upper arm, lower arm and hand of both sides are required; fingers are reported only. */
export const armPopBones: readonly MotionTraceBone[] = (['left', 'right'] as const).flatMap(side => (['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const).map(joint => `${side}${joint}` as const))

export function popEvents(p: PreparedTrace, bones: readonly MotionTraceBone[], from = Number.NEGATIVE_INFINITY, to = Number.POSITIVE_INFINITY): Pop[] {
  return bones.flatMap(bone => pops(p, bone)).filter(pop => pop.t >= from && pop.t <= to)
}

export function popCount(p: PreparedTrace, bones: readonly MotionTraceBone[], from?: number, to?: number): number {
  return popEvents(p, bones, from, to).length
}

export interface PopsDetail {
  readonly arm: readonly Pop[]
  readonly fingers: readonly Pop[]
}

export function popsReport(run: LoadedRun): CriterionReport<PopsDetail> {
  const arm = popEvents(run.p, armPopBones)
  const fingers = popEvents(run.p, run.input.trace.rig.bones.filter(isFinger))
  return criterionReport('pops', POPS_VERSION, [run.dir], Object.entries(POP_CONSTANTS).map(([name, c]) => ({ name, ...c })), [
    requirement('arm-pops', 'pops on the shoulder, upper arm, lower arm and hand of both sides = 0', `${arm.length}`, arm.length === 0),
  ], { arm, fingers })
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
    `arm pops by bone: ${counts(report.detail.arm)}`,
    ...report.detail.arm.map(line),
    `finger pops (report only): ${report.detail.fingers.length}; ${counts(report.detail.fingers)}`,
  ])
}
