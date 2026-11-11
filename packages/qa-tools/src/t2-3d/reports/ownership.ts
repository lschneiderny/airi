import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionBandsFile } from '../gate/types'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { ARM_NOISE_DEGREES } from '@proj-airi/motion-driver-humanoid/performance'

import { apexTimes } from './kinematics'
import { armPopBones, popEvents } from './pops'
import { criterionReport, fixed, formatReport, gateStatus, labelledPeaks, markers, printedBand, ReportUsageError, requireGate, requirement, requireSummary } from './report'

export const OWNERSHIP_VERSION = 1

/** Plan 2.5's C004 constants. */
const C = {
  deviationRad: 0.001,
  fullyOwned: 1 - 1e-6,
  yieldOwned: 0.5,
  ownedSeconds: 8,
  ownedPeaks: 3,
  leftApexes: 2,
  hitSeconds: 0.2,
  pokeWindow: [-0.2, 1] as const,
  resumeAfter: 1,
  staleSeconds: 1,
  restCheckAfter: 0.5,
  restNoiseScale: 3,
}

export const OWNERSHIP_CONSTANTS: readonly ReportConstant[] = [
  { name: 'owned deviation', value: C.deviationRad, unit: 'rad', source: 'C004' },
  { name: 'fully owned', value: C.fullyOwned, unit: 'owned.rightArm', source: 'plan 2.5' },
  { name: 'yield threshold', value: C.yieldOwned, unit: 'owned.rightArm', source: 'architecture 3g admission rule' },
  { name: 'owned span', value: C.ownedSeconds, unit: 's', source: 'plan 2.5 non-vacuity' },
  { name: 'owned peaks', value: C.ownedPeaks, unit: 'labelled peaks', source: 'plan 2.5 non-vacuity' },
  { name: 'left-arm apexes', value: C.leftApexes, unit: `within ${C.hitSeconds * 1000} ms of owned peaks`, source: 'plan 2.5; C001 rule' },
  { name: 'poke pop window', value: C.pokeWindow.join('..'), unit: 's around the poke', source: 'C004' },
  { name: 'resume', value: C.resumeAfter, unit: 's after the poke, first labelled peak', source: 'plan 2.5 cancel and resume' },
  { name: 'stale window', value: C.staleSeconds, unit: 's after release', source: 'plan 2.5 stale state' },
  { name: 'rest check', value: C.restCheckAfter, unit: 's after release', source: 'plan 2.5' },
  { name: 'rest band', value: C.restNoiseScale, unit: 'x idle noise per joint (H/arms.ts noise degrees)', source: 'plan 2.5' },
]

const TRUNK: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest']

export interface OwnershipDetail {
  readonly fullyOwnedFrames: number
  readonly ownedSpan: { readonly from: number, readonly to: number } | null
  readonly maxDeviationRad: { readonly rightArm: number, readonly rightFingers: number }
  readonly traceDeviationRad: Readonly<Record<string, number>>
  readonly activationWhileOwned: number
  readonly ownedPeaks: readonly number[]
  readonly leftHits: number
  readonly pokes: readonly number[]
  readonly pokePops: number
  readonly resumePeak: number | null
  readonly release: number | null
  readonly staleApexes: readonly number[]
  readonly restCheck: readonly { readonly joint: number, readonly deg: number, readonly restDeg: number, readonly band: number, readonly inside: boolean }[]
}

