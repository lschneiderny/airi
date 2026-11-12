import type { BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { MotionBandsFile } from '../gate/types'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { IDLE_TO_SIT_MS } from '@proj-airi/motion-driver-humanoid/director'
import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { percentile } from '../gate/bands'
import { prepareTrace, smoothMetrics } from '../metrics'
import { DEG, HZ, mean, rotate } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { restStates, TracePose } from './idle-acts'
import { POP_CONSTANTS } from './kinematics'
import { popEvents, upperBodyPopBones } from './pops'
import { fixed, markers, ReportUsageError } from './report'

export const REST_VERSION = 2

const C = {
  share: 0.9,
  restHeadDeg: 1.5,
  restTorsoDeg: 1.5,
  pelvisDrop: 0.006,
  returnFrom: 6,
  returnTo: 10,
  band: [0.01, 0.99],
  wakeSeconds: 10,
  restReason: 'rest-fallback',
  dozeReason: 'doze-fallback',
} as const
const DOZE_HEAD_STOPPED = 'no clean rule: idle gaze meets every scored head-pitch peak bar (rules.md revision 2, B2 doze-head); not judged until the lead decides'
const ARMS = ['smooth.armL.spikeRate', 'smooth.armR.spikeRate'] as const

export function restConstants(bands: MotionBandsFile): readonly ReportConstant[] {
  return [
    { name: 'rest onset', value: IDLE_TO_SIT_MS / 1000, unit: 's after the trace start', source: 'director IDLE_TO_SIT_MS' },
    { name: 'state share', value: C.share, unit: 'of the idle span after the onset (rest) and of the away span (doze)', source: 'plan R3a' },
    { name: 'baseline', value: IDLE_TO_SIT_MS / 1000, unit: 's: every frame before the rest onset, warm-up included', source: 'rules.md revision 2, B2 scoring' },
    { name: 'rest head pitch', value: C.restHeadDeg, unit: 'deg nose-down above the baseline mean, rest mean, at least', source: 'half of architecture 4f rest head pitch +3' },
    { name: 'rest torso-lower pitch', value: C.restTorsoDeg, unit: 'deg nose-down above the baseline mean, rest mean, at least', source: 'half of architecture 4f rest torso lower +3' },
    { name: 'doze pelvis drop', value: C.pelvisDrop, unit: 'L below the baseline mean, doze mean, at least', source: 'half of architecture 4f doze pelvis drop 0.012 L' },
    { name: 'return window', value: `${C.returnFrom}..${C.returnTo}`, unit: 's after the listening cue', source: '4f rest ramp 1.5 s + the wake shoulder-roll act at most 4.5 s (4e act 2); plan R3b 10 s' },
    { name: 'return band', value: `P${C.band[0] * 100}..P${C.band[1] * 100}`, unit: 'of the baseline frames, per signal', source: 'idle noise of the standing baseline' },
    { name: 'wake span', value: C.wakeSeconds, unit: 's after the listening cue', source: 'plan R3b' },
    ...Object.entries(POP_CONSTANTS).map(([name, c]) => ({ name: `pop ${name}`, ...c })),
    ...ARMS.map(id => ({ name: id, value: fixed(bands.classes.idle?.metrics[id]?.hi ?? null, 2), unit: 'per minute, at most, over the wake span', source: 'bands-v3 idle hi (plan R3b)' })),
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
  readonly cues: { readonly idle: number, readonly away: number, readonly wake: number, readonly onset: number }
  readonly restShare: number
  readonly dozeShare: number
  readonly posture: { readonly head: number, readonly torso: number } | null
  readonly pelvisDrop: number | null
  readonly dozeHeadP90: number | null
  readonly returned: readonly { readonly signal: string, readonly value: number, readonly lo: number, readonly hi: number }[]
  readonly stateAtWake: BodyRest
  readonly pops: readonly { readonly t: number, readonly bone: string, readonly size: number }[]
  readonly spikeRates: readonly { readonly id: string, readonly status: string, readonly value: number | null }[]
  readonly markers: readonly string[]
}

/**
 * C004 (plan R3, revision 2): the director reports the fallback, the bones show the 4f rest posture and doze pelvis drop,
 * she returns to standing after the wake without a snap, and the stance reasons name the fallback. The doze head clause
 * has no clean rule yet and is not judged, so no run passes until it has one.
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
  const reasonAt = (t: number) => stance.filter(m => m.t <= t).at(-1)?.parts.join(':') ?? null
  const frames = (from: number, to: number) => p.times.flatMap((t, i) => t >= from && t < to ? [i] : [])
  const idleFrames = frames(onset, away)
  const awayFrames = frames(away, wake)
  const share = (list: readonly number[], state: BodyRest) => list.length ? list.filter(i => restAt(p.times[i]) === state).length / list.length : 0
  const restShare = share(idleFrames, 'rest')
  const dozeShare = share(awayFrames, 'doze')

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
  const baseline = (signal: keyof typeof signals) => baselines[signal]
  const restFrames = raw(onset, away, 'rest')
  const dozeFrames = raw(away, wake, 'doze')
  const posture = restFrames.length
    ? { head: mean(restFrames.map(signals.head)) - baseline('head'), torso: mean(restFrames.map(signals.torso)) - baseline('torso') }
    : null
  const pelvisDrop = dozeFrames.length ? baseline('hips') - mean(dozeFrames.map(signals.hips)) : null
  const dozeHeadP90 = dozeFrames.length ? percentile(dozeFrames.map(f => signals.head(f) - baseline('head')), 0.9) : null

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
  const requirements: CaseRequirement[] = [
    judged('fallback-active', `rest on >= ${C.share * 100} % of [onset, away) and doze on >= ${C.share * 100} % of [away, wake) (the director's report)`, `rest ${(restShare * 100).toFixed(1)} %, doze ${(dozeShare * 100).toFixed(1)} %`, restShare >= C.share && dozeShare >= C.share),
    posture === null
      ? notExercised('rest-posture', restPostureRule, 'no rest frame')
      : judged('rest-posture', restPostureRule, `head ${posture.head.toFixed(2)} deg, torso lower ${posture.torso.toFixed(2)} deg above the baseline`, posture.head >= C.restHeadDeg && posture.torso >= C.restTorsoDeg),
    pelvisDrop === null
      ? notExercised('doze-pelvis', pelvisRule, 'no doze frame')
      : judged('doze-pelvis', pelvisRule, `${pelvisDrop.toFixed(4)} L below the baseline`, pelvisDrop >= C.pelvisDrop),
    notExercised('doze-head', 'the doze head-pitch peak (architecture 4f: the head sinks to +18 deg)', `${DOZE_HEAD_STOPPED}; measured P90 ${dozeHeadP90 === null ? 'no doze frame' : `${dozeHeadP90.toFixed(2)} deg above the baseline`}`),
    !woke
      ? notExercised('returned', returnRule, 'rest state none at the listening cue: no return to standing')
      : judged('returned', returnRule, returned.map(r => `${r.signal} ${r.value.toFixed(r.signal === 'hips' ? 4 : 2)} in [${r.lo.toFixed(r.signal === 'hips' ? 4 : 2)}, ${r.hi.toFixed(r.signal === 'hips' ? 4 : 2)}]`).join(', '), stood),
    !woke || !stood
      ? notExercised('wake-smooth', wakeRule, !woke ? 'rest state none at the listening cue: no return to standing' : 'she did not return to standing')
      : judged('wake-smooth', wakeRule, `${pops.length} pops; ${spikeRates.map(r => `${r.id} ${r.status === 'ok' ? fixed(r.value, 2) : `not measured (${r.status})`}`).join(', ')}`, pops.length === 0 && smoothArms),
    judged('reasons', `stance reason ${C.restReason} in [onset, away) and ${C.dozeReason} in [away, wake)`, `reasons seen: ${reasonsSeen.join(', ')}`, reasonIn(idleFrames, C.restReason) && reasonIn(awayFrames, C.dozeReason)),
  ]
  return caseReport('rest', REST_VERSION, [run.dir], restConstants(bands), requirements, {
    cues: { idle, away, wake, onset },
    restShare,
    dozeShare,
    posture,
    pelvisDrop,
    dozeHeadP90,
    returned,
    stateAtWake,
    pops: pops.map(pop => ({ t: pop.t, bone: pop.bone, size: pop.size })),
    spikeRates: spikeRates.map(({ id, status, value }) => ({ id, status, value })),
    markers: trace.events.flatMap(e => e.kind === 'marker' && (e.label.startsWith('stance:') || e.label.startsWith('rest:')) ? [`${e.t.toFixed(3)} ${e.label}`] : []),
  })
}

export function formatRest(report: CaseReport<RestDetail>): string {
  const d = report.detail
  return formatCaseReport(report, [
    `cues (trace s): idle ${d.cues.idle.toFixed(3)}, rest onset ${d.cues.onset.toFixed(3)}, away ${d.cues.away.toFixed(3)}, listening ${d.cues.wake.toFixed(3)}`,
    `rest posture above the baseline (deg): ${d.posture ? `head ${d.posture.head.toFixed(2)}, torso lower ${d.posture.torso.toFixed(2)}` : 'no rest frame'}; doze pelvis drop ${fixed(d.pelvisDrop, 4)} L; doze head P90 ${fixed(d.dozeHeadP90, 2)} deg (printed, not judged)`,
    `after the cue (wake + ${C.returnFrom}..${C.returnTo} s): ${d.returned.map(x => `${x.signal} ${x.value.toFixed(4)} in [${x.lo.toFixed(4)}, ${x.hi.toFixed(4)}]`).join(', ')}`,
    `rest state at the listening cue: ${d.stateAtWake}`,
    `wake pops: ${d.pops.map(pop => `${pop.t.toFixed(3)} ${pop.bone} ${pop.size.toFixed(1)} deg/s`).join(', ') || 'none'}`,
    'stance and rest markers:',
    ...d.markers.map(line => `  ${line}`),
  ])
}
