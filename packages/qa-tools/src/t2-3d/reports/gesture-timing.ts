import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionBandsFile } from '../gate/types'
import type { PreparedTrace, Quat, Vec3 } from '../metrics'
import type { KinematicStroke, Side } from './kinematics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { percentile } from '../gate/bands'
import { describeOutside } from '../gate/meaning'
import { conjugate, DEG, HZ, median, multiply, norm, sub } from '../metrics/math'
import { NOT_FROZEN_DIP, notFrozen, STAGE_CHARACTER_HEIGHT_DIP, stageDipPerUnit } from '../metrics/not-frozen'
import { handPath, kinematicStrokes, SIDES, STROKE_CONSTANTS, traceParent } from './kinematics'
import { popCount, upperBodyPopBones } from './pops'
import { criterionReport, fixed, formatReport, gateStatus, labelledPeaks, markers, printedBand, ReportUsageError, requireGate, requirement, requireSummary } from './report'

export const GESTURE_TIMING_VERSION = 6

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
  trunkShare: 0.7,
  strokeSeconds: 0.25,
  placeboPercentile: 0.95,
  minimumPlacebo: 20,
  lockShare: 0.1,
  peakClearance: 1,
  shiftSteps: [0.1, 0.1 * Math.SQRT2] as const,
  shiftMinimum: 0.25,
  shiftStrokes: 5,
  shiftOffsets: 5,
  shiftPercentile: 0.9,
  lockMargin: 0.5191,
  seedLockFloor: 0.3052,
  sizeDip: 1.882,
  speakScenario: 'speak',
  speakSeeds: [1, 2, 3] as const,
  idleScenario: 'idle',
  idleSeeds: [1, 2, 3] as const,
  idleScoredSeconds: 120,
  silentClearance: 1,
  idlePercentile: 0.95,
  minimumIdleApexes: 20,
}

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
  { name: 'trunk participation share', value: C.trunkShare, unit: 'of hit peaks', source: 'unit M2 R2 (b), the C001 hit share' },
  { name: 'stroke window', value: `stroke apex - ${C.strokeSeconds} .. stroke apex`, unit: 's', source: 'architecture 4a: longest stroke 250 ms; the stroke apex is the apex within the hit window that confirms a stroke marker, else the peak is a miss (lane T ruling)' },
  { name: 'placebo window', value: `${C.strokeSeconds} s grid over the scored spans of the companion idle runs`, unit: 's', source: 'lane T ruling: the rig\'s idle trunk turns, as the idle speed bar; not the speak run\'s silent stretches' },
  { name: 'placebo band', value: C.placeboPercentile, unit: 'percentile of placebo upper-torso displacement', source: 'unit M2 R2 (b)' },
  { name: 'minimum placebo windows', value: C.minimumPlacebo, unit: 'windows, for the idle placebo and for the speak run\'s peak-free windows', source: 'unit M2 R2 (b): a 95th percentile needs at least 20 samples' },
  { name: 'peak-free share (report only)', value: C.lockShare, unit: `of the speak run's own ${C.strokeSeconds} s grid windows with no labelled peak within ${C.peakClearance} s whose upper-torso turn exceeds the idle placebo p95; printed, judged only before version 6, so trunk motion in pauses is not judged`, source: 'revision 2 (review T1); version 6 (lane T6 revision 3, ruling 2): the locking statistic fails every labelled fault the cap failed except half-size turns against a calm idle, which the size line fails; lane T6 revision 4: no cap on the windows outside utterances separated labelled pause sway from labelled correct slow sway; by the owner\'s ruling "Pause sway: Visual review", trunk motion in the pauses between utterances is not judged by this report but by an independent visual review' },
  { name: 'speak companions', value: `${C.speakScenario} seeds ${C.speakSeeds.join(', ')}, one each, the judged run among them, of its model and commit`, unit: 'else the run is refused', source: 'version 6 (lane T6 revision 3, ruling 3): locking and size are pooled over the three seeds (about 45 judged strokes); per run, their margins on labelled cases were under one judged stroke; by the owner\'s ruling "Seed pooling: Three seeds together" (2026-11-12), the trunk lines (trunk-locking, trunk-seed-locking, trunk-size) judge the three seeds together as one sample of about 45 judged strokes, and every other line is judged per seed' },
  { name: 'locking shift', value: `+/- round(${HZ} m x ${C.shiftSteps.map(s => fixed(s, 4)).join(' or ')}) / ${HZ}`, unit: `s for m >= 1, at least ${C.shiftMinimum} s: a judged stroke's span [start, apex] and turn window moved by whole frames inside its utterance, off every other counted stroke's span; offsets of at least ${C.shiftStrokes} shifted strokes count, at least ${C.shiftOffsets} of them`, source: 'lane T6 revision 2, family N: the time-shift null (the same strokes, the same utterances, another time); revision 4 (O3): two incommensurate steps, because on one 0.25 s grid a 2 Hz sway turns the same at every offset and passed on correct turns (review of version 6, blocker 2)' },
  { name: 'locking margin', value: C.lockMargin, unit: `at least: the pooled share of judged stroke turns above the idle placebo p95 minus the p${C.shiftPercentile * 100} of that share over the shifted offsets`, source: 'lane T6 revision 4 (N-b pooled, O3): midpoint of the most locked-looking labelled fault (0.4702: the product\'s turns plus a 10 Hz edge-size speech-time sway, per-seed phases) and the least locked labelled correct motion (0.5682: the product with a slow 0.1 Hz whole-run sway); 2.2 judged strokes either side, about one sampling standard deviation of a 45-stroke share (about 0.045)' },
  { name: 'per-seed locking floor', value: C.seedLockFloor, unit: 'at least: the same statistic on the judged run alone, its own judged strokes and its own shifted offsets', source: 'lane T6 revision 4 (FL-mid, O3): midpoint of the most locked-looking unlocked seed pooled with two product seeds (0.1905) and the least locked labelled correct seed (0.4200); 1.7 judged strokes of 15 either side; one unlocked seed beside two locked ones passed the pooled line alone (review of version 6, blocker 1). The floor fails only a seed without stroke-locked turns: a seed that keeps its turns while carrying half-size turns or an unlocked sway up to about 1.5 times the edge size reads 0.31 to 0.40 and can pass beside two good seeds, and two such seeds of three can pass the pooled line; size is not judged per seed (confirmation review 2 of version 6, gesture-timing-v6-review-2.md, blocker 1)' },
  { name: 'trunk size', value: C.sizeDip, unit: `DIP at the default ${STAGE_CHARACTER_HEIGHT_DIP} DIP character height, at least: the pooled median judged stroke turn times the shoulder line's DIP per degree (the upper-arm root's horizontal radius about the torso bone)`, source: 'lane T6 revision 3 (SZ-P pooled): midpoint of 0.6 of the design trunk pulse on Chisa (1.858 DIP, labelled a fault) and 0.7 on Ellen (1.906 DIP, labelled correct); about 0.61 of the design on Chisa and 0.69 on Ellen, 0.024 DIP (about 1 % of the design) either side' },
  { name: 'idle companions', value: `${C.idleScenario} seeds ${C.idleSeeds.join(', ')}, one each, ${C.idleScoredSeconds} s scored`, unit: 'else the run is refused', source: 'revision 2: the companions version 4\'s bars were measured on (lead acceptance runs); the trunk bar moves with the idle seed and with the rest redraw at 70 s' },
  { name: 'idle speed bar', value: C.idlePercentile, unit: 'percentile of the candidate-apex peak hand speeds pooled over companion idle runs of the same model and commit', source: 'unit M3 item 1, lead ruling: detectability above the rig\'s idle noise' },
  { name: 'silent span', value: `no utterance within ${C.silentClearance} s`, unit: 's', source: 'unit M3 item 1' },
  { name: 'minimum idle apexes', value: C.minimumIdleApexes, unit: 'pooled apexes, else the run is refused as unjudgeable', source: 'unit M3 item 1' },
  { name: 'not-frozen displacement', value: NOT_FROZEN_DIP.arm, unit: `DIP at the default ${STAGE_CHARACTER_HEIGHT_DIP} DIP character height: median over 5 s windows of the p95 displacement of the wrist in the shoulder frame; an arm too unscorable for arm-ldlj is frozen below it`, source: 'gate version 4 (lane U revision 3, candidate K5-r): geometric mean of the worst frozen (0.550 DIP, an 8 Hz tremor at the 1 DIP visibility edge) and worst alive (5.823 DIP, a real idle arm) labelled readings; it fails a frozen arm whose hand moves under about 1.8 DIP and a rigid arm carried by its shoulder; no human reference sets it' },
  { name: 'D_min', value: STROKE_CONSTANTS.minTravel.value, unit: STROKE_CONSTANTS.minTravel.unit, source: STROKE_CONSTANTS.minTravel.source },
  { name: 'apex window', value: STROKE_CONSTANTS.apexSeconds.value, unit: STROKE_CONSTANTS.apexSeconds.unit, source: STROKE_CONSTANTS.apexSeconds.source },
  { name: 'apex speed ratio', value: STROKE_CONSTANTS.apexRatio.value, unit: STROKE_CONSTANTS.apexRatio.unit, source: STROKE_CONSTANTS.apexRatio.source },
]

