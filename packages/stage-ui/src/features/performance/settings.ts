import type { ExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import type {} from 'pinia-plugin-synced'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { isPlainObject, mergeWith } from 'es-toolkit'
import { defineStore } from 'pinia'
import { ValiError } from 'valibot'
import { shallowRef, toRaw } from 'vue'

type SettingsPatch<T> = { [K in keyof T]?: T[K] extends object ? SettingsPatch<T[K]> : T[K] }

/** Replicates one settings document; only leader-routed commands persist changes. */
export const useExpressionPerformanceSettings = defineStore('expression-performance-settings', () => {
  // Persistence is private: applying a remote snapshot never writes back into
  // synchronized state or persists an uncommitted follower proposal.
  const persisted = useLocalStorageManualReset<ExpressionPerformanceSettings>(
    'settings/expression-performance',
    () => parseExpressionPerformanceSettings({}).value,
    {
      listenToStorageChanges: false,
      writeDefaults: false,
      flush: 'sync',
      serializer: {
        read(value) {
          try {
            const stored: unknown = JSON.parse(value)
            // NOTICE:
            // Stored documents still carry the removed energy keys.
            // Root cause: a strict schema plus whole-document persistence, so one unknown key resets every setting.
            // Source: packages/stage-shared/src/expression-performance/settings.ts.
            // Removal condition: one release after stored documents are rewritten without the keys.
            if (isPlainObject(stored) && isPlainObject(stored.naturalBands)) {
              delete stored.naturalBands.energyAmplitude
              delete stored.naturalBands.energyRate
              delete stored.naturalBands.energySeconds
            }
            const result = parseExpressionPerformanceSettings(stored)
            if (!result.success)
              throw new ValiError(result.issues)
            return result.value
          }
          catch (error) {
            console.warn('[expression-performance] Invalid stored settings:', errorMessageFrom(error))
            return parseExpressionPerformanceSettings({}).value
          }
        },
        write: value => JSON.stringify(value),
      },
    },
  )
  const document = shallowRef(structuredClone(toRaw(persisted.value)))

  async function update(patch: SettingsPatch<ExpressionPerformanceSettings>) {
    const candidate = isPlainObject(patch)
      ? mergeWith(structuredClone(toRaw(document.value)), patch, (_target, source) => {
          // Arrays must reach the schema unchanged, not merge into records.
          return Array.isArray(source) ? source : undefined
        })
      : patch
    const result = parseExpressionPerformanceSettings(candidate)
    if (!result.success)
      return { success: false as const, issues: result.issues }

    document.value = result.value
    persisted.value = result.value
    return { success: true as const }
  }

  async function reset() {
    const value = parseExpressionPerformanceSettings({}).value
    document.value = value
    persisted.value = value
  }

  return { document, update, reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
