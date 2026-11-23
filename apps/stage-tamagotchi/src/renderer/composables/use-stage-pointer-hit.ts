import type { StageModelRenderer } from '@proj-airi/stage-ui/stores/settings'
import type { MaybeRefOrGetter, Ref } from 'vue'

import { useElementBounding, useRafFn } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'

import { createStageHitReadState, isInsidePaddedRect, planStageHitRead, StageCanvasHitReader } from './stage-click-through'

export interface StagePointerHitOptions {
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>
  /** The cursor in window DIP. */
  cursorX: MaybeRefOrGetter<number>
  cursorY: MaybeRefOrGetter<number>
  /** Reads only while `true`: the cursor is usable and the stage is mounted and running. */
  active: MaybeRefOrGetter<boolean>
  readPixel: MaybeRefOrGetter<boolean>
  readRegion: MaybeRefOrGetter<boolean>
  /** The radius of the Auto Hide region, in DIP. */
  regionRadius: number
  onReadback: (durationMs: number) => void
  fadeEnabled: MaybeRefOrGetter<boolean>
  renderer: MaybeRefOrGetter<StageModelRenderer>
  threeEnabled: MaybeRefOrGetter<boolean>
  threeTransparent: MaybeRefOrGetter<boolean>
  threeExactTransparent: MaybeRefOrGetter<boolean>
}

export interface StagePointerHit {
  /** Whether the canvas, and no interface drawn over it, is under the cursor. */
  overCanvas: Readonly<Ref<boolean>>
  /** Whether the pixel under the cursor is empty. Meaningful only while {@link overCanvas} is `true`. */
  pixelTransparent: Readonly<Ref<boolean>>
  regionTransparent: Readonly<Ref<boolean>>
  isTransparent: Readonly<Ref<boolean>>
  isTransparentForMouseEvents: Readonly<Ref<boolean>>
}

/**
 * Keeps the classic stage's pointer hit answers current under a cursor that rests, one animation frame at a time.
 *
 * Use when:
 * - A page decides click-through or Auto Hide from the stage pixels under the cursor
 *
 * Expects:
 * - The canvas keeps its drawing buffer, as the Live2D and MMD renderers do
 *
 * Returns:
 * - Answers that change only when a read finds a different one. Reads follow {@link planStageHitRead}: none outside
 *   the padded canvas, where every answer is "not over her", and inside every 100 ms with the cursor still and every
 *   50 ms with it moving, so her motion and stage items change the answer without a cursor move.
 */
export function useStagePointerHit(options: StagePointerHitOptions): StagePointerHit {
  const overCanvas = shallowRef(false)
  const pixelTransparent = shallowRef(true)
  const regionTransparent = shallowRef(true)

  const pixelReader = new StageCanvasHitReader(0, options.onReadback)
  const regionReader = new StageCanvasHitReader(options.regionRadius, options.onReadback)
  onScopeDispose(() => {
    pixelReader.dispose()
    regionReader.dispose()
  })

  const { left, top, width, height } = useElementBounding(options.canvas)
  const hitRead = createStageHitReadState()
  hitRead.lastCursor = { x: 0, y: 0 }
  const cursor = { x: 0, y: 0 }
  const rect = { x: 0, y: 0, width: 0, height: 0 }
  const input = { nowMs: 0, cursor, rect, forceCapture: false, forceIgnore: false }
  const plan = { read: false, state: hitRead }

  const { pause, resume } = useRafFn(({ timestamp }) => {
    const canvas = toValue(options.canvas)
    if (!toValue(options.active) || !canvas)
      return

    cursor.x = toValue(options.cursorX)
    cursor.y = toValue(options.cursorY)
    rect.x = left.value
    rect.y = top.value
    rect.width = width.value
    rect.height = height.value
    if (!isInsidePaddedRect(cursor, rect)) {
      overCanvas.value = false
      pixelTransparent.value = true
      regionTransparent.value = true
      return
    }

    input.nowMs = timestamp
    planStageHitRead(hitRead, input, plan)
    // Interface over the canvas takes its own clicks, so a covered cursor needs no pixel read for click-through.
    if (plan.read)
      overCanvas.value = document.elementFromPoint(cursor.x, cursor.y) === canvas

    if (toValue(options.readPixel)) {
      const hit = pixelReader.read(canvas, cursor, plan.read && overCanvas.value)
      if (hit !== undefined)
        pixelTransparent.value = !hit
    }
    if (toValue(options.readRegion)) {
      const hit = regionReader.read(canvas, cursor, plan.read)
      if (hit !== undefined)
        regionTransparent.value = !hit
    }
  }, { immediate: false })

  watch(() => toValue(options.active) && !!toValue(options.canvas), (active) => {
    if (active) {
      hitRead.lastReadMs = null
      resume()
    }
    else {
      pause()
      pixelReader.dispose()
      regionReader.dispose()
      overCanvas.value = false
    }
  }, { immediate: true, flush: 'sync' })

  const isTransparent = computed(() => {
    if (!toValue(options.active) || !toValue(options.fadeEnabled))
      return true
    return toValue(options.renderer) === 'vrm'
      ? !toValue(options.threeEnabled) || toValue(options.threeTransparent)
      : !toValue(options.canvas) || regionTransparent.value
  })
  const isTransparentForMouseEvents = computed(() => {
    // A scene swap may remove the canvas before its mounted state changes.
    if (!toValue(options.active) || !toValue(options.canvas) || !overCanvas.value)
      return false
    return toValue(options.renderer) === 'vrm'
      ? toValue(options.threeEnabled) && toValue(options.threeExactTransparent)
      : pixelTransparent.value
  })

  return { overCanvas, pixelTransparent, regionTransparent, isTransparent, isTransparentForMouseEvents }
}
