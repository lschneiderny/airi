import type { Live2DItemDrawSegment } from '@proj-airi/stage-ui-live2d/types/live2d-item-insertions'
import type { Cubism4InternalModel, Live2DModel } from 'pixi-live2d-display/cubism4'

import type { Live2DModelFixture } from './live2d-model-fixture'

import { Texture } from '@pixi/core'
import { Sprite } from '@pixi/sprite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createLive2DModelFixture } from './live2d-model-fixture'

const width = 768
const height = 512
const red = [255, 0, 0, 255] as const

function alphaAt(pixels: Uint8Array, pixel: number) {
  return pixels[pixel * 4 + 3]
}

function samePixel(a: Uint8Array, b: Uint8Array, pixel: number) {
  const offset = pixel * 4
  return a[offset] === b[offset] && a[offset + 1] === b[offset + 1] && a[offset + 2] === b[offset + 2] && a[offset + 3] === b[offset + 3]
}

function isRed(pixels: Uint8Array, pixel: number) {
  const offset = pixel * 4
  return red.every((channel, index) => pixels[offset + index] === channel)
}

function countMismatches(a: Uint8Array, b: Uint8Array, where: (pixel: number) => boolean = () => true) {
  let mismatches = 0
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (where(pixel) && !samePixel(a, b, pixel))
      mismatches++
  }
  return mismatches
}

function countPixels(where: (pixel: number) => boolean) {
  let count = 0
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (where(pixel))
      count++
  }
  return count
}

