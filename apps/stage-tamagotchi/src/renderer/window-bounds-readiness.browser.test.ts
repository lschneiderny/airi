import { defineInvokeHandler } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { useElectronCursorAvailable, useElectronMouseAroundWindowBorder, useElectronMouseInElement, useElectronRelativeMouse, useElectronWindowBounds } from '@proj-airi/electron-vueuse'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { captionGetIsFollowingWindow } from '../shared/eventa'
import { useChatFloatingClickThrough } from './composables/use-chat-floating-click-through'
import { main, sendBounds, sendCursor } from './electron-mouse.fixtures'

const ignoreMouseEvents = vi.fn()
defineInvokeHandler(main, electron.window.setIgnoreMouseEvents, value => ignoreMouseEvents(value))
defineInvokeHandler(main, captionGetIsFollowingWindow, () => true)

// One renderer lifetime exercises the real module-owned caches before their first bounds event.
it('waits for actual window bounds before relative hit tests, native hover or caption borders', async () => {
  const pinia = createPinia()
  const capabilities = useHostCapabilitiesStore(pinia)
  capabilities.set(capabilitiesForHost('windows'))
  useElectronCursorAvailable()
  await sendCursor({ x: 140, y: 140 })
  const { default: Caption } = await import('./pages/caption.vue')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const captionHost = document.createElement('div')
  document.body.append(captionHost)
  const caption = createApp(Caption).use(pinia)
  caption.mount(captionHost)
  onTestFinished(() => {
    caption.unmount()
    captionHost.remove()
    vi.useRealTimers()
  })

  const area = ref<HTMLElement>()
  const hit = vi.spyOn(document, 'elementFromPoint')
  let inputs: {
    bounds: ReturnType<typeof useElectronWindowBounds>
    relative: ReturnType<typeof useElectronRelativeMouse>
    hover: ReturnType<typeof useElectronMouseInElement>
    border: ReturnType<typeof useElectronMouseAroundWindowBorder>
  } | undefined
  const view = await render(defineComponent({
    setup() {
      inputs = {
        bounds: useElectronWindowBounds(),
        relative: useElectronRelativeMouse(),
        hover: useElectronMouseInElement(area),
        border: useElectronMouseAroundWindowBorder({ threshold: 30 }),
      }
      useChatFloatingClickThrough({ pinned: true, passiveArea: area })
      return () => h('div', {
        ref: area,
        style: 'position:fixed;left:0;top:0;width:100px;height:100px;background:white',
      })
    },
  }), { global: { plugins: [pinia] } })
  onTestFinished(() => {
    hit.mockRestore()
    return view.unmount()
  })
  if (!inputs || !area.value)
    throw new Error('Relative input host did not mount')
  await nextTick()
  const beforeChat = {
    hits: hit.mock.calls.slice(),
    ignore: ignoreMouseEvents.mock.calls.map(([value]) => value),
    opacity: area.value.style.opacity,
  }
  const beforeCoordinates = [inputs.bounds.x.value, inputs.bounds.y.value, inputs.relative.x.value, inputs.relative.y.value]
  const relativeAvailableBefore = inputs.relative.available.value
  area.value.dispatchEvent(new PointerEvent('pointerenter', { clientX: 40, clientY: 40 }))
  await nextTick()
  const outsideBefore = inputs.hover.isOutside.value

  await sendCursor({ x: 0, y: 0 })
  await vi.advanceTimersByTimeAsync(250)
  await nextTick()
  const beforeBorder = {
    edges: [inputs.border.nearLeft.value, inputs.border.nearRight.value, inputs.border.nearTop.value, inputs.border.nearBottom.value],
    captionVisible: captionHost.querySelector('[class*="z-999"]') !== null,
  }

  await sendCursor({ x: 140, y: 140 })
  await sendBounds({ x: 100, y: 100, width: 400, height: 500 })
  await nextTick()
  expect(hit).toHaveBeenCalledWith(40, 40)
  expect(area.value.style.opacity).toBe('0')
  expect(inputs.relative.available.value).toBe(true)
  expect(inputs.hover.isOutside.value).toBe(false)
  expect([inputs.relative.x.value, inputs.relative.y.value]).toEqual([40, 40])

  // Resolved macOS uses the same supplied origin and normal live border behavior.
  capabilities.set(capabilitiesForHost('macos'))
  await sendCursor({ x: 100, y: 100 })
  await vi.advanceTimersByTimeAsync(250)
  await nextTick()
  expect(captionHost.querySelector('[class*="z-999"]')).not.toBeNull()
  expect([inputs.border.nearLeft.value, inputs.border.nearTop.value]).toEqual([true, true])

  expect(beforeChat).toEqual({ hits: [], ignore: [[false, { forward: true }]], opacity: '' })
  expect(beforeCoordinates).toEqual([0, 0, 140, 140])
  expect(relativeAvailableBefore).toBe(false)
  expect(outsideBefore).toBe(false)
  expect(beforeBorder).toEqual({ edges: [false, false, false, false], captionVisible: false })
})
