<script setup lang="ts">
import type { IdleBehaviourKind } from '@proj-airi/motion-driver-natural/idle-activities'

import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

const prefix = 'tamagotchi.settings.devtools.pages.live2d-natural-motion.idle-behaviours'
const behaviours: IdleBehaviourKind[] = ['stretch', 'yawn', 'look-around', 'check-in', 'peer', 'zone-out', 'nod-off', 'sway', 'sleep', 'about-to-speak', 'let-go']

const { t } = useI18n()
const override = useNaturalPerformanceOverride()
const { live2dMotionDriver } = storeToRefs(useSettingsLive2d())
// Idle behaviours play under Live2D Natural only, and only with the Idle activities setting on.
const disabled = computed(() => live2dMotionDriver.value !== 'natural')
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:sleeping-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ disabled ? t(`${prefix}.requires-natural`) : t(`${prefix}.description`) }}
    </div>
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="kind in behaviours"
        :key="kind"
        :data-idle-behaviour="kind"
        size="sm"
        variant="secondary"
        :disabled="disabled"
        :label="t(`${prefix}.names.${kind}`)"
        @click="override.requestIdle(kind)"
      />
    </div>
  </Section>
</template>
