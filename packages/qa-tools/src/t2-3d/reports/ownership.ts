import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Motion3dRunSummary } from '../runner/measurement'
import type { Apex } from './gesture-timing'
import type { Side } from './kinematics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { percentile } from '../gate/bands'
import { strokeApexes } from './gesture-timing'
import { apexTimes, handPath, SIDES } from './kinematics'
import { popEvents, upperBodyPopBones } from './pops'
import { criterionReport, fixed, labelledPeaks, markers, ReportUsageError, requireGate, requirement, requireSummary } from './report'

export const OWNERSHIP_VERSION = 2

/** Plan 2.5's C004 constants, with the version 2 amendment, the lead's pool and revisions B to C2.1 (E/g3/own2/rules-v2.md). */
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
  releaseFreeSeconds: 1,
  restCheckAfter: 0.5,
  restPercentile: 0.95,
  restRedrawSeconds: 70,
  scenario: 'gesture-under-clip',
  scenarioVersion: 3,
  poolRuns: 6,
  poolExercised: 2,
}

export const OWNERSHIP_CONSTANTS: readonly ReportConstant[] = [
  { name: 'owned deviation', value: C.deviationRad, unit: 'rad', source: 'C004' },
  { name: 'fully owned', value: C.fullyOwned, unit: 'owned.rightArm', source: 'plan 2.5' },
  { name: 'yield threshold', value: C.yieldOwned, unit: 'owned', source: 'architecture 3g admission rule; also the free-arm bound of an active unit' },
  { name: 'stroke', value: 'peak hand speed > the idle speed bar', unit: 'gesture-timing version 3: p95 of the candidate-apex peak speeds pooled over >= 20 apexes of companion idle runs (--idle) of the same model and commit, else REFUSED', source: 'revision B, lead decision on B2 and B4' },
  { name: 'owned span', value: C.ownedSeconds, unit: 's', source: 'plan 2.5 non-vacuity' },
  { name: 'owned peaks', value: C.ownedPeaks, unit: 'labelled peaks', source: 'plan 2.5 non-vacuity' },
  { name: 'left-arm strokes', value: C.leftApexes, unit: `stroke apexes within ${C.hitSeconds * 1000} ms of owned peaks`, source: 'plan 2.5; C001 rule; revision B stroke bar' },
  { name: 'poke pop window', value: C.pokeWindow.join('..'), unit: 's around the poke', source: 'C004; revision B drops the whole-run spike rate (B4)' },
  { name: 'resume', value: C.resumeAfter, unit: 's after the poke, first labelled peak, a stroke apex', source: 'plan 2.5 cancel and resume' },
  { name: 'stale window', value: C.staleSeconds, unit: 's after each release; right apexes in it are reported, not judged', source: 'plan 2.5 stale state; revision B second release (B3); revision C2' },
  { name: 'release to owned 0', value: C.releaseFreeSeconds, unit: 's after each clip-release by which owned.rightArm reaches 0', source: 'revision C2.1: the upper layer\'s 0.3 s exit fade (stage-ui-mmd layer-fade.ts LAYER_FADE_SECONDS.upperOut, applied by runner/run.ts at the release) completes well inside the stale window\'s 1 s' },
  { name: 'rest check', value: C.restCheckAfter, unit: 's after the first release', source: 'plan 2.5' },
  { name: 'performer arm channels report (not the posed arm; not judged)', value: C.restPercentile, unit: 'percentile over the idle runs of |(R - restR) - (L - restL)| per joint of the performer\'s arm channels, printed beside the same at release + 0.5 s', source: 'revision C2.1: summary.ownership.armDeg is the performer\'s channels before the clip blend, so a pose the clip or the adapter holds in the bones does not appear in it' },
  { name: 'idle run length', value: C.restRedrawSeconds, unit: 's of trace (warm-up included) at or beyond which an idle companion is refused: the performer\'s first rest redraw (H/performance/arms.ts redraw = 70), so its recorded rest would not hold throughout', source: 'revision C2' },
  { name: 'pool', value: C.poolRuns, unit: `${C.scenario} version ${C.scenarioVersion} runs of one commit, one model and distinct seeds (seeds 1 to 6)`, source: 'lead pooling decision A and C; distinct seeds added by the lead' },
  { name: 'exercised runs', value: C.poolExercised, unit: 'runs on which a requirement that needs a case is exercised', source: 'lead pooling decision C' },
]

