<script setup lang="ts">
import type { ExpressionArea } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionPanelCommand, ExpressionPanelCustomCommand, ExpressionPanelEntry, ExpressionPanelSnapshot } from './source'

import { Button, Collapsible, Input } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ExpressionCustomCreator from './custom-creator.vue'
import ExpressionEntry from './entry.vue'
import ExpressionGroupRow from './group-row.vue'

import { groupDisplayName } from './group-name'

type Entry = ExpressionPanelEntry
type ExpressionRow
  = | { type: 'group', group: string, members: Entry[] }
    | { type: 'entry', entry: Entry }

const props = defineProps<{
  snapshot: ExpressionPanelSnapshot
}>()
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelCommand | ExpressionPanelCustomCommand): void
}>()

const { t } = useI18n()

const areas: ExpressionArea[] = ['whole-look', 'eyes', 'mouth', 'cheeks', 'effects', 'outfit-hair', 'props', 'hidden']
const fallbackArea: ExpressionArea = 'whole-look'

const labelById = computed(() => new Map(props.snapshot.entries.map(entry => [entry.id, entry.label])))
function labelOf(id: string) {
  return labelById.value.get(id) ?? id
}

const expressionGroups = computed(() => {
  const groups = new Map<string, string[]>()
  // A group name may be an empty string; only null means ungrouped.
  for (const entry of props.snapshot.entries) {
    if (entry.group !== null)
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry.label])
  }
  return [...groups].map(([name, labels]) => ({ name, labels }))
})

// Combos have their own section and hidden duplicates fold into their primary; unsorted entries get their own list.
const sortedEntries = computed(() => props.snapshot.entries.filter(entry => entry.kind !== 'combo' && entry.kind !== 'unsorted' && entry.duplicateOf === undefined))
const unsortedEntries = computed(() => props.snapshot.entries.filter(entry => entry.kind === 'unsorted' && entry.duplicateOf === undefined))

