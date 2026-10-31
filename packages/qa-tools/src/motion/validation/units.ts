import type { EmotionGate, EmotionTrialRecord, PlaceboRecord } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import type { ValidationRecordsPartial, ValidationScorePartial } from '../gate/partials'
import type { Experiment, GenerationUnit, ScoringJob, ValidationPlan } from './plan'

import { isDeepStrictEqual } from 'node:util'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { measureEmotionTrial, naturalFaceResidue, scoreEmotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { gateBands, gateEmotions } from '../gate/options'
import { readPartial, writePartial } from '../gate/partials'
import { runEmotionFreeTrial, runEmotionTrialTraces, runPlaceboSeed } from '../gate/trials'
import { emotionTableFor } from './plan'

export const recordsPartialName = (unit: GenerationUnit) => `validation/records/${unit.name}.json`
export const scorePartialName = (job: ScoringJob) => `validation/scores/${job.name}.json`

function seeds(range: { start: number, count: number }) {
  return Array.from({ length: range.count }, (_, index) => range.start + index)
}

/** Seeded Fisher-Yates copy, so the event-order check is itself reproducible. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const random = createRandomStream(seed)
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const pick = Math.floor(random() * (index + 1))
    const value = result[index]
    result[index] = result[pick]
    result[pick] = value
  }
  return result
}

function experimentOf(plan: ValidationPlan, id: string): Experiment {
  const experiment = plan.experiments.find(entry => entry.id === id)
  if (!experiment)
    throw new Error(`[qa-tools] The validation plan has no experiment ${id}`)
  return experiment
}

/** Simulates one generation unit and writes its records as one partial. */
export function runGenerationUnit(unit: GenerationUnit, plan: ValidationPlan, gate: EmotionGate, runDir: string, boundMs: number): void {
  const partial: ValidationRecordsPartial = { kind: 'validation-records', unit: unit.name, records: [], placebos: [], ranges: null, eventOrder: null, sideEquality: null }
  if (unit.kind === 'null') {
    for (const seed of seeds(unit.seeds)) {
      const run = runPlaceboSeed(seed, gate, boundMs)
      partial.placebos.push(...run.records)
      partial.ranges = run.ranges
    }
  }
  else if (unit.kind === 'aa') {
    // Emotion-free runs relabeled as if the trial's emotion had played; the scoring job expands them to every cell.
    for (const seed of seeds(unit.seeds)) {
      const { trace, settings, trialId } = runEmotionFreeTrial(seed, gate, boundMs)
      const asEmotion: NaturalTrace = {
        ...trace,
        events: trace.events.map(entry => entry.source === 'scenario' && entry.event.kind === 'noop'
          ? { ...entry, event: { kind: 'emotion' as const, at: entry.event.at, emotion: 'happy' as const, band: 'clear' as const, source: 'devtools' as const, trialId } }
          : entry),
      }
      partial.records.push(measureEmotionTrial(asEmotion, null, { trialId, variant: 'full', gate, settings }))
    }
  }
  else {
    const experiment = experimentOf(plan, unit.experiment)
    if (experiment.kind !== 'gate')
      throw new Error(`[qa-tools] Unit ${unit.name} belongs to the non-gate experiment ${experiment.id}`)
    const emotionTable = emotionTableFor(experiment.table)
    let invariant = true
    for (const seed of seeds(unit.seeds)) {
      const traces = runEmotionTrialTraces({ ...unit.cell, seed, gate, boundMs, emotionTable, held: experiment.held ?? undefined })
      if (seed === unit.seeds.start && (unit.experiment === 'mutation-ignore-side' || unit.experiment === 'mutation-ignore-side-neg')) {
        const unmutated = runEmotionTrialTraces({ ...unit.cell, seed, gate, boundMs, emotionTable: emotionTableFor('natural'), held: experiment.held ?? undefined })
        partial.sideEquality = { seed, identical: isDeepStrictEqual(traces.run, unmutated.run) }
      }
      const options = { trialId: traces.trialId, variant: unit.cell.variant, gate, settings: traces.settings }
      const record = measureEmotionTrial(traces.run, traces.paired, options)
      partial.records.push(record)
      if (unit.checkEventOrder) {
        const reordered = measureEmotionTrial({ ...traces.run, events: shuffled(traces.run.events, seed) }, { ...traces.paired, events: [...traces.paired.events].reverse() }, options)
        invariant &&= isDeepStrictEqual(reordered, record)
      }
    }
    if (unit.checkEventOrder)
      partial.eventOrder = { trials: unit.seeds.count, invariant }
  }
  writePartial(runDir, recordsPartialName(unit), partial)
}

/** A/A: the emotion-free template records as trials of every emotion and band (side unknown, so sided checks fold). */
function expandAaRecords(templates: readonly EmotionTrialRecord[]): EmotionTrialRecord[] {
  return gateEmotions.flatMap(emotion => gateBands.flatMap(band => templates.map(template => ({
    ...template,
    trialId: `${emotion}-${band}-full-${template.trialId.split('-').at(-1)}`,
    emotion,
    band,
    faceResidue: naturalFaceResidue(defaultExpressionPerformanceSettings, band),
  }))))
}

/** Scores one experiment with the committed gate and checks, and writes the score as one partial. */
export function runScoringJob(job: ScoringJob, plan: ValidationPlan, gate: EmotionGate, runDir: string): void {
  const experiment = experimentOf(plan, job.experiment)
  const read = (unit: GenerationUnit) => readPartial<ValidationRecordsPartial>(runDir, recordsPartialName(unit), 'validation-records')
  const nullUnits = plan.units.filter(unit => unit.kind === 'null' && unit.pool === experiment.nullPool).map(read)
  const placebos: PlaceboRecord[] = nullUnits.flatMap(partial => partial.placebos)
  const ranges = nullUnits.find(partial => partial.ranges !== null)?.ranges
  if (!ranges)
    throw new Error(`[qa-tools] Null pool ${experiment.nullPool} has no parameter ranges`)
  const records = plan.units.filter(unit => unit.kind !== 'null' && unit.experiment === experiment.id).flatMap(unit => read(unit).records)
  const trials = experiment.kind === 'aa' ? expandAaRecords(records) : records
  const cells = experiment.kind === 'aa' ? null : experiment.cells
  const checks = buildEmotionChecks().filter(check => !cells || cells.some(cell => cell.emotion === check.emotion && cell.band === check.band))
  const score = scoreEmotionGate({ gate, checks, trials, placebos, ranges })
  const recordOrderInvariant = job.checkRecordOrder
    ? JSON.stringify(scoreEmotionGate({ gate, checks: [...checks].reverse(), trials: [...trials].reverse(), placebos: [...placebos].reverse(), ranges })) === JSON.stringify(score)
    : null
  const partial: ValidationScorePartial = { kind: 'validation-score', job: job.name, score, recordOrderInvariant }
  writePartial(runDir, scorePartialName(job), partial)
}
