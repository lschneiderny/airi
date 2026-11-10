import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

/** How strongly Natural performs each emotion for one model. A missing emotion means 1; 0 turns it off. */
export type NaturalEmotionStrengths = Partial<Record<PerformanceEmotion, number>>

/** {@link NaturalEmotionStrengths} by stage model id. A missing model performs every emotion at 1. */
export type NaturalEmotionStrengthsByModel = Record<string, NaturalEmotionStrengths>

/** The upper bound of a strength; `NaturalMotion.setEmotionStrengths` clamps to the same range. */
export const naturalEmotionStrengthMax = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Keeps the valid part of per-model strengths that came from outside the app. An entry that is not a finite number is
 * dropped, an out-of-range one is clamped, and a model left without entries is dropped with it. Anything but a record
 * gives `{}`.
 */
export function sanitizeNaturalEmotionStrengths(stored: unknown): NaturalEmotionStrengthsByModel {
  if (!isRecord(stored))
    return {}

  const strengths: NaturalEmotionStrengthsByModel = {}
  for (const [modelId, entry] of Object.entries(stored)) {
    if (!isRecord(entry))
      continue
    const values = Object.entries(entry)
      .flatMap(([emotion, value]) => typeof value === 'number' && Number.isFinite(value) ? [[emotion, Math.min(Math.max(value, 0), naturalEmotionStrengthMax)] as const] : [])
    if (values.length > 0)
      strengths[modelId] = Object.fromEntries(values)
  }
  return strengths
}
