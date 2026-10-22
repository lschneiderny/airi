import type { CheckResult, EmotionTrialRecord } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { ValidationOptions } from './plan'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { naturalEmotions } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotions'
import { buildEmotionChecks, emotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { afterEach, describe, expect, it } from 'vitest'

import { writePartial } from '../gate/partials'
import { parseValidateArgs } from './cli'
import { binomialQuantile, evaluateValidation, formatValidationSummary, killState, sizeCalibration } from './evaluate'
import { aaSetCount, assignShards, buildValidationPlan, emotionTableFor, validationSections } from './plan'
import { recordsPartialName, scorePartialName } from './units'

const temporaryRuns: string[] = []
afterEach(() => {
  for (const run of temporaryRuns.splice(0))
    rmSync(run, { recursive: true, force: true })
})

function checkResult(overrides: Partial<CheckResult> = {}): CheckResult {
  const check = buildEmotionChecks().find(check => check.emotion === 'awkward' && check.band === 'clear' && check.sided && check.channel !== 'browAsym')!
  return { key: check.key, emotion: check.emotion, band: check.band, channel: check.channel, unsigned: false, n: 10, rejected: 0, E: 1, ci: [1, 1], d: 1, hits: 10, hitRate: 1, p: 0, pHolm: 0, expected: 1, sizeRatio: 1, verdict: 'pass', failed: [], reasons: [], ...overrides }
}

function syntheticRun(sections: ValidationOptions['sections']) {
  const options = { sections, seedsLimit: 2 }
  const plan = buildValidationPlan(emotionGate, options)
  const runDir = mkdtempSync(join(tmpdir(), 'scorer-validation-'))
  temporaryRuns.push(runDir)
  const score = (experiment: string, results: CheckResult[]) => {
    const job = plan.jobs.find(job => job.experiment === experiment)!
    writePartial(runDir, scorePartialName(job), { kind: 'validation-score', job: job.name, score: { gate: { id: emotionGate.id, version: emotionGate.version }, limitation: '', nullStats: {}, results, pass: results.every(result => result.verdict === 'pass') }, recordOrderInvariant: null })
  }
  for (const job of plan.jobs)
    score(job.experiment, [])
  const sideCell = (experiment: string, identical: boolean, sides: EmotionTrialRecord['side'][] = [1, 1]) => {
    const unit = plan.units.find(unit => unit.kind === 'cell' && unit.experiment === experiment && unit.cell.emotion === 'awkward' && unit.cell.band === 'clear')!
    const records: EmotionTrialRecord[] = sides.map((side, index) => ({ trialId: `synthetic-${index}`, emotion: 'awkward', band: 'clear', variant: 'full', side, rejected: null, releaseStart: 4, faceResidue: 0, channels: {}, missing: {} }))
    writePartial(runDir, recordsPartialName(unit), { kind: 'validation-records', unit: unit.name, records, placebos: [], ranges: null, eventOrder: null, sideEquality: { seed: 1001, identical } })
  }
  for (const unit of plan.units) {
    if (unit.kind === 'cell' && (unit.experiment === 'mutation-ignore-side' || unit.experiment === 'mutation-ignore-side-neg'))
      writePartial(runDir, recordsPartialName(unit), { kind: 'validation-records', unit: unit.name, records: [], placebos: [], ranges: null, eventOrder: null, sideEquality: null })
  }
  return { score, sideCell, evaluate: () => evaluateValidation({ runDir, plan, gate: emotionGate, options, fileSha: 'synthetic' }) }
}

describe('parseValidateArgs', () => {
  it('defaults to every section and the committed seed counts', () => {
    expect(parseValidateArgs(['--level', 't1'])).toEqual({ ok: true, command: { options: { sections: [...validationSections], seedsLimit: null }, workers: null, timeoutMinutes: 180 } })
  })

  it.each([
    [['--level', 't2'], 'Valid levels: t1'],
    [[], '--level is required'],
    [['--level', 't1', '--sections', 'aa,nope'], 'Valid sections'],
    [['--level', 't1', '--seeds', '0'], '--seeds'],
    [['--level', 't1', 'extra'], 'extra'],
  ])('rejects %j', (args, message) => {
    const result = parseValidateArgs(args)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain(message)
  })
})

describe('validation plan', () => {
  it('includes held-only cells for x0 without changing sign-flip cells', () => {
    const plan = buildValidationPlan(emotionGate, { sections: ['mutations'], seedsLimit: null })
    const variants = (id: string) => plan.experiments.flatMap(experiment => experiment.kind === 'gate' && experiment.id === id ? experiment.cells.map(cell => cell.variant) : [])
    expect(variants('mutation-x0')).toContain('held-only')
    expect(variants('mutation-sign-flip')).not.toContain('held-only')
  })

  it('builds 20 disjoint A/A seed sets against the committed null seeds', () => {
    const plan = buildValidationPlan(emotionGate, { sections: ['aa'], seedsLimit: null })
    const sets = plan.experiments.flatMap(experiment => experiment.kind === 'aa' ? [experiment.seeds] : [])
    expect(sets).toHaveLength(aaSetCount)
    expect(new Set(sets.map(range => range.start)).size).toBe(aaSetCount)
    expect(sets.every(range => range.count === emotionGate.seeds.full.count && range.start > emotionGate.seeds.full.start + emotionGate.seeds.full.count)).toBe(true)
    expect(plan.nullPools['null-committed']).toEqual(emotionGate.seeds.full)
  })

  it('assigns every unit to exactly one shard', () => {
    const plan = buildValidationPlan(emotionGate, { sections: [...validationSections], seedsLimit: 2 })
    const shards = assignShards(plan.units, 7, unit => unit.seeds.count)
    expect(shards.flat().map(unit => unit.name).sort()).toEqual(plan.units.map(unit => unit.name).sort())
    expect(new Set(plan.units.map(unit => unit.name)).size).toBe(plan.units.length)
  })
})

describe('mutation tables', () => {
  it('negates exactly the formerly sided posture axes and clears their side dependence', () => {
    const original = naturalEmotions.awkward.held!
    const mutated = emotionTableFor('ignore-side-neg').awkward.held!
    expect(mutated.posture).toEqual(([0, 1, 2] as const).map(axis => original.sided.includes(axis) ? -original.posture[axis] : original.posture[axis]))
    expect(mutated.sided).toEqual([])
    expect(mutated.face).toEqual(original.face)
    expect(mutated.modulation).toEqual(original.modulation)
    const plan = buildValidationPlan(emotionGate, { sections: ['mutations'], seedsLimit: null })
    const cells = (id: string) => plan.experiments.flatMap(experiment => experiment.kind === 'gate' && experiment.id === id ? experiment.cells : [])
    expect(cells('mutation-ignore-side-neg')).toEqual(cells('mutation-ignore-side'))
  })

  it('zeroes every held recipe and impulse in the zero table without touching the committed table', () => {
    const zero = emotionTableFor('zero')
    expect(buildEmotionChecks(zero)).toEqual([])
    expect(Object.values(zero).every(spec => spec.impulse === undefined && spec.mood.every(value => value === 0))).toBe(true)
    expect(naturalEmotions.angry.held?.face.browY).toBe(-0.7)
  })

  it('flips, scales, and unsides held recipes through the table seam', () => {
    expect(emotionTableFor('sign-flip').angry.held?.face.browY).toBe(0.7)
    expect(emotionTableFor('sign-flip').sad.held?.modulation.blinkInterval).toBeCloseTo(1 / 1.3, 12)
    expect(emotionTableFor('x0.5').sleepy.held?.face.eyeOpenMultiplier).toBeCloseTo(0.725, 12)
    expect(emotionTableFor('x2').happy.held?.posture).toEqual([0, 0.2, 0.12])
    expect(emotionTableFor('ignore-side').think.held?.sided).toEqual([])
    expect(emotionTableFor('blink-interval-1').surprised.held?.modulation.blinkInterval).toBe(1)
    expect(buildEmotionChecks(emotionTableFor('x0'))).toEqual([])
  })
})

describe('ignore-side evaluation', () => {
  it('excludes trace-identical cells and pools only mutable checks from both variants', () => {
    const run = syntheticRun(['mutations', 'unmutated'])
    const baseline = checkResult()
    run.score('unmutated-1', [baseline])
    run.score('mutation-ignore-side', [baseline])
    run.score('mutation-ignore-side-neg', [checkResult({ E: -1, failed: ['sign'], verdict: 'fail' })])
    run.sideCell('mutation-ignore-side', true)
    run.sideCell('mutation-ignore-side-neg', false)
    const report = run.evaluate()
    const unchanged = report.mutations!.find(entry => entry.mutation === 'ignore-side')!
    expect(unchanged.notMutable).toEqual([baseline.key])
    expect(unchanged.checks).toBe(0)
    expect(report.ignoreSidePooled).toMatchObject({ checks: 1, conditionalChecks: 1, killed: 1, killRate: 1, verdict: true })
    const summary = formatValidationSummary(report)
    expect(summary).toContain('Mutation ignore-side (')
    expect(summary).toContain('Mutation ignore-side-neg (')
    expect(summary).toContain('Mutation ignore-side pooled:')
  })

  it('refuses a cell with mixed hold sides even when its first trace is identical', () => {
    const run = syntheticRun(['mutations'])
    run.sideCell('mutation-ignore-side', true, [1, -1])
    expect(() => run.evaluate()).toThrow('[qa-tools] ignore-side cell awkward:clear:full has mixed hold sides')
  })
})

describe('killState', () => {
  const outcomes = { significance: true, sign: true, visibility: true, size: true, release: true }
  it('kills a detected zeroed recipe on held-only size and preserves unevaluable size', () => {
    expect(killState({ ...outcomes, size: false, release: null }, 'detection-or-size')).toBe('killed')
    expect(killState({ ...outcomes, size: null, release: null }, 'detection-or-size')).toBe('survived')
  })
  it('kills on a failed detection criterion and leaves unevaluable checks out', () => {
    expect(killState({ ...outcomes, visibility: false }, 'detection')).toBe('killed')
    expect(killState({ ...outcomes, visibility: null }, 'detection')).toBe('survived')
    expect(killState({ ...outcomes, significance: null, visibility: null }, 'detection')).toBeNull()
    expect(killState({ ...outcomes, sign: false }, 'significance-or-sign')).toBe('killed')
    expect(killState({ ...outcomes, size: null }, 'size')).toBeNull()
  })
})

describe('size calibration', () => {
  it.each([
    [0.5, 1, 'killed'],
    [0.8, 1, 'survived'],
    [Math.SQRT1_2, 1, 'killed'],
    [0.5, 0, null],
    [null, 1, null],
    [0.5, null, null],
  ] as const)('calibrates size ratio %s against %s as %s', (mutated, baseline, expected) => {
    expect(sizeCalibration(checkResult({ sizeRatio: mutated }), checkResult({ sizeRatio: baseline }))).toBe(expected)
  })

  it('requires the paired baseline', () => {
    expect(sizeCalibration(checkResult({ sizeRatio: 0.5 }), undefined)).toBeNull()
    const run = syntheticRun(['mutations'])
    run.score('mutation-x0.5', [checkResult({ sizeRatio: 0.5 })])
    const report = run.evaluate()
    expect(report.mutations!.find(entry => entry.mutation === 'x0.5')).toMatchObject({ killRate: null, verdict: false, reason: 'x0.5 calibration needs unmutated set 1' })
    expect(() => formatValidationSummary(report)).not.toThrow()
  })

  it('gates clear and strong calibration while reporting the inclusive gate verdict and slight checks', () => {
    const run = syntheticRun(['mutations', 'unmutated'])
    const clear = checkResult()
    const strongCheck = buildEmotionChecks().find(check => check.emotion === clear.emotion && check.channel === clear.channel && check.band === 'strong')!
    const slightCheck = buildEmotionChecks().find(check => check.emotion === clear.emotion && check.channel === clear.channel && check.band === 'slight')!
    const strong = checkResult({ key: strongCheck.key, band: 'strong', sizeRatio: 2, verdict: 'fail', failed: ['size'] })
    const slight = checkResult({ key: slightCheck.key, band: 'slight' })
    run.score('unmutated-1', [clear, strong, slight])
    run.score('mutation-x0.5', [{ ...clear, sizeRatio: 0.5 }, { ...strong, sizeRatio: 1, verdict: 'pass', failed: [] }, slight])
    const report = run.evaluate()
    expect(report.mutations!.find(entry => entry.mutation === 'x0.5')).toMatchObject({ checks: 2, killRate: 1, gateVerdictKillRate: 0, verdict: true, reportedOnly: { checks: 1, killRate: 0 } })
    expect(() => formatValidationSummary(report)).not.toThrow()
  })
})

describe('unmutated noise budget', () => {
  it('matches an independent plain binomial cumulative sum', () => {
    const n = 1685
    const p = 0.01
    let mass = (1 - p) ** n
    let cumulative = mass
    let expected = 0
    while (cumulative < 0.99) {
      expected++
      mass *= (n - expected + 1) / expected * p / (1 - p)
      cumulative += mass
    }
    expect(binomialQuantile(n, p, 0.99)).toBe(expected)
    expect(expected).toBeGreaterThanOrEqual(24)
    expect(expected).toBeLessThanOrEqual(30)
  })

  it('handles empty and degenerate binomial distributions', () => {
    expect(binomialQuantile(0, 0.01, 0.99)).toBe(0)
    expect(binomialQuantile(5, 0, 0.99)).toBe(0)
    expect(binomialQuantile(5, 1, 0.99)).toBe(5)
    expect(binomialQuantile(5, 0.01, 0)).toBe(0)
    expect(binomialQuantile(5, 0.01, 1)).toBe(5)
  })

  it('reports a four-of-five failure as persistent and excludes it from noise', () => {
    const run = syntheticRun(['unmutated'])
    const result = checkResult()
    for (let set = 1; set <= 5; set++)
      run.score(`unmutated-${set}`, [set <= 4 ? { ...result, verdict: 'fail', failed: ['visibility'] } : result])
    const report = run.evaluate()
    expect(report.unmutated).toMatchObject({ persistent: [{ key: result.key, failSets: [1, 2, 3, 4], failed: ['visibility'] }], noiseFails: 0, noiseTrials: 0, budget: 0, verdict: false })
    expect(report.unmutated!.perSet[0].nonPassing).toEqual([{ key: result.key, verdict: 'fail', failed: ['visibility'] }])
    expect(() => formatValidationSummary(report)).not.toThrow()
  })

  it('reports all n/a sets separately without spending the noise budget', () => {
    const run = syntheticRun(['unmutated'])
    const result = checkResult({ verdict: 'n/a', sizeRatio: null, pHolm: null, hitRate: null })
    for (let set = 1; set <= 5; set++)
      run.score(`unmutated-${set}`, [result])
    expect(run.evaluate().unmutated).toMatchObject({ persistent: [], nonEvaluable: [{ key: result.key, naSets: [1, 2, 3, 4, 5] }], noiseFails: 0, noiseTrials: 0, budget: 0, verdict: true })
  })

  it.each([[2, true], [3, false]] as const)('counts %s nonpersistent failures against the fixed noise budget', (failSets, verdict) => {
    const run = syntheticRun(['unmutated'])
    const results = buildEmotionChecks().slice(0, 5).map(check => checkResult({ key: check.key, emotion: check.emotion, band: check.band, channel: check.channel }))
    for (let set = 1; set <= 5; set++)
      run.score(`unmutated-${set}`, results.map((result, index) => index === 0 && set <= failSets ? { ...result, verdict: 'fail', failed: ['sign'] } : result))
    expect(run.evaluate().unmutated).toMatchObject({ persistent: [], noiseFails: failSets, noiseTrials: 25, budget: 2, verdict })
  })
})
