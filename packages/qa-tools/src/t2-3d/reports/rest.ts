import type { BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { MotionBandsFile } from '../gate/types'
import type { DecodedMotionTrace } from '../read-trace'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { IDLE_TO_SIT_MS } from '@proj-airi/motion-driver-humanoid/director'
import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { prepareTrace, smoothMetrics } from '../metrics'
import { DEG, HZ, mean, rotate } from '../metrics/math'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { restStates } from './idle-acts'
import { POP_CONSTANTS } from './kinematics'
import { popEvents, upperBodyPopBones } from './pops'
import { fixed, markers, ReportUsageError } from './report'

export const REST_VERSION = 1

const C = { share: 0.9, headPitchDeg: 5, wakeSeconds: 10, restReason: 'rest-fallback', dozeReason: 'doze-fallback' } as const
const ARMS = ['smooth.armL.spikeRate', 'smooth.armR.spikeRate'] as const

export function restConstants(bands: MotionBandsFile): readonly ReportConstant[] {
  return [
    { name: 'rest onset', value: IDLE_TO_SIT_MS / 1000, unit: 's after the trace start', source: 'director IDLE_TO_SIT_MS' },
    { name: 'state share', value: C.share, unit: 'of the idle span after the onset (rest) and of the away span (doze)', source: 'plan R3a' },
    { name: 'doze head pitch', value: C.headPitchDeg, unit: 'deg nose-down above the pre-rest mean, at least', source: 'plan R3a' },
    { name: 'doze pelvis', value: 'lower', unit: 'mean root height below the pre-rest mean (no magnitude)', source: 'plan R3a' },
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
  readonly headPitch: { readonly baseline: number, readonly doze: number | null }
  readonly pelvis: { readonly baseline: number, readonly doze: number | null }
  readonly stateAtWake: BodyRest
  readonly pops: readonly { readonly t: number, readonly bone: string, readonly size: number }[]
  readonly spikeRates: readonly { readonly id: string, readonly status: string, readonly value: number | null }[]
  readonly markers: readonly string[]
}

/** C004 (plan R3): the clip-free fallback is active, waking has no snap, and the stance reasons name the fallback. */
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
  const baseline = p.times.flatMap((t, i) => t < onset ? [i] : [])
  if (!baseline.length)
    throw new ReportUsageError(`${run.dir}: no scored frame before the rest onset to set the baseline`)

  const restAt = restStates(run)
  const reasonAt = (t: number) => stance.filter(m => m.t <= t).at(-1)?.parts.join(':') ?? null
  const frames = (from: number, to: number) => p.times.flatMap((t, i) => t >= from && t < to ? [i] : [])
  const idleFrames = frames(onset, away)
  const awayFrames = frames(away, wake)
  const share = (list: readonly number[], state: BodyRest) => list.length ? list.filter(i => restAt(p.times[i]) === state).length / list.length : 0
  const restShare = share(idleFrames, 'rest')
  const dozeShare = share(awayFrames, 'doze')
  const head = p.orientations.head
  if (!head)
    throw new ReportUsageError(`${run.dir}: rest needs the head bone`)
  const pitch = (i: number) => -Math.asin(Math.max(-1, Math.min(1, rotate(head[i], [0, 0, 1])[1]))) * DEG
  const dozing = awayFrames.filter(i => restAt(p.times[i]) === 'doze')
  const headPitch = { baseline: mean(baseline.map(pitch)), doze: dozing.length ? mean(dozing.map(pitch)) : null }
  const pelvis = { baseline: mean(baseline.map(i => p.rootPosition[i][1])), doze: dozing.length ? mean(dozing.map(i => p.rootPosition[i][1])) : null }
  const posture = headPitch.doze !== null && pelvis.doze !== null && headPitch.doze - headPitch.baseline >= C.headPitchDeg && pelvis.doze < pelvis.baseline
  const fallbackRule = `rest on >= ${C.share * 100} % of [onset, away), doze on >= ${C.share * 100} % of [away, wake), doze head pitch >= baseline + ${C.headPitchDeg} deg and doze pelvis below baseline`

  const before = p.times.flatMap((t, i) => t < wake ? [i] : []).at(-1)
  const stateAtWake = before === undefined ? 'none' : restAt(p.times[before])
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

  const reasonIn = (list: readonly number[], reason: string) => list.some(i => reasonAt(p.times[i]) === reason)
  const reasonsSeen = [...new Set(stance.map(m => m.parts.join(':')))]
  const requirements: CaseRequirement[] = [
    judged('fallback-active', fallbackRule, `rest ${(restShare * 100).toFixed(1)} %, doze ${(dozeShare * 100).toFixed(1)} %, head pitch ${headPitch.doze === null ? 'no doze frame' : `${(headPitch.doze - headPitch.baseline).toFixed(2)} deg above baseline`}, pelvis ${pelvis.doze === null ? 'no doze frame' : `${((pelvis.doze - pelvis.baseline) / trace.rig.legLength).toFixed(4)} L`}`, restShare >= C.share && dozeShare >= C.share && posture),
    stateAtWake === 'none'
      ? notExercised('wake-smooth', wakeRule, 'rest state none at the listening cue: no return to standing')
      : judged('wake-smooth', wakeRule, `${pops.length} pops; ${spikeRates.map(r => `${r.id} ${r.status === 'ok' ? fixed(r.value, 2) : `not measured (${r.status})`}`).join(', ')}`, pops.length === 0 && smoothArms),
    judged('reasons', `stance reason ${C.restReason} in [onset, away) and ${C.dozeReason} in [away, wake)`, `reasons seen: ${reasonsSeen.join(', ')}`, reasonIn(idleFrames, C.restReason) && reasonIn(awayFrames, C.dozeReason)),
  ]
  return caseReport('rest', REST_VERSION, [run.dir], restConstants(bands), requirements, {
    cues: { idle, away, wake, onset },
    restShare,
    dozeShare,
    headPitch,
    pelvis,
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
    `head pitch (deg, nose down): baseline ${d.headPitch.baseline.toFixed(2)}, doze ${fixed(d.headPitch.doze, 2)}; pelvis height: baseline ${d.pelvis.baseline.toFixed(4)}, doze ${fixed(d.pelvis.doze, 4)}`,
    `rest state at the listening cue: ${d.stateAtWake}`,
    `wake pops: ${d.pops.map(pop => `${pop.t.toFixed(3)} ${pop.bone} ${pop.size.toFixed(1)} deg/s`).join(', ') || 'none'}`,
    'stance and rest markers:',
    ...d.markers.map(line => `  ${line}`),
  ])
}
