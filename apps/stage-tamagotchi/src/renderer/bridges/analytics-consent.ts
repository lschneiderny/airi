import type { Pinia } from 'pinia'
import type { App } from 'vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { analyticsConsentMirrorKey, useSettingsAnalytics } from '@proj-airi/stage-ui/stores/settings/analytics'

import { electronErrorReportingSet } from '../../shared/eventa'

/**
 * Installs the host persistence boundary in every window; only leader-routed settings actions invoke it.
 * The synced action waits for leadership and the first acknowledged mirror. Followers construct a read projection only.
 */
export async function initializeAnalyticsConsent(app: App, pinia: Pinia, leader: boolean): Promise<void> {
  app.provide(analyticsConsentMirrorKey, useElectronEventaInvoke(electronErrorReportingSet))
  const settings = useSettingsAnalytics(pinia)
  if (leader)
    await settings.initialize()
}
