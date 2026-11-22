import en from '@proj-airi/i18n/locales/en'

import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { useCharacterBehaviorSettings } from '@proj-airi/stage-ui/stores/settings'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import PresencePage from './index.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const key = 'settings/situation'
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

describe('presence settings page', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
  })

  afterEach(() => {
    cleanup()
    disposePinia(pinia)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  async function renderPage() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
    const screen = await render(PresencePage, { global: { plugins: [pinia, i18n(), router] } })
    return { screen, settings: useSituationSettings(pinia) }
  }

  it('persists speaking choices in the behavior document', async () => {
    const behavior = useCharacterBehaviorSettings(pinia)
    await behavior.update({ speaking: { chattiness: 0.55 } })
    expect(behavior.document.speaking.chattiness).toBe(0.55)
    expect(JSON.parse(localStorage.getItem('settings/character-behavior')!).speaking.chattiness).toBe(0.55)
    await behavior.update({ speaking: { dontDisturb: true } })
    expect(behavior.document.speaking.dontDisturb).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings/character-behavior')!)).toEqual(behavior.document)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('turns foreground sharing off and on, and persists it', async () => {
    const { screen, settings } = await renderPage()
    expect(t('settings.pages.presence.share-foreground-window.title')).not.toBe('settings.pages.presence.share-foreground-window.title')
    const sharing = screen.getByRole('switch', { name: t('settings.pages.presence.share-foreground-window.title') })
    await expect.element(sharing).toBeChecked()

    await sharing.click()
    await expect.element(sharing).not.toBeChecked()
    expect(settings.document.shareForegroundWindow).toBe(false)
    expect(JSON.parse(localStorage.getItem(key)!).shareForegroundWindow).toBe(false)

    await sharing.click()
    await expect.element(sharing).toBeChecked()
    expect(JSON.parse(localStorage.getItem(key)!).shareForegroundWindow).toBe(true)
  })

  it('turns browser sharing off and on, and persists it', async () => {
    const { screen, settings } = await renderPage()
    expect(t('settings.pages.presence.share-browser-activity.title')).not.toBe('settings.pages.presence.share-browser-activity.title')
    const sharing = screen.getByRole('switch', { name: t('settings.pages.presence.share-browser-activity.title') })
    await expect.element(sharing).toBeChecked()

    await sharing.click()
    await expect.element(sharing).not.toBeChecked()
    expect(settings.document.shareBrowserActivity).toBe(false)
    expect(JSON.parse(localStorage.getItem(key)!).shareBrowserActivity).toBe(false)
    // The two sharing switches are independent.
    expect(settings.document.shareForegroundWindow).toBe(true)

    await sharing.click()
    await expect.element(sharing).toBeChecked()
    expect(JSON.parse(localStorage.getItem(key)!).shareBrowserActivity).toBe(true)
  })

  it('normalizes quiet apps without changing the sensor block list', async () => {
    const behavior = useCharacterBehaviorSettings(pinia)
    const sensors = useSituationSettings(pinia)
    await sensors.update({ blockedApps: ['private-app'] })
    await behavior.update({ speaking: { quietApps: ['zoom.exe', '', '  notepad.exe  ', 'notepad.exe'] } })
    expect(behavior.document.speaking.quietApps).toEqual(['zoom.exe', 'notepad.exe'])
    expect(JSON.parse(localStorage.getItem('settings/character-behavior')!).speaking.quietApps).toEqual(behavior.document.speaking.quietApps)
    expect(sensors.document.blockedApps).toEqual(['private-app'])
  })

  it('imports valid speaking fields while an invalid chattiness uses its default', () => {
    localStorage.setItem(key, JSON.stringify({ chattiness: 'banana', quietApps: ['notepad.exe'] }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error')
    const behavior = useCharacterBehaviorSettings(pinia)
    expect(behavior.document.speaking.chattiness).toBe(0.5)
    expect(behavior.document.speaking.quietApps).toEqual(['notepad.exe'])
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('fits a narrow window without horizontal overflow', async () => {
    await page.viewport(360, 720)
    const { screen } = await renderPage()
    await expect.element(screen.getByRole('switch', { name: t('settings.pages.presence.share-foreground-window.title') })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360)
  })
})
