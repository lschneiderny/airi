<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import ArmsPanel from './components/arms-panel.vue'
import BodyReadouts from './components/body-readouts.vue'
import ClipsPanel from './components/clips-panel.vue'
import DirectorPanel from './components/director-panel.vue'
import LocomotionPanel from './components/locomotion-panel.vue'
import OverlayControls from './components/overlay-controls.vue'
import RigReport from './components/rig-report.vue'
import TimingsPanel from './components/timings-panel.vue'
import WorldPanel from './components/world-panel.vue'

const { t } = useI18n()
</script>

<template>
  <div :class="['grid gap-4 pb-12']">
    <div :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('tamagotchi.settings.devtools.pages.mmd-motion.main-window-note') }}
    </div>
    <OverlayControls />
    <WorldPanel />
    <LocomotionPanel />
    <DirectorPanel />
    <ArmsPanel />
    <ClipsPanel />
    <BodyReadouts />
    <TimingsPanel />
    <RigReport />
  </div>
</template>
