import type {} from 'pinia-plugin-synced'
import type { InjectionKey } from 'vue'

import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { boolean, optional } from 'valibot'
import { computed, hasInjectionContext, inject } from 'vue'

/** The host's acknowledged copy for reporting before the renderer starts. Only leader-routed commands call it. */
export const analyticsConsentMirrorKey: InjectionKey<(optedIn: boolean) => Promise<void>> = Symbol('analytics-consent-mirror')

const documentKey = 'settings/analytics'
const legacyKeys = { optedIn: 'settings/analytics/opted-in', enabled: 'settings/analytics/enabled' }

// NOTICE:
// Existing fork profiles store consent as a plain boolean, without a leader persistence owner.
// Import only explicit opted-in consent; upstream's enabled=true was a default, never consent.
// Source: packages/stage-ui/src/stores/settings/analytics.ts before S2.
// Removal condition: no supported release writes settings/analytics/opted-in or settings/analytics/enabled.
function readLegacyConsent() {
  if (typeof localStorage === 'undefined')
    return {}
  if (localStorage.getItem(documentKey) !== null)
    return {}
  return { optedIn: localStorage.getItem('settings/analytics/opted-in') === 'true' }
}

function removeLegacyConsent() {
  if (typeof localStorage === 'undefined')
    return
  for (const key of Object.values(legacyKeys))
    localStorage.removeItem(key)
}

export const useSettingsAnalytics = defineStore('settings-analytics', () => {
  const mirror = hasInjectionContext() ? inject(analyticsConsentMirrorKey, undefined) : undefined
  const settings = useSettingsDocument(documentKey, { optedIn: optional(boolean(), false) }, {
    label: 'settings-analytics',
    initial: readLegacyConsent,
  })
  const analyticsEnabled = computed(() => settings.document.value.optedIn)

  async function update(patch: { optedIn?: boolean }) {
    const result = await settings.update(patch)
    if (result.success) {
      removeLegacyConsent()
      await mirror?.(settings.document.value.optedIn)
    }
    return result
  }

  /** Called once by the host after leadership is established, whether or not an SDK is available. */
  async function initialize() {
    await update({})
  }

  async function reset() {
    await settings.reset()
    removeLegacyConsent()
    await mirror?.(false)
  }

  return { document: settings.document, analyticsEnabled, initialize, update, reset }
}, {
  synced: { state: true, actions: ['initialize', 'update', 'reset'] },
})
