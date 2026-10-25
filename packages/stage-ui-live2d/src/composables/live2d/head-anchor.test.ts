import type { Live2DHeadSource } from './head-anchor'

import { Matrix } from '@pixi/math'
import { describe, expect, it, vi } from 'vitest'

import { createLive2DHeadTracker, live2DCanvasRectToViewport } from './head-anchor'

describe('head viewport conversion', () => {
  it.each([1, 2, 3])('maps model layout, model pivot/scale, and %ix render scale to the same CSS rect', (resolution) => {
    const rect = live2DCanvasRectToViewport(
      { x: 1000, y: 400, width: 800, height: 600 },
      new Matrix(0.5, 0, 0, 0.5, 10, 20),
      new Matrix(0.2 * resolution, 0, 0, 0.2 * resolution, 100 * resolution, 40 * resolution),
      { left: 20, top: 30, width: 450, height: 600 },
      { width: 450 * resolution, height: 600 * resolution },
    )
    // Model canvas -> layout: (510,220)-(910,520); model -> stage: (202,84)-(282,144).
    // The backing-store render scale cancels against backing/CSS size, then client origin adds (20,30).
    expect(rect.x).toBeCloseTo(222, 12)
    expect(rect.y).toBeCloseTo(114, 12)
    expect(rect.width).toBeCloseTo(80, 12)
    expect(rect.height).toBeCloseTo(60, 12)
  })

  it('keeps every transformed corner inside the CSS box when the model rotates', () => {
    expect(live2DCanvasRectToViewport(
      { x: 1000, y: 400, width: 800, height: 600 },
      new Matrix(0.5, 0, 0, 0.5, 10, 20),
      new Matrix(0, 0.4, -0.4, 0, 400, 80),
      { left: 20, top: 30, width: 450, height: 600 },
      { width: 900, height: 1200 },
    )).toEqual({ x: 116, y: 172, width: 60, height: 80 })
  })
})

interface RiggedModelOptions {
  /** Drawables the head carries, by index. */
  head: number[]
  drawables: number
  /** Standard head-angle parameters the model defines. */
  angleParameters?: string[]
  /** Standard body-angle parameters the model defines. */
  bodyParameters?: string[]
  /** Drawables the body carries, which the head may also nudge. */
  body?: number[]
  /** How far the body nudges a drawable the head carries, as a share. */
  bodyFollow?: number
  /** Drawables that only move once physics has run. */
  physicsDriven?: number[]
  /** Direct feature-parameter deformation, independent of head physics. */
  features?: Record<string, number[]>
  hitAreas?: Record<string, { index: number }>
}

/**
 * A model that moves the drawables its head carries when the head turns.
 *
 * @example
 * riggedModel({ drawables: 4, head: [1, 2] })
 */
function riggedModel(options: RiggedModelOptions): Live2DHeadSource & { updates: number } {
  const angleParameters = options.angleParameters ?? ['ParamAngleX']
  const bodyParameters = options.bodyParameters ?? []
  const featureParameters = Object.keys(options.features ?? {})
  const physicsDriven = options.physicsDriven ?? []
  const parameters = [...angleParameters, ...bodyParameters, ...featureParameters]
  const virtualParameters = new Map<string, number>()
  const values = new Map(parameters.map(id => [id, 0]))
  const maximumValues = parameters.map(() => 30)
  const minimumValues = parameters.map(() => -30)
  let head = 0
  let body = 0
  let swung = 0
  let features = featureParameters.map(() => 0)

  const headValue = () => angleParameters.reduce((total, id) => total + (values.get(id) ?? 0), 0)

  return {
    updates: 0,
    hitAreas: options.hitAreas ?? {},
    physics: {
      // Springs carry the head's motion outward a step at a time.
      evaluate: () => void (swung += (headValue() - swung) * 0.5),
    },
    coreModel: {
      update() {
        head = headValue()
        body = bodyParameters.reduce((total, id) => total + (values.get(id) ?? 0), 0)
        features = featureParameters.map(id => values.get(id) ?? 0)
      },
      getDrawableCount: () => options.drawables,
      getDrawableDynamicFlagIsVisible: () => true,
      getDrawableOpacity: () => 1,
      getParameterCount: () => parameters.length,
      getParameterIndex: (id: string) => {
        const index = parameters.indexOf(id)
        if (index >= 0)
          return index
        // Cubism allocates stable virtual indices beyond its real parameter table.
        if (!virtualParameters.has(id))
          virtualParameters.set(id, parameters.length + virtualParameters.size)
        return virtualParameters.get(id)!
      },
      getParameterValueById: (id: string) => values.get(id) ?? 0,
      setParameterValueById: (id: string, value: number) => void values.set(id, value),
      getParameterMaximumValue: (index: number) => maximumValues[index],
      getParameterMinimumValue: (index: number) => minimumValues[index],
    },
    getDrawableBounds: (index: number) => {
      let offset = 0
      if (options.head.includes(index))
        offset += head + body * (options.bodyFollow ?? 0)
      if (options.body?.includes(index))
        offset += body
      if (physicsDriven.includes(index))
        offset += swung
      featureParameters.forEach((id, at) => {
        if (options.features?.[id].includes(index))
          offset += features[at]
      })

      return { x: offset, y: index * 10, width: 8, height: 8 }
    },
  }
}

