import type { CheckResult, EmotionGate, EmotionGateScore, EmotionTrialRecord, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { ValidationRecordsPartial, ValidationScorePartial } from '../gate/partials'
import type { MutationId, ValidationOptions, ValidationPlan } from './plan'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { buildEmotionChecks } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { readPartial } from '../gate/partials'
import { ksTestUniform } from '../ks'
import { aaSetCount, mutationSeedSet, unmutatedSetCount } from './plan'
import { recordsPartialName, scorePartialName } from './units'

/** Thresholds of qa-tooling todo 13 (protocol 1) and motion-gate-redesign (protocol 2), fixed before any protocol-2 run. */
export const validationThresholds = {
  aa: { maxSetsWithAnyPass: 1, placeboHitRate: 0.1, placeboHitRateTolerance: 0.03, ksPAbove: 0.01 },
  zero: { maxPassingChecks: 0 },
  mutations: {
    'x0': { criterion: 'detection or held-only size', minKillRate: 0.99 },
    'sign-flip': { criterion: 'sign', minKillRate: 0.99 },
    'ignore-side': { criterion: 'sided checks (significance or sign)', minKillRate: 0.95 },
    'ignore-side-neg': { criterion: 'sided checks (significance or sign)', minKillRate: 0.95 },
    'x0.5': { criterion: 'paired held-only size calibration <= 0.707 (clear and strong; slight reported only)', minKillRate: 0.9 },
    'x2': { criterion: 'size upper bound', minKillRate: 0.9 },
    'release-tau-x3': { criterion: 'release', minKillRate: 0.95 },
    'blink-interval-1': { criterion: 'modulation (significance or sign)', minKillRate: 0.95 },
  } satisfies Record<MutationId, { criterion: string, minKillRate: number }>,
  unmutated: { sets: unmutatedSetCount, persistentFailSets: 4, noiseBeta: 0.01, noiseQuantile: 0.99 },
} as const

/** Smallest k with P(Binomial(n, p) <= k) >= q, for integer n >= 0 and probabilities in [0, 1]. */
export function binomialQuantile(n: number, p: number, q: number): number {
  if (n === 0 || p === 0 || q === 0)
    return 0
  if (p === 1 || q === 1)
    return n
  const logP = Math.log(p)
  const logRest = Math.log1p(-p)
  const target = Math.log(q)
  let logMass = n * logRest
  let logCumulative = -Infinity
  for (let k = 0; k <= n; k++) {
    // Log-add-exp keeps both the PMF recurrence and its cumulative sum away from underflow.
    logCumulative = Math.max(logCumulative, logMass) + Math.log1p(Math.exp(-Math.abs(logCumulative - logMass)))
    if (logCumulative >= target)
      return k
    logMass += Math.log(n - k) - Math.log(k + 1) + logP - logRest
  }
  return n
}

/**
 * Choices made before the first run, recorded in `validation.json`:
 * - per-criterion outcomes come from the committed scorer's own fields (significance: `pHolm <= alpha`);
 * - the A/A hit-rate and KS bounds use channels whose placebo null has nonzero spread, because a channel that
 *   never moves at idle has hit rate 0 and p = 1 by construction (ties); those channels are reported separately;
 * - KS pools one p-value per distinct test per set: checks of one channel and direction share their trial values;
 * - a mutation kill rate counts checks whose targeted criterion passed on the unmutated run with the same seeds,
 *   and leaves out checks where the criterion is not evaluable; the unconditional rate is reported next to it.
 */
export const protocolNotes = [
  'Per-criterion outcomes are read from the committed scorer (significance passes when pHolm <= family alpha; visibility when hitRate is set and visibility did not fail).',
  'A/A trials are emotion-free full-trial runs relabeled as each emotion and band and scored unpaired against the committed placebo null (seeds 1-100); they carry no hold side, so sided checks use the folded null.',
  'A/A hit-rate and KS bounds use channels whose placebo null has nonzero spread; zero-spread channels are reported separately because ties make a 0.10 hit rate and uniform p-values impossible by construction.',
  'KS pools one p-value per distinct test per A/A set: checks of the same channel and direction share identical trial values.',
  'Mutation kill rates are conditional on the targeted criterion passing on unmutated set 1 (same seeds); checks where the criterion is not evaluable are excluded. Unconditional rates are reported too.',
  'ignore-side cannot reach the one-sided brow (browAsym): NaturalHoldLayer applies its own side to it, and no emotionTable, setEmotionStrengths, or settings seam removes that; those checks are listed as not mutable.',
  'Protocol 2, K1 (x0): the x0 experiment includes held-only cells and its kill rule is detection-or-size (significance, visibility or size fails); the 0.99 minimum is unchanged. Fixed before the first protocol-2 run.',
  'Protocol 2, K2 (ignore-side): two variants, ignore-side (sided = []) and ignore-side-neg (sided = [] with posture negated on the formerly sided axes); checks whose cell trials all carry the side a variant reproduces are listed as notMutable, and the 0.95 minimum applies to the pooled mutable checks of both variants. Fixed before the first protocol-2 run.',
  'Protocol 2, K3 (x0.5): a check is killed when its x0.5 sizeRatio divided by the unmutated set-1 sizeRatio is at most Math.SQRT1_2; the 0.90 minimum applies to clear and strong checks, and the gate-verdict size kill rate is reported only. Fixed before the first protocol-2 run.',
  'Protocol 2, K4 (unmutated): a check failing in at least 4 of 5 sets is a persistent finding and fails the section; the remaining fail verdicts must not exceed the 0.99 quantile of Binomial(N, 0.01), where N counts non-n/a check-set pairs excluding persistent checks, and n/a never counts. Fixed before the first protocol-2 run.',
  'Old rules: checkpoint-12 rule 1 (|recipe| >= 0.3 face channels, mean [0.5, 3.5] s minus [-1, 0] s of the right sign and >= 40% of recipe x band nominal, eyelid as 1 - multiplier on the 80th-percentile log ratio) and rule 3 (head angle bias of the right sign at clear and strong), each on one trial; rule 2 (release) needs an emotion and is not applicable to emotion-free data.',
]

type Outcome = boolean | null
type KillState = 'killed' | 'survived' | null

interface Outcomes {
  significance: Outcome
  sign: Outcome
  visibility: Outcome
  size: Outcome
  release: Outcome
}

export function criterionOutcomes(result: CheckResult, alpha: number): Outcomes {
  return {
    significance: result.pHolm === null ? null : result.pHolm <= alpha,
    sign: result.failed.includes('sign') ? false : result.E === null ? null : result.E > 0,
    visibility: result.hitRate === null ? null : !result.failed.includes('visibility'),
    size: result.sizeRatio === null ? null : !result.failed.includes('size'),
    release: result.failed.includes('release') ? false : (result.tau != null || result.residual?.ratio != null) ? true : null,
  }
}

type KillRule = 'detection' | 'detection-or-size' | 'sign' | 'significance-or-sign' | 'size' | 'release'

/** Whether a check caught the mutation under `rule`: `killed`, `survived`, or `null` when not evaluable. */
export function killState(outcomes: Outcomes, rule: KillRule): KillState {
  const fromOutcome = (outcome: Outcome): KillState => outcome === null ? null : outcome ? 'survived' : 'killed'
  switch (rule) {
    case 'detection-or-size':
      if (outcomes.significance === false || outcomes.visibility === false || outcomes.size === false)
        return 'killed'
      return outcomes.significance === true ? 'survived' : null
    case 'detection':
      if (outcomes.significance === false || outcomes.visibility === false)
        return 'killed'
      return outcomes.significance === true ? 'survived' : null
    case 'significance-or-sign':
      if (outcomes.significance === false || outcomes.sign === false)
        return 'killed'
      return outcomes.significance === true && outcomes.sign === true ? 'survived' : null
    case 'sign':
      return fromOutcome(outcomes.sign)
    case 'size':
      return fromOutcome(outcomes.size)
    case 'release':
      return fromOutcome(outcomes.release)
  }
}

const mutationRule: Record<MutationId, KillRule> = {
  'x0': 'detection-or-size',
  'sign-flip': 'sign',
  'ignore-side': 'significance-or-sign',
  'ignore-side-neg': 'significance-or-sign',
  'x0.5': 'size',
  'x2': 'size',
  'release-tau-x3': 'release',
  'blink-interval-1': 'significance-or-sign',
}

const ratio = (part: number, total: number) => total ? part / total : null
const checksByKey = new Map(buildEmotionChecks().map(check => [check.key, check]))
const channelClass = (result: CheckResult) => checksByKey.get(result.key)!.cls

/** Checks a mutation targets, and the targeted checks it cannot reach through any seam. */
function mutationTargets(mutation: MutationId, results: readonly CheckResult[], identicalCells: ReadonlySet<string>): { gated: CheckResult[], reported: CheckResult[], notMutable: CheckResult[] } {
  const none: CheckResult[] = []
  switch (mutation) {
    case 'x0':
    case 'sign-flip':
      return { gated: [...results], reported: none, notMutable: none }
    case 'ignore-side':
    case 'ignore-side-neg': {
      const sided = results.filter(result => checksByKey.get(result.key)!.sided)
      const notMutable = sided.filter(result => result.channel === 'browAsym' || identicalCells.has(`${result.emotion}:${result.band}`))
      return { gated: sided.filter(result => !notMutable.includes(result)), reported: none, notMutable }
    }
    case 'x0.5': {
      const sized = results.filter(result => channelClass(result) !== 'modulation')
      return { gated: sized.filter(result => result.band !== 'slight'), reported: sized.filter(result => result.band === 'slight'), notMutable: none }
    }
    case 'x2':
      return { gated: results.filter(result => channelClass(result) !== 'modulation'), reported: none, notMutable: none }
    case 'release-tau-x3':
      return { gated: results.filter(result => channelClass(result) === 'face' || channelClass(result) === 'eyelid'), reported: none, notMutable: none }
    case 'blink-interval-1':
      return { gated: results.filter(result => result.channel === 'blinkRate'), reported: none, notMutable: none }
  }
}

/** Paired held-only attenuation; a positive, evaluable baseline is required, independent of its size verdict. */
export function sizeCalibration(mutated: CheckResult, baseline: CheckResult | undefined): KillState {
  if (!baseline || baseline.sizeRatio === null || baseline.sizeRatio <= 0 || mutated.sizeRatio === null)
    return null
  return mutated.sizeRatio / baseline.sizeRatio <= Math.SQRT1_2 ? 'killed' : 'survived'
}

function killSummary(checks: readonly CheckResult[], rule: KillRule | 'size-calibration', alpha: number, baseline: Map<string, CheckResult> | null) {
  let killed = 0
  let evaluable = 0
  let conditionalKilled = 0
  let conditionalTotal = 0
  const survivors: string[] = []
  const notEvaluable: string[] = []
  const baselineFailed: string[] = []
  for (const result of checks) {
    const reference = baseline?.get(result.key)
    const state = rule === 'size-calibration' ? sizeCalibration(result, reference) : killState(criterionOutcomes(result, alpha), rule)
    if (state === null) {
      notEvaluable.push(result.key)
      continue
    }
    evaluable++
    if (state === 'killed')
      killed++
    if (!reference)
      continue
    const referenceState = rule === 'size-calibration' ? sizeCalibration(reference, reference) : killState(criterionOutcomes(reference, alpha), rule)
    if (referenceState !== 'survived') {
      baselineFailed.push(result.key)
      continue
    }
    conditionalTotal++
    if (state === 'killed')
      conditionalKilled++
    else
      survivors.push(result.key)
  }
  return {
    checks: checks.length,
    evaluable,
    killed,
    unconditionalKillRate: ratio(killed, evaluable),
    conditionalChecks: baseline ? conditionalTotal : null,
    conditionalKilled: baseline ? conditionalKilled : null,
    killRate: baseline ? ratio(conditionalKilled, conditionalTotal) : null,
    survivors,
    notEvaluable,
    criterionFailedUnmutated: baselineFailed,
  }
}

/** Checkpoint-12 single-trial rules (`.omo/plans/natural-emotion-revamp.md:623-627`) on one emotion-free trial. */
function oldRulePass(record: EmotionTrialRecord): boolean | null {
  const held = naturalEmotions[record.emotion].held!
  const nominal = defaultExpressionPerformanceSettings.intensity[record.band]
  const rules: boolean[] = []
  const faceRule: [ScoredChannel, number][] = [['browMean', held.face.browY], ['browAngle', held.face.browAngle], ['eyeSmile', held.face.eyeSmile], ['mouthForm', held.face.mouthForm], ['cheek', held.face.cheek], ['mouthOpen', held.face.mouthOpen]]
  for (const [channel, recipe] of faceRule) {
    if (Math.abs(recipe) < 0.3)
      continue
    const value = record.channels[channel]?.value
    if (value === undefined)
      return null
    rules.push(Math.sign(recipe) * value >= 0.4 * Math.abs(recipe) * nominal)
  }
  const lidDrop = 1 - held.face.eyeOpenMultiplier
  if (Math.abs(lidDrop) >= 0.3) {
    const value = record.channels.eyelid?.value
    if (value === undefined)
      return null
    rules.push(Math.sign(lidDrop) * -value >= -Math.log(1 - 0.4 * Math.abs(lidDrop) * nominal))
  }
  if (record.band !== 'slight') {
    const axes: ScoredChannel[] = ['angleX', 'angleY', 'angleZ']
    held.posture.forEach((recipe, axis) => {
      if (recipe === 0)
        return
      const value = record.channels[axes[axis]]?.value
      rules.push(value !== undefined && Math.sign(recipe) * value > 0)
    })
  }
  return rules.length ? rules.every(Boolean) : null
}

export interface EvaluateContext {
  runDir: string
  plan: ValidationPlan
  gate: EmotionGate
  options: ValidationOptions
  fileSha: string
}

/** Every number, threshold, and verdict of the validation, from the run's partials. Contains no run id or time. */
export function evaluateValidation(context: EvaluateContext) {
  const { runDir, plan, gate, options } = context
  const alpha = gate.family.alpha
  const scoreOf = (experiment: string): EmotionGateScore | null => {
    const job = plan.jobs.find(entry => entry.experiment === experiment)
    return job ? readPartial<ValidationScorePartial>(runDir, scorePartialName(job), 'validation-score').score : null
  }
  const verdicts: Record<string, boolean | null> = {}
  const passing = (result: CheckResult) => {
    const outcomes = criterionOutcomes(result, alpha)
    return outcomes.significance === true || outcomes.visibility === true || result.verdict === 'pass'
  }

  let aa = null
  let oldRuleComparison = null
  if (options.sections.includes('aa')) {
    const sets = Array.from({ length: aaSetCount }, (_, set) => scoreOf(`aa-${set}`)!)
    const degenerate = (score: EmotionGateScore, channel: ScoredChannel) => !(score.nullStats[channel]?.sigma0 ?? 0)
    const perSet = sets.map((score, set) => ({ set, passingChecks: score.results.filter(passing).map(result => result.key) }))
    const hitRates = sets.flatMap(score => score.results.filter(result => result.hitRate !== null && !degenerate(score, result.channel)).map(result => result.hitRate!))
    const degenerateHitRates = sets.flatMap(score => score.results.filter(result => result.hitRate !== null && degenerate(score, result.channel)).map(result => result.hitRate!))
    const pValues = sets.flatMap((score) => {
      const distinct = new Map<string, number>()
      for (const result of score.results) {
        if (result.p === null || degenerate(score, result.channel))
          continue
        const key = `${result.channel}|${result.unsigned ? 'unsigned' : checksByKey.get(result.key)!.sign}`
        if (!distinct.has(key))
          distinct.set(key, result.p)
      }
      return [...distinct.values()]
    })
    const meanHitRate = hitRates.length ? hitRates.reduce((sum, value) => sum + value, 0) / hitRates.length : null
    const ks = pValues.length ? ksTestUniform(pValues) : null
    const setsWithAnyPass = perSet.filter(entry => entry.passingChecks.length > 0).length
    const t = validationThresholds.aa
    const zeroSpreadChannels = [...new Set(sets.flatMap(score => Object.entries(score.nullStats).filter(([, stats]) => !stats?.sigma0).map(([channel]) => channel)))].sort()
    aa = {
      sets: sets.length,
      seedsPerSet: plan.experiments.flatMap(entry => entry.kind === 'aa' ? [entry.seeds.count] : [])[0],
      setsWithAnyPass,
      maxSetsWithAnyPass: t.maxSetsWithAnyPass,
      perSet,
      placeboHitRate: { mean: meanHitRate, checks: hitRates.length, target: t.placeboHitRate, tolerance: t.placeboHitRateTolerance, min: hitRates.length ? Math.min(...hitRates) : null, max: hitRates.length ? Math.max(...hitRates) : null, withinTolerance: hitRates.filter(value => Math.abs(value - t.placeboHitRate) <= t.placeboHitRateTolerance).length },
      zeroSpreadChannels,
      zeroSpreadHitRate: { mean: degenerateHitRates.length ? degenerateHitRates.reduce((sum, value) => sum + value, 0) / degenerateHitRates.length : null, checks: degenerateHitRates.length },
      ks: ks && { ...ks, pAbove: t.ksPAbove },
      checksPerSet: sets[0]?.results.length ?? 0,
      verdict: setsWithAnyPass <= t.maxSetsWithAnyPass && meanHitRate !== null && Math.abs(meanHitRate - t.placeboHitRate) <= t.placeboHitRateTolerance + 1e-12 && ks !== null && ks.p > t.ksPAbove,
    }
    verdicts.aa = aa.verdict

    // Old rules on the same emotion-free trials, next to the new per-check false-positive rate.
    let oldPasses = 0
    let oldEvaluated = 0
    const oldPerCell = new Map<string, { passes: number, trials: number }>()
    plan.units.filter(unit => unit.kind === 'aa').forEach((unit) => {
      const templates = readPartial<ValidationRecordsPartial>(runDir, recordsPartialName(unit), 'validation-records').records
      for (const emotion of Object.keys(naturalEmotions) as (keyof typeof naturalEmotions)[]) {
        if (!naturalEmotions[emotion].held)
          continue
        for (const band of ['slight', 'clear', 'strong'] as const) {
          for (const template of templates) {
            const pass = oldRulePass({ ...template, emotion, band })
            if (pass === null)
              continue
            oldEvaluated++
            const cell = oldPerCell.get(`${emotion}:${band}`) ?? { passes: 0, trials: 0 }
            cell.trials++
            if (pass) {
              oldPasses++
              cell.passes++
            }
            oldPerCell.set(`${emotion}:${band}`, cell)
          }
        }
      }
    })
    const newChecks = sets.flatMap(score => score.results.filter(result => result.pHolm !== null || result.hitRate !== null))
    const newPassing = newChecks.filter(passing).length
    oldRuleComparison = {
      reference: '.omo/plans/natural-emotion-revamp.md:623-627',
      old: { unit: 'single emotion-free trial per emotion x band cell', evaluated: oldEvaluated, passes: oldPasses, falsePositiveRate: ratio(oldPasses, oldEvaluated), perCell: Object.fromEntries([...oldPerCell].map(([cell, tally]) => [cell, ratio(tally.passes, tally.trials)])) },
      new: { unit: 'check (significance or visibility) per A/A set', evaluated: newChecks.length, passes: newPassing, falsePositiveRate: ratio(newPassing, newChecks.length), setLevelRate: ratio(setsWithAnyPass, sets.length) },
    }
  }

  let zero = null
  if (options.sections.includes('zero')) {
    const score = scoreOf('zero')!
    const passingChecks = score.results.filter(passing).map(result => result.key)
    zero = { checks: score.results.length, passingChecks, maxPassingChecks: validationThresholds.zero.maxPassingChecks, verdict: passingChecks.length <= validationThresholds.zero.maxPassingChecks }
    verdicts.zero = zero.verdict
  }

  let unmutated = null
  if (options.sections.includes('unmutated')) {
    const sets = Array.from({ length: unmutatedSetCount }, (_, index) => ({ set: index + 1, score: scoreOf(`unmutated-${index + 1}`)! }))
    const perSet = sets.map(({ set, score }) => {
      const nonPassing = score.results.filter(result => result.verdict !== 'pass')
      return { set, checks: score.results.length, pass: score.results.length - nonPassing.length, passRate: ratio(score.results.length - nonPassing.length, score.results.length), nonPassing: nonPassing.map(result => ({ key: result.key, verdict: result.verdict, failed: result.failed })) }
    })
    const perCheck = new Map<string, { key: string, failSets: number[], naSets: number[], failed: CheckResult['failed'], trials: number }>()
    for (const { set, score } of sets) {
      for (const result of score.results) {
        const tally = perCheck.get(result.key) ?? { key: result.key, failSets: [], naSets: [], failed: [], trials: 0 }
        if (result.verdict === 'n/a')
          tally.naSets.push(set)
        else
          tally.trials++
        if (result.verdict === 'fail') {
          tally.failSets.push(set)
          tally.failed = [...new Set([...tally.failed, ...result.failed])]
        }
        perCheck.set(result.key, tally)
      }
    }
    const t = validationThresholds.unmutated
    const checks = [...perCheck.values()]
    const persistent = checks.filter(entry => entry.failSets.length >= t.persistentFailSets).map(({ key, failSets, failed }) => ({ key, failSets, failed }))
    const nonEvaluable = checks.filter(entry => entry.naSets.length > 0).map(({ key, naSets }) => ({ key, naSets }))
    const noise = checks.filter(entry => entry.failSets.length < t.persistentFailSets)
    const noiseFails = noise.reduce((sum, entry) => sum + entry.failSets.length, 0)
    const noiseTrials = noise.reduce((sum, entry) => sum + entry.trials, 0)
    const budget = binomialQuantile(noiseTrials, t.noiseBeta, t.noiseQuantile)
    unmutated = { perSet, persistent, nonEvaluable, noiseFails, noiseTrials, budget, verdict: persistent.length === 0 && noiseFails <= budget }
    verdicts.unmutated = unmutated.verdict
  }

  let mutations = null
  let ignoreSidePooled = null
  if (options.sections.includes('mutations')) {
    const baselineScore = options.sections.includes('unmutated') ? scoreOf(`unmutated-${mutationSeedSet}`) : null
    const baseline = baselineScore ? new Map(baselineScore.results.map(result => [result.key, result])) : null
    const sideChecks: CheckResult[] = []
    mutations = (Object.keys(validationThresholds.mutations) as MutationId[]).map((mutation) => {
      const score = scoreOf(`mutation-${mutation}`)!
      const rule = mutationRule[mutation]
      const identicalCells = new Set<string>()
      const sideMutation = mutation === 'ignore-side' || mutation === 'ignore-side-neg'
      if (sideMutation) {
        for (const unit of plan.units) {
          if (unit.kind !== 'cell' || unit.experiment !== `mutation-${mutation}`)
            continue
          const partial = readPartial<ValidationRecordsPartial>(runDir, recordsPartialName(unit), 'validation-records')
          if (new Set(partial.records.map(record => record.side)).size > 1)
            throw new Error(`[qa-tools] ignore-side cell ${unit.cell.emotion}:${unit.cell.band}:${unit.cell.variant} has mixed hold sides`)
          // The first-seed trace proves the equality for this cell only while its hold side stays fixed.
          if (partial.sideEquality?.identical === true)
            identicalCells.add(`${unit.cell.emotion}:${unit.cell.band}`)
        }
      }
      const targets = mutationTargets(mutation, score.results, identicalCells)
      if (sideMutation)
        sideChecks.push(...targets.gated)
      const calibrationRule = mutation === 'x0.5' ? 'size-calibration' : rule
      const gated = killSummary(targets.gated, calibrationRule, alpha, baseline)
      const reported = targets.reported.length ? killSummary(targets.reported, calibrationRule, alpha, baseline) : null
      const gateVerdict = mutation === 'x0.5' ? killSummary(targets.gated, rule, alpha, baseline) : null
      const minimum = validationThresholds.mutations[mutation].minKillRate
      const rate = mutation === 'x0.5' ? gated.killRate : gated.killRate ?? gated.unconditionalKillRate
      return {
        mutation,
        criterion: validationThresholds.mutations[mutation].criterion,
        minKillRate: minimum,
        ...gated,
        reportedOnly: reported,
        gateVerdictKillRate: gateVerdict ? gateVerdict.killRate ?? gateVerdict.unconditionalKillRate : null,
        reason: mutation === 'x0.5' && !baseline ? 'x0.5 calibration needs unmutated set 1' : null,
        notMutable: targets.notMutable.map(result => result.key),
        verdict: rate !== null && rate >= minimum,
      }
    })
    const pooled = killSummary(sideChecks, 'significance-or-sign', alpha, baseline)
    const minimum = validationThresholds.mutations['ignore-side'].minKillRate
    const rate = pooled.killRate ?? pooled.unconditionalKillRate
    ignoreSidePooled = { ...pooled, minKillRate: minimum, verdict: rate !== null && rate >= minimum }
    verdicts.mutations = mutations.every(entry => entry.mutation === 'ignore-side' || entry.mutation === 'ignore-side-neg' || entry.verdict) && ignoreSidePooled.verdict
  }

  let determinism = null
  if (options.sections.includes('determinism')) {
    const a = scoreOf('determinism-a')!
    const b = scoreOf('determinism-b')!
    const job = plan.jobs.find(entry => entry.experiment === 'determinism-a')!
    const recordOrderInvariant = readPartial<ValidationScorePartial>(runDir, scorePartialName(job), 'validation-score').recordOrderInvariant
    const eventOrder = plan.units.filter(unit => unit.kind === 'cell' && unit.checkEventOrder).map(unit => readPartial<ValidationRecordsPartial>(runDir, recordsPartialName(unit), 'validation-records').eventOrder!)
    const reportsIdentical = JSON.stringify(a) === JSON.stringify(b)
    determinism = {
      reportsIdentical,
      checks: a.results.length,
      eventOrderInvariant: eventOrder.every(entry => entry.invariant),
      eventOrderTrials: eventOrder.reduce((sum, entry) => sum + entry.trials, 0),
      recordOrderInvariant,
      verdict: reportsIdentical && eventOrder.every(entry => entry.invariant) && recordOrderInvariant === true,
    }
    verdicts.determinism = determinism.verdict
  }

  const thresholdsMet = Object.values(verdicts).every(value => value === true)
  return {
    task: '13',
    protocolVersion: 2,
    gate: { id: gate.id, version: gate.version, fileSha: context.fileSha, visibilityQuantile: gate.visibility.quantile, alpha },
    level: 't1',
    sections: [...options.sections],
    seedsLimit: options.seedsLimit,
    limitation: `${gate.limitation} Validation shows how often the scorer passes idle data and catches recipe mutations; it does not show naturalness.`,
    protocolNotes,
    thresholds: validationThresholds,
    aa,
    zero,
    mutations,
    ignoreSidePooled,
    unmutated,
    determinism,
    oldRuleComparison,
    verdicts,
    thresholdsMet,
  }
}

export type ValidationReport = ReturnType<typeof evaluateValidation>

const percent = (value: number | null | undefined) => value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`

/** Plain-text summary of `validation.json`. */
export function formatValidationSummary(report: ValidationReport): string {
  const lines = [`protocol ${report.protocolVersion}`, `scorer validation (${report.gate.id} v${report.gate.version}, ${report.level}${report.seedsLimit === null ? '' : `, seeds limited to ${report.seedsLimit}`}): ${report.thresholdsMet ? 'ALL THRESHOLDS MET' : 'THRESHOLDS NOT MET'}`]
  if (report.aa) {
    lines.push(`A/A: ${report.aa.verdict ? 'PASS' : 'FAIL'}; sets with any pass ${report.aa.setsWithAnyPass}/${report.aa.sets} (max ${report.aa.maxSetsWithAnyPass}); placebo hit rate ${report.aa.placeboHitRate.mean?.toFixed(4)} over ${report.aa.placeboHitRate.checks} checks (0.10 +- 0.03); KS p ${report.aa.ks?.p.toExponential(3)} (n ${report.aa.ks?.n}, D ${report.aa.ks?.d.toFixed(4)}; must be > 0.01)`)
    lines.push(`  zero-spread channels: ${report.aa.zeroSpreadChannels.join(', ') || 'none'} (hit rate ${report.aa.zeroSpreadHitRate.mean ?? 'n/a'} over ${report.aa.zeroSpreadHitRate.checks} checks)`)
  }
  if (report.oldRuleComparison)
    lines.push(`Old vs new false-positive rate: old single-trial rules ${percent(report.oldRuleComparison.old.falsePositiveRate)} (${report.oldRuleComparison.old.passes}/${report.oldRuleComparison.old.evaluated}); new per check ${percent(report.oldRuleComparison.new.falsePositiveRate)} (${report.oldRuleComparison.new.passes}/${report.oldRuleComparison.new.evaluated}), per set ${percent(report.oldRuleComparison.new.setLevelRate)}`)
  if (report.zero)
    lines.push(`Zero recipe (paired): ${report.zero.verdict ? 'PASS' : 'FAIL'}; ${report.zero.passingChecks.length} of ${report.zero.checks} checks pass${report.zero.passingChecks.length ? `: ${report.zero.passingChecks.join(', ')}` : ''}`)
  for (const entry of report.mutations ?? [])
    lines.push(`Mutation ${entry.mutation} (${entry.criterion}): ${entry.verdict ? 'PASS' : 'FAIL'}; kill rate ${percent(entry.killRate)} (${entry.conditionalKilled}/${entry.conditionalChecks}, min ${percent(entry.minKillRate)}), unconditional ${percent(entry.unconditionalKillRate)} (${entry.killed}/${entry.evaluable})${entry.reportedOnly ? `; slight ${percent(entry.reportedOnly.killRate)}` : ''}${entry.mutation === 'x0.5' ? `; gate-verdict size ${percent(entry.gateVerdictKillRate)} (reported only)` : ''}${entry.reason ? `; ${entry.reason}` : ''}${entry.survivors.length ? `; survivors: ${entry.survivors.join(', ')}` : ''}`)
  if (report.ignoreSidePooled) {
    const entry = report.ignoreSidePooled
    lines.push(`Mutation ignore-side pooled: ${entry.verdict ? 'PASS' : 'FAIL'}; kill rate ${percent(entry.killRate)} (${entry.conditionalKilled}/${entry.conditionalChecks}, min ${percent(entry.minKillRate)}), unconditional ${percent(entry.unconditionalKillRate)} (${entry.killed}/${entry.evaluable})`)
  }
  if (report.unmutated) {
    lines.push(`Unmutated: ${report.unmutated.verdict ? 'PASS' : 'FAIL'}; persistent findings ${report.unmutated.persistent.length}; noise fails ${report.unmutated.noiseFails} / budget ${report.unmutated.budget} over ${report.unmutated.noiseTrials}`)
    for (const entry of report.unmutated.persistent)
      lines.push(`  persistent ${entry.key}: fail sets ${entry.failSets.join(', ')}; failed ${entry.failed.join(', ')}`)
    for (const entry of report.unmutated.perSet)
      lines.push(`  set ${entry.set}: ${entry.pass}/${entry.checks} pass (${percent(entry.passRate)})`)
  }
  if (report.determinism)
    lines.push(`Determinism: ${report.determinism.verdict ? 'PASS' : 'FAIL'}; independent reports identical ${report.determinism.reportsIdentical}; event order invariant ${report.determinism.eventOrderInvariant} (${report.determinism.eventOrderTrials} trials); record order invariant ${report.determinism.recordOrderInvariant}`)
  lines.push(`Limitation: ${report.limitation}`)
  return `${lines.join('\n')}\n`
}
