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
  /** Let Natural look at the cursor. @default true */
  cursorAttention: optional(boolean(), true),
  /** Let Natural lean toward the middle of the screens and glance at the chat. @default true */
  screenAwareness: optional(boolean(), true),
  /** Let the user poke the model and pet its head with the cursor while Natural drives it. @default true */
  touch: optional(boolean(), true),
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

const legacyKeys = {
  energy: 'settings/live2d/natural-energy',
  cursorAttention: 'settings/live2d/natural-cursor-attention',
  screenAwareness: 'settings/live2d/natural-screen-awareness',
  touch: 'settings/live2d/natural-touch',
  touchPetRequiresHold: 'settings/live2d/natural-touch-pet-requires-hold',
  touchHeadScale: 'settings/live2d/natural-touch-head-scale',
  emotionStrength: 'settings/live2d/natural-emotion-strength',
} satisfies Record<keyof Live2DNaturalSettings, string>

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
}

/**
 * The Natural settings of the Live2D renderer: one document that every window reads and only the leader persists.
 *
 * Read fields from `document`. Change them with `update`, awaited; never assign to `document`. The stage, the
 * settings panel, and the motion QA bridge all share this store.
 */
export const useLive2DNaturalSettings = defineStore('live2d-natural-settings', () => {
  const settings = useSettingsDocument('settings/live2d/natural', live2dNaturalSettingsEntries, {
    label: 'live2d-natural-settings',
    initial: readLegacyLive2DNaturalSettings,
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
