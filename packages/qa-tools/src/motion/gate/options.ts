import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { EmotionGate, SeedRange, TrialVariant } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { LivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { emotionGate, naturalIdleLivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

export type GateLevel = 't1' | 't2' | 't3'

/** T2 uses the task-14 trial budget, without changing the scoring rules. T3 uses the windows only (`naturalEmotionT3Gate` sets its trials). */
export function emotionGateFor(level: GateLevel): EmotionGate {
  return level === 't2' ? { ...emotionGate, seeds: { ...emotionGate.seeds, full: { start: 1, count: 30 }, heldOnly: { start: 1, count: 30 } } } : emotionGate
}

/** T2's three runs are 600 simulated seconds each, including the unchanged warm-up; T3's three captures are 600 s each, scored the same way. */
export function livelinessGateFor(level: GateLevel): LivelinessGate {
  return level === 't1' ? naturalIdleLivelinessGate : { ...naturalIdleLivelinessGate, scoredSeconds: 600 - naturalIdleLivelinessGate.warmUpSeconds }
}

/** Non-neutral emotions, in the order the gate files and reports list them. Each has a held recipe the scorer checks. */
export const gateEmotions = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy'] as const satisfies readonly PerformanceEmotion[]
export const gateBands = ['slight', 'clear', 'strong'] as const satisfies readonly Band[]
/** Slow modulation needs a settled hold, so the long-hold variant runs for these bands only (same rule as `buildEmotionChecks`). */
export const longHoldBands: readonly Band[] = ['clear', 'strong']

export interface GateSelection {
  emotions: readonly PerformanceEmotion[]
  bands: readonly Band[]
  /** Upper bound on seeds per variant (`--seeds N`); `null` runs the committed counts. */
  seedsLimit: number | null
}

export function variantsFor(band: Band): TrialVariant[] {
  return longHoldBands.includes(band) ? ['full', 'held-only', 'long-hold'] : ['full', 'held-only']
}

/** The committed seed range, cut to the first `limit` seeds when a limit is set. */
export function seedRange(range: SeedRange, limit: number | null): SeedRange {
  return { start: range.start, count: limit === null ? range.count : Math.min(range.count, limit) }
}

export function variantSeeds(gate: EmotionGate, variant: TrialVariant, limit: number | null): SeedRange {
  return seedRange(variant === 'full' ? gate.seeds.full : variant === 'held-only' ? gate.seeds.heldOnly : gate.seeds.longHold, limit)
}

/** Partial file name of one emotion cell. */
export const cellPartialName = (emotion: PerformanceEmotion, band: Band, variant: TrialVariant) => `emotion-${emotion}-${band}-${variant}.json`
export const nullPartialName = 'null.json'
export const livelinessPartialName = (seed: number) => `liveliness-trace-${seed}.json`

/** Every partial a complete run of the selection must have written; a missing one fails the run. */
export function expectedEmotionPartials(selection: GateSelection): string[] {
  return [
    nullPartialName,
    ...selection.emotions.flatMap(emotion => selection.bands.flatMap(band => variantsFor(band).map(variant => cellPartialName(emotion, band, variant)))),
  ]
}

/** Parses the gate selection the CLI passes to gate files; every value was validated by the CLI. */
export function readSelection(env: NodeJS.ProcessEnv): GateSelection {
  const emotions = (env.QA_EMOTIONS ?? '').split(',').filter(Boolean) as PerformanceEmotion[]
  const bands = (env.QA_BANDS ?? '').split(',').filter(Boolean) as Band[]
  const limit = env.QA_SEEDS ? Number(env.QA_SEEDS) : null
  if (!emotions.length || !bands.length || (limit !== null && (!Number.isInteger(limit) || !(limit > 0))))
    throw new Error('[qa-tools] Gate files run through "qa:motion gate"; QA_EMOTIONS, QA_BANDS and QA_SEEDS are not set or invalid.')
  return { emotions, bands, seedsLimit: limit }
}
