import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyActId, BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { conjugate, cv, DEG, heading, multiply, norm, rotationVector, sub } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, gateStatus, markers, ReportUsageError } from './report'

export const IDLE_ACTS_VERSION = 2

/**
 * One key of an act's form (architecture 4e): the difference between the paired runs that the act must produce, at
 * `amplitude` (deg; L for `position`), on any one of `bones` (alternatives, such as either hand).
 * - `local`: the bone's rotation relative to its parent;
 * - `from`: the bone's world orientation relative to the world orientation of `from` at the same index;
 * - `world`: the bone's world orientation;
 * - `position`: the hips' world position.
 * `after` lists the keys of the same act whose first qualifying run must start before this key's (the design's order).
 */
type ActKeyShape
  = | { readonly kind: 'local' | 'world', readonly bones: readonly MotionTraceBone[], readonly amplitude: number }
    | { readonly kind: 'from', readonly bones: readonly MotionTraceBone[], readonly from: readonly MotionTraceBone[], readonly amplitude: number }
    | { readonly kind: 'position', readonly amplitude: number }
export type ActKey = ActKeyShape & { readonly after?: readonly number[] }

const both = (bone: 'Shoulder' | 'UpperArm' | 'Foot', amplitude: number): ActKey[] => (['left', 'right'] as const).map(side => ({ kind: bone === 'Foot' ? 'world' : 'local', bones: [`${side}${bone}`], amplitude }))
const eitherHand = (amplitude: number): ActKey => ({ kind: 'from', bones: ['leftHand', 'rightHand'], from: ['leftUpperArm', 'rightUpperArm'], amplitude })
const trunk = (amplitude: number): ActKey => ({ kind: 'from', bones: ['chest'], from: ['hips'], amplitude })

/**
 * Every key an act's movement must carry, at its architecture 4e design amplitude (4b for the peek-at-chat lean; the low
 * end of a 4e range). An act is confirmed when the paired runs differ by half of each amplitude (rules.md revision 2, B1).
 */
export const ACT_KEYS = {
  'sigh': [trunk(4), ...both('Shoulder', 4)],
  'shoulder-roll': [...both('Shoulder', 10), { kind: 'from', bones: ['head'], from: ['chest'], amplitude: 12, after: [0, 1] }],
  'foot-replant': [{ kind: 'world', bones: ['leftFoot', 'rightFoot'], amplitude: 4 }],
  'look-around': [{ kind: 'world', bones: ['head'], amplitude: 35 }],
  'hand-inspect': [eitherHand(60)],
  'clasp-rock': [{ kind: 'position', amplitude: 0.012 }],
  'arm-swing': both('UpperArm', 8),
  'hair-tuck': [{ kind: 'local', bones: ['head'], amplitude: 4 }],
  'yawn': [{ kind: 'from', bones: ['head'], from: ['chest'], amplitude: 8 }, ...both('Shoulder', 5), trunk(3)],
  'peek-chat': [trunk(5)],
  'heel-raise': [{ kind: 'position', amplitude: 0.012 }, ...both('Foot', 14)],
  'wave': [eitherHand(18)],
} as const satisfies Record<BodyActId, readonly ActKey[]>

const LEG_CHAIN: readonly MotionTraceBone[] = ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes']

/**
 * The state an act's design declares as its lasting result (switch contract item 2, rules.md revision 3, X3a): from the
 * end of its widened span the pair check compares these local rotations by the change of their difference's angle and
 * the hips by the change of their heading-frame offset, after bounding the residual itself. Architecture 4e act 3: the
 * free foot takes a step with a yaw of 4 to 8 deg (x1.5 at the amplitude top: 12) and the support returns to a half
 * shift; 0.02 L is the act's only translation, its swing height.
 */
export const ACT_LASTING: Partial<Record<BodyActId, { readonly bones: readonly MotionTraceBone[], readonly footYawDeg: number, readonly hips: number }>> = {
  'foot-replant': { bones: LEG_CHAIN, footYawDeg: 12, hips: 0.02 },
}

/** The acts allowed while the rest state is `rest` (plan D3); data, so a restricted set is passed, not coded. */
export const REST_ACT_SET: readonly BodyActId[] = ['sigh', 'yawn', 'foot-replant', 'look-around', 'shoulder-roll', 'hand-inspect']

