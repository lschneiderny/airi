import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionBandsFile } from '../gate/types'
import type { Quat, Vec3 } from '../metrics'
import type { KinematicStroke, Side } from './kinematics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { conjugate, DEG, median, multiply, norm, sub } from '../metrics/math'
import { handPath, kinematicStrokes, SIDES, STROKE_CONSTANTS } from './kinematics'
import { armPopBones, popCount } from './pops'
import { criterionReport, fixed, formatReport, gateStatus, labelledPeaks, markers, printedBand, requireGate, requirement, requireSummary } from './report'

export const GESTURE_TIMING_VERSION = 1

/** Plan 2.2's C001 constants, fixed before any gesture code. */
const C = {
  hitShare: 0.7,
  hitSeconds: 0.2,
  minimumPeaks: 10,
  confirmSeconds: 0.05,
  confirmedShare: 0.9,
  minimumForms: 4,
  formDegrees: 10,
  oneHandShare: 0.5,
  twoHandLag: [0.03, 0.09] as const,
  orderShare: 0.9,
  unpromptedSeconds: 0.4,
}

/** Plan 2.2: required gate ids, fixed before any gesture code. */
export const C001_REQUIRED = ['gesture.strokeP', 'gesture.strokeLagMs', 'coverage.arms', 'bilateral.upperArm.peakCorr', 'bilateral.lowerArm.peakCorr', 'bilateral.hand.peakCorr', 'smooth.armL.spikeRate', 'smooth.armR.spikeRate', 'onset.easedOrAnticipated', 'fingers.frozen'] as const

export const GESTURE_TIMING_CONSTANTS: readonly ReportConstant[] = [
  { name: 'hit share', value: C.hitShare, unit: 'of labelled peaks', source: 'C001' },
  { name: 'hit window', value: C.hitSeconds, unit: 's either side', source: 'C001' },
  { name: 'minimum labelled peaks', value: C.minimumPeaks, unit: 'peaks', source: 'plan 2.2 guard 1 (gate emphasisMinimum)' },
  { name: 'marker confirmation window', value: C.confirmSeconds, unit: 's either side', source: 'plan 2.2: 3 frames at 60 Hz' },
  { name: 'confirmed marker share', value: C.confirmedShare, unit: 'of stroke markers', source: 'plan 2.2 guard 3' },
  { name: 'distinct forms', value: C.minimumForms, unit: 'forms', source: 'C001' },
  { name: 'form distinction', value: C.formDegrees, unit: 'deg in pronation, wrist flexion, index proximal curl or stroke direction', source: 'plan 2.2: half of 4a beat-chop pronation difference (20 deg)' },
  { name: 'one-hand stroke share', value: C.oneHandShare, unit: 'of stroke markers', source: 'plan 2.2: 4a 70 % one-hand units' },
  { name: 'two-hand apex lag', value: `${C.twoHandLag[0]}..${C.twoHandLag[1]}`, unit: 's', source: 'plan 2.2: 4a 40-70 ms non-dominant lag, one frame wider each side' },
  { name: 'preparation order share', value: C.orderShare, unit: 'of unit preparations', source: 'plan 2.2: goal-2 gaze-order precedent' },
  { name: 'unprompted apex window', value: C.unpromptedSeconds, unit: 's', source: 'gate strokeChanceSeconds' },
  { name: 'D_min', value: STROKE_CONSTANTS.minTravel.value, unit: STROKE_CONSTANTS.minTravel.unit, source: STROKE_CONSTANTS.minTravel.source },
  { name: 'apex window', value: STROKE_CONSTANTS.apexSeconds.value, unit: STROKE_CONSTANTS.apexSeconds.unit, source: STROKE_CONSTANTS.apexSeconds.source },
  { name: 'apex speed ratio', value: STROKE_CONSTANTS.apexRatio.value, unit: STROKE_CONSTANTS.apexRatio.unit, source: STROKE_CONSTANTS.apexRatio.source },
]

interface Apex {
  readonly side: Side
  readonly index: number
  readonly t: number
  readonly stroke: KinematicStroke
}

export interface StrokeMarker {
  readonly t: number
  readonly form: string
  readonly hand: string
  readonly unitSeq: number
  readonly confirmedBy: Apex | null
}

