import type { Matrix } from '@pixi/math'
import type { Bounds } from 'pixi-live2d-display/cubism4'

import { eyeAnchorShare, scaleLive2DRect } from './touch-regions'

/** A point in the model's own canvas space, before any stage transform. */
interface Live2DModelCanvasPoint {
  x: number
  y: number
}

/** An axis-aligned box, in whichever space the producer names. */
export interface Live2DModelCanvasRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What the tracker asks a model for.
 *
 * Narrower than the internal model, which satisfies it structurally: the tracker
 * reads the rig and the drawables and nothing else, and saying so lets it be
 * exercised without a Cubism runtime.
 */
export interface Live2DHeadSource {
  hitAreas: Record<string, { index: number }>
  coreModel: {
    update: () => void
    getDrawableCount: () => number
    getDrawableDynamicFlagIsVisible: (index: number) => boolean
    getDrawableOpacity: (index: number) => number
    getParameterCount: () => number
    getParameterIndex: (id: string) => number
    getParameterValueById: (id: string) => number
    setParameterValueById: (id: string, value: number) => void
    getParameterMaximumValue: (index: number) => number
    getParameterMinimumValue: (index: number) => number
  }
  getDrawableBounds: (index: number) => Bounds
  /**
   * The model's physics, when it has any.
   *
   * Running it during the measurement is what makes hair and accessories that
   * the head only swings indirectly show up as part of the head.
   */
  physics?: { evaluate: (coreModel: unknown, deltaTimeSeconds: number) => void }
}

/**
 * Hit-area names that mean "head", lowercased.
 *
 * Author-declared and exact when present, but optional: of the seven models
 * shipped with the Cubism SDK, three declare one.
 */
const headAreaNames = new Set(['head', 'face'])

/**
 * Cubism's standard parameters for turning the head.
 *
 * Part of the published standard parameter list, which is why this project
 * already writes `ParamMouthOpenY` by id. Six of the seven SDK sample models
 * define at least one; the one that does not is a dog, whose head does not turn
 * independently and which therefore has no head to follow.
 */
const headAngleParameterIds = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']

const eyeParameterIds = ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY']
const faceParameterIds = [...eyeParameterIds, 'ParamBrowLY', 'ParamBrowRY', 'ParamMouthOpenY', 'ParamMouthForm']

/**
 * Face features span less than the head. Expand their box by 1.6 around its center
 * for the cursor unit and touch region, without including physics-carried hair.
 * The user's touch head-scale adjustment applies after this shared conversion.
 */
const faceToHeadScale = 1.6

/** Simulated seconds given to physics so its springs reach their new rest. */
const physicsSettleSeconds = 0.6

/** Step physics is advanced by, matching a rate every model is authored against. */
const physicsStepSeconds = 1 / 30

/**
 * Share of the largest observed movement a drawable must reach to count.
 *
 * Separates drawables the head carries from arithmetic noise in the ones it does
 * not. Relative to the largest mover, so it needs no knowledge of the model's
 * scale or of how far its head turns.
 */
const movedShare = 0.2

function unionInto(target: Bounds, next: Bounds) {
  const right = Math.max(target.x + target.width, next.x + next.width)
  const bottom = Math.max(target.y + target.height, next.y + next.height)
  target.x = Math.min(target.x, next.x)
  target.y = Math.min(target.y, next.y)
  target.width = right - target.x
  target.height = bottom - target.y
}

function measureEvery(internalModel: Live2DHeadSource, count: number) {
  const measured: Bounds[] = []
  for (let index = 0; index < count; index++)
    measured.push({ ...internalModel.getDrawableBounds(index) })

  return measured
}

function travelled(before: Bounds, after: Bounds) {
  return Math.hypot(after.x - before.x, after.y - before.y)
    + Math.hypot(after.width - before.width, after.height - before.height)
}

