import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MotionBandsFile } from '../gate/types'
import type { Side } from './kinematics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { ARM_NOISE_DEGREES } from '@proj-airi/motion-driver-humanoid/performance'

import { apexTimes, SIDES } from './kinematics'
import { popEvents, upperBodyPopBones } from './pops'
import { criterionReport, fixed, gateStatus, labelledPeaks, markers, printedBand, ReportUsageError, requireGate, requirement, requireSummary } from './report'

export const OWNERSHIP_VERSION = 2

/** Plan 2.5's C004 constants, with the version 2 amendment and the lead's pool (E/g3/own2/rules-v2.md). */
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
  scenario: 'gesture-under-clip',
  scenarioVersion: 3,
  poolRuns: 6,
  poolExercised: 2,
}

export const OWNERSHIP_CONSTANTS: readonly ReportConstant[] = [
  { name: 'owned deviation', value: C.deviationRad, unit: 'rad', source: 'C004' },
  { name: 'fully owned', value: C.fullyOwned, unit: 'owned.rightArm', source: 'plan 2.5' },
  { name: 'yield threshold', value: C.yieldOwned, unit: 'owned', source: 'architecture 3g admission rule; also the free-arm bound at the poke' },
  { name: 'owned span', value: C.ownedSeconds, unit: 's', source: 'plan 2.5 non-vacuity' },
  { name: 'owned peaks', value: C.ownedPeaks, unit: 'labelled peaks', source: 'plan 2.5 non-vacuity' },
  { name: 'left-arm apexes', value: C.leftApexes, unit: `within ${C.hitSeconds * 1000} ms of owned peaks`, source: 'plan 2.5; C001 rule' },
  { name: 'poke pop window', value: C.pokeWindow.join('..'), unit: 's around the poke', source: 'C004' },
  { name: 'resume', value: C.resumeAfter, unit: 's after the poke, first labelled peak', source: 'plan 2.5 cancel and resume' },
  { name: 'stale window', value: C.staleSeconds, unit: 's after release', source: 'plan 2.5 stale state' },
  { name: 'rest check', value: C.restCheckAfter, unit: 's after release', source: 'plan 2.5' },
  { name: 'rest band', value: C.restNoiseScale, unit: 'x idle noise per joint (H/arms.ts noise degrees) + the free left arm\'s offset from its rest on the same frame', source: 'version 2 amendment item 4' },
  { name: 'pool', value: C.poolRuns, unit: `${C.scenario} version ${C.scenarioVersion} runs of one commit, one model and distinct seeds (seeds 1 to 6)`, source: 'lead pooling decision A and C; distinct seeds added by the lead' },
  { name: 'exercised runs', value: C.poolExercised, unit: 'runs on which a requirement that needs a case is exercised', source: 'lead pooling decision C' },
]

const TRUNK: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest']

export type OwnershipStatus = 'PASS' | 'FAIL' | 'NOT-EXERCISED' | 'REFUSED'

/** The requirements that need a case to occur in the run (lead pooling decision B). */
export const OWNERSHIP_CASE_REQUIREMENTS: readonly string[] = ['performer-yields', 'poke-continuous', 'resume-after-cancel']

export interface OwnershipRunRequirement {
  readonly id: string
  readonly rule: string
  readonly value: string
  readonly status: OwnershipStatus
  /** Why the requirement was not exercised or refused on this run. */
  readonly reason: string | null
  /** Whether the run held the requirement's case, PASS or FAIL; null for a requirement that needs none. */
  readonly exercised: boolean | null
}

export interface OwnershipRun {
  readonly dir: string
  readonly seed: number | null
  readonly commit: string | null
  readonly model: string | null
  readonly scenario: { readonly id: string, readonly version: number | string | boolean | null }
  readonly requirements: readonly OwnershipRunRequirement[]
  readonly fullyOwnedFrames: number
  readonly ownedSpan: { readonly from: number, readonly to: number } | null
  readonly ownedPeaks: readonly number[]
  readonly claimActivation: number | null
  readonly pokes: readonly number[]
  readonly activeAtPoke: readonly Side[]
  readonly resumePeak: number | null
  readonly release: number | null
  readonly freeAt: number | null
  readonly nextUnitStart: number | null
  readonly staleApexes: readonly number[]
  readonly restCheck: readonly { readonly joint: number, readonly deg: number, readonly restDeg: number, readonly leftOffset: number, readonly band: number, readonly inside: boolean }[]
}

