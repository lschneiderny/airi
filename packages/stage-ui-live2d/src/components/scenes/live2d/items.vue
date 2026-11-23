<script setup lang="ts">
import type { Application } from '@pixi/app'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'

import type { Live2DItemRenderState, Live2DStageItem } from '../../../composables/live2d/items/layer'

import { UPDATE_PRIORITY } from '@pixi/ticker'
import { usePreferredReducedMotion } from '@vueuse/core'
import { watch } from 'vue'

import { Live2DItemLayer } from '../../../composables/live2d/items/layer'

const props = defineProps<{
  app: Application
  /** Her loaded model, or `undefined` while none is loaded. */
  model?: Live2DModel
  items: readonly Live2DStageItem[]
}>()

const emit = defineEmits<{
  /** Every shown item's state, replacing the previous report; `{}` once nothing draws. */
  (e: 'states', states: Readonly<Record<string, Live2DItemRenderState>>): void
}>()

const preferredMotion = usePreferredReducedMotion()
let layer: Live2DItemLayer | undefined

// One layer per loaded model: a model swap or unmount releases every texture and decoder of the previous one.
watch(() => [props.app, props.model] as const, ([app, model], _, onCleanup) => {
  if (!model)
    return

  const created = new Live2DItemLayer(model, app.screen, states => emit('states', states))
  layer = created
  created.setItems(props.items)

  // The item clock reads the stage ticker, which stops while the stage is paused, so items
  // freeze with her and never integrate the paused time. It runs ahead of the render.
  const tick = () => created.advance(app.ticker.deltaMS, preferredMotion.value !== 'reduce')
  app.ticker.add(tick, undefined, UPDATE_PRIORITY.HIGH)

  onCleanup(() => {
    app.ticker.remove(tick)
    created.destroy()
    if (layer === created)
      layer = undefined
    emit('states', {})
  })
}, { immediate: true })

watch(() => props.items, items => layer?.setItems(items))

defineExpose({
  /** Whether a point in her model canvas units lies on a shown outfit; see `Live2DItemLayer.outfitAt`. */
  outfitAt: (point: { x: number, y: number }) => layer?.outfitAt(point) ?? false,
  poseOf: (id: string) => layer?.poseOf(id),
})
</script>

<template>
  <slot />
</template>
