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
 * Reads stored per-model strengths. Every renderer's settings store persists them in this shape. localStorage is
 * outside the app's control, so a stored entry that is not a finite number is dropped, an out-of-range one is clamped,
 * and a model left without entries is dropped with it.
 */
export function parseNaturalEmotionStrengths(raw: string): NaturalEmotionStrengthsByModel {
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  }
  catch {
    return {}
  }
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
