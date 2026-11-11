import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { createRandomStream } from '@proj-airi/motion-driver-natural/random'

import { percentile } from '../gate/bands'
import { emphasisTimes } from '../metrics/gesture'
import { conjugate, DEG, heading, median, multiply, normalize, rotationVector } from '../metrics/math'
import { apexTimes } from './kinematics'
import { criterionReport, fixed, formatReport, requireGate, requirement } from './report'

export const TURN_VERSION = 1

/** Plan 2.4: trunk, neck, head and shoulder bones only, so speech gestures cannot satisfy the posture rule. */
export const TURN_POSTURE_BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder']

const C = { baseline: [-1, 0] as const, hold: [2, 4] as const, placebos: 20, percentile: 0.95, medianScale: 2 }

export const TURN_CONSTANTS: readonly ReportConstant[] = [
  { name: 'baseline window', value: C.baseline.join('..'), unit: 's around the cue', source: 'gate emotionBaselineSeconds' },
  { name: 'hold window', value: C.hold.join('..'), unit: 's after the cue', source: 'gate emotionHoldSeconds' },
  { name: 'pseudo-placebo times', value: C.placebos, unit: 'seeded times before the cue', source: 'plan 2.4' },
  { name: 'placebo percentile', value: C.percentile, unit: '', source: 'plan 2.4' },
  { name: 'median scale', value: C.medianScale, unit: 'x pseudo-placebo median', source: 'plan 2.4' },
]

/** |S3| over TURN_POSTURE_BONES between the baseline and hold windows around `t`, degrees; null outside the trace. */
function postureChange(run: LoadedRun, t: number): number | null {
  const { p } = run
  const pick = (from: number, to: number) => p.times.flatMap((time, i) => time >= t + from && time <= t + to ? [i] : [])
  const base = pick(...C.baseline)
  const held = pick(...C.hold)
  if (!base.length || !held.length || t + C.baseline[0] < p.times[0] || t + C.hold[1] > p.times[p.times.length - 1])
    return null
  const frame = Math.min(p.yaw.length - 1, Math.round((t - p.times[0]) * 60))
  let squared = 0
  for (const bone of TURN_POSTURE_BONES) {
    const q = p.orientations[bone]
    if (!q)
      continue
    const average = (indices: number[]) => {
      const sum = [0, 0, 0, 0]
      for (const i of indices) {
        const sign = q[indices[0]].reduce((s, x, k) => s + x * q[i][k], 0) < 0 ? -1 : 1
        for (let k = 0; k < 4; k++)
          sum[k] += sign * q[i][k]
      }
      return normalize([sum[0], sum[1], sum[2], sum[3]])
    }
    const r = heading(rotationVector(multiply(average(held), conjugate(average(base)))), p.yaw[frame])
    squared += r[0] ** 2 + r[1] ** 2 + r[2] ** 2
  }
  return Math.sqrt(squared) * DEG
}

export interface TurnDetail {
  readonly speakingSeconds: number
  readonly apexesInSpeech: readonly number[]
  readonly voicePeaks: readonly number[]
  readonly cue: { readonly t: number, readonly emotion: string, readonly phase: string } | null
  readonly changeDeg: number | null
  readonly placeboDeg: readonly number[]
  readonly gateVerdict: string
}

/** C003 rendered-turn report (plan 2.4) for a talk-class capture. */
export function turnReport(run: LoadedRun, seed = 1): CriterionReport<TurnDetail> {
  const gate = requireGate(run)
  const { p, input } = run
  const stride = MOTION_TRACE_CHANNELS.length
  const speakingColumn = MOTION_TRACE_CHANNELS.indexOf('speaking')
  const speaking = (t: number) => {
    const frame = Math.max(0, Math.min(input.trace.frames - 1, Math.round((t - input.channels[0]) * input.trace.hz)))
    return input.channels[frame * stride + speakingColumn] === 1
  }
  const apexes = apexTimes(p).filter(a => speaking(a.t)).map(a => a.t)
  const cueEvent = input.trace.events.find(e => e.kind === 'emotion' && e.phase === 'hold-start') ?? input.trace.events.find(e => e.kind === 'emotion' && e.phase === 'pulse')
  const cue = cueEvent?.kind === 'emotion' ? { t: cueEvent.t, emotion: cueEvent.emotion, phase: cueEvent.phase } : null
  const change = cue ? postureChange(run, cue.t) : null
  const random = createRandomStream(seed)
  const earliest = p.times[0] - C.baseline[0]
  const latest = cue ? cue.t - C.hold[1] : earliest
  const placebo = latest > earliest ? Array.from({ length: C.placebos }, () => postureChange(run, earliest + random() * (latest - earliest))).flatMap(v => v === null ? [] : [v]) : []
  const p95 = placebo.length ? percentile(placebo, C.percentile) : null
  const med = placebo.length ? median(placebo) : null
  const speakingSeconds = p.times.filter(speaking).length / 60
  const requirements = [
    requirement('stroke-in-speech', 'at least one kinematic stroke apex inside a speaking span', `${apexes.length} apexes in ${fixed(speakingSeconds, 1)} s of speech`, apexes.length > 0),
    requirement('posture-after-cue', `trunk, neck, head and shoulder |S3| after the ACT cue > p95 and > ${C.medianScale} x median of ${C.placebos} pseudo-placebo times`, cue ? `${fixed(change, 2)} deg against p95 ${fixed(p95, 2)}, median ${fixed(med, 2)} (${placebo.length} placebos)` : 'no emotion cue in the trace', change !== null && p95 !== null && med !== null && change > p95 && change > C.medianScale * med),
    requirement('gate', 'gate.json verdict PASS (subject to D1)', gate.verdict, gate.verdict === 'PASS'),
  ]
  return criterionReport('turn', TURN_VERSION, [run.dir], TURN_CONSTANTS, requirements, {
    speakingSeconds,
    apexesInSpeech: apexes,
    voicePeaks: emphasisTimes(p),
    cue,
    changeDeg: change,
    placeboDeg: placebo,
    gateVerdict: gate.verdict,
  })
}

export function formatTurn(report: CriterionReport<TurnDetail>): string {
  const d = report.detail
  return formatReport(report, [
    `apexes in speech: ${d.apexesInSpeech.map(t => t.toFixed(3)).join(', ') || 'none'}`,
    `gate S2 voice peaks (review only): ${d.voicePeaks.map(t => t.toFixed(3)).join(', ') || 'none'}`,
    `cue: ${d.cue ? `${d.cue.emotion} ${d.cue.phase} at ${d.cue.t.toFixed(3)} s` : 'none'}; pseudo-placebo |S3| deg: ${d.placeboDeg.map(v => v.toFixed(2)).join(', ')}`,
  ])
}
