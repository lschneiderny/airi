import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Motion3dIdleDrive } from '../idle-drive'
import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { boolean, number, parseJson, pipe, record, safeParse, string, union } from 'valibot'

import { stageGateThresholds } from '../../stage/gates'
import { percentile } from '../gate/bands'
import { IDLE_MARKER, idleDriveDetail, QA_DRIVE_PRESENT } from '../idle-drive'
import { add, conjugate, DEG, multiply, rotate } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, gateStatus, markers, reportOnly, ReportUsageError } from './report'

export const IDLE_ACTS_VERSION = 7

const C = {
  distinct: 6,
  exitSeconds: 1.6,
  settleSeconds: 2.2,
  movedPercentile: 0.95,
  nullStep: 0.5,
  nullMinimum: 20,
  actDeg: 10,
  actSeconds: 1.5,
  maxShiftCalm: 0.6,
  lastingDeg: 0.25,
  lateralDrift: 0.004,
  forwardDrift: 0.006,
  verticalLoad: 0.0065,
  hipsDeg: Math.hypot(3, 4.5),
  lateralGain: 0.38,
  supportSpeed: 7.06,
  driftTaus: [0.9, 3.5, 14],
  falseAlarm: 0.05,
} as const
/** The hips displacement, in L, that a rotation of the leg about the planted ankle by `deg` makes. */
const hipsFor = (deg: number) => Math.sin(deg * Math.PI / 180)

/** Behaviours the scheduler reports that are not drawn acts: sleep is entered on away, the two cues are the host's. */
const NOT_ACTS: ReadonlySet<string> = new Set(['sleep', 'about-to-speak', 'let-go'])
/**
 * The bones the performer writes from its own posture and support (`performance/posture.ts`), free of Natural's breath
 * (trunk pitch, clavicles, arms), slow head yaw (trunk yaw) and head and gaze streams (neck, head, eyes), which keep
 * lasting state after an activity by design. The pair judges the hips bone, the root block and the leg chain's foot and toe
 * joints; the leg bones' own rotations are printed (amendment 7 A7.2).
 */
