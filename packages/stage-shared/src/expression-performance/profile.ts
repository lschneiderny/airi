import type { InferOutput } from 'valibot'

import type { CatalogEntry } from './catalog'
import type { ExpressionPerformanceSettings, NumberRange } from './settings'

import { finite, looseObject, maxValue, minValue, number, optional, pipe, record, string } from 'valibot'

import { createCatalogEntrySchema, mappingWeightRange } from './catalog'
import { createExpressionPerformanceSettingsSchema, moodGainRange, moodTauRange, scaleFinite, scaleRange } from './settings'

const moodGainScaleRange: NumberRange = [0, 2]
const moodDecayScaleRange: NumberRange = [0.5, 2]
const mappingWeightScaleRange: NumberRange = [0, 5]
const within = ([min, max]: NumberRange) => pipe(number(), finite(), minValue(min), maxValue(max))

/** Card-owned multipliers. Omitted members have identity 1. Unknown fields survive imports. */
export const PerformanceProfileSchema = looseObject({
  expressiveness: optional(pipe(number(), finite(), minValue(0.5), maxValue(1.5))),
  moodGainScale: optional(within(moodGainScaleRange)),
  moodDecayScale: optional(within(moodDecayScaleRange)),
  mappingWeights: optional(record(string(), record(string(), within(mappingWeightScaleRange)))),
})

export type PerformanceProfile = InferOutput<typeof PerformanceProfileSchema>

/**
 * Validates settings after `resolveEffectiveSettings`, such as recorded decider contexts. The mood gain and decay
 * bounds are the persisted bounds scaled by the profile ranges with `scaleFinite`: gains [0, 2] and taus
 * [0, Number.MAX_VALUE]. Every other bound matches the persisted schema.
 */
export const EffectiveExpressionPerformanceSettingsSchema = createExpressionPerformanceSettingsSchema({
  gain: scaleRange(moodGainRange, moodGainScaleRange),
  tau: scaleRange(moodTauRange, moodDecayScaleRange),
})

/**
 * Validates catalog entries after `applyMappingWeights`. Weights are the persisted weights scaled by the multiplier
 * range with `scaleFinite`, [0, Number.MAX_VALUE]. A positive product that underflows to 0 is recorded as 0, and
 * selection skips it like a mapping disabled by a 0 multiplier.
 */
export const EffectiveCatalogEntrySchema = createCatalogEntrySchema(scaleRange(mappingWeightRange, mappingWeightScaleRange))

/** Returns a copy; profiles never mutate the shared settings document. Scaled values stay finite (see `scaleFinite`). */
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
        slightGain: scaleFinite(mood.slightGain, gain),
        clearGain: scaleFinite(mood.clearGain, gain),
        strongGain: scaleFinite(mood.strongGain, gain),
        valenceTau: scaleFinite(mood.valenceTau, decay),
        arousalTau: scaleFinite(mood.arousalTau, decay),
        tensionTau: scaleFinite(mood.tensionTau, decay),
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
      mappings: multiplier === 0 ? [] : entry.mappings.map(mapping => ({ ...mapping, weight: scaleFinite(mapping.weight, multiplier) })),
    }
  })
}
