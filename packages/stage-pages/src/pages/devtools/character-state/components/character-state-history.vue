<script setup lang="ts">
import type { DailySummary } from '@proj-airi/stage-shared/character-state'

import { Section } from '@proj-airi/stage-ui/components'
import { CHARACTER_STATE_HISTORY_SHOWN } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'
import { useI18n } from 'vue-i18n'

import { bodyClass, cardClass, cellClass, formatAxes, labelClass, noteClass, rowClass } from '../character-state-styles'

defineProps<{
  /** Newest first. */
  history: DailySummary[]
}>()

const { t } = useI18n()

function levelsText(levels: DailySummary['levels']): string {
  return `${levels.closeness.toFixed(3)} / ${levels.trust.toFixed(3)} / ${levels.familiarity.toFixed(3)}`
}

function stagesText(stages: DailySummary['stages']): string {
  return `${stages.closeness}, ${stages.trust}, ${stages.familiarity}`
}
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.character-state.history.title')" icon="i-solar:calendar-mark-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['overflow-x-auto', ...cardClass]">
      <div :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.character-state.history.note', { count: CHARACTER_STATE_HISTORY_SHOWN }) }}
      </div>
      <div v-if="history.length === 0" data-testid="character-state-history-empty" :class="['mt-2', ...bodyClass]">
        {{ t('tamagotchi.settings.devtools.pages.character-state.history.empty') }}
      </div>
      <table v-else data-testid="character-state-history" :class="['mt-2 w-full', ...bodyClass]">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.history.columns.day') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.history.columns.mood') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.history.columns.temperament') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.history.columns.levels') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.history.columns.stages') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in history" :key="row.dayKey" :data-day="row.dayKey" :class="rowClass">
            <td :class="[...cellClass, 'font-mono whitespace-nowrap']">
              {{ row.dayKey }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right whitespace-nowrap']">
              {{ formatAxes(row.mood) }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right whitespace-nowrap']">
              {{ formatAxes(row.temperament) }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right whitespace-nowrap']">
              {{ levelsText(row.levels) }}
            </td>
            <td :class="cellClass">
              {{ stagesText(row.stages) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Section>
</template>
