import type { SettingsDocument } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import { sanitizeNaturalEmotionStrengths } from '@proj-airi/motion-driver-natural/emotion-strengths'
import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { clamp } from 'es-toolkit'
import { defineStore } from 'pinia'
import { boolean, finite, number, optional, pipe, transform, unknown } from 'valibot'

const mmdNaturalSettingsEntries = {
  /** Liveliness of Natural movement, from 0 (calm) to 1 (energetic), on the same scale as Live2D; out-of-range numbers are clamped. @default 0.5 */
  energy: optional(pipe(number(), finite(), transform(value => clamp(value, 0, 1))), 0.5),
  /** Count only strokes made with the primary button held as pets, so passing the cursor over the head never pets it. @default false */
  touchPetRequiresHold: optional(boolean(), false),
  /**
   * How strongly Natural performs each emotion, by stage model id, in the same shape and range as the Live2D setting.
   * Invalid entries are dropped and out-of-range ones clamped.
   */
  emotionStrength: optional(pipe(unknown(), transform(sanitizeNaturalEmotionStrengths)), {}),
}

export type MMDNaturalSettings = SettingsDocument<typeof mmdNaturalSettingsEntries>

/** The pre-document key of each setting; a setting added after the document has none. */
const legacyKeys = {
  energy: 'settings/mmd/natural-energy',
  touchPetRequiresHold: 'settings/mmd/natural-touch-pet-requires-hold',
  emotionStrength: 'settings/mmd/natural-emotion-strength',
} satisfies Partial<Record<keyof MMDNaturalSettings, string>>

// NOTICE:
// Profiles saved before the settings document keep each Natural setting under its own localStorage key.
// Root cause: those keys were plain refs that any window wrote; the document replaces them (tier 1 of
// docs/ai/adr/2026-11-01-persistence-tiers.md).
// Source: packages/stage-ui-mmd/src/stores/mmd.ts before the migration.
// Removal condition: one release after this lands. The first `update` or `reset` writes the document and deletes the
// keys, so a profile that changed any Natural setting since then no longer has them.
function readLegacyMMDNaturalSettings(): unknown {
  if (typeof localStorage === 'undefined')
    return undefined

  const document: Record<string, unknown> = {}
  for (const [field, key] of Object.entries(legacyKeys)) {
    const raw = localStorage.getItem(key)
    if (raw === null)
      continue
    try {
      // The old refs stored booleans and numbers as their string form and records as JSON, so JSON reads all of them.
      document[field] = JSON.parse(raw)
    }
    catch {
      // An unreadable key keeps its default.
    }
  }
  return document
}

function removeLegacyMMDNaturalSettings() {
  if (typeof localStorage === 'undefined')
    return
  for (const key of Object.values(legacyKeys))
    localStorage.removeItem(key)
  localStorage.removeItem('settings/mmd/natural-touch')
}

/**
 * Renderer realisation, replicated across windows with one leader persistence owner.
 * Read `document`; change it only through awaited `update` and `reset`.
 * The host initializes character behavior before its first write, preserving behavior values before this document narrows.
 */
export const useMMDNaturalSettings = defineStore('mmd-natural-settings', () => {
  const settings = useSettingsDocument('settings/mmd/natural', mmdNaturalSettingsEntries, {
    label: 'mmd-natural-settings',
    initial: readLegacyMMDNaturalSettings,
  })

  async function update(patch: Partial<MMDNaturalSettings>) {
    const result = await settings.update(patch)
    if (result.success)
      removeLegacyMMDNaturalSettings()
    return result
  }

  async function reset() {
    await settings.reset()
    removeLegacyMMDNaturalSettings()
  }

  return { document: settings.document, update, reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