export const PERFORMER_BONES: readonly MotionTraceBone[] = ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']
/** Bones whose movement shows that the body did something; the eyes and fingers are left out. */
const BODY_BONES: ReadonlySet<string> = new Set(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', ...PERFORMER_BONES])
const REST_STATES: readonly BodyRest[] = ['none', 'rest', 'doze']
const O2_METRICS = ['inter.burstCv', 'inter.holdFraction', 'inter.movesPerMin'] as const

export const IDLE_ACTS_CONSTANTS: readonly ReportConstant[] = [
  { name: 'drive', value: QA_DRIVE_PRESENT.name, unit: `${idleDriveDetail(QA_DRIVE_PRESENT).idleDriveValues}, compared by value`, source: 'C001 owner decision "Idle wording: Amend it"; unit M2 rules section 1, amendment 4 A4.4' },
  { name: 'distinct acts', value: C.distinct, unit: 'kinds among counted acts', source: 'C001' },
  { name: 'exit', value: C.exitSeconds, unit: 's after an end report, inside the act', source: 'the longest release of a behaviour, wakeSeconds (idle-activities.ts)' },
  { name: 'settling', value: C.settleSeconds, unit: 's after the exit, outside the pair check and the act-free windows', source: '2 % settling of the slowest arm follower, performance/arms.ts' },
  { name: 'act floor', value: `${C.actDeg} deg within ${C.actSeconds} s`, unit: `the least change a channel must make to count (bones and root yaw; hips position ${hipsFor(C.actDeg).toFixed(4)} L, the hips displacement of a ${C.actDeg} deg leg rotation about the ankle)`, source: 'the goal-2 gaze-shift criterion, gaze-order.ts CRITERION_DEG and CRITERION_WINDOW_SECONDS; amendment 4 A4.1' },
  { name: 'moved', value: C.movedPercentile, unit: 'percentile: each channel is scaled by the larger of its floor and its own act-free 95th percentile, and an act\'s largest scaled change must exceed both 1 and the 95th percentile of the act-free windows\' largest', source: 'the review\'s named fix (E/g4/m2-review.md blocker 1); one-sided 5 % bar, as the turn report\'s pseudo-placebos' },
  { name: 'act-free windows', value: `${C.nullStep} s grid, at least ${C.nullMinimum}`, unit: `windows of the act's length in the scored span, clear with their ${C.actSeconds} s lead of every widened behaviour`, source: 'unit M2 rules section 3, amendment 4 A4.1' },
  { name: 'delay bound', value: C.maxShiftCalm, unit: 's per s of behaviour [start, end + exit] since the trace started, plus one frame at each end of a behaviour and one frame: the pair\'s delay never decreases and never exceeds it; an interval whose fit sits at it is not judged', source: 'maxShiftCalm (idle-activities.ts): an activity slows the weight-shift countdown by at most 60 %, so the countdown falls behind by at most that; amendment 7 A7.1, A7.2' },
  { name: 'pair drift', value: `${C.lateralDrift} L lateral, ${C.forwardDrift} L forward, ${C.hipsDeg.toFixed(3)} deg x ${C.lateralDrift} / lateralGain hips rotation`, unit: 'time-indexed amplitude at gate 1; Ornstein-Uhlenbeck time constants 0.9, 3.5 and 14 s', source: 'performance/posture.ts drift and sway, noise/index.ts; amendment 7 A7.2' },
  { name: 'pair false alarms', value: C.falseAlarm, unit: 'per test family (visible frames, interval means, pooled means), Bonferroni over its tests', source: 'the report\'s one-sided 5 % bars; amendment 7 A7.2' },
  { name: 'pair resolution', value: C.lastingDeg, unit: `deg (L sin ${C.lastingDeg} deg = ${hipsFor(C.lastingDeg).toFixed(5)} L): no tolerance is smaller`, source: 'rules.md revision 2, B1 scoring; amendment 7 A7.2' },
  { name: 'pair feet', value: 2 * stageGateThresholds.walkFeetErrorMax, unit: 'model units, the most a planted foot or toe joint may differ in one frame: two solved ankles each within their foot error', source: 'stage gates feetMaxError (stage/gates.ts); amendment 7 A7.2' },
]

/** What a PASS proves and what it does not; printed with every report. */
const IDLE_ACTS_LIMITS: readonly string[] = [
  'acts are the scheduler\'s own start and end reports (idle:<kind>:<start|end> markers); a movement the body plays without a report is never judged.',
  `an act counts when some channel changed within ${C.actSeconds} s by more than max(1, bar) times the larger of ${C.actDeg} deg (hips position ${hipsFor(C.actDeg).toFixed(4)} L) and that channel's own act-free 95th percentile; each act above prints the degrees its deciding channel needed. A head-led act must therefore exceed her own idle head range: a 12 deg nod reached in 1 s counted 2 of 13 acts on Chisa seed 1 and 0 of 11 on Ellen seed 2, a 20 deg nod in the product's zone-out envelope every act (second review). The ${C.actDeg} deg floor is a convention, the goal-2 gaze-order rule's event threshold (gaze-order.ts CRITERION_DEG), not a measured visibility threshold. A change made over more than about 3 s counts only the part made within ${C.actSeconds} s; a wider window was measured to count an 8 deg drift and to lose product-shaped nods on Ellen. This proves the body did something, not what; a motionless act is counted in at most about 5 % of its spans by construction.`,
  `under qa-neutral-day (body: true since amendment 9) ten kinds are drawable while she stands (look-around, check-in, peer, zone-out, stretch, yawn, sigh, shoulder-roll, arm-swing, shift-stance; clasp-hands too on a rig that reaches its anchor, which Chisa and Ellen do not, and hair-touch on a rig with the hairTouch capability, which Chisa has) and six once she has settled after 120 s (look-around, check-in, zone-out, yawn, sigh, shift-stance); nod-off and sway weigh 0, and so does heel-rock at valence 0. On a body host the draw prefers kinds not started in the last 300 s. The scheduler alone (10,000 seeds, 610 s) drew six distinct kinds that end in the scored span in 48.2 % of runs before clasp-hands was drawn (idle unit I and its review), so about half of correct runs fail distinct-acts by the draw alone; a head-only drive read 13.0 %.`,
  'no-repeat judges only a kind started twice in a row (C001\'s bar); longer repeated blocks (A B A B) are printed above, and the visual review alone enforces "no repeated cycle". The scheduler never draws its last drawn kind again, so in the product the line fails only through a stretch or yawn follow-up after sleep or a host cue.',
  'the pair is printed, not judged (amendment 8): on her runs version 6\'s rule fails the unperturbed product run, because the trace\'s root yaw is the hips\' heading, which carries the weight shift and the drift that the rule leaves out, and its delay fit can lock on a short interval and carry the lock forward; the visual review is the check. As a printed reading it compares, on each act-free interval, the companion delayed by the interval\'s fitted delay: the hips position (lateral, vertical, forward in the body frame), the hips rotation, the root yaw and every planted foot and toe joint. Its tolerances come from the performer\'s time-indexed drift (printed above), not from her runs. It sees a lasting hips or root change larger than its tolerance on one interval or pooled, whatever the other intervals hold; a foot or toe joint off its place by more than the resolution; a weight shift out of step with the companion\'s; a schedule further behind than the delay bound (not judged, so not PASS). It does not see a leg pose that reaches the same foot position (the leg bones are printed, not judged), a delay that grows faster than 0.6 s per s during one act while the total stays under the bound, a delay that decreases after an interval without a weight shift, or a lasting hips change under its tolerance, which grows as the interval shortens. Natural\'s breath, head and gaze streams keep lasting state after an activity by design and are printed, not judged.',
  'lasting state after an act (the arm hang, a foot left turned, the stance) is judged by no line since the pair left the verdict: the visual review must check that she returns after each act, on the interval that follows it in the review list.',
  'the pair reading assumes the qa-neutral-day drive: under other drives the idle energy offset is a second path to the shift rate.',
  'a PASS alone is NOT accepted for C001: read it with the visual review the criterion names, from the act timeline and the review list above.',
]

/** One behaviour the scheduler reported: its kind, its start, and its end, or null while it runs at the end of the trace. */
export interface IdleSpan {
  readonly kind: string
  readonly start: number
  readonly end: number | null
}

/** Every behaviour the scheduler reported, in start order; refuses markers that do not form one behaviour at a time. */
export function idleSpans(run: LoadedRun): IdleSpan[] {
  const spans: IdleSpan[] = []
  let open: number | null = null
  for (const { t, parts } of markers(run, IDLE_MARKER)) {
    const [kind, phase] = parts
    const malformed = (why: string) => new ReportUsageError(`${run.dir}: ${why} at ${t.toFixed(3)} s: ${IDLE_MARKER}${parts.join(':')}`)
    if (parts.length !== 2 || !/^[a-z][a-z-]*$/.test(kind) || (phase !== 'start' && phase !== 'end'))
      throw malformed('malformed idle marker')
    if (phase === 'start') {
      if (open !== null)
        throw malformed(`a start while ${spans[open].kind} is open`)
      open = spans.length
      spans.push({ kind, start: t, end: null })
    }
    else {
      if (open === null || spans[open].kind !== kind)
        throw malformed('an end without its start')
      spans[open] = { ...spans[open], end: t }
      open = null
    }
  }
  return spans
}

/** The stored drive values: JSON of the drive's fields, numbers and booleans. */
const DriveValues = pipe(string(), parseJson(), record(string(), union([number(), boolean()])))

/** The `drive` line: the run's provenance names `drive` with exactly its values, compared by value whatever their order. */
export function driveRequirement(run: LoadedRun, drive: Motion3dIdleDrive): CaseRequirement {
  const { detail } = run.input.trace.source
  const expected = idleDriveDetail(drive)
  const rule = `the run's provenance names ${expected.idleDrive} with the values ${expected.idleDriveValues}, compared by value`
  if (detail.idleDrive === undefined)
    return judged('drive', rule, 'no idle drive in the provenance', false)
  const named = `${String(detail.idleDrive)} ${String(detail.idleDriveValues)}`
  const parsed = safeParse(DriveValues, detail.idleDriveValues)
  if (!parsed.success)
    return judged('drive', rule, `${named}: the values are not the drive's JSON (${parsed.issues[0].message})`, false)
  const want = Object.entries(drive.drive)
  const same = Object.keys(parsed.output).length === want.length && want.every(([key, value]) => parsed.output[key] === value)
  return judged('drive', rule, named, detail.idleDrive === expected.idleDrive && same)
}

/** The rest state at `t`: the latest `rest:` marker at or before it, `none` before any. */
export function restStates(run: LoadedRun): (t: number) => BodyRest {
  const changes = markers(run, 'rest:').map(({ t, parts }) => {
    const state = REST_STATES.find(s => s === parts[0])
    if (!state || parts.length !== 1)
      throw new ReportUsageError(`${run.dir}: malformed rest marker at ${t.toFixed(3)} s: rest:${parts.join(':')}`)
    return { t, state }
  })
  return (t) => {
    let state: BodyRest = 'none'
    for (const change of changes) {
      if (change.t > t)
        break
      state = change.state
    }
    return state
  }
}

/**
 * Frame-indexed access to a decoded trace's local rotations, world orientations, joint positions (forward kinematics
 * from the rig's rest offsets) and hips position, warm-up included.
 */
export class TracePose {
  private readonly bones: readonly MotionTraceBone[]
  private readonly parents: readonly number[]
  private readonly positions = new Map<number, Vec3>()
  readonly frames: number
  constructor(readonly input: DecodedMotionTrace) {
    this.bones = input.trace.rig.bones
    this.parents = input.trace.rig.parents
    this.frames = input.trace.frames
  }

  /** The bone's joint position in model units: the hips at the root block, each child at its parent plus the rotated rest offset. */
  position(frame: number, bone: number): Vec3 {
    const key = frame * this.bones.length + bone
    const cached = this.positions.get(key)
    if (cached)
      return cached
    const parent = this.parents[bone]
    const at = parent < 0 ? this.hips(frame) : add(this.position(frame, parent), rotate(this.world(frame, parent), this.input.trace.rig.restOffsets[bone]))
    this.positions.set(key, at)
    return at
  }

  time(frame: number): number {
    return this.input.channels[frame * MOTION_TRACE_CHANNELS.length]
  }

  index(bone: MotionTraceBone): number {
    return this.bones.indexOf(bone)
  }

  local(frame: number, bone: number): Quat {
    const at = (frame * this.bones.length + bone) * 4
    const r = this.input.rot
    return [r[at], r[at + 1], r[at + 2], r[at + 3]]
  }

  world(frame: number, bone: number): Quat {
    let q = this.local(frame, bone)
    for (let parent = this.parents[bone]; parent >= 0; parent = this.parents[parent])
      q = multiply(this.local(frame, parent), q)
    const yaw = this.yaw(frame)
    return multiply([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], q)
  }

  yaw(frame: number): number {
    return this.input.root[frame * 4 + 3]
  }

  hips(frame: number): Vec3 {
    const r = this.input.root
    return [r[frame * 4], r[frame * 4 + 1], r[frame * 4 + 2]]
  }
}

/** The rotation angle between two orientations, degrees; exact near zero (2 atan2(|v|, |w|) of the difference). */
function angleBetween(a: Quat, b: Quat): number {
  const d = multiply(a, conjugate(b))
  return 2 * Math.atan2(Math.hypot(d[0], d[1], d[2]), Math.abs(d[3])) * DEG
}

/**
 * The rotation vector, degrees, of `a[i] * conj(b[j])` for two quaternions stored in float blocks, without allocating
 * the quaternions: the hot loops below call it tens of millions of times.
 */
function rotationVector(a: Float32Array, i: number, b: Float32Array, j: number, out: Float64Array): void {
  const ax = a[i]
  const ay = a[i + 1]
  const az = a[i + 2]
  const aw = a[i + 3]
  const bx = -b[j]
  const by = -b[j + 1]
  const bz = -b[j + 2]
  const bw = b[j + 3]
  const x = aw * bx + ax * bw + ay * bz - az * by
  const y = aw * by - ax * bz + ay * bw + az * bx
  const z = aw * bz + ax * by - ay * bx + az * bw
  const w = aw * bw - ax * bx - ay * by - az * bz
  const length = Math.hypot(x, y, z)
  // The shorter way round: q and -q are one rotation.
  const scale = length < 1e-12 ? 0 : 2 * Math.atan2(length, Math.abs(w)) * DEG / length * (w < 0 ? -1 : 1)
  out[0] = x * scale
  out[1] = y * scale
  out[2] = z * scale
}

/** One measured channel: a body bone's local rotation (deg), the root yaw (deg) or the hips position (L). */
type Channel = { readonly kind: 'bone', readonly bone: number, readonly name: string } | { readonly kind: 'yaw' | 'hips', readonly name: string }

/**
 * The angle, degrees, of `channel` between frame `f` of `a` and frame `g` of `b`, from the quaternions' dot product: cheap
 * for the hot loops, and within about 0.05 deg of the exact angle for float32 rotations, far below the 10 deg act floor.
 */
function quickAngle(a: DecodedMotionTrace, f: number, b: DecodedMotionTrace, g: number, channel: Channel): number {
  switch (channel.kind) {
    case 'bone': {
      const bones = a.trace.rig.bones.length
      const i = (f * bones + channel.bone) * 4
      const j = (g * bones + channel.bone) * 4
      const dot = Math.abs(a.rot[i] * b.rot[j] + a.rot[i + 1] * b.rot[j + 1] + a.rot[i + 2] * b.rot[j + 2] + a.rot[i + 3] * b.rot[j + 3])
      return 2 * Math.acos(Math.min(1, dot)) * DEG
    }
    case 'yaw':
      return Math.abs(a.root[f * 4 + 3] - b.root[g * 4 + 3]) * DEG
    case 'hips':
      return Math.hypot(a.root[f * 4] - b.root[g * 4], a.root[f * 4 + 1] - b.root[g * 4 + 1], a.root[f * 4 + 2] - b.root[g * 4 + 2]) / a.trace.rig.legLength
  }
}

function frameAt(pose: TracePose, t: number): number {
  let lo = 0
  let hi = pose.frames - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pose.time(mid) < t - 1e-9)
      lo = mid + 1
    else
      hi = mid
  }
  return lo
}