export interface Apex {
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
  readonly idle: { readonly companions: readonly { readonly dir: string, readonly gitSha: string | null, readonly seed: number | null, readonly apexes: number }[], readonly pooled: number, readonly speedBar: number, readonly silentSeconds: number, readonly silentApexes: number, readonly candidates: number, readonly counted: number }
  readonly peaks: readonly { readonly t: number, readonly hit: boolean, readonly nearestApexMs: number | null }[]
  readonly utterances: readonly { readonly start: number, readonly end: number, readonly apexes: number }[]
  readonly trunk: {
    readonly torso: MotionTraceBone | null
    readonly hits: readonly TrunkHit[]
    readonly placeboWindows: number
    readonly placeboP95Deg: number | null
    /** The run's own peak-free windows above the idle bar, report only since version 6. */
    readonly lock: { readonly windows: number, readonly above: number }
    /** Version 6, pooled over the speak seeds: judged stroke turns above the bar against the same strokes shifted in time. */
    readonly locking: Locking
    /** Version 6, the judged run alone: the same statistic over its own strokes, held to the per-seed floor. */
    readonly seedLocking: Locking
    /** Version 6, pooled over the speak seeds: the median judged stroke turn and its shoulder-line displacement. */
    readonly size: { readonly judged: number, readonly medianDeg: number | null, readonly dipPerDegree: number | null, readonly medianDip: number | null }
  }
  readonly gated: readonly { readonly id: string, readonly status: string, readonly value: number | null }[]
  readonly reportOnly: readonly { readonly id: string, readonly status: string, readonly value: number | null }[]
  readonly apexes: readonly { readonly side: Side, readonly t: number }[]
  readonly unpromptedApexes: readonly number[]
  readonly markers: readonly StrokeMarker[]
  readonly forms: Readonly<Record<string, FormFeatures>>
  readonly distinctForms: readonly string[]
  readonly preparations: readonly { readonly unitSeq: number, readonly side: Side, readonly upperMs: number, readonly lowerMs: number, readonly handMs: number, readonly ordered: boolean }[]
  readonly pops: number
}

