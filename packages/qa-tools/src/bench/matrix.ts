export class BenchUsageError extends Error {}

/** Names the scenario set in every `bench-run` record; changing what a scenario does bumps its `version`. */
export const BENCH_MATRIX = 'bench-v1'

export type BenchMeasure
  = | { readonly kind: 'idle', readonly seconds: number }
    | { readonly kind: 'talk', readonly turns: number, readonly script: string }

export interface BenchScenario {
  readonly id: 'mmd-idle' | 'mmd-talk' | 'live2d-idle'
  readonly version: number
  readonly model: { readonly kind: 'mmd' | 'live2d', readonly env: 'AIRI_QA_MMD_MODEL' | 'AIRI_QA_RIG_FORBOOTH' }
  /** Seconds between the model mount and the measurement; the measurement also waits out the rollup's settling. */
  readonly settleSeconds: number
  readonly measure: BenchMeasure
}

export type BenchScenarioId = BenchScenario['id']

/** Every scenario runs the window stage host, so the stage window is `stage-main`. */
export const BENCH_V1: readonly BenchScenario[] = [
  { id: 'mmd-idle', version: 1, model: { kind: 'mmd', env: 'AIRI_QA_MMD_MODEL' }, settleSeconds: 20, measure: { kind: 'idle', seconds: 120 } },
  // Measured from the first send to the speech end of the last turn.
  { id: 'mmd-talk', version: 1, model: { kind: 'mmd', env: 'AIRI_QA_MMD_MODEL' }, settleSeconds: 20, measure: { kind: 'talk', turns: 3, script: 'packages/qa-tools/fixtures/llm/turn-happy.json' } },
  { id: 'live2d-idle', version: 1, model: { kind: 'live2d', env: 'AIRI_QA_RIG_FORBOOTH' }, settleSeconds: 20, measure: { kind: 'idle', seconds: 120 } },
]

export function selectScenarios(id: string | undefined): BenchScenario[] {
  if (id === undefined)
    return [...BENCH_V1]
  const scenario = BENCH_V1.find(candidate => candidate.id === id)
  if (!scenario)
    throw new BenchUsageError(`--scenario must be one of ${BENCH_V1.map(candidate => candidate.id).join(', ')}, received "${id}"`)
  return [scenario]
}

export interface BenchLaunch {
  readonly scenario: BenchScenario
  /** 1-based run number of this scenario. */
  readonly run: number
}

/**
 * Round `r` runs every scenario once, and every other round runs them in reverse. A launch measures slower right
 * after another launch of the same process (todo 14's control: -1.38 fps for the second of a pair), so a fixed order
 * would bias the scenarios that always come later; alternating spreads that bias over all of them.
 */
export function planLaunches(scenarios: readonly BenchScenario[], runs: number): BenchLaunch[] {
  return Array.from({ length: runs }, (_, index) => {
    const round = scenarios.map(scenario => ({ scenario, run: index + 1 }))
    return index % 2 === 0 ? round : round.toReversed()
  }).flat()
}

/** Launch, onboarding, import, the rollup's 60 s session settling, and teardown, measured around 100 s per launch. */
const LAUNCH_OVERHEAD_SECONDS = 100
/** A turn-happy reply plays about 30 s of speech. */
const TALK_TURN_SECONDS = 35

/** A rough wall-clock estimate printed before the bench starts; waits for a calm host come on top. */
export function estimateSeconds(launches: readonly BenchLaunch[]): number {
  return launches.reduce((total, { scenario }) => {
    const { measure } = scenario
    const measured = measure.kind === 'idle' ? measure.seconds : measure.turns * TALK_TURN_SECONDS
    return total + LAUNCH_OVERHEAD_SECONDS + scenario.settleSeconds + measured
  }, 0)
}