/** C004 ownership report (plan 2.5) for a `gesture-under-clip` run. */
export function ownershipReport(run: LoadedRun, bands: MotionBandsFile): CriterionReport<OwnershipDetail> {
  const summary = requireSummary(run)
  const gate = requireGate(run)
  if (!summary.clip)
    throw new ReportUsageError(`${run.dir} has no synthetic clip in summary.json; run the gesture-under-clip scenario`)
  const { p, input } = run
  const scored = input.trace.scoredFrom
  const frameTime = (k: number) => scored + k / 60
  const groups = summary.owned.groups
  const ownedRight = summary.owned.perFrame.map(row => row[groups.indexOf('rightArm')])
  const full = ownedRight.flatMap((v, k) => v >= C.fullyOwned ? [k] : [])
  const writeGroups = summary.ownership.groups
  const maxDeviation = (group: 'rightArm' | 'rightFingers') => Math.max(0, ...full.map(k => summary.ownership.deviationRad[k][writeGroups.indexOf(group)]))
  const bones = input.trace.rig.bones
  const traceDeviation: Record<string, number> = {}
  summary.clip.bones.forEach((name, j) => {
    const b = bones.indexOf(name as MotionTraceBone)
    traceDeviation[name] = Math.max(0, ...full.flatMap((k) => {
      const expected = summary.clip?.expected[k]
      if (!expected || b < 0)
        return []
      const o = ((Math.round(scored * 60) + k) * bones.length + b) * 4
      const q = input.rot.slice(o, o + 4)
      const x = expected.slice(j * 4, j * 4 + 4)
      const dot = Math.abs(q[0] * x[0] + q[1] * x[1] + q[2] * x[2] + q[3] * x[3]) / Math.sqrt((q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2) * (x[0] ** 2 + x[1] ** 2 + x[2] ** 2 + x[3] ** 2))
      return [2 * Math.acos(Math.min(1, dot))]
    }))
  })
  const activation = Math.max(0, ...ownedRight.flatMap((v, k) => v > C.yieldOwned ? [summary.ownership.activation.right[k]] : []))
  // The longest run of consecutive fully owned frames.
  let span: { from: number, to: number } | null = null
  for (let i = 0; i < full.length;) {
    let j = i
    while (j + 1 < full.length && full[j + 1] === full[j] + 1)
      j++
    if (!span || full[j] - full[i] > span.to - span.from)
      span = { from: full[i], to: full[j] }
    i = j + 1
  }
  const peaks = labelledPeaks(run)
  const ownedPeaks = span ? peaks.filter(t => t >= frameTime(span.from) && t <= frameTime(span.to)) : []
  const apexes = apexTimes(p)
  const near = (t: number, side?: 'left' | 'right') => apexes.some(a => (!side || a.side === side) && Math.abs(a.t - t) <= C.hitSeconds + 1e-9)
  const leftHits = ownedPeaks.filter(t => near(t, 'left')).length
  const pokes = input.trace.events.flatMap(e => e.kind === 'touch' && e.touch === 'poke' ? [e.t] : [])
  const pokePops = pokes.reduce((n, t) => n + popEvents(p, [...armPopBones, ...TRUNK], t + C.pokeWindow[0], t + C.pokeWindow[1]).length, 0)
  const spikeBand = printedBand(bands, 'talk', 'smooth.armL.spikeRate')
  const spikes = (['smooth.armL.spikeRate', 'smooth.armR.spikeRate'] as const).map(id => ({ id, value: gateStatus(gate, id).value }))
  const resumePeak = pokes.length ? peaks.find(t => t >= pokes[0] + C.resumeAfter) ?? null : null
  const release = markers(run, 'clip-release')[0]?.t ?? null
  const staleApexes = release === null ? [] : apexes.filter(a => a.side === 'right' && a.t >= release && a.t <= release + C.staleSeconds && !peaks.some(t => Math.abs(a.t - t) <= C.hitSeconds + 1e-9)).map(a => a.t)
  const restFrame = release === null ? -1 : Math.round((release + C.restCheckAfter - scored) * 60)
  const angles = summary.ownership.armDeg.right[restFrame] ?? []
  const rest = summary.ownership.restArmDeg.right
  const restCheck = angles.map((deg, joint) => {
    const band = C.restNoiseScale * ARM_NOISE_DEGREES[joint]
    return { joint, deg, restDeg: rest[joint], band, inside: Math.abs(deg - rest[joint]) <= band }
  })
  const penetration = Math.max(0, ...summary.perFrame.penL, ...summary.perFrame.penR)
  const allPops = popEvents(p, armPopBones).length
  const { corrector } = summary
  const requirements = [
    requirement('owned-arm-untouched', `write deviation of the right arm and fingers <= ${C.deviationRad} rad on fully owned frames`, `rightArm ${fixed(maxDeviation('rightArm'), 6)}, rightFingers ${fixed(maxDeviation('rightFingers'), 6)} over ${full.length} frames`, full.length > 0 && maxDeviation('rightArm') <= C.deviationRad && maxDeviation('rightFingers') <= C.deviationRad),
    requirement('trace-cross-check', `trace right upper arm, lower arm and hand within ${C.deviationRad} rad of the clip's analytic pose on fully owned frames`, Object.entries(traceDeviation).map(([b, v]) => `${b} ${fixed(v, 6)}`).join(', '), full.length > 0 && Object.values(traceDeviation).every(v => v <= C.deviationRad)),
    requirement('performer-yields', `right-arm gesture activation = 0 on every frame with owned.rightArm > ${C.yieldOwned}`, fixed(activation, 6), activation === 0),
    requirement('left-arm-gestures', `fully owned span >= ${C.ownedSeconds} s with >= ${C.ownedPeaks} labelled peaks, >= ${C.leftApexes} of them hit by a left apex`, `${span ? fixed((span.to - span.from + 1) / 60, 2) : 0} s, ${ownedPeaks.length} peaks, ${leftHits} left hits`, !!span && (span.to - span.from + 1) / 60 >= C.ownedSeconds && ownedPeaks.length >= C.ownedPeaks && leftHits >= C.leftApexes),
    requirement('poke-continuous', `no arm or trunk pop in [poke - 0.2, poke + 1] s and smooth.armL/R.spikeRate <= ${fixed(spikeBand.hi, 1)}/min`, `${pokes.length} pokes, ${pokePops} pops; ${spikes.map(s => `${s.id} ${fixed(s.value, 2)}`).join(', ')}`, pokes.length > 0 && pokePops === 0 && spikeBand.hi !== null && spikes.every(s => s.value !== null && s.value <= (spikeBand.hi ?? -1))),
    requirement('resume-after-cancel', `the first labelled peak >= ${C.resumeAfter} s after the poke has an apex within ${C.hitSeconds * 1000} ms`, resumePeak === null ? 'no such peak' : `${resumePeak.toFixed(3)} s ${near(resumePeak) ? 'hit' : 'missed'}`, resumePeak !== null && near(resumePeak)),
    requirement('no-stale-stroke', `no unmatched right apex in [release, release + ${C.staleSeconds}] s`, release === null ? 'no release' : `${staleApexes.length}`, release !== null && staleApexes.length === 0),
    requirement('rest-band', `right arm angles within rest +/- ${C.restNoiseScale} x idle noise at release + ${C.restCheckAfter} s`, `${restCheck.filter(r => r.inside).length}/${restCheck.length} joints`, restCheck.length === 9 && restCheck.every(r => r.inside)),
    requirement('penetration', 'max(perFrame.penL, perFrame.penR) = 0', fixed(penetration, 6), penetration === 0),
    requirement('pops', 'arm pop count over the run = 0', `${allPops}`, allPops === 0),
    requirement('corrector', 'capHits = guardScans = holds = 0', `capHits ${corrector.capHits}, guardScans ${corrector.guardScans}, holds ${corrector.holds}`, corrector.capHits === 0 && corrector.guardScans === 0 && corrector.holds === 0),
  ]
  return criterionReport('ownership', OWNERSHIP_VERSION, [run.dir], OWNERSHIP_CONSTANTS, requirements, {
    fullyOwnedFrames: full.length,
    ownedSpan: span ? { from: frameTime(span.from), to: frameTime(span.to) } : null,
    maxDeviationRad: { rightArm: maxDeviation('rightArm'), rightFingers: maxDeviation('rightFingers') },
    traceDeviationRad: traceDeviation,
    activationWhileOwned: activation,
    ownedPeaks,
    leftHits,
    pokes,
    pokePops,
    resumePeak,
    release,
    staleApexes,
    restCheck,
  })
}

export function formatOwnership(report: CriterionReport<OwnershipDetail>): string {
  const d = report.detail
  return formatReport(report, [
    `fully owned span: ${d.ownedSpan ? `${d.ownedSpan.from.toFixed(3)} .. ${d.ownedSpan.to.toFixed(3)} s` : 'none'} (${d.fullyOwnedFrames} frames); peaks inside: ${d.ownedPeaks.map(t => t.toFixed(3)).join(', ') || 'none'}`,
    `pokes: ${d.pokes.map(t => t.toFixed(3)).join(', ') || 'none'}; release: ${d.release === null ? '-' : d.release.toFixed(3)}; stale right apexes: ${d.staleApexes.map(t => t.toFixed(3)).join(', ') || 'none'}`,
    'right arm at release + 0.5 s: joint, deg, rest deg, band deg, inside',
    ...d.restCheck.map(r => `  ${r.joint}\t${fixed(r.deg, 2)}\t${fixed(r.restDeg, 2)}\t${fixed(r.band, 2)}\t${r.inside ? 'yes' : 'no'}`),
  ])
}
