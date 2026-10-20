import type { CatalogEntry, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { ScenarioRunner } from '../src/motion/gate/trials'

import process from 'node:process'

import { beforeAll, describe, it } from 'vitest'

import catalogJson from '../fixtures/forbooth-catalog.json'

import { cellPartialName, emotionGateFor, livelinessGateFor, livelinessPartialName, nullPartialName, readSelection, seedRange, variantSeeds, variantsFor } from '../src/motion/gate/options'
import { requireRunDir, writePartial } from '../src/motion/gate/partials'
import { runEmotionTrial, runIdleTrace, runPlaceboSeed, trialBoundMs } from '../src/motion/gate/trials'
import { assignShards, buildValidationPlan, unitCost, validationSections } from '../src/motion/validation/plan'
import { runGenerationUnit, runScoringJob } from '../src/motion/validation/units'
import { loadT2Runtime, runT2 } from '../src/t2/runner'

const level = process.env.QA_LEVEL === 't2' ? 't2' : 't1'
const emotionGate = emotionGateFor(level)
const naturalIdleLivelinessGate = livelinessGateFor(level)
let runScenario: ScenarioRunner | undefined
beforeAll(async () => {
  if (level === 't2') {
    const runtime = await loadT2Runtime()
    runScenario = scenario => runT2(scenario, runtime, { catalog: catalogJson as CatalogEntry[] })
  }
}, 60_000)

/** One test per (band, variant) cell of `emotion`; each writes its trial records as one partial of the run. */
export function defineEmotionGate(emotion: PerformanceEmotion): void {
  const selection = readSelection(process.env)
  const runDir = requireRunDir()
  const boundMs = trialBoundMs(process.env)
  describe(`emotion gate: ${emotion}`, () => {
    for (const band of selection.bands) {
      for (const variant of variantsFor(band)) {
        it(`${band} ${variant}`, () => {
          const seeds = variantSeeds(emotionGate, variant, selection.seedsLimit)
          const records = Array.from({ length: seeds.count }, (_, index) => runEmotionTrial({ emotion, band, variant, seed: seeds.start + index, gate: emotionGate, boundMs }, runScenario))
          writePartial(runDir, cellPartialName(emotion, band, variant), { kind: 'emotion-cell', emotion, band, variant, seeds, records })
        })
      }
    }
  })
}

/** Emotion-free runs with placebo marks, one per full-variant seed: the idle noise the scorer measures effects against. */
export function defineNullGate(): void {
  const selection = readSelection(process.env)
  const runDir = requireRunDir()
  const boundMs = trialBoundMs(process.env)
  describe('emotion gate: idle placebo null', () => {
    it('measures placebo windows of emotion-free runs', () => {
      const seeds = seedRange(emotionGate.seeds.full, selection.seedsLimit)
      const runs = Array.from({ length: seeds.count }, (_, index) => runPlaceboSeed(seeds.start + index, emotionGate, boundMs, runScenario))
      writePartial(runDir, nullPartialName, { kind: 'null', seeds, ranges: runs[0].ranges, records: runs.flatMap(run => run.records) })
    })
  })
}

/**
 * One shard of the scorer validation (`motion validate-scorer`): the CLI starts one Vitest process per shard and
 * phase, and each defines a test per generation unit or scoring job it owns.
 */
export function defineValidationShard(): void {
  const runDir = requireRunDir()
  const boundMs = trialBoundMs(process.env)
  const phase = process.env.QA_VALIDATION_PHASE
  const shard = Number(process.env.QA_VALIDATION_SHARD)
  const shards = Number(process.env.QA_VALIDATION_SHARDS)
  const sections = (process.env.QA_VALIDATION_SECTIONS ?? '').split(',').filter(Boolean)
  const seedsLimit = process.env.QA_SEEDS ? Number(process.env.QA_SEEDS) : null
  if ((phase !== 'generate' && phase !== 'score') || !Number.isInteger(shard) || !Number.isInteger(shards) || shard < 0 || shard >= shards || !sections.length || sections.some(section => !validationSections.includes(section as typeof validationSections[number])))
    throw new Error('[qa-tools] The validation gate runs through "qa:motion validate-scorer"; its shard variables are not set or invalid.')
  const plan = buildValidationPlan(emotionGate, { sections: sections as typeof validationSections[number][], seedsLimit })
  describe(`scorer validation: ${phase} shard ${shard + 1}/${shards}`, () => {
    if (phase === 'generate') {
      for (const unit of assignShards(plan.units, shards, entry => unitCost(entry, emotionGate))[shard])
        it(unit.name, () => runGenerationUnit(unit, plan, emotionGate, runDir, boundMs))
    }
    else {
      // Scoring cost grows with the experiment's trial count, which the number of its units tracks.
      const cost = (experiment: string) => plan.units.filter(unit => unit.kind !== 'null' && unit.experiment === experiment).reduce((sum, unit) => sum + unitCost(unit, emotionGate), 0)
      for (const job of assignShards(plan.jobs, shards, entry => cost(entry.experiment))[shard])
        it(job.name, () => runScoringJob(job, plan, emotionGate, runDir))
    }
  })
}

/** The idle liveliness gate's three desk traces, warm-up dropped. */
export function defineLivelinessGate(): void {
  const runDir = requireRunDir()
  const boundMs = Math.max(trialBoundMs(process.env), 900_000)
  describe('liveliness gate: idle traces', () => {
    for (const seed of naturalIdleLivelinessGate.seeds) {
      it(`seed ${seed}`, () => {
        writePartial(runDir, livelinessPartialName(seed), { kind: 'liveliness-trace', seed, trace: runIdleTrace(seed, naturalIdleLivelinessGate, boundMs, runScenario) })
      })
    }
  })
}