/**
 * Per channel, the largest change between each frame and any frame at most `lag` frames before it (amendment 4 A4.1):
 * a window's excursion is the largest of these over its frames, so a slow change counts only the part it makes within
 * the lag, and the earlier frame may lie up to the lag before the window.
 */
function lagChanges(input: DecodedMotionTrace, channels: readonly Channel[], lag: number): Float64Array[] {
  return channels.map((channel) => {
    const out = new Float64Array(input.trace.frames)
    for (let f = 1; f < input.trace.frames; f++) {
      let largest = 0
      for (let g = Math.max(0, f - lag); g < f; g++)
        largest = Math.max(largest, quickAngle(input, f, input, g, channel))
      out[f] = largest
    }
    return out
  })
}

/** Whether an act moved the body more than her own act-free windows of the same length; null when too few windows exist. */
export interface ActMovement {
  readonly score: number
  readonly bar: number
  readonly windows: number
  /** The deciding channel: the one with the largest scaled change. */
  readonly channel: string
  /** That channel's scale: the larger of its floor and its own act-free 95th percentile, deg (L for the hips position). */
  readonly scale: number
  /** The change that channel needed to count the act: scale x max(1, bar). */
  readonly needed: number
  readonly moved: boolean
}

export interface IdleAct extends IdleSpan {
  /** Started in the scored span, ended by a report, and a drawn kind: judged for movement. */
  readonly countable: boolean
  readonly movement: ActMovement | null
}