const TRUNK: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'upperChest']

export type OwnershipStatus = 'PASS' | 'FAIL' | 'NOT-EXERCISED' | 'REFUSED'

/** The requirements that need a case to occur in the run (lead pooling decision B). */
export const OWNERSHIP_CASE_REQUIREMENTS: readonly string[] = ['performer-yields', 'poke-continuous', 'resume-after-cancel', 'no-stale-stroke']

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
  /** The idle speed bar, A/s, or null when it was refused. */
  readonly speedBar: number | null
  readonly second: { readonly release: number | null, readonly freeAt: number | null, readonly activeAt: readonly Side[], readonly activationBeforeFree: number }
  /** Report only, not judged: every right-hand apex in [release, release + 1] s after the first and second release. */
  readonly staleReport: readonly { readonly release: number, readonly t: number, readonly overBar: number | null, readonly travel: number, readonly displacement: readonly [number, number, number] | null }[]
  /** Report only, not judged: (R - restR) - (L - restL) per joint of the performer's arm channels (not the posed arm) at release + 0.5 s, degrees, beside the idle runs' 95th percentile. */
  readonly restReport: { readonly at: number | null, readonly idleFrames: number, readonly joints: readonly { readonly joint: number, readonly difference: number, readonly idleP95: number | null }[] }
  /** Why the idle speed bar was refused, or null. */
  readonly barRefusal: string | null
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

