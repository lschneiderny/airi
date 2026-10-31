<script setup lang="ts">
import type { ExpressionPanelCommand, ExpressionPanelCustomCommand, ExpressionPanelEntry } from './source'

import { Button, Select } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ExpressionEntry from './entry.vue'

import { groupDisplayName } from './group-name'

type Entry = ExpressionPanelEntry

const props = defineProps<{
  group: string
  /** Members of this group in catalog order; at most one is active at a time. */
  members: Entry[]
  /** Every group in the catalog, forwarded to each member's editor. */
  groups: { name: string, labels: string[] }[]
  /** Forwarded to each member's row for duplicate and overridden-by labels. */
  labelOf?: (id: string) => string
}>()
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelCommand | ExpressionPanelCustomCommand): void
}>()

const { t } = useI18n()

const noneValue = '__none__'

const displayName = computed(() => groupDisplayName(props.members.map(member => member.label)))
const options = computed(() => [
  { value: noneValue, label: t('settings.live2d.expressions.group-option-none') },
  ...props.members.map(member => ({ value: member.id, label: member.label })),
])
const selected = computed({
  get: () => props.members.find(member => member.active)?.id ?? noneValue,
  set: (id: string) => {
    if (id === noneValue) {
      for (const member of props.members.filter(member => member.active))
        emit('command', { type: 'set-active', id: member.id, active: false })
      return
    }
    emit('command', { type: 'set-active', id, active: true })
  },
})

const membersOpen = ref(false)
</script>

<template>
  <div
    :class="[
      'min-w-0 p-2',
      'flex flex-col gap-2',
      'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
    ]"
  >
    <div :class="['flex flex-wrap items-center gap-2']">
      <span
        :class="[
          'min-w-0 flex-1 basis-40 break-words',
          'text-sm font-medium text-neutral-700 dark:text-neutral-300',
        ]"
      >{{ displayName }}</span>
      <div :class="['flex flex-wrap items-center gap-2']">
        <!-- The Select root is renderless and drops attributes, so the picker takes its accessible name from this label. -->
        <label :class="['min-w-40']">
          <span :class="['sr-only']">{{ t('settings.live2d.expressions.group-select') }}</span>
          <Select v-model="selected" :options="options" />
        </label>
        <Button size="sm" :aria-expanded="membersOpen" @click="membersOpen = !membersOpen">
          {{ membersOpen ? t('settings.live2d.expressions.group-members-close') : t('settings.live2d.expressions.group-members') }}
        </Button>
      </div>
    </div>

    <div
      v-if="membersOpen"
      :class="[
        'flex flex-col gap-2 pt-2',
        'border-t border-neutral-200 dark:border-neutral-800',
      ]"
    >
      <ExpressionEntry
        v-for="member in members"
        :key="member.id"
        :entry="member"
        :groups="groups"
        :label-of="labelOf"
        @command="emit('command', $event)"
      />
    </div>
  </div>
</template>
