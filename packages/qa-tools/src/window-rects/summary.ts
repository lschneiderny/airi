import * as v from 'valibot'

const runSampleSchema = v.object({
  durationUs: v.number(),
  walked: v.number(),
  kept: v.number(),
  failures: v.number(),
  timedOut: v.boolean(),
})

/** What `globalThis.__airiWindowRectsSpike.measure()` returns from the stage-tamagotchi main process. */
export const windowRectsRunSchema = v.object({
  mode: v.picklist(['main', 'async', 'worker']),
  startedAt: v.string(),
  error: v.nullable(v.string()),
  backToBack: v.array(runSampleSchema),
  paced: v.array(runSampleSchema),
  loopDelay: v.object({ baselineP99Ms: v.number(), pacedP99Ms: v.number(), deltaMs: v.number() }),
})

export type WindowRectsRun = v.InferOutput<typeof windowRectsRunSchema>

/** The per-mode summary the plan fixes for `packages/qa-tools/fixtures/window-rects/task-6-<mode>-<setup>.json`. */
export interface WindowRectsSummary {
  mode: WindowRectsRun['mode']
  setup: string
  samples: number
  p50Us: number
  p95Us: number
  p99Us: number
  maxUs: number
  walkedMean: number
  keptMean: number
  failures: number
  loopDelayDeltaMs: number
}

/** Nearest-rank percentile of an ascending list; 0 for an empty list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0)
    return 0
  const rank = Math.ceil(p / 100 * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

const mean = (values: readonly number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

/**
 * Summarizes one mode on one setup over the back-to-back and the paced samples together.
 * A timed-out sample counts with the duration it was given up at, so a stuck strategy cannot look fast.
 */
export function summarizeWindowRectsRun(run: WindowRectsRun, setup: string): WindowRectsSummary {
  const samples = [...run.backToBack, ...run.paced]
  const durations = samples.map(sample => sample.durationUs).sort((a, b) => a - b)
  return {
    mode: run.mode,
    setup,
    samples: samples.length,
    p50Us: percentile(durations, 50),
    p95Us: percentile(durations, 95),
    p99Us: percentile(durations, 99),
    maxUs: durations.at(-1) ?? 0,
    walkedMean: mean(samples.map(sample => sample.walked)),
    keptMean: mean(samples.map(sample => sample.kept)),
    failures: samples.reduce((sum, sample) => sum + sample.failures, 0),
    loopDelayDeltaMs: run.loopDelay.deltaMs,
  }
}