interface Locking { readonly seeds: number, readonly judged: number, readonly above: number, readonly offsets: number, readonly shiftedP90: number | null, readonly statistic: number | null }
interface TrunkHit { readonly peak: number, readonly apex: number | null, readonly displacementDeg: number | null }
interface Utterance { readonly start: number, readonly end: number, readonly apexes: number }

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
 * rotation angle; and the stroke direction from the stroke's start to its apex in the trunk-parent frame, x mirrored for the right.
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

function candidateApexes(run: LoadedRun): Apex[] {
  const { p } = run
  return SIDES.flatMap((side) => {
    const path = handPath(p, side)
    return path ? kinematicStrokes(path).flatMap(stroke => stroke.apex === null ? [] : [{ side, index: stroke.apex, t: p.times[stroke.apex], stroke }]) : []
  }).sort((a, b) => a.t - b.t)
}

/**
 * Unit M3 item 1 (lead ruling): every candidate apex (trunk-parent frame, `D_min`, apex window) of the judged run and
 * the strokes among them, those whose peak hand speed exceeds the 95th percentile of the candidate apexes pooled over
 * companion idle runs of the same model and commit. Refuses with fewer than 20 pooled idle apexes or a companion of
 * another model or commit. The judged run's own silent-span apexes (no utterance within 1 s) are counted, report only.
 */
export function strokeApexes(run: LoadedRun, idleRuns: readonly LoadedRun[]) {
  const { p } = run
  const { rig, source } = run.input.trace
  for (const idle of idleRuns) {
    if (idle.input.trace.rig.assetSha256 !== rig.assetSha256)
      throw new ReportUsageError(`${idle.dir}: companion idle run of another model (${idle.input.trace.rig.assetSha256} against ${rig.assetSha256})`)
    if (idle.input.trace.source.gitSha !== source.gitSha)
      throw new ReportUsageError(`${idle.dir}: companion idle run at another commit (${idle.input.trace.source.gitSha} against ${source.gitSha})`)
  }
  const idleApexes = idleRuns.map(idle => candidateApexes(idle).filter(a => a.t >= idle.input.trace.scoredFrom))
  const pooled = idleApexes.flat()
  if (pooled.length < C.minimumIdleApexes)
    throw new ReportUsageError(`${run.dir}: unjudgeable, ${pooled.length} idle apexes pooled over ${idleRuns.length} companion idle runs; the idle speed bar needs ${C.minimumIdleApexes}, run more idle seeds`)
  const speedBar = percentile(pooled.map(a => a.stroke.peakSpeed), C.idlePercentile)
  const candidates = candidateApexes(run)
  const { scoredFrom: scored, events: traceEvents } = run.input.trace
  const speaking = traceEvents.flatMap((e) => {
    if (e.kind !== 'marker' || e.label !== 'voice-start')
      return []
    const end = traceEvents.find(x => x.kind === 'marker' && x.label === 'voice-end' && x.t > e.t)?.t ?? p.times[p.times.length - 1]
    return [[e.t - C.silentClearance, end + C.silentClearance] as const]
  })
  const silent = (t: number) => t >= scored && !speaking.some(([from, to]) => t >= from && t <= to)
  return {
    candidates,
    silentApexes: candidates.filter(a => silent(a.t)).length,
    silentSeconds: p.times.filter(silent).length / HZ,
    companions: idleRuns.map((idle, i) => ({ dir: idle.dir, gitSha: idle.input.trace.source.gitSha, seed: idle.input.trace.source.scenario.seed, apexes: idleApexes[i].length })),
    pooled: pooled.length,
    speedBar,
    apexes: candidates.filter(a => a.stroke.peakSpeed > speedBar),
  }
}

/**
 * Unit M2 R2 (b): the angle, degrees, by which the upper torso (the bone the shoulders hang from) turns relative to the
 * hips between two trace times. Null outside the trace or without the bones.
 */
function torsoDisplacement(p: PreparedTrace, bone: MotionTraceBone | null, from: number, to: number): number | null {
  const torso = bone ? p.orientations[bone] : undefined
  const hips = p.orientations.hips
  const i = Math.round((from - p.times[0]) * HZ)
  const j = Math.round((to - p.times[0]) * HZ)
  if (!torso || !hips || i < 0 || j >= p.times.length)
    return null
  const turn = multiply(conjugate(multiply(conjugate(hips[i]), torso[i])), multiply(conjugate(hips[j]), torso[j]))
  return 2 * Math.acos(Math.min(1, Math.abs(turn[3]))) * DEG
}

/** Labelled peaks, each a hit when a counted stroke apex lies within the hit window. */
function hitPeaks(run: LoadedRun, apexes: readonly Apex[]) {
  return labelledPeaks(run).map((t) => {
    const nearest = apexes.reduce<Apex | null>((best, a) => !best || Math.abs(a.t - t) < Math.abs(best.t - t) ? a : best, null)
    const lag = nearest ? nearest.t - t : null
    return { t, hit: lag !== null && Math.abs(lag) <= C.hitSeconds + 1e-9, nearestApexMs: lag === null ? null : lag * 1000 }
  })
}

function nearestApex(apexes: readonly Apex[], t: number, sides: readonly Side[], window: number): Apex | null {
  return apexes.filter(a => sides.includes(a.side) && Math.abs(a.t - t) <= window + 1e-9).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0] ?? null
}