const C = {
  distinct: 6,
  confirmFrames: 18,
  bar: 0.5,
  epsilonDeg: 0.25,
  yawEpsilonDeg: 0.05,
  hipsEpsilon: 0.0005,
  exitSeconds: 0.35,
  settleSeconds: 2.2,
} as const
const ACT_STATES: readonly string[] = ['playing', 'finished', 'cancelled']
const REST_STATES: readonly BodyRest[] = ['none', 'rest', 'doze']
const O2_METRICS = ['inter.burstCv', 'inter.holdFraction', 'inter.movesPerMin'] as const

export const IDLE_ACTS_CONSTANTS: readonly ReportConstant[] = [
  { name: 'distinct acts', value: C.distinct, unit: 'counted, confirmed forms', source: 'C001' },
  { name: 'confirmation run', value: C.confirmFrames, unit: 'consecutive 60 Hz frames (0.3 s) on which each key reaches its bar, somewhere in the span, in the design order', source: 'plan R1; rules.md revision 3, X3b' },
  { name: 'confirmation bar', value: C.bar, unit: 'of each key\'s design amplitude (ACT_KEYS)', source: 'architecture 4e; review B1 step 5' },
  { name: 'pair epsilon', value: C.epsilonDeg, unit: 'deg, largest local-rotation difference outside the widened act spans', source: 'rules.md revision 2, B1 scoring' },
  { name: 'pair root yaw', value: C.yawEpsilonDeg, unit: 'deg, largest root-yaw difference outside the widened act spans', source: 'rules.md revision 3, X2 scoring' },
  { name: 'pair hips', value: C.hipsEpsilon, unit: 'L, largest hips-position difference outside the widened act spans', source: 'rules.md revision 3, X2 scoring' },
  { name: 'act exit', value: C.exitSeconds, unit: 's after the closing marker', source: 'performance/stack.ts default exitSeconds' },
  { name: 'settling', value: C.settleSeconds, unit: 's after the exit, outside the pair check', source: '2 % settling of the slowest arm follower, performance/arms.ts' },
]

export function isActId(id: string): id is BodyActId {
  return Object.hasOwn(ACT_KEYS, id)
}

export interface ActSpan {
  readonly id: BodyActId
  readonly start: number
  /** The closing marker's time, or null while unclosed at the end of the trace. */
  readonly end: number | null
  readonly closedBy: 'finished' | 'cancelled' | null
  readonly rest: BodyRest
  /** The acts whose every key the movement in this span meets (its form). */
  readonly form: readonly BodyActId[]
  /** The act's own keys are met: its form includes its id. */
  readonly confirmed: boolean
  /** The span overlaps an earlier act's span, so its movement is that act's. */
  readonly overlaps: boolean
  /** Per own key: whether a qualifying run exists in the span (in the design's order) and the longest run, frames. */
  readonly keys: readonly { readonly reached: boolean, readonly longest: number }[]
}

