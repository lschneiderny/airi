import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Apex } from './gesture-timing'
import type { Side } from './kinematics'
import type { CriterionReport, LoadedRun, ReportConstant } from './report'

import { ARM_NOISE_DEGREES } from '@proj-airi/motion-driver-humanoid/performance'

import { strokeApexes } from './gesture-timing'
import { SIDES } from './kinematics'
import { popEvents, upperBodyPopBones } from './pops'
import { criterionReport, fixed, labelledPeaks, markers, ReportUsageError, requireGate, requirement, requireSummary } from './report'

export const OWNERSHIP_VERSION = 2

/** Plan 2.5's C004 constants, with the version 2 amendment, the lead's pool and revision B (E/g3/own2/rules-v2.md). */
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
  reactionClearance: 1,
  envelopeFrames: 60,
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
  { name: 'stale window', value: C.staleSeconds, unit: 's after each release', source: 'plan 2.5 stale state; revision B second release (B3)' },
  { name: 'rest check', value: C.restCheckAfter, unit: 's after the first release', source: 'plan 2.5' },
  { name: 'rest envelope', value: C.restNoiseScale, unit: 'x idle noise per joint (H/arms.ts noise degrees) around the range of the free, settled arms\' offsets from their rest in this run (both arms before the claim, the left after it, not [release, release + 1] s)', source: 'revision B, lead decision on B1' },
  { name: 'rest envelope frames', value: C.envelopeFrames, unit: 'frames, else REFUSED (1 s, above the drift noise\'s fastest time constant 0.9 s)', source: 'revision B' },
  { name: 'touch reaction clearance', value: C.reactionClearance, unit: 's around a touch and the emotion posture it starts', source: 'revision B, lead decision on B1' },
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
  readonly staleApexes: readonly number[]
  /** The idle speed bar, A/s, or null when it was refused. */
  readonly speedBar: number | null
  readonly second: { readonly release: number | null, readonly freeAt: number | null, readonly activeAt: readonly Side[], readonly activationBeforeFree: number, readonly staleApexes: readonly number[] }
  readonly envelope: { readonly frames: number, readonly lo: readonly number[], readonly hi: readonly number[] }
  /** Offsets from each side's rest at release + 0.5 s, degrees, against the envelope. */
  readonly restCheck: readonly { readonly joint: number, readonly right: number, readonly left: number, readonly lo: number, readonly hi: number, readonly rightInside: boolean, readonly leftInside: boolean }[]
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
  const unmatched = (t: number) => !peaks.some(peak => Math.abs(t - peak) <= C.hitSeconds + 1e-9)
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

  // no-stale-stroke. A right stroke counts as stale when its apex lies in [release, release + 1] s, its stroke starts
  // once ownership has reached 0 (the clip's own release fade starts before) and no labelled peak lies within 200 ms.
  const releases = markers(run, 'clip-release').map(m => m.t)
  const freeAfter = (t: number | null) => {
    const from = t === null ? -1 : Math.max(0, frameAt(t))
    const frame = t === null ? -1 : owned.right.findIndex((v, k) => k >= from && v === 0)
    return { from, frame, at: frame >= 0 ? frameTime(frame) : null }
  }
  const staleAfter = (t: number | null, freeAt: number | null) => t === null || freeAt === null
    ? []
    : strokes.filter(a => a.side === 'right' && a.t >= t && a.t <= t + C.staleSeconds && p.times[a.stroke.start] >= freeAt - 1e-9 && unmatched(a.t)).map(a => a.t)
  // First release, in silence: no right activation until the next unit starts.
  const release = releases[0] ?? null
  const free = freeAfter(release)
  const freeAt = free.at
  const nextUnitStart = release === null ? null : markers(run, 'gesture-unit:start').map(m => m.t).find(t => t > release) ?? null
  const releaseActivation = release === null ? 0 : Math.max(0, ...activation.right.slice(free.from, nextUnitStart === null ? undefined : frameAt(nextUnitStart)))
  const staleApexes = staleAfter(release, freeAt)
  // Second release, inside utterance C (lead decision on B3): the right arm may join the running unit only once
  // ownership reaches 0, at a planned stroke; the case is a unit active on a free arm at that release.
  const secondRelease = releases[1] ?? null
  const secondFree = freeAfter(secondRelease)
  const secondActive = activeAt(secondRelease === null ? -1 : secondFree.from)
  const secondExercised = secondActive.length > 0
  const activationBeforeFree = secondRelease === null ? 0 : Math.max(0, ...activation.right.slice(secondFree.from, secondFree.frame < 0 ? undefined : secondFree.frame))
  const secondStale = staleAfter(secondRelease, secondFree.at)
  const staleHolds = release !== null && freeAt !== null && releaseActivation === 0 && staleApexes.length === 0
    && (secondRelease === null || (secondFree.at !== null && activationBeforeFree === 0 && secondStale.length === 0))

  // rest-band (lead decision on B1): the same-run rest envelope of the free, settled arms, as offsets from each side's
  // own rest, from both arms before the claim and the left arm after it, outside the judged window and any touch reaction.
  const events = input.trace.events
  const posture = (t: number, edge: 'onset' | 'release') => events.filter(e => e.kind === 'marker' && e.label.startsWith('emotion-posture:') && e.label.endsWith(`:${edge}`) && (edge === 'release' ? e.t > t : Math.abs(e.t - t) <= 1 / 60 + 1e-9))
  const reactions = events.flatMap(e => e.kind === 'touch' ? [[e.t, posture(e.t, 'onset').length ? posture(e.t, 'release')[0]?.t ?? Number.POSITIVE_INFINITY : e.t] as const] : [])
  const inReaction = (t: number) => reactions.some(([from, to]) => t >= from - C.reactionClearance && t <= to + C.reactionClearance)
  const rest: Record<Side, readonly number[]> = summary.ownership.restArmDeg
  const offsets = (side: Side, k: number) => {
    const deg = summary.ownership.armDeg[side][k]
    return deg?.length === 9 && rest[side].length === 9 ? deg.map((d, j) => d - rest[side][j]) : null
  }
  const judgedWindow = (t: number) => release !== null && t >= release - 1e-9 && t <= release + 1 + 1e-9
  const beforeClaim = claimFrame >= 0 ? claimFrame : owned.right.length
  const lo = Array.from<number>({ length: 9 }).fill(Number.POSITIVE_INFINITY)
  const hi = Array.from<number>({ length: 9 }).fill(Number.NEGATIVE_INFINITY)
  let envelopeFrames = 0
  for (let k = 0; k < owned.right.length; k++) {
    const t = frameTime(k)
    if (judgedWindow(t) || inReaction(t))
      continue
    for (const side of SIDES) {
      const offset = (side === 'left' || k < beforeClaim) && owned[side][k] === 0 && activation[side][k] === 0 ? offsets(side, k) : null
      if (!offset)
        continue
      envelopeFrames++
      offset.forEach((v, j) => {
        lo[j] = Math.min(lo[j], v)
        hi[j] = Math.max(hi[j], v)
      })
    }
  }
  const envelope = { frames: envelopeFrames, lo: lo.map((v, j) => v - C.restNoiseScale * ARM_NOISE_DEGREES[j]), hi: hi.map((v, j) => v + C.restNoiseScale * ARM_NOISE_DEGREES[j]) }
  const restFrame = release === null ? -1 : frameAt(release + C.restCheckAfter)
  const rightAtRest = offsets('right', restFrame) ?? []
  const leftAtRest = offsets('left', restFrame) ?? []
  const leftBusy = restFrame >= 0 && ((activation.left[restFrame] ?? 0) > 0 || (owned.left[restFrame] ?? 0) > 0)
  const inside = (v: number | undefined, j: number) => v !== undefined && v >= envelope.lo[j] && v <= envelope.hi[j]
  const restCheck = rightAtRest.map((right, joint) => ({ joint, right, left: leftAtRest[joint] ?? Number.NaN, lo: envelope.lo[joint], hi: envelope.hi[joint], rightInside: inside(right, joint), leftInside: inside(leftAtRest[joint], joint) }))
  const restRefusal = leftBusy
    ? 'the left arm is inside a gesture unit or owned at release + 0.5 s'
    : envelope.frames < C.envelopeFrames
      ? `the rest envelope holds ${envelope.frames} frames; it needs ${C.envelopeFrames}`
      : restCheck.length === 9 && !restCheck.every(r => r.leftInside)
        ? 'the never-owned left arm is outside the rest envelope at release + 0.5 s (not a rest instant)'
        : null

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
    line('no-stale-stroke', `first release: right gesture activation 0 until the next unit start; second release: right gesture activation 0 until owned.rightArm = 0; after each, no right stroke apex in [release, release + ${C.staleSeconds}] s whose stroke starts once owned.rightArm = 0 and that lies more than ${C.hitSeconds * 1000} ms from every labelled peak; exercised when a gesture unit is active on a free arm at the second release`, release === null ? 'no release' : `first: activation ${fixed(releaseActivation, 3)}, ${staleApexes.length} stale strokes; second: ${secondRelease === null ? 'none' : `activation before owned 0 ${fixed(activationBeforeFree, 3)}, ${secondStale.length} stale strokes, active at the release: ${secondActive.join(', ') || 'none'}`}`, noBar ? 'REFUSED' : caseStatus(staleHolds, secondExercised), noBar ?? (secondExercised ? null : secondRelease === null ? 'no second release' : 'no gesture unit active at the second release'), secondExercised),
    line('rest-band', `right-arm offsets from rest inside the run's rest envelope (free, settled arms' offset range +/- ${C.restNoiseScale} x idle noise, >= ${C.envelopeFrames} frames) at release + ${C.restCheckAfter} s; REFUSED when the never-owned left arm is outside it, in a unit or owned`, `${restCheck.filter(r => r.rightInside).length}/${restCheck.length} right joints, ${restCheck.filter(r => r.leftInside).length}/${restCheck.length} left joints inside; envelope of ${envelope.frames} frames`, release === null ? 'FAIL' : restRefusal ? 'REFUSED' : verdict(restCheck.length === 9 && restCheck.every(r => r.rightInside)), release === null ? null : restRefusal),
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
    speedBar,
    second: { release: secondRelease, freeAt: secondFree.at, activeAt: secondActive, activationBeforeFree, staleApexes: secondStale },
    envelope,
    restCheck,
    barRefusal,
  }
}

