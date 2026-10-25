<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AffectTrace from './components/affect-trace.vue'
import EmotionPulses from './components/emotion-pulses.vue'
import PerformanceControls from './components/performance-controls.vue'
import TouchRegions from './components/touch-regions.vue'
import TraceCapture from './components/trace-capture.vue'

const { t } = useI18n()
</script>

<template>
  <div :class="['grid gap-4 pb-12']">
    <div :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.main-window-note') }}
    </div>
    <PerformanceControls />
    <EmotionPulses />
    <AffectTrace />
    <TraceCapture />
    <TouchRegions />
  </div>
</template>
