import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsAnalytics = defineStore('settings-analytics', () => {
  // Off until the user turns it on. The key is not the earlier `settings/analytics/enabled`, whose stored `true`
  // was a default the user never chose; that value must not turn capture on in a build that enables analytics.
  const analyticsEnabled = useLocalStorageManualReset<boolean>('settings/analytics/opted-in', false)

  function resetState() {
    analyticsEnabled.reset()
  }

  return {
    analyticsEnabled,
    resetState,
  }
})
