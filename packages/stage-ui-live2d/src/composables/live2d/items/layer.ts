import type { Renderer } from '@pixi/core'
import type { Rectangle } from '@pixi/math'
import type { ItemExpressionDocument, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'

import type { Live2DItemDrawSegment, Live2DItemInsertions } from '../../../types/live2d-item-insertions'
import type { StageItemFormat } from '../../../utils/stage-item-validator'
import type { Live2DItemInsertion } from './insertion'
import type { Live2DCanvasScale, Live2DItemPinResolution } from './pin'
import type { Live2DItemPose } from './pose'

import { BaseTexture, Texture } from '@pixi/core'
import { Container } from '@pixi/display'
import { Matrix } from '@pixi/math'
import { Sprite } from '@pixi/sprite'
import { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

import { gifFrameAt } from './gif-clock'
import { Live2DGifTexture } from './gif-texture'
import { resolveInsertionSegments } from './insertion'
import { resolveLive2DItemPin } from './pin'
import { solveLive2DItemPose } from './pose'

/** An item the scene shows: its document, the library URL of its file, and the file's format. */
export interface Live2DStageItem {
  document: ItemExpressionDocument
  url: string
  format: StageItemFormat
}

/**
 * How a shown item attached to her model.
 *
 * `missing-drawable`: its pin names no drawable of hers, so it draws at the pin's
 * stored point. `missing-layer`: its `above` drawable is missing, so it draws in
 * front. `failed`: its file could not be loaded or a GIF frame failed to decode,
 * so it does not draw.
 */
export type Live2DItemRenderState = 'attached' | 'reattached' | 'missing-drawable' | 'missing-layer' | 'failed'

interface ItemRecord {
  url: string
  placement: StageItemPlacement
  /** Set once its file loaded; the sprite is a child of the layer's root. */
  sprite?: Sprite
  gif?: Live2DGifTexture
  resolved?: Live2DItemPinResolution
  pose?: Live2DItemPose
  /** Item-clock time when it began to show; a GIF plays from its first frame then. */
  shownAtMs: number
  state?: Live2DItemRenderState
  /** Set on removal, so a load that finishes later releases what it made. */
  removed: boolean
}

/**
 * Draws stage items inside one Live2D model's render pass.
 *
 * The layer installs the model's `itemInsertions` hook only while at least one
 * item draws and removes it at zero, so her frame without items is exactly the
 * upstream draw. In the hook, which runs after her update in the same frame, it
 * reads her current vertices, solves each item's pose, and splits her drawables
 * around the items. Items therefore follow her mesh without lag, pass through
 * her filters, and write none of her parameters.
 *
 * Items advance on their own clock, fed by `advance` from the stage ticker:
 * the ticker stops while the stage is paused, so GIFs freeze with her.
 *
 * The layer owns every texture, GIF decoder, and sprite it creates; `remove`
 * and `destroy` release them, including those of loads still in flight.
 */
export class Live2DItemLayer {
  private readonly internalModel: Cubism4InternalModel
  private readonly scale: Live2DCanvasScale
  /** Holds the item sprites in her model canvas units; never part of the stage. */
  private readonly root = new Container()
  private readonly canvasToWorld = new Matrix()
  private readonly records = new Map<string, ItemRecord>()
  private insertions: Live2DItemInsertion[] = []
  private readonly hook: Live2DItemInsertions = { segments: () => this.segments() }
  private readonly modelFilterArea: Rectangle
  private clockMs = 0
  private reportedStates = ''

  /**
   * `screen` is the renderer's screen rectangle. While items show, her filters
   * cover it, because her filter frame is sized to her canvas and would clip an
   * item outside it. The renderer resizes this rectangle in place, so her filter
   * output frame stays fixed between resizes.
   */
  constructor(
    private readonly model: Live2DModel,
    private readonly screen: Rectangle,
    private readonly onStates: (states: Readonly<Record<string, Live2DItemRenderState>>) => void,
  ) {
    if (!(model.internalModel instanceof Cubism4InternalModel))
      throw new Error('Stage items draw only on Cubism 4 models.')
    this.internalModel = model.internalModel
    this.scale = {
      pixelsPerUnit: this.internalModel.pixelsPerUnit,
      originalWidth: this.internalModel.originalWidth,
      originalHeight: this.internalModel.originalHeight,
    }
    this.modelFilterArea = model.filterArea
  }

  /**
   * Shows exactly these items. Image and GIF items load here; Live2D items are
   * not drawn by this layer. An item whose file URL changed loads again; one
   * whose placement changed is placed again, re-attaching its pin.
   */
  setItems(items: readonly Live2DStageItem[]) {
    const wanted = new Map<string, Live2DStageItem>()
    for (const item of items) {
      if (item.format === 'image' || item.format === 'gif')
        wanted.set(item.document.id, item)
    }

    for (const [id, record] of this.records) {
      const next = wanted.get(id)
      if (!next || next.url !== record.url)
        this.remove(id)
    }
    for (const [id, item] of wanted) {
      const record = this.records.get(id)
      if (!record)
        this.load(id, item)
      else if (record.placement !== item.document.placement)
        this.place(record, item.document.placement)
    }
    this.refresh()
  }

  /** Advances the item clock by one stage tick and picks each GIF's frame. Under reduced motion GIFs show their first frame. */
  advance(deltaMs: number, animated: boolean) {
    this.clockMs += deltaMs
    for (const record of this.records.values()) {
      if (record.gif && record.state !== 'failed')
        record.gif.show(animated ? gifFrameAt(record.gif.frameDurationsMs, this.clockMs - record.shownAtMs) : 0)
    }
  }

  destroy() {
    for (const id of [...this.records.keys()])
      this.release(id)
    this.records.clear()
    this.insertions = []
    this.install(false)
    this.root.destroy()
  }

  private remove(id: string) {
    this.release(id)
    this.records.delete(id)
  }

  private release(id: string) {
    const record = this.records.get(id)
    if (!record)
      return
    record.removed = true
    this.releaseDisplay(record)
  }

  private releaseDisplay(record: ItemRecord) {
    const { sprite, gif } = record
    record.sprite = undefined
    record.gif = undefined
    if (sprite) {
      this.root.removeChild(sprite)
      // A GIF's texture belongs to its player, an image's to its sprite.
      sprite.destroy({ texture: !gif, baseTexture: !gif })
    }
    gif?.destroy()
  }

  private load(id: string, item: Live2DStageItem) {
    const record: ItemRecord = { url: item.url, placement: item.document.placement, shownAtMs: this.clockMs, removed: false }
    this.records.set(id, record)
    const loaded = item.format === 'gif'
      ? this.loadGif(record)
      : loadImageTexture(item.url).then(texture => ({ texture, gif: undefined }))

    loaded.then(({ texture, gif }) => {
      if (record.removed) {
        if (gif)
          gif.destroy()
        else
          texture.destroy(true)
        return
      }
      const sprite = new Sprite(texture)
      record.sprite = sprite
      record.gif = gif
      record.shownAtMs = this.clockMs
      this.root.addChild(sprite)
      this.place(record, record.placement)
      this.refresh()
    }, () => {
      if (!record.removed)
        this.fail(record)
    })
  }

  private async loadGif(record: ItemRecord) {
    const response = await fetch(record.url)
    if (!response.ok)
      throw new Error(`The GIF item could not be read (HTTP ${response.status}).`)
    const gif = await Live2DGifTexture.open(await response.arrayBuffer(), () => {
      if (!record.removed)
        this.fail(record)
    })
    return { texture: gif.texture, gif }
  }

  /** A failed item stops drawing and keeps its `failed` state until it is removed. */
  private fail(record: ItemRecord) {
    this.releaseDisplay(record)
    record.state = 'failed'
    this.refresh()
  }

  private place(record: ItemRecord, placement: StageItemPlacement) {
    record.placement = placement
    const sprite = record.sprite
    if (!sprite)
      return
    sprite.anchor.set(placement.anchor.x, placement.anchor.y)
    record.resolved = placement.pin ? resolveLive2DItemPin(placement.pin, this.internalModel.coreModel, this.scale) : undefined
    record.pose = undefined
    record.state = this.stateOf(record)
  }

  private stateOf(record: ItemRecord): Live2DItemRenderState {
    if (record.resolved?.state === 'missing-drawable')
      return 'missing-drawable'
    const layer = record.placement.layer
    if (layer.kind === 'above' && this.internalModel.coreModel.getDrawableIndex(layer.drawableId) < 0)
      return 'missing-layer'
    return record.resolved?.state ?? 'attached'
  }

  /** Rebuilds the draw list, installs or removes the hook, and reports states when they changed. */
  private refresh() {
    this.insertions = []
    const states: Record<string, Live2DItemRenderState> = {}
    for (const [id, record] of this.records) {
      if (record.sprite)
        this.insertions.push({ id, layer: record.placement.layer })
      if (record.state)
        states[id] = record.state
    }
    this.install(this.insertions.length > 0)

    const serialized = JSON.stringify(states)
    if (serialized !== this.reportedStates) {
      this.reportedStates = serialized
      this.onStates(states)
    }
  }

  private install(active: boolean) {
    if (active && this.model.itemInsertions !== this.hook) {
      this.model.itemInsertions = this.hook
      this.model.filterArea = this.screen
    }
    else if (!active && this.model.itemInsertions === this.hook) {
      this.model.itemInsertions = undefined
      this.model.filterArea = this.modelFilterArea
    }
  }

  /** Her render hook: runs after her update and transform, so the vertices are this frame's. */
  private segments(): readonly Live2DItemDrawSegment[] {
    const coreModel = this.internalModel.coreModel
    // Model canvas units to world, as her own draw maps them (`Live2DModel._render`).
    this.canvasToWorld.copyFrom(this.model.worldTransform).append(this.internalModel.localTransform)
    this.root.transform.setFromMatrix(this.canvasToWorld)
    this.root.alpha = this.model.worldAlpha

    for (const record of this.records.values()) {
      const sprite = record.sprite
      if (!sprite)
        continue
      const pose = solveLive2DItemPose(record.placement, record.resolved, coreModel, this.scale, record.pose)
      record.pose = pose
      sprite.position.set(pose.x, pose.y)
      sprite.rotation = pose.rotation
      sprite.scale.set(record.placement.flipX ? -pose.scale : pose.scale, pose.scale)
      sprite.alpha = pose.alpha
      sprite.visible = pose.visible
    }
    // The root has no parent, so it borrows one to compute its children's world transforms.
    const parent = this.root.enableTempParent()
    this.root.updateTransform()
    this.root.disableTempParent(parent)

    const plan = resolveInsertionSegments(this.insertions, coreModel.getDrawableRenderOrders(), id => coreModel.getDrawableIndex(id))
    return plan.segments.map(segment => segment.kind === 'model'
      ? segment
      : { kind: 'insert', render: (renderer: Renderer) => this.renderItems(segment.itemIds, renderer) })
  }

  private renderItems(ids: readonly string[], renderer: Renderer) {
    for (const id of ids)
      this.records.get(id)?.sprite?.render(renderer)
  }
}

/** Loads an image into a texture of its own, outside Pixi's texture cache, so two items never share one. */
async function loadImageTexture(url: string): Promise<Texture> {
  const image = new Image()
  image.src = url
  await image.decode()
  return new Texture(new BaseTexture(image))
}