/** One judged pair component's reading: the largest value against its tolerance, and when it was read. */
export interface PairRead {
  readonly component: string
  readonly value: number
  readonly limit: number
  readonly unit: 'L' | 'deg'
  readonly at: number | null
}

/** One act-free interval, compared with the companion at t - delay (amendment 7 A7.2). */
export interface PairInterval {
  readonly from: number
  readonly to: number
  readonly delay: number
  /** The most her countdown can have fallen behind by the interval's start. */
  readonly bound: number
  /** False when the delay fit sits at its bound: the interval is printed and not judged. */
  readonly judged: boolean
  /** The frame difference with the largest ratio to its visible tolerance. */
  readonly visible: PairRead
  /** The interval's mean signed difference with the largest ratio to its tolerance. */
  readonly mean: PairRead
  /** The leg bones' largest aligned rotation difference: printed, not judged. */
  readonly legs: { readonly bone: string, readonly value: number, readonly at: number } | null
}

export interface IdleActsDetail {
  readonly acts: readonly IdleAct[]
  readonly sequence: readonly string[]
  readonly repeatedBlocks: readonly string[]
  readonly pair: {
    readonly dir: string
    /** The performer's sway gain from the rig's rest ankles, and the hips rotation drift amplitude it gives, deg. */
    readonly lateralGain: number
    readonly rotationAmplitude: number
    /** The normal quantiles of the three test families. */
    readonly k: { readonly visible: number, readonly interval: number, readonly pooled: number }
    readonly intervals: readonly PairInterval[]
    /** Per component, the mean signed difference over the judged intervals after the first behaviour; null without one. */
    readonly pooled: readonly PairRead[] | null
    /** Version 6's reading of the pair, printed and kept out of the verdict since version 7 (amendment 8). */
    readonly reading: 'PASS' | 'FAIL' | 'NOT-EXERCISED'
    readonly others: { readonly difference: number, readonly at: number | null, readonly bone: string | null }
  }
  readonly review: { readonly spans: readonly string[], readonly dependsOnThem: boolean, readonly consecutive: readonly string[], readonly following: readonly string[] }
  readonly intermittency: readonly { readonly id: string, readonly status: string, readonly value: number | null }[] | null
}

/** The run and its acts-off companion must be the same model, commit, scenario, seed and length; the companion sets no drive. */
function checkPairSource(run: LoadedRun, pair: LoadedRun): void {
  const a = run.input.trace
  const b = pair.input.trace
  const refuse = (why: string): never => {
    throw new ReportUsageError(`${run.dir} and ${pair.dir}: not a run and its acts-off pair: ${why}`)
  }
  if (a.source.scenario.id !== b.source.scenario.id || a.source.scenario.class !== b.source.scenario.class || a.source.scenario.seed !== b.source.scenario.seed)
    refuse('scenario or seed differs')
  if (a.frames !== b.frames || a.scoredFrom !== b.scoredFrom || a.hz !== b.hz)
    refuse('length differs')
  if (a.rig.assetSha256 !== b.rig.assetSha256 || a.rig.bones.join() !== b.rig.bones.join())
    refuse('model differs')
  if (a.source.gitSha === null || a.source.gitSha !== b.source.gitSha || a.source.dirty !== false || b.source.dirty !== false)
    refuse('not the same clean commit')
  if (a.source.detail.acts === 'off')
    refuse('the run has acts switched off')
  if (b.source.detail.acts !== 'off')
    refuse('the companion does not have acts switched off (qa:motion3d run --acts off)')
  if (b.source.detail.idleDrive !== undefined || markers(pair, IDLE_MARKER).length)
    refuse('the acts-off companion sets an idle drive or carries idle markers')
}

/** Seconds of [from, to] covered by the union of `spans`. */
function covered(spans: readonly { readonly start: number, readonly end: number }[], from: number, to: number): number {
  let total = 0
  let reached = from
  for (const span of [...spans].sort((x, y) => x.start - y.start)) {
    const start = Math.max(span.start, reached)
    const end = Math.min(span.end, to)
    if (end > start) {
      total += end - start
      reached = end
    }
  }
  return total
}

/** The standard normal quantile (Acklam's rational approximation, relative error under 1.2e-9), for 0 < p < 1. */
function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549671010114270, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  if (p < 0.02425)
    return tail(Math.sqrt(-2 * Math.log(p)))
  if (p > 1 - 0.02425)
    return -tail(Math.sqrt(-2 * Math.log(1 - p)))
  const r = p - 0.5
  const s = r * r
  return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
}

/**
 * The variance, per unit amplitude, of the mean over `seconds` of the performer's drift: three unit Ornstein-Uhlenbeck
 * processes averaged (noise/index.ts). It bounds any set of that total length, the gate included (amendment 7 A7.2).
 */
function driftMeanVariance(seconds: number): number {
  return C.driftTaus.reduce((sum, tau) => sum + 2 * tau / seconds - 2 * (tau / seconds) ** 2 * (1 - Math.exp(-seconds / tau)), 0) / C.driftTaus.length
}

/** The performer's sway gain, 0.38 x the rest ankle spread / 2 L (performance/posture.ts), from the rig's rest offsets. */
function lateralGainOf(input: DecodedMotionTrace): number {
  const { bones, parents, restOffsets, legLength } = input.trace.rig
  const rest = (bone: MotionTraceBone): Vec3 | null => {
    let at: Vec3 = [0, 0, 0]
    for (let b = bones.indexOf(bone); b >= 0; b = parents[b])
      at = add(at, restOffsets[b])
    return bones.includes(bone) ? at : null
  }
  const left = rest('leftFoot')
  const right = rest('rightFoot')
  return left && right ? C.lateralGain * Math.abs(left[0] - right[0]) / (2 * legLength) : 0
}

