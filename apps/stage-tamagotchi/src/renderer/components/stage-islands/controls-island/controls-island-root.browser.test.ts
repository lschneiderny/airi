import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, ref } from 'vue'

import ControlsIslandRoot from './controls-island-root.vue'

import { useControlsIslandPlacement } from './use-controls-island-placement'

const windowX = ref(0)
const windowY = ref(0)
const display = {
  bounds: { x: 0, y: 0, width: 1600, height: 1000 },
  workArea: { x: 0, y: 0, width: 1600, height: 1000 },
}
const displays = ref([display])

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronAllDisplays: () => displays,
  useElectronWindowBounds: () => ({ x: windowX, y: windowY, width: ref(400), height: ref(500) }),
}))

const Dock = defineComponent({
  setup() {
    const placement = useControlsIslandPlacement()
    return () => h('output', { 'data-testid': 'dock' }, placement.dock.value)
  },
})

// Dock selection is the assertion; reduced motion removes the unrelated relocation timer.
vi.mock('@vueuse/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vueuse/core')>(),
  usePreferredReducedMotion: () => ref('reduce'),
}))

describe('controls island origin trust', () => {
  it('defers hidden Wayland origin docking until the snapshot resolves', async () => {
    const pinia = createPinia()
    const capabilities = useHostCapabilitiesStore(pinia)
    windowX.value = 0
    windowY.value = 0
    const view = await render(ControlsIslandRoot, {
      props: { frozen: false },
      slots: { default: () => h(Dock) },
      global: { plugins: [pinia] },
    })
    onTestFinished(() => view.unmount())

    expect(view.getByTestId('dock').element().textContent).toBe('top-right')

    capabilities.set(capabilitiesForHost('linux-wayland'))
    await nextTick()

    expect(view.getByTestId('dock').element().textContent).toBe('top-right')
  })

  it.each<HostId>(['windows', 'macos', 'linux-wayland'])('defers origin-based docking until the %s snapshot resolves', async (host) => {
    const pinia = createPinia()
    const capabilities = useHostCapabilitiesStore(pinia)
    windowX.value = 0
    windowY.value = 0
    const view = await render(ControlsIslandRoot, {
      props: { frozen: false },
      slots: { default: () => h(Dock) },
      global: { plugins: [pinia] },
    })
    onTestFinished(() => view.unmount())

    // Keep the initial UI dock without reading the unverified origin or substituting zero-size bounds.
    await expect.element(view.getByTestId('dock')).toHaveTextContent('top-right')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    onTestFinished(() => {
      vi.useRealTimers()
      displays.value = [display]
    })
    capabilities.set(capabilitiesForHost(host))
    await nextTick()
    if (host === 'linux-wayland') {
      // A display update must not reuse the provisional origin during the bounds debounce.
      displays.value = [{ ...display, workArea: { x: -1600, y: -1000, width: 1600, height: 1000 } }]
      await nextTick()
      await expect.element(view.getByTestId('dock')).toHaveTextContent('top-right')
    }
    windowX.value = 1200
    windowY.value = 500
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)

    await expect.element(view.getByTestId('dock')).toHaveTextContent(host === 'linux-wayland' ? 'top-right' : 'bottom-right')
    windowX.value = 0
    windowY.value = 0
  })

  it.each<HostId>(['windows', 'macos', 'linux-x11', 'linux-xwayland', 'linux-wayland'])('places only from a live origin on %s', async (host) => {
    const pinia = createPinia()
    useHostCapabilitiesStore(pinia).set(capabilitiesForHost(host))
    const view = await render(ControlsIslandRoot, {
      props: { frozen: false },
      slots: { default: () => h(Dock) },
      global: { plugins: [pinia] },
    })
    onTestFinished(() => view.unmount())

    await expect.element(view.getByTestId('dock')).toHaveTextContent(host === 'linux-wayland' ? 'top-right' : 'top-left')
  })
})
