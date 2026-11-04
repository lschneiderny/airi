<script setup lang="ts">
import type { MoodAxes } from '@proj-airi/stage-shared/character-state'
import type { CharacterStateInspection } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'

import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatAgo, formatClock } from '../../situation/situation-format'
import { bodyClass, cardClass, cellClass, formatAxis, labelClass, noteClass, rowClass } from '../character-state-styles'

const props = defineProps<{
  inspection: CharacterStateInspection
}>()

const { t } = useI18n()

const AXES = ['valence', 'energy', 'tension'] as const satisfies readonly (keyof MoodAxes)[]

interface AxisRow {
  axis: keyof MoodAxes
  signed: boolean
  mood: string
  raw: string
  resting: string
  temperament: string
  bucket: string
}

const rows = computed<AxisRow[]>(() => {
  const { reading, raw, temperament } = props.inspection
  return AXES.map((axis) => {
    const signed = axis !== 'tension'
    return {
      axis,
      signed,
      mood: reading ? formatAxis(reading.mood[axis], signed) : '-',
      raw: formatAxis(raw[axis]),
      resting: reading ? formatAxis(reading.resting[axis], signed) : '-',
      temperament: temperament ? formatAxis(temperament.axes[axis], signed) : '-',
      bucket: reading?.buckets[axis] ?? '-',
    }
  })
})

const throughHourText = computed(() => {
  const through = props.inspection.temperament?.throughHourMs
  return through === undefined ? '-' : `${formatClock(through)} (${formatAgo(through, props.inspection.nowMs)})`
})
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.character-state.mood.title')" icon="i-solar:heart-pulse-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['overflow-x-auto', ...cardClass]">
      <div :class="labelClass">
        {{ t('tamagotchi.settings.devtools.pages.character-state.mood.axes') }}
      </div>
      <table data-testid="character-state-mood-axes" :class="['mt-2 w-full', ...bodyClass]">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.mood.columns.axis') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.mood.columns.mood') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.mood.columns.raw') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.mood.columns.resting') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.mood.columns.temperament') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.mood.columns.bucket') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.axis" :data-axis="row.axis" :class="rowClass">
            <td :class="[...cellClass, 'font-medium']">
              {{ t(`tamagotchi.settings.devtools.pages.character-state.mood.axis-names.${row.axis}`) }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right']">
              {{ row.mood }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right']">
              {{ row.raw }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right']">
              {{ row.resting }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right']">
              {{ row.temperament }}
            </td>
            <td :class="cellClass">
              {{ row.bucket }}
            </td>
          </tr>
        </tbody>
      </table>
      <div :class="['mt-2', ...noteClass]">
        {{ t('tamagotchi.settings.devtools.pages.character-state.temperament.note') }}
        {{ t('tamagotchi.settings.devtools.pages.character-state.temperament.through-hour') }}: {{ throughHourText }}
      </div>
    </div>

    <div :class="['grid gap-2 md:grid-cols-2']">
      <div :class="['flex flex-col gap-2', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.mood.text') }}
        </div>
        <pre
          v-if="inspection.renderedText"
          data-testid="character-state-rendered-text"
          :class="['whitespace-pre-wrap break-words font-sans', ...bodyClass]"
        >{{ inspection.renderedText }}</pre>
        <div v-else data-testid="character-state-rendered-text" :class="bodyClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.mood.at-rest') }}
        </div>
        <div :class="noteClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.mood.text-note') }}
        </div>
      </div>
      <div :class="['flex flex-col gap-2', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.mood.reasons') }}
        </div>
        <ul v-if="inspection.reading && inspection.reading.reasons.length > 0" data-testid="character-state-reasons" :class="['flex flex-col gap-1', ...bodyClass]">
          <li v-for="reason in inspection.reading.reasons" :key="reason.id" :class="['flex flex-wrap items-baseline justify-between gap-2']">
            <span :class="['break-words']">{{ reason.text }}</span>
            <span :class="['font-mono text-xs', 'text-neutral-500 dark:text-neutral-400']">{{ formatAgo(reason.atMs, inspection.nowMs) }}</span>
          </li>
        </ul>
        <div v-else data-testid="character-state-reasons" :class="bodyClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.mood.no-reasons') }}
        </div>
        <dl :class="['grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5', ...noteClass]">
          <dt>{{ t('tamagotchi.settings.devtools.pages.character-state.mood.urge-factor') }}</dt>
          <dd :class="['font-mono']">
            {{ inspection.reading ? inspection.reading.urgeFactor.toFixed(3) : '-' }}
          </dd>
          <dt>{{ t('tamagotchi.settings.devtools.pages.character-state.mood.pointed') }}</dt>
          <dd :class="['font-mono']">
            {{ inspection.reading ? String(inspection.reading.pointed) : '-' }}
          </dd>
          <dt>{{ t('tamagotchi.settings.devtools.pages.character-state.mood.last-interaction') }}</dt>
          <dd :class="['font-mono']">
            {{ formatAgo(inspection.lastInteractionAtMs, inspection.nowMs) }}
          </dd>
        </dl>
      </div>
    </div>
  </Section>
</template>
