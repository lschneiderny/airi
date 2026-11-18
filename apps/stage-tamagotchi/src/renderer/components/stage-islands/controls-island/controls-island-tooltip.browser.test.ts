import en from '@proj-airi/i18n/locales/en'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { computed, defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import ControlsIsland from './index.vue'

import { controlsIslandPlacementKey } from './use-controls-island-placement'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronCursorAvailable: () => ref(true),
  useElectronEventaContext: () => ref({ on: vi.fn(() => vi.fn()), emit: vi.fn() }),
  useElectronEventaInvoke: () => vi.fn().mockResolvedValue(false),
  useElectronMouseInElement: () => ({ isOutside: ref(false) }),
}))

vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<typeof import('@moeru/eventa')>(),
  defineInvoke: () => vi.fn(),
}))

/** The positioning wrapper that Reka UI puts around the open tooltip of a dock button. */
const tooltipWrapperSelector = '[data-reka-popper-content-wrapper]'

afterEach(() => {
  cleanup()
})

for (const emulated of [true, false]) {
  it(`keeps an open tooltip ${emulated ? 'transparent to character presses with emulated click-through' : 'hoverable with native forwarding'}`, async () => {
    const pinia = createPinia()
    const host = capabilitiesForHost('windows')
    useHostCapabilitiesStore(pinia).set({
      ...host,
      signals: {
        ...host.signals,
        clickThroughForward: emulated ? { kind: 'degraded', reason: 'linux-click-through-emulated' } : { kind: 'live' },
      },
    })
    const presses: string[] = []
    const screen = render(defineComponent({
      setup: () => () => h('div', [
        h('canvas', {
          'data-testid': 'character',
          'style': 'position:fixed;inset:0;width:100%;height:100%',
          'onPointerdown': () => presses.push('character'),
        }),
        h(ControlsIsland),
      ]),
    }), {
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        directives: { 'track-button': {} },
        provide: {
          [controlsIslandPlacementKey as symbol]: {
            dock: ref('top-right'),
            isTop: computed(() => true),
            isLeft: computed(() => false),
            motionPhase: ref('idle'),
          },
        },
      },
    })

    await screen.getByTestId('controls-island-more').hover()
    await expect.poll(() => document.querySelector(tooltipWrapperSelector)).not.toBeNull()
    const wrapper = document.querySelector<HTMLElement>(tooltipWrapperSelector)!
    // No pointerleave is sent: the desktop stage can stop receiving DOM moves
    // as it turns click-through during the crossing (F3-A).
    const elementUnderTooltip = () => {
      const bounds = wrapper.getBoundingClientRect()
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }
    if (emulated) {
      const character = screen.getByTestId('character').element()
      await expect.poll(elementUnderTooltip).toBe(character)
      character.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(presses).toEqual(['character'])
    }
    else {
      await expect.poll(() => wrapper.contains(elementUnderTooltip())).toBe(true)
    }
  })
}
