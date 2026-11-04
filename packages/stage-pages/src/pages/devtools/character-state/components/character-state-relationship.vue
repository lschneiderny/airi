<script setup lang="ts">
import type { RelationshipLevels } from '@proj-airi/stage-shared/character-state'
import type { CharacterStateInspection } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'

import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatAgo } from '../../situation/situation-format'
import { bodyClass, cardClass, cellClass, labelClass, rowClass } from '../character-state-styles'

const props = defineProps<{
  inspection: CharacterStateInspection
}>()

const { t } = useI18n()

const DIMENSIONS = ['closeness', 'trust', 'familiarity'] as const satisfies readonly (keyof RelationshipLevels)[]

interface DimensionRow {
  dimension: keyof RelationshipLevels
  level: string
  stage: string
  pending: string
}

const rows = computed<DimensionRow[]>(() => {
  const { relationship } = props.inspection
  return DIMENSIONS.map(dimension => ({
    dimension,
    level: relationship ? relationship.levels[dimension].toFixed(3) : '-',
    stage: relationship?.stages[dimension] ?? '-',
    pending: relationship?.pendingStageUps[dimension] ?? '-',
  }))
})

const woundText = computed(() => {
  const { relationship } = props.inspection
  if (!relationship)
    return '-'
  return relationship.wound < 0.0005 ? t('tamagotchi.settings.devtools.pages.character-state.relationship.wound-none') : relationship.wound.toFixed(3)
})

const facts = computed(() => {
  const { relationship, reading, nowMs } = props.inspection
  return [
    { id: 'unlocks', label: t('tamagotchi.settings.devtools.pages.character-state.relationship.unlocks'), value: reading && reading.unlocks.length > 0 ? reading.unlocks.join(', ') : t('tamagotchi.settings.devtools.pages.character-state.relationship.no-unlocks') },
    { id: 'wound', label: t('tamagotchi.settings.devtools.pages.character-state.relationship.wound'), value: woundText.value },
    { id: 'active-days', label: t('tamagotchi.settings.devtools.pages.character-state.relationship.active-days'), value: relationship ? String(relationship.activeDays) : '-' },
    { id: 'milestones', label: t('tamagotchi.settings.devtools.pages.character-state.relationship.milestones'), value: relationship ? String(relationship.milestoneIds.length) : '-' },
    { id: 'last-seen', label: t('tamagotchi.settings.devtools.pages.character-state.relationship.last-seen'), value: formatAgo(relationship?.lastSeenAtMs, nowMs) },
  ]
})
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.character-state.relationship.title')" icon="i-solar:users-group-rounded-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid gap-2 md:grid-cols-[3fr_2fr]']">
      <div :class="['overflow-x-auto', ...cardClass]">
        <table data-testid="character-state-relationship" :class="['w-full', ...bodyClass]">
          <thead :class="labelClass">
            <tr>
              <th :class="cellClass">
                {{ t('tamagotchi.settings.devtools.pages.character-state.relationship.columns.dimension') }}
              </th>
              <th :class="[...cellClass, 'text-right']">
                {{ t('tamagotchi.settings.devtools.pages.character-state.relationship.columns.level') }}
              </th>
              <th :class="cellClass">
                {{ t('tamagotchi.settings.devtools.pages.character-state.relationship.columns.stage') }}
              </th>
              <th :class="cellClass">
                {{ t('tamagotchi.settings.devtools.pages.character-state.relationship.columns.pending') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.dimension" :data-dimension="row.dimension" :class="rowClass">
              <td :class="[...cellClass, 'font-medium']">
                {{ t(`tamagotchi.settings.devtools.pages.character-state.relationship.dimensions.${row.dimension}`) }}
              </td>
              <td :class="[...cellClass, 'font-mono text-right']">
                {{ row.level }}
              </td>
              <td :class="cellClass">
                {{ row.stage }}
              </td>
              <td :class="cellClass">
                {{ row.pending }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl data-testid="character-state-relationship-facts" :class="['grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1', ...cardClass, ...bodyClass]">
        <template v-for="fact in facts" :key="fact.id">
          <dt :class="labelClass">
            {{ fact.label }}
          </dt>
          <dd :data-fact="fact.id" :class="['break-words']">
            {{ fact.value }}
          </dd>
        </template>
      </dl>
    </div>
  </Section>
</template>