/**
 * C004 ownership report version 2 (revision B): every run of the pool judged per requirement against the companion idle
 * runs' stroke bar, then the pooled verdict. It refuses a pool of fewer than six runs, runs of another scenario or
 * version, of more than one commit or model, two runs of one seed (lead, after the rules flagged it), or a pool whose
 * idle speed bar is refused (no or too few idle apexes, or a companion of another model or commit). That the seeds are
 * 1 to 6 is the criterion's to name.
 */
export function ownershipReport(runs: readonly LoadedRun[], idleRuns: readonly LoadedRun[]): CriterionReport<OwnershipDetail> {
  const judged = runs.map(run => judgeRun(run, idleRuns))
  const refusals: string[] = []
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
      `  release: ${fixed(run.release)}; owned 0 from: ${fixed(run.freeAt)}; next unit start: ${fixed(run.nextUnitStart)}; stale right strokes: ${run.staleApexes.map(t => t.toFixed(3)).join(', ') || 'none'}`,
      `  second release: ${fixed(run.second.release)}; owned 0 from: ${fixed(run.second.freeAt)}; unit active on: ${run.second.activeAt.join(', ') || 'none'}; right activation before owned 0: ${fixed(run.second.activationBeforeFree, 3)}; stale right strokes: ${run.second.staleApexes.map(t => t.toFixed(3)).join(', ') || 'none'}`,
      `  offsets from rest at release + 0.5 s against the rest envelope (${run.envelope.frames} frames): joint, right deg, left deg, envelope lo, hi, right inside, left inside`,
      ...run.restCheck.map(r => `    ${r.joint}\t${fixed(r.right, 2)}\t${fixed(r.left, 2)}\t${fixed(r.lo, 2)}\t${fixed(r.hi, 2)}\t${r.rightInside ? 'yes' : 'no'}\t${r.leftInside ? 'yes' : 'no'}`),
    ]),
  ].join('\n')}\n`
}
