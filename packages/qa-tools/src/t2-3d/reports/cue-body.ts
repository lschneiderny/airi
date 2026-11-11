import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import type { MotionBandsFile } from '../gate/types'
import type { PreparedTrace } from '../metrics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'

import { DEG, HZ, rms } from '../metrics/math'
import { criterionReport, fixed, formatReport, ReportUsageError, requirement } from './report'

export const CUE_BODY_VERSION = 1

/** Natural's cue durations for one count (`cue-gestures.ts`, `start`; the glance holds 0.6 s). */
export const CUE_SECONDS: Readonly<Record<CueGestureKind, number>> = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
const CUES = Object.keys(CUE_SECONDS) as CueGestureKind[]
export const CUE_BONES: readonly MotionTraceBone[] = ['spine', 'chest', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'hips']

const C = { tail: 0.5, floorScale: 3, before: 1, beforeScale: 2, events: 5, falsePositive: 0.05, calibrationTimes: 200 }

export const CUE_BODY_CONSTANTS: readonly ReportConstant[] = [
  { name: 'cue window', value: `start .. end + ${C.tail}`, unit: 's', source: 'plan 2.3' },
  { name: 'floor scale', value: C.floorScale, unit: 'x emotion-class floor', source: 'gate participationFloorScale' },
  { name: 'pre-cue scale', value: C.beforeScale, unit: `x own RMS over the ${C.before} s before`, source: 'plan 2.3 (new; adopted only below 5 % false positives on goal-2 idle)' },
  { name: 'events per kind', value: C.events, unit: 'of 6', source: 'plan 2.3' },
  ...CUES.map(cue => ({ name: `${cue} duration`, value: CUE_SECONDS[cue], unit: 's', source: 'motion-driver-natural cue-gestures.ts start' })),
]

/** Plan 2.3: whether one bone below the neck moves over [start, start + seconds + 0.5] against its floor and its own past. */
function moves(p: PreparedTrace, floors: MotionBandsFile['classes']['emotion'], bone: MotionTraceBone, start: number, seconds: number): { moved: boolean, windowDeg: number, beforeDeg: number } | null {
  const series = p.o6[bone]
  const floor = floors?.floors[bone]
  const index = (t: number) => Math.max(0, Math.min(p.bodySpeed.length, Math.round((t - p.times[0]) * HZ)))
  if (!series || floor === undefined)
    return null
  const window = rms(series.slice(index(start), index(start + seconds + C.tail)))
  const before = rms(series.slice(index(start - C.before), index(start)))
  return { moved: window >= C.floorScale * floor && window >= C.beforeScale * before, windowDeg: window * DEG, beforeDeg: before * DEG }
}

export interface CueEvent {
  readonly run: string
  readonly cue: CueGestureKind
  readonly t: number
  readonly moved: readonly MotionTraceBone[]
  readonly bones: Readonly<Partial<Record<MotionTraceBone, { readonly windowDeg: number, readonly beforeDeg: number }>>>
}

export interface CueBodyDetail {
  readonly events: readonly CueEvent[]
  readonly perKind: Readonly<Record<CueGestureKind, { readonly moved: number, readonly total: number }>>
}

/** C002 cue-body report (plan 2.3): every cue kind must move a bone below the neck on at least 5 of its 6 events. */
export function cueBodyReport(runs: readonly LoadedRun[], bands: MotionBandsFile): CriterionReport<CueBodyDetail> {
  const emotion = bands.classes.emotion
  if (!emotion)
    throw new ReportUsageError('The frozen bands have no emotion class')
  const events: CueEvent[] = runs.flatMap(run => run.input.trace.events.flatMap((e) => {
    if (e.kind !== 'gesture' || !(e.gesture in CUE_SECONDS))
      return []
    const cue = e.gesture as CueGestureKind
    const measured = CUE_BONES.flatMap((bone) => {
      const m = moves(run.p, emotion, bone, e.t, CUE_SECONDS[cue])
      return m ? [{ bone, ...m }] : []
    })
    const bones: CueEvent['bones'] = Object.fromEntries(measured.map(m => [m.bone, { windowDeg: m.windowDeg, beforeDeg: m.beforeDeg }]))
    return [{ run: run.dir, cue, t: e.t, moved: measured.filter(m => m.moved).map(m => m.bone), bones }]
  }))
  const perKind = Object.fromEntries(CUES.map(cue => [cue, { moved: events.filter(e => e.cue === cue && e.moved.length > 0).length, total: events.filter(e => e.cue === cue).length }])) as CueBodyDetail['perKind']
  return criterionReport('cue-body', CUE_BODY_VERSION, runs.map(r => r.dir), CUE_BODY_CONSTANTS, CUES.map(cue => requirement(
    `cue-${cue}`,
    `a bone below the neck moves on >= ${C.events} of the ${cue} events`,
    `${perKind[cue].moved}/${perKind[cue].total}`,
    perKind[cue].moved >= C.events,
  )), { events, perKind })
}

/**
 * Plan 2.3's adoption check for the new pre-cue factor: the share of seeded random times on idle traces at which a
 * cue window of each kind would count a bone below the neck as moving. Adopt the factor only if every share is under 5 %.
 */
export function cueFalsePositives(runs: readonly LoadedRun[], bands: MotionBandsFile, seed = 1): Readonly<Record<CueGestureKind, { readonly passing: number, readonly total: number }>> {
  const emotion = bands.classes.emotion
  if (!emotion)
    throw new ReportUsageError('The frozen bands have no emotion class')
  const random = createRandomStream(seed)
  const times = Array.from({ length: C.calibrationTimes }, () => {
    const run = runs[Math.floor(random() * runs.length)]
    const span = run.p.times[run.p.times.length - 1] - run.p.times[0] - C.before - Math.max(...Object.values(CUE_SECONDS)) - C.tail
    return { run, t: run.p.times[0] + C.before + random() * span }
  })
  return Object.fromEntries(CUES.map(cue => [cue, {
    passing: times.filter(({ run, t }) => CUE_BONES.some(bone => moves(run.p, emotion, bone, t, CUE_SECONDS[cue])?.moved)).length,
    total: times.length,
  }])) as Record<CueGestureKind, { passing: number, total: number }>
}

export function formatCueBody(report: CriterionReport<CueBodyDetail>): string {
  return formatReport(report, [
    'cue events: run, cue, t s, bones that moved (window / pre-cue RMS deg/s of the largest)',
    ...report.detail.events.map((e) => {
      const largest = Object.entries(e.bones).sort((a, b) => (b[1]?.windowDeg ?? 0) - (a[1]?.windowDeg ?? 0))[0]
      return `  ${e.run}\t${e.cue}\t${e.t.toFixed(3)}\t${e.moved.join(', ') || 'none'}\t(largest ${largest?.[0] ?? '-'} ${fixed(largest?.[1]?.windowDeg ?? null, 2)} / ${fixed(largest?.[1]?.beforeDeg ?? null, 2)})`
    }),
  ])
}

export function formatCueFalsePositives(shares: ReturnType<typeof cueFalsePositives>): string {
  return `${[
    `cue-body false-positive calibration (plan 2.3): share of ${C.calibrationTimes} seeded random idle times that would pass, adopt below ${C.falsePositive * 100} %`,
    ...CUES.map(cue => `  ${cue}\t${shares[cue].passing}/${shares[cue].total} = ${fixed(shares[cue].passing / shares[cue].total)}\t${shares[cue].passing / shares[cue].total < C.falsePositive ? 'below' : 'NOT below'}`),
  ].join('\n')}\n`
}
