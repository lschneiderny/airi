<script setup lang="ts">
import type { Live2DModelCanvasRect } from '../../../composables/live2d/head-anchor'
import type { Live2DTouchDebugOverlay } from '../../../composables/live2d/touch-debug'

import { computed } from 'vue'

import { live2DTouchDebugColors as colors } from '../../../composables/live2d/touch-debug'

const props = defineProps<{
  /** Viewport CSS pixel geometry from `buildLive2DTouchDebug`, refreshed every frame by the stage. */
  overlay: Live2DTouchDebugOverlay
}>()

const trailSegments = computed(() => props.overlay.trail.slice(1).map((point, index) => ({
  from: props.overlay.trail[index],
  to: point,
  color: props.overlay.trail[index].inHead ? colors.trailInHead : colors.trailInZone,
})))

function box(rect: Live2DModelCanvasRect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}
</script>

<template>
  <!-- Fixed to the viewport because the geometry is in viewport CSS pixels; it never takes pointer input. -->
  <Teleport to="body">
    <svg
      data-testid="live2d-touch-debug-overlay"
      :class="['pointer-events-none fixed inset-0 z-[9999] h-full w-full']"
    >
      <rect
        v-if="overlay.regions.body"
        data-region="body"
        v-bind="box(overlay.regions.body)"
        :stroke="colors.body"
        :fill="colors.body"
        :fill-opacity="overlay.hovered === 'body' ? 0.1 : 0"
        stroke-width="1.5"
      />
      <rect
        v-if="overlay.regions.zone"
        data-region="zone"
        v-bind="box(overlay.regions.zone)"
        :stroke="colors.zone"
        fill="none"
        stroke-width="1.5"
        stroke-dasharray="6 4"
      />
      <rect
        v-if="overlay.regions.touch"
        data-region="touch"
        v-bind="box(overlay.regions.touch)"
        :stroke="colors.touch"
        :fill="colors.touch"
        :fill-opacity="overlay.petting ? 0.3 : overlay.hovered === 'head' ? 0.15 : 0"
        stroke-width="2"
      />
      <rect
        v-if="overlay.regions.cursorUnit"
        data-region="cursor-unit"
        v-bind="box(overlay.regions.cursorUnit)"
        :stroke="colors.cursorUnit"
        fill="none"
        stroke-width="1.5"
        stroke-dasharray="2 3"
      />
      <circle
        v-if="overlay.regions.eyeAnchor"
        data-region="eye-anchor"
        :cx="overlay.regions.eyeAnchor.x"
        :cy="overlay.regions.eyeAnchor.y"
        r="4"
        :stroke="colors.eyeAnchor"
        fill="none"
        stroke-width="2"
      />
      <line
        v-for="(segment, index) in trailSegments"
        :key="index"
        :x1="segment.from.x"
        :y1="segment.from.y"
        :x2="segment.to.x"
        :y2="segment.to.y"
        :stroke="segment.color"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle
        v-if="overlay.hostCursor"
        data-region="host-cursor"
        :cx="overlay.hostCursor.x"
        :cy="overlay.hostCursor.y"
        r="7"
        :stroke="colors.hostCursor"
        fill="none"
        stroke-width="2"
      />
      <circle
        v-if="overlay.pointer"
        data-region="pointer"
        :cx="overlay.pointer.x"
        :cy="overlay.pointer.y"
        r="4"
        :fill="colors.pointer"
      />
    </svg>
  </Teleport>
</template>
