import en from '@proj-airi/i18n/locales/en'

import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

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
    const screen = await render(PresencePage, { global: { plugins: [pinia, i18n()] } })
    return { screen, settings: useSituationSettings(pinia) }
  }

  it('moves chattiness with the slider and persists one settings document', async () => {
    const { screen, settings } = await renderPage()
    // A missing locale entry renders the key, which the role query would still match.
    expect(t('settings.pages.presence.chattiness.title')).not.toBe('settings.pages.presence.chattiness.title')
    const chattiness = screen.getByRole('slider', { name: t('settings.pages.presence.chattiness.title') })
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()

    await chattiness.click()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(screen.getByText('55%', { exact: true })).toBeVisible()
    expect(settings.document.chattiness).toBe(0.55)
    expect(JSON.parse(localStorage.getItem(key)!).chattiness).toBe(0.55)

    await screen.getByRole('switch', { name: t('settings.pages.presence.dont-disturb.title') }).click()
    expect(settings.document.dontDisturb).toBe(true)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(settings.document)
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

  it('commits a quiet app list on change and shows the normalized entries', async () => {
    const { screen, settings } = await renderPage()
    const quietApps = screen.getByRole('textbox', { name: t('settings.pages.presence.quiet-apps.title') })
    await expect.element(quietApps).toHaveValue('zoom.exe\nms-teams.exe\nteams.exe\nwebex*.exe')

    await quietApps.click()
    await userEvent.keyboard('{Control>}{End}{/Control}{Enter}{Enter}  notepad.exe  ')
    // Typing alone stays a local draft until the field loses focus.
    expect(settings.document.quietApps).not.toContain('notepad.exe')
    await userEvent.tab()

    await expect.element(quietApps).toHaveValue('zoom.exe\nms-teams.exe\nteams.exe\nwebex*.exe\nnotepad.exe')
    expect(settings.document.quietApps).toEqual(['zoom.exe', 'ms-teams.exe', 'teams.exe', 'webex*.exe', 'notepad.exe'])
    expect(JSON.parse(localStorage.getItem(key)!).quietApps).toEqual(settings.document.quietApps)
  })

  it('shows the default chattiness when the stored value is invalid', async () => {
    localStorage.setItem(key, JSON.stringify({ chattiness: 'banana', quietApps: ['notepad.exe'] }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error')
    const { screen } = await renderPage()
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: t('settings.pages.presence.quiet-apps.title') })).toHaveValue('notepad.exe')
    expect(warning).toHaveBeenCalledOnce()
    expect(error).not.toHaveBeenCalled()
  })

  it('fits a narrow window without horizontal overflow', async () => {
    await page.viewport(360, 720)
    const { screen } = await renderPage()
    await expect.element(screen.getByRole('slider', { name: t('settings.pages.presence.chattiness.title') })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360)
  })
})
