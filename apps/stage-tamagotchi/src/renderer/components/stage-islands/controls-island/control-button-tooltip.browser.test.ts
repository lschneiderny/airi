import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, ref } from 'vue'

import ControlButtonTooltip from './control-button-tooltip.vue'

import { controlsIslandPlacementKey } from './use-controls-island-placement'

import 'virtual:uno.css'

const tooltipSelector = '.controls-island-tooltip'
const tooltipTimeoutMs = 5000

/** Arm before the hover: resolves once the tooltip is in the DOM, rejects after a bounded timeout. */
function watchForTooltip(): { opened: Promise<void>, disconnect: () => void } {
  let observer: MutationObserver | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const opened = new Promise<void>((resolve, reject) => {
    if (document.querySelector(tooltipSelector)) {
      resolve()
      return
    }
    observer = new MutationObserver(() => {
      if (document.querySelector(tooltipSelector))
        resolve()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    timer = setTimeout(() => reject(new Error(`Timed out after ${tooltipTimeoutMs} ms waiting for ${tooltipSelector} to open`)), tooltipTimeoutMs)
  })
  return {
    opened,
    disconnect: () => {
      observer?.disconnect()
      clearTimeout(timer)
    },
  }
}

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
        h('div', { style: 'position:fixed;left:350px;top:200px' }, [
          h(ControlButtonTooltip, { side: 'left', asChild: true }, {
            default: () => h('button', 'Connection'),
            tooltip: () => 'Connected. Open connection settings',
          }),
        ]),
      ]),
    }), {
      global: {
        plugins: [pinia],
        provide: {
          [controlsIslandPlacementKey as symbol]: {
            dock: ref('top-right'),
            isTop: ref(true),
            isLeft: ref(false),
            motionPhase: ref('idle'),
          },
        },
      },
    })
    const watch = watchForTooltip()
    try {
      await screen.getByRole('button', { name: 'Connection' }).hover()
      await watch.opened
      const tooltip = document.querySelector('.controls-island-tooltip')
      if (!(tooltip instanceof HTMLElement))
        throw new TypeError('Expected the open tooltip')
      // No pointerleave is sent: the desktop stage can stop receiving DOM moves
      // as it turns click-through during the crossing (F3-A).
      const bounds = tooltip.getBoundingClientRect()
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      if (emulated) {
        expect(target).toBe(screen.getByTestId('character').element())
        target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        expect(presses).toEqual(['character'])
      }
      else {
        expect(tooltip.contains(target)).toBe(true)
      }
    }
    finally {
      watch.disconnect()
      screen.unmount()
    }
  })
}