/** One `gesture-under-clip` version 3 run, judged requirement by requirement (E/g3/own2/rules-v2.md, revision B). */
function judgeRun(run: LoadedRun, idleRuns: readonly LoadedRun[]): OwnershipRun {
  const summary = requireSummary(run)
  // The report judges gated runs.
  requireGate(run)
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

  // Revision B: only strokes count, apexes above gesture-timing version 3's idle speed bar (lead decision on B2, B4).
  let strokes: readonly Apex[] = []
  let speedBar: number | null = null
  let barRefusal: string | null = null
  try {
    const counted = strokeApexes(run, idleRuns)
    strokes = counted.apexes
    speedBar = counted.speedBar
  }
  catch (error) {
    if (!(error instanceof ReportUsageError))
      throw error
    barRefusal = error.message
  }
  const near = (t: number, side?: Side) => strokes.some(a => (!side || a.side === side) && Math.abs(a.t - t) <= C.hitSeconds + 1e-9)
  const leftHits = ownedPeaks.filter(t => near(t, 'left')).length
  const activeAt = (frame: number) => SIDES.filter(side => frame >= 0 && (owned[side][frame] ?? 1) < C.yieldOwned && (activation[side][frame] ?? 0) > 0)

  // performer-yields: exercised when the right arm is gesturing on the last frame before the clip first owns it.
  const yieldActivation = Math.max(0, ...owned.right.flatMap((v, k) => v > C.yieldOwned ? [activation.right[k]] : []))
  const claimFrame = owned.right.findIndex(v => v > 0)
  const claimActivation = claimFrame > 0 ? activation.right[claimFrame - 1] : null
  const yieldsExercised = (claimActivation ?? 0) > 0

  // poke-continuous and resume-after-cancel: exercised when a gesture unit is active on a free arm at the poke.
  const pokes = input.trace.events.flatMap(e => e.kind === 'touch' && e.touch === 'poke' ? [e.t] : [])
  const pokeFrame = pokes.length ? frameAt(pokes[0]) : -1
  const activeAtPoke = activeAt(pokeFrame)
  const pokeExercised = activeAtPoke.length > 0
  const pokePops = pokes.reduce((n, t) => n + popEvents(p, [...new Set([...upperBodyPopBones, ...TRUNK])], t + C.pokeWindow[0], t + C.pokeWindow[1]).length, 0)
  const pokeHolds = pokes.length > 0 && pokePops === 0
  const resumePeak = pokes.length ? peaks.find(t => t >= pokes[0] + C.resumeAfter) ?? null : null
  const notAtPoke = 'no gesture unit active at the poke'

  // no-stale-stroke (revision C2): the activation clauses only. First release, in silence: no right activation until
  // the next unit starts. Second release, inside utterance C: no right activation until ownership reaches 0, the
  // earliest instant a planned stroke may start; the case is a unit active on a free arm at that release.
  const releases = markers(run, 'clip-release').map(m => m.t)
  const freeAfter = (t: number | null) => {
    const from = t === null ? -1 : Math.max(0, frameAt(t))
    const frame = t === null ? -1 : owned.right.findIndex((v, k) => k >= from && v === 0)
    return { from, frame, at: frame >= 0 ? frameTime(frame) : null }
  }
  const release = releases[0] ?? null
  const free = freeAfter(release)
  const freeAt = free.at
  const nextUnitStart = release === null ? null : markers(run, 'gesture-unit:start').map(m => m.t).find(t => t > release) ?? null
  const releaseActivation = release === null ? 0 : Math.max(0, ...activation.right.slice(free.from, nextUnitStart === null ? undefined : frameAt(nextUnitStart)))
  const secondRelease = releases[1] ?? null
  const secondFree = freeAfter(secondRelease)
  const secondActive = activeAt(secondRelease === null ? -1 : secondFree.from)
  const secondExercised = secondActive.length > 0
  const activationBeforeFree = secondRelease === null ? 0 : Math.max(0, ...activation.right.slice(secondFree.from, secondFree.frame < 0 ? undefined : secondFree.frame))
  const staleHolds = release !== null && releaseActivation === 0 && activationBeforeFree === 0
  // clip-releases (revision C2.1): after each release, owned.rightArm reaches 0 within 1 s; a clip that never lets go fails.
  const releaseToFree = releases.map(t => ({ t, free: freeAfter(t).at }))
  const releasesHold = releaseToFree.length > 0 && releaseToFree.every(r => r.free !== null && r.free - r.t <= C.releaseFreeSeconds + 1e-9)
  // Report only, not judged (revision C2 stated limit): every right-hand apex in [release, release + 1] s after each
  // release, with its peak speed as a multiple of the idle speed bar, its travel and its trunk-frame displacement.
  const rightHand = handPath(p, 'right')
  const staleReport = releases.slice(0, 2).flatMap((t, i) => apexTimes(p, ['right']).filter(a => a.t >= t && a.t <= t + C.staleSeconds).map((a) => {
    const from = rightHand?.position[a.stroke.start]
    const to = rightHand?.position[a.stroke.apex ?? a.stroke.end]
    return { release: i + 1, t: a.t, overBar: speedBar === null ? null : a.stroke.peakSpeed / speedBar, travel: a.stroke.travel, displacement: from && to ? [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const : null }
  }))

  // rest-band (revision C2): report only, not judged. Each arm's offset from its own recorded rest, compared across the
  // arms at release + 0.5 s, beside the pooled 95th percentile of the same over the companion idle runs. Revision C2.1:
  // these are the performer's arm channels before the clip blend, so a pose held in the bones does not appear in them.
  const restDifference = (s: Motion3dRunSummary, k: number) => {
    const { armDeg, restArmDeg } = s.ownership
    const right = armDeg.right[k]
    const left = armDeg.left[k]
    return right?.length === 9 && left?.length === 9 && restArmDeg.right.length === 9 && restArmDeg.left.length === 9 ? right.map((v, j) => (v - restArmDeg.right[j]) - (left[j] - restArmDeg.left[j])) : null
  }
  const idleDifferences: number[][] = Array.from({ length: 9 }, () => [])
  for (const companion of idleRuns) {
    if (!companion.summary)
      continue
    for (let k = 0; k < companion.summary.ownership.armDeg.right.length; k++)
      restDifference(companion.summary, k)?.forEach((v, j) => idleDifferences[j].push(Math.abs(v)))
  }
  const restFrame = release === null ? -1 : frameAt(release + C.restCheckAfter)
  const atRelease = restDifference(summary, restFrame)
  const restReport = {
    at: release === null ? null : release + C.restCheckAfter,
    idleFrames: idleDifferences[0].length,
    joints: (atRelease ?? []).map((difference, joint) => ({ joint, difference, idleP95: idleDifferences[joint].length ? percentile(idleDifferences[joint], C.restPercentile) : null })),
  }

  const penetration = Math.max(0, ...summary.perFrame.penL, ...summary.perFrame.penR)
  const allPops = popEvents(p, upperBodyPopBones).length
  const { corrector } = summary
  const verdict = (pass: boolean): OwnershipStatus => pass ? 'PASS' : 'FAIL'
  const noBar = barRefusal === null ? null : `no idle speed bar: ${barRefusal}`
  const requirements: OwnershipRunRequirement[] = [
    line('owned-arm-untouched', `write deviation of the right arm and fingers <= ${C.deviationRad} rad on fully owned frames`, `rightArm ${fixed(maxDeviation('rightArm'), 6)}, rightFingers ${fixed(maxDeviation('rightFingers'), 6)} over ${full.length} frames`, verdict(full.length > 0 && maxDeviation('rightArm') <= C.deviationRad && maxDeviation('rightFingers') <= C.deviationRad)),
    line('trace-cross-check', `trace right upper arm, lower arm and hand within ${C.deviationRad} rad of the clip's analytic pose on fully owned frames`, Object.entries(traceDeviation).map(([b, v]) => `${b} ${fixed(v, 6)}`).join(', '), verdict(full.length > 0 && Object.values(traceDeviation).every(v => v <= C.deviationRad))),
    line('performer-yields', `right-arm gesture activation = 0 on every frame with owned.rightArm > ${C.yieldOwned}; exercised when the right arm is gesturing at the claim`, `${fixed(yieldActivation, 6)} while owned; ${fixed(claimActivation, 3)} at the claim`, caseStatus(yieldActivation === 0, yieldsExercised), yieldsExercised ? null : 'right gesture activation 0 at the claim', yieldsExercised),
    line('left-arm-gestures', `fully owned span >= ${C.ownedSeconds} s with >= ${C.ownedPeaks} labelled peaks, >= ${C.leftApexes} of them hit by a left stroke apex`, `${span ? fixed((span.to - span.from + 1) / 60, 2) : 0} s, ${ownedPeaks.length} peaks, ${leftHits} left stroke hits`, noBar ? 'REFUSED' : verdict(!!span && (span.to - span.from + 1) / 60 >= C.ownedSeconds && ownedPeaks.length >= C.ownedPeaks && leftHits >= C.leftApexes), noBar),
    line('poke-continuous', `a poke, and no arm or trunk pop in [poke - 0.2, poke + 1] s; exercised when a gesture unit is active on a free arm at the poke`, `${pokes.length} pokes, ${pokePops} pops; active at the poke: ${activeAtPoke.join(', ') || 'none'}`, caseStatus(pokeHolds, pokeExercised), pokeExercised ? null : notAtPoke, pokeExercised),
    line('resume-after-cancel', `with a gesture unit active at the poke, the first labelled peak >= ${C.resumeAfter} s after the poke has a stroke apex within ${C.hitSeconds * 1000} ms`, resumePeak === null ? 'no such peak' : `${resumePeak.toFixed(3)} s ${near(resumePeak) ? 'hit' : 'missed'}`, noBar ? 'REFUSED' : pokeExercised ? verdict(resumePeak !== null && near(resumePeak)) : 'NOT-EXERCISED', noBar ?? (pokeExercised ? null : notAtPoke), pokeExercised),
    line('no-stale-stroke', 'first release: right gesture activation 0 until the next unit start; second release: right gesture activation 0 until owned.rightArm = 0 (the earliest planned stroke start); exercised when a gesture unit is active on a free arm at the second release; the right apexes after each release are reported, not judged', release === null ? 'no release' : `first: activation ${fixed(releaseActivation, 3)}; second: ${secondRelease === null ? 'none' : `activation before owned 0 ${fixed(activationBeforeFree, 3)}, active at the release: ${secondActive.join(', ') || 'none'}`}`, release === null ? 'FAIL' : caseStatus(staleHolds, secondExercised), secondExercised ? null : secondRelease === null ? 'no second release' : 'no gesture unit active at the second release', secondExercised),
    line('clip-releases', `after each clip-release, owned.rightArm reaches 0 within ${C.releaseFreeSeconds} s`, releaseToFree.length ? releaseToFree.map((r, i) => `release ${i + 1} at ${r.t.toFixed(3)} s: ${r.free === null ? 'owned never reaches 0' : `owned 0 after ${(r.free - r.t).toFixed(3)} s`}`).join('; ') : 'no release', verdict(releasesHold)),
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
    speedBar,
    second: { release: secondRelease, freeAt: secondFree.at, activeAt: secondActive, activationBeforeFree },
    staleReport,
    restReport,
    barRefusal,
  }
}

/**
 * C004 ownership report version 2 (revision C2.1): every run of the pool judged per requirement against the companion idle
 * runs' stroke bar, then the pooled verdict; the performer's arm channels at the release and the right apexes after each
 * release are reported, not judged. The yield is judged on the gesture layer's weight, not on the bones in the claim fade. It also refuses an idle companion long enough for the performer to redraw its rest. It refuses a pool of fewer than six runs, runs of another scenario or
 * version, of more than one commit or model, two runs of one seed (lead, after the rules flagged it), or a pool whose
 * idle speed bar is refused (no or too few idle apexes, or a companion of another model or commit). That the seeds are
 * 1 to 6 is the criterion's to name.
 */
export function ownershipReport(runs: readonly LoadedRun[], idleRuns: readonly LoadedRun[]): CriterionReport<OwnershipDetail> {
  const judged = runs.map(run => judgeRun(run, idleRuns))
  const refusals: string[] = []
  for (const companion of idleRuns) {
    const seconds = companion.input.trace.frames / 60
    if (seconds >= C.restRedrawSeconds)
      refusals.push(`idle companion ${companion.dir} lasts ${fixed(seconds, 1)} s; the performer redraws its rest at ${C.restRedrawSeconds} s, so its recorded rest does not hold throughout: use idle runs of at most 60 s scored`)
  }
  const barRefused = judged.filter(run => run.barRefusal !== null)
  if (barRefused.length)
    refusals.push(`idle speed bar refused on ${barRefused.length} of ${judged.length} runs: ${barRefused[0].barRefusal}`)
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
      `  idle speed bar: ${run.speedBar === null ? `refused (${run.barRefusal})` : `${fixed(run.speedBar, 3)} A/s`}`,
      `  release: ${fixed(run.release)}; owned 0 from: ${fixed(run.freeAt)}; next unit start: ${fixed(run.nextUnitStart)}`,
      `  second release: ${fixed(run.second.release)}; owned 0 from: ${fixed(run.second.freeAt)}; unit active on: ${run.second.activeAt.join(', ') || 'none'}; right activation before owned 0: ${fixed(run.second.activationBeforeFree, 3)}`,
      '  right apexes after each release (report only, not judged): release, apex s, x idle speed bar, travel A, displacement start to apex (x, y, z) A',
      ...run.staleReport.map(a => `    ${a.release}\t${a.t.toFixed(3)}\t${fixed(a.overBar, 2)}\t${fixed(a.travel, 3)}\t${a.displacement ? a.displacement.map(v => v.toFixed(3)).join(', ') : '-'}`),
      `  performer arm channels at release + 0.5 s (not the posed arm; not judged): joint, (R - restR) - (L - restL) deg, idle p${C.restPercentile * 100} abs deg over ${run.restReport.idleFrames} idle frames`,
      ...run.restReport.joints.map(r => `    ${r.joint}\t${fixed(r.difference, 2)}\t${fixed(r.idleP95, 2)}`),
    ]),
  ].join('\n')}\n`
}