export interface FormFeatures {
  readonly pronationDeg: number
  readonly wristFlexDeg: number
  readonly indexCurlDeg: number | null
  readonly direction: Vec3
}

export interface GestureTimingDetail {
  readonly peaks: readonly { readonly t: number, readonly hit: boolean, readonly nearestApexMs: number | null }[]
  readonly apexes: readonly { readonly side: Side, readonly t: number }[]
  readonly unpromptedApexes: readonly number[]
  readonly markers: readonly StrokeMarker[]
  readonly forms: Readonly<Record<string, FormFeatures>>
  readonly distinctForms: readonly string[]
  readonly preparations: readonly { readonly unitSeq: number, readonly side: Side, readonly upperMs: number, readonly lowerMs: number, readonly handMs: number, readonly ordered: boolean }[]
  readonly pops: number
}

function local(p: LoadedRun['p'], child: MotionTraceBone, parent: MotionTraceBone, i: number): Quat | null {
  const c = p.orientations[child]?.[i]
  const q = p.orientations[parent]?.[i]
  return c && q ? multiply(conjugate(q), c) : null
}

function axisOf(run: LoadedRun, bone: MotionTraceBone): Vec3 | null {
  const index = run.input.trace.rig.bones.indexOf(bone)
  if (index < 0)
    return null
  const [x, y, z] = run.input.trace.rig.restOffsets[index]
  const n = Math.hypot(x, y, z)
  return n > 0 ? [x / n, y / n, z / n] : null
}

/**
 * Apex pose features, mirror-invariant: the hand's twist about the forearm (its rest offset), signed by the forearm's
 * lateral direction; the swing component about the forearm-cross-up axis (wrist flexion); the index proximal joint's
 * rotation angle; and the stroke direction from the stroke's start to its apex in the chest frame, x mirrored for the right.
 */
function features(run: LoadedRun, apex: Apex): FormFeatures | null {
  const { p } = run
  const { side, index } = apex
  const axis = axisOf(run, `${side}Hand`)
  const hand = local(p, `${side}Hand`, `${side}LowerArm`, index)
  const path = handPath(p, side)
  if (!axis || !hand || !path)
    return null
  const lateral = Math.sign(axis[0]) || 1
  const projection = hand[0] * axis[0] + hand[1] * axis[1] + hand[2] * axis[2]
  const twist = 2 * Math.atan2(projection, hand[3])
  const twistQ: Quat = [axis[0] * Math.sin(twist / 2), axis[1] * Math.sin(twist / 2), axis[2] * Math.sin(twist / 2), Math.cos(twist / 2)]
  const swing = multiply(hand, conjugate(twistQ))
  const flexAxis: Vec3 = [-axis[2], 0, axis[0]]
  const flexNorm = Math.hypot(...flexAxis) || 1
  const swingAngle = 2 * Math.atan2(Math.hypot(swing[0], swing[1], swing[2]), Math.abs(swing[3]))
  const swingScale = Math.hypot(swing[0], swing[1], swing[2]) > 1e-12 ? swingAngle * Math.sign(swing[3] || 1) / Math.hypot(swing[0], swing[1], swing[2]) : 0
  const wristFlex = (swing[0] * flexAxis[0] + swing[2] * flexAxis[2]) * swingScale / flexNorm
  const index0 = local(p, `${side}IndexProximal`, `${side}Hand`, index)
  const from = path.position[apex.stroke.start]
  const to = path.position[index]
  const d = sub(to, from)
  const n = norm(d) || 1
  return {
    pronationDeg: lateral * twist * DEG,
    wristFlexDeg: wristFlex * DEG,
    indexCurlDeg: index0 ? 2 * Math.acos(Math.min(1, Math.abs(index0[3]))) * DEG : null,
    direction: [(side === 'right' ? -1 : 1) * d[0] / n, d[1] / n, d[2] / n],
  }
}