describe('live2D head tracker', () => {
  it('keeps the drawables that move when the head turns', () => {
    const model = riggedModel({ drawables: 5, head: [1, 3] })

    const bounds = createLive2DHeadTracker().bounds(model)

    // Only the two that moved, so the box spans their rows and not the others'.
    expect(bounds).toEqual({ x: 0, y: 10, width: 8, height: 28 })
  })

  it('leaves the model in the pose it was given', () => {
    const model = riggedModel({ drawables: 3, head: [0] })
    model.coreModel.setParameterValueById('ParamAngleX', 12)

    createLive2DHeadTracker().bounds(model)

    expect(model.coreModel.getParameterValueById('ParamAngleX')).toBe(12)
  })

  it('rechecks visibility and opacity without replacing the tracked selection', () => {
    const model = riggedModel({ drawables: 5, head: [1, 3] })
    const tracker = createLive2DHeadTracker()
    let visible = false
    let opacity = 1
    model.coreModel.getDrawableDynamicFlagIsVisible = index => index !== 3 || visible
    model.coreModel.getDrawableOpacity = index => index === 3 ? opacity : 1

    expect(tracker.bounds(model)).toEqual({ x: 0, y: 10, width: 8, height: 8 })
    visible = true
    opacity = 0
    expect(tracker.bounds(model)).toEqual({ x: 0, y: 10, width: 8, height: 8 })
    opacity = 0.009
    expect(tracker.bounds(model)).toEqual({ x: 0, y: 10, width: 8, height: 8 })
    opacity = 0.01
    expect(tracker.bounds(model)).toEqual({ x: 0, y: 10, width: 8, height: 28 })
    visible = false
    expect(tracker.bounds(model)).toEqual({ x: 0, y: 10, width: 8, height: 8 })
  })

  it('takes an author-declared head area without turning anything', () => {
    const model = riggedModel({ drawables: 4, head: [2], hitAreas: { Head: { index: 0 } } })
    const update = vi.spyOn(model.coreModel, 'update')
    const tracker = createLive2DHeadTracker()

    expect(tracker.bounds(model)).toEqual({ x: 0, y: 0, width: 8, height: 8 })
    expect(tracker.interactionBounds(model)).toEqual({
      head: { x: 0, y: 0, width: 8, height: 8 },
      touch: { x: 0, y: 0, width: 8, height: 8 },
      eyeAnchor: { x: 4, y: 4.4 },
      source: 'hit-area',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('reports no head when the model states none', () => {
    // A model with neither a head area nor a head-angle parameter. Of the seven
    // samples shipped with the Cubism SDK the one in this position is a dog,
    // whose head does not turn on its own, so there is nothing to follow.
    const model = riggedModel({ drawables: 4, head: [], angleParameters: [] })

    expect(createLive2DHeadTracker().bounds(model)).toBeUndefined()
  })

  it('reports no head when the parameter exists but moves nothing', () => {
    const model = riggedModel({ drawables: 4, head: [] })

    expect(createLive2DHeadTracker().bounds(model)).toBeUndefined()
  })

  it('keeps what only moves once physics has run', () => {
    // Hair and accessories are often swung by physics rather than by the head
    // parameter itself. A measurement that does not run physics misses them and
    // reports a head narrower than the one on screen.
    const model = riggedModel({ drawables: 4, head: [0], physicsDriven: [2] })

    const bounds = createLive2DHeadTracker().bounds(model)

    expect(bounds?.y).toBe(0)
    expect(bounds?.height).toBe(28)
  })

  it.each([false, true])('caches separate face and physics selections regardless of first consumer (face first: %s)', (faceFirst) => {
    const model = riggedModel({
      drawables: 4,
      head: [0],
      physicsDriven: [3],
      features: { ParamEyeLOpen: [1], ParamMouthOpenY: [2] },
    })
    const tracker = createLive2DHeadTracker()
    const update = vi.spyOn(model.coreModel, 'update')

    if (faceFirst)
      tracker.interactionBounds(model)
    tracker.bounds(model)
    const interaction = tracker.interactionBounds(model)!
    update.mockClear()

    const bubble = tracker.bounds(model)
    expect(bubble?.y).toBe(0)
    expect(bubble?.height).toBe(38)
    expect(interaction.head.width).toBeCloseTo(12.8)
    expect(interaction.head.height).toBeCloseTo(28.8)
    expect(interaction.head.x).toBeCloseTo(-2.4)
    expect(interaction.head.y).toBeCloseTo(4.6)
    expect(interaction.eyeAnchor).toEqual({ x: 4, y: 14 })
    expect(tracker.interactionBounds(model)).toEqual(interaction)
    expect(tracker.bounds(model)).toEqual(bubble)
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamEyeBallX',
    'ParamEyeBallY',
    'ParamBrowLY',
    'ParamBrowRY',
    'ParamMouthOpenY',
    'ParamMouthForm',
  ])('measures %s movers without evaluating physics and restores their pose', (id) => {
    const model = riggedModel({ drawables: 4, head: [], physicsDriven: [3], features: { [id]: [1] } })
    const tracker = createLive2DHeadTracker()
    // The touch box reads the cached physics box for its crown; only the face probe must skip physics.
    tracker.bounds(model)
    const evaluate = vi.spyOn(model.physics!, 'evaluate')
    model.coreModel.setParameterValueById(id, 30)

    const interaction = tracker.interactionBounds(model)!
    expect(interaction.head.x).toBeCloseTo(27.6)
    expect(interaction.head.width).toBeCloseTo(12.8)
    expect(model.coreModel.getParameterValueById(id)).toBe(30)
    expect(model.getDrawableBounds(1)).toEqual({ x: 30, y: 10, width: 8, height: 8 })
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('caches absent face features and falls back to the physics box', () => {
    const model = riggedModel({ drawables: 4, head: [], physicsDriven: [2] })
    const tracker = createLive2DHeadTracker()
    const update = vi.spyOn(model.coreModel, 'update')

    const interaction = tracker.interactionBounds(model)!
    expect(interaction.head).toEqual(tracker.bounds(model))
    expect(interaction.touch).toEqual(interaction.head)
    expect(interaction.source).toBe('physics')
    expect(tracker.selectionCounts()).toEqual({ physics: 1 })
    expect(interaction.head.height).toBe(8)
    expect(interaction.eyeAnchor.y).toBe(24.4)
    update.mockClear()
    expect(tracker.interactionBounds(model)).toEqual(interaction)
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['empty', 'head', 'head-and-eyes'])('never reads ranges or probes values at virtual indices (%s)', (rig) => {
    const model = riggedModel({
      drawables: 3,
      head: [0],
      angleParameters: rig === 'empty' ? [] : ['ParamAngleX'],
      features: rig === 'head-and-eyes' ? { ParamEyeLOpen: [1] } : {},
    })
    const core = model.coreModel
    const count = core.getParameterCount()
    const minimum = vi.spyOn(core, 'getParameterMinimumValue')
    const maximum = vi.spyOn(core, 'getParameterMaximumValue')
    const values = vi.spyOn(core, 'getParameterValueById')
    const writes = vi.spyOn(core, 'setParameterValueById')
    const tracker = createLive2DHeadTracker()

    tracker.bounds(model)
    tracker.interactionBounds(model)

    for (const [index] of [...minimum.mock.calls, ...maximum.mock.calls]) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(count)
    }
    for (const [id] of [...values.mock.calls, ...writes.mock.calls])
      expect(core.getParameterIndex(id)).toBeLessThan(count)
    expect(new Set(values.mock.calls.map(([id]) => id)).size).toBe(count)
  })

  it('rechecks visible face and eye features, falling back only while all features are hidden', () => {
    const model = riggedModel({
      drawables: 4,
      head: [0],
      physicsDriven: [3],
      features: { ParamEyeLOpen: [1], ParamMouthOpenY: [2] },
    })
    const tracker = createLive2DHeadTracker()
    let eyesVisible = true
    let mouthOpacity = 1
    model.coreModel.getDrawableDynamicFlagIsVisible = index => index !== 1 || eyesVisible
    model.coreModel.getDrawableOpacity = index => index === 2 ? mouthOpacity : 1

    expect(tracker.interactionBounds(model)?.eyeAnchor).toEqual({ x: 4, y: 14 })
    mouthOpacity = 0.009
    expect(tracker.interactionBounds(model)?.head.height).toBeCloseTo(12.8)
    mouthOpacity = 0.01
    expect(tracker.interactionBounds(model)?.head.height).toBeCloseTo(28.8)
    eyesVisible = false
    expect(tracker.interactionBounds(model)?.head.height).toBeCloseTo(12.8)
    expect(tracker.interactionBounds(model)?.eyeAnchor.y).toBeCloseTo(24.64)
    mouthOpacity = 0
    expect(tracker.interactionBounds(model)?.head).toEqual(tracker.bounds(model))
    eyesVisible = true
    mouthOpacity = 1
    expect(tracker.interactionBounds(model)?.eyeAnchor).toEqual({ x: 4, y: 14 })
    expect(tracker.interactionBounds(model)?.head.height).toBeCloseTo(28.8)
  })

  it('reaches the touch box up to the physics-carried crown while keeping the face-based head box', () => {
    // ROOT CAUSE:
    //
    // Touch used the face-feature box grown 1.6x around its center. Face features
    // stop near the brows, so its top excluded the hair: on ForBOOTH it started at
    // y 1179 while the hair began at 633, and stroking the crown never petted.
    const model = riggedModel({
      drawables: 4,
      head: [0],
      physicsDriven: [3],
      features: { ParamEyeLOpen: [1], ParamMouthOpenY: [2] },
    })

    const interaction = createLive2DHeadTracker().interactionBounds(model)!

    // Drawable 0 is the crown at y 0; the face spans drawables 1 and 2 (y 10-28).
    expect(interaction.source).toBe('face')
    expect(interaction.head.y).toBeCloseTo(4.6)
    expect(interaction.touch.x).toBeCloseTo(interaction.head.x)
    expect(interaction.touch.width).toBeCloseTo(interaction.head.width)
    expect(interaction.touch.y).toBe(0)
    expect(interaction.touch.y + interaction.touch.height).toBeCloseTo(interaction.head.y + interaction.head.height)
  })

  it('keeps the touch top at the face box when the physics box starts lower', () => {
    const model = riggedModel({
      drawables: 4,
      head: [3],
      features: { ParamEyeLOpen: [0], ParamMouthOpenY: [1] },
    })

    const interaction = createLive2DHeadTracker().interactionBounds(model)!

    expect(interaction.touch).toEqual(interaction.head)
  })

  it('drops what follows the body as much as the head', () => {
    // A drawable the body carries does not move when only the head turns, so it
    // never reaches the threshold.
    const model = riggedModel({
      drawables: 4,
      head: [0],
      body: [2],
      bodyParameters: ['ParamBodyAngleX'],
    })

    const bounds = createLive2DHeadTracker().bounds(model)

    // The one drawable the head carries, measured back at rest.
    expect(bounds).toEqual({ x: 0, y: 0, width: 8, height: 8 })
  })

  it('finds the head on a model already turned to its limit', () => {
    // ROOT CAUSE:
    //
    // The probe always turned toward the maximum:
    //
    //   core.setParameterValueById(id, core.getParameterMaximumValue(index))
    //
    // A model resting there moved nothing, so no drawable was kept, and the
    // failure was cached until the model was replaced.
    const model = riggedModel({ drawables: 4, head: [1] })
    model.coreModel.setParameterValueById('ParamAngleX', 30)

    expect(createLive2DHeadTracker().bounds(model)).toEqual({ x: 30, y: 10, width: 8, height: 8 })
  })

  it('answers again for a replaced model after a reset', () => {
    const tracker = createLive2DHeadTracker()
    const original = riggedModel({ drawables: 4, head: [0], physicsDriven: [2], features: { ParamEyeLOpen: [0] } })
    tracker.bounds(original)
    tracker.interactionBounds(original)

    tracker.reset()

    const absent = riggedModel({ drawables: 3, head: [], angleParameters: [] })
    expect(tracker.bounds(absent)).toBeUndefined()
    expect(tracker.interactionBounds(absent)).toBeUndefined()

    tracker.reset()

    const replacement = riggedModel({ drawables: 4, head: [1], physicsDriven: [3], features: { ParamEyeROpen: [1] } })
    expect(tracker.bounds(replacement)?.height).toBe(28)
    expect(tracker.interactionBounds(replacement)?.head.height).toBeCloseTo(12.8)
    expect(tracker.interactionBounds(replacement)?.eyeAnchor).toEqual({ x: 4, y: 14 })
  })
})