function strokeMarkersOf(run: LoadedRun, apexes: readonly Apex[]): StrokeMarker[] {
  return markers(run, 'gesture-stroke:').map(({ t, parts: [form, hand, unit] }) => {
    const sides: Side[] = hand === 'both' ? ['left', 'right'] : hand === 'left' || hand === 'right' ? [hand] : []
    return { t, form, hand, unitSeq: Number(unit), confirmedBy: nearestApex(apexes, t, sides, C.confirmSeconds) }
  })
}

/** The scored span's utterances, voice-start to the next voice-end, with the counted stroke apexes inside each. */
function utterancesOf(run: LoadedRun, apexes: readonly Apex[]): Utterance[] {
  const { p } = run
  const { scoredFrom, events } = run.input.trace
  const voiceEnds = events.filter(e => e.kind === 'marker' && e.label === 'voice-end')
  return events.flatMap((e) => {
    if (e.kind !== 'marker' || e.label !== 'voice-start' || e.t < scoredFrom)
      return []
    const end = voiceEnds.find(x => x.t > e.t)?.t ?? p.times[p.times.length - 1]
    return [{ start: e.t, end, apexes: apexes.filter(a => a.t >= e.t && a.t <= end).length }]
  })
}

/** Each hit peak's turn over its stroke window; the stroke apex confirms a stroke marker within the hit window, else a miss. */
function trunkHitsOf(p: PreparedTrace, torso: MotionTraceBone | null, peaks: ReturnType<typeof hitPeaks>, strokeMarkers: readonly StrokeMarker[]): TrunkHit[] {
  const strokeApexTimes = strokeMarkers.flatMap(m => m.confirmedBy ? [m.confirmedBy.t] : [])
  return peaks.filter(peak => peak.hit).map((peak) => {
    const apex = strokeApexTimes.filter(t => Math.abs(t - peak.t) <= C.hitSeconds + 1e-9).sort((a, b) => Math.abs(a - peak.t) - Math.abs(b - peak.t))[0] ?? null
    return { peak: peak.t, apex, displacementDeg: apex === null ? null : torsoDisplacement(p, torso, apex - C.strokeSeconds, apex) }
  })
}

/**
 * Version 6, the shift offsets in whole frames up to `maxFrames`: both signs of every multiple of each step, rounded to a
 * frame, at least the minimum shift. Two incommensurate steps leave no periodic sway the same at every offset.
 */
function shiftFrames(maxFrames: number): number[] {
  const frames = new Set<number>()
  for (const step of C.shiftSteps) {
    for (let m = 1; Math.round(HZ * m * step) <= maxFrames; m++) {
      const q = Math.round(HZ * m * step)
      if (q >= C.shiftMinimum * HZ)
        frames.add(q).add(-q)
    }
  }
  return [...frames]
}

/**
 * Version 6, the time-shift null: each judged stroke moved by every shift offset with its span [start, apex] and its
 * turn window inside the apex's utterance and off every other counted stroke's span; per offset, the shifted strokes
 * admitted and those whose turn exceeds the idle bar.
 */
function shiftedTurns(p: PreparedTrace, torso: MotionTraceBone | null, apexes: readonly Apex[], utterances: readonly Utterance[], hits: readonly TrunkHit[], bar: number): Map<number, { admitted: number, above: number }> {
  const spans = apexes.map(a => [p.times[a.stroke.start], a.t] as const)
  const counts = new Map<number, { admitted: number, above: number }>()
  for (const { apex, displacementDeg } of hits) {
    const k = apex === null ? -1 : spans.findIndex(([, t]) => Math.abs(t - apex) < 1e-9)
    const u = utterances.find(x => apex !== null && apex >= x.start && apex <= x.end)
    if (apex === null || displacementDeg === null || k < 0 || !u)
      continue
    const start = spans[k][0]
    for (const frames of shiftFrames(Math.ceil((u.end - u.start) * HZ) + 1)) {
      const d = frames / HZ
      if (Math.min(start, apex - C.strokeSeconds) + d < u.start || apex + d > u.end || spans.some(([from, to], m) => m !== k && start + d < to && apex + d > from))
        continue
      const turn = torsoDisplacement(p, torso, apex + d - C.strokeSeconds, apex + d)
      if (turn === null)
        continue
      const count = counts.get(frames) ?? { admitted: 0, above: 0 }
      count.admitted++
      count.above += turn > bar ? 1 : 0
      counts.set(frames, count)
    }
  }
  return counts
}

interface TrunkSample { readonly turns: readonly number[], readonly shifted: ReadonlyMap<number, { readonly admitted: number, readonly above: number }> }

function trunkSample(p: PreparedTrace, torso: MotionTraceBone | null, apexes: readonly Apex[], utterances: readonly Utterance[], hits: readonly TrunkHit[], bar: number | null): TrunkSample {
  return {
    turns: hits.flatMap(h => h.apex === null || h.displacementDeg === null ? [] : [h.displacementDeg]),
    shifted: bar === null ? new Map() : shiftedTurns(p, torso, apexes, utterances, hits, bar),
  }
}

/** A sibling speak seed's trunk sample, read exactly as the judged run's. */
function siblingSample(run: LoadedRun, idleRuns: readonly LoadedRun[], bar: number | null): TrunkSample {
  const { apexes } = strokeApexes(run, idleRuns)
  const torso = traceParent(run.p, 'leftShoulder')
  const hits = trunkHitsOf(run.p, torso, hitPeaks(run, apexes), strokeMarkersOf(run, apexes))
  return trunkSample(run.p, torso, apexes, utterancesOf(run, apexes), hits, bar)
}

