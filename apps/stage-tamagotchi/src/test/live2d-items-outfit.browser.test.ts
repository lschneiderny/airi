import type { Renderer } from '@pixi/core'
import type { ItemExpressionDocument, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DItemRenderState, Live2DStageItem } from '@proj-airi/stage-ui-live2d/composables/live2d/items/layer'
import type { Live2DCanvasScale } from '@proj-airi/stage-ui-live2d/composables/live2d/items/pin'
import type { StageItemFormat } from '@proj-airi/stage-ui-live2d/utils/stage-item-validator'
import type { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

import type { Live2DModelFixture } from './live2d-model-fixture'

import { Filter } from '@pixi/core'
import { Ticker } from '@pixi/ticker'
import { MAX_SHOWN_LIVE2D_ITEMS } from '@proj-airi/stage-shared/expression-performance'
import { Live2DItems } from '@proj-airi/stage-ui-live2d/components/scenes/live2d'
import { Live2DItemLayer } from '@proj-airi/stage-ui-live2d/composables/live2d/items/layer'
import { Live2DItemModel } from '@proj-airi/stage-ui-live2d/composables/live2d/items/live2d-item'
import { live2DUnitToCanvasX, live2DUnitToCanvasY } from '@proj-airi/stage-ui-live2d/composables/live2d/items/pin'
import { canvasAlignedPlacement } from '@proj-airi/stage-ui-live2d/composables/live2d/items/pose'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, h, shallowRef } from 'vue'

import { createLive2DModelFixture } from './live2d-model-fixture'

import '@proj-airi/stage-ui-live2d/utils/live2d-opfs-registration'

const width = 768
const height = 512
/** Her model's delta and the item clock advance by this same injected step. */
const stepMs = 1000 / 60
/** Bounds every wait on an emitted state or a model event. */
const signalTimeoutMs = 10_000
/** The preset model, served by the browser project; loaded as the item it is also her model. */
const itemUrl = new URL('../../../../packages/stage-ui/src/assets/live2d/models/hiyori_free_zh.zip', import.meta.url).href

type States = Readonly<Record<string, Live2DItemRenderState>>
type Her = Live2DModel<Cubism4InternalModel>

function placement(overrides: Partial<StageItemPlacement>): StageItemPlacement {
  return { x: 0, y: 0, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' }, ...overrides }
}

function stageItem(name: string, url: string, format: StageItemFormat, overrides: Partial<ItemExpressionDocument>): Live2DStageItem {
  return {
    document: { id: `item:${name}`, assetId: `asset-${name}`, label: name, kind: 'outfit', mappings: [], exposedToLlm: false, placement: placement({}), hides: [], link: 'none', ...overrides },
    url,
    format,
  }
}

function solidPng() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgb(0,255,0)'
  context.fillRect(0, 0, 4, 4)
  return canvas.toDataURL('image/png')
}

/** Swaps red and blue, so her render target is the filter's texture rather than the screen. */
function channelSwapFilter() {
  return new Filter(undefined, `
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    void main(void) { gl_FragColor = texture2D(uSampler, vTextureCoord).bgra; }
  `)
}

