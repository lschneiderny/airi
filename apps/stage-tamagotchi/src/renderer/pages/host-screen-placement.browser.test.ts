import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished } from 'vitest'
import { render } from 'vitest-browser-vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { boundsAvailable, boundsHeight, boundsWidth, boundsX, boundsY, cursorAvailable, display, MainPage, outsideWindow, setIgnoreMouseEvents, stageFrame, StagePage, windowBounds } from './host-screen-placement.fixtures'

describe.each([['classic', MainPage], ['desktop', StagePage]] as const)('%s screen placement', (_name, component) => {
  it.each(['windows', 'macos'] as const)('waits for the first %s bounds reading before forwarding placement and relative cursor', async (host) => {
    const pinia = createPinia()
    useHostCapabilitiesStore(pinia).set(capabilitiesForHost(host))
    boundsAvailable.value = false
    boundsX.value = 0
    boundsY.value = 0
    boundsWidth.value = 0
    boundsHeight.value = 0
    cursorAvailable.value = true
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => view.unmount())

    expect(view.getByTestId('stage-placement').element().textContent).toBe('undefined')
    expect(view.getByTestId('stage-cursor').element().textContent).toBe('undefined')

    boundsX.value = windowBounds.x
    boundsY.value = windowBounds.y
    boundsWidth.value = windowBounds.width
    boundsHeight.value = windowBounds.height
    boundsAvailable.value = true
    await nextTick()

    expect(view.getByTestId('stage-placement').element().textContent).toBe(JSON.stringify({ displays: [display.bounds], windowBounds }))
    expect(view.getByTestId('stage-cursor').element().textContent).toBe('{"x":20,"y":30}')
  })

  it('defers hidden Wayland origin and cursor inputs until the snapshot resolves', async () => {
    const pinia = createPinia()
    const capabilities = useHostCapabilitiesStore(pinia)
    boundsX.value = 0
    boundsY.value = 0
    cursorAvailable.value = true
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => {
      boundsX.value = windowBounds.x
      boundsY.value = windowBounds.y
      return view.unmount()
    })

    expect(view.getByTestId('stage-placement').element().textContent).toBe('undefined')
    expect(view.getByTestId('stage-cursor').element().textContent).toBe('undefined')

    capabilities.set(capabilitiesForHost('linux-wayland'))
    await nextTick()

    expect(view.getByTestId('stage-placement').element().textContent).toBe('undefined')
    expect(view.getByTestId('stage-cursor').element().textContent).toBe('undefined')
  })

  it.each<HostId>(['windows', 'macos', 'linux-wayland'])('defers startup placement until the %s snapshot resolves', async (host) => {
    const pinia = createPinia()
    const capabilities = useHostCapabilitiesStore(pinia)
    cursorAvailable.value = false
    outsideWindow.value = true
    setIgnoreMouseEvents.mockClear()
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => {
      cursorAvailable.value = true
      outsideWindow.value = false
      return view.unmount()
    })
    const placement = JSON.stringify({ displays: [display.bounds], windowBounds })

    await expect.element(view.getByTestId('stage-placement')).toHaveTextContent('undefined')
    // Main has withheld the cursor; the cached coordinates must not reach Natural.
    await expect.element(view.getByTestId('stage-cursor')).toHaveTextContent('undefined')
    if (component === MainPage) {
      await expect.element(view.getByTestId('cursor-away')).toHaveTextContent('false')
      if (host !== 'linux-wayland') {
        cursorAvailable.value = true
        await nextTick()
        await expect.element(view.getByTestId('cursor-away')).toHaveTextContent('false')
      }
    }
    else {
      stageFrame.value?.({ timestamp: 0, delta: 16 })
      expect(setIgnoreMouseEvents).not.toHaveBeenCalledWith([false, { forward: true }])
    }

    capabilities.set(capabilitiesForHost(host))
    await nextTick()

    await expect.element(view.getByTestId('stage-placement')).toHaveTextContent(host === 'linux-wayland' ? 'undefined' : placement)
    if (host === 'linux-wayland')
      await expect.element(view.getByTestId('stage-cursor')).toHaveTextContent('undefined')
    if (component === StagePage) {
      // A missing first cursor reading must not capture the desktop on a live host, and a host without usable
      // click-through (linux-wayland without the bridge) never captures it.
      stageFrame.value?.({ timestamp: 16, delta: 16 })
      expect(setIgnoreMouseEvents).not.toHaveBeenCalledWith([false, { forward: true }])
    }
    else {
      cursorAvailable.value = host !== 'linux-wayland'
      await nextTick()
      await expect.element(view.getByTestId('cursor-away')).toHaveTextContent(host === 'linux-wayland' ? 'false' : 'true')
    }
  })

  it.each<HostId>(['windows', 'macos', 'linux-x11', 'linux-xwayland'])('preserves live-origin bounds on %s', async (host) => {
    const pinia = createPinia()
    useHostCapabilitiesStore(pinia).set(capabilitiesForHost(host))
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => view.unmount())

    await expect.element(view.getByTestId('stage-placement')).toHaveTextContent(JSON.stringify({
      displays: [display.bounds],
      windowBounds,
    }))
  })

  it('withholds placement from Stage when the window origin is unavailable', async () => {
    const pinia = createPinia()
    useHostCapabilitiesStore(pinia).set(capabilitiesForHost('linux-wayland'))
    const view = await render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => view.unmount())

    await expect.element(view.getByTestId('stage-placement')).toHaveTextContent('undefined')
  })
})

describe('classic controls startup visibility', () => {
  it.each<HostId>(['windows', 'macos'])('keeps classic controls visible until the %s snapshot resolves', async (host) => {
    const pinia = createPinia()
    const capabilities = useHostCapabilitiesStore(pinia)
    cursorAvailable.value = true
    outsideWindow.value = true
    const view = await render(MainPage, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' })] } })
    onTestFinished(() => {
      outsideWindow.value = false
      return view.unmount()
    })

    expect(view.getByTestId('cursor-away').element().textContent).toBe('false')

    capabilities.set(capabilitiesForHost(host))
    await nextTick()

    expect(view.getByTestId('cursor-away').element().textContent).toBe('true')
  })
})
