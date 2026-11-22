import type { Renderer } from '@pixi/core'
import type { Rectangle } from '@pixi/math'
import type { ItemExpressionDocument, ItemRenderState, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'
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
import { MAX_SHOWN_LIVE2D_ITEMS } from '@proj-airi/stage-shared/expression-performance'
import { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

import { gifFrameAt } from './gif-clock'
import { Live2DGifTexture } from './gif-texture'
import { resolveInsertionSegments } from './insertion'
import { Live2DItemModel } from './live2d-item'
import { resolveLive2DItemPin } from './pin'
import { solveLive2DItemPose } from './pose'

/** An item the scene shows: its document, the library URL of its file, and the file's format. */
export interface Live2DStageItem {
  document: ItemExpressionDocument
  url: string
  format: StageItemFormat
}

/** How a shown item attached to her model; see `ItemRenderState`. */
export type Live2DItemRenderState = ItemRenderState

interface ItemRecord {
  url: string
  format: StageItemFormat
  link: ItemExpressionDocument['link']
  placement: StageItemPlacement
  hides: readonly string[]
  /** Set once an image or GIF loaded; the sprite is a child of the layer's root. */
  sprite?: Sprite
  gif?: Live2DGifTexture
  /** Set once a Live2D item loaded; its model is a child of the layer's root. */
  live2d?: Live2DItemModel
  resolved?: Live2DItemPinResolution
  pose?: Live2DItemPose
  /** Item-clock time when it began to show; a GIF plays from its first frame then. */
  shownAtMs: number
  state?: Live2DItemRenderState
  /** Set on removal, so a load that finishes later releases what it made. */
  removed: boolean
}

interface LoadedDisplay {
  sprite?: Sprite
  gif?: Live2DGifTexture
  live2d?: Live2DItemModel
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
 * At her `beforeModelUpdate`, after pose and before her core update, it sets the
 * parts in a drawn item's hide list to opacity 0, restores a part's opacity from
 * her load once no drawn item hides it, and captures her final parameters for
 * linked Live2D items.
 *
 * Items advance on their own clock, fed by `advance` from the stage ticker:
 * the ticker stops while the stage is paused, so GIFs and Live2D items freeze
 * with her.
 *
 * The layer owns every texture, GIF decoder, Live2D model, and sprite it creates;
 * `remove` and `destroy` release them, including those of loads still in flight.
 */
export class Live2DItemLayer {
  private readonly internalModel: Cubism4InternalModel
  private readonly scale: Live2DCanvasScale
  /** Holds the item display objects in her model canvas units; never part of the stage. */
  private readonly root = new Container()
  private readonly canvasToWorld = new Matrix()
  private readonly records = new Map<string, ItemRecord>()
  private insertions: Live2DItemInsertion[] = []
  private readonly hook: Live2DItemInsertions = { segments: () => this.segments() }
  private readonly modelFilterArea: Rectangle
  private readonly partIndexById = new Map<string, number>()
  /** Her part opacities when the layer attached, which a part gets back once no item hides it. */
  private readonly partBaseline: Float32Array
  private hiddenParts = new Set<number>()
  private readonly partsToRestore = new Set<number>()
  private readonly beforeModelUpdate = () => this.applyBeforeModelUpdate()
  private clockMs = 0
  private animated = true
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

    const coreModel = this.internalModel.coreModel
    // The core's own id table: `getPartIndex` registers an unknown id instead of reporting it.
    coreModel.getModel().parts.ids.forEach((id, index) => this.partIndexById.set(id, index))
    this.partBaseline = new Float32Array(coreModel.getPartCount())
    for (let index = 0; index < this.partBaseline.length; index++)
      this.partBaseline[index] = coreModel.getPartOpacityByIndex(index)
    this.internalModel.on('beforeModelUpdate', this.beforeModelUpdate)
  }

  /**
   * Shows exactly these items. An item whose file URL or parameter link changed
   * loads again; one whose placement or hide list changed is placed again,
   * re-attaching its pin. Live2D items beyond `MAX_SHOWN_LIVE2D_ITEMS`, in list
   * order, never load: the expression store refuses them before they get here.
   */
  setItems(items: readonly Live2DStageItem[]) {
    const wanted = new Map<string, Live2DStageItem>()
    let live2dItems = 0
    for (const item of items) {
      if (item.format === 'live2d-zip' && ++live2dItems > MAX_SHOWN_LIVE2D_ITEMS) {
        console.warn('[live2d-items] Not loading a Live2D item past the limit:', item.document.id)
        continue
      }
      wanted.set(item.document.id, item)
    }

    for (const [id, record] of this.records) {
      const next = wanted.get(id)
      if (!next || next.url !== record.url || (record.format === 'live2d-zip' && next.document.link !== record.link))
        this.remove(id)
    }
    for (const [id, item] of wanted) {
      const record = this.records.get(id)
      if (!record) {
        this.load(id, item)
      }
      else if (record.placement !== item.document.placement || record.hides !== item.document.hides) {
        record.hides = item.document.hides
        this.place(record, item.document.placement)
      }
    }
    this.refresh()
  }

  /**
   * Advances the item clock by one stage tick: picks each GIF's frame and steps each
   * Live2D item. Under reduced motion GIFs show their first frame and Live2D items
   * start no idle motion.
   */
  advance(deltaMs: number, animated: boolean) {
    this.clockMs += deltaMs
    this.animated = animated
    for (const record of this.records.values()) {
      if (record.state === 'failed')
        continue
      if (record.gif)
        record.gif.show(animated ? gifFrameAt(record.gif.frameDurationsMs, this.clockMs - record.shownAtMs) : 0)
      record.live2d?.advance(deltaMs)
    }
  }

  destroy() {
    this.internalModel.off('beforeModelUpdate', this.beforeModelUpdate)
    for (const id of [...this.records.keys()])
      this.release(id)
    this.records.clear()
    this.insertions = []
    this.install(false)
    // Her model outlives the layer when only the items unmount; a swapped-out model is already destroyed.
    if (!this.model.destroyed) {
      for (const index of this.hiddenParts)
        this.internalModel.coreModel.setPartOpacityByIndex(index, this.partBaseline[index])
    }
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
    const display: LoadedDisplay = { sprite: record.sprite, gif: record.gif, live2d: record.live2d }
    record.sprite = undefined
    record.gif = undefined
    record.live2d = undefined
    if (display.sprite)
      this.root.removeChild(display.sprite)
    if (display.live2d)
      this.root.removeChild(display.live2d.model)
    destroyDisplay(display)
  }

  private load(id: string, item: Live2DStageItem) {
    const record: ItemRecord = {
      url: item.url,
      format: item.format,
      link: item.document.link,
      placement: item.document.placement,
      hides: item.document.hides,
      shownAtMs: this.clockMs,
      removed: false,
    }
    this.records.set(id, record)

    this.loadDisplay(record).then((display) => {
      if (record.removed) {
        destroyDisplay(display)
        return
      }
      record.sprite = display.sprite
      record.gif = display.gif
      record.live2d = display.live2d
      record.shownAtMs = this.clockMs
      const object = display.sprite ?? display.live2d?.model
      if (object)
        this.root.addChild(object)
      this.place(record, record.placement)
      this.refresh()
    }, () => {
      if (!record.removed)
        this.fail(record)
    })
  }

  private async loadDisplay(record: ItemRecord): Promise<LoadedDisplay> {
    if (record.format === 'live2d-zip') {
      const live2d = await Live2DItemModel.load(record.url, {
        linked: record.link === 'parameters',
        herParameterIds: this.internalModel.coreModel.getModel().parameters.ids,
        animated: () => this.animated,
      })
      return { live2d }
    }
    if (record.format === 'gif') {
      const gif = await this.loadGif(record)
      return { sprite: new Sprite(gif.texture), gif }
    }
    return { sprite: new Sprite(await loadImageTexture(record.url)) }
  }

  private async loadGif(record: ItemRecord) {
    const response = await fetch(record.url)
    if (!response.ok)
      throw new Error(`The GIF item could not be read (HTTP ${response.status}).`)
    return Live2DGifTexture.open(await response.arrayBuffer(), () => {
      if (!record.removed)
        this.fail(record)
    })
  }

  /** A failed item stops drawing and keeps its `failed` state until it is removed. */
  private fail(record: ItemRecord) {
    this.releaseDisplay(record)
    record.state = 'failed'
    this.refresh()
  }

  private place(record: ItemRecord, placement: StageItemPlacement) {
    record.placement = placement
    if (!record.sprite && !record.live2d)
      return
    record.sprite?.anchor.set(placement.anchor.x, placement.anchor.y)
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
    if (record.hides.some(id => !this.partIndexById.has(id)))
      return 'missing-part'
    return record.resolved?.state ?? 'attached'
  }

  /** Rebuilds the draw list and the hidden parts, installs or removes the hook, and reports states when they changed. */
  private refresh() {
    this.insertions = []
    const states: Record<string, Live2DItemRenderState> = {}
    const hidden = new Set<number>()
    for (const [id, record] of this.records) {
      if (record.sprite || record.live2d) {
        this.insertions.push({ id, layer: record.placement.layer })
        for (const partId of record.hides) {
          const index = this.partIndexById.get(partId)
          if (index !== undefined)
            hidden.add(index)
        }
      }
      if (record.state)
        states[id] = record.state
    }
    for (const index of this.hiddenParts) {
      if (!hidden.has(index))
        this.partsToRestore.add(index)
    }
    for (const index of hidden)
      this.partsToRestore.delete(index)
    this.hiddenParts = hidden
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

  /**
   * Runs after her pose and before her core update. Part opacity is not among the
   * parameters `loadParameters` restores, so a write here lasts until the next one;
   * pose rewrites the parts it manages every frame, so a hidden part is set again
   * each frame and a released part is restored once.
   */
  private applyBeforeModelUpdate() {
    const coreModel = this.internalModel.coreModel
    for (const index of this.partsToRestore)
      coreModel.setPartOpacityByIndex(index, this.partBaseline[index])
    this.partsToRestore.clear()
    for (const index of this.hiddenParts)
      coreModel.setPartOpacityByIndex(index, 0)
    for (const record of this.records.values())
      record.live2d?.capture(coreModel)
  }

  /** Her render hook: runs after her update and transform, so the vertices are this frame's. */
  private segments(): readonly Live2DItemDrawSegment[] {
    const coreModel = this.internalModel.coreModel
    // Model canvas units to world, as her own draw maps them (`Live2DModel._render`).
    this.canvasToWorld.copyFrom(this.model.worldTransform).append(this.internalModel.localTransform)
    this.root.transform.setFromMatrix(this.canvasToWorld)
    this.root.alpha = this.model.worldAlpha

    for (const record of this.records.values()) {
      const { sprite, live2d, placement } = record
      if (!sprite && !live2d)
        continue
      const pose = solveLive2DItemPose(placement, record.resolved, coreModel, this.scale, record.pose)
      record.pose = pose
      live2d?.place(pose, placement)
      if (sprite) {
        sprite.position.set(pose.x, pose.y)
        sprite.rotation = pose.rotation
        sprite.scale.set(placement.flipX ? -pose.scale : pose.scale, pose.scale)
        sprite.alpha = pose.alpha
        sprite.visible = pose.visible
      }
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
    for (const id of ids) {
      const record = this.records.get(id)
      record?.sprite?.render(renderer)
      // A Live2D item steps here, after her update in the same frame, by the time its clock accumulated.
      record?.live2d?.render(renderer)
    }
  }
}

function destroyDisplay({ sprite, gif, live2d }: LoadedDisplay) {
  // A GIF's texture belongs to its player, an image's to its sprite.
  sprite?.destroy({ texture: !gif, baseTexture: !gif })
  gif?.destroy()
  live2d?.destroy()
}

/** Loads an image into a texture of its own, outside Pixi's texture cache, so two items never share one. */
async function loadImageTexture(url: string): Promise<Texture> {
  const image = new Image()
  image.src = url
  await image.decode()
  return new Texture(new BaseTexture(image))
}
