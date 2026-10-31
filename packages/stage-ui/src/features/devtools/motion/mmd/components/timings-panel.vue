<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.timings'

const { t } = useI18n()
const { snapshot } = storeToRefs(useMMDMotionDiagnostics())

const stages = computed(() => Object.entries(snapshot.value.timings).map(([id, timing]) => ({ id, lastMs: timing.lastMs, p95Ms: timing.p95Ms })))
const summary = computed(() => ({
  model: snapshot.value.loadedModelKey ?? t(`${prefix}.no-model`),
  driver: snapshot.value.driver,
  fps: `${snapshot.value.fps.last.toFixed(0)} / ${snapshot.value.fps.mean60s.toFixed(0)}`,
}))
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:stopwatch-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['flex flex-wrap gap-x-6 gap-y-1 text-xs']">
      <span>
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ t(`${prefix}.model`) }}</span>
        <span data-testid="mmd-timings-model" :class="['ml-1 font-mono']">{{ summary.model }}</span>
      </span>
      <span>
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ t(`${prefix}.driver`) }}</span>
        <span data-testid="mmd-timings-driver" :class="['ml-1 font-mono']">{{ summary.driver }}</span>
      </span>
      <span>
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ t(`${prefix}.fps`) }}</span>
        <span data-testid="mmd-timings-fps" :class="['ml-1 font-mono tabular-nums']">{{ summary.fps }}</span>
      </span>
    </div>
    <table v-if="stages.length" data-testid="mmd-timings" :class="['w-full text-left text-xs']">
      <thead>
        <tr :class="['text-neutral-500 dark:text-neutral-400']">
          <th :class="['py-1 font-medium']">
            {{ t(`${prefix}.columns.stage`) }}
          </th>
          <th :class="['py-1 text-right font-medium']">
            {{ t(`${prefix}.columns.last`) }}
          </th>
          <th :class="['py-1 text-right font-medium']">
            {{ t(`${prefix}.columns.p95`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="stage in stages" :key="stage.id" :class="['border-t border-neutral-200 dark:border-neutral-700']">
          <td :class="['py-1 font-mono']">
            {{ stage.id }}
          </td>
          <td :class="['py-1 text-right font-mono tabular-nums']">
            {{ stage.lastMs.toFixed(2) }}
          </td>
          <td :class="['py-1 text-right font-mono tabular-nums']">
            {{ stage.p95Ms.toFixed(2) }}
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t(`${prefix}.empty`) }}
    </div>
  </Section>
</template>
