import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Motion3dIdleDrive } from '../idle-drive'
import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { boolean, number, parseJson, pipe, record, safeParse, string, union } from 'valibot'

import { percentile } from '../gate/bands'
import { IDLE_MARKER, idleDriveDetail, QA_DRIVE_PRESENT } from '../idle-drive'
import { add, conjugate, DEG, multiply, rotate } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, gateStatus, markers, ReportUsageError } from './report'

export const IDLE_ACTS_VERSION = 5

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
} as const
/** The hips displacement, in L, that a rotation of the leg about the planted ankle by `deg` makes. */
const hipsFor = (deg: number) => Math.sin(deg * Math.PI / 180)

/** Behaviours the scheduler reports that are not drawn acts: sleep is entered on away, the two cues are the host's. */
const NOT_ACTS: ReadonlySet<string> = new Set(['sleep', 'about-to-speak', 'let-go'])
/**
 * The bones the performer writes from its own posture and support (`performance/posture.ts`), free of Natural's breath
 * (trunk pitch, clavicles, arms), slow head yaw (trunk yaw) and head and gaze streams (neck, head, eyes), which keep
 * lasting state after an activity by design. With the root block they are the channels the pair compares.
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
  { name: 'delay growth', value: C.maxShiftCalm, unit: 's per s that behaviours run [start, end + exit], at most: the pair\'s delay never decreases and never grows faster', source: 'maxShiftCalm (idle-activities.ts): an activity slows the weight-shift countdown by at most 60 %; amendment 4 A4.2' },
  { name: 'pair visible', value: C.actDeg, unit: `deg, largest aligned difference of the performer's bones and the root yaw on any interval (hips position ${hipsFor(C.actDeg).toFixed(4)} L)`, source: 'the act floor above; amendment 4 A4.2 (b1)' },
  { name: 'pair lasting', value: C.lastingDeg, unit: `deg, mean signed aligned difference per performer bone and the root yaw over the intervals after the first behaviour (hips position ${hipsFor(C.lastingDeg).toFixed(5)} L)`, source: 'rules.md revision 2, B1 scoring; amendment 4 A4.2 (b2)' },
]

/** What a PASS proves and what it does not; printed with every report. */
const IDLE_ACTS_LIMITS: readonly string[] = [
  'acts are the scheduler\'s own start and end reports (idle:<kind>:<start|end> markers); a movement the body plays without a report is never judged.',
  `an act counts when some channel changed within ${C.actSeconds} s by more than ${C.actDeg} deg and more than her own act-free windows of the same length do: this proves the body did something, not what. A motionless act is counted in at most about 5 % of its spans by construction. An act that changes every channel by less than ${C.actDeg} deg within ${C.actSeconds} s is not counted (a 6 deg sway, a 5 to 8 deg nod, a 10 deg wrist turn), and a slow drift that changes a channel by more than ${C.actDeg} deg within ${C.actSeconds} s is. The README lists the measured detection of labelled injections into her runs.`,
  'no-repeat judges only a kind started twice in a row (C001\'s bar); longer repeated blocks (A B A B) are printed above, and the visual review alone enforces "no repeated cycle". The scheduler never draws its last drawn kind again, so in the product the line fails only through a stretch or yawn follow-up after sleep or a host cue.',
  `the pair compares the performer's channels only (hips position, root yaw, hips and leg bones), each act-free interval against the companion delayed by the interval's delay: an activity postpones her weight-shift schedule by design. A lasting change that appears only after the last act is diluted in the mean over all intervals; a misaligned weight shift under ${C.actDeg} deg is caught only through the mean. Natural's breath, head and gaze streams keep lasting state after an activity by design and are printed, not judged.`,
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
    const yaw = this.input.root[frame * 4 + 3]
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
 * The signed difference of `channel` between frame `f` of `a` and frame `g` of `b`, written to `out`: a bone's rotation
 * vector (deg), the root yaw (deg, in out[0]) or the hips position (L). Returns its size.
 */
function difference(a: DecodedMotionTrace, f: number, b: DecodedMotionTrace, g: number, channel: Channel, out: Float64Array): number {
  const bones = a.trace.rig.bones.length
  switch (channel.kind) {
    case 'bone':
      rotationVector(a.rot, (f * bones + channel.bone) * 4, b.rot, (g * bones + channel.bone) * 4, out)
      return Math.hypot(out[0], out[1], out[2])
    case 'yaw':
      out[0] = (a.root[f * 4 + 3] - b.root[g * 4 + 3]) * DEG
      out[1] = 0
      out[2] = 0
      return Math.abs(out[0])
    case 'hips': {
      const legLength = a.trace.rig.legLength
      out[0] = (a.root[f * 4] - b.root[g * 4]) / legLength
      out[1] = (a.root[f * 4 + 1] - b.root[g * 4 + 1]) / legLength
      out[2] = (a.root[f * 4 + 2] - b.root[g * 4 + 2]) / legLength
      return Math.hypot(out[0], out[1], out[2])
    }
  }
}

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
  readonly channel: string
  readonly moved: boolean
}