/** Resolves on the next emit of `event`, subscribed before the caller triggers it. */
function nextEvent(target: { once: (event: string, listener: () => void) => unknown }, event: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No ${event} within ${signalTimeoutMs} ms`)), signalTimeoutMs)
    target.once(event, () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function opfsEntryNames() {
  const names: string[] = []
  const root = await navigator.storage.getDirectory() as FileSystemDirectoryHandle & { keys: () => AsyncIterable<string> }
  for await (const name of root.keys())
    names.push(name)
  return names.sort()
}

/** Records the state reports of a layer or the scene component, and waits on them. */
function stateLog() {
  let latest: States = {}
  const listeners = new Set<(states: States) => void>()
  return {
    report(states: States) {
      latest = states
      for (const listener of listeners)
        listener(states)
    },
    until(accept: (states: States) => boolean) {
      if (accept(latest))
        return Promise.resolve(latest)
      return new Promise<States>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        const listener = (states: States) => {
          if (!accept(states))
            return
          clearTimeout(timeout)
          listeners.delete(listener)
          resolve(states)
        }
        timeout = setTimeout(() => {
          listeners.delete(listener)
          reject(new Error(`No matching item states within ${signalTimeoutMs} ms; last report: ${JSON.stringify(latest)}`))
        }, signalTimeoutMs)
        listeners.add(listener)
      })
    },
  }
}

describe('live2D items, hide lists, and parameter mirroring', () => {
  let fixture: Live2DModelFixture
  let renderer: Renderer
  let her: Her
  let scale: Live2DCanvasScale
  const layers: Live2DItemLayer[] = []
  const cleanups: (() => void)[] = []

  function place(model: Her) {
    const modelScale = height / model.internalModel.height
    model.scale.set(modelScale)
    model.x = (width - model.internalModel.width * modelScale) / 2
    fixture.app.stage.addChild(model)
  }

  /** A model of her own that no other test updated, alone on the stage. */
  async function freshHer() {
    const model = await fixture.loadModel()
    fixture.app.stage.removeChild(her)
    place(model)
    cleanups.push(() => {
      fixture.app.stage.removeChild(model)
      fixture.app.stage.addChild(her)
    })
    return model
  }

  function attachLayer(model: Her) {
    const log = stateLog()
    const layer = new Live2DItemLayer(model, renderer.screen, states => log.report(states))
    layers.push(layer)
    return { layer, until: log.until }
  }

  function outfit(name: string, overrides: Partial<ItemExpressionDocument> = {}) {
    return stageItem(name, itemUrl, 'live2d-zip', { placement: placement(canvasAlignedPlacement(scale, scale)), link: 'parameters', ...overrides })
  }

  function frame(model: Her, layer: Live2DItemLayer, animated = false) {
    model.update(stepMs)
    layer.advance(stepMs, animated)
    fixture.renderFrame()
  }

  function loadedItems() {
    const load = vi.spyOn(Live2DItemModel, 'load')
    return async (index = 0) => await load.mock.results[index].value as Live2DItemModel
  }

  beforeAll(async () => {
    // As `Canvas.vue` does, so a model that asked for auto update would join `Ticker.shared`.
    Live2DModel.registerTicker(Ticker)
    fixture = createLive2DModelFixture({ width, height })
    renderer = fixture.app.renderer as Renderer
    her = await fixture.loadModel()
    place(her)
    const internalModel = her.internalModel
    scale = { pixelsPerUnit: internalModel.pixelsPerUnit, originalWidth: internalModel.originalWidth, originalHeight: internalModel.originalHeight }
    her.update(stepMs)
    fixture.renderFrame()
  }, 60_000)

  afterEach(() => {
    for (const layer of layers.splice(0))
      layer.destroy()
    for (const cleanup of cleanups.splice(0).reverse())
      cleanup()
    vi.restoreAllMocks()
    her.filters = []
  })

  afterAll(() => {
    fixture.destroy()
  })

  it('mirrors her final parameters into a linked item in the same frame', async () => {
    const { layer, until } = attachLayer(her)
    const item = loadedItems()
    layer.setItems([outfit('dress')])
    await until(states => states['item:dress'] === 'attached')
    const itemCore = (await item()).model.internalModel.coreModel
    const herCore = her.internalModel.coreModel

    const final = { angle: Number.NaN, body: Number.NaN }
    const capture = () => {
      final.angle = herCore.getParameterValueById('ParamAngleX')
      final.body = herCore.getParameterValueById('ParamBodyAngleX')
    }
    her.internalModel.on('beforeModelUpdate', capture)
    cleanups.push(() => her.internalModel.off('beforeModelUpdate', capture))

    herCore.setParameterValueById('ParamAngleX', 25)
    herCore.setParameterValueById('ParamBodyAngleX', -7)
    frame(her, layer)
    expect(final.angle).toBeCloseTo(25, 0)
    expect(itemCore.getParameterValueById('ParamAngleX')).toBe(final.angle)
    expect(itemCore.getParameterValueById('ParamBodyAngleX')).toBe(final.body)
    herCore.setParameterValueById('ParamAngleX', 0)
    herCore.setParameterValueById('ParamBodyAngleX', 0)
  })

  it('draws a linked, canvas-aligned outfit of her own model with her vertices in the same frame', async () => {
    const model = await freshHer()
    const { layer, until } = attachLayer(model)
    const item = loadedItems()
    const dress = outfit('dress')
    layer.setItems([dress])
    await until(states => states['item:dress'] === 'attached')
    const itemModel = (await item()).model
    const herCore = model.internalModel.coreModel
    const itemCore = itemModel.internalModel.coreModel
    const itemScale = { pixelsPerUnit: itemModel.internalModel.pixelsPerUnit, originalWidth: itemModel.internalModel.originalWidth, originalHeight: itemModel.internalModel.originalHeight }
    const { x, y, scale: itemPlacementScale, anchor } = dress.document.placement
    const drawableCount = herCore.getDrawableCount()
    const head = herCore.getDrawableIndex('ArtMesh44')
    let headTravel = 0
    let previousHeadX = Number.NaN

    for (let step = 0; step < 30; step++) {
      // Her head and body move every frame; her SDK breath and physics run on top.
      herCore.setParameterValueById('ParamAngleX', 30 * Math.sin(step / 4))
      herCore.setParameterValueById('ParamBodyAngleX', 8 * Math.cos(step / 5))
      frame(model, layer)

      let worst = 0
      for (let index = 0; index < drawableCount; index++) {
        const mine = herCore.getDrawableVertexPositions(index)
        const worn = itemCore.getDrawableVertexPositions(index)
        for (let at = 0; at < mine.length; at += 2) {
          const wornX = x + (live2DUnitToCanvasX(worn[at], itemScale) - anchor.x * itemScale.originalWidth) * itemPlacementScale
          const wornY = y + (live2DUnitToCanvasY(worn[at + 1], itemScale) - anchor.y * itemScale.originalHeight) * itemPlacementScale
          worst = Math.max(worst, Math.abs(wornX - live2DUnitToCanvasX(mine[at], scale)), Math.abs(wornY - live2DUnitToCanvasY(mine[at + 1], scale)))
        }
      }
      expect(worst, `frame ${step}`).toBeLessThan(1e-4)

      const headX = live2DUnitToCanvasX(herCore.getDrawableVertexPositions(head)[0], scale)
      if (!Number.isNaN(previousHeadX))
        headTravel += Math.abs(headX - previousHeadX)
      previousHeadX = headX
    }
    // Her head moved far enough that a frame of lag or a missing mirror would show.
    expect(headTravel).toBeGreaterThan(50)
  })

  it('hides the parts in a hide list, reports an unknown part, and restores the baseline once', async () => {
    const { layer, until } = attachLayer(her)
    const coreModel = her.internalModel.coreModel
    const face = coreModel.getDrawableIndex('ArtMesh44')
    const partFace = coreModel.getModel().parts.ids.indexOf('PartFace')
    expect(partFace).toBeGreaterThanOrEqual(0)
    frame(her, layer)
    const baseline = coreModel.getPartOpacityByIndex(partFace)
    expect(baseline).toBe(1)
    expect(coreModel.getDrawableOpacity(face)).toBe(1)

    const badge = (hides: string[]) => stageItem('badge', solidPng(), 'image', { kind: 'prop', hides, placement: placement({ x: 100, y: 100 }) })
    layer.setItems([badge(['PartFace', 'NoSuchPart'])])
    await until(states => states['item:badge'] === 'missing-part')
    expect(() => frame(her, layer)).not.toThrow()
    expect(coreModel.getDrawableOpacity(face)).toBe(0)
    expect(coreModel.getDrawableDynamicFlagIsVisible(face)).toBe(false)

    layer.setItems([badge([])])
    await until(states => states['item:badge'] === 'attached')
    frame(her, layer)
    expect(coreModel.getPartOpacityByIndex(partFace)).toBe(baseline)
    expect(coreModel.getDrawableOpacity(face)).toBe(1)

    // Restored once: a later writer of that part keeps its value.
    coreModel.setPartOpacityByIndex(partFace, 0.5)
    frame(her, layer)
    expect(coreModel.getPartOpacityByIndex(partFace)).toBe(0.5)
    coreModel.setPartOpacityByIndex(partFace, baseline)
  })

  it('leaves her parameters, parts, and vertices exactly as without a layer when no item shows', async () => {
    const withLayer = await freshHer()
    const without = await fixture.loadModel()
    fixture.app.stage.addChild(without)
    cleanups.push(() => fixture.app.stage.removeChild(without))
    const { layer } = attachLayer(withLayer)
    layer.setItems([])
    expect(withLayer.itemInsertions).toBeUndefined()
    // SDK eye blink draws its timing from Math.random; both models drop it so the inputs match.
    delete withLayer.internalModel.eyeBlink
    delete without.internalModel.eyeBlink

    for (let step = 0; step < 10; step++) {
      for (const model of [withLayer, without]) {
        model.internalModel.coreModel.setParameterValueById('ParamAngleX', 20 * Math.sin(step / 3))
        model.update(stepMs)
      }
      layer.advance(stepMs, false)
      fixture.renderFrame()
    }
    const a = withLayer.internalModel.coreModel
    const b = without.internalModel.coreModel
    for (let index = 0; index < a.getParameterCount(); index++)
      expect(a.getParameterValueByIndex(index)).toBe(b.getParameterValueByIndex(index))
    for (let index = 0; index < a.getPartCount(); index++)
      expect(a.getPartOpacityByIndex(index)).toBe(b.getPartOpacityByIndex(index))
    for (let index = 0; index < a.getDrawableCount(); index++)
      expect([...a.getDrawableVertexPositions(index)]).toEqual([...b.getDrawableVertexPositions(index)])
  })

  describe.each([
    { filtered: false },
    { filtered: true },
  ])('a clip-masked Live2D item inserted before her clip-masked drawables with filters $filtered', ({ filtered }) => {
    /**
     * Draws her with a small clip-masked copy of the model inserted right before her
     * clip-masked drawables, then the same pose without it, and compares her pixels.
     * `afterInsert` runs right after the item's insert, before her next range.
     */
    async function compareWithoutItem(afterInsert?: () => void) {
      const coreModel = her.internalModel.coreModel
      const drawableCount = coreModel.getDrawableCount()
      const renderOrders = coreModel.getDrawableRenderOrders()
      const maskCounts = coreModel.getDrawableMaskCounts()
      let split = drawableCount
      for (let index = 0; index < drawableCount; index++) {
        if (maskCounts[index] > 0 && coreModel.getDrawableDynamicFlagIsVisible(index))
          split = Math.min(split, renderOrders[index])
      }
      let anchor = -1
      for (let index = 0; index < drawableCount; index++) {
        if (renderOrders[index] === split - 1)
          anchor = index
      }
      expect(anchor).toBeGreaterThanOrEqual(0)

      // A small copy of the model, clip-masked eyes included, left of her canvas frame.
      const toCanvas = her.worldTransform.clone().append(her.internalModel.localTransform)
      const leftOfHer = toCanvas.applyInverse({ x: 90, y: height / 2 })
      if (filtered)
        her.filters = [channelSwapFilter()]
      const { layer, until } = attachLayer(her)
      layer.setItems([stageItem('mini', itemUrl, 'live2d-zip', {
        kind: 'prop',
        placement: placement({ x: leftOfHer.x, y: leftOfHer.y, scale: 0.3, layer: { kind: 'above', drawableId: coreModel.getDrawableId(anchor) } }),
      })])
      await until(states => states['item:mini'] === 'attached')
      const hook = her.itemInsertions!
      if (afterInsert) {
        her.itemInsertions = {
          segments: (internalModel, frameRenderer) => hook.segments(internalModel, frameRenderer).map(segment => segment.kind === 'insert'
            ? { kind: 'insert', render: (insertRenderer: Renderer) => {
                segment.render(insertRenderer)
                afterInsert()
              } }
            : segment),
        }
      }
      // Two frames: the item uploads its textures and draws its masks on the first.
      frame(her, layer)
      frame(her, layer)
      const withItem = fixture.readPixels()
      her.itemInsertions = hook
      layer.setItems([])
      // No update: her deltaTime is 0, so this frame redraws the same pose without the hook,
      // through a filter frame of the same size as with items.
      const modelFilterArea = her.filterArea
      her.filterArea = renderer.screen
      fixture.renderFrame()
      her.filterArea = modelFilterArea
      const withoutItem = fixture.readPixels()

      const mismatchAt: string[] = []
      let herMismatches = 0
      let itemPixels = 0
      let herPixels = 0
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          const offset = (row * width + column) * 4
          const differs = withItem[offset] !== withoutItem[offset] || withItem[offset + 1] !== withoutItem[offset + 1]
            || withItem[offset + 2] !== withoutItem[offset + 2] || withItem[offset + 3] !== withoutItem[offset + 3]
          if (column >= 180) {
            if (differs) {
              herMismatches++
              mismatchAt.push(`${column},${height - 1 - row}`)
            }
            if (withoutItem[offset + 3] === 255)
              herPixels++
          }
          else if (withItem[offset + 3] > 0) {
            itemPixels++
          }
        }
      }
      expect(itemPixels).toBeGreaterThan(1_000)
      expect(herPixels).toBeGreaterThan(10_000)
      expect(herMismatches, mismatchAt.slice(0, 8).join(' ')).toBe(0)
    }

    it('leaves every pixel of hers outside the item equal to the frame without it', async () => {
      await compareWithoutItem()
    })

    // The nested Cubism draw restores the binding and state her ranges need by itself, so this
    // insert also leaves a stray framebuffer bound and a 1-pixel scissor on: only the renderer's
    // restore between ranges (`resumeRangeDraw`) brings her clip-masked drawables back.
    it('restores her render target and fixed state when an insert leaves them changed', async () => {
      const gl = fixture.gl
      const stray = gl.createFramebuffer()
      try {
        await compareWithoutItem(() => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, stray)
          gl.enable(gl.SCISSOR_TEST)
          gl.scissor(0, 0, 1, 1)
        })
      }
      finally {
        gl.disable(gl.SCISSOR_TEST)
        gl.deleteFramebuffer(stray)
      }
    })
  })

  it('never loads a Live2D item past the limit and still shows the other items', async () => {
    const load = vi.spyOn(Live2DItemModel, 'load').mockImplementation(() => new Promise(() => {}))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { layer, until } = attachLayer(her)
    const models = Array.from({ length: MAX_SHOWN_LIVE2D_ITEMS + 1 }, (_, index) => outfit(`model-${index}`, { link: 'none' }))
    layer.setItems([...models, stageItem('badge', solidPng(), 'image', { kind: 'prop' })])
    await until(states => states['item:badge'] === 'attached')
    expect(load).toHaveBeenCalledTimes(MAX_SHOWN_LIVE2D_ITEMS)
    expect(warn).toHaveBeenCalledWith(expect.any(String), `item:model-${MAX_SHOWN_LIVE2D_ITEMS}`)
  })

  it('destroys a hidden item model and its textures, keeps it off Ticker.shared, and creates no OPFS entry', async () => {
    const managedTextures = () => renderer.texture.managedTextures.length
    const opfsBefore = await opfsEntryNames()
    const sharedListeners = Ticker.shared.count
    fixture.renderFrame()
    const baseline = managedTextures()
    const { layer, until } = attachLayer(her)
    const item = loadedItems()
    layer.setItems([outfit('dress')])
    await until(states => states['item:dress'] === 'attached')
    const itemModel = (await item()).model
    frame(her, layer)
    expect(managedTextures()).toBeGreaterThan(baseline)
    expect(itemModel.autoUpdate).toBe(false)
    expect(Ticker.shared.count).toBe(sharedListeners)

    layer.setItems([])
    await until(states => !('item:dress' in states))
    expect(itemModel.destroyed).toBe(true)
    expect(her.itemInsertions).toBeUndefined()
    frame(her, layer)
    expect(managedTextures()).toBe(baseline)
    expect(await opfsEntryNames()).toEqual(opfsBefore)
  })

  it('releases an item model whose load finishes after a hide or after the layer went away', async () => {
    const item = loadedItems()
    const { layer } = attachLayer(her)
    layer.setItems([outfit('hidden-early')])
    layer.setItems([])
    const hidden = await item(0)
    expect(hidden.model.destroyed).toBe(true)

    const other = attachLayer(her)
    other.layer.setItems([outfit('swapped-early')])
    other.layer.destroy()
    const swapped = await item(1)
    expect(swapped.model.destroyed).toBe(true)
    expect(her.itemInsertions).toBeUndefined()
    expect(her.children).toHaveLength(0)
  })

  it('reports a corrupt item zip as failed without throwing and keeps drawing the other items', async () => {
    const corrupt = URL.createObjectURL(new Blob([new Uint8Array([0x50, 0x4B, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8])], { type: 'application/zip' }))
    cleanups.push(() => URL.revokeObjectURL(corrupt))
    const { layer, until } = attachLayer(her)
    layer.setItems([
      stageItem('broken', corrupt, 'live2d-zip', { kind: 'prop' }),
      stageItem('badge', solidPng(), 'image', { kind: 'prop', placement: placement({ x: 100, y: 100 }) }),
    ])
    await until(states => states['item:broken'] === 'failed' && states['item:badge'] === 'attached')
    expect(() => frame(her, layer)).not.toThrow()
    expect(her.itemInsertions).toBeDefined()
  })

  it('plays the item idle motion only while motion is not reduced', async () => {
    const { layer, until } = attachLayer(her)
    const item = loadedItems()
    layer.setItems([outfit('dress', { link: 'none' })])
    await until(states => states['item:dress'] === 'attached')
    const motionManager = (await item()).model.internalModel.motionManager
    const started = vi.spyOn(motionManager, 'startRandomMotion')
    for (let step = 0; step < 5; step++)
      frame(her, layer, false)
    expect(started).not.toHaveBeenCalled()

    const idle = nextEvent(motionManager, 'motionStart')
    frame(her, layer, true)
    expect(started).toHaveBeenCalledWith(motionManager.groups.idle, expect.anything())
    await idle
  })

  it('freezes a Live2D item while the app is paused and does not integrate the paused time on resume', async () => {
    const item = loadedItems()
    const log = stateLog()
    const root = document.createElement('div')
    document.body.append(root)
    const host = createApp({
      render: () => h(Live2DItems, { app: fixture.app, model: her, items: [outfit('dress', { link: 'none' })], onStates: log.report }),
    })
    host.mount(root)
    cleanups.push(() => {
      host.unmount()
      root.remove()
    })
    await log.until(states => states['item:dress'] === 'attached')
    const itemModel = (await item()).model
    const motionManager = itemModel.internalModel.motionManager
    const ticker = fixture.app.ticker

    // The stage ticker steps the item clock and renders; the item starts its idle motion.
    const idle = nextEvent(motionManager, 'motionStart')
    ticker.lastTime = 1000
    ticker.update(1000 + stepMs)
    await idle
    ticker.update(1000 + 2 * stepMs)
    const elapsed = itemModel.elapsedTime
    const hair = itemModel.internalModel.coreModel.getDrawableIndex('ArtMesh44')
    const pose = [...itemModel.internalModel.coreModel.getDrawableVertexPositions(hair)]

    fixture.app.stop()
    fixture.renderFrame()
    fixture.renderFrame()
    expect(itemModel.elapsedTime).toBe(elapsed)
    expect([...itemModel.internalModel.coreModel.getDrawableVertexPositions(hair)]).toEqual(pose)

    // Resuming restarts the ticker's time base, so the first tick counts only its own frame.
    fixture.app.start()
    fixture.app.stop()
    ticker.update(ticker.lastTime + 10)
    expect(itemModel.elapsedTime).toBe(elapsed + 10)
  })

  it('keeps no item model alive or on Ticker.shared after her model is swapped', async () => {
    const sharedListeners = Ticker.shared.count
    const item = loadedItems()
    const destroyed = vi.spyOn(Live2DItemModel.prototype, 'destroy')
    const log = stateLog()
    const model = shallowRef<Her>(her)
    const root = document.createElement('div')
    document.body.append(root)
    const host = createApp({
      render: () => h(Live2DItems, { app: fixture.app, model: model.value, items: [outfit('dress')], onStates: log.report }),
    })
    host.mount(root)
    cleanups.push(() => {
      host.unmount()
      root.remove()
    })
    await log.until(states => states['item:dress'] === 'attached')
    const first = await item(0)

    const next = await fixture.loadModel()
    model.value = next
    await log.until(states => Object.keys(states).length === 0)
    expect(first.model.destroyed).toBe(true)
    expect(her.itemInsertions).toBeUndefined()
    await log.until(states => states['item:dress'] === 'attached')
    expect(next.itemInsertions).toBeDefined()
    expect(destroyed).toHaveBeenCalledTimes(1)
    expect(Ticker.shared.count).toBe(sharedListeners)
  })
})
