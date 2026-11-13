import type { BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { MotionBandsFile } from '../gate/types'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { IDLE_TO_SIT_MS } from '@proj-airi/motion-driver-humanoid/director'
import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { percentile } from '../gate/bands'
import { QA_DRIVE_AWAY } from '../idle-drive'
import { prepareTrace, smoothMetrics } from '../metrics'
import { conjugate, DEG, HZ, mean, multiply, rotate } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { driveRequirement, idleSpans, restStates, TracePose } from './idle-acts'
import { POP_CONSTANTS } from './kinematics'
import { popEvents, upperBodyPopBones } from './pops'
import { fixed, markers, ReportUsageError } from './report'

export const REST_VERSION = 5

const C = {
  share: 0.9,
  settleSeconds: 30,
  settleSlack: 1 / 30,
  restHeadDeg: 1.5,
  restTorsoDeg: 1.5,
  pelvisDrop: 0.006,
  returnFrom: 6,
  returnTo: 10,
  band: [0.01, 0.99],
  wakeSeconds: 10,
  gazeShiftDeg: 10,
  gazeRamp: 1.5,
  restReason: 'rest-fallback',
  dozeReason: 'doze-fallback',
} as const
const DOZE_HEAD_STOPPED = 'no clean rule: the review\'s nod-off shape rule misses a 4f doze whose first sink lies under the entry ramp (rules.md revision 3, doze head); not judged until the lead decides'
const ARMS = ['smooth.armL.spikeRate', 'smooth.armR.spikeRate'] as const

export function restConstants(bands: MotionBandsFile): readonly ReportConstant[] {
  return [
    { name: 'rest onset', value: IDLE_TO_SIT_MS / 1000, unit: 's after the trace start', source: 'director IDLE_TO_SIT_MS' },
    { name: 'drive', value: QA_DRIVE_AWAY.name, unit: 'the QA drive, the user away at the scenario\'s away cue', source: 'C004; unit M2 rules section 1' },
    { name: 'state share', value: C.share, unit: 'of the idle span after the rest onset (rest) and of [sleep onset, wake) (doze)', source: 'plan R3a; owner decision "Rest measure: From sleep onset"' },
    { name: 'settle bound', value: `${C.settleSeconds} + ${C.settleSlack.toFixed(4)}`, unit: 's from the away cue to the scheduler\'s sleep onset, at most', source: 'sleepDelay.max (idle-activities.ts); two 60 Hz frames for the 120 Hz grid and the per-frame report' },
    { name: 'baseline', value: IDLE_TO_SIT_MS / 1000, unit: 's: every frame before the rest onset, warm-up included', source: 'rules.md revision 2, B2 scoring' },
    { name: 'rest head pitch', value: C.restHeadDeg, unit: 'deg nose-down above the baseline mean, rest mean, at least', source: 'half of architecture 4f rest head pitch +3' },
    { name: 'rest torso-lower pitch', value: C.restTorsoDeg, unit: 'deg nose-down above the baseline mean, rest mean, at least', source: 'half of architecture 4f rest torso lower +3' },
    { name: 'doze pelvis drop', value: C.pelvisDrop, unit: 'L below the baseline mean, doze mean, at least', source: 'half of architecture 4f doze pelvis drop 0.012 L' },
    { name: 'return window', value: `${C.returnFrom}..${C.returnTo}`, unit: 's after the listening cue', source: '4f rest ramp 1.5 s + the wake shoulder-roll act at most 4.5 s (4e act 2); plan R3b 10 s' },
    { name: 'return band', value: `P${C.band[0] * 100}..P${C.band[1] * 100}`, unit: 'of the baseline frames, per signal', source: 'idle noise of the standing baseline' },
    { name: 'wake span', value: C.wakeSeconds, unit: 's after the listening cue', source: 'plan R3b' },
    ...Object.entries(POP_CONSTANTS).map(([name, c]) => ({ name: `pop ${name}`, ...c })),
    ...ARMS.map(id => ({ name: id, value: fixed(bands.classes.idle?.metrics[id]?.hi ?? null, 2), unit: 'per minute, at most, over the wake span', source: 'bands-v3 idle hi (plan R3b)' })),
    { name: 'doze gaze shift', value: C.gazeShiftDeg, unit: 'deg: a gaze-shift marker or a head-from-chest yaw change this large inside the doze fails', source: 'the gaze-shift bar, gaze-order.ts CRITERION_DEG; lead decision "no gaze shift while dozing" (4f)' },
    { name: 'doze gaze start', value: C.gazeRamp, unit: 's after the sleep onset (the 4f entry ramp) from which the head yaw range is taken', source: 'rules.md revision 4, Y4, anchored at the onset (unit M2 rules section 4)' },
    { name: 'reasons', value: `${C.restReason}, ${C.dozeReason}`, unit: 'stance reasons', source: 'plan unit A (M/stance.ts)' },
  ]
}

/** The trace cut to end at `to` and scored from `from`, so a gate metric can be taken over that span alone. */
function span(input: DecodedMotionTrace, from: number, to: number): DecodedMotionTrace {
  const stride = MOTION_TRACE_CHANNELS.length
  const bones = input.trace.rig.bones.length
  let frames = 0
  while (frames < input.trace.frames && input.channels[frames * stride] <= to + 1e-9)
    frames++
  return {
    trace: { ...input.trace, frames, scoredFrom: from },
    rot: input.rot.subarray(0, frames * bones * 4),
    root: input.root.subarray(0, frames * 4),
    channels: input.channels.subarray(0, frames * stride),
  }
}

export interface RestDetail {
  readonly cues: { readonly idle: number, readonly away: number, readonly wake: number, readonly onset: number, readonly sleep: number | null }
  readonly restShare: number
  readonly dozeShare: number | null
  readonly breaks: readonly string[]
  readonly posture: { readonly head: number, readonly torso: number } | null
  readonly pelvisDrop: number | null
  readonly dozeHeadP90: number | null
  readonly dozeGaze: { readonly markers: number, readonly yawRange: number } | null
  readonly returned: readonly { readonly signal: string, readonly value: number, readonly lo: number, readonly hi: number }[]
  readonly stateAtWake: BodyRest
  readonly pops: readonly { readonly t: number, readonly bone: string, readonly size: number }[]
  readonly spikeRates: readonly { readonly id: string, readonly status: string, readonly value: number | null }[]
  readonly markers: readonly string[]
}

/**
 * C004 (plan R3; unit M2 rules section 4, amendment 4 A4.5): the run names the sleepy QA drive; the scheduler's sleep onset comes within
 * the designed delay after the away cue; the body rests before the away cue and dozes from the onset without a break;
 * the bones show the 4f rest posture and doze pelvis drop; she returns to standing after the wake without a snap; and the
 * stance reasons name the fallback. The doze head clause has no clean rule yet and is not judged, so no run passes until
 * it has one.
 */
export function restReport(run: LoadedRun, bands: MotionBandsFile): CaseReport<RestDetail> {
  const { p, input } = run
  const { trace } = input
  if (trace.source.scenario.class !== 'idle')
    throw new ReportUsageError(`${run.dir}: rest judges an idle-class run, not ${trace.source.scenario.class}`)
  const idleBands = bands.classes.idle
  if (!idleBands)
    throw new ReportUsageError('the bands file has no idle class')
  const modes = trace.events.flatMap(e => e.kind === 'mode' ? [e] : [])
  const idle = modes.find(e => e.mode === 'idle')?.t
  const away = idle === undefined ? undefined : modes.find(e => e.mode === 'away' && e.t > idle)?.t
  const wake = away === undefined ? undefined : modes.find(e => e.mode === 'listening' && e.t > away)?.t
  if (idle === undefined || away === undefined || wake === undefined)
    throw new ReportUsageError(`${run.dir}: rest needs the mode cues idle, away and listening in that order (the sleepy-no-clip scenario)`)
  const onset = input.channels[0] + IDLE_TO_SIT_MS / 1000
  if (onset >= away)
    throw new ReportUsageError(`${run.dir}: the rest onset ${onset.toFixed(2)} s is not before the away cue ${away.toFixed(2)} s; run with the scenario's warm-up`)
  const stance = markers(run, 'stance:')
  if (!stance.length)
    throw new ReportUsageError(`${run.dir}: no stance markers; the scenario does not record them`)
  if (p.times[p.times.length - 1] < wake + C.wakeSeconds)
    throw new ReportUsageError(`${run.dir}: the trace ends before the wake span (${(wake + C.wakeSeconds).toFixed(2)} s)`)
  if (!p.times.some(t => t < onset))
    throw new ReportUsageError(`${run.dir}: no scored frame before the rest onset to set the baseline`)

  const restAt = restStates(run)
  const sleeps = idleSpans(run).filter(span => span.kind === 'sleep')
  const asleep = sleeps.find(span => span.start >= away)
  const sleep = asleep?.start ?? null
  const reasonAt = (t: number) => stance.filter(m => m.t <= t).at(-1)?.parts.join(':') ?? null
  const frames = (from: number, to: number) => p.times.flatMap((t, i) => t >= from && t < to ? [i] : [])
  const idleFrames = frames(onset, away)
  const dozeSpan = sleep === null ? [] : frames(sleep, wake)
  const share = (list: readonly number[], state: BodyRest) => list.length ? list.filter(i => restAt(p.times[i]) === state).length / list.length : 0
  const restShare = share(idleFrames, 'rest')
  const dozeShare = sleep === null ? null : share(dozeSpan, 'doze')
  // A break: the scheduler ends that sleep or starts another before the wake cue, or the body leaves doze after entering it.
  // The body clause is vacuous when the body never dozed, so without a scheduler break the line is then not exercised.
  const breaks: string[] = []
  let schedulerBroke = false
  let bodyDozed = false
  if (asleep && sleep !== null) {
    if (asleep.end !== null && asleep.end < wake)
      breaks.push(`the scheduler's sleep ended at ${asleep.end.toFixed(3)} s`)
    breaks.push(...sleeps.filter(span => span.start > sleep && span.start < wake).map(span => `the scheduler started another sleep at ${span.start.toFixed(3)} s`))
    schedulerBroke = breaks.length > 0
    const dozed = dozeSpan.findIndex(i => restAt(p.times[i]) === 'doze')
    bodyDozed = dozed >= 0
    const left = dozed < 0 ? undefined : dozeSpan.slice(dozed).find(i => restAt(p.times[i]) !== 'doze')
    if (left !== undefined)
      breaks.push(`the body left doze at ${p.times[left].toFixed(3)} s`)
  }

  // Posture on every raw frame, warm-up included: nose-down pitch of the head and the lowest torso link, hips height in L.
  const pose = new TracePose(input)
  const head = pose.index('head')
  const spine = pose.index('spine')
  if (head < 0 || spine < 0)
    throw new ReportUsageError(`${run.dir}: rest needs the head and spine bones`)
  const pitch = (frame: number, bone: number) => -Math.asin(Math.max(-1, Math.min(1, rotate(pose.world(frame, bone), [0, 0, 1])[1]))) * DEG
  const signals = {
    head: (frame: number) => pitch(frame, head),
    torso: (frame: number) => pitch(frame, spine),
    hips: (frame: number) => pose.hips(frame)[1] / trace.rig.legLength,
  }
  const raw = (from: number, to: number, state?: BodyRest) => Array.from({ length: pose.frames }, (_, f) => f).filter((f) => {
    const t = pose.time(f)
    return t >= from && t < to && (state === undefined || restAt(t) === state)
  })
  const baselineFrames = raw(Number.NEGATIVE_INFINITY, onset)
  const baselines = { head: mean(baselineFrames.map(signals.head)), torso: mean(baselineFrames.map(signals.torso)), hips: mean(baselineFrames.map(signals.hips)) }
  const restFrames = raw(onset, away, 'rest')
  const dozeFrames = sleep === null ? [] : raw(sleep, wake, 'doze')
  const posture = restFrames.length
    ? { head: mean(restFrames.map(signals.head)) - baselines.head, torso: mean(restFrames.map(signals.torso)) - baselines.torso }
    : null
  const pelvisDrop = dozeFrames.length ? baselines.hips - mean(dozeFrames.map(signals.hips)) : null
  const dozeHeadP90 = dozeFrames.length ? percentile(dozeFrames.map(f => signals.head(f) - baselines.head), 0.9) : null
  // The doze owns the head (lead decision on 4f): no gaze shift reported, and no head-from-chest yaw step, while dozing.
  const chest = pose.index('chest') >= 0 ? pose.index('chest') : spine
  const headYaw = (frame: number) => {
    const [x, y, z, w] = multiply(conjugate(pose.world(frame, chest)), pose.world(frame, head))
    return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)) * DEG
  }
  const dozeGaze = dozeFrames.length
    ? {
        markers: markers(run, 'gaze-shift:').filter(m => m.t >= pose.time(dozeFrames[0]) && m.t <= pose.time(dozeFrames[dozeFrames.length - 1]) && Number.parseFloat(m.parts[0]) >= C.gazeShiftDeg).length,
        yawRange: (() => {
          const yaws = dozeFrames.filter(frame => pose.time(frame) >= (sleep ?? away) + C.gazeRamp).map(headYaw)
          return yaws.length ? Math.max(...yaws) - Math.min(...yaws) : 0
        })(),
      }
    : null

  const before = p.times.flatMap((t, i) => t < wake ? [i] : []).at(-1)
  const stateAtWake = before === undefined ? 'none' : restAt(p.times[before])
  const woke = stateAtWake !== 'none'
  const returnFrames = raw(wake + C.returnFrom, wake + C.returnTo)
  const returned = (['head', 'torso', 'hips'] as const).map((signal) => {
    const values = baselineFrames.map(signals[signal])
    return { signal, value: mean(returnFrames.map(signals[signal])), lo: percentile(values, C.band[0]), hi: percentile(values, C.band[1]) }
  })
  const stood = returned.every(r => r.value >= r.lo && r.value <= r.hi)
  // A velocity sample is stamped at the start of its interval, and the cue is applied before its frame is posed, so the
  // move into the first frame after the cue is stamped one interval before it.
  const wakeFrom = wake - 1 / HZ
  const pops = popEvents(p, upperBodyPopBones, wakeFrom, wake + C.wakeSeconds)
  const wakeMetrics = smoothMetrics(prepareTrace(span(input, wakeFrom, wake + C.wakeSeconds)), idleBands)
  const spikeRates = ARMS.map((id) => {
    const metric = wakeMetrics.find(m => m.id === id)
    return { id, status: metric?.status ?? 'missing', value: metric?.value ?? null, hi: idleBands.metrics[id]?.hi ?? null }
  })
  const smoothArms = spikeRates.every(r => r.status !== 'ok' || (r.value !== null && r.hi !== null && r.value <= r.hi))
  const wakeRule = `over [wake, wake + ${C.wakeSeconds} s]: 0 upper-body pops and smooth.armL/armR spike rate <= the idle band hi (a SKIPPED rate is not measured)`
  const returnRule = `over [wake + ${C.returnFrom}, wake + ${C.returnTo}] s the means of head pitch, torso-lower pitch and hips height lie within the baseline's [P${C.band[0] * 100}, P${C.band[1] * 100}]`

  const reasonIn = (list: readonly number[], reason: string) => list.some(i => reasonAt(p.times[i]) === reason)
  const reasonsSeen = [...new Set(stance.map(m => m.parts.join(':')))]
  const restPostureRule = `over the rest frames, mean head pitch >= baseline + ${C.restHeadDeg} deg and mean torso-lower pitch >= baseline + ${C.restTorsoDeg} deg`
  const pelvisRule = `over the doze frames, mean hips height >= ${C.pelvisDrop} L below the baseline mean`
  const gazeRule = `over the doze frames from the sleep onset, no gaze-shift marker of ${C.gazeShiftDeg} deg or more and a head-from-chest yaw range under ${C.gazeShiftDeg} deg from ${C.gazeRamp} s after the onset`
  const onsetRule = `the scheduler's first sleep start at or after the away cue comes no later than ${C.settleSeconds} s (+ ${C.settleSlack.toFixed(4)} s) after it`
  const dozeShareRule = `the body's rest state is doze on >= ${C.share * 100} % of [sleep onset, wake)`
  const unbrokenRule = 'over [sleep onset, wake): the scheduler neither ends that sleep nor starts another before the wake cue, and the body\'s rest state, once doze, does not leave doze'
  const reasonsRule = `stance reason ${C.restReason} in [onset, away) and ${C.dozeReason} in [sleep onset, wake)`
  const noSleep = 'no sleep onset after the away cue'
  const requirements: CaseRequirement[] = [
    driveRequirement(run, QA_DRIVE_AWAY),
    judged('rest-share', `rest on >= ${C.share * 100} % of [onset, away) (the director's report)`, `rest ${(restShare * 100).toFixed(1)} %`, restShare >= C.share),
    judged('sleep-onset', onsetRule, sleep === null ? noSleep : `${(sleep - away).toFixed(3)} s after the away cue`, sleep !== null && sleep - away <= C.settleSeconds + C.settleSlack),
    dozeShare === null
      ? notExercised('doze-share', dozeShareRule, noSleep)
      : judged('doze-share', dozeShareRule, `doze ${(dozeShare * 100).toFixed(1)} %`, dozeShare >= C.share),
    sleep === null
      ? notExercised('doze-unbroken', unbrokenRule, noSleep)
      : !schedulerBroke && !bodyDozed
          ? notExercised('doze-unbroken', unbrokenRule, 'the body never dozed; the scheduler clause alone held')
          : judged('doze-unbroken', unbrokenRule, breaks.join('; ') || 'no break', breaks.length === 0),
    posture === null
      ? notExercised('rest-posture', restPostureRule, 'no rest frame')
      : judged('rest-posture', restPostureRule, `head ${posture.head.toFixed(2)} deg, torso lower ${posture.torso.toFixed(2)} deg above the baseline`, posture.head >= C.restHeadDeg && posture.torso >= C.restTorsoDeg),
    pelvisDrop === null
      ? notExercised('doze-pelvis', pelvisRule, 'no doze frame')
      : judged('doze-pelvis', pelvisRule, `${pelvisDrop.toFixed(4)} L below the baseline`, pelvisDrop >= C.pelvisDrop),
    notExercised('doze-head', 'the doze head-pitch peak (architecture 4f: the head sinks to +18 deg)', `${DOZE_HEAD_STOPPED}; measured P90 ${dozeHeadP90 === null ? 'no doze frame' : `${dozeHeadP90.toFixed(2)} deg above the baseline`}`),
    dozeGaze === null
      ? notExercised('doze-no-gaze-shift', gazeRule, 'no doze frame')
      : judged('doze-no-gaze-shift', gazeRule, `${dozeGaze.markers} gaze-shift markers of ${C.gazeShiftDeg} deg or more; head yaw range ${dozeGaze.yawRange.toFixed(2)} deg`, dozeGaze.markers === 0 && dozeGaze.yawRange < C.gazeShiftDeg),
    !woke
      ? notExercised('returned', returnRule, 'rest state none at the listening cue: no return to standing')
      : judged('returned', returnRule, returned.map(r => `${r.signal} ${r.value.toFixed(r.signal === 'hips' ? 4 : 2)} in [${r.lo.toFixed(r.signal === 'hips' ? 4 : 2)}, ${r.hi.toFixed(r.signal === 'hips' ? 4 : 2)}]`).join(', '), stood),
    !woke || !stood
      ? notExercised('wake-smooth', wakeRule, !woke ? 'rest state none at the listening cue: no return to standing' : 'she did not return to standing')
      : judged('wake-smooth', wakeRule, `${pops.length} pops; ${spikeRates.map(r => `${r.id} ${r.status === 'ok' ? fixed(r.value, 2) : `not measured (${r.status})`}`).join(', ')}`, pops.length === 0 && smoothArms),
    sleep === null
      ? notExercised('reasons', reasonsRule, noSleep)
      : judged('reasons', reasonsRule, `reasons seen: ${reasonsSeen.join(', ')}`, reasonIn(idleFrames, C.restReason) && reasonIn(dozeSpan, C.dozeReason)),
  ]
  return caseReport('rest', REST_VERSION, [run.dir], restConstants(bands), requirements, {
    cues: { idle, away, wake, onset, sleep },
    restShare,
    dozeShare,
    breaks,
    posture,
    pelvisDrop,
    dozeHeadP90,
    dozeGaze,
    returned,
    stateAtWake,
    pops: pops.map(pop => ({ t: pop.t, bone: pop.bone, size: pop.size })),
    spikeRates: spikeRates.map(({ id, status, value }) => ({ id, status, value })),
    markers: trace.events.flatMap(e => e.kind === 'marker' && (e.label.startsWith('stance:') || e.label.startsWith('rest:') || e.label.startsWith('idle:')) ? [`${e.t.toFixed(3)} ${e.label}`] : []),
  })
}