export interface IdleAct extends IdleSpan {
  /** Started in the scored span, ended by a report, and a drawn kind: judged for movement. */
  readonly countable: boolean
  readonly movement: ActMovement | null
}

/** One act-free interval: the companion is compared at t - delay; `largest` is the largest aligned difference against its floor. */
export interface PairInterval {
  readonly from: number
  readonly to: number
  readonly delay: number
  readonly largest: { readonly channel: string, readonly value: number, readonly limit: number, readonly at: number }
}

export interface IdleActsDetail {
  readonly acts: readonly IdleAct[]
  readonly sequence: readonly string[]
  readonly repeatedBlocks: readonly string[]
  readonly pair: {
    readonly dir: string
    readonly intervals: readonly PairInterval[]
    /** Per performer channel, the mean signed aligned difference over the intervals after the first behaviour; null without one. */
    readonly lasting: readonly { readonly channel: string, readonly offset: number, readonly limit: number }[] | null
    readonly others: { readonly difference: number, readonly at: number | null, readonly bone: string | null }
  }
  readonly review: { readonly spans: readonly string[], readonly dependsOnThem: boolean, readonly consecutive: readonly string[] }
  readonly intermittency: readonly { readonly id: string, readonly status: string, readonly value: number | null }[] | null
}

function refusePair(run: LoadedRun, pair: LoadedRun, why: string): never {
  throw new ReportUsageError(`${run.dir} and ${pair.dir}: not a run and its acts-off pair: ${why}`)
}

