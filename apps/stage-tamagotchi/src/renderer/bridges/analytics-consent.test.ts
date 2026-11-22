// @vitest-environment jsdom

import { useSettingsAnalytics } from '@proj-airi/stage-ui/stores/settings/analytics'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { initializeAnalyticsConsent } from './analytics-consent'

const main = vi.hoisted(() => ({ setConsent: vi.fn(async (_enabled: boolean) => {}) }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => main.setConsent,
}))

const contexts: ReturnType<typeof createPinia>[] = []
function context() {
  const pinia = createPinia()
  const app = createApp({}).use(pinia)
  contexts.push(pinia)
  return { app, pinia }
}

afterEach(() => {
  contexts.splice(0).forEach(disposePinia)
  localStorage.clear()
  main.setConsent.mockReset()
})

it('mirrors consent on leader startup without loading an analytics SDK', async () => {
  localStorage.setItem('settings/analytics/opted-in', 'true')
  const { app, pinia } = context()
  await initializeAnalyticsConsent(app, pinia, true)
  expect(main.setConsent).toHaveBeenCalledExactlyOnceWith(true)
  await useSettingsAnalytics(pinia).reset()
  expect(main.setConsent).toHaveBeenLastCalledWith(false)
})

it('constructs followers without importing, saving, deleting, or mirroring', async () => {
  localStorage.setItem('settings/analytics/opted-in', 'true')
  const { app, pinia } = context()
  await initializeAnalyticsConsent(app, pinia, false)
  expect(useSettingsAnalytics(pinia).analyticsEnabled).toBe(true)
  expect(localStorage.getItem('settings/analytics')).toBeNull()
  expect(localStorage.getItem('settings/analytics/opted-in')).toBe('true')
  expect(main.setConsent).not.toHaveBeenCalled()
})

it('rejects startup when main rejects the mirror', async () => {
  main.setConsent.mockRejectedValueOnce(new Error('Main unavailable'))
  const { app, pinia } = context()
  await expect(initializeAnalyticsConsent(app, pinia, true)).rejects.toThrow('Main unavailable')
  expect(localStorage.getItem('settings/analytics')).toBe('{"optedIn":false}')
})
