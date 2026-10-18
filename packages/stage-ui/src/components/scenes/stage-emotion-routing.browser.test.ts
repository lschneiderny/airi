import type { Component, ComponentInternalInstance, VNode } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, getCurrentInstance, h, isVNode } from 'vue'
import { createI18n } from 'vue-i18n'

import { Emotion, EMOTION_EmotionMotionName_value } from '../../constants/emotions'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useSettingsStageModel } from '../../stores/settings/stage-model'

/** Walks the rendered tree under `vnode` for the first instance of `type`, through child components, fragments and slots. */
function findInstance(vnode: VNode | null | undefined, type: Component): ComponentInternalInstance | undefined {
  if (!vnode)
    return undefined
  if (vnode.component) {
    if (vnode.component.type === type)
      return vnode.component
    return findInstance(vnode.component.subTree, type)
  }
  if (!Array.isArray(vnode.children))
    return undefined
  for (const child of vnode.children) {
    const found = isVNode(child) ? findInstance(child, type) : undefined
    if (found)
      return found
  }
  return undefined
}

// pixi-live2d-display reads the Cubism core global when it is imported, so the
// Live2D scene and the stage load after the global exists.
let Stage: Component
let live2d: typeof import('@proj-airi/stage-ui-live2d')

beforeAll(async () => {
  Object.assign(window, { Live2DCubismCore: {} })
  live2d = await import('@proj-airi/stage-ui-live2d')
  Stage = (await import('./Stage.vue')).default
})

async function renderStage(driver: 'natural' | 'universal') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSettingsStageModel().setStageModelRenderer('live2d')
  live2d.useSettingsLive2d().live2dMotionDriver = driver
  const params = live2d.useLive2dParams()
  params.currentMotion = { group: 'Idle', index: 0 }

  // Assigned in the host setup below; the cast keeps TypeScript from narrowing it to `null`.
  let host = null as ComponentInternalInstance | null
  render(defineComponent({
    setup() {
      host = getCurrentInstance()
      return () => h('div', { style: 'width:640px;height:480px' }, [h(Stage)])
    },
  }), {
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })] },
  })

  await expect.poll(() => findInstance(host?.subTree, live2d.Live2DScene)?.exposed).toBeDefined()
  const scene = findInstance(host?.subTree, live2d.Live2DScene)!
  // Stage calls the scene through its template ref, which reads the exposed object,
  // so the spy sees exactly the call the stage makes and still forwards it.
  const setEmotion = vi.spyOn(scene.exposed!, 'setEmotion')

  return { params, setEmotion, override: useNaturalPerformanceOverride() }
}

describe('stage emotion routing on Live2D', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('hands an emotion to the Natural scene and leaves the motion group alone', async () => {
    const { params, setEmotion, override } = await renderStage('natural')

    override.pulseEmotion('happy', 0.7)

    await expect.poll(() => setEmotion.mock.calls.length).toBe(1)
    expect(setEmotion).toHaveBeenCalledWith({
      id: expect.any(String),
      emotion: Emotion.Happy,
      nominal: 0.7,
      intensity: 0.7,
      band: 'clear',
      escalation: false,
    })
    expect(params.currentMotion).toEqual({ group: 'Idle', index: 0 })
  })

  it('plays the emotion motion group under Universal without calling the Natural scene', async () => {
    const { params, setEmotion, override } = await renderStage('universal')

    override.pulseEmotion('happy', 0.7)

    await expect.poll(() => params.currentMotion).toEqual({ group: EMOTION_EmotionMotionName_value[Emotion.Happy] })
    expect(setEmotion).not.toHaveBeenCalled()
  })
})