function medianFeatures(list: readonly FormFeatures[]): FormFeatures {
  const curls = list.flatMap(f => f.indexCurlDeg === null ? [] : [f.indexCurlDeg])
  const d: Vec3 = [median(list.map(f => f.direction[0])), median(list.map(f => f.direction[1])), median(list.map(f => f.direction[2]))]
  const n = norm(d) || 1
  return {
    pronationDeg: median(list.map(f => f.pronationDeg)),
    wristFlexDeg: median(list.map(f => f.wristFlexDeg)),
    indexCurlDeg: curls.length ? median(curls) : null,
    direction: [d[0] / n, d[1] / n, d[2] / n],
  }
}

/** Plan 2.2: two forms are distinct when their median apex poses differ by at least 10 deg in at least one feature. */
export function formsDiffer(a: FormFeatures, b: FormFeatures): boolean {
  const cos = Math.max(-1, Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2]))
  return Math.abs(a.pronationDeg - b.pronationDeg) >= C.formDegrees
    || Math.abs(a.wristFlexDeg - b.wristFlexDeg) >= C.formDegrees
    || (a.indexCurlDeg !== null && b.indexCurlDeg !== null && Math.abs(a.indexCurlDeg - b.indexCurlDeg) >= C.formDegrees)
    || Math.acos(cos) * DEG >= C.formDegrees
}

/** The largest set of forms that differ pairwise (exhaustive over subsets; there are at most eight forms). */
export function largestDistinctSet(forms: Readonly<Record<string, FormFeatures>>): string[] {
  const names = Object.keys(forms).sort()
  let best: string[] = []
  for (let mask = 1; mask < 1 << names.length; mask++) {
    const set = names.filter((_, i) => mask & (1 << i))
    if (set.length > best.length && set.every((a, i) => set.slice(i + 1).every(b => formsDiffer(forms[a], forms[b]))))
      best = set
  }
  return best
}

/** Time of the peak relative angular speed (gate O15, relative to the parent) of a bone in [start, end). */
function peakTime(run: LoadedRun, bone: MotionTraceBone, start: number, end: number): number | null {
  const series = run.p.o15[bone]
  if (!series || end <= start)
    return null
  let best = start
  for (let i = start; i < end; i++) {
    if (norm(series[i]) > norm(series[best]))
      best = i
  }
  return run.p.times[best]
}

