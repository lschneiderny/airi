import type { CharacterProfile } from '@proj-airi/stage-shared/character-state'

import en from '@proj-airi/i18n/locales/en'

import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import CardEditor from './CardEditor.vue'

import 'virtual:uno.css'

const KEY = 'settings.pages.card.character_profile'
/** The plan's evidence directory at the repository root; a relative screenshot path resolves against this test file. */
function evidencePath(name: string) {
  return `../../../../../../../.omo/evidence/layered-character-state/${name}`
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

describe('card editor character profile', () => {
  let pinia: ReturnType<typeof createPinia>
  let i18n: ReturnType<typeof createTestI18n>

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    i18n = createTestI18n()
  })

  const t = (key: string) => i18n.global.t(key)

  afterEach(() => {
    cleanup()
    disposePinia(pinia)
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  // The card store calls `useI18n()` at its own setup, so its first use needs a mounted component with the plugin.
  async function createCard(character?: unknown) {
    const host = await render(defineComponent({
      setup() {
        useAiriCardStore()
        return () => null
      },
    }), { global: { plugins: [pinia, i18n] } })
    const cardId = await useAiriCardStore(pinia).addCard({
      name: 'Luna',
      version: '1.0.0',
      extensions: {
        // Fields the form cannot display must survive a save.
        vendor: { keep: true },
        airi: {
          modules: {
            ...(character === undefined ? {} : { character }),
            consciousness: { provider: '', model: '' },
            vision: { provider: '', model: '' },
            speech: { provider: '', model: '', voice_id: '', pitch: 2 },
            vrm: { source: 'url', url: 'https://example.com/luna.vrm' },
          },
          agents: { planner: { prompt: 'Plan.' } },
        },
      },
    }, 'scratch')
    host.unmount()
    return cardId
  }

  function renderEditor(cardId: string) {
    return render(CardEditor, { props: { cardId, initialSection: 'modules' }, global: { plugins: [pinia, i18n] } })
  }

  /** Drives the range input of a slider like a user would: the browser emits `input` with the new value. */
  function slider(label: string) {
    const input = document.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${label}"]`)
      ?? [...document.querySelectorAll('label')].find(element => element.textContent?.includes(label))?.querySelector<HTMLInputElement>('input[type="range"]')
    if (!input)
      throw new Error(`No slider labelled ${label}`)
    return input
  }

  // The Range primitive scales values by 10000 so that fractional steps work on every browser.
  function setSlider(label: string, value: number) {
    const input = slider(label)
    input.value = String(value * 10000)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function savedProfile(cardId: string): CharacterProfile | undefined {
    return useAiriCardStore(pinia).cards.get(cardId)?.extensions.airi.modules.character
  }

  it('shows the default profile of a card without one and saves the edited profile', async () => {
    const cardId = await createCard()
    const screen = await renderEditor(cardId)

    await expect.element(screen.getByText(t(`${KEY}.title`))).toBeVisible()
    await expect.element(screen.getByText(t(`${KEY}.valence`))).toBeVisible()
    await expect.element(screen.getByText(t(`${KEY}.energy`))).toBeVisible()
    await expect.element(screen.getByText(t(`${KEY}.tension`))).toBeVisible()
    await expect.element(screen.getByText(t(`${KEY}.starting_stage`))).toBeVisible()
    // The default profile is the schema's, so no card is saved with a different resting mood by accident.
    await expect.element(screen.getByText(t(`${KEY}.stages.stranger`))).toBeVisible()

    setSlider(t(`${KEY}.valence`), -0.6)
    setSlider(t(`${KEY}.energy`), 0.4)
    setSlider(t(`${KEY}.tension`), 0.7)
    await screen.getByRole('combobox', { name: t(`${KEY}.starting_stage`) }).click()
    await screen.getByRole('option', { name: t(`${KEY}.stages.close`) }).click()
    await expect.element(screen.getByText(t('settings.pages.card.unsaved.badge'))).toBeVisible()

    // Evidence for the plan: the group at a desktop width, in both color modes.
    await page.viewport(1280, 960)
    const group = page.elementLocator(document.querySelector('[data-card-editor-character-profile]')!)
    await group.screenshot({ path: evidencePath('task-13-editor.png') })
    document.documentElement.classList.add('dark')
    await group.screenshot({ path: evidencePath('task-13-editor-dark.png') })
    document.documentElement.classList.remove('dark')

    await screen.getByRole('button', { name: t('settings.pages.card.save'), exact: true }).first().click()

    await expect.poll(() => savedProfile(cardId)).toEqual({
      resting: { valence: -0.6, energy: 0.4, tension: 0.7 },
      startingStage: 'close',
    })
    const saved = useAiriCardStore(pinia).cards.get(cardId)!
    expect(saved.extensions.vendor).toEqual({ keep: true })
    expect(saved.extensions.airi.modules.vrm).toEqual({ source: 'url', url: 'https://example.com/luna.vrm' })
    expect(saved.extensions.airi.modules.speech.pitch).toBe(2)
    expect(saved.extensions.airi.agents).toEqual({ planner: { prompt: 'Plan.' } })
  })

  it('shows All for an existing card and saves a turn limit, zero, and All', async () => {
    const cardId = await createCard()
    const screen = await render(CardEditor, { props: { cardId, initialSection: 'settings' }, global: { plugins: [pinia, i18n] } })

    const input = screen.getByRole('spinbutton', { name: t('settings.pages.card.context_window') })
    await expect.element(input).toHaveValue(null)
    await expect.element(input).toHaveAttribute('placeholder', t('settings.pages.card.context_window_all'))
    for (const [text, expected] of [['20', 20], ['0', 0], ['', -1]] as const) {
      await input.fill(text)
      await screen.getByRole('button', { name: t('settings.pages.card.save'), exact: true }).first().click()
      await expect.poll(() => useAiriCardStore(pinia).cards.get(cardId)?.extensions.airi.contextWindow).toBe(expected)
    }
  })

  it('loads the stored profile and clamps a value forced through the model to the schema range', async () => {
    const stored = { resting: { valence: 0.3, energy: -0.2, tension: 0.5 }, startingStage: 'friendly' }
    const cardId = await createCard(stored)
    const screen = await renderEditor(cardId)

    await expect.element(screen.getByText(t(`${KEY}.stages.friendly`))).toBeVisible()
    expect(Number(slider(t(`${KEY}.valence`)).value)).toBe(3000)
    expect(Number(slider(t(`${KEY}.energy`)).value)).toBe(-2000)
    expect(Number(slider(t(`${KEY}.tension`)).value)).toBe(5000)

    // A range input clamps on its own, so widen it first: the model, not the browser, must hold the line.
    for (const [label, value] of [[t(`${KEY}.valence`), 5], [t(`${KEY}.energy`), -5], [t(`${KEY}.tension`), 5]] as const) {
      const input = slider(label)
      input.min = String(-100000)
      input.max = String(100000)
      setSlider(label, value)
    }
    await screen.getByRole('button', { name: t('settings.pages.card.save'), exact: true }).first().click()

    await expect.poll(() => savedProfile(cardId)).toEqual({
      resting: { valence: 1, energy: -1, tension: 1 },
      startingStage: 'friendly',
    })
  })
})