export interface OwnershipDetail {
  readonly verdict: 'PASS' | 'FAIL' | 'REFUSED'
  readonly refusals: readonly string[]
  /** Per requirement that needs a case: the runs on which the case occurred (lead pooling decision C). */
  readonly exercised: Readonly<Record<string, number>>
  readonly runs: readonly OwnershipRun[]
}

const line = (id: string, rule: string, value: string, status: OwnershipStatus, reason: string | null = null, exercised: boolean | null = null): OwnershipRunRequirement => ({ id, rule, value, status, reason, exercised })

/** A requirement that needs a case: FAIL when a clause that applies to every run fails, else PASS only where the case occurred. */
const caseStatus = (holds: boolean, exercised: boolean): OwnershipStatus => !holds ? 'FAIL' : exercised ? 'PASS' : 'NOT-EXERCISED'

/** One `gesture-under-clip` version 3 run, judged requirement by requirement (E/g3/own2/rules-v2.md). */
function judgeRun(run: LoadedRun, bands: MotionBandsFile): OwnershipRun {
  const summary = requireSummary(run)
  const gate = requireGate(run)
  if (!summary.clip)
    throw new ReportUsageError(`${run.dir} has no synthetic clip in summary.json; run the gesture-under-clip scenario`)
  const { p, input } = run
  const { source } = input.trace
  const scored = input.trace.scoredFrom
  const frameTime = (k: number) => scored + k / 60
  const frameAt = (t: number) => Math.round((t - scored) * 60)
  const ownedGroup = (group: 'leftArm' | 'rightArm') => summary.owned.perFrame.map(row => row[summary.owned.groups.indexOf(group)])
  const owned: Record<Side, number[]> = { left: ownedGroup('leftArm'), right: ownedGroup('rightArm') }
  const activation = summary.ownership.activation
  const full = owned.right.flatMap((v, k) => v >= C.fullyOwned ? [k] : [])
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
  const near = (t: number, side?: Side) => apexes.some(a => (!side || a.side === side) && Math.abs(a.t - t) <= C.hitSeconds + 1e-9)
  const leftHits = ownedPeaks.filter(t => near(t, 'left')).length

  // performer-yields: exercised when the right arm is gesturing on the last frame before the clip first owns it.
  const yieldActivation = Math.max(0, ...owned.right.flatMap((v, k) => v > C.yieldOwned ? [activation.right[k]] : []))
  const claimFrame = owned.right.findIndex(v => v > 0)
  const claimActivation = claimFrame > 0 ? activation.right[claimFrame - 1] : null
  const yieldsExercised = (claimActivation ?? 0) > 0

  // poke-continuous and resume-after-cancel: exercised when a gesture unit is active on a free arm at the poke.
  const pokes = input.trace.events.flatMap(e => e.kind === 'touch' && e.touch === 'poke' ? [e.t] : [])
  const pokeFrame = pokes.length ? frameAt(pokes[0]) : -1
  const freeAtPoke = SIDES.filter(side => pokeFrame >= 0 && (owned[side][pokeFrame] ?? 1) < C.yieldOwned)
  const activeAtPoke = freeAtPoke.filter(side => (activation[side][pokeFrame] ?? 0) > 0)
  const pokeExercised = activeAtPoke.length > 0
  const pokePops = pokes.reduce((n, t) => n + popEvents(p, [...new Set([...upperBodyPopBones, ...TRUNK])], t + C.pokeWindow[0], t + C.pokeWindow[1]).length, 0)
  const spikeBand = printedBand(bands, 'talk', 'smooth.armL.spikeRate')
  const spikes = freeAtPoke.map((side) => {
    const id = side === 'left' ? 'smooth.armL.spikeRate' : 'smooth.armR.spikeRate'
    return { id, value: gateStatus(gate, id).value }
  })
  const pokeHolds = pokes.length > 0 && pokePops === 0 && spikeBand.hi !== null && spikes.every(s => s.value !== null && s.value <= (spikeBand.hi ?? -1))
  const resumePeak = pokes.length ? peaks.find(t => t >= pokes[0] + C.resumeAfter) ?? null : null
  const notAtPoke = 'no gesture unit active at the poke'

  // no-stale-stroke: no right activation from the release to the next unit start, and no unmatched right stroke that
  // starts once ownership has reached 0 (the clip's own release fade starts before).
  const release = markers(run, 'clip-release')[0]?.t ?? null
  const releaseFrame = release === null ? -1 : Math.max(0, frameAt(release))
  const freeFrame = release === null ? -1 : owned.right.findIndex((v, k) => k >= releaseFrame && v === 0)
  const freeAt = freeFrame >= 0 ? frameTime(freeFrame) : null
  const nextUnitStart = release === null ? null : markers(run, 'gesture-unit:start').map(m => m.t).find(t => t > release) ?? null
  const releaseActivation = release === null ? 0 : Math.max(0, ...activation.right.slice(releaseFrame, nextUnitStart === null ? undefined : frameAt(nextUnitStart)))
  const staleApexes = release === null || freeAt === null
    ? []
    : apexes.filter(a => a.side === 'right' && a.t >= release && a.t <= release + C.staleSeconds && p.times[a.stroke.start] >= freeAt - 1e-9 && !peaks.some(t => Math.abs(a.t - t) <= C.hitSeconds + 1e-9)).map(a => a.t)

  // rest-band: against the free left arm's offset from its rest on the same frame.
  const restFrame = release === null ? -1 : frameAt(release + C.restCheckAfter)
  const rightDeg = summary.ownership.armDeg.right[restFrame] ?? []
  const leftDeg = summary.ownership.armDeg.left[restFrame] ?? []
  const restRight = summary.ownership.restArmDeg.right
  const restLeft = summary.ownership.restArmDeg.left
  const leftBusy = restFrame >= 0 && ((activation.left[restFrame] ?? 0) > 0 || (owned.left[restFrame] ?? 0) > 0)
  const restCheck = rightDeg.map((deg, joint) => {
    const leftOffset = Math.abs((leftDeg[joint] ?? Number.NaN) - restLeft[joint])
    const band = C.restNoiseScale * ARM_NOISE_DEGREES[joint] + leftOffset
    return { joint, deg, restDeg: restRight[joint], leftOffset, band, inside: Math.abs(deg - restRight[joint]) <= band }
  })

  const penetration = Math.max(0, ...summary.perFrame.penL, ...summary.perFrame.penR)
  const allPops = popEvents(p, upperBodyPopBones).length
  const { corrector } = summary
  const verdict = (pass: boolean): OwnershipStatus => pass ? 'PASS' : 'FAIL'
  const requirements: OwnershipRunRequirement[] = [
    line('owned-arm-untouched', `write deviation of the right arm and fingers <= ${C.deviationRad} rad on fully owned frames`, `rightArm ${fixed(maxDeviation('rightArm'), 6)}, rightFingers ${fixed(maxDeviation('rightFingers'), 6)} over ${full.length} frames`, verdict(full.length > 0 && maxDeviation('rightArm') <= C.deviationRad && maxDeviation('rightFingers') <= C.deviationRad)),
    line('trace-cross-check', `trace right upper arm, lower arm and hand within ${C.deviationRad} rad of the clip's analytic pose on fully owned frames`, Object.entries(traceDeviation).map(([b, v]) => `${b} ${fixed(v, 6)}`).join(', '), verdict(full.length > 0 && Object.values(traceDeviation).every(v => v <= C.deviationRad))),
    line('performer-yields', `right-arm gesture activation = 0 on every frame with owned.rightArm > ${C.yieldOwned}; exercised when the right arm is gesturing at the claim`, `${fixed(yieldActivation, 6)} while owned; ${fixed(claimActivation, 3)} at the claim`, caseStatus(yieldActivation === 0, yieldsExercised), yieldsExercised ? null : 'right gesture activation 0 at the claim', yieldsExercised),
    line('left-arm-gestures', `fully owned span >= ${C.ownedSeconds} s with >= ${C.ownedPeaks} labelled peaks, >= ${C.leftApexes} of them hit by a left apex`, `${span ? fixed((span.to - span.from + 1) / 60, 2) : 0} s, ${ownedPeaks.length} peaks, ${leftHits} left hits`, verdict(!!span && (span.to - span.from + 1) / 60 >= C.ownedSeconds && ownedPeaks.length >= C.ownedPeaks && leftHits >= C.leftApexes)),
    line('poke-continuous', `no arm or trunk pop in [poke - 0.2, poke + 1] s, and smooth.armX.spikeRate defined and <= ${fixed(spikeBand.hi, 1)}/min on each arm with owned < ${C.yieldOwned} at the poke; exercised when a gesture unit is active on a free arm at the poke`, `${pokes.length} pokes, ${pokePops} pops; ${spikes.map(s => `${s.id} ${fixed(s.value, 2)}`).join(', ') || 'no free arm'}; active at the poke: ${activeAtPoke.join(', ') || 'none'}`, caseStatus(pokeHolds, pokeExercised), pokeExercised ? null : notAtPoke, pokeExercised),
    line('resume-after-cancel', `with a gesture unit active at the poke, the first labelled peak >= ${C.resumeAfter} s after the poke has an apex within ${C.hitSeconds * 1000} ms`, resumePeak === null ? 'no such peak' : `${resumePeak.toFixed(3)} s ${near(resumePeak) ? 'hit' : 'missed'}`, pokeExercised ? verdict(resumePeak !== null && near(resumePeak)) : 'NOT-EXERCISED', pokeExercised ? null : notAtPoke, pokeExercised),
    line('no-stale-stroke', `right gesture activation 0 from release to the next unit start, and no unmatched right apex in [release, release + ${C.staleSeconds}] s whose stroke starts once owned.rightArm = 0`, release === null ? 'no release' : `activation ${fixed(releaseActivation, 3)}; ${staleApexes.length} stale apexes`, verdict(release !== null && freeAt !== null && releaseActivation === 0 && staleApexes.length === 0)),
    line('rest-band', `right arm angles within rest +/- (${C.restNoiseScale} x idle noise + the free left arm's offset from its rest) at release + ${C.restCheckAfter} s`, leftBusy ? 'left arm in a gesture unit or owned' : `${restCheck.filter(r => r.inside).length}/${restCheck.length} joints`, release === null ? 'FAIL' : leftBusy ? 'REFUSED' : verdict(restCheck.length === 9 && restCheck.every(r => r.inside)), leftBusy ? 'the left arm is inside a gesture unit or owned at release + 0.5 s' : null),
    line('penetration', 'max(perFrame.penL, perFrame.penR) = 0', fixed(penetration, 6), verdict(penetration === 0)),
    line('pops', 'upper-body pop count over the run = 0 (plan 2.6, unit M3)', `${allPops}`, verdict(allPops === 0)),
    line('corrector', 'capHits = guardScans = holds = 0', `capHits ${corrector.capHits}, guardScans ${corrector.guardScans}, holds ${corrector.holds}`, verdict(corrector.capHits === 0 && corrector.guardScans === 0 && corrector.holds === 0)),
  ]
  return {
    dir: run.dir,
    seed: source.scenario.seed,
    commit: source.gitSha,
    model: input.trace.rig.assetSha256,
    scenario: { id: source.scenario.id, version: source.detail.scenarioVersion ?? null },
    requirements,
    fullyOwnedFrames: full.length,
    ownedSpan: span ? { from: frameTime(span.from), to: frameTime(span.to) } : null,
    ownedPeaks,
    claimActivation,
    pokes,
    activeAtPoke,
    resumePeak,
    release,
    freeAt,
    nextUnitStart,
    staleApexes,
    restCheck,
  }
}

