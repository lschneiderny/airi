<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BodyReadouts from './components/body-readouts.vue'
import DirectorPanel from './components/director-panel.vue'
import OverlayControls from './components/overlay-controls.vue'
import RigReport from './components/rig-report.vue'
import TimingsPanel from './components/timings-panel.vue'

const { t } = useI18n()
</script>

<template>
  <div :class="['grid gap-4 pb-12']">
    <div :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('tamagotchi.settings.devtools.pages.mmd-motion.main-window-note') }}
    </div>
    <OverlayControls />
    <DirectorPanel />
    <BodyReadouts />
    <TimingsPanel />
    <RigReport />
  </div>
</template>
