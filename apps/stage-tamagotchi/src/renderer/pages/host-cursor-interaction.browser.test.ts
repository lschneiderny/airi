import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, onScopeDispose } from 'vue'
import { createI18n } from 'vue-i18n'

import { useControlsIslandStore } from '../stores/controls-island'
import { createPageRouter, cursorAvailable, MainPage, mountedStage, outsideWindow, samplerReads, stageCanvas, stageFrame } from './host-screen-placement.fixtures'

describe('classic cursor trust', () => {
  it('defers DOM hit testing while the capability snapshot is pending', async () => {
    const pinia = createPinia()
    cursorAvailable.value = false
    const hit = vi.spyOn(document, 'elementFromPoint')
    const view = await render(MainPage, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' }), createPageRouter()] } })
    onTestFinished(() => {
      hit.mockRestore()
      cursorAvailable.value = true
      return view.unmount()
    })

    expect(hit).not.toHaveBeenCalledWith(20, 30)
  })

  describe.each(['live2d', 'vrm'] as const)('%s Auto Hide', (renderer) => {
    it.each([null, 'linux-wayland', 'windows', 'macos'] as const)('uses only a trusted available cursor on %s', async (host) => {
      const pinia = createPinia()
      if (host)
        useHostCapabilitiesStore(pinia).set(capabilitiesForHost(host))
      const live = host === 'windows' || host === 'macos'
      cursorAvailable.value = live
      outsideWindow.value = false
      mountedStage.value = true
      stageCanvas.width = 100
      stageCanvas.height = 100
      Object.assign(stageCanvas.style, { position: 'fixed', left: '0', top: '0', width: '100px', height: '100px' })
      document.body.append(stageCanvas)
      const gl = stageCanvas.getContext('webgl2', { preserveDrawingBuffer: true })!
      gl.clearColor(1, 1, 1, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const contextRead = vi.spyOn(stageCanvas, 'getContext')
      const Host = defineComponent({
        setup() {
          const controls = useControlsIslandStore()
          const settings = useSettings()
          const previousRenderer = settings.stageModelRenderer
          controls.fadeOnHoverEnabled = true
          settings.stageModelRenderer = renderer
          onScopeDispose(() => {
            controls.fadeOnHoverEnabled = false
            settings.stageModelRenderer = previousRenderer
          })
          return () => h(MainPage)
        },
      })
      const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(stageCanvas)
      const view = await render(Host, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en' }), createPageRouter()] } })
      onTestFinished(() => {
        hit.mockRestore()
        contextRead.mockRestore()
        stageCanvas.remove()
        cursorAvailable.value = true
        return view.unmount()
      })
      await nextTick()
      const layer = view.getByTestId('stage-placement').element().parentElement?.parentElement
      // The pixel under the cursor is read back from the GPU some frames after it is asked for, so a live cursor gets
      // frames until the stage fades; three frames are enough to show that an untrusted one never asks.
      const frames = live ? 300 : 3
      for (let frame = 0; frame < frames && (frame < 3 || !layer?.classList.contains('op-0')); frame++) {
        await new Promise(requestAnimationFrame)
        gl.finish()
        stageFrame.value?.({ timestamp: frame * 1000 / 60, delta: 1000 / 60 })
        await nextTick()
      }

      expect(layer?.classList.contains('op-0')).toBe(live)
      if (live) {
        expect(hit).toHaveBeenCalledWith(20, 30)
        if (renderer === 'vrm')
          expect(samplerReads).toContainEqual({ renderer: 'three', x: 20, y: 30 })
        else
          expect(contextRead).toHaveBeenCalledWith('webgl2')
      }
      else {
        expect(hit).not.toHaveBeenCalledWith(20, 30)
        expect(samplerReads).toEqual([])
        expect(contextRead).not.toHaveBeenCalled()
      }
    })
  })
})