/** C001 criterion-level report (plan 2.2): every rule and constant fixed before any gesture code. */
export function gestureTimingReport(run: LoadedRun, bands: MotionBandsFile): CriterionReport<GestureTimingDetail> {
  const summary = requireSummary(run)
  const gate = requireGate(run)
  const { p } = run
  const apexes: Apex[] = SIDES.flatMap((side) => {
    const path = handPath(p, side)
    return path ? kinematicStrokes(path).flatMap(stroke => stroke.apex === null ? [] : [{ side, index: stroke.apex, t: p.times[stroke.apex], stroke }]) : []
  }).sort((a, b) => a.t - b.t)
  const peaks = labelledPeaks(run).map((t) => {
    const nearest = apexes.reduce<Apex | null>((best, a) => !best || Math.abs(a.t - t) < Math.abs(best.t - t) ? a : best, null)
    const lag = nearest ? nearest.t - t : null
    return { t, hit: lag !== null && Math.abs(lag) <= C.hitSeconds + 1e-9, nearestApexMs: lag === null ? null : lag * 1000 }
  })
  const hits = peaks.filter(peak => peak.hit).length
  const unprompted = apexes.filter(a => !peaks.some(peak => Math.abs(a.t - peak.t) <= C.unpromptedSeconds)).map(a => a.t)
  const near = (t: number, sides: readonly Side[], window: number) => apexes.filter(a => sides.includes(a.side) && Math.abs(a.t - t) <= window + 1e-9).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0] ?? null
  const strokeMarkers: StrokeMarker[] = markers(run, 'gesture-stroke:').map(({ t, parts: [form, hand, unit] }) => {
    const sides: Side[] = hand === 'both' ? ['left', 'right'] : hand === 'left' || hand === 'right' ? [hand] : []
    return { t, form, hand, unitSeq: Number(unit), confirmedBy: near(t, sides, C.confirmSeconds) }
  })
  const confirmed = strokeMarkers.filter(m => m.confirmedBy)
  const byForm = new Map<string, FormFeatures[]>()
  for (const marker of confirmed) {
    const f = marker.confirmedBy ? features(run, marker.confirmedBy) : null
    if (f)
      byForm.set(marker.form, [...byForm.get(marker.form) ?? [], f])
  }
  const forms = Object.fromEntries([...byForm].map(([form, list]) => [form, medianFeatures(list)]))
  const distinct = largestDistinctSet(forms)
  const twoHand = strokeMarkers.filter(m => m.hand === 'both')
  const twoHandOk = twoHand.every((m) => {
    const left = near(m.t, ['left'], C.hitSeconds)
    const right = near(m.t, ['right'], C.hitSeconds)
    const lag = left && right ? Math.abs(left.t - right.t) : null
    return lag !== null && lag >= C.twoHandLag[0] - 1e-9 && lag <= C.twoHandLag[1] + 1e-9
  })
  const units = markers(run, 'gesture-unit:').filter(m => m.parts[0] === 'start')
  const preparations = units.flatMap((unit, k) => {
    const next = units[k + 1]?.t ?? Number.POSITIVE_INFINITY
    const first = strokeMarkers.find(m => m.t > unit.t && m.t < next)
    if (!first)
      return []
    const sides: Side[] = first.hand === 'both' ? ['left', 'right'] : first.hand === 'left' || first.hand === 'right' ? [first.hand] : []
    const start = p.times.findIndex(t => t >= unit.t)
    return sides.map((side) => {
      const apex = first.confirmedBy?.side === side ? first.confirmedBy : near(first.t, [side], C.confirmSeconds)
      const end = apex ? apex.stroke.start : -1
      const upper = peakTime(run, `${side}UpperArm`, start, end)
      const lower = peakTime(run, `${side}LowerArm`, start, end)
      const hand = peakTime(run, `${side}Hand`, start, end)
      const ordered = upper !== null && lower !== null && hand !== null && upper < lower && lower < hand
      const ms = (t: number | null) => t === null ? Number.NaN : (t - unit.t) * 1000
      return { unitSeq: first.unitSeq, side, upperMs: ms(upper), lowerMs: ms(lower), handMs: ms(hand), ordered }
    })
  })
  const pops = popCount(p, armPopBones)
  const penetration = Math.max(0, ...summary.perFrame.penL, ...summary.perFrame.penR)
  const corrector = summary.corrector
  const bilateral = gate.metrics.filter(m => m.id.startsWith('bilateral.') && m.band?.status === 'GATED')
  const ldlj = (['smooth.armL.ldlj', 'smooth.armR.ldlj'] as const).map((id) => {
    const band = printedBand(bands, 'talk', id)
    const { value } = gateStatus(gate, id)
    return { id, value, band, inside: value !== null && band.lo !== null && band.hi !== null && value >= band.lo && value <= band.hi }
  })
  const requirements = [
    requirement('peaks', `labelled peaks in the scored span >= ${C.minimumPeaks}`, `${peaks.length}`, peaks.length >= C.minimumPeaks),
    requirement('peaks-hit', `hits / peaks >= ${C.hitShare}, a hit being a kinematic apex within ${C.hitSeconds * 1000} ms`, `${hits}/${peaks.length} = ${fixed(peaks.length ? hits / peaks.length : null)}`, peaks.length > 0 && hits / peaks.length >= C.hitShare),
    requirement('markers-confirmed', `stroke markers with an apex of their hand within ${C.confirmSeconds * 1000} ms >= ${C.confirmedShare}`, `${confirmed.length}/${strokeMarkers.length}`, strokeMarkers.length > 0 && confirmed.length / strokeMarkers.length >= C.confirmedShare),
    requirement('forms', `>= ${C.minimumForms} confirmed forms differing pairwise by >= ${C.formDegrees} deg in one apex feature`, `${distinct.length} (${distinct.join(', ') || 'none'}) of ${Object.keys(forms).length} confirmed forms`, distinct.length >= C.minimumForms),
    requirement('bilateral', 'every gated bilateral.*.peakCorr PASS in gate.json', bilateral.map(m => `${m.id} ${m.status}`).join(', ') || 'no gated bilateral metric', bilateral.length > 0 && bilateral.every(m => m.status === 'PASS')),
    requirement('one-hand', `one-hand stroke markers >= ${C.oneHandShare} of markers`, `${strokeMarkers.length - twoHand.length}/${strokeMarkers.length}`, strokeMarkers.length > 0 && (strokeMarkers.length - twoHand.length) / strokeMarkers.length >= C.oneHandShare),
    requirement('two-hand-lag', `every two-hand stroke's left and right apexes ${C.twoHandLag[0] * 1000}-${C.twoHandLag[1] * 1000} ms apart`, `${twoHand.length} two-hand strokes`, twoHandOk),
    requirement('preparation-order', `upper arm, then lower arm, then hand peak speed in >= ${C.orderShare} of unit preparations`, `${preparations.filter(x => x.ordered).length}/${preparations.length}`, preparations.length > 0 && preparations.filter(x => x.ordered).length / preparations.length >= C.orderShare),
    requirement('penetration', 'max(perFrame.penL, perFrame.penR) = 0', fixed(penetration, 6), penetration === 0),
    requirement('pops', 'arm pop count (plan 2.6) = 0', `${pops}`, pops === 0),
    requirement('corrector', 'capHits = guardScans = holds = 0 in summary.json', corrector ? `capHits ${corrector.capHits}, guardScans ${corrector.guardScans}, holds ${summary.collisions.count}` : 'summary has no corrector block', !!corrector && corrector.capHits === 0 && corrector.guardScans === 0 && summary.collisions.count === 0),
    requirement('gate-required', 'every C001 required gate id PASS in gate.json', C001_REQUIRED.map(id => `${id} ${gateStatus(gate, id).status}`).join(', '), C001_REQUIRED.every(id => gateStatus(gate, id).status === 'PASS')),
    requirement('arm-ldlj', 'smooth.armL/R.ldlj inside the printed pooled talk band', ldlj.map(x => `${x.id} ${fixed(x.value)} [${fixed(x.band.lo, 2)}, ${fixed(x.band.hi, 2)}]`).join(', '), ldlj.every(x => x.inside)),
  ]
  return criterionReport('gesture-timing', GESTURE_TIMING_VERSION, [run.dir], GESTURE_TIMING_CONSTANTS, requirements, {
    peaks,
    apexes: apexes.map(a => ({ side: a.side, t: a.t })),
    unpromptedApexes: unprompted,
    markers: strokeMarkers,
    forms,
    distinctForms: distinct,
    preparations,
    pops,
  })
}

