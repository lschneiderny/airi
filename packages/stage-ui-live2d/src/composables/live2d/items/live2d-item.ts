import type { Renderer } from '@pixi/core'
import type { StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'

import type { Live2DParameterReader } from './mirror'
import type { Live2DItemPose } from './pose'

import { Matrix, Point } from '@pixi/math'
import { Cubism4InternalModel, Live2DFactory, Live2DModel } from 'pixi-live2d-display/cubism4'

import { disableLive2DSdkBreath } from '../motion-manager'
import { readLive2DRigProfile } from '../natural-motion/rig-profile'
import { isPointInLive2DMesh } from '../touch'
import { Live2DParameterMirror } from './mirror'

/** The longest step an item model integrates at once, as the stage ticker clamps a frame; a longer undrawn gap counts as this. */
const maxItemStepMs = 100

export interface Live2DItemModelOptions {
  /** Mirror her final parameters into the item (`link: 'parameters'`). */
  linked: boolean
  /** Her parameter ids, in her core model's index order. */
  herParameterIds: readonly string[]
  /** Read on every idle request: under reduced motion the item plays no idle motion. */
  animated: () => boolean
}

/**
 * A Live2D model shown as a stage item, owned by `Live2DItemLayer`.
 *
 * It loads without her plugins: no expression controller, no motion-manager hook, no
 * Natural adapter, no touch, and no SDK breath. It is never on `Ticker.shared`; the
 * layer's item clock steps it through `advance`, and its own render, inside her insert
 * segment, runs the update, so it moves after her in the same frame. Its idle motion
 * group plays on its own.
 *
 * Linked, it has no SDK eye blink (the SDK blinks on frames no motion updated, which
 * would override her mirrored lids) and copies her final parameters, all but its own
 * physics outputs, after its motion update, so its physics runs on her values.
 */
export class Live2DItemModel {
  private mirror?: Live2DParameterMirror
  private readonly layoutToCanvas: Matrix
  private readonly local = new Matrix()
  private readonly hitPoint = new Point()

  private constructor(readonly model: Live2DModel<Cubism4InternalModel>, options: Live2DItemModelOptions) {
    const internalModel = model.internalModel
    disableLive2DSdkBreath(internalModel)
    const state = internalModel.motionManager.state
    const shouldRequestIdleMotion = state.shouldRequestIdleMotion.bind(state)
    state.shouldRequestIdleMotion = () => options.animated() && shouldRequestIdleMotion()
    this.layoutToCanvas = internalModel.localTransform.clone().invert()

    if (options.linked) {
      delete internalModel.eyeBlink
      this.mirror = this.createMirror(options.herParameterIds)
      // Physics can load after the model; its outputs then leave the mirror.
      model.on('physicsLoaded', () => this.mirror = this.createMirror(options.herParameterIds))
      internalModel.on('afterMotionUpdate', () => this.mirror?.apply(internalModel.coreModel))
    }
  }

  /**
   * Loads the item zip at `url`. The archive goes to the zip loader as a file, never as
   * `{ url, id }`, so the display-model OPFS cache neither reads nor writes it.
   */
  static async load(url: string, options: Live2DItemModelOptions): Promise<Live2DItemModel> {
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`The Live2D item could not be read (HTTP ${response.status}).`)
    const file = new File([await response.blob()], 'item.zip')
    const model = new Live2DModel<Cubism4InternalModel>({ autoUpdate: false, autoInteract: false })
    try {
      await Live2DFactory.setupLive2DModel(model, [file], { autoInteract: false })
      if (!(model.internalModel instanceof Cubism4InternalModel))
        throw new Error('Live2D items must be Cubism 4 models.')
    }
    catch (error) {
      // A load that failed before the internal model existed has nothing to release.
      if (model.internalModel)
        model.destroy({ children: true, texture: true, baseTexture: true })
      throw error
    }
    return new Live2DItemModel(model, options)
  }

  /** Copies her final values; runs at her `beforeModelUpdate`. */
  capture(her: Live2DParameterReader) {
    this.mirror?.capture(her)
  }

  advance(deltaMs: number) {
    this.model.update(deltaMs)
    this.model.deltaTime = Math.min(this.model.deltaTime, maxItemStepMs)
  }

  /** Places the item's canvas in her canvas units: anchor, then scale and flip, rotation, and position. */
  place(pose: Live2DItemPose, placement: Pick<StageItemPlacement, 'anchor' | 'flipX'>) {
    const internalModel = this.model.internalModel
    this.local.identity()
      .translate(-placement.anchor.x * internalModel.originalWidth, -placement.anchor.y * internalModel.originalHeight)
      .scale(placement.flipX ? -pose.scale : pose.scale, pose.scale)
      .rotate(pose.rotation)
      .translate(pose.x, pose.y)
      // The model draws its layout box; this maps that box back to its canvas.
      .append(this.layoutToCanvas)
    this.model.transform.setFromMatrix(this.local)
    this.model.alpha = pose.alpha
    this.model.visible = pose.visible
  }

  render(renderer: Renderer) {
    this.model.render(renderer)
  }

  /**
   * Whether `point`, in her model canvas units, lies on a visible drawable of the item as it was last placed. Its hit
   * areas, which authors draw with transparent textures, do not count.
   */
  contains(point: { x: number, y: number }): boolean {
    const { model } = this
    if (!model.visible || model.alpha <= 0)
      return false
    const internalModel = model.internalModel
    const coreModel = internalModel.coreModel
    // Her canvas to the item's layout box, then to the item's canvas, where its drawables are measured.
    const local = internalModel.localTransform.applyInverse(model.localTransform.applyInverse(point, this.hitPoint), this.hitPoint)
    const hitAreas = new Set(Object.values(internalModel.hitAreas).map(area => area.index))
    for (let index = 0; index < coreModel.getDrawableCount(); index++) {
      if (hitAreas.has(index) || !coreModel.getDrawableDynamicFlagIsVisible(index) || coreModel.getDrawableOpacity(index) <= 0)
        continue
      const bounds = internalModel.getDrawableBounds(index)
      if (local.x < bounds.x || local.x > bounds.x + bounds.width || local.y < bounds.y || local.y > bounds.y + bounds.height)
        continue
      if (isPointInLive2DMesh(local, internalModel.getDrawableVertices(index), coreModel.getDrawableVertexIndices(index)))
        return true
    }
    return false
  }

  destroy() {
    this.model.destroy({ children: true, texture: true, baseTexture: true })
  }

  private createMirror(herParameterIds: readonly string[]) {
    const internalModel = this.model.internalModel
    const parameters = internalModel.coreModel.getModel().parameters
    const { physicsOutputs } = readLive2DRigProfile(parameters, internalModel.physics?._physicsRig)
    return new Live2DParameterMirror(herParameterIds, parameters.ids, physicsOutputs)
  }
}
