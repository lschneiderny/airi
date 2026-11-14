<script setup lang="ts">
import type { NaturalReviewCaptionLine } from '../../../composables/live2d/natural-motion/review'

defineProps<{
  /** What drives the head and the eyes now, from `NaturalReviewLog.caption`, refreshed by the stage. */
  lines: NaturalReviewCaptionLine[]
}>()
</script>

<template>
  <!-- A developer readout over the stage; it never takes pointer input. -->
  <Teleport to="body">
    <dl
      data-testid="live2d-review-caption"
      :class="[
        'pointer-events-none fixed left-2 top-2 z-[9999]',
        'grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5',
        'rounded-md px-2.5 py-1.5',
        'bg-black/70 text-white',
        'text-xs font-mono leading-snug',
      ]"
    >
      <template v-for="line in lines" :key="line.label">
        <dt :class="['text-white/60']">
          {{ line.label }}
        </dt>
        <dd :data-review-line="line.label">
          {{ line.text }}
        </dd>
      </template>
    </dl>
  </Teleport>
</template>