/**
 * C004 ownership report version 2: every run of the pool judged per requirement, then the pooled verdict. It refuses
 * a pool of fewer than six runs, runs of another scenario or version, of more than one commit or model, or two runs of
 * one seed (lead, after the rules flagged it). That the seeds are 1 to 6 is the criterion's to name.
 */
export function ownershipReport(runs: readonly LoadedRun[], bands: MotionBandsFile): CriterionReport<OwnershipDetail> {
  const judged = runs.map(run => judgeRun(run, bands))
  const refusals: string[] = []
  if (judged.length < C.poolRuns)
    refusals.push(`${judged.length} run${judged.length === 1 ? '' : 's'}; the criterion pools ${C.poolRuns}`)
  for (const run of judged) {
    if (run.scenario.id !== C.scenario || run.scenario.version !== C.scenarioVersion)
      refusals.push(`${run.dir} is ${run.scenario.id} version ${run.scenario.version}, not ${C.scenario} version ${C.scenarioVersion}`)
  }
  const distinct = (values: readonly (string | null)[]) => [...new Set(values)]
  const commits = distinct(judged.map(run => run.commit))
  if (commits.length > 1)
    refusals.push(`runs from ${commits.length} commits: ${commits.join(', ')}`)
  const models = distinct(judged.map(run => run.model))
  if (models.length > 1)
    refusals.push(`runs of ${models.length} models: ${models.join(', ')}`)
  const repeated = distinct(judged.map(run => `${run.seed}`).filter((seed, i, seeds) => seeds.indexOf(seed) !== i))
  if (repeated.length)
    refusals.push(`more than one run of seed ${repeated.join(', ')}`)
  const exercised: Record<string, number> = Object.fromEntries(OWNERSHIP_CASE_REQUIREMENTS.map(id => [id, judged.filter(run => run.requirements.find(r => r.id === id)?.exercised).length]))
  const pooled = (judged[0]?.requirements ?? []).map((first, i) => {
    const lines = judged.map(run => run.requirements[i])
    const failing = judged.filter(run => run.requirements[i].status === 'FAIL' || run.requirements[i].status === 'REFUSED').map(run => `${run.dir} ${run.requirements[i].status}`)
    const failures = failing.length ? `; ${failing.join(', ')}` : ''
    if (OWNERSHIP_CASE_REQUIREMENTS.includes(first.id)) {
      const count = exercised[first.id]
      const value = `exercised on ${count} of ${lines.length}${count < C.poolExercised ? ' (not exercised)' : ''}${failures}`
      return requirement(first.id, `${first.rule}; PASS on every exercised run and exercised on >= ${C.poolExercised} runs`, value, !failing.length && count >= C.poolExercised)
    }
    return requirement(first.id, `${first.rule}; PASS on every run`, `PASS on ${lines.filter(l => l.status === 'PASS').length} of ${lines.length}${failures}`, !failing.length)
  })
  const requirements = [
    requirement('pool', `>= ${C.poolRuns} ${C.scenario} version ${C.scenarioVersion} runs of one commit, one model and distinct seeds`, refusals.length ? `REFUSED: ${refusals.join('; ')}` : `${judged.length} runs, commit ${commits[0]}, model ${models[0]}`, refusals.length === 0),
    ...pooled,
  ]
  const verdict = refusals.length ? 'REFUSED' : requirements.every(r => r.pass) ? 'PASS' : 'FAIL'
  return criterionReport('ownership', OWNERSHIP_VERSION, runs.map(run => run.dir), OWNERSHIP_CONSTANTS, requirements, { verdict, refusals, exercised, runs: judged })
}