/** Version 6 locking: the pooled share of judged turns above the bar minus the p90 share over the shifted offsets. */
function lockingOf(samples: readonly TrunkSample[], bar: number | null): Locking {
  const turns = samples.flatMap(s => s.turns)
  const above = bar === null ? 0 : turns.filter(d => d > bar).length
  const pooled = new Map<number, { admitted: number, above: number }>()
  for (const sample of samples) {
    for (const [step, count] of sample.shifted) {
      const sum = pooled.get(step) ?? { admitted: 0, above: 0 }
      pooled.set(step, { admitted: sum.admitted + count.admitted, above: sum.above + count.above })
    }
  }
  const shares = [...pooled.values()].filter(c => c.admitted >= C.shiftStrokes).map(c => c.above / c.admitted)
  const shiftedP90 = shares.length >= C.shiftOffsets ? percentile(shares, C.shiftPercentile) : null
  const statistic = bar !== null && turns.length > 0 && shiftedP90 !== null ? above / turns.length - shiftedP90 : null
  return { seeds: samples.length, judged: turns.length, above, offsets: shares.length, shiftedP90, statistic }
}

/** DIP per degree of torso yaw at the shoulder line: the upper-arm root's horizontal radius about the torso bone, at the default stage scale. */
function shoulderDipPerDegree(rig: LoadedRun['input']['trace']['rig'], torso: MotionTraceBone | null): number | null {
  const { bones, parents, restOffsets } = rig
  const position = (b: number): number[] => {
    const at = [0, 0, 0]
    for (let i = b; i >= 0; i = parents[i]) {
      for (let c = 0; c < 3; c++)
        at[c] += restOffsets[i][c]
    }
    return at
  }
  const pivot = torso ? bones.indexOf(torso) : -1
  const shoulder = bones.indexOf('leftUpperArm')
  const dipPerUnit = stageDipPerUnit(rig)
  if (pivot < 0 || shoulder < 0 || dipPerUnit <= 0)
    return null
  const [a, b] = [position(pivot), position(shoulder)]
  return Math.hypot(b[0] - a[0], b[2] - a[2]) * dipPerUnit / DEG
}

/**
 * Version 6: the trunk is pooled over the `speak` scenario's seeds 1, 2 and 3, one each, of the judged run's model and
 * commit, the judged run among them; any other set is refused.
 */
function requireSpeakSeeds(run: LoadedRun, speakRuns: readonly LoadedRun[]): void {
  const { rig, source } = run.input.trace
  for (const speak of speakRuns) {
    const trace = speak.input.trace
    if (trace.source.scenario.id !== C.speakScenario)
      throw new ReportUsageError(`${speak.dir}: speak companion of scenario ${trace.source.scenario.id}; the trunk is pooled over ${C.speakScenario} runs`)
    if (trace.rig.assetSha256 !== rig.assetSha256)
      throw new ReportUsageError(`${speak.dir}: speak companion of another model (${trace.rig.assetSha256} against ${rig.assetSha256})`)
    if (trace.source.gitSha !== source.gitSha)
      throw new ReportUsageError(`${speak.dir}: speak companion at another commit (${trace.source.gitSha} against ${source.gitSha})`)
  }
  const seeds = speakRuns.map(speak => speak.input.trace.source.scenario.seed).sort((a, b) => (a ?? 0) - (b ?? 0))
  if (seeds.join(',') !== C.speakSeeds.join(','))
    throw new ReportUsageError(`${run.dir}: speak seeds ${seeds.join(', ') || 'none'}; the trunk is pooled over ${C.speakScenario} seeds ${C.speakSeeds.join(', ')}, one each`)
  if (!speakRuns.some(speak => speak.dir === run.dir))
    throw new ReportUsageError(`${run.dir}: not among the speak seeds it is pooled with`)
}

/**
 * Revision 2: the trunk bar comes only from idle seeds 1, 2 and 3 of 120 s scored, one each; any other set is refused.
 * `ownership` passes its own companions to `strokeApexes` and is not bound by this.
 */
function requireIdleContract(run: LoadedRun, idleRuns: readonly LoadedRun[]): void {
  for (const idle of idleRuns) {
    const { scenario } = idle.input.trace.source
    const scored = idle.input.trace.frames / idle.input.trace.hz - idle.input.trace.scoredFrom
    if (scenario.id !== C.idleScenario || Math.abs(scored - C.idleScoredSeconds) > 1 / idle.input.trace.hz + 1e-6)
      throw new ReportUsageError(`${idle.dir}: companion ${scenario.id} run of ${fixed(scored, 2)} s scored; the trunk bar needs ${C.idleScenario} runs of ${C.idleScoredSeconds} s scored`)
  }
  const seeds = idleRuns.map(idle => idle.input.trace.source.scenario.seed).sort((a, b) => (a ?? 0) - (b ?? 0))
  if (seeds.join(',') !== C.idleSeeds.join(','))
    throw new ReportUsageError(`${run.dir}: companion idle seeds ${seeds.join(', ') || 'none'}; the trunk bar needs idle seeds ${C.idleSeeds.join(', ')}, one each`)
}

/**
 * C001 criterion-level report (plan 2.2, unit M2 R2): every rule and constant fixed before any gesture code. Version 6
 * pools the trunk's locking and size over `speakRuns`, the speak seeds 1, 2 and 3 of the judged run's model and commit.
 */
