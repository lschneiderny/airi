import type { Band, CatalogEntry, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { EmotionGate, EmotionTrialRecord, PlaceboRecord, TrialVariant } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { LivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import type { LivelinessTrace, ParameterRanges } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/liveliness'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import { performance } from 'node:perf_hooks'

import { parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { buildEmotionTrial, buildIdleWithPlacebos, buildLongHold, stripEmotions } from '@proj-airi/stage-shared/motion-scenario'
import { measureEmotionTrial, measurePlacebos } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import catalogJson from '../../../fixtures/forbooth-catalog.json'

import { runT1 } from '../t1/runner'

const catalog = catalogJson as CatalogEntry[]

export type ScenarioRunner = (scenario: MotionScenario) => NaturalTrace
const runDefault: ScenarioRunner = scenario => runT1(scenario, { catalog })

/** Wall-clock bound of one simulated trial. The simulation is synchronous, so it is checked when the trial ends. */
const defaultTrialBoundMs = 300_000

function bounded<T>(label: string, boundMs: number, run: () => T): T {
  const started = performance.now()
  const result = run()
  const elapsed = performance.now() - started
  if (elapsed > boundMs)
    throw new Error(`[qa-tools] ${label} took ${Math.round(elapsed)} ms, above the per-trial bound ${boundMs} ms`)
  return result
}

export function trialBoundMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.QA_TRIAL_TIMEOUT_MS ?? defaultTrialBoundMs)
  return Number.isFinite(value) && value > 0 ? value : defaultTrialBoundMs
}

/** Settings the scenario runs with, so the scorer derives lifetimes and residue from what the run used. */
function scenarioSettings(scenario: MotionScenario) {
  const parsed = parseExpressionPerformanceSettings({ ...(scenario.settings?.performance as object | undefined), heldEmotions: scenario.settings?.heldEmotions ?? true })
  if (!parsed.success)
    throw new Error(`[qa-tools] Scenario ${scenario.id} has invalid performance settings`)
  return parsed.value
}

export interface EmotionTrialRun {
  emotion: PerformanceEmotion
  band: Band
  variant: TrialVariant
  seed: number
  gate: EmotionGate
  boundMs: number
}

/** One paired trial: the scenario with its emotion, and the same seed with the emotion stripped. */
export function runEmotionTrial({ emotion, band, variant, seed, gate, boundMs }: EmotionTrialRun, runScenario: ScenarioRunner = runDefault): EmotionTrialRecord {
  const { warmup, hold, post, longHoldSeconds, longHoldPost } = gate.scenario
  const scenario = variant === 'long-hold'
    ? buildLongHold({ emotion, band, seed, seconds: longHoldSeconds, warmup, post: longHoldPost })
    : buildEmotionTrial({ emotion, band, variant, seed, warmup, hold, post })
  const trialId = `${emotion}-${band}-${variant}-${seed}`
  return bounded(`trial ${trialId}`, boundMs, () => {
    const run = runScenario(scenario)
    const paired = runScenario(stripEmotions(scenario))
    return measureEmotionTrial(run, paired, { trialId, variant, gate, settings: scenarioSettings(scenario) })
  })
}

/** One emotion-free run with the gate's placebo marks, measured unpaired. */
export function runPlaceboSeed(seed: number, gate: EmotionGate, boundMs: number, runScenario: ScenarioRunner = runDefault): { records: PlaceboRecord[], ranges: ParameterRanges } {
  const scenario = buildIdleWithPlacebos({ seed, warmup: gate.scenario.warmup, placebos: gate.placeboPerNullRun, spacing: gate.scenario.placeboSpacing })
  return bounded(`placebo run ${seed}`, boundMs, () => {
    const trace = runScenario(scenario)
    return { records: measurePlacebos(trace, gate), ranges: trace.ranges }
  })
}

/** Keeps the scored part of an idle trace: samples from `warmUpSeconds` on, rebased to start at 0. */
export function trimWarmUp(trace: NaturalTrace, warmUpSeconds: number): LivelinessTrace & { ranges: ParameterRanges } {
  const first = trace.t.findIndex(t => t >= warmUpSeconds)
  if (first < 0)
    throw new Error(`[qa-tools] Idle trace ends at ${trace.t.at(-1)} s, before the warm-up of ${warmUpSeconds} s`)
  const origin = trace.t[first]
  return {
    t: trace.t.slice(first).map(t => t - origin),
    channels: Object.fromEntries(Object.entries(trace.channels).map(([id, values]) => [id, values.slice(first)])),
    ranges: trace.ranges,
  }
}

/** One idle desk run through the selected pipeline, warm-up dropped; the liveliness gate scores three of these. */
export function runIdleTrace(seed: number, gate: LivelinessGate, boundMs: number, runScenario: ScenarioRunner = runDefault): LivelinessTrace & { ranges: ParameterRanges } {
  const scenario: MotionScenario = {
    version: 1,
    id: `idle-liveliness-${seed}`,
    seed,
    durationSeconds: gate.warmUpSeconds + gate.scoredSeconds,
    home: 'desk',
    levels: ['t1', 't2', 't3'],
    events: [],
  }
  return bounded(`idle run ${seed}`, boundMs, () => trimWarmUp(runScenario(scenario), gate.warmUpSeconds))
}