/**
 * One judged pair component (amendment 7 A7.2): its time-indexed amplitude `a`, its resolution `e`, its visible
 * tolerance's grid term or fixed value, and how one frame's difference is read into `out` (returning its size).
 */
interface PairComponent {
  readonly name: string
  readonly unit: 'L' | 'deg'
  readonly a: number
  readonly e: number
  readonly grid: number
  readonly fixedVisible: number | null
  readonly read: (f: number, g: number, out: Float64Array) => number
}

/**
 * The pair under one scheduler (amendment 7 A7.2). Each act-free interval gets one whole-frame delay d, from the previous
 * interval's up to the most her countdown can have fallen behind by then; d minimises the scaled difference of the hips and
 * the root yaw, and an interval whose d sits at that bound is not judged. Judged: no frame above its visible tolerance, no
 * interval mean above its tolerance, and no pooled mean above its tolerance, each from the performer's drift design.
 */
function comparePair(run: LoadedRun, pair: LoadedRun, spans: readonly IdleSpan[], on: TracePose, off: TracePose): Omit<IdleActsDetail['pair'], 'reading'> {
  const a = run.input
  const b = pair.input
  const { trace } = a
  const legLength = trace.rig.legLength
  const hz = trace.hz
  const e = { deg: C.lastingDeg, L: hipsFor(C.lastingDeg) }
  const gain = lateralGainOf(a)
  const rotationAmplitude = gain > 0 ? C.hipsDeg * C.lateralDrift / gain : 0
  const grid = C.supportSpeed / (2 * hz)
  const hipsIndex = on.index('hips')
  const body = new Float64Array(3)
  const hipsDifference = (f: number, g: number) => {
    const dx = (a.root[f * 4] - b.root[g * 4]) / legLength
    const dz = (a.root[f * 4 + 2] - b.root[g * 4 + 2]) / legLength
    const yaw = a.root[f * 4 + 3]
    body[0] = Math.cos(yaw) * dx - Math.sin(yaw) * dz
    body[1] = (a.root[f * 4 + 1] - b.root[g * 4 + 1]) / legLength
    body[2] = Math.sin(yaw) * dx + Math.cos(yaw) * dz
  }
  const axis = (name: string, k: 0 | 1 | 2, amplitude: number, fGain: number): PairComponent => ({
    name,
    unit: 'L',
    a: amplitude,
    e: e.L,
    grid: fGain * grid,
    fixedVisible: null,
    read: (f, g, out) => {
      hipsDifference(f, g)
      out[0] = body[k]
      out[1] = 0
      out[2] = 0
      return Math.abs(body[k])
    },
  })
  const joints = (['leftFoot', 'rightFoot', 'leftToes', 'rightToes'] as const).map(bone => ({ bone, index: on.index(bone) })).filter(joint => joint.index >= 0)
  const components: PairComponent[] = [
    axis('hips lateral', 0, C.lateralDrift, gain),
    axis('hips vertical', 1, 0, C.verticalLoad),
    axis('hips forward', 2, C.forwardDrift, 0),
    ...hipsIndex < 0
      ? []
      : [{ name: 'hips rotation', unit: 'deg', a: rotationAmplitude, e: e.deg, grid: C.hipsDeg * grid, fixedVisible: null, read: (f: number, g: number, out: Float64Array) => {
        const bones = trace.rig.bones.length
        rotationVector(a.rot, (f * bones + hipsIndex) * 4, b.rot, (g * bones + hipsIndex) * 4, out)
        return Math.hypot(out[0], out[1], out[2])
      } } satisfies PairComponent],
    { name: 'root yaw', unit: 'deg', a: 0, e: e.deg, grid: 0, fixedVisible: null, read: (f, g, out) => {
      out[0] = (a.root[f * 4 + 3] - b.root[g * 4 + 3]) * DEG
      out[1] = 0
      out[2] = 0
      return Math.abs(out[0])
    } },
    ...joints.map(({ bone, index }): PairComponent => ({ name: `${bone} joint`, unit: 'L', a: 0, e: e.L, grid: 0, fixedVisible: 2 * stageGateThresholds.walkFeetErrorMax / legLength, read: (f, g, out) => {
      const p = on.position(f, index)
      const q = off.position(g, index)
      for (let k = 0; k < 3; k++)
        out[k] = (p[k] - q[k]) / legLength
      return Math.hypot(out[0], out[1], out[2])
    } })),
  ]
  const fitted = components.filter(component => component.name.startsWith('hips') || component.name === 'root yaw')
  const random = components.filter(component => component.a > 0).length

  const end = on.time(on.frames - 1)
  const widened = spans.map(span => ({ start: span.start, end: (span.end ?? Number.POSITIVE_INFINITY) + C.exitSeconds + C.settleSeconds }))
  const running = spans.map(span => ({ start: span.start, end: Math.min(end, (span.end ?? Number.POSITIVE_INFINITY) + C.exitSeconds) }))
  const free = (frame: number) => on.time(frame) >= trace.scoredFrom && !widened.some(span => on.time(frame) >= span.start && on.time(frame) <= span.end)
  const runs: [number, number][] = []
  for (let frame = 0; frame < on.frames; frame++) {
    if (!free(frame))
      continue
    const last = runs.at(-1)
    if (last && last[1] === frame - 1)
      last[1] = frame
    else
      runs.push([frame, frame])
  }
  const frames = runs.reduce((sum, [first, last]) => sum + last - first + 1, 0)
  const k = {
    visible: normalQuantile(1 - C.falseAlarm / (2 * random * Math.max(1, frames))),
    interval: normalQuantile(1 - C.falseAlarm / (2 * random * Math.max(1, runs.length))),
    pooled: normalQuantile(1 - C.falseAlarm / (2 * random)),
  }
  const visibleLimit = components.map(component => component.fixedVisible ?? (component.a > 0 || component.grid > 0 ? Math.max(k.visible * Math.SQRT2 * component.a + component.grid, component.e) : component.e))
  const meanLimit = (component: PairComponent, kk: number, variance: number) => component.a > 0 ? Math.max(kk * component.a * Math.sqrt(variance), component.e) : component.e
  const fitScale = fitted.map(component => visibleLimit[components.indexOf(component)])

  const scratch = new Float64Array(3)
  const firstStart = spans.length ? spans[0].start : null
  const pooledSums = components.map(() => new Float64Array(3))
  const pooledStretches: [number, number][] = []
  let pooledFrames = 0
  let delay = 0
  const intervals: PairInterval[] = runs.map(([first, last]) => {
    const before = spans.filter(span => span.start < on.time(first)).length
    const bound = Math.min(first, Math.ceil(C.maxShiftCalm * (covered(running, on.time(0), on.time(first)) + 2 * before / hz) * hz) + 1)
    let best = { d: delay, cost: Number.POSITIVE_INFINITY }
    for (let d = delay; d <= bound; d++) {
      let cost = 0
      for (let frame = first; frame <= last && cost < best.cost; frame++) {
        for (let c = 0; c < fitted.length; c++)
          cost += (fitted[c].read(frame, frame - d, scratch) / fitScale[c]) ** 2
      }
      if (cost < best.cost)
        best = { d, cost }
    }
    delay = best.d
    const judgedInterval = delay < bound || bound >= first
    const seconds = (last - first + 1) / hz
    const sums = components.map(() => new Float64Array(3))
    let visible: PairRead & { ratio: number } = { component: components[0].name, value: 0, limit: visibleLimit[0], unit: components[0].unit, at: on.time(first), ratio: -1 }
    let legs: { bone: string, value: number, at: number } | null = null
    for (let frame = first; frame <= last; frame++) {
      components.forEach((component, c) => {
        const size = component.read(frame, frame - delay, scratch)
        if (size / visibleLimit[c] > visible.ratio)
          visible = { component: component.name, value: size, limit: visibleLimit[c], unit: component.unit, at: on.time(frame), ratio: size / visibleLimit[c] }
        for (let axisIndex = 0; axisIndex < 3; axisIndex++)
          sums[c][axisIndex] += scratch[axisIndex]
      })
      for (const bone of PERFORMER_BONES) {
        const index = on.index(bone)
        if (bone === 'hips' || index < 0)
          continue
        const value = angleBetween(on.local(frame, index), off.local(frame - delay, index))
        if (!legs || value > legs.value)
          legs = { bone, value, at: on.time(frame) }
      }
    }
    const count = last - first + 1
    const intervalVariance = 2 * driftMeanVariance(seconds)
    const means = components.map((component, c) => ({ component: component.name, value: Math.hypot(...sums[c]) / count, limit: meanLimit(component, k.interval, intervalVariance), unit: component.unit, at: null }))
    const mean = means.reduce((worst, m) => m.value / m.limit > worst.value / worst.limit ? m : worst)
    if (judgedInterval && firstStart !== null && on.time(first) >= firstStart) {
      components.forEach((_, c) => {
        for (let axisIndex = 0; axisIndex < 3; axisIndex++)
          pooledSums[c][axisIndex] += sums[c][axisIndex]
      })
      pooledFrames += count
      pooledStretches.push([first - delay, last - delay])
    }
    return { from: on.time(first), to: on.time(last), delay: delay / hz, bound: bound / hz, judged: judgedInterval, visible: { component: visible.component, value: visible.value, limit: visible.limit, unit: visible.unit, at: visible.at }, mean, legs }
  })

  // The companion's stretches, shifted by their delays, may overlap; m, the most that do, enters the pooled variance.
  let overlap = pooledStretches.length ? 1 : 0
  const edges = pooledStretches.flatMap(([from, to]) => [[from, 1], [to + 1, -1]] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let open = 0
  for (const [, step] of edges) {
    open += step
    overlap = Math.max(overlap, open)
  }
  const pooledSeconds = pooledFrames / hz
  const pooledVariance = pooledFrames ? driftMeanVariance(pooledSeconds) + driftMeanVariance(pooledSeconds / Math.max(1, overlap)) : 0
  const pooled = pooledFrames ? components.map((component, c) => ({ component: component.name, value: Math.hypot(...pooledSums[c]) / pooledFrames, limit: meanLimit(component, k.pooled, pooledVariance), unit: component.unit, at: null })) : null

  const others = { difference: 0, at: null as number | null, bone: null as string | null }
  const performer = new Set(PERFORMER_BONES.map(bone => on.index(bone)).filter(bone => bone >= 0))
  for (const [first, last] of runs) {
    for (let frame = first; frame <= last; frame++) {
      trace.rig.bones.forEach((name, bone) => {
        if (performer.has(bone))
          return
        const d = angleBetween(on.local(frame, bone), off.local(frame, bone))
        if (d > others.difference) {
          others.difference = d
          others.at = on.time(frame)
          others.bone = name
        }
      })
    }
  }
  return { dir: pair.dir, lateralGain: gain, rotationAmplitude, k, intervals, pooled, others }
}

/**
 * Whether each countable act moved the body (amendment 4 A4.1): per channel, its largest change within the act floor's
 * lag over the act's window [start, end + exit], scaled by the larger of the channel's floor and its own 95th percentile
 * over the act-free windows of the same length; the act moved when its largest scaled change exceeds 1 and the 95th
 * percentile of the same score over those windows.
 */
function movements(run: LoadedRun, pose: TracePose, acts: readonly IdleSpan[], spans: readonly IdleSpan[]): (ActMovement | null)[] {
  const { trace } = run.input
  const channels: Channel[] = [
    ...trace.rig.bones.flatMap((name, bone): Channel[] => BODY_BONES.has(name) ? [{ kind: 'bone', bone, name }] : []),
    { kind: 'yaw', name: 'root yaw' },
    { kind: 'hips', name: 'hips position' },
  ]
  if (!acts.length)
    return []
  const floors = channels.map(channel => channel.kind === 'hips' ? hipsFor(C.actDeg) : C.actDeg)
  const changes = lagChanges(run.input, channels, Math.round(C.actSeconds * trace.hz))
  const excursions = (from: number, to: number) => {
    const first = frameAt(pose, from)
    const last = frameAt(pose, to)
    return changes.map((change) => {
      let largest = 0
      for (let frame = first; frame <= last; frame++)
        largest = Math.max(largest, change[frame])
      return largest
    })
  }
  const traceStart = pose.time(0)
  const scoredEnd = pose.time(pose.frames - 1)
  const busy = spans.map(span => ({ start: span.start, end: (span.end ?? Number.POSITIVE_INFINITY) + C.exitSeconds + C.settleSeconds }))
  return acts.map((act) => {
    const length = act.end! + C.exitSeconds - act.start
    const starts: number[] = []
    for (let s = trace.scoredFrom; s + length <= scoredEnd + 1e-9; s += C.nullStep) {
      const lead = s - C.actSeconds
      if (lead >= traceStart - 1e-9 && !busy.some(span => lead < span.end && s + length > span.start))
        starts.push(s)
    }
    if (starts.length < C.nullMinimum)
      return null
    const nulls = starts.map(s => excursions(s, s + length))
    const scales = channels.map((_, c) => Math.max(floors[c], percentile(nulls.map(n => n[c]), C.movedPercentile)))
    const score = (values: readonly number[]) => values.reduce((best, value, c) => Math.max(best, value / scales[c]), 0)
    const bar = percentile(nulls.map(score), C.movedPercentile)
    const own = excursions(act.start, act.start + length)
    const top = own.reduce((best, value, c) => value / scales[c] > own[best] / scales[best] ? c : best, 0)
    const value = score(own)
    return { score: value, bar, windows: starts.length, channel: channels[top].name, scale: scales[top], needed: scales[top] * Math.max(1, bar), moved: value > Math.max(1, bar) }
  })
}

/** Blocks of two or more kinds repeated at once (A B A B), for the visual review; a single repeat is the no-repeat line. */
function repeatedBlocks(sequence: readonly string[]): string[] {
  const found: string[] = []
  for (let k = 2; 2 * k <= sequence.length; k++) {
    for (let i = 0; i + 2 * k <= sequence.length; i++) {
      const block = sequence.slice(i, i + k)
      if (block.every((kind, j) => kind === sequence[i + k + j]))
        found.push(`${block.join(' ')} twice from act ${i + 1}`)
    }
  }
  return found
}

const unitOf = (channel: string): 'L' | 'deg' => channel === 'hips position' ? 'L' : 'deg'
const sized = (value: number, unit: 'L' | 'deg') => `${value.toFixed(unit === 'L' ? 5 : 3)} ${unit}`

/**
 * C001 under one idle scheduler (unit M2 rules section 3, amendments 4 and 7): the run names the fixed QA drive; at least 6
 * distinct kinds among the scheduler's acts that moved the body; no kind started twice in a row; and outside the acts the
 * run equals its acts-off companion on the hips, the root yaw and the planted feet, within the performer's drift, once the
 * companion is delayed as the acts slowed her weight-shift schedule.
 */
export function idleActsReport(run: LoadedRun, pair: LoadedRun): CaseReport<IdleActsDetail> {
  const { input } = run
  if (input.trace.source.scenario.class !== 'idle')
    throw new ReportUsageError(`${run.dir}: idle-acts judges an idle-class run, not ${input.trace.source.scenario.class}`)
  const spans = idleSpans(run)
  checkPairSource(run, pair)
  const on = new TracePose(input)
  const off = new TracePose(pair.input)
  const scoredFrom = input.trace.scoredFrom
  const isCountable = (span: IdleSpan) => !NOT_ACTS.has(span.kind) && span.start >= scoredFrom && span.end !== null
  const countable = spans.filter(isCountable)
  const moved = movements(run, on, countable, spans)
  const acts: IdleAct[] = spans.map(span => ({ ...span, countable: isCountable(span), movement: isCountable(span) ? moved[countable.indexOf(span)] : null }))
  const counted = acts.filter(act => act.movement?.moved)
  const kinds = new Set(counted.map(act => act.kind))
  const sequence = spans.map(span => span.kind)
  const repeats = sequence.slice(1).flatMap((kind, i) => kind === sequence[i] ? [`${kind} at ${spans[i + 1].start.toFixed(3)} s`] : [])
  const pairing = comparePair(run, pair, spans, on, off)
  const reviewed = counted.filter(act => act.kind === 'look-around' || act.kind === 'peer')
  const others = new Set(counted.filter(act => act.kind !== 'look-around' && act.kind !== 'peer').map(act => act.kind))
  const repeatRule = 'no two consecutive started behaviours (every reported kind, in start order) share a kind'
  const pairRule = `each act-free interval against the acts-off run delayed by a whole-frame delay that never decreases and never exceeds ${C.maxShiftCalm} s per s of behaviour since the trace started (an interval whose fit sits at that bound is not judged): on the hips position (lateral, vertical, forward), the hips rotation, the root yaw and every foot and toe joint, no frame above its visible tolerance, no interval mean and no pooled mean (judged intervals after the first behaviour) above its tolerance, each from the performer's drift design at a ${C.falseAlarm * 100} % false-alarm rate per test family and never under ${C.lastingDeg} deg (${hipsFor(C.lastingDeg).toFixed(5)} L)`
  const judgedIntervals = pairing.intervals.filter(i => i.judged)
  const notJudged = pairing.intervals.length - judgedIntervals.length
  const over = (read: PairRead) => read.value > read.limit
  const shown = judgedIntervals.filter(i => over(i.visible) || over(i.mean))
  const pooledOver = (pairing.pooled ?? []).filter(over)
  const ratio = (read: PairRead) => read.value / read.limit
  const worstOf = (reads: readonly PairRead[]) => reads.reduce<PairRead | null>((worst, read) => !worst || ratio(read) > ratio(worst) ? read : worst, null)
  const worstVisible = worstOf(judgedIntervals.map(i => i.visible))
  const worstMean = worstOf(judgedIntervals.map(i => i.mean))
  const worstPooled = worstOf(pairing.pooled ?? [])
  const readText = (read: PairRead | null) => read ? `${read.component} ${sized(read.value, read.unit)} against ${sized(read.limit, read.unit)}${read.at === null ? '' : ` at ${read.at.toFixed(3)} s`}` : 'none'
  const delays = pairing.intervals.map(i => i.delay)
  const pairValue = `${pairing.intervals.length} intervals (${notJudged} not judged: fit at its delay bound), delays ${delays.length ? `${delays[0].toFixed(3)} to ${delays[delays.length - 1].toFixed(3)} s` : 'none'}; largest visible ${readText(worstVisible)}; largest interval mean ${readText(worstMean)}; largest pooled mean ${readText(worstPooled)}${shown.length ? `; above a tolerance in ${shown.length} intervals` : ''}${pooledOver.length ? `; pooled above in ${pooledOver.map(read => read.component).join(', ')}` : ''}`
  const pairReading: IdleActsDetail['pair']['reading'] = shown.length || pooledOver.length ? 'FAIL' : notJudged || pairing.pooled === null ? 'NOT-EXERCISED' : 'PASS'
  const pairRequirement = pairReading === 'NOT-EXERCISED'
    ? notExercised('pair', pairRule, `${pairValue}; ${notJudged ? `${notJudged} intervals at their delay bound are not judged` : 'no judged act-free frame after the first behaviour'}`)
    : judged('pair', pairRule, pairValue, pairReading === 'PASS')
  const requirements: CaseRequirement[] = [
    driveRequirement(run, QA_DRIVE_PRESENT),
    judged('distinct-acts', `at least ${C.distinct} distinct kinds among the scheduler's acts that started in the scored span, ended, and changed some channel within ${C.actSeconds} s by more than max(1, bar) times the larger of ${C.actDeg} deg (hips position ${hipsFor(C.actDeg).toFixed(4)} L) and that channel's own act-free ${C.movedPercentile * 100}th percentile`, `${kinds.size} distinct (${counted.length} moved of ${acts.filter(act => act.countable).length} countable, ${spans.length} behaviours started)`, kinds.size >= C.distinct),
    spans.length < 2
      ? notExercised('no-repeat', repeatRule, `${spans.length} behaviour started: no consecutive pair`)
      : judged('no-repeat', repeatRule, repeats.length ? `repeated: ${repeats.join(', ')}` : `${spans.length - 1} consecutive pairs, none repeated`, repeats.length === 0),
    reportOnly(pairRequirement, 'not judged since version 7 (amendment 8): the trace\'s root yaw is the hips\' heading, which carries the weight shift and the drift that this rule leaves out, and the delay fit can lock on a short interval and carry the lock forward, so the rule fails a product run as designed; the visual review is the check'),
  ]
  const gate = run.gate
  return caseReport('idle-acts', IDLE_ACTS_VERSION, [run.dir, pair.dir], IDLE_ACTS_CONSTANTS, requirements, {
    acts,
    sequence,
    repeatedBlocks: repeatedBlocks(sequence),
    pair: { ...pairing, reading: pairReading },
    review: {
      spans: reviewed.map(act => `${act.kind} ${act.start.toFixed(3)}-${act.end!.toFixed(3)} s`),
      dependsOnThem: kinds.size >= C.distinct && others.size < C.distinct,
      consecutive: counted.slice(1).map((act, i) => `${counted[i].kind} -> ${act.kind} at ${act.start.toFixed(3)} s`),
      following: counted.map((act) => {
        const next = spans.find(span => span.start > act.start)
        return `${act.kind} ${act.end!.toFixed(3)}-${next ? `${next.start.toFixed(3)} s` : 'end of run'}`
      }),
    },
    intermittency: gate ? ['inter.speedCv', ...O2_METRICS].map(id => ({ id, ...gateStatus(gate, id) })) : null,
  })
}

export function formatIdleActs(report: CaseReport<IdleActsDetail>): string {
  const d = report.detail
  return formatCaseReport(report, [
    `pair (printed, not judged; version 6's reading ${d.pair.reading}): ${d.pair.dir}; lateralGain ${d.pair.lateralGain.toFixed(4)} (hips rotation drift ${d.pair.rotationAmplitude.toFixed(3)} deg); k visible ${d.pair.k.visible.toFixed(3)}, interval ${d.pair.k.interval.toFixed(3)}, pooled ${d.pair.k.pooled.toFixed(3)}; per act-free interval, the delay of her weight-shift schedule against its bound, the largest frame difference against its visible tolerance and the largest mean against its tolerance:`,
    ...d.pair.intervals.map(i => `  ${i.from.toFixed(3)}-${i.to.toFixed(3)} s\tdelay ${i.delay.toFixed(3)} s (bound ${i.bound.toFixed(3)} s)${i.judged ? '' : ' NOT JUDGED: fit at its delay bound'}\tvisible ${i.visible.component} ${sized(i.visible.value, i.visible.unit)} / ${sized(i.visible.limit, i.visible.unit)} at ${fixed(i.visible.at)} s\tmean ${i.mean.component} ${sized(i.mean.value, i.mean.unit)} / ${sized(i.mean.limit, i.mean.unit)}\tlegs (printed, not judged) ${i.legs ? `${i.legs.bone} ${i.legs.value.toFixed(3)} deg at ${i.legs.at.toFixed(3)} s` : 'none'}`),
    `pooled means over the judged intervals after the first behaviour: ${d.pair.pooled ? d.pair.pooled.map(read => `${read.component} ${sized(read.value, read.unit)} / ${sized(read.limit, read.unit)}`).join(', ') : 'none'}`,
    `every other traced bone, unaligned (Natural's breath, head and gaze; printed, not judged): ${d.pair.others.difference.toFixed(4)} deg${d.pair.others.bone ? ` (${d.pair.others.bone} at ${fixed(d.pair.others.at)} s)` : ''}`,
    `behaviours the scheduler reported (${d.acts.length}):`,
    ...d.acts.map(act => `  ${act.start.toFixed(3)}\t${act.kind}\t${act.end === null ? 'no end report' : `ended ${act.end.toFixed(3)}`}\t${!act.countable ? 'not judged (warm-up, no end, or not a drawn act)' : act.movement === null ? `not judged (fewer than ${C.nullMinimum} act-free windows)` : `${act.movement.moved ? 'moved' : 'did not move'}: score ${act.movement.score.toFixed(2)} against max(1, ${act.movement.bar.toFixed(2)}) over ${act.movement.windows} windows, largest on ${act.movement.channel}, which needed ${sized(act.movement.needed, unitOf(act.movement.channel))} (scale ${sized(act.movement.scale, unitOf(act.movement.channel))})`}`),
    `repeated blocks of two or more (printed for the visual review): ${d.repeatedBlocks.join('; ') || 'none'}`,
    `visual review list (C001): counted look-around and peer spans: ${d.review.spans.join(', ') || 'none'}; the count of ${C.distinct} ${d.review.dependsOnThem ? 'DEPENDS' : 'does not depend'} on them; consecutive counted acts: ${d.review.consecutive.join(', ') || 'none'}; check that she returns after each counted act on: ${d.review.following.join(', ') || 'none'}`,
    ...d.intermittency
      ? d.intermittency.map(m => `${m.id}: ${m.status} ${fixed(m.value)}${m.id === 'inter.speedCv' ? ' (gated)' : ' (REPORT, not judged)'}`)
      : ['intermittency: no gate.json; run qa:motion3d gate on this run to print inter.speedCv and the O2 values'],
    ...IDLE_ACTS_LIMITS,
  ])
}
