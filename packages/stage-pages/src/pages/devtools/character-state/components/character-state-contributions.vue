<script setup lang="ts">
import type { CharacterContributionInspection } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'

import { Section } from '@proj-airi/stage-ui/components'
import { useI18n } from 'vue-i18n'

import { formatAgo, formatSpan } from '../../situation/situation-format'
import { bodyClass, cardClass, cellClass, formatAxes, labelClass, noteClass, rowClass } from '../character-state-styles'

defineProps<{
  contributions: CharacterContributionInspection[]
  nowMs: number
}>()

const { t } = useI18n()
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.character-state.contributions.title')" icon="i-solar:layers-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['overflow-x-auto', ...cardClass]">
      <div :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.note') }}
      </div>
      <div v-if="contributions.length === 0" data-testid="character-state-contributions-empty" :class="['mt-2', ...bodyClass]">
        {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.empty') }}
      </div>
      <table v-else data-testid="character-state-contributions" :class="['mt-2 w-full', ...bodyClass]">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.columns.when') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.columns.source') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.columns.reason') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.columns.delta') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.columns.half-life') }}
            </th>
            <th :class="[...cellClass, 'text-right']">
              {{ t('tamagotchi.settings.devtools.pages.character-state.contributions.columns.remaining') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contribution in contributions" :key="contribution.id" :data-contribution="contribution.id" :class="rowClass">
            <td :class="[...cellClass, 'whitespace-nowrap']">
              {{ formatAgo(contribution.atMs, nowMs) }}
            </td>
            <td :class="cellClass">
              {{ contribution.source }}
            </td>
            <td :class="[...cellClass, 'break-words']">
              {{ contribution.reason }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right whitespace-nowrap']">
              {{ formatAxes(contribution.delta) }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right whitespace-nowrap']">
              {{ formatSpan(contribution.halfLifeMs) }}
            </td>
            <td :class="[...cellClass, 'font-mono text-right']">
              {{ Math.round(contribution.remaining * 100) }}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Section>
</template>
