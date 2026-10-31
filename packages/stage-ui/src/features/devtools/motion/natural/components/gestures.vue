<script setup lang="ts">
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

const prefix = 'tamagotchi.settings.devtools.pages.live2d-natural-motion.gestures'
const gestures: CueGestureKind[] = ['nod', 'shake', 'shrug', 'lean', 'glance']
const counts = [1, 2, 3]

const { t } = useI18n()
const override = useNaturalPerformanceOverride()
const { live2dMotionDriver } = storeToRefs(useSettingsLive2d())
const count = ref(1)
// Gestures play under Live2D Natural only; MAGIC, Universal, and MMD Natural ignore them.
const disabled = computed(() => live2dMotionDriver.value !== 'natural')

function play(kind: CueGestureKind) {
  // Count only applies to the repeating gestures.
  override.requestGesture(kind, kind === 'nod' || kind === 'shake' ? count.value : 1)
}
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:hand-shake-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ disabled ? t(`${prefix}.requires-natural`) : t(`${prefix}.description`) }}
    </div>
    <div :class="['flex flex-wrap items-center gap-2']">
      <span :class="['text-sm']">{{ t(`${prefix}.count`) }}</span>
      <Button
        v-for="choice in counts"
        :key="choice"
        :label="String(choice)"
        :aria-pressed="count === choice"
        :variant="count === choice ? 'primary' : 'secondary'"
        :disabled="disabled"
        size="sm"
        @click="count = choice"
      />
    </div>
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="kind in gestures"
        :key="kind"
        :data-gesture="kind"
        size="sm"
        variant="secondary"
        :disabled="disabled"
        :label="t(`${prefix}.names.${kind}`)"
        @click="play(kind)"
      />
    </div>
  </Section>
</template>