export interface IdleActsDetail {
  readonly acts: readonly ActSpan[]
  readonly restSet: readonly BodyActId[]
  readonly pair: { readonly dir: string, readonly difference: number, readonly at: number | null, readonly bone: string | null, readonly yaw: number, readonly hips: number }
  readonly intervals: readonly number[]
  readonly intervalCv: number | null
  readonly restSeconds: Readonly<Record<BodyRest, number>>
  readonly intermittency: readonly { readonly id: string, readonly status: string, readonly value: number | null }[] | null
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

type RawSpan = Pick<ActSpan, 'id' | 'start' | 'end' | 'closedBy' | 'rest'>

function actSpans(run: LoadedRun, restAt: (t: number) => BodyRest): RawSpan[] {
  const spans: RawSpan[] = []
  const open = new Map<BodyActId, number>()
  for (const { t, parts } of markers(run, 'act:')) {
    const [id, state] = parts
    if (parts.length !== 2 || !isActId(id) || !ACT_STATES.includes(state))
      throw new ReportUsageError(`${run.dir}: malformed act marker at ${t.toFixed(3)} s: act:${parts.join(':')}`)
    if (state === 'playing') {
      open.set(id, spans.length)
      spans.push({ id, start: t, end: null, closedBy: null, rest: restAt(t) })
      continue
    }
    const index = open.get(id)
    if (index === undefined)
      throw new ReportUsageError(`${run.dir}: act:${id}:${state} at ${t.toFixed(3)} s has no playing marker before it`)
    spans[index] = { ...spans[index], end: t, closedBy: state === 'finished' ? 'finished' : 'cancelled' }
    open.delete(id)
  }
  return spans
}

/** Frame-indexed access to a decoded trace's local rotations, world orientations and hips position, warm-up included. */
export class TracePose {
  private readonly bones: readonly MotionTraceBone[]
  private readonly parents: readonly number[]
  readonly frames: number
  constructor(readonly input: DecodedMotionTrace) {
    this.bones = input.trace.rig.bones
    this.parents = input.trace.rig.parents
    this.frames = input.trace.frames
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

/** The difference of one key between the paired runs at one frame: degrees, or L for the hips position. */
function keyDifference(on: TracePose, off: TracePose, key: ActKey, frame: number): number {
  if (key.kind === 'position')
    return norm(sub(on.hips(frame), off.hips(frame))) / on.input.trace.rig.legLength
  return key.bones.reduce((best, bone, k) => {
    const b = on.index(bone)
    if (b < 0)
      return best
    if (key.kind !== 'from')
      return Math.max(best, key.kind === 'local' ? angleBetween(on.local(frame, b), off.local(frame, b)) : angleBetween(on.world(frame, b), off.world(frame, b)))
    const from = on.index(key.from[k])
    if (from < 0)
      return best
    const relative = (pose: TracePose) => multiply(conjugate(pose.world(frame, from)), pose.world(frame, b))
    return Math.max(best, angleBetween(relative(on), relative(off)))
  }, 0)
}

/**
 * Each key of `id` over [first, last]: the starts of its runs of `confirmFrames` frames at half its amplitude, and its
 * longest run. The act is confirmed when every key has a run and each key with `after` has one starting after the first
 * run of each key it follows (rules.md revision 3, X3b).
 */
function keyResults(on: TracePose, off: TracePose, id: BodyActId, first: number, last: number): { confirmed: boolean, keys: { reached: boolean, longest: number }[] } {
  const keys: readonly ActKey[] = ACT_KEYS[id]
  const results = keys.map((key) => {
    const starts: number[] = []
    let run = 0
    let longest = 0
    for (let frame = first; frame <= last; frame++) {
      run = keyDifference(on, off, key, frame) >= C.bar * key.amplitude ? run + 1 : 0
      longest = Math.max(longest, run)
      if (run === C.confirmFrames)
        starts.push(frame - C.confirmFrames + 1)
    }
    return { starts, longest }
  })
  const reached = keys.map((key, k) => results[k].starts.length > 0 && (!key.after || results[k].starts.some(start => key.after!.every(j => results[j].starts.length > 0 && start > results[j].starts[0]))))
  return { confirmed: reached.every(Boolean), keys: results.map((r, k) => ({ reached: reached[k], longest: r.longest })) }
}

/** The run and its acts-off companion must be the same model, commit, seed and length, and differ only inside acts. */
function checkPair(run: LoadedRun, pair: LoadedRun, spans: readonly RawSpan[]): IdleActsDetail['pair'] {
  const a = run.input.trace
  const b = pair.input.trace
  const refuse = (why: string) => {
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
  if (markers(pair, 'act:').length)
    refuse('the acts-off companion has act markers')
  const on = new TracePose(run.input)
  const off = new TracePose(pair.input)
  const widened = spans.map(span => ({ id: span.id, start: span.start, end: (span.end ?? Number.POSITIVE_INFINITY) + C.exitSeconds + C.settleSeconds }))
  const declaring = widened.filter(span => ACT_LASTING[span.id] && Number.isFinite(span.end)).sort((x, y) => x.end - y.end)
  const hipsOffset = (frame: number) => heading(sub(on.hips(frame), off.hips(frame)), on.yaw(frame))
  let base: { readonly angles: ReadonlyMap<number, number>, readonly hips: Vec3 } | null = null
  let next = 0
  let difference = 0
  let at: number | null = null
  let bone: string | null = null
  let yaw = 0
  let hips = 0
  for (let frame = 0; frame < on.frames; frame++) {
    const t = on.time(frame)
    if (next < declaring.length && t > declaring[next].end) {
      const lasting = ACT_LASTING[declaring[next].id]!
      const footYaw = Math.max(...(['leftFoot', 'rightFoot'] as const).map(foot => on.index(foot)).filter(b => b >= 0).map(b => Math.abs(rotationVector(multiply(on.world(frame, b), conjugate(off.world(frame, b))))[1]) * DEG), 0)
      const offset = hipsOffset(frame)
      if (footYaw > lasting.footYawDeg || norm(offset) / a.rig.legLength > lasting.hips)
        refuse(`the lasting result of ${declaring[next].id} at ${t.toFixed(3)} s exceeds its declared bound: foot yaw ${footYaw.toFixed(2)} deg (at most ${lasting.footYawDeg}), hips ${(norm(offset) / a.rig.legLength).toFixed(4)} L (at most ${lasting.hips})`)
      base = { angles: new Map(lasting.bones.map(name => on.index(name)).filter(b => b >= 0).map(b => [b, angleBetween(on.local(frame, b), off.local(frame, b))])), hips: offset }
      next++
    }
    if (t < a.scoredFrom || widened.some(span => t >= span.start && t <= span.end))
      continue
    a.rig.bones.forEach((name, b) => {
      const raw = angleBetween(on.local(frame, b), off.local(frame, b))
      const residual = base?.angles.get(b)
      const d = residual === undefined ? raw : Math.abs(raw - residual)
      if (d > difference) {
        difference = d
        at = t
        bone = name
      }
    })
    yaw = Math.max(yaw, Math.abs(on.yaw(frame) - off.yaw(frame)) * DEG)
    hips = Math.max(hips, norm(base ? sub(hipsOffset(frame), base.hips) : hipsOffset(frame)) / a.rig.legLength)
  }
  if (difference > C.epsilonDeg)
    refuse(`they differ outside the act spans by ${difference.toFixed(3)} deg (${bone} at ${at === null ? '-' : (at as number).toFixed(3)} s), more than ${C.epsilonDeg} deg`)
  if (yaw > C.yawEpsilonDeg)
    refuse(`their root yaw differs outside the act spans by ${yaw.toFixed(3)} deg, more than ${C.yawEpsilonDeg} deg`)
  if (hips > C.hipsEpsilon)
    refuse(`their hips position differs outside the act spans by ${hips.toFixed(5)} L, more than ${C.hipsEpsilon} L`)
  return { dir: pair.dir, difference, at, bone, yaw, hips }
}

/**
 * C001 (plan R1, revision 2): distinct acts confirmed by the difference to the same-seed acts-off run, counted by form,
 * no immediate repeat, and only rest-set acts while resting.
 */
export function idleActsReport(run: LoadedRun, pair: LoadedRun, restSet: readonly BodyActId[] = REST_ACT_SET): CaseReport<IdleActsDetail> {
  const { p, input } = run
  if (input.trace.source.scenario.class !== 'idle')
    throw new ReportUsageError(`${run.dir}: idle-acts judges an idle-class run, not ${input.trace.source.scenario.class}`)
  const restAt = restStates(run)
  const raw = actSpans(run, restAt)
  const pairing = checkPair(run, pair, raw)
  const on = new TracePose(input)
  const off = new TracePose(pair.input)
  const frameAt = (t: number) => {
    let frame = 0
    while (frame < on.frames - 1 && on.time(frame) < t)
      frame++
    return frame
  }
  const acts: ActSpan[] = raw.map((span, i) => {
    const first = frameAt(span.start)
    const last = span.end === null ? on.frames - 1 : frameAt(span.end + C.exitSeconds)
    const form = (Object.keys(ACT_KEYS) as BodyActId[]).filter(id => keyResults(on, off, id, first, last).confirmed)
    const overlaps = raw.slice(0, i).some(earlier => span.start < (earlier.end ?? Number.POSITIVE_INFINITY) && earlier.start < (span.end ?? Number.POSITIVE_INFINITY))
    return { ...span, form, confirmed: form.includes(span.id), overlaps, keys: keyResults(on, off, span.id, first, last).keys }
  })
  const formKey = (act: ActSpan) => act.form.join('+')
  const counted = acts.filter(act => act.closedBy === 'finished')
  const confirmed = counted.filter(act => act.confirmed && !act.overlaps)
  const distinct = new Set(confirmed.map(formKey))
  const repeats = acts.slice(1).flatMap((act, i) => act.id === acts[i].id || (act.form.length > 0 && formKey(act) === formKey(acts[i])) ? [`${act.id} at ${act.start.toFixed(3)} s`] : [])
  const resting = acts.filter(act => act.rest !== 'none')
  const disallowed = resting.filter(act => act.rest === 'doze' || !restSet.includes(act.id))
  const restRule = `every act started while resting is in the rest set {${restSet.join(', ')}}, and none starts while dozing`
  const repeatRule = 'no two consecutive started acts (cancelled included) share an id or the same movement form'
  const requirements: CaseRequirement[] = [
    judged('distinct-acts', `at least ${C.distinct} distinct forms among acts closed by finished, confirmed by the difference to the acts-off run and not overlapping an earlier act`, `${distinct.size} distinct (${confirmed.length} confirmed of ${counted.length} finished, ${acts.length} started)`, distinct.size >= C.distinct),
    acts.length < 2
      ? notExercised('no-repeat', repeatRule, `${acts.length} act started: no consecutive pair`)
      : judged('no-repeat', repeatRule, repeats.length ? `repeated: ${repeats.join(', ')}` : `${acts.length - 1} consecutive pairs, none repeated`, repeats.length === 0),
    resting.length === 0
      ? notExercised('rest-set', restRule, 'no act started while resting or dozing')
      : judged('rest-set', restRule, disallowed.length ? `not allowed: ${disallowed.map(act => `${act.id} in ${act.rest} at ${act.start.toFixed(3)} s`).join(', ')}` : `${resting.length} acts started while resting, all allowed`, disallowed.length === 0),
  ]
  const intervals = counted.slice(1).map((act, i) => act.start - counted[i].start)
  const restSeconds = { none: 0, rest: 0, doze: 0 }
  for (const t of p.times)
    restSeconds[restAt(t)] += 1 / 60
  const gate = run.gate
  const intermittency = gate ? ['inter.speedCv', ...O2_METRICS].map(id => ({ id, ...gateStatus(gate, id) })) : null
  return caseReport('idle-acts', IDLE_ACTS_VERSION, [run.dir, pair.dir], IDLE_ACTS_CONSTANTS, requirements, {
    acts,
    restSet,
    pair: pairing,
    intervals,
    intervalCv: intervals.length >= 2 ? cv(intervals) : null,
    restSeconds,
    intermittency,
  })
}

export function formatIdleActs(report: CaseReport<IdleActsDetail>): string {
  const d = report.detail
  return formatCaseReport(report, [
    `pair: ${d.pair.dir}, largest difference outside the act spans ${d.pair.difference.toFixed(4)} deg${d.pair.bone ? ` (${d.pair.bone} at ${fixed(d.pair.at)} s)` : ''}, root yaw ${d.pair.yaw.toFixed(4)} deg, hips ${d.pair.hips.toFixed(5)} L`,
    `act timeline (${d.acts.length} started):`,
    ...d.acts.map(act => `  ${act.start.toFixed(3)}\t${act.id}\t${act.closedBy ?? 'unclosed'}${act.end === null ? '' : ` at ${act.end.toFixed(3)}`}\t${act.rest}\t${act.confirmed ? 'confirmed' : 'not confirmed'} (own keys reached ${act.keys.filter(key => key.reached).length} of ${act.keys.length}; longest runs ${act.keys.map(key => key.longest).join('/')} frames)${act.overlaps ? '\toverlaps an earlier act' : ''}\tform {${act.form.join(', ')}}`),
    d.intervals.length ? `intervals between finished acts (s): ${d.intervals.map(v => v.toFixed(2)).join(', ')}; CV ${fixed(d.intervalCv)}` : 'intervals: fewer than 2 finished acts, no interval',
    `scored seconds by rest state: none ${d.restSeconds.none.toFixed(1)}, rest ${d.restSeconds.rest.toFixed(1)}, doze ${d.restSeconds.doze.toFixed(1)}`,
    ...d.intermittency
      ? d.intermittency.map(m => `${m.id}: ${m.status} ${fixed(m.value)}${m.id === 'inter.speedCv' ? ' (gated)' : ' (REPORT, not judged)'}`)
      : ['intermittency: no gate.json; run qa:motion3d gate on this run to print inter.speedCv and the O2 values'],
    'inter.burstCv, inter.holdFraction and inter.movesPerMin: no long-idle human band exists (owner decision O2); they are printed, not judged.',
  ])
}
