import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import en from '@proj-airi/i18n/locales/en'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, onTestFinished } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import PresenceSensing from './presence-sensing.vue'

// The literal English copy, because a user reads words and not keys.
const statusLive = 'Live'
const statusLimited = 'Limited'
const statusUnavailable = 'Unavailable'
const windowOriginReason = 'Wayland hides where the window sits on the screen.'
const globalKeyUpReason = 'Wayland does not allow a global input hook.'

async function renderPage(host: HostId) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useHostCapabilitiesStore(pinia).set(capabilitiesForHost(host))
  const screen = await render(PresenceSensing, {
    global: {
      plugins: [
        pinia,
        createI18n({ legacy: false, locale: 'en', messages: { en } }),
      ],
    },
  })
  onTestFinished(() => screen.unmount())
  return screen
}

function row(screen: Awaited<ReturnType<typeof renderPage>>, signal: string) {
  return screen.container.querySelector(`[data-testid="presence-row-${signal}"]`)
}

describe('presence sensing settings page', () => {
  it('names the host and says in words why windowOrigin and globalKeyUp are unavailable on native Wayland', async () => {
    const screen = await renderPage('linux-wayland')

    expect(screen.container.querySelector('[data-testid="presence-host"]')?.textContent).toContain('linux-wayland')
    expect(screen.container.querySelectorAll('[data-testid^="presence-row-"]')).toHaveLength(10)

    const windowOrigin = row(screen, 'windowOrigin')
    expect(windowOrigin?.textContent).toContain(statusUnavailable)
    expect(windowOrigin?.textContent).toContain(windowOriginReason)

    const globalKeyUp = row(screen, 'globalKeyUp')
    expect(globalKeyUp?.textContent).toContain(statusUnavailable)
    expect(globalKeyUp?.textContent).toContain(globalKeyUpReason)
  })

  it('shows every signal as Live with no reason on Windows', async () => {
    const screen = await renderPage('windows')

    const rows = Array.from(screen.container.querySelectorAll('[data-testid^="presence-row-"]'))
    expect(rows).toHaveLength(10)
    for (const element of rows) {
      const text = element.textContent ?? ''
      expect(text).toContain(statusLive)
      expect(text).not.toContain(statusLimited)
      expect(text).not.toContain(statusUnavailable)
      // A live row renders the name and the status only; a reason would add a second `dd`.
      expect(element.querySelectorAll('dd')).toHaveLength(1)
    }
  })
})
