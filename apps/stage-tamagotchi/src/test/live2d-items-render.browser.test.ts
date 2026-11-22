import type { Renderer } from '@pixi/core'
import type { StageItemPin, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DItemRenderState, Live2DStageItem } from '@proj-airi/stage-ui-live2d/composables/live2d/items/layer'
import type { Live2DCanvasScale } from '@proj-airi/stage-ui-live2d/composables/live2d/items/pin'
import type { StageItemFormat } from '@proj-airi/stage-ui-live2d/utils/stage-item-validator'
import type { Cubism4InternalModel, Live2DModel } from 'pixi-live2d-display/cubism4'

import type { Live2DModelFixture } from './live2d-model-fixture'

import { Filter, Texture } from '@pixi/core'
import { Sprite } from '@pixi/sprite'
import { Live2DItems } from '@proj-airi/stage-ui-live2d/components/scenes/live2d'
import { Live2DGifTexture } from '@proj-airi/stage-ui-live2d/composables/live2d/items/gif-texture'
import { live2DUnitToCanvasX, live2DUnitToCanvasY, pickLive2DItemPin } from '@proj-airi/stage-ui-live2d/composables/live2d/items/pin'
import { ScreenAmbientLightFilter } from '@proj-airi/stage-ui-live2d/filters/screen-ambient-light'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowRef } from 'vue'

import { createLive2DModelFixture } from './live2d-model-fixture'

const width = 768
const height = 512
type Rgb = readonly [number, number, number]
const red: Rgb = [255, 0, 0]
const green: Rgb = [0, 255, 0]
const blue: Rgb = [0, 0, 255]
const magenta: Rgb = [255, 0, 255]
const cyan: Rgb = [0, 255, 255]
/** Bounds every wait on an emitted state or a decoded frame. */
const signalTimeoutMs = 10_000

type States = Readonly<Record<string, Live2DItemRenderState>>

function pixelIndex(x: number, y: number) {
  // `readPixels` returns the bottom row first.
  return (height - 1 - y) * width + x
}

function isColor(pixels: Uint8Array, pixel: number, color: Rgb) {
  const offset = pixel * 4
  return pixels[offset] === color[0] && pixels[offset + 1] === color[1] && pixels[offset + 2] === color[2] && pixels[offset + 3] === 255
}

function colorAt(pixels: Uint8Array, x: number, y: number) {
  const offset = pixelIndex(Math.round(x), Math.round(y)) * 4
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]]
}

function countPixels(where: (pixel: number) => boolean) {
  let count = 0
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (where(pixel))
      count++
  }
  return count
}

function countMismatches(a: Uint8Array, b: Uint8Array) {
  return countPixels((pixel) => {
    const offset = pixel * 4
    return a[offset] !== b[offset] || a[offset + 1] !== b[offset + 1] || a[offset + 2] !== b[offset + 2] || a[offset + 3] !== b[offset + 3]
  })
}

/** The mean screen position of the pixels of one exact color, top-left origin. */
function centroidOf(pixels: Uint8Array, color: Rgb) {
  let sumX = 0
  let sumY = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isColor(pixels, pixelIndex(x, y), color)) {
        sumX += x + 0.5
        sumY += y + 0.5
        count++
      }
    }
  }
  return { x: sumX / count, y: sumY / count, count }
}

function solidPng(color: Rgb, size = 4) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = `rgb(${color.join(',')})`
  context.fillRect(0, 0, size, size)
  return canvas.toDataURL('image/png')
}

const gifColors = [red, green, blue, [0, 0, 0] as Rgb]

/**
 * Encodes a 2x2 GIF89a whose frame `f` is filled with `gifColors[colorIndices[f]]`, with
 * the stated delays in centiseconds. Each pixel is written as a clear code and a 3-bit
 * color code, so the LZW code size never grows. `corruptFrame` writes codes past the
 * code table into that frame: Chromium then parses the frame count and decodes the
 * other frames, and rejects that one frame.
 */
