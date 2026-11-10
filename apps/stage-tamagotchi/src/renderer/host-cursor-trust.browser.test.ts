import { defineInvokeHandler } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { useElectronCursorAvailable, useElectronWindowBounds } from '@proj-airi/electron-vueuse'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { captionGetIsFollowingWindow } from '../shared/eventa'
import { useChatFloatingClickThrough } from './composables/use-chat-floating-click-through'
import { main, sendBounds, sendCursor } from './electron-mouse.fixtures'

const ignoreMouseEvents = vi.fn()
let pinia = createPinia()
defineInvokeHandler(main, electron.window.setIgnoreMouseEvents, value => ignoreMouseEvents(value))
defineInvokeHandler(main, captionGetIsFollowingWindow, () => true)

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  useElectronCursorAvailable()
  useElectronWindowBounds()
  await sendBounds({ x: 0, y: 0, width: 400, height: 500 })
  await sendCursor({ x: 0, y: 0 })
  await sendCursor(null)
  ignoreMouseEvents.mockClear()
})

async function mountChat(passive = false) {
  const area = ref<HTMLElement>()
  const hit = vi.spyOn(document, 'elementFromPoint')
  const view = await render(defineComponent({
    setup() {
      useChatFloatingClickThrough({ pinned: true, passiveArea: () => passive ? area.value : undefined })
      return () => h('div', {
        ref: area,
        style: passive ? 'position:fixed;left:0;top:0;width:100px;height:100px;background:white' : '',
      })
    },
  }), { global: { plugins: [pinia] } })
  onTestFinished(() => {
    hit.mockRestore()
    return view.unmount()
  })
  return { hit, area }
}

describe('floating chat native cursor trust', () => {
  it.each(['windows', 'macos'] as const)('preserves live %s hit-testing and click-through over an unpainted point', async (host) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(host))
    await sendCursor({ x: 40, y: 40 })
    const { hit } = await mountChat()

    expect(hit).toHaveBeenCalledWith(40, 40)
    await vi.waitFor(() => expect(ignoreMouseEvents).toHaveBeenLastCalledWith([true, { forward: true }]))
  })

  it.each(['windows', 'macos'] as const)('waits for the first reading on %s, then hit-tests the unchanged point', async (host) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(host))
    const { hit } = await mountChat()

    expect(hit).not.toHaveBeenCalled()
    expect(ignoreMouseEvents).not.toHaveBeenCalledWith([true, { forward: true }])

    await sendCursor({ x: 0, y: 0 })

    expect(hit).toHaveBeenCalledWith(0, 0)
    await vi.waitFor(() => expect(ignoreMouseEvents).toHaveBeenLastCalledWith([true, { forward: true }]))
  })

  it.each([null, 'linux-wayland', 'linux-xwayland'] as const)('defers hit-testing for snapshot %s even with a cached point', async (host) => {
    if (host)
      useHostCapabilitiesStore().set(capabilitiesForHost(host))
    await sendCursor({ x: 40, y: 40 })

    const { hit } = await mountChat()

    expect(hit).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(ignoreMouseEvents).toHaveBeenLastCalledWith([false, { forward: true }]))
  })

  it.each(['cursorScreenPoint', 'windowOrigin'] as const)('requires explicit trust in %s before hit-testing', async (signal) => {
    const snapshot = capabilitiesForHost('windows')
    snapshot.signals[signal] = { kind: 'degraded', reason: 'wayland-window-origin-hidden' }
    useHostCapabilitiesStore().set(snapshot)
    await sendCursor({ x: 40, y: 40 })

    const { hit } = await mountChat()

    expect(hit).not.toHaveBeenCalled()
  })

  it.each(['windows', 'macos'] as const)('restores a passive feed immediately when %s cursor availability is withdrawn', async (host) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(host))
    await sendCursor({ x: 40, y: 40 })
    const { area, hit } = await mountChat(true)
    await vi.waitFor(() => expect(area.value?.style.opacity).toBe('0'))
    expect(area.value?.inert).toBe(true)
    hit.mockClear()

    await sendCursor(null)

    expect(hit).not.toHaveBeenCalled()
    expect(area.value?.style.opacity).toBe('')
    await vi.waitFor(() => expect(ignoreMouseEvents).toHaveBeenLastCalledWith([false, { forward: true }]))
  })
})

let Caption: typeof import('./pages/caption.vue').default

async function mountCaption() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Caption).use(pinia)
  const capabilities = useHostCapabilitiesStore(pinia)
  app.mount(host)
  onTestFinished(() => {
    app.unmount()
    host.remove()
    vi.useRealTimers()
  })
  await sendBounds({ x: 0, y: 0, width: 400, height: 500 })
  return { host, capabilities }
}

describe('caption border native cursor trust', () => {
  // The page's module graph loads cold here, so that load does not count against the first test's timeout.
  beforeAll(async () => {
    Caption = (await import('./pages/caption.vue')).default
  }, 60_000)

  it.each(['windows', 'macos'] as const)('preserves the live %s border at the window edge', async (profile) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(profile))
    await sendCursor({ x: 0, y: 0 })
    const { host } = await mountCaption()

    await vi.advanceTimersByTimeAsync(250)
    await nextTick()

    expect(host.querySelector('[class*="z-999"]')).not.toBeNull()
  })

  it.each([null, 'linux-wayland', 'windows'] as const)('withholds the border with unavailable cursor on %s', async (profile) => {
    if (profile)
      useHostCapabilitiesStore().set(capabilitiesForHost(profile))
    const { host } = await mountCaption()

    await vi.advanceTimersByTimeAsync(250)
    await nextTick()

    expect(host.querySelector('[class*="z-999"]')).toBeNull()
  })

  it.each([null, 'linux-wayland'] as const)('withholds the border without trusted snapshot %s even with a reading', async (profile) => {
    if (profile)
      useHostCapabilitiesStore().set(capabilitiesForHost(profile))
    await sendCursor({ x: 0, y: 0 })
    const { host } = await mountCaption()

    await vi.advanceTimersByTimeAsync(250)
    await nextTick()

    expect(host.querySelector('[class*="z-999"]')).toBeNull()
  })

  it.each(['windows', 'macos'] as const)('preserves the live %s border and removes it immediately when the point is withheld', async (profile) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(profile))
    await sendCursor({ x: 0, y: 0 })
    const { host } = await mountCaption()
    await vi.advanceTimersByTimeAsync(250)
    await nextTick()
    expect(host.querySelector('[class*="z-999"]')).not.toBeNull()

    await sendCursor(null)

    expect(host.querySelector('[class*="z-999"]')).toBeNull()
  })
})