export function gestureTimingReport(run: LoadedRun, bands: MotionBandsFile, idleRuns: readonly LoadedRun[], speakRuns: readonly LoadedRun[]): CriterionReport<GestureTimingDetail> {
  const summary = requireSummary(run)
  const gate = requireGate(run)
  requireIdleContract(run, idleRuns)
  requireSpeakSeeds(run, speakRuns)
  const { p } = run
  const { candidates, silentApexes, silentSeconds, companions, pooled, speedBar, apexes } = strokeApexes(run, idleRuns)
  const peaks = hitPeaks(run, apexes)
  const { scoredFrom } = run.input.trace
  const utterances = utterancesOf(run, apexes)
  const hits = peaks.filter(peak => peak.hit).length
  const unprompted = apexes.filter(a => !peaks.some(peak => Math.abs(a.t - peak.t) <= C.unpromptedSeconds)).map(a => a.t)
  const near = (t: number, sides: readonly Side[], window: number) => nearestApex(apexes, t, sides, window)
  const strokeMarkers = strokeMarkersOf(run, apexes)
  const confirmed = strokeMarkers.filter(m => m.confirmedBy)
  const torso = traceParent(p, 'leftShoulder')
  const trunkHits = trunkHitsOf(p, torso, peaks, strokeMarkers)
  const placebo = idleRuns.flatMap((idle) => {
    const idleTorso = traceParent(idle.p, 'leftShoulder')
    const end = idle.p.times[idle.p.times.length - 1]
    const turns: number[] = []
    for (let start = idle.input.trace.scoredFrom; start + C.strokeSeconds <= end; start += C.strokeSeconds) {
      const d = torsoDisplacement(idle.p, idleTorso, start, start + C.strokeSeconds)
      if (d !== null)
        turns.push(d)
    }
    return turns
  })
  const placeboP95 = placebo.length >= C.minimumPlacebo ? percentile(placebo, C.placeboPercentile) : null
  const trunkAbove = placeboP95 === null ? 0 : trunkHits.filter(h => h.displacementDeg !== null && h.displacementDeg > placeboP95).length
  // Revision 2 (review T1): the idle bar holds only if idle is this run's background, so the run's own peak-free
  // windows (version 3's placebo set) may exceed it on at most the locking share.
  const peakFree: number[] = []
  for (let start = scoredFrom; start + C.strokeSeconds <= p.times[p.times.length - 1]; start += C.strokeSeconds) {
    if (peaks.some(peak => peak.t >= start - C.peakClearance && peak.t <= start + C.strokeSeconds + C.peakClearance))
      continue
    const d = torsoDisplacement(p, torso, start, start + C.strokeSeconds)
    if (d !== null)
      peakFree.push(d)
  }
  const lockAbove = placeboP95 === null ? peakFree.length : peakFree.filter(d => d > placeboP95).length
  // Version 6 (lane T6 revision 3): locking and size are pooled over the speak seeds; the peak-free share is report only.
  const own = trunkSample(p, torso, apexes, utterances, trunkHits, placeboP95)
  const samples = speakRuns.map(speak => speak.dir === run.dir ? own : siblingSample(speak, idleRuns, placeboP95))
  const locking = lockingOf(samples, placeboP95)
  const seedLocking = lockingOf([own], placeboP95)
  const pooledTurns = samples.flatMap(s => s.turns)
  const dipPerDegree = shoulderDipPerDegree(run.input.trace.rig, torso)
  const medianDeg = pooledTurns.length ? median(pooledTurns) : null
  const size = { judged: pooledTurns.length, medianDeg, dipPerDegree, medianDip: medianDeg !== null && dipPerDegree !== null ? medianDeg * dipPerDegree : null }
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
  const pops = popCount(p, upperBodyPopBones)
  const penetration = Math.max(0, ...summary.perFrame.penL, ...summary.perFrame.penR)
  const corrector = summary.corrector
  const bilateral = gate.metrics.filter(m => m.id.startsWith('bilateral.') && m.band?.status === 'GATED')
  const gated = gate.metrics.filter(m => m.band?.status === 'GATED').map(m => ({ id: m.id, status: m.status, value: m.value }))
  const reportOnly = gate.metrics.filter(m => m.band?.status !== 'GATED').map(m => ({ id: m.id, status: m.status, value: m.value }))
  // Version 5 (lane U revision 3): an arm too unscorable to have a value is skipped only when it is not frozen.
  const ldlj = ([['smooth.armL.ldlj', 'armL'], ['smooth.armR.ldlj', 'armR']] as const).map(([id, region]) => {
    const band = printedBand(bands, 'talk', id)
    const { value } = gateStatus(gate, id)
    const reading = value === null ? notFrozen(p, region) : null
    return { id, value, band, dip: reading?.dip ?? null, notFrozen: reading?.alive ?? false, inside: value !== null && band.lo !== null && band.hi !== null && value >= band.lo && value <= band.hi }
  })
  const armsPass = ldlj.some(x => x.value !== null) && ldlj.every(x => x.value !== null ? x.inside : x.notFrozen)
  const requirements = [
    requirement('peaks', `labelled peaks in the scored span >= ${C.minimumPeaks}`, `${peaks.length}`, peaks.length >= C.minimumPeaks),
    requirement('peaks-hit', `hits / peaks >= ${C.hitShare}, a hit being a kinematic apex within ${C.hitSeconds * 1000} ms`, `${hits}/${peaks.length} = ${fixed(peaks.length ? hits / peaks.length : null)}`, peaks.length > 0 && hits / peaks.length >= C.hitShare),
    requirement('markers-confirmed', `stroke markers with an apex of their hand within ${C.confirmSeconds * 1000} ms >= ${C.confirmedShare}`, `${confirmed.length}/${strokeMarkers.length}`, strokeMarkers.length > 0 && confirmed.length / strokeMarkers.length >= C.confirmedShare),
    requirement('forms', `>= ${C.minimumForms} confirmed forms differing pairwise by >= ${C.formDegrees} deg in one apex feature`, `${distinct.length} (${distinct.join(', ') || 'none'}) of ${Object.keys(forms).length} confirmed forms`, distinct.length >= C.minimumForms),
    requirement('utterances', 'every utterance in the scored span contains a kinematic stroke apex', `${utterances.filter(u => u.apexes > 0).length}/${utterances.length}`, utterances.length > 0 && utterances.every(u => u.apexes > 0)),
    requirement('trunk-participation', `upper-torso turn over [stroke apex - ${C.strokeSeconds} s, stroke apex] > p${C.placeboPercentile * 100} of the same turn over the companion idle runs on >= ${C.trunkShare} of hit peaks; the stroke apex confirms a stroke marker within ${C.hitSeconds * 1000} ms of the peak, else the peak is a miss`, `${trunkAbove}/${trunkHits.length}; ${torso ?? 'no torso bone'} against hips; idle placebo p95 ${fixed(placeboP95, 3)} deg over ${placebo.length} windows; peak-free windows above it ${lockAbove}/${peakFree.length} = ${fixed(peakFree.length ? lockAbove / peakFree.length : null)} (report only)`, placeboP95 !== null && trunkHits.length > 0 && trunkAbove / trunkHits.length >= C.trunkShare),
    requirement('trunk-locking', `pooled over ${C.speakScenario} seeds ${C.speakSeeds.join(', ')}: the share of judged stroke turns above that p95, minus the p${C.shiftPercentile * 100} of the share with each judged stroke shifted by whole-frame multiples of ${C.shiftSteps.map(s => fixed(s, 4)).join(' s and ')} s (at least ${C.shiftMinimum} s) inside its utterance, off every other counted stroke (offsets of >= ${C.shiftStrokes} strokes, >= ${C.shiftOffsets} offsets), >= ${C.lockMargin}`, `${locking.above}/${locking.judged} = ${fixed(locking.judged ? locking.above / locking.judged : null)}; shifted p${C.shiftPercentile * 100} ${fixed(locking.shiftedP90)} over ${locking.offsets} offsets; ${fixed(locking.statistic)}`, locking.statistic !== null && locking.statistic >= C.lockMargin),
    requirement('trunk-seed-locking', `the trunk-locking statistic over this run's own judged strokes and shifted offsets >= ${C.seedLockFloor}`, `${seedLocking.above}/${seedLocking.judged} = ${fixed(seedLocking.judged ? seedLocking.above / seedLocking.judged : null)}; shifted p${C.shiftPercentile * 100} ${fixed(seedLocking.shiftedP90)} over ${seedLocking.offsets} offsets; ${fixed(seedLocking.statistic)}`, seedLocking.statistic !== null && seedLocking.statistic >= C.seedLockFloor),
    requirement('trunk-size', `pooled over ${C.speakScenario} seeds ${C.speakSeeds.join(', ')}: the median judged stroke turn moves the shoulder line >= ${C.sizeDip} DIP at the default ${STAGE_CHARACTER_HEIGHT_DIP} DIP character height`, `${fixed(size.medianDip)} DIP = median ${fixed(size.medianDeg, 3)} deg over ${size.judged} judged strokes x ${fixed(size.dipPerDegree, 4)} DIP per deg`, size.medianDip !== null && size.medianDip >= C.sizeDip),
    requirement('bilateral', 'every gated bilateral.*.peakCorr PASS in gate.json', bilateral.map(m => `${m.id} ${m.status}`).join(', ') || `none gated in gate version ${gate.gate.version} (report-only values listed below)`, bilateral.every(m => m.status === 'PASS')),
    requirement('one-hand', `one-hand stroke markers >= ${C.oneHandShare} of markers`, `${strokeMarkers.length - twoHand.length}/${strokeMarkers.length}`, strokeMarkers.length > 0 && (strokeMarkers.length - twoHand.length) / strokeMarkers.length >= C.oneHandShare),
    requirement('two-hand-lag', `every two-hand stroke's left and right apexes ${C.twoHandLag[0] * 1000}-${C.twoHandLag[1] * 1000} ms apart`, `${twoHand.length} two-hand strokes`, twoHandOk),
    requirement('preparation-order', `upper arm, then lower arm, then hand peak speed in >= ${C.orderShare} of unit preparations`, `${preparations.filter(x => x.ordered).length}/${preparations.length}`, preparations.length > 0 && preparations.filter(x => x.ordered).length / preparations.length >= C.orderShare),
    requirement('penetration', 'max(perFrame.penL, perFrame.penR) = 0', fixed(penetration, 6), penetration === 0),
    requirement('pops', 'upper-body pop count (plan 2.6, unit M3) = 0', `${pops}`, pops === 0),
    requirement('corrector', 'capHits = guardScans = holds = 0 in summary.json', corrector ? `capHits ${corrector.capHits}, guardScans ${corrector.guardScans}, holds ${summary.collisions.count}` : 'summary has no corrector block', !!corrector && corrector.capHits === 0 && corrector.guardScans === 0 && summary.collisions.count === 0),
    requirement('gate-talk', 'gate.json judges the talk class and no gated metric FAILs, whatever gate version it names', `gate version ${gate.gate.version}, class ${gate.trace.class}; ${gated.map(m => `${m.id} ${m.status} ${fixed(m.value)}`).join(', ') || 'no gated metric'}`, gate.trace.class === 'talk' && gated.length > 0 && gated.every(m => m.status !== 'FAIL')),
    requirement('arm-ldlj', `every smooth.armL/R.ldlj with a value inside the printed pooled talk band, at least one arm with a value; an arm without one is skipped only when its wrist moves at least ${NOT_FROZEN_DIP.arm} DIP in the shoulder frame (not frozen), else it fails`, ldlj.map(x => x.value !== null ? `${x.id} ${fixed(x.value)} [${fixed(x.band.lo, 2)}, ${fixed(x.band.hi, 2)}]${describeOutside(x.id, x.value, bands.classes.talk?.metrics[x.id])}` : `${x.id} unscorable, ${x.notFrozen ? 'not frozen, skipped' : 'frozen'} (windowed displacement ${fixed(x.dip)} DIP)`).join(', '), armsPass),
  ]
  return criterionReport('gesture-timing', GESTURE_TIMING_VERSION, [run.dir], GESTURE_TIMING_CONSTANTS, requirements, {
    idle: { companions, pooled, speedBar, silentSeconds, silentApexes, candidates: candidates.length, counted: apexes.length },
    peaks,
    utterances,
    trunk: { torso, hits: trunkHits, placeboWindows: placebo.length, placeboP95Deg: placeboP95, lock: { windows: peakFree.length, above: lockAbove }, locking, seedLocking, size },
    gated,
    reportOnly,
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
    `idle speed bar: p${C.idlePercentile * 100} of ${d.idle.pooled} idle apexes pooled over ${d.idle.companions.length} companion idle runs = ${fixed(d.idle.speedBar, 3)} A/s; ${d.idle.counted} of ${d.idle.candidates} candidate apexes count as strokes`,
    ...d.idle.companions.map(c => `  companion ${c.dir}: commit ${c.gitSha ?? '-'}, seed ${c.seed}, ${c.apexes} idle apexes`),
    `within-run silent spans (report only): ${d.idle.silentApexes} candidate apexes in ${fixed(d.idle.silentSeconds, 1)} s`,
    'labelled peaks: t s, nearest apex ms, hit',
    ...d.peaks.map(x => `  ${x.t.toFixed(3)}\t${fixed(x.nearestApexMs, 1)}\t${x.hit ? 'hit' : 'miss'}`),
    'utterances: start s, end s, kinematic apexes inside',
    ...d.utterances.map(u => `  ${u.start.toFixed(3)}\t${u.end.toFixed(3)}\t${u.apexes}`),
    `upper-torso turn at hit peaks: peak s, stroke apex s, turn deg (${d.trunk.torso ?? '-'} against hips; companion idle placebo p95 ${fixed(d.trunk.placeboP95Deg, 3)} over ${d.trunk.placeboWindows} windows):`,
    ...d.trunk.hits.map(h => `  ${h.peak.toFixed(3)}\t${fixed(h.apex, 3)}\t${fixed(h.displacementDeg, 3)}`),
    `peak-free windows (report only): ${d.trunk.lock.above} of ${d.trunk.lock.windows} windows of this run with no labelled peak within ${C.peakClearance} s turn above the idle placebo p95 (judged at most ${C.lockShare} before version 6)`,
    `locking, pooled over ${d.trunk.locking.seeds} speak seeds: ${d.trunk.locking.above} of ${d.trunk.locking.judged} judged stroke turns above the idle placebo p95; shifted p${C.shiftPercentile * 100} ${fixed(d.trunk.locking.shiftedP90)} over ${d.trunk.locking.offsets} offsets; statistic ${fixed(d.trunk.locking.statistic)}, at least ${C.lockMargin}`,
    `locking, this run alone: ${d.trunk.seedLocking.above} of ${d.trunk.seedLocking.judged} judged stroke turns above the idle placebo p95; shifted p${C.shiftPercentile * 100} ${fixed(d.trunk.seedLocking.shiftedP90)} over ${d.trunk.seedLocking.offsets} offsets; statistic ${fixed(d.trunk.seedLocking.statistic)}, at least ${C.seedLockFloor}`,
    `size, pooled: median judged stroke turn ${fixed(d.trunk.size.medianDeg, 3)} deg x ${fixed(d.trunk.size.dipPerDegree, 4)} DIP per deg = ${fixed(d.trunk.size.medianDip)} DIP, at least ${C.sizeDip}`,
    `report-only gate values: ${d.reportOnly.map(m => `${m.id} ${m.status} ${fixed(m.value)}`).join(', ') || 'none'}`,
    `kinematic apexes: ${d.apexes.length} (left ${d.apexes.filter(a => a.side === 'left').length}, right ${d.apexes.filter(a => a.side === 'right').length}); unprompted (no peak within 400 ms): ${d.unpromptedApexes.length}`,
    'stroke markers: t s, form, hand, unit, confirmed by',
    ...d.markers.map(m => `  ${m.t.toFixed(3)}\t${m.form}\t${m.hand}\t${m.unitSeq}\t${m.confirmedBy ? `${m.confirmedBy.side} apex ${m.confirmedBy.t.toFixed(3)}` : '-'}`),
    'median apex features per confirmed form: pronation deg, wrist flexion deg, index curl deg, direction',
    ...Object.entries(d.forms).map(([form, f]) => `  ${form}\t${fixed(f.pronationDeg, 1)}\t${fixed(f.wristFlexDeg, 1)}\t${fixed(f.indexCurlDeg, 1)}\t[${f.direction.map(v => v.toFixed(2)).join(', ')}]`),
    'unit preparations: unit, side, peak upper arm / lower arm / hand ms after the unit start, ordered',
    ...d.preparations.map(x => `  ${x.unitSeq}\t${x.side}\t${fixed(x.upperMs, 0)} / ${fixed(x.lowerMs, 0)} / ${fixed(x.handMs, 0)}\t${x.ordered ? 'yes' : 'no'}`),
  ])
}
