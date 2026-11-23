import type { Live2DModelItemEditor } from '@proj-airi/stage-ui-live2d/composables/live2d/items/editor'

import type { Live2DModelFixture } from './live2d-model-fixture'

import JSZip from 'jszip'

import { Live2DModel } from '@proj-airi/stage-ui-live2d/components/scenes/live2d'
import { createLive2D, provideLive2D } from '@proj-airi/stage-ui-live2d/contexts/live2d'
import { createPinia } from 'pinia'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'

import { createLive2DModelFixture } from './live2d-model-fixture'

// As `Live2D.vue` does: the OPFS middleware unwraps the `{ url, id }` source the model component passes to the loader.
import '@proj-airi/stage-ui-live2d/utils/live2d-opfs-registration'

/** Bounds the wait for the component to load the model. */
const loadTimeoutMs = 20_000

interface ModelExposed {
  initialModelWidth: number
  initialModelHeight: number
  originalModelWidth: number
  originalModelHeight: number
  itemEditor: () => Live2DModelItemEditor | undefined
}

describe('model component canvas accessors', () => {
  let fixture: Live2DModelFixture
  const blobUrls: string[] = []
  let unmountCurrent: (() => void) | undefined

  beforeAll(() => {
    fixture = createLive2DModelFixture({ width: 400, height: 600 })
  })

  afterEach(() => {
    unmountCurrent?.()
  })

  afterAll(() => {
    for (const url of blobUrls)
      URL.revokeObjectURL(url)
    fixture.destroy()
  })

  /** The preset zip with its model3 `Layout` size replaced, which scales the displayed model by `layoutSize / 2`. */
  async function presetWithLayoutSize(layoutSize: number) {
    const zip = await JSZip.loadAsync(await fixture.presetModel())
    const settingsPath = Object.keys(zip.files).find(path => path.endsWith('.model3.json'))
    if (!settingsPath)
      throw new Error('The preset zip holds no model3.json.')
    const settings = JSON.parse(await zip.file(settingsPath)!.async('string')) as { Layout?: Record<string, number> }
    settings.Layout = { ...settings.Layout, Width: layoutSize, Height: layoutSize }
    zip.file(settingsPath, JSON.stringify(settings))
    const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
    blobUrls.push(url)
    return `zip://${url}`
  }

  async function mountModel(modelSrc: string) {
    const exposed = ref<ModelExposed>()
    const root = document.createElement('div')
    document.body.append(root)
    const host = createApp(defineComponent({
      setup() {
        provideLive2D(createLive2D())
        return () => h(Live2DModel, { ref: exposed, app: fixture.app, modelSrc, width: 400, height: 600 })
      },
    }))
    host.use(createPinia())
    host.mount(root)
    unmountCurrent = () => {
      host.unmount()
      root.remove()
      unmountCurrent = undefined
    }
    await expect.poll(() => exposed.value?.originalModelWidth, { timeout: loadTimeoutMs }).toBeGreaterThan(0)
    return exposed.value!
  }

  it('reports her model canvas before the layout scale, while the fitted size follows the scale', async () => {
    // Layout size 2 is the logical size, so the displayed model is her canvas.
    const plain = await mountModel(await presetWithLayoutSize(2))
    const canvas = { width: plain.originalModelWidth, height: plain.originalModelHeight }
    expect(canvas.width).toBeGreaterThan(0)
    expect(plain.initialModelWidth).toBeCloseTo(canvas.width, 3)
    expect(plain.initialModelHeight).toBeCloseTo(canvas.height, 3)
    unmountCurrent?.()

    // Layout size 4 doubles the displayed model, which the old canvas producer read; her canvas does not change.
    const scaled = await mountModel(await presetWithLayoutSize(4))
    expect(scaled.originalModelWidth).toBe(canvas.width)
    expect(scaled.originalModelHeight).toBe(canvas.height)
    expect(scaled.initialModelWidth).toBeCloseTo(canvas.width * 2, 3)
    expect(scaled.initialModelHeight).toBeCloseTo(canvas.height * 2, 3)
    expect(scaled.itemEditor()?.canvas).toEqual(canvas)
  })

  it('exposes her part tree, drawables with their parts, a pin picker, and the canvas conversion', async () => {
    const model = await mountModel(await presetWithLayoutSize(2))
    const editor = model.itemEditor()
    if (!editor)
      throw new Error('The item editor is missing after the model loaded.')
    expect(editor.parts.length).toBeGreaterThan(0)
    expect(editor.parts.some(part => part.depth > 0)).toBe(true)
    expect(editor.drawables.length).toBeGreaterThan(0)
    expect(editor.drawables.every(drawable => drawable.partId === null || editor.parts.some(part => part.id === drawable.partId))).toBe(true)

    const center = { x: editor.canvas.width / 2, y: editor.canvas.height / 2 }
    const roundTrip = editor.globalToCanvas(editor.canvasToGlobal(center))
    expect(roundTrip.x).toBeCloseTo(center.x, 3)
    expect(roundTrip.y).toBeCloseTo(center.y, 3)

    // Her head is on the upper center of her canvas; the corner holds no mesh.
    expect(editor.pickPin({ x: center.x, y: editor.canvas.height * 0.2 })?.drawableId).toBeTypeOf('string')
    expect(editor.pickPin({ x: 1, y: 1 })).toBeUndefined()
  })
})
