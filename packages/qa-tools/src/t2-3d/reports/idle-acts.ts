import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Motion3dIdleDrive } from '../idle-drive'
import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { percentile } from '../gate/bands'
import { IDLE_MARKER, idleDriveDetail, QA_DRIVE_PRESENT } from '../idle-drive'
import { add, conjugate, DEG, median, multiply, norm, rotate, sub } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, gateStatus, markers, ReportUsageError } from './report'

export const IDLE_ACTS_VERSION = 4

const C = {
  distinct: 6,
  exitSeconds: 1.6,
  settleSeconds: 2.2,
  movedPercentile: 0.95,
  nullStep: 0.5,
  nullMinimum: 20,
  stillDeg: 0.01,
  stillHips: 0.0001,
  epsilonDeg: 0.25,
  yawEpsilonDeg: 0.05,
  hipsEpsilon: 0.0005,
} as const

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
  { name: 'drive', value: QA_DRIVE_PRESENT.name, unit: idleDriveDetail(QA_DRIVE_PRESENT).idleDriveValues, source: 'C001 owner decision "Idle wording: Amend it"; unit M2 rules section 1' },
  { name: 'distinct acts', value: C.distinct, unit: 'kinds among counted acts', source: 'C001' },
  { name: 'exit', value: C.exitSeconds, unit: 's after an end report, inside the act', source: 'the longest release of a behaviour, wakeSeconds (idle-activities.ts)' },
  { name: 'settling', value: C.settleSeconds, unit: 's after the exit, outside the pair check and the act-free windows', source: '2 % settling of the slowest arm follower, performance/arms.ts' },
  { name: 'moved', value: C.movedPercentile, unit: 'percentile of the act-free windows\' scores that an act\'s score must exceed', source: 'one-sided 5 % bar, as the turn report\'s pseudo-placebos' },
  { name: 'act-free windows', value: `${C.nullStep} s grid, at least ${C.nullMinimum}`, unit: 'windows of the act\'s length in the scored span, clear of every widened behaviour', source: 'unit M2 rules section 3' },
  { name: 'still floor', value: `${C.stillDeg} deg, ${C.stillHips} L`, unit: 'least channel scale (median act-free excursion)', source: 'above float32 storage noise' },
  { name: 'pair epsilon', value: C.epsilonDeg, unit: 'deg, largest local-rotation difference of the performer\'s bones outside the widened spans', source: 'rules.md revision 2, B1 scoring' },
  { name: 'pair root yaw', value: C.yawEpsilonDeg, unit: 'deg, largest root-yaw difference outside the widened spans', source: 'rules.md revision 3, X2 scoring' },
  { name: 'pair hips', value: C.hipsEpsilon, unit: 'L, largest hips-position difference outside the widened spans', source: 'rules.md revision 3, X2 scoring' },
]

