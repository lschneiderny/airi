import type { ExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import type {} from 'pinia-plugin-synced'

import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { expressionPerformanceSettingsEntries } from '@proj-airi/stage-shared/expression-performance'
import { isPlainObject, mergeWith } from 'es-toolkit'
import { defineStore } from 'pinia'
import { toRaw } from 'vue'

type SettingsPatch<T> = { [K in keyof T]?: T[K] extends object ? SettingsPatch<T[K]> : T[K] }

function dropRemovedExpressionPerformanceFields(stored: Record<string, unknown>) {
  // NOTICE:
  // Stored documents still carry the removed energy keys.
  // Root cause: a strict schema plus whole-document persistence, so one unknown key resets every setting.
  // Source: packages/stage-shared/src/expression-performance/settings.ts.
  // Removal condition: one release after stored documents are rewritten without the keys.
  if (isPlainObject(stored.naturalBands)) {
    delete stored.naturalBands.energyAmplitude
    delete stored.naturalBands.energyRate
    delete stored.naturalBands.energySeconds
  }
  // NOTICE:
  // Stored documents still carry the slot keys that the hold and fade settings replaced.
  // Root cause: the same strict schema and whole-document persistence as above.
  // Source: packages/stage-shared/src/expression-performance/settings.ts (`slots`).
  // Removal condition: one release after stored documents are rewritten without the keys.
  if (isPlainObject(stored.slots)) {
    delete stored.slots.defaultFadeSeconds
    delete stored.slots.speechGrace
  }
  return stored
}

/** Replicates one settings document; only leader-routed commands persist changes. */
export const useExpressionPerformanceSettings = defineStore('expression-performance-settings', () => {
  const settings = useSettingsDocument('settings/expression-performance', expressionPerformanceSettingsEntries, {
    label: 'expression-performance',
    upgrade: dropRemovedExpressionPerformanceFields,
  })

  /** Merges the patch at every depth; arrays replace instead of merging into records. */
  async function update(patch: SettingsPatch<ExpressionPerformanceSettings>) {
    const merged = mergeWith(structuredClone(toRaw(settings.document.value)), patch, (_target, source) => {
      return Array.isArray(source) ? source : undefined
    })
    return settings.update(merged)
  }

  return { document: settings.document, update, reset: settings.reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
