<script setup lang="ts">
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d'

import { Button, Input } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Live2dExpressionEntry from './live2d-expression-entry.vue'
import Live2dExpressionGroupRow from './live2d-expression-group-row.vue'

import { groupDisplayName } from './expression-group-name'

const props = defineProps<{
  snapshot: Live2DExpressionSettingsSnapshot
  enabled: boolean
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
}>()

const { t } = useI18n()

function applyExpressionSettingsCommand(command: Live2DExpressionSettingsCommand) {
  emit('command', command)
}

const expressionGroups = computed(() => {
  const groups = new Map<string, string[]>()
  // A group name may be an empty string; only null means ungrouped.
  for (const entry of props.snapshot.groups) {
    if (entry.group !== null)
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry.label])
  }
  return [...groups].map(([name, labels]) => ({ name, labels }))
})

type ExpressionSnapshotEntry = Live2DExpressionSettingsSnapshot['groups'][number]
type ExpressionRow
  = | { type: 'group', group: string, members: ExpressionSnapshotEntry[] }
    | { type: 'entry', entry: ExpressionSnapshotEntry }

/** One row per group at its first member's position, and one row per ungrouped entry, in catalog order. */
const expressionRows = computed<ExpressionRow[]>(() => {
  const entries = props.snapshot.groups
  const seen = new Set<string>()
  const rows: ExpressionRow[] = []
  for (const entry of entries) {
    if (entry.group === null) {
      rows.push({ type: 'entry', entry })
      continue
    }
    if (seen.has(entry.group))
      continue
    seen.add(entry.group)
    rows.push({ type: 'group', group: entry.group, members: entries.filter(member => member.group === entry.group) })
  }
  return rows
})

function expressionRowInUse(row: ExpressionRow) {
  if (row.type === 'group')
    return true
  if (row.entry.kind === 'system')
    return row.entry.active
  return row.entry.active || row.entry.mappings.length > 0
}

function expressionRowKey(row: ExpressionRow) {
  return row.type === 'group' ? `group:${row.group}` : row.entry.id
}

const showAllExpressions = ref(false)
const expressionSearch = ref('')
const expressionSearchActive = computed(() => expressionSearch.value.trim() !== '')
const inUseExpressionRows = computed(() => expressionRows.value.filter(expressionRowInUse))
const hiddenExpressionRowCount = computed(() => expressionRows.value.length - inUseExpressionRows.value.length)
const visibleExpressionRows = computed(() => {
  if (expressionSearchActive.value) {
    const query = expressionSearch.value.trim().toLowerCase()
    const matches = (text: string) => text.toLowerCase().includes(query)
    return expressionRows.value.filter(row => row.type === 'group'
      ? matches(groupDisplayName(row.members.map(member => member.label))) || row.members.some(member => matches(member.label))
      : matches(row.entry.label))
  }
  return showAllExpressions.value ? expressionRows.value : inUseExpressionRows.value
})
</script>

<template>
  <div v-if="!props.enabled" py-2 text-xs text-neutral-500 dark:text-neutral-400>
    {{ t('settings.live2d.expressions.sdk-preset-preserved-notice') }}
  </div>
  <template v-else-if="props.snapshot.groups.length === 0">
    <div py-2 text-sm text-neutral-500 dark:text-neutral-400>
      {{ t('settings.live2d.expressions.no-expression') }}
    </div>
  </template>
  <template v-else>
    <Input
      v-model="expressionSearch"
      type="search"
      :placeholder="t('settings.live2d.expressions.search')"
      :aria-label="t('settings.live2d.expressions.search')"
      :class="['mb-2']"
    />
    <div
      v-if="visibleExpressionRows.length === 0"
      :class="['py-2', 'text-sm text-neutral-500 dark:text-neutral-400']"
    >
      {{ expressionSearchActive ? t('settings.live2d.expressions.no-match') : t('settings.live2d.expressions.none-in-use') }}
    </div>
    <div v-else role="list" :class="['flex flex-col gap-2']">
      <template v-for="row in visibleExpressionRows" :key="expressionRowKey(row)">
        <Live2dExpressionGroupRow
          v-if="row.type === 'group'"
          role="listitem"
          :group="row.group"
          :members="row.members"
          :groups="expressionGroups"
          @command="applyExpressionSettingsCommand"
        />
        <Live2dExpressionEntry
          v-else
          role="listitem"
          :entry="row.entry"
          :groups="expressionGroups"
          @command="applyExpressionSettingsCommand"
        />
      </template>
    </div>
    <div v-if="!expressionSearchActive && hiddenExpressionRowCount > 0" :class="['mt-2']">
      <Button size="sm" :aria-expanded="showAllExpressions" @click="showAllExpressions = !showAllExpressions">
        {{ showAllExpressions ? t('settings.live2d.expressions.show-fewer') : t('settings.live2d.expressions.show-all', { count: hiddenExpressionRowCount }) }}
      </Button>
    </div>

    <!-- Action buttons -->
    <div :class="['mt-4', 'flex flex-wrap gap-2']">
      <Button @click="applyExpressionSettingsCommand({ type: 'save-defaults' })">
        {{ t('settings.live2d.expressions.save-default') }}
      </Button>
      <Button @click="applyExpressionSettingsCommand({ type: 'reset-all' })">
        {{ t('settings.live2d.expressions.reset') }}
      </Button>
    </div>
  </template>
</template>
