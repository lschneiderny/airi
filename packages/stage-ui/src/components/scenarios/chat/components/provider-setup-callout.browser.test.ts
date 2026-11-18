import en from '@proj-airi/i18n/locales/en'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ProviderSetupCallout from './provider-setup-callout.vue'

describe('chat provider setup callout', () => {
  it('opens provider settings when no provider is ready', async () => {
    const onConfigure = vi.fn()
    const screen = await render(ProviderSetupCallout, {
      props: { onConfigure },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      },
    })

    await expect.element(screen.getByText('Chat provider isn\'t configured')).toBeVisible()
    await screen.getByRole('button', { name: 'Open provider settings' }).click()

    expect(onConfigure).toHaveBeenCalledTimes(1)
  })
})