/** The run and its acts-off companion must be the same model, commit, scenario, seed and length; the companion sets no drive. */
function checkPairSource(run: LoadedRun, pair: LoadedRun): void {
  const a = run.input.trace
  const b = pair.input.trace
  const refuse = (why: string) => refusePair(run, pair, why)
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

/**
 * The pair under one scheduler (amendment 4 A4.2): each act-free interval is compared with the companion at t - d, where
 * d never decreases and grows by at most `maxShiftCalm` of the time behaviours ran since the last interval, because an
 * activity only slows the performer's weight-shift countdown. d is the least-squares delay in that range. Judged: no
 * aligned difference above the act floor (a visible change no delay explains), and a mean signed aligned difference per
 * channel, over the intervals after the first behaviour, at most the lasting tolerance. Every other traced bone's
 * largest unaligned difference is printed.
 */
function comparePair(run: LoadedRun, pair: LoadedRun, spans: readonly IdleSpan[], on: TracePose, off: TracePose): IdleActsDetail['pair'] {
  const a = run.input
  const b = pair.input
  const { trace } = a
  const performer = new Set(PERFORMER_BONES.map(bone => on.index(bone)).filter(bone => bone >= 0))
  const channels: Channel[] = [
    ...trace.rig.bones.flatMap((name, bone): Channel[] => performer.has(bone) ? [{ kind: 'bone', bone, name }] : []),
    { kind: 'yaw', name: 'root yaw' },
    { kind: 'hips', name: 'hips position' },
  ]
  const visible = channels.map(channel => channel.kind === 'hips' ? hipsFor(C.actDeg) : C.actDeg)
  const lasting = channels.map(channel => channel.kind === 'hips' ? hipsFor(C.lastingDeg) : C.lastingDeg)
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

  const scratch = new Float64Array(3)
  const firstStart = spans.length ? spans[0].start : null
  const sums = channels.map(() => new Float64Array(3))
  let lastingFrames = 0
  let delay = 0
  let previousEnd = on.time(0)
  const intervals: PairInterval[] = runs.map(([first, last]) => {
    const grown = Math.ceil(C.maxShiftCalm * covered(running, previousEnd, on.time(first)) * trace.hz) + 1
    const highest = Math.min(delay + grown, first)
    let best = { d: delay, cost: Number.POSITIVE_INFINITY }
    for (let d = delay; d <= highest; d++) {
      let cost = 0
      for (let frame = first; frame <= last && cost < best.cost; frame++) {
        for (let c = 0; c < channels.length; c++)
          cost += (quickAngle(a, frame, b, frame - d, channels[c]) / lasting[c]) ** 2
      }
      if (cost < best.cost)
        best = { d, cost }
    }
    delay = best.d
    previousEnd = on.time(last)
    const counts = firstStart !== null && on.time(first) >= firstStart
    let largest = { channel: channels[0].name, value: 0, limit: visible[0], at: on.time(first), ratio: 0 }
    for (let frame = first; frame <= last; frame++) {
      channels.forEach((channel, c) => {
        const size = difference(a, frame, b, frame - delay, channel, scratch)
        if (size / visible[c] > largest.ratio)
          largest = { channel: channel.name, value: size, limit: visible[c], at: on.time(frame), ratio: size / visible[c] }
        if (counts) {
          for (let k = 0; k < 3; k++)
            sums[c][k] += scratch[k]
        }
      })
      if (counts)
        lastingFrames++
    }
    return { from: on.time(first), to: on.time(last), delay: delay / trace.hz, largest: { channel: largest.channel, value: largest.value, limit: largest.limit, at: largest.at } }
  })

  const others = { difference: 0, at: null as number | null, bone: null as string | null }
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
  return {
    dir: pair.dir,
    intervals,
    lasting: lastingFrames ? channels.map((channel, c) => ({ channel: channel.name, offset: Math.hypot(...sums[c]) / lastingFrames, limit: lasting[c] })) : null,
    others,
  }
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
    return { score: value, bar, windows: starts.length, channel: channels[top].name, moved: value > Math.max(1, bar) }
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

const unitOf = (channel: string) => channel === 'hips position' ? 'L' : 'deg'
const sized = (value: number, channel: string) => `${value.toFixed(channel === 'hips position' ? 5 : 3)} ${unitOf(channel)}`

/**
 * C001 under one idle scheduler (unit M2 rules section 3, amendment 4): the run names the fixed QA drive; at least 6
 * distinct kinds among the scheduler's acts that moved the body; no kind started twice in a row; and outside the acts the
 * run equals its acts-off companion on the performer's channels once the companion is delayed as the acts slowed her
 * weight-shift schedule.
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
  const pairRule = `each act-free interval against the acts-off run delayed by a delay that never decreases and grows by at most ${C.maxShiftCalm} s per s of behaviour: on the performer's bones (${PERFORMER_BONES.join(', ')}), the root yaw and the hips position, no aligned difference above ${C.actDeg} deg (hips ${hipsFor(C.actDeg).toFixed(4)} L), and over the intervals after the first behaviour a mean signed aligned difference of at most ${C.lastingDeg} deg (hips ${hipsFor(C.lastingDeg).toFixed(5)} L) per channel`
  const shown = pairing.intervals.filter(i => i.largest.value > i.largest.limit)
  const worst = pairing.intervals.reduce<PairInterval | null>((best, i) => !best || i.largest.value / i.largest.limit > best.largest.value / best.largest.limit ? i : best, null)
  const offsets = pairing.lasting ?? []
  const worstOffset = offsets.reduce<(typeof offsets)[number] | null>((best, o) => !best || o.offset / o.limit > best.offset / best.limit ? o : best, null)
  const delays = pairing.intervals.map(i => i.delay)
  const pairValue = `${pairing.intervals.length} intervals, delays ${delays.length ? `${delays[0].toFixed(3)} to ${delays[delays.length - 1].toFixed(3)} s` : 'none'}; largest aligned difference ${worst ? `${sized(worst.largest.value, worst.largest.channel)} (${worst.largest.channel} at ${worst.largest.at.toFixed(3)} s)` : 'none'}${shown.length ? `, above the floor in ${shown.length} intervals` : ''}; largest lasting offset ${worstOffset ? `${sized(worstOffset.offset, worstOffset.channel)} (${worstOffset.channel})` : 'none'}`
  const requirements: CaseRequirement[] = [
    driveRequirement(run, QA_DRIVE_PRESENT),
    judged('distinct-acts', `at least ${C.distinct} distinct kinds among the scheduler's acts that started in the scored span, ended, and changed some channel within ${C.actSeconds} s by more than ${C.actDeg} deg and more than the ${C.movedPercentile * 100}th percentile of her act-free windows`, `${kinds.size} distinct (${counted.length} moved of ${acts.filter(act => act.countable).length} judged, ${spans.length} behaviours started)`, kinds.size >= C.distinct),
    spans.length < 2
      ? notExercised('no-repeat', repeatRule, `${spans.length} behaviour started: no consecutive pair`)
      : judged('no-repeat', repeatRule, repeats.length ? `repeated: ${repeats.join(', ')}` : `${spans.length - 1} consecutive pairs, none repeated`, repeats.length === 0),
    pairing.lasting === null
      ? notExercised('pair', pairRule, 'no act-free frame after the first behaviour')
      : judged('pair', pairRule, pairValue, shown.length === 0 && offsets.every(o => o.offset <= o.limit)),
  ]
  const gate = run.gate
  return caseReport('idle-acts', IDLE_ACTS_VERSION, [run.dir, pair.dir], IDLE_ACTS_CONSTANTS, requirements, {
    acts,
    sequence,
    repeatedBlocks: repeatedBlocks(sequence),
    pair: pairing,
    review: {
      spans: reviewed.map(act => `${act.kind} ${act.start.toFixed(3)}-${act.end!.toFixed(3)} s`),
      dependsOnThem: kinds.size >= C.distinct && others.size < C.distinct,
      consecutive: counted.slice(1).map((act, i) => `${counted[i].kind} -> ${act.kind} at ${act.start.toFixed(3)} s`),
    },
    intermittency: gate ? ['inter.speedCv', ...O2_METRICS].map(id => ({ id, ...gateStatus(gate, id) })) : null,
  })
}

export function formatIdleActs(report: CaseReport<IdleActsDetail>): string {
  const d = report.detail
  return formatCaseReport(report, [
    `pair: ${d.pair.dir}; per act-free interval, the delay of her weight-shift schedule and the largest aligned difference on the performer's channels against its floor:`,
    ...d.pair.intervals.map(i => `  ${i.from.toFixed(3)}-${i.to.toFixed(3)} s\tdelay ${i.delay.toFixed(3)} s\t${sized(i.largest.value, i.largest.channel)} on ${i.largest.channel} at ${i.largest.at.toFixed(3)} s (floor ${sized(i.largest.limit, i.largest.channel)})`),
    `lasting offsets after the first behaviour (mean signed aligned difference against ${C.lastingDeg} deg): ${d.pair.lasting ? d.pair.lasting.map(o => `${o.channel} ${sized(o.offset, o.channel)}`).join(', ') : 'none'}`,
    `every other traced bone, unaligned (Natural's breath, head and gaze; printed, not judged): ${d.pair.others.difference.toFixed(4)} deg${d.pair.others.bone ? ` (${d.pair.others.bone} at ${fixed(d.pair.others.at)} s)` : ''}`,
    `behaviours the scheduler reported (${d.acts.length}):`,
    ...d.acts.map(act => `  ${act.start.toFixed(3)}\t${act.kind}\t${act.end === null ? 'no end report' : `ended ${act.end.toFixed(3)}`}\t${!act.countable ? 'not judged (warm-up, no end, or not a drawn act)' : act.movement === null ? `not judged (fewer than ${C.nullMinimum} act-free windows)` : `${act.movement.moved ? 'moved' : 'did not move'}: score ${act.movement.score.toFixed(2)} against max(1, ${act.movement.bar.toFixed(2)}) over ${act.movement.windows} windows, largest on ${act.movement.channel}`}`),
    `repeated blocks of two or more (printed for the visual review): ${d.repeatedBlocks.join('; ') || 'none'}`,
    `visual review list (C001): counted look-around and peer spans: ${d.review.spans.join(', ') || 'none'}; the count of ${C.distinct} ${d.review.dependsOnThem ? 'DEPENDS' : 'does not depend'} on them; consecutive counted acts: ${d.review.consecutive.join(', ') || 'none'}`,
    ...d.intermittency
      ? d.intermittency.map(m => `${m.id}: ${m.status} ${fixed(m.value)}${m.id === 'inter.speedCv' ? ' (gated)' : ' (REPORT, not judged)'}`)
      : ['intermittency: no gate.json; run qa:motion3d gate on this run to print inter.speedCv and the O2 values'],
    ...IDLE_ACTS_LIMITS,
  ])
}