export function formatRest(report: CaseReport<RestDetail>): string {
  const d = report.detail
  return formatCaseReport(report, [
    `cues (trace s): idle ${d.cues.idle.toFixed(3)}, rest onset ${d.cues.onset.toFixed(3)}, away ${d.cues.away.toFixed(3)}, sleep onset ${fixed(d.cues.sleep)}, listening ${d.cues.wake.toFixed(3)}`,
    `doze breaks: ${d.breaks.join('; ') || 'none'}`,
    `rest posture above the baseline (deg): ${d.posture ? `head ${d.posture.head.toFixed(2)}, torso lower ${d.posture.torso.toFixed(2)}` : 'no rest frame'}; doze pelvis drop ${fixed(d.pelvisDrop, 4)} L; doze head P90 ${fixed(d.dozeHeadP90, 2)} deg (printed, not judged)`,
    `after the cue (wake + ${C.returnFrom}..${C.returnTo} s): ${d.returned.map(x => `${x.signal} ${x.value.toFixed(4)} in [${x.lo.toFixed(4)}, ${x.hi.toFixed(4)}]`).join(', ')}`,
    `rest state at the listening cue: ${d.stateAtWake}`,
    `wake pops: ${d.pops.map(pop => `${pop.t.toFixed(3)} ${pop.bone} ${pop.size.toFixed(1)} deg/s`).join(', ') || 'none'}`,
    'stance, rest and idle markers:',
    ...d.markers.map(line => `  ${line}`),
  ])
}