/**
 * Follows the head of a Live2D model across frames.
 *
 * What counts as the head is decided once, from what the model itself states.
 * A hit area names it outright. Failing that, the rig answers: turning the head
 * moves the drawables the head carries and leaves the rest where they are, which
 * is the same question VRM answers with skinning weights.
 *
 * Nothing is guessed from where a drawable sits. A model that states neither has
 * no head to follow, and the tracker says so rather than picking the topmost
 * drawables and hoping.
 *
 * @example
 * const tracker = createLive2DHeadTracker()
 * tracker.bounds(internalModel)
 * // => { x: 1104, y: 402, width: 768, height: 690 }
 */
export function createLive2DHeadTracker() {
  const selections = new Map<'physics' | 'face' | 'eyes', number[] | undefined>()

  function selectByHitArea(internalModel: Live2DHeadSource) {
    const headArea = Object.entries(internalModel.hitAreas)
      .find(([name]) => headAreaNames.has(name.toLowerCase()))?.[1]

    return headArea ? [headArea.index] : undefined
  }

  /**
   * Changes the requested parameters and keeps whatever moved with them.
   *
   * The bubble needs physics-carried hair and accessories to clear the silhouette.
   * Touch and cursor sizing instead probe face features without physics. Some rigs
   * route even their head angles through physics, so a direct head-angle probe
   * would find nothing. Eye parameters separately identify the gaze anchor.
   * Every measure uses the same movement threshold and restores its parameters.
   *
   * Leaning the body is not measured as a control: a body carries the head with
   * it, so a head drawable answers to both and comparing the two rejects the
   * head itself. What merely follows the head barely moves, and the threshold
   * below already drops it.
   */
  function selectByParameters(internalModel: Live2DHeadSource, ids: string[], withPhysics: boolean) {
    const core = internalModel.coreModel
    const count = core.getDrawableCount()
    const parameterCount = core.getParameterCount()

    // Cubism gives absent IDs virtual indices beyond the real parameter table.
    const parameters = ids
      .map(id => ({ id, index: core.getParameterIndex(id) }))
      .filter(parameter => parameter.index >= 0 && parameter.index < parameterCount)

    if (parameters.length === 0 || count === 0)
      return undefined

    const held = parameters.map(parameter => core.getParameterValueById(parameter.id))
    const restore = () => parameters.forEach((parameter, at) => core.setParameterValueById(parameter.id, held[at]))

    const settle = () => {
      if (withPhysics) {
        const steps = Math.ceil(physicsSettleSeconds / physicsStepSeconds)
        for (let step = 0; step < steps; step++)
          internalModel.physics?.evaluate(core, physicsStepSeconds)
      }

      core.update()
    }

    /**
     * The end of a parameter's range furthest from where it rests.
     *
     * Always turning toward the maximum measures nothing when the model already
     * sits there, which a motion can leave it doing at the moment the bubble
     * first appears.
     */
    const farEnd = (parameter: { id: string, index: number }, from: number) => {
      const maximum = core.getParameterMaximumValue(parameter.index)
      const minimum = core.getParameterMinimumValue(parameter.index)
      return Math.abs(maximum - from) >= Math.abs(from - minimum) ? maximum : minimum
    }

    restore()
    settle()
    const resting = measureEvery(internalModel, count)

    parameters.forEach((parameter, at) => core.setParameterValueById(parameter.id, farEnd(parameter, held[at])))
    settle()
    const turned = measureEvery(internalModel, count)

    restore()
    settle()

    const distances = resting.map((bounds, index) => travelled(bounds, turned[index]))
    const largest = Math.max(...distances)
    if (largest <= 0)
      return undefined

    const moved = distances
      .map((distance, index) => ({ distance, index }))
      .filter(entry => entry.distance >= largest * movedShare)
      .map(entry => entry.index)

    return moved.length > 0 ? moved : undefined
  }

  function readBounds(internalModel: Live2DHeadSource, measure: 'physics' | 'face' | 'eyes'): Live2DModelCanvasRect | undefined {
    if (!selections.has(measure)) {
      const tracked = measure === 'physics'
        ? selectByHitArea(internalModel) ?? selectByParameters(internalModel, headAngleParameterIds, true)
        : selectByParameters(internalModel, measure === 'face' ? faceParameterIds : eyeParameterIds, false)
      selections.set(measure, tracked)
    }

    const tracked = selections.get(measure)
    if (!tracked)
      return undefined

    let union: Bounds | undefined
    for (const index of tracked) {
      // Selection is cached, but expressions can hide or reveal a tracked part each frame.
      if (!internalModel.coreModel.getDrawableDynamicFlagIsVisible(index) || internalModel.coreModel.getDrawableOpacity(index) < 0.01)
        continue
      const drawable = internalModel.getDrawableBounds(index)
      if (drawable.width <= 0 || drawable.height <= 0)
        continue

      if (!union)
        union = { ...drawable }
      else
        unionInto(union, drawable)
    }

    return union ? { x: union.x, y: union.y, width: union.width, height: union.height } : undefined
  }

  return {
    /**
     * The head's box in model canvas space, including physics-carried parts so a
     * presence bubble clears the silhouette. An authored head/face hit area wins.
     * Returns `undefined` when the model states no head.
     */
    bounds(internalModel: Live2DHeadSource) {
      return readBounds(internalModel, 'physics')
    },

    /**
     * The interaction head box (whose width is the cursor unit) and eye anchor.
     * An authored hit area wins unchanged, then face features expanded by
     * `faceToHeadScale`, then the physics-inclusive box. Visible eye-feature
     * drawables locate the eye anchor when the face measure is used; without them,
     * hit areas and fallback boxes keep the existing proportional eye anchor.
     * Selections are measured once and visibility every time. Reset on model swap.
     */
    interactionBounds(internalModel: Live2DHeadSource) {
      const face = selectByHitArea(internalModel) ? undefined : readBounds(internalModel, 'face')
      const head = face ? scaleLive2DRect(face, faceToHeadScale) : readBounds(internalModel, 'physics')
      if (!head)
        return undefined
      const eyes = face && readBounds(internalModel, 'eyes')
      const eyeAnchor = eyes
        ? { x: eyes.x + eyes.width / 2, y: eyes.y + eyes.height / 2 }
        : { x: head.x + head.width / 2, y: head.y + head.height * eyeAnchorShare }
      return { head, eyeAnchor }
    },

    /** Drops every selection so the next model answers for itself. */
    reset() {
      selections.clear()
    },
  }
}