/** One row per choose-one set at its first member's position, and one row per single entry, in catalog order. */
const expressionRows = computed<ExpressionRow[]>(() => {
  const entries = sortedEntries.value
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

function rowInUse(row: ExpressionRow) {
  if (row.type === 'group')
    return true
  if (row.entry.kind === 'system')
    return row.entry.active
  return row.entry.active || row.entry.mappings.length > 0
}

function rowKey(row: ExpressionRow) {
  return row.type === 'group' ? `group:${row.group}` : row.entry.id
}

function rowArea(row: ExpressionRow): ExpressionArea {
  return (row.type === 'group' ? row.members[0]?.area : row.entry.area) ?? fallbackArea
}

function rowMatches(row: ExpressionRow, matches: (text: string) => boolean) {
  return row.type === 'group'
    ? matches(groupDisplayName(row.members.map(member => member.label))) || row.members.some(member => matches(member.label))
    : matches(row.entry.label)
}

// The parent owns these so they survive the section unmounting when its Collapsible closes.
const search = defineModel<string>('search', { required: true })
const showAll = defineModel<boolean>('showAll', { required: true })
const searchActive = computed(() => search.value.trim() !== '')
const matcher = computed(() => {
  const query = search.value.trim().toLowerCase()
  return (text: string) => text.toLowerCase().includes(query)
})
const inUseRows = computed(() => expressionRows.value.filter(rowInUse))
const hiddenRowCount = computed(() => expressionRows.value.length - inUseRows.value.length)
const visibleRows = computed(() => {
  if (searchActive.value)
    return expressionRows.value.filter(row => rowMatches(row, matcher.value))
  return showAll.value ? expressionRows.value : inUseRows.value
})
const sections = computed(() => areas
  .map(area => ({ area, rows: visibleRows.value.filter(row => rowArea(row) === area) }))
  .filter(section => section.rows.length > 0))
// Unsorted ignores the in-use rule: every entry waits for a kind, so all of them stay visible.
const visibleUnsorted = computed(() => searchActive.value ? unsortedEntries.value.filter(entry => matcher.value(entry.label)) : unsortedEntries.value)

const creating = ref(false)
</script>

<template>
  <section :class="['flex flex-col gap-2']">
    <div :class="['flex flex-wrap items-center justify-between gap-2']">
      <h3 :class="['text-sm font-medium text-neutral-700 dark:text-neutral-300']">
        {{ t('settings.live2d.expressions.areas.title') }}
      </h3>
      <Button v-if="snapshot.freeParameters" size="sm" :aria-expanded="creating" @click="creating = !creating">
        {{ creating ? t('settings.live2d.expressions.combos.cancel') : t('settings.live2d.expressions.custom.add') }}
      </Button>
    </div>

    <div
      v-if="creating && snapshot.freeParameters"
      :class="[
        'min-w-0 p-2',
        'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
      ]"
    >
      <ExpressionCustomCreator
        :free-parameters="snapshot.freeParameters"
        @command="emit('command', $event)"
        @close="creating = false"
      />
    </div>

    <Input
      v-model="search"
      type="search"
      :placeholder="t('settings.live2d.expressions.search')"
      :aria-label="t('settings.live2d.expressions.search')"
    />

    <div
      v-if="sections.length === 0 && visibleUnsorted.length === 0"
      :class="['py-2', 'text-sm text-neutral-500 dark:text-neutral-400']"
    >
      {{ searchActive ? t('settings.live2d.expressions.no-match') : t('settings.live2d.expressions.none-in-use') }}
    </div>

    <Collapsible v-for="section in sections" :key="section.area" :default="true">
      <template #trigger="slotProps">
        <button
          type="button"
          :class="['w-full flex items-center gap-2 py-1 text-left']"
          :aria-expanded="slotProps.visible"
          @click="slotProps.setVisible(!slotProps.visible)"
        >
          <span :class="['flex-1', 'text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
            {{ t(`settings.live2d.expressions.areas.${section.area}`) }}
          </span>
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ section.rows.length }}</span>
          <div
            :class="[
              'i-solar:alt-arrow-down-linear',
              'shrink-0 text-neutral-500 dark:text-neutral-400',
              'transition-transform duration-250',
              slotProps.visible ? 'rotate-180' : '',
            ]"
          />
        </button>
      </template>
      <div role="list" :class="['flex flex-col gap-2 pb-2']">
        <template v-for="row in section.rows" :key="rowKey(row)">
          <ExpressionGroupRow
            v-if="row.type === 'group'"
            role="listitem"
            :group="row.group"
            :members="row.members"
            :groups="expressionGroups"
            :label-of="labelOf"
            @command="emit('command', $event)"
          />
          <ExpressionEntry
            v-else
            role="listitem"
            :entry="row.entry"
            :groups="expressionGroups"
            :label-of="labelOf"
            @command="emit('command', $event)"
          />
        </template>
      </div>
    </Collapsible>

    <div v-if="!searchActive && hiddenRowCount > 0">
      <Button size="sm" :aria-expanded="showAll" @click="showAll = !showAll">
        {{ showAll ? t('settings.live2d.expressions.show-fewer') : t('settings.live2d.expressions.show-all', { count: hiddenRowCount }) }}
      </Button>
    </div>

    <section v-if="visibleUnsorted.length > 0" :class="['flex flex-col gap-2 pt-1']">
      <div :class="['flex flex-col gap-0.5']">
        <div :class="['flex items-center gap-2']">
          <span :class="['flex-1', 'text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.live2d.expressions.areas.unsorted') }}
          </span>
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ visibleUnsorted.length }}</span>
        </div>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.expressions.areas.unsorted-description') }}
        </p>
      </div>
      <div role="list" :class="['flex flex-col gap-2']">
        <ExpressionEntry
          v-for="entry in visibleUnsorted"
          :key="entry.id"
          role="listitem"
          :entry="entry"
          :groups="expressionGroups"
          :label-of="labelOf"
          @command="emit('command', $event)"
        />
      </div>
    </section>
  </section>
</template>
