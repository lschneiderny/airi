import type { InferOutput } from 'valibot'

import type { CatalogEntry } from './catalog'
import type { ExpressionPerformanceSettings } from './settings'

import { finite, looseObject, maxValue, minValue, number, optional, pipe, record, string } from 'valibot'

/** Card-owned multipliers. Omitted members have identity 1. Unknown fields survive imports. */
export const PerformanceProfileSchema = looseObject({
  expressiveness: optional(pipe(number(), finite(), minValue(0.5), maxValue(1.5))),
  moodGainScale: optional(pipe(number(), finite(), minValue(0), maxValue(2))),
  moodDecayScale: optional(pipe(number(), finite(), minValue(0.5), maxValue(2))),
  mappingWeights: optional(record(string(), record(string(), pipe(number(), finite(), minValue(0), maxValue(5))))),
})

export type PerformanceProfile = InferOutput<typeof PerformanceProfileSchema>

/** Returns a copy; profiles never mutate the shared settings document. */
export function resolveEffectiveSettings(settings: ExpressionPerformanceSettings, profile?: PerformanceProfile): { settings: ExpressionPerformanceSettings, expressiveness: number } {
  const gain = profile?.moodGainScale ?? 1
  const decay = profile?.moodDecayScale ?? 1
  const mood = settings.moodDynamics
  return {
    expressiveness: profile?.expressiveness ?? 1,
    settings: {
      ...settings,
      moodDynamics: {
        ...mood,
        slightGain: mood.slightGain * gain,
        clearGain: mood.clearGain * gain,
        strongGain: mood.strongGain * gain,
        valenceTau: mood.valenceTau * decay,
        arousalTau: mood.arousalTau * decay,
        tensionTau: mood.tensionTau * decay,
      },
    },
  }
}

/** Weights are keyed by stable model and expression ids; zero disables mappings, not manual access. */
export function applyMappingWeights(catalog: readonly CatalogEntry[], modelId: string, profile?: PerformanceProfile): CatalogEntry[] {
  return catalog.map((entry) => {
    const multiplier = profile?.mappingWeights?.[modelId]?.[entry.id] ?? 1
    return {
      ...entry,
      mappings: multiplier === 0 ? [] : entry.mappings.map(mapping => ({ ...mapping, weight: mapping.weight * multiplier })),
    }
  })
}
