import type { Component, ComponentInternalInstance, VNode } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, getCurrentInstance, h, isVNode } from 'vue'

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

// pixi-live2d-display reads the Cubism core global when it is imported.
let live2d: typeof import('@proj-airi/stage-ui-live2d')

beforeAll(async () => {
  Object.assign(window, { Live2DCubismCore: {} })
  live2d = await import('@proj-airi/stage-ui-live2d')
})

async function renderScene(driver: 'natural' | 'universal') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const settings = live2d.useSettingsLive2d()
  settings.live2dMotionDriver = driver
  settings.live2dAutoBlinkEnabled = true
  settings.live2dForceAutoBlinkEnabled = true

  // Assigned in the host setup below; the cast keeps TypeScript from narrowing it to `null`.
  let host = null as ComponentInternalInstance | null
  render(defineComponent({
    setup() {
      host = getCurrentInstance()
      return () => h('div', { style: 'width:640px;height:480px' }, [h(live2d.Live2DScene)])
    },
  }), { global: { plugins: [pinia] } })

  // The model mounts inside the canvas slot once the Pixi stage is ready.
  await expect.poll(() => findInstance(host?.subTree, live2d.Live2DModel)).toBeDefined()
  return { settings, modelProps: () => findInstance(host?.subTree, live2d.Live2DModel)!.props }
}

describe('live2D scene blink ownership', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('masks the motion-manager blink under Natural and passes the user setting to Natural', async () => {
    const { settings, modelProps } = await renderScene('natural')

    expect(modelProps().live2dAutoBlinkEnabled).toBe(false)
    expect(modelProps().live2dForceAutoBlinkEnabled).toBe(false)
    expect(modelProps().naturalAutoBlink).toBe(true)

    settings.live2dAutoBlinkEnabled = false

    await expect.poll(() => modelProps().naturalAutoBlink).toBe(false)
    expect(modelProps().live2dAutoBlinkEnabled).toBe(false)
  })

  it('passes the user blink settings to the motion manager under Universal', async () => {
    const { modelProps } = await renderScene('universal')

    expect(modelProps().live2dAutoBlinkEnabled).toBe(true)
    expect(modelProps().live2dForceAutoBlinkEnabled).toBe(true)
  })
})
