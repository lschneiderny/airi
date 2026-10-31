import en from '@proj-airi/i18n/locales/en'

import { useConversationSettings } from '@proj-airi/stage-ui/features/conversation/settings'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import ConversationPage from './index.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const key = 'settings/conversation'
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

describe('conversation settings page', () => {
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
    const screen = await render(ConversationPage, { global: { plugins: [pinia, i18n()] } })
    // The label wraps the title and its description, so match the accessible name by its title prefix.
    const register = screen.getByRole('combobox', { name: new RegExp(`^${t('settings.pages.conversation.register.title')}`) })
    const flavor = screen.getByRole('combobox', { name: new RegExp(`^${t('settings.pages.conversation.texting-flavor.title')}`) })
    return { screen, register, flavor, settings: useConversationSettings(pinia) }
  }

  it('disables the texting flavor while the register is Talking', async () => {
    const { register, flavor, settings } = await renderPage()
    // A missing locale entry renders the key, which the role query would still match.
    expect(t('settings.pages.conversation.register.title')).not.toBe('settings.pages.conversation.register.title')
    expect(t('settings.pages.conversation.texting-flavor.title')).not.toBe('settings.pages.conversation.texting-flavor.title')

    await expect.element(register).toHaveTextContent(t('settings.pages.conversation.register.options.talking'))
    await expect.element(flavor).toHaveTextContent(t('settings.pages.conversation.texting-flavor.options.plain'))
    await expect.element(flavor).toBeDisabled()
    expect(settings.document.register).toBe('talking')
  })

  it('switches to Texting, enables the flavor, and persists one settings document', async () => {
    const { screen, register, flavor, settings } = await renderPage()

    await register.click()
    await page.getByRole('option', { name: t('settings.pages.conversation.register.options.texting'), exact: true }).click()
    await expect.element(register).toHaveTextContent(t('settings.pages.conversation.register.options.texting'))
    expect(settings.document.register).toBe('texting')
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ register: 'texting', textingFlavor: 'plain' })

    await expect.element(flavor).toBeEnabled()
    await flavor.click()
    await page.getByRole('option', { name: t('settings.pages.conversation.texting-flavor.options.discord'), exact: true }).click()
    await expect.element(flavor).toHaveTextContent(t('settings.pages.conversation.texting-flavor.options.discord'))
    expect(settings.document.textingFlavor).toBe('discord')
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(settings.document)

    // Back to Talking keeps the stored flavor but locks the control again.
    await register.click()
    await page.getByRole('option', { name: t('settings.pages.conversation.register.options.talking'), exact: true }).click()
    await expect.element(flavor).toBeDisabled()
    expect(settings.document).toEqual({ register: 'talking', textingFlavor: 'discord' })
    await expect.element(screen.getByText(t('settings.pages.conversation.texting-flavor.description'))).toBeVisible()
  })

  it('shows the stored register and flavor when the page opens', async () => {
    localStorage.setItem(key, JSON.stringify({ register: 'texting', textingFlavor: 'discord' }))
    const { register, flavor } = await renderPage()
    await expect.element(register).toHaveTextContent(t('settings.pages.conversation.register.options.texting'))
    await expect.element(flavor).toHaveTextContent(t('settings.pages.conversation.texting-flavor.options.discord'))
    await expect.element(flavor).toBeEnabled()
  })

  it('fits a narrow window without horizontal overflow', async () => {
    await page.viewport(360, 720)
    const { register } = await renderPage()
    await expect.element(register).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360)
  })
})