export function formatOwnership(report: CriterionReport<OwnershipDetail>): string {
  const d = report.detail
  return `${[
    `${report.kind} version ${report.version}: ${d.verdict}`,
    `inputs: ${report.inputs.join(', ')}`,
    'constants:',
    ...report.constants.map(c => `  ${c.name} = ${c.value} ${c.unit} (${c.source})`),
    'pooled requirements:',
    ...report.requirements.map(r => `  ${r.pass ? 'PASS' : r.id === 'pool' ? 'REFUSED' : 'FAIL'} ${r.id}: ${r.value}; rule: ${r.rule}`),
    ...d.runs.flatMap(run => [
      '',
      `run ${run.dir} (seed ${run.seed ?? '-'}, commit ${run.commit ?? '-'}, ${run.scenario.id} version ${run.scenario.version ?? '-'}):`,
      ...run.requirements.map(r => `  ${r.status} ${r.id}: ${r.value}${r.reason ? ` (${r.reason})` : ''}`),
      `  fully owned span: ${run.ownedSpan ? `${run.ownedSpan.from.toFixed(3)} .. ${run.ownedSpan.to.toFixed(3)} s` : 'none'} (${run.fullyOwnedFrames} frames); peaks inside: ${run.ownedPeaks.map(t => t.toFixed(3)).join(', ') || 'none'}`,
      `  claim activation: ${fixed(run.claimActivation, 3)}; pokes: ${run.pokes.map(t => t.toFixed(3)).join(', ') || 'none'}, unit active on: ${run.activeAtPoke.join(', ') || 'none'}; resume peak: ${run.resumePeak === null ? '-' : run.resumePeak.toFixed(3)}`,
      `  release: ${fixed(run.release)}; owned 0 from: ${fixed(run.freeAt)}; next unit start: ${fixed(run.nextUnitStart)}; stale right apexes: ${run.staleApexes.map(t => t.toFixed(3)).join(', ') || 'none'}`,
      '  right arm at release + 0.5 s: joint, deg, rest deg, left offset, band deg, inside',
      ...run.restCheck.map(r => `    ${r.joint}\t${fixed(r.deg, 2)}\t${fixed(r.restDeg, 2)}\t${fixed(r.leftOffset, 2)}\t${fixed(r.band, 2)}\t${r.inside ? 'yes' : 'no'}`),
    ]),
  ].join('\n')}\n`
}