function encodeGif(colorIndices: number[], delaysCs: number[], corruptFrame?: number) {
  const bytes: number[] = [...'GIF89a'].map(character => character.charCodeAt(0))
  const push16 = (value: number) => bytes.push(value & 0xFF, value >> 8)
  push16(2)
  push16(2)
  bytes.push(0x81, 0, 0, ...gifColors.flat())
  colorIndices.forEach((colorIndex, frame) => {
    bytes.push(0x21, 0xF9, 4, 0, delaysCs[frame] & 0xFF, delaysCs[frame] >> 8, 0, 0)
    bytes.push(0x2C)
    push16(0)
    push16(0)
    push16(2)
    push16(2)
    bytes.push(0, 2)
    const codes = frame === corruptFrame ? [7, 7, 7, 7, 5] : [4, colorIndex, 4, colorIndex, 4, colorIndex, 4, colorIndex, 5]
    const data: number[] = []
    let accumulator = 0
    let bits = 0
    for (const code of codes) {
      accumulator |= code << bits
      bits += 3
      while (bits >= 8) {
        data.push(accumulator & 0xFF)
        accumulator >>= 8
        bits -= 8
      }
    }
    if (bits > 0)
      data.push(accumulator & 0xFF)
    bytes.push(data.length, ...data, 0)
  })
  bytes.push(0x3B)
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }))
}