/**
 * Maps a model canvas point into the space the model's parent draws in.
 *
 * `Live2DModel.toModelPosition` composes the inverse of this pair, applying
 * `worldTransform` then `localTransform` in reverse. Following it forward keeps
 * the bubble in the space the library hit-tests in, including the pivot the
 * model's anchor writes.
 *
 * Source: `toModelPosition` in
 * node_modules/pixi-live2d-display/dist/cubism4.es.js.
 */
function live2DCanvasPointToParent(
  point: Live2DModelCanvasPoint,
  internalModelLocalTransform: Matrix,
  modelLocalTransform: Matrix,
): Live2DModelCanvasPoint {
  const afterModelLayout = internalModelLocalTransform.apply(point)
  return modelLocalTransform.apply(afterModelLayout)
}

/**
 * Maps a model canvas box into the space the model's parent draws in.
 *
 * Both transforms can flip an axis, so the mapped corners are re-sorted rather
 * than assumed to stay top-left and bottom-right.
 */
export function live2DCanvasRectToParent(
  rect: Live2DModelCanvasRect,
  internalModelLocalTransform: Matrix,
  modelLocalTransform: Matrix,
): Live2DModelCanvasRect {
  const topLeft = live2DCanvasPointToParent(rect, internalModelLocalTransform, modelLocalTransform)
  const bottomRight = live2DCanvasPointToParent(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    internalModelLocalTransform,
    modelLocalTransform,
  )

  const x = Math.min(topLeft.x, bottomRight.x)
  const y = Math.min(topLeft.y, bottomRight.y)

  return {
    x,
    y,
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  }
}