/** What a PASS proves and what it does not; printed with every report. */
const IDLE_ACTS_LIMITS: readonly string[] = [
  'acts are the scheduler\'s own start and end reports (idle:<kind>:<start|end> markers); a movement the body plays without a report is never judged.',
  'an act counts when the body moved more than in 95 % of her own act-free windows of the same length: this proves the body did something, not what; a motionless act is counted in about 5 % of its spans by construction, and a small real act within her idle\'s range may not be counted (or may be, when it adds to a channel\'s own sway).',
  'the pair compares the performer\'s channels only (hips position, root yaw, hips and leg bones); Natural\'s breath, head and gaze streams keep lasting state after an activity by design and are printed, not judged.',
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

/** The `drive` line: the run's provenance names `drive` with exactly its values. */
export function driveRequirement(run: LoadedRun, drive: Motion3dIdleDrive): CaseRequirement {
  const { detail } = run.input.trace.source
  const expected = idleDriveDetail(drive)
  const named = detail.idleDrive === undefined ? 'no idle drive in the provenance' : `${String(detail.idleDrive)} ${String(detail.idleDriveValues)}`
  return judged('drive', `the run's provenance names ${expected.idleDrive} with ${expected.idleDriveValues}`, named, detail.idleDrive === expected.idleDrive && detail.idleDriveValues === expected.idleDriveValues)
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

/** One measured channel: a body bone's local rotation (deg), the root yaw (deg) or the hips position (L). */
type Channel = { readonly kind: 'bone', readonly bone: number, readonly name: string } | { readonly kind: 'yaw' | 'hips', readonly name: string }

function channelChange(pose: TracePose, channel: Channel, from: number, frame: number, legLength: number): number {
  switch (channel.kind) {
    case 'bone': return angleBetween(pose.local(frame, channel.bone), pose.local(from, channel.bone))
    case 'yaw': return Math.abs(pose.yaw(frame) - pose.yaw(from)) * DEG
    case 'hips': return norm(sub(pose.hips(frame), pose.hips(from))) / legLength
  }
}

/** Each channel's largest change from its value at frame `first` over frames [first, last]. */
function excursions(pose: TracePose, channels: readonly Channel[], first: number, last: number, legLength: number): number[] {
  return channels.map((channel) => {
    let largest = 0
    for (let frame = first + 1; frame <= last; frame++)
      largest = Math.max(largest, channelChange(pose, channel, first, frame, legLength))
    return largest
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

export interface IdleActsDetail {
  readonly acts: readonly IdleAct[]
  readonly sequence: readonly string[]
  readonly repeatedBlocks: readonly string[]
  readonly pair: {
    readonly dir: string
    readonly performer: { readonly difference: number, readonly at: number | null, readonly bone: string | null, readonly yaw: number, readonly hips: number }
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

/**
 * Outside every behaviour widened by the exit and the settling, the largest difference between the run and its
 * companion on the performer's channels (judged) and on every other traced bone (printed).
 */
function comparePair(run: LoadedRun, pair: LoadedRun, spans: readonly IdleSpan[], on: TracePose, off: TracePose): IdleActsDetail['pair'] {
  const { trace } = run.input
  const widened = spans.map(span => ({ start: span.start, end: (span.end ?? Number.POSITIVE_INFINITY) + C.exitSeconds + C.settleSeconds }))
  const performer = new Set(PERFORMER_BONES.map(bone => on.index(bone)).filter(b => b >= 0))
  const own = { difference: 0, at: null as number | null, bone: null as string | null, yaw: 0, hips: 0 }
  const others = { difference: 0, at: null as number | null, bone: null as string | null }
  for (let frame = 0; frame < on.frames; frame++) {
    const t = on.time(frame)
    if (t < trace.scoredFrom || widened.some(span => t >= span.start && t <= span.end))
      continue
    trace.rig.bones.forEach((name, b) => {
      const d = angleBetween(on.local(frame, b), off.local(frame, b))
      const into = performer.has(b) ? own : others
      if (d > into.difference) {
        into.difference = d
        into.at = t
        into.bone = name
      }
    })
    own.yaw = Math.max(own.yaw, Math.abs(on.yaw(frame) - off.yaw(frame)) * DEG)
    own.hips = Math.max(own.hips, norm(sub(on.hips(frame), off.hips(frame))) / trace.rig.legLength)
  }
  return { dir: pair.dir, performer: own, others }
}

/**
 * Whether each countable act moved the body more than her own act-free windows of the same length: per channel, its
 * excursion over the act's window [start, end + exit] scaled by the median excursion over the act-free windows (floored),
 * the largest scaled excursion against the 95th percentile of the same score over those windows.
 */
function movements(run: LoadedRun, pose: TracePose, acts: readonly IdleSpan[], spans: readonly IdleSpan[]): (ActMovement | null)[] {
  const { trace } = run.input
  const legLength = trace.rig.legLength
  const channels: Channel[] = [
    ...trace.rig.bones.flatMap((name, bone): Channel[] => BODY_BONES.has(name) ? [{ kind: 'bone', bone, name }] : []),
    { kind: 'yaw', name: 'root yaw' },
    { kind: 'hips', name: 'hips position' },
  ]
  const floors = channels.map(channel => channel.kind === 'hips' ? C.stillHips : C.stillDeg)
  const frameAt = (t: number) => {
    let frame = 0
    while (frame < pose.frames - 1 && pose.time(frame) < t - 1e-9)
      frame++
    return frame
  }
  const scoredEnd = pose.time(pose.frames - 1)
  const busy = spans.map(span => ({ start: span.start, end: (span.end ?? Number.POSITIVE_INFINITY) + C.exitSeconds + C.settleSeconds }))
  return acts.map((act) => {
    const length = act.end! + C.exitSeconds - act.start
    const starts: number[] = []
    for (let s = trace.scoredFrom; s + length <= scoredEnd + 1e-9; s += C.nullStep) {
      if (!busy.some(span => s < span.end && s + length > span.start))
        starts.push(s)
    }
    if (starts.length < C.nullMinimum)
      return null
    const nulls = starts.map(s => excursions(pose, channels, frameAt(s), frameAt(s + length), legLength))
    const scales = channels.map((_, c) => Math.max(floors[c], median(nulls.map(n => n[c]))))
    const score = (values: readonly number[]) => values.reduce((best, value, c) => Math.max(best, value / scales[c]), 0)
    const bar = percentile(nulls.map(score), C.movedPercentile)
    const own = excursions(pose, channels, frameAt(act.start), frameAt(act.start + length), legLength)
    const top = own.reduce((best, value, c) => value / scales[c] > own[best] / scales[best] ? c : best, 0)
    const value = score(own)
    return { score: value, bar, windows: starts.length, channel: channels[top].name, moved: value > bar }
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

/**
 * C001 under one idle scheduler (unit M2 rules section 3): the run names the fixed QA drive; at least 6 distinct kinds
 * among the scheduler's acts that moved the body; no kind started twice in a row; and outside the acts the run equals
 * its acts-off companion on the performer's channels.
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
  const p = pairing.performer
  const reviewed = counted.filter(act => act.kind === 'look-around' || act.kind === 'peer')
  const others = new Set(counted.filter(act => act.kind !== 'look-around' && act.kind !== 'peer').map(act => act.kind))
  const repeatRule = 'no two consecutive started behaviours (every reported kind, in start order) share a kind'
  const pairRule = `outside every behaviour widened by ${C.exitSeconds} s exit and ${C.settleSeconds} s settling, the performer's bones (${PERFORMER_BONES.join(', ')}) differ from the acts-off run by at most ${C.epsilonDeg} deg, the root yaw by ${C.yawEpsilonDeg} deg and the hips position by ${C.hipsEpsilon} L`
  const requirements: CaseRequirement[] = [
    driveRequirement(run, QA_DRIVE_PRESENT),
    judged('distinct-acts', `at least ${C.distinct} distinct kinds among the scheduler's acts that started in the scored span, ended, and moved the body more than the ${C.movedPercentile * 100}th percentile of her act-free windows`, `${kinds.size} distinct (${counted.length} moved of ${acts.filter(act => act.countable).length} judged, ${spans.length} behaviours started)`, kinds.size >= C.distinct),
    spans.length < 2
      ? notExercised('no-repeat', repeatRule, `${spans.length} behaviour started: no consecutive pair`)
      : judged('no-repeat', repeatRule, repeats.length ? `repeated: ${repeats.join(', ')}` : `${spans.length - 1} consecutive pairs, none repeated`, repeats.length === 0),
    judged('pair', pairRule, `bones ${p.difference.toFixed(4)} deg${p.bone ? ` (${p.bone} at ${fixed(p.at)} s)` : ''}, root yaw ${p.yaw.toFixed(4)} deg, hips ${p.hips.toFixed(5)} L`, p.difference <= C.epsilonDeg && p.yaw <= C.yawEpsilonDeg && p.hips <= C.hipsEpsilon),
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
    `pair: ${d.pair.dir}; outside the widened acts, the performer's bones differ by at most ${d.pair.performer.difference.toFixed(4)} deg${d.pair.performer.bone ? ` (${d.pair.performer.bone} at ${fixed(d.pair.performer.at)} s)` : ''}, root yaw ${d.pair.performer.yaw.toFixed(4)} deg, hips ${d.pair.performer.hips.toFixed(5)} L; every other traced bone (Natural's breath, head and gaze; printed, not judged) ${d.pair.others.difference.toFixed(4)} deg${d.pair.others.bone ? ` (${d.pair.others.bone} at ${fixed(d.pair.others.at)} s)` : ''}`,
    `behaviours the scheduler reported (${d.acts.length}):`,
    ...d.acts.map(act => `  ${act.start.toFixed(3)}\t${act.kind}\t${act.end === null ? 'no end report' : `ended ${act.end.toFixed(3)}`}\t${!act.countable ? 'not judged (warm-up, no end, or not a drawn act)' : act.movement === null ? `not judged (fewer than ${C.nullMinimum} act-free windows)` : `${act.movement.moved ? 'moved' : 'did not move'}: score ${act.movement.score.toFixed(2)} against ${act.movement.bar.toFixed(2)} over ${act.movement.windows} windows, largest on ${act.movement.channel}`}`),
    `repeated blocks of two or more (printed for the visual review): ${d.repeatedBlocks.join('; ') || 'none'}`,
    `visual review list (C001): counted look-around and peer spans: ${d.review.spans.join(', ') || 'none'}; the count of ${C.distinct} ${d.review.dependsOnThem ? 'DEPENDS' : 'does not depend'} on them; consecutive counted acts: ${d.review.consecutive.join(', ') || 'none'}`,
    ...d.intermittency
      ? d.intermittency.map(m => `${m.id}: ${m.status} ${fixed(m.value)}${m.id === 'inter.speedCv' ? ' (gated)' : ' (REPORT, not judged)'}`)
      : ['intermittency: no gate.json; run qa:motion3d gate on this run to print inter.speedCv and the O2 values'],
    ...IDLE_ACTS_LIMITS,
  ])
}
