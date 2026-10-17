import type { OnboardingStepNextHandler } from './types'

import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import StepWelcome from './step-welcome.vue'

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
