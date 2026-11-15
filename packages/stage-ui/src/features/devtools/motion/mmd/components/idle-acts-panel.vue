<script setup lang="ts">
import type { IdleBodyKind } from '@proj-airi/motion-driver-natural/idle-activities'

import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.idle-acts'
// The kinds only a body host performs. The Natural motion lab plays the ones Live2D shares.
const acts: IdleBodyKind[] = ['sigh', 'shoulder-roll', 'shift-stance', 'clasp-hands', 'hair-touch', 'heel-rock', 'arm-swing']

const { t } = useI18n()
const override = useNaturalPerformanceOverride()
const { snapshot } = storeToRefs(useMMDMotionDiagnostics())
// Only the Natural driver runs the idle scheduler that plays them.
const disabled = computed(() => snapshot.value.driver !== 'natural')
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
        v-for="kind in acts"
        :key="kind"
        :data-idle-act="kind"
        size="sm"
        variant="secondary"
        :disabled="disabled"
        :label="t(`${prefix}.names.${kind}`)"
        @click="override.requestIdle(kind)"
      />
    </div>
  </Section>
</template>
