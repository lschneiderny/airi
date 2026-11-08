import en from '@proj-airi/i18n/locales/en'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'

beforeAll(async () => {
  await import('virtual:uno.css')
  // The selector imports Live2D, which checks for the Cubism runtime global at import time.
  Object.assign(window, { Live2DCubismCore: {} })
})

afterEach(cleanup)

describe.each([390, 1280])('model dialogs at %i pixels', (width) => {
  it.each([
    { selector: true, title: 'Model Selector' },
    { selector: false, title: 'Before import' },
  ])('names and describes $title for assistive technology', async ({ selector, title }) => {
    await page.viewport(width, 900)
    const global = {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: { ModelManager: true },
    }
    if (selector) {
      const { default: ModelSelectorDialog } = await import('./model-selector-dialog.vue')
      await render(ModelSelectorDialog, { props: { show: true }, global })
    }
    else {
      const { default: BeforeImportDialog } = await import('./reports/live2d/modal.vue')
      await render(BeforeImportDialog, { props: { open: true, report: null }, global })
    }

    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog).toHaveAccessibleDescription(/Select a model|Review the model data/)
  })
})
