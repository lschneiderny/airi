import type { SettingsDocument } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { uniq } from 'es-toolkit'
import { defineStore } from 'pinia'
import { array, optional, parse, strictObject, string } from 'valibot'

const hostNoticeSettingsEntries = {
  /** Presence notice keys (`presenceNoticeKey`) the user has already dismissed, one per host and set of limitations. */
  dismissedKeys: optional(array(string()), () => []),
}

export type HostNoticeSettings = SettingsDocument<typeof hostNoticeSettingsEntries>

export function defaultHostNoticeSettings(): HostNoticeSettings {
  return parse(strictObject(hostNoticeSettingsEntries), {})
}

/** Replicates which host notices the user dismissed; only leader-routed commands persist changes. */
export const useHostNoticeSettings = defineStore('host-notice-settings', () => {
  const settings = useSettingsDocument('settings/host-notice', hostNoticeSettingsEntries, { label: 'host-notice-settings' })

  /** Idempotent: every window can observe the same snapshot and ask again. */
  async function dismiss(key: string) {
    await settings.update({ dismissedKeys: uniq([...settings.document.value.dismissedKeys, key]) })
  }

  return { document: settings.document, dismiss, reset: settings.reset }
}, {
  synced: {
    state: true,
    actions: ['dismiss', 'reset'],
  },
})
