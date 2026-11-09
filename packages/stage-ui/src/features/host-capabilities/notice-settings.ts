import type {} from 'pinia-plugin-synced'
import type { InferOutput } from 'valibot'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { isPlainObject, uniq } from 'es-toolkit'
import { defineStore } from 'pinia'
import { array, check, parse, pipe, safeParse, strictObject, string, unknown } from 'valibot'
import { shallowRef, toRaw } from 'vue'

// Valibot objects accept arrays; the settings document must be a record.
const HostNoticeSettingsSchema = pipe(unknown(), check(isPlainObject, 'Expected a settings object'), strictObject({
  /** Presence notice keys (`presenceNoticeKey`) the user has already dismissed, one per host and set of limitations. */
  dismissedKeys: array(string()),
}))

export type HostNoticeSettings = InferOutput<typeof HostNoticeSettingsSchema>

export function defaultHostNoticeSettings(): HostNoticeSettings {
  return { dismissedKeys: [] }
}

/** localStorage is outside the app's control: anything but a valid document falls back to the defaults. */
function readStoredHostNoticeSettings(raw: string): HostNoticeSettings {
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  }
  catch {
    stored = undefined
  }
  const result = safeParse(HostNoticeSettingsSchema, stored)
  if (!result.success) {
    console.warn('[host-notice-settings] Stored settings are invalid; using defaults')
    return defaultHostNoticeSettings()
  }
  return result.output
}

/** Replicates which host notices the user dismissed; only leader-routed commands persist changes. */
export const useHostNoticeSettings = defineStore('host-notice-settings', () => {
  // Persistence is private: applying a remote snapshot never writes back into
  // synchronized state or persists an uncommitted follower proposal.
  const persisted = useLocalStorageManualReset<HostNoticeSettings>('settings/host-notice', defaultHostNoticeSettings, {
    listenToStorageChanges: false,
    writeDefaults: false,
    flush: 'sync',
    serializer: {
      read: readStoredHostNoticeSettings,
      write: value => JSON.stringify(value),
    },
  })
  const document = shallowRef(structuredClone(toRaw(persisted.value)))

  /** Idempotent: every window can observe the same snapshot and ask again. */
  async function dismiss(key: string) {
    const value = parse(HostNoticeSettingsSchema, { dismissedKeys: uniq([...document.value.dismissedKeys, key]) })
    document.value = value
    persisted.value = value
  }

  async function reset() {
    const value = defaultHostNoticeSettings()
    document.value = value
    persisted.value = value
  }

  return { document, dismiss, reset }
}, {
  synced: {
    state: true,
    actions: ['dismiss', 'reset'],
  },
})
