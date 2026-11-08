import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, ref } from 'vue'

import ControlsIslandRoot from './controls-island-root.vue'

import { useControlsIslandPlacement } from './use-controls-island-placement'

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronAllDisplays: () => ref([{
    bounds: { x: 0, y: 0, width: 1600, height: 1000 },
    workArea: { x: 0, y: 0, width: 1600, height: 1000 },
  }]),
  useElectronWindowBounds: () => ({ x: ref(0), y: ref(0), width: ref(400), height: ref(500) }),
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