describe('live2D range draw', () => {
  let fixture: Live2DModelFixture
  let model: Live2DModel<Cubism4InternalModel>
  let drawableCount: number
  /** The first render-order position of a visible clip-masked drawable; the masks' sources draw before it. */
  let split: number
  let maskedPositions: number[]
  let unsplit: Uint8Array

  function renderWith(segments?: readonly Live2DItemDrawSegment[]) {
    model.itemInsertions = segments && { segments: () => segments }
    fixture.renderFrame()
    model.itemInsertions = undefined
    return fixture.readPixels()
  }

  function maskedFootprint() {
    const footprint = new Uint8Array(width * height)
    for (const position of maskedPositions) {
      const frame = renderWith([{ kind: 'model', from: position, to: position + 1 }])
      for (let pixel = 0; pixel < width * height; pixel++) {
        if (alphaAt(frame, pixel) > 0)
          footprint[pixel] = 1
      }
    }
    return footprint
  }

  beforeAll(async () => {
    fixture = createLive2DModelFixture({ width, height })
    model = await fixture.loadModel()
    const internalModel = model.internalModel
    const scale = height / internalModel.height
    model.scale.set(scale)
    model.x = (width - internalModel.width * scale) / 2
    fixture.app.stage.addChild(model)

    // The one update of the test: `_render` updates only while `deltaTime` is set, so
    // every later frame draws the same parameters and vertices.
    model.update(1000 / 60)
    fixture.renderFrame()
    unsplit = renderWith()

    const coreModel = internalModel.coreModel
    drawableCount = coreModel.getDrawableCount()
    const renderOrders = coreModel.getDrawableRenderOrders()
    const maskCounts = coreModel.getDrawableMaskCounts()
    maskedPositions = []
    for (let index = 0; index < drawableCount; index++) {
      if (maskCounts[index] > 0 && coreModel.getDrawableDynamicFlagIsVisible(index))
        maskedPositions.push(renderOrders[index])
    }
    maskedPositions.sort((a, b) => a - b)
    split = maskedPositions[0]
  }, 60_000)

  afterAll(() => {
    fixture.destroy()
  })

  it('draws one full-range segment RGBA-identical to the unsplit draw', () => {
    expect(countPixels(pixel => alphaAt(unsplit, pixel) > 0)).toBeGreaterThan(10_000)
    // A repeated unsplit frame is the control: equality below is not timing luck.
    expect(countMismatches(renderWith(), unsplit)).toBe(0)
    expect(countMismatches(renderWith([{ kind: 'model', from: 0, to: drawableCount }]), unsplit)).toBe(0)
  })

  it('keeps clip-masked drawables identical when the split puts them after an insert', () => {
    expect(maskedPositions.length).toBeGreaterThan(0)
    const footprint = maskedFootprint()
    expect(countPixels(pixel => footprint[pixel] === 1)).toBeGreaterThan(100)

    const split3 = renderWith([
      { kind: 'model', from: 0, to: split },
      { kind: 'insert', render: () => {} },
      { kind: 'model', from: split, to: drawableCount },
    ])
    expect(countMismatches(split3, unsplit)).toBe(0)
  })

  it('draws an inserted sprite between two ranges of her drawables', () => {
    const sprite = new Sprite(Texture.WHITE)
    sprite.tint = 0xFF0000
    sprite.width = width
    sprite.height = height
    const parent = sprite.enableTempParent()
    sprite.updateTransform()
    sprite.disableTempParent(parent)

    const upper = renderWith([{ kind: 'model', from: split, to: drawableCount }])
    const inserted = renderWith([
      { kind: 'model', from: 0, to: split },
      { kind: 'insert', render: renderer => sprite.render(renderer) },
      { kind: 'model', from: split, to: drawableCount },
    ])
    // The exact reference: the same opaque sprite drawn by Pixi behind her upper range.
    // The unsplit frame is no exact reference where her upper drawables are opaque only
    // together: their color rounds differently over red than over her lower drawables.
    fixture.app.stage.addChildAt(sprite, 0)
    const spriteBehindUpper = renderWith([{ kind: 'model', from: split, to: drawableCount }])
    fixture.app.stage.removeChild(sprite)
    sprite.destroy()

    expect(countMismatches(inserted, spriteBehindUpper)).toBe(0)
    // Where only drawables below the split drew, the sprite covers them.
    const coveredLower = (pixel: number) => alphaAt(upper, pixel) === 0 && alphaAt(unsplit, pixel) > 0
    expect(countPixels(coveredLower)).toBeGreaterThan(1_000)
    expect(countPixels(pixel => coveredLower(pixel) && !isRed(inserted, pixel))).toBe(0)
    // Drawables above the split cover the sprite and keep her colors.
    expect(countPixels(pixel => alphaAt(upper, pixel) === 255 && samePixel(inserted, unsplit, pixel))).toBeGreaterThan(1_000)
    // Her clip-masked drawables draw after the sprite with the masks of this frame.
    const footprint = maskedFootprint()
    expect(countPixels(pixel => footprint[pixel] === 1 && samePixel(inserted, unsplit, pixel))).toBeGreaterThan(100)
  })

  it('renders a second Live2D model in an insert without disturbing her later ranges', async () => {
    const item = await fixture.loadModel()
    item.scale.copyFrom(model.scale)
    item.scale.x /= 2
    item.scale.y /= 2
    item.position.set(0, height / 2)
    item.update(1000 / 60)
    // The item's first render happens inside her frame: it sets up its WebGL context,
    // which clears the Cubism shader cache that every model shares, between her ranges.
    const parent = item.enableTempParent()
    item.updateTransform()
    item.disableTempParent(parent)
    const nested = renderWith([
      { kind: 'model', from: 0, to: split },
      { kind: 'insert', render: renderer => item.render(renderer) },
      { kind: 'model', from: split, to: drawableCount },
    ])

    // The item alone, in the same place: the reference for its own pixels and masks.
    model.visible = false
    fixture.app.stage.addChild(item)
    fixture.renderFrame()
    const itemAlone = fixture.readPixels()
    fixture.app.stage.removeChild(item)
    model.visible = true

    const itemDrew = (pixel: number) => alphaAt(itemAlone, pixel) > 0
    expect(countPixels(itemDrew)).toBeGreaterThan(1_000)
    // The item sits beside her, so each pixel has one owner.
    expect(countPixels(pixel => itemDrew(pixel) && alphaAt(unsplit, pixel) > 0)).toBe(0)
    expect(countMismatches(nested, itemAlone, itemDrew)).toBe(0)
    // Her ranges after the nested model, clip-masked drawables included, are unchanged.
    expect(countMismatches(nested, unsplit, pixel => !itemDrew(pixel))).toBe(0)
    const footprint = maskedFootprint()
    expect(countPixels(pixel => footprint[pixel] === 1 && !itemDrew(pixel))).toBeGreaterThan(100)
  })

  it('misses the drawables of a range that no segment covers', () => {
    const omitted = renderWith([
      { kind: 'model', from: 0, to: split },
      { kind: 'model', from: split + 1, to: drawableCount },
    ])
    expect(countMismatches(omitted, unsplit)).toBeGreaterThan(0)
  })
})
