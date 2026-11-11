import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters, detectorQuantities, PreparedTrace } from '../metrics'

import { MOTION_TRACE_BONES } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { isFinger } from '../metrics/bones'
import { median } from '../metrics/math'
import { percentile } from './bands'

/** One entry per fitting window clip; episode-only clips never set detector scales. */
export type DetectorQuantities = ReturnType<typeof detectorQuantities>

export function fitDetectors(clips: readonly DetectorQuantities[]): DetectorParameters {
  const floors: Partial<Record<MotionTraceBone, number>> = {}
  for (const bone of MOTION_TRACE_BONES) {
    const values = clips.flatMap(clip => clip.activity[bone] === undefined ? [] : [clip.activity[bone]])
    if (values.length && (!isFinger(bone) || values.length >= 10))
      floors[bone] = 0.5 * percentile(values, 0.1)
  }
  const speed = (region: keyof DetectorParameters['moveSpeed']) => median(clips.flatMap(clip => clip.medianSpeed[region] === null ? [] : [clip.medianSpeed[region]]))
  return { floors, moveSpeed: { body: speed('body'), head: speed('head'), trunk: speed('trunk'), armL: speed('armL'), armR: speed('armR'), legs: speed('legs') } }
}

/** Only head-region onset episodes belong to the gaze scenario's onset band. */
export function headOnly(p: PreparedTrace): PreparedTrace {
  return { ...p, o15: { neck: p.o15.neck, head: p.o15.head } }
}