function placement(overrides: Partial<StageItemPlacement>): StageItemPlacement {
  return { x: 0, y: 0, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' }, ...overrides }
}

function stageItem(name: string, url: string, format: StageItemFormat, itemPlacement: StageItemPlacement): Live2DStageItem {
  return {
    document: { id: `item:${name}`, assetId: name, label: name, kind: 'prop', mappings: [], exposedToLlm: false, placement: itemPlacement, hides: [], link: 'none' },
    url,
    format,
  }
}

/** Swaps red and blue, so a pixel the filter did not process is told apart from one it did. */
function channelSwapFilter() {
  return new Filter(undefined, `
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    void main(void) { gl_FragColor = texture2D(uSampler, vTextureCoord).bgra; }
  `)
}

describe('live2D stage items render', () => {
  let fixture: Live2DModelFixture
  let model: Live2DModel<Cubism4InternalModel>
  let renderer: Renderer
  let scale: Live2DCanvasScale
  let drawableCount: number
  /** The first render-order position of a visible clip-masked drawable. */
  let split: number
  let unhooked: Uint8Array
  let modelFilterArea: Live2DModel['filterArea']
  const blobUrls: string[] = []
  let unmountCurrent: (() => void) | undefined

  function canvasToScreen() {
    return model.worldTransform.clone().append(model.internalModel.localTransform)
  }

  /** The placement scale that draws an item `sizePx` texture pixels wide as `screenPx` screen pixels. */
  function scaleForScreen(screenPx: number, sizePx = 4) {
    const transform = canvasToScreen()
    return screenPx / (sizePx * Math.hypot(transform.a, transform.b))
  }

  function screenToCanvas(x: number, y: number) {
    return canvasToScreen().applyInverse({ x, y })
  }

  function gifUrl(colorIndices: number[], delaysCs: number[], corruptFrame?: number) {
    const url = encodeGif(colorIndices, delaysCs, corruptFrame)
    blobUrls.push(url)
    return url
  }

  /** Mounts the scene component as `Model.vue` does, with a reactive model and item list. */
  function mountItems(initial: Live2DStageItem[]) {
    const items = shallowRef<readonly Live2DStageItem[]>(initial)
    const itemModel = shallowRef<Live2DModel>(model)
    let latest: States = {}
    const listeners = new Set<(states: States) => void>()
    const root = document.createElement('div')
    document.body.append(root)
    const host = createApp({
      render: () => h(Live2DItems, {
        app: fixture.app,
        model: itemModel.value,
        items: items.value,
        onStates: (states: States) => {
          latest = states
          for (const listener of listeners)
            listener(states)
        },
      }),
    })
    host.mount(root)
    const unmount = () => {
      host.unmount()
      root.remove()
      unmountCurrent = undefined
    }
    unmountCurrent = unmount
    return {
      items,
      model: itemModel,
      unmount,
      /** Resolves with the first report, the current one included, that satisfies `accept`. */
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

  /** Resolves when a texture re-uploads its source, which a GIF does once per presented frame. */
  function nextUpload(texture: Texture) {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`No frame upload within ${signalTimeoutMs} ms`)), signalTimeoutMs)
      texture.baseTexture.once('update', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  function render() {
    fixture.renderFrame()
    return fixture.readPixels()
  }

  beforeAll(async () => {
    fixture = createLive2DModelFixture({ width, height })
    model = await fixture.loadModel()
    renderer = fixture.app.renderer as Renderer
    const internalModel = model.internalModel
    const modelScale = height / internalModel.height
    model.scale.set(modelScale)
    model.x = (width - internalModel.width * modelScale) / 2
    fixture.app.stage.addChild(model)
    scale = { pixelsPerUnit: internalModel.pixelsPerUnit, originalWidth: internalModel.originalWidth, originalHeight: internalModel.originalHeight }
    modelFilterArea = model.filterArea

    model.update(1000 / 60)
    fixture.renderFrame()
    unhooked = render()

    const coreModel = internalModel.coreModel
    drawableCount = coreModel.getDrawableCount()
    const renderOrders = coreModel.getDrawableRenderOrders()
    const maskCounts = coreModel.getDrawableMaskCounts()
    split = drawableCount
    for (let index = 0; index < drawableCount; index++) {
      if (maskCounts[index] > 0 && coreModel.getDrawableDynamicFlagIsVisible(index))
        split = Math.min(split, renderOrders[index])
    }
    for (const color of [red, green, blue, magenta, cyan])
      expect(countPixels(pixel => isColor(unhooked, pixel, color))).toBe(0)
  }, 60_000)

  afterEach(() => {
    unmountCurrent?.()
    vi.restoreAllMocks()
    model.filters = []
    model.itemInsertions = undefined
  })

  afterAll(() => {
    for (const url of blobUrls)
      URL.revokeObjectURL(url)
    fixture.destroy()
  })

  it('leaves the hook unset and her frame RGBA-identical with zero items', async () => {
    // Her own frame without the component, after whatever updates earlier tests made.
    const withoutItems = render()
    const mounted = mountItems([])
    expect(model.itemInsertions).toBeUndefined()
    expect(model.filterArea).toBe(modelFilterArea)
    expect(countMismatches(render(), withoutItems)).toBe(0)

    // Showing an item and taking it away again restores the unhooked frame.
    mounted.items.value = [stageItem('dot', solidPng(green), 'image', placement({ x: scale.originalWidth / 2, y: scale.originalHeight / 2, scale: scaleForScreen(12) }))]
    await mounted.until(states => states['item:dot'] === 'attached')
    expect(model.itemInsertions).toBeDefined()
    expect(countMismatches(render(), withoutItems)).toBeGreaterThan(0)
    mounted.items.value = []
    await mounted.until(states => Object.keys(states).length === 0)
    expect(model.itemInsertions).toBeUndefined()
    expect(model.filterArea).toBe(modelFilterArea)
    expect(countMismatches(render(), withoutItems)).toBe(0)
  })

  it('places a pinned front item at the barycentric point of the current frame', async () => {
    const coreModel = model.internalModel.coreModel
    const face = coreModel.getDrawableIndex('ArtMesh44')
    const positions = coreModel.getDrawableVertexPositions(face)
    let sumX = 0
    let sumY = 0
    const vertexCount = coreModel.getDrawableVertexCount(face)
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      sumX += live2DUnitToCanvasX(positions[vertex * 2], scale)
      sumY += live2DUnitToCanvasY(positions[vertex * 2 + 1], scale)
    }
    const picked = pickLive2DItemPin({ x: sumX / vertexCount, y: sumY / vertexCount }, coreModel, scale, new Set())
    expect(picked).toBeDefined()
    const pin: StageItemPin = { ...picked!, vertices: [...picked!.vertices], weights: [...picked!.weights], reference: [...picked!.reference] }

    const mounted = mountItems([stageItem('badge', solidPng(green), 'image', placement({ scale: scaleForScreen(12), pin }))])
    await mounted.until(states => states['item:badge'] === 'attached')

    const pinPoint = () => {
      const index = coreModel.getDrawableIndex(pin!.drawableId)
      const current = coreModel.getDrawableVertexPositions(index)
      let x = 0
      let y = 0
      pin!.vertices.forEach((vertex, corner) => {
        x += pin!.weights[corner] * live2DUnitToCanvasX(current[vertex * 2], scale)
        y += pin!.weights[corner] * live2DUnitToCanvasY(current[vertex * 2 + 1], scale)
      })
      return canvasToScreen().apply({ x, y })
    }

    const turnHead = (angle: number) => {
      coreModel.setParameterValueById('ParamAngleX', angle)
      model.update(1000 / 60)
      const pixels = render()
      return { expected: pinPoint(), drawn: centroidOf(pixels, green) }
    }

    const right = turnHead(30)
    const left = turnHead(-30)
    // The head moved far enough on screen that a frame of lag would show.
    expect(Math.hypot(right.expected.x - left.expected.x, right.expected.y - left.expected.y)).toBeGreaterThan(3)
    for (const { expected, drawn } of [right, left]) {
      expect(drawn.count).toBeGreaterThan(50)
      expect(Math.abs(drawn.x - expected.x)).toBeLessThan(1)
      expect(Math.abs(drawn.y - expected.y)).toBeLessThan(1)
    }
    coreModel.setParameterValueById('ParamAngleX', 0)
    model.update(1000 / 60)
    fixture.renderFrame()
  })

  /** An opaque item that covers the whole screen, so the exact reference is a full-screen sprite of its color. */
  function screenCover(name: string, color: Rgb, layer: StageItemPlacement['layer']) {
    const center = screenToCanvas(width / 2, height / 2)
    return stageItem(name, solidPng(color), 'image', placement({ x: center.x, y: center.y, scale: scaleForScreen(4 * Math.max(width, height)), layer }))
  }

  function screenSprite(color: Rgb) {
    const sprite = new Sprite(Texture.WHITE)
    sprite.tint = (color[0] << 16) | (color[1] << 8) | color[2]
    sprite.width = width
    sprite.height = height
    return sprite
  }

  it('draws a behind item under all of her and fails the reference when drawn in front', async () => {
    const mounted = mountItems([screenCover('backdrop', blue, { kind: 'behind' })])
    await mounted.until(states => states['item:backdrop'] === 'attached')
    const behind = render()

    mounted.items.value = [screenCover('backdrop', blue, { kind: 'front' })]
    await nextTick()
    const front = render()
    mounted.unmount()

    // The exact reference: the same color drawn by Pixi as a sibling behind her.
    const sprite = screenSprite(blue)
    fixture.app.stage.addChildAt(sprite, 0)
    const reference = render()
    fixture.app.stage.removeChild(sprite)
    sprite.destroy()

    expect(countMismatches(behind, reference)).toBe(0)
    // She covers the item where she is opaque.
    expect(countPixels(pixel => unhooked[pixel * 4 + 3] === 255 && !isColor(behind, pixel, blue))).toBeGreaterThan(10_000)
    // The mutated insertion, the same item in front of her, fails the same assertion.
    expect(countMismatches(front, reference)).toBeGreaterThan(10_000)
  })

  describe.each([
    { filtered: false },
    { filtered: true },
  ])('an above item with filters $filtered', ({ filtered }) => {
    it('is covered by her drawables above its anchor, clip-masked ones included', async () => {
      const coreModel = model.internalModel.coreModel
      const renderOrders = coreModel.getDrawableRenderOrders()
      let anchor = -1
      for (let index = 0; index < drawableCount; index++) {
        if (renderOrders[index] === split - 1)
          anchor = index
      }
      expect(anchor).toBeGreaterThanOrEqual(0)
      const filters = () => [channelSwapFilter(), new ScreenAmbientLightFilter()]

      if (filtered)
        model.filters = filters()
      const mounted = mountItems([screenCover('veil', red, { kind: 'above', drawableId: coreModel.getDrawableId(anchor) })])
      await mounted.until(states => states['item:veil'] === 'attached')
      expect(model.filterArea).toBe(renderer.screen)
      const inserted = render()
      mounted.unmount()
      model.filters = []

      // The exact reference: the same color drawn by Pixi behind her drawables from the
      // split on, through the same filters over the same screen-sized frame.
      const sprite = screenSprite(red)
      const group = new Sprite(Texture.EMPTY)
      fixture.app.stage.removeChild(model)
      group.addChild(sprite, model)
      if (filtered) {
        group.filters = filters()
        group.filterArea = renderer.screen
      }
      fixture.app.stage.addChild(group)
      model.itemInsertions = { segments: () => [{ kind: 'model', from: split, to: drawableCount }] }
      const reference = render()
      model.itemInsertions = undefined
      group.removeChild(model)
      fixture.app.stage.removeChild(group)
      fixture.app.stage.addChild(model)
      group.destroy({ children: true })

      expect(countMismatches(inserted, reference)).toBe(0)
      // The filter ran: red reads blue through the channel swap.
      expect(countPixels(pixel => isColor(inserted, pixel, filtered ? blue : red))).toBeGreaterThan(10_000)
    })
  })

  it('draws an item outside her canvas frame in full with her filters on and off', async () => {
    const position = screenToCanvas(50, 260)
    const mounted = mountItems([stageItem('outside', solidPng(magenta), 'image', placement({ x: position.x, y: position.y, scale: scaleForScreen(60) }))])
    await mounted.until(states => states['item:outside'] === 'attached')

    const unfilteredFrame = render()
    const unfiltered = countPixels(pixel => isColor(unfilteredFrame, pixel, magenta))
    expect(unfiltered).toBeGreaterThan(3_400)

    // Magenta reads the same through the channel swap, so the counts compare directly.
    model.filters = [channelSwapFilter(), new ScreenAmbientLightFilter()]
    const filteredFrame = render()
    expect(countPixels(pixel => isColor(filteredFrame, pixel, magenta))).toBe(unfiltered)

    // Control: her own filter frame, sized to her canvas, clips the item.
    const screenArea = model.filterArea
    model.filterArea = modelFilterArea
    const clipped = render()
    model.filterArea = screenArea
    expect(countPixels(pixel => isColor(clipped, pixel, magenta))).toBe(0)
  })

  it('plays a GIF on the stage ticker, freezes it while the app is paused, and does not jump on resume', async () => {
    const opened = vi.spyOn(Live2DGifTexture, 'open')
    const position = screenToCanvas(60, 120)
    const mounted = mountItems([stageItem('flag', gifUrl([0, 1, 2], [10, 20, 10]), 'gif', placement({ x: position.x, y: position.y, scale: scaleForScreen(20, 2) }))])
    await mounted.until(states => states['item:flag'] === 'attached')
    const gif = await opened.mock.results[0].value as Live2DGifTexture
    const shown = vi.spyOn(gif, 'show')
    const ticker = fixture.app.ticker

    // Frames last 100, 200, and 100 ms. Each update renders the stage after the item clock ticks.
    ticker.lastTime = 1000
    ticker.update(1050)
    expect(shown).toHaveBeenLastCalledWith(0)
    expect(colorAt(fixture.readPixels(), 60, 120)).toEqual([...red, 255])

    const uploaded = nextUpload(gif.texture)
    ticker.update(1150)
    expect(shown).toHaveBeenLastCalledWith(1)
    await uploaded
    expect(colorAt(render(), 60, 120)).toEqual([...green, 255])
    ticker.update(1250)
    expect(shown).toHaveBeenLastCalledWith(1)

    // Paused: the stage may still render, but the item clock does not run.
    fixture.app.stop()
    const callsWhilePaused = shown.mock.calls.length
    render()
    render()
    expect(shown.mock.calls.length).toBe(callsWhilePaused)

    // Resuming restarts the ticker's time base, so the first tick counts only its own frame.
    // At 250 ms of item time, any paused time counted (at least the 100 ms the ticker
    // clamps a frame to) would cross into the third frame at 300 ms.
    fixture.app.start()
    fixture.app.stop()
    ticker.update(ticker.lastTime + 10)
    expect(shown).toHaveBeenLastCalledWith(1)
  })

  it('reports a GIF whose later frame is corrupt as failed and keeps drawing the others', async () => {
    const opened = vi.spyOn(Live2DGifTexture, 'open')
    const left = screenToCanvas(60, 120)
    const right = screenToCanvas(60, 400)
    const mounted = mountItems([
      stageItem('broken', gifUrl([0, 1, 2], [10, 10, 10], 1), 'gif', placement({ x: left.x, y: left.y, scale: scaleForScreen(20, 2) })),
      stageItem('steady', solidPng(cyan), 'image', placement({ x: right.x, y: right.y, scale: scaleForScreen(20) })),
    ])
    await mounted.until(states => states['item:broken'] === 'attached' && states['item:steady'] === 'attached')
    await opened.mock.results[0].value
    const ticker = fixture.app.ticker
    ticker.lastTime = 5000
    ticker.update(5050)
    expect(colorAt(fixture.readPixels(), 60, 120)).toEqual([...red, 255])

    const failed = mounted.until(states => states['item:broken'] === 'failed')
    ticker.update(5150)
    await failed
    const pixels = render()
    expect(countPixels(pixel => isColor(pixels, pixel, red))).toBe(0)
    expect(colorAt(pixels, 60, 400)).toEqual([...cyan, 255])
    expect(model.itemInsertions).toBeDefined()
  })

  it('reports a missing pin drawable and a missing layer drawable, drawing the latter in front', async () => {
    const center = screenToCanvas(width / 2, height / 2)
    const lostPoint = screenToCanvas(40, 40)
    const lostPin: StageItemPin = { drawableId: 'NoSuchMesh', vertices: [0, 1, 2], weights: [1, 0, 0], reference: [0, 0, 1, 0, 0, 1], vertexCount: 3, modelPoint: { x: lostPoint.x, y: lostPoint.y } }
    const front = stageItem('patch', solidPng(cyan), 'image', placement({ x: center.x, y: center.y, scale: scaleForScreen(40) }))
    const mounted = mountItems([
      stageItem('lost', solidPng(green), 'image', placement({ scale: scaleForScreen(12), pin: lostPin })),
      front,
    ])
    await mounted.until(states => states['item:lost'] === 'missing-drawable' && states['item:patch'] === 'attached')
    const inFront = render()
    // The lost pin draws at its stored point.
    const lost = centroidOf(inFront, green)
    expect(Math.abs(lost.x - 40)).toBeLessThan(1)
    expect(Math.abs(lost.y - 40)).toBeLessThan(1)

    mounted.items.value = [
      mounted.items.value[0],
      stageItem('patch', front.url, 'image', { ...front.document.placement, layer: { kind: 'above', drawableId: 'NoSuchMesh' } }),
    ]
    await mounted.until(states => states['item:patch'] === 'missing-layer')
    expect(countMismatches(render(), inFront)).toBe(0)
    expect(countPixels(pixel => unhooked[pixel * 4 + 3] === 255 && isColor(inFront, pixel, cyan))).toBeGreaterThan(1_000)
  })

  it('releases textures and decoders on hide, on a model swap during a pending decode, and on unmount', async () => {
    const managedTextures = () => renderer.texture.managedTextures.length
    const withoutItems = render()
    const baseline = managedTextures()
    const opened = vi.spyOn(Live2DGifTexture, 'open')
    const closed = vi.spyOn(ImageDecoder.prototype, 'close')
    const gif = stageItem('spark', gifUrl([0, 1], [10, 10]), 'gif', placement({ x: screenToCanvas(60, 120).x, y: screenToCanvas(60, 120).y, scale: scaleForScreen(20, 2) }))
    const image = stageItem('card', solidPng(cyan), 'image', placement({ x: screenToCanvas(60, 400).x, y: screenToCanvas(60, 400).y, scale: scaleForScreen(20) }))

    const mounted = mountItems([gif, image])
    await mounted.until(states => states['item:spark'] === 'attached' && states['item:card'] === 'attached')
    render()
    expect(managedTextures()).toBe(baseline + 2)

    mounted.items.value = [image]
    await mounted.until(states => !('item:spark' in states))
    render()
    expect(managedTextures()).toBe(baseline + 1)
    expect(closed).toHaveBeenCalledTimes(1)

    // Show it again, request its next frame, and swap her model before the decode returns.
    mounted.items.value = [gif, image]
    await mounted.until(states => states['item:spark'] === 'attached')
    await opened.mock.results[1].value
    const ticker = fixture.app.ticker
    ticker.lastTime = 9000
    ticker.update(9150)
    const other = await fixture.loadModel()
    mounted.model.value = other
    await mounted.until(states => Object.keys(states).length === 0)
    expect(model.itemInsertions).toBeUndefined()
    expect(model.filterArea).toBe(modelFilterArea)
    expect(closed).toHaveBeenCalledTimes(2)
    await mounted.until(states => states['item:spark'] === 'attached' && states['item:card'] === 'attached')
    expect(other.itemInsertions).toBeDefined()

    mounted.unmount()
    expect(other.itemInsertions).toBeUndefined()
    expect(countMismatches(render(), withoutItems)).toBe(0)
    expect(managedTextures()).toBe(baseline)
    expect(closed).toHaveBeenCalledTimes(opened.mock.calls.length)
  })
})
