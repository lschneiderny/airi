import type { LeadershipMode } from '@proj-airi/stage-ui/libs/pinia'
import type { App } from 'vue'

import { useMMDPerformanceSettings } from '@proj-airi/stage-ui-mmd/stores'
import { piniaPluginTracing, setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { startErrorReporting } from '@proj-airi/stage-ui/libs/product-signals'
import { useSettingsAnalytics } from '@proj-airi/stage-ui/stores/settings/analytics'
import { createPinia } from 'pinia'

import { initializeAnalyticsConsent } from './bridges/analytics-consent'

/**
 * Owns renderer election, store registration, and acknowledged settings initialization. Configure is synchronous.
 * There is no await before mount: App setup must register all action owners before election can expose the API.
 */
export async function mountRenderer(app: App, leadership: LeadershipMode, configure: () => void, target: Parameters<App['mount']>[0]): Promise<void> {
  const pinia = createPinia()
  const synced = setupSynced({ leadership })
  pinia.use(synced.pinia)
  if (import.meta.env.DEV)
    pinia.use(piniaPluginTracing)
  app.use(synced.vue).use(pinia)
  const ready = [initializeAnalyticsConsent(app, pinia, leadership === 'leader-only')]
  const mmdPerformance = useMMDPerformanceSettings(pinia)
  if (leadership === 'leader-only')
    ready.push(mmdPerformance.initialize())
  if (import.meta.env.AIRI_ERROR_REPORT_DSN) {
    startErrorReporting(app, () => useSettingsAnalytics(pinia).analyticsEnabled, async (options) => {
      const { createSentryAdapter } = await import('./modules/sentry')
      return createSentryAdapter(options)
    })
  }
  configure()
  app.mount(target)
  await Promise.all(ready)
}
