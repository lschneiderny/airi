import type { OnboardingStepNextHandler } from './types'

import en from '@proj-airi/i18n/locales/en'
import zhHans from '@proj-airi/i18n/locales/zh-Hans'

import { createFallbackOptions } from '@proj-airi/i18n'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import StepWelcome from './step-welcome.vue'

import { useAiriCardStore } from '../../../../stores/modules/airi-card'

afterEach(() => {
  // The card store keeps its cards in the local storage.
  localStorage.clear()
})

/** Creates the production English localization surface used by onboarding stores. */
function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en,
    },
  })
}

/** Renders the welcome step with real Pinia and i18n plugins. */
async function renderWelcomeStep(onNext: OnboardingStepNextHandler = vi.fn()) {
  const screen = await render(StepWelcome, {
    props: {
      onNext,
    },
    global: {
      directives: {
        motion: {},
      },
      plugins: [createPinia(), createTestI18n()],
    },
  })
  return { screen, onNext }
}

describe('onboarding local setup', () => {
  it('continues to provider setup without any sign-in action', async () => {
    const { screen, onNext } = await renderWelcomeStep()

    await expect.element(screen.getByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(document.body.querySelector('a')).toBeNull()

    await screen.getByRole('button', { name: 'Setup with your provider' }).click()

    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('onboarding language choice', () => {
  /** Renders the welcome step in English, in an app that creates the built-in card as a first start does. */
  async function renderWithBuiltInCard() {
    const pinia = createPinia()
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, 'zh-Hans': zhHans }, ...createFallbackOptions(console.warn) })
    const App = defineComponent({
      setup() {
        // The card store creates its runtime stores in the setup of the app, where they can bind i18n.
        void useAiriCardStore().initialize()
        return () => h(StepWelcome, { customProviderSetupEnabled: true, onNext: vi.fn() })
      },
    })
    await render(App, {
      global: {
        directives: { motion: {} },
        plugins: [pinia, i18n],
      },
    })
    const cardStore = useAiriCardStore(pinia)
    await expect.poll(() => cardStore.getCard('default')).toBeDefined()
    return { cardStore, i18n }
  }

  it('gives the built-in card the description of the chosen language', async () => {
    const { cardStore, i18n } = await renderWithBuiltInCard()
    const english = cardStore.builtInCard.description
    expect(cardStore.getCard('default')?.description).toBe(english)

    i18n.global.locale.value = 'zh-Hans'

    await expect.poll(() => cardStore.getCard('default')?.description).not.toBe(english)
    expect(cardStore.getCard('default')?.description).toBe(cardStore.builtInCard.description)
  })

  it('keeps a description that the user edited', async () => {
    const { cardStore, i18n } = await renderWithBuiltInCard()
    const english = cardStore.builtInCard.description
    await cardStore.updateCard('default', { ...cardStore.builtInCard, description: 'My own persona' })

    i18n.global.locale.value = 'zh-Hans'
    await nextTick()

    expect(cardStore.builtInCard.description).not.toBe(english)
    expect(cardStore.getCard('default')?.description).toBe('My own persona')
  })
})
