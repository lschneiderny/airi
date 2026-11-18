import type { FeatureFlag } from '../libs/feature-flags'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { parse } from 'valibot'
import { computed } from 'vue'

import { featureFlagPreferencesSchema, featureFlagVariantPreferencesSchema, offeredFeatureFlags, resolveFeatureFlag, resolveFeatureVariant } from '../libs/feature-flags'

/**
 * Owns the device preferences for experiments.
 *
 * This fork runs account-free clients, so no account and no server policy exist. A `cloud` feature therefore
 * resolves as unavailable, and only `local` features can be chosen.
 */
export const useFeatureFlagsStore = defineStore('feature-flags', () => {
  const offered = offeredFeatureFlags(isStageTamagotchi())
  const preferences = useLocalStorageManualReset<Record<string, boolean>>('settings/feature-flags', {}, {
    serializer: {
      read: value => parse(featureFlagPreferencesSchema, JSON.parse(value)),
      write: value => JSON.stringify(value),
    },
  })
  /** The variant that the user chose for each feature that has variants. It is a device choice. */
  const variantPreferences = useLocalStorageManualReset<Record<string, string>>('settings/feature-flag-variants', {}, {
    serializer: {
      read: value => parse(featureFlagVariantPreferencesSchema, JSON.parse(value)),
      write: value => JSON.stringify(value),
    },
  })

  // The second element is the account of a cloud feature upstream. It stays `null` here, which keeps the keys of
  // local features identical to upstream's.
  function preferenceKey(feature: FeatureFlag) {
    return JSON.stringify([feature.key, null])
  }

  function decision(feature: FeatureFlag) {
    return resolveFeatureFlag(feature, preferences.value[preferenceKey(feature)], undefined, false)
  }

  /** The variant of a feature: the saved one while the feature still offers it, otherwise the first one. */
  function variantOf(key: string): string | undefined {
    return resolveFeatureVariant(offered.find(feature => feature.key === key), variantPreferences.value[key])
  }

  /** Saves the variant of a feature. A value that the feature does not offer changes nothing. */
  function setVariant(key: string, value: string | undefined) {
    const options = offered.find(feature => feature.key === key)?.variants?.options
    if (!value || !options?.some(option => option.value === value) || variantPreferences.value[key] === value)
      return
    variantPreferences.value = { ...variantPreferences.value, [key]: value }
  }

  const features = computed(() => offered.map(feature => ({
    ...feature,
    ...decision(feature),
    preference: preferences.value[preferenceKey(feature)],
    variant: variantOf(feature.key),
  })).filter(feature => feature.selectable))

  function setPreference(key: string, value: boolean | undefined) {
    const feature = offered.find(feature => feature.key === key)
    if (!feature || !decision(feature).selectable)
      return
    const storageKey = preferenceKey(feature)
    if (preferences.value[storageKey] === value)
      return

    const next = { ...preferences.value }
    if (value === undefined)
      delete next[storageKey]
    else
      next[storageKey] = value
    preferences.value = next
  }

  /** Unknown features, and features that this app does not offer, stay disabled. */
  function isEnabled(key: string): boolean {
    const feature = offered.find(feature => feature.key === key)
    if (!feature)
      return false

    return decision(feature).enabled
  }

  return { features, setPreference, isEnabled, variantOf, setVariant }
})
