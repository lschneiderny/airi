import type { SettingsDocument } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import { sanitizeNaturalEmotionStrengths } from '@proj-airi/motion-driver-natural/emotion-strengths'
import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { clamp } from 'es-toolkit'
import { defineStore } from 'pinia'
import { boolean, finite, number, optional, pipe, record, string, transform, unknown } from 'valibot'

const live2dNaturalSettingsEntries = {
  /** How lively Natural motion is, from 0 (calm) to 1 (energetic); out-of-range numbers are clamped. @default 0.5 */
  energy: optional(pipe(number(), finite(), transform(value => clamp(value, 0, 1))), 0.5),
  /** Let Natural lean toward the middle of the screens. Chat attention belongs to character behavior. @default true */
  screenLean: optional(boolean(), true),
  /** Count only strokes made with the primary button held as pets, so passing the cursor over the head never pets it. @default false */
  touchPetRequiresHold: optional(boolean(), false),
  /** Size of the petting area relative to the measured head, by stage model id. A model without an entry uses 1, the measured head. */
  touchHeadScale: optional(record(string(), pipe(number(), finite())), {}),
  /**
   * How strongly Natural performs each emotion for a stage model, from 0 (that emotion is not performed) to 2.
   * Invalid entries are dropped and out-of-range ones clamped.
   */
  emotionStrength: optional(pipe(unknown(), transform(sanitizeNaturalEmotionStrengths)), {}),
}

export type Live2DNaturalSettings = SettingsDocument<typeof live2dNaturalSettingsEntries>

/** The pre-document key of each setting; a setting added after the document has none. */
const legacyKeys = {
  energy: 'settings/live2d/natural-energy',
  screenLean: 'settings/live2d/natural-screen-awareness',
  touchPetRequiresHold: 'settings/live2d/natural-touch-pet-requires-hold',
  touchHeadScale: 'settings/live2d/natural-touch-head-scale',
  emotionStrength: 'settings/live2d/natural-emotion-strength',
} satisfies Partial<Record<keyof Live2DNaturalSettings, string>>

// NOTICE:
// Profiles saved before the settings document keep each Natural setting under its own localStorage key.
// Root cause: those keys were plain refs that any window wrote; the document replaces them (tier 1 of
// docs/ai/adr/2026-11-01-persistence-tiers.md).
// Source: packages/stage-ui-live2d/src/composables/live2d/live2d.ts before the migration.
// Removal condition: one release after this lands. The first `update` or `reset` writes the document and deletes the
// keys, so a profile that changed any Natural setting since then no longer has them.
function readLegacyLive2DNaturalSettings(): unknown {
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

function removeLegacyLive2DNaturalSettings() {
  if (typeof localStorage === 'undefined')
    return
  for (const key of Object.values(legacyKeys))
    localStorage.removeItem(key)
  localStorage.removeItem('settings/live2d/natural-touch')
  localStorage.removeItem('settings/live2d/natural-cursor-attention')
}

// NOTICE:
// Preserve screen lean when reading the old combined switch.
// Root cause: screenAwareness owned both placement and chat before CM7c.
// Source: this document before CM7c.
// Removal condition: one release after CM7c, alongside the pre-document Natural import.
function upgradeScreenLean(stored: Record<string, unknown>) {
  return Object.hasOwn(stored, 'screenLean') ? stored : { ...stored, screenLean: stored.screenAwareness }
}

/**
 * Renderer realisation, replicated across windows with one leader persistence owner.
 * Read `document`; change it only through awaited `update` and `reset`.
 * The host initializes character behavior before its first write, preserving behavior values before this document narrows.
 */
export const useLive2DNaturalSettings = defineStore('live2d-natural-settings', () => {
  const settings = useSettingsDocument('settings/live2d/natural', live2dNaturalSettingsEntries, {
    label: 'live2d-natural-settings',
    initial: readLegacyLive2DNaturalSettings,
    upgrade: upgradeScreenLean,
  })

  async function update(patch: Partial<Live2DNaturalSettings>) {
    const result = await settings.update(patch)
    if (result.success)
      removeLegacyLive2DNaturalSettings()
    return result
  }

  async function reset() {
    await settings.reset()
    removeLegacyLive2DNaturalSettings()
  }

  return { document: settings.document, update, reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
