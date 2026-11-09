<script setup lang="ts">
/**
 * Fixed-size frame for visual baseline screenshots.
 *
 * It renders the default slot twice: once on a light panel and once inside a `.dark` panel, so one reference image
 * covers both color modes. Keep its classes in this file: UnoCSS scans `src/**\/*.vue` before the first stylesheet
 * response, but not test files.
 */
withDefaults(defineProps<{
  /** `stack` puts each child on its own full-width row. `wrap` flows children inline, such as a set of buttons. */
  layout?: 'stack' | 'wrap'
}>(), {
  layout: 'stack',
})
</script>

<template>
  <div
    data-testid="visual-baseline"
    :class="[
      'visual-baseline-frame',
      'w-90 flex flex-col',
    ]"
  >
    <div
      v-for="mode in ['light', 'dark'] as const"
      :key="mode"
      :class="[
        mode === 'dark' ? 'dark bg-neutral-950 text-neutral-100' : 'bg-white text-neutral-900',
        layout === 'wrap' ? 'flex flex-wrap items-center gap-3' : 'flex flex-col gap-3',
        'p-4',
      ]"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
/*
 * The bundled DM Sans file renders the same glyph outlines on every platform. Without it, text falls back to whatever
 * system font each machine resolves, and the references would depend on installed fonts.
 */
.visual-baseline-frame {
  font-family: 'DM Sans Variable', sans-serif;
}
</style>
