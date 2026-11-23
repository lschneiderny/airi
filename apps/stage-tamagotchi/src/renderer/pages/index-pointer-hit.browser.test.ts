import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { createPinia } from 'pinia'
import { expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useControlsIslandStore } from '../stores/controls-island'
import { createPageRouter, cursorAvailable, MainPage, mountedStage, outsideWindow, setIgnoreMouseEvents, stageCanvas, stageFrame } from './host-screen-placement.fixtures'

it('refreshes the classic page decisions within the resting interval plus two readback frames', async () => {
  const nativeFrame = window.requestAnimationFrame.bind(window)
  const scheduled = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    scheduled.set(++nextFrame, callback)
    return nextFrame
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    scheduled.delete(id)
  })
  onTestFinished(() => {
    request.mockRestore()
    cancel.mockRestore()
  })
  const pinia = createPinia()
  useHostCapabilitiesStore(pinia).set(capabilitiesForHost('windows'))
  useSettings(pinia).stageModelRenderer = 'live2d'
  useSettings(pinia).alwaysOnTop = true
  const controls = useControlsIslandStore(pinia)
  controls.fadeOnHoverEnabled = false
  cursorAvailable.value = true
  outsideWindow.value = false
  mountedStage.value = true
  stageCanvas.width = 100
  stageCanvas.height = 100
  Object.assign(stageCanvas.style, { position: 'fixed', left: '0', top: '0', width: '100px', height: '100px', zIndex: '9999' })
  document.body.append(stageCanvas)
  const gl = stageCanvas.getContext('webgl2', { preserveDrawingBuffer: true })!
  function paint(alpha: number) {
    gl.clearColor(1, 1, 1, alpha)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  paint(0)
  const view = await render(MainPage, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' }), createPageRouter()] } })
  onTestFinished(async () => {
    await view.unmount()
    stageCanvas.remove()
  })
  async function frame(timestamp: number) {
    await new Promise(nativeFrame)
    gl.finish()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    stageFrame.value?.({ timestamp, delta: 1000 / 60 })
    const callbacks = [...scheduled.values()]
    scheduled.clear()
    for (const callback of callbacks)
      callback(timestamp)
    await nextTick()
  }
  async function sample(atMs: number) {
    await frame(atMs)
    await frame(atMs + 1000 / 60)
    await frame(atMs + 2000 / 60)
  }
  const layer = view.getByTestId('stage-placement').element().parentElement!.parentElement!
  await sample(0)
  expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith([true, { forward: true }])
  expect(layer.classList.contains('op-0')).toBe(false)

  paint(1)
  await frame(99)
  expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith([true, { forward: true }])
  await sample(100)
  expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith([false, { forward: true }])
  expect(layer.classList.contains('op-0')).toBe(false)

  controls.fadeOnHoverEnabled = true
  await sample(200)
  expect(layer.classList.contains('op-0')).toBe(true)
  expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith([true, { forward: true }])

  paint(0)
  await sample(300)
  expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith([true, { forward: true }])
  expect(layer.classList.contains('op-0')).toBe(false)
})
