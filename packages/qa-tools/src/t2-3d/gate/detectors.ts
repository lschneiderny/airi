import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters, detectorQuantities, PreparedTrace } from '../metrics'

import { MOTION_TRACE_BONES } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { isFinger } from '../metrics/bones'
import { median } from '../metrics/math'
import { percentile } from './bands'
import { mirroredName } from './policy'

/** One entry per fitting window clip; episode-only clips never set detector scales. */
export type DetectorQuantities = ReturnType<typeof detectorQuantities>

/**
 * Version 2: a left or right bone's floor, and an arm's move speed, are fitted
 * from both sides pooled, so one performer's handedness cannot set a different
 * activity threshold for each side.
 */
export function fitDetectors(clips: readonly DetectorQuantities[]): DetectorParameters {
  const activities = (bone: MotionTraceBone) => clips.flatMap(clip => clip.activity[bone] === undefined ? [] : [clip.activity[bone]])
  const floors: Partial<Record<MotionTraceBone, number>> = {}
  for (const bone of MOTION_TRACE_BONES) {
    if (!activities(bone).length)
      continue
    const mirror = MOTION_TRACE_BONES.find(other => other === mirroredName(bone))
    const values = [...activities(bone), ...(mirror ? activities(mirror) : [])]
    if (!isFinger(bone) || values.length >= 10)
      floors[bone] = 0.5 * percentile(values, 0.1)
  }
  const speeds = (region: keyof DetectorParameters['moveSpeed']) => clips.flatMap(clip => clip.medianSpeed[region] === null ? [] : [clip.medianSpeed[region]])
  const speed = (region: keyof DetectorParameters['moveSpeed']) => median(speeds(region))
  const arms = median([...speeds('armL'), ...speeds('armR')])
  return { floors, moveSpeed: { body: speed('body'), head: speed('head'), trunk: speed('trunk'), armL: arms, armR: arms, legs: speed('legs') } }
}

/** Only head-region onset episodes belong to the gaze scenario's onset band. */
export function headOnly(p: PreparedTrace): PreparedTrace {
  return { ...p, o15: { neck: p.o15.neck, head: p.o15.head } }
}