export function formatGestureTiming(report: CriterionReport<GestureTimingDetail>): string {
  const d = report.detail
  return formatReport(report, [
    'labelled peaks: t s, nearest apex ms, hit',
    ...d.peaks.map(x => `  ${x.t.toFixed(3)}\t${fixed(x.nearestApexMs, 1)}\t${x.hit ? 'hit' : 'miss'}`),
    `kinematic apexes: ${d.apexes.length} (left ${d.apexes.filter(a => a.side === 'left').length}, right ${d.apexes.filter(a => a.side === 'right').length}); unprompted (no peak within 400 ms): ${d.unpromptedApexes.length}`,
    'stroke markers: t s, form, hand, unit, confirmed by',
    ...d.markers.map(m => `  ${m.t.toFixed(3)}\t${m.form}\t${m.hand}\t${m.unitSeq}\t${m.confirmedBy ? `${m.confirmedBy.side} apex ${m.confirmedBy.t.toFixed(3)}` : '-'}`),
    'median apex features per confirmed form: pronation deg, wrist flexion deg, index curl deg, direction',
    ...Object.entries(d.forms).map(([form, f]) => `  ${form}\t${fixed(f.pronationDeg, 1)}\t${fixed(f.wristFlexDeg, 1)}\t${fixed(f.indexCurlDeg, 1)}\t[${f.direction.map(v => v.toFixed(2)).join(', ')}]`),
    'unit preparations: unit, side, peak upper arm / lower arm / hand ms after the unit start, ordered',
    ...d.preparations.map(x => `  ${x.unitSeq}\t${x.side}\t${fixed(x.upperMs, 0)} / ${fixed(x.lowerMs, 0)} / ${fixed(x.handMs, 0)}\t${x.ordered ? 'yes' : 'no'}`),
  ])
}
