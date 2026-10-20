<script setup lang="ts">
import type { SituationEvent } from '@proj-airi/stage-shared/situation'

import { effectiveSalience } from '@proj-airi/stage-shared/situation'
import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'

import { formatAgo, formatSpan } from '../situation-format'

const props = defineProps<{
  events: readonly SituationEvent[]
  nowMs: number
}>()

const columns = ['kind', 'topic key', 'text', 'age', 'salience', 'effective salience', 'tier', 'origin', 'shown', 'addressed'] as const

// The state keeps events oldest first; the newest are the interesting ones.
const rows = computed(() => [...props.events].reverse().map(event => ({
  event,
  age: formatSpan(props.nowMs - event.atMs),
  effective: effectiveSalience(event, props.nowMs).toFixed(2),
  shown: event.shownAtMs === null ? 'no' : formatAgo(event.shownAtMs, props.nowMs),
  addressed: event.addressedAtMs === null ? 'no' : formatAgo(event.addressedAtMs, props.nowMs),
})))
</script>

<template>
  <Section :title="`Events (${events.length})`" icon="i-solar:list-check-bold-duotone" inner-class="gap-3" :expand="true">
    <div v-if="rows.length === 0" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      No events yet. Sensors add them as the user's situation changes.
    </div>
    <div v-else :class="['overflow-x-auto', 'rounded-xl border', 'border-neutral-200/70 dark:border-neutral-800/80']">
      <table data-testid="situation-events" :class="['w-full border-collapse text-left text-xs', 'text-neutral-700 dark:text-neutral-200']">
        <thead :class="['bg-neutral-100/80 dark:bg-neutral-900/80', 'text-neutral-500 dark:text-neutral-400']">
          <tr>
            <th v-for="column in columns" :key="column" :class="['px-2 py-1.5 font-medium whitespace-nowrap']">
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.event.id"
            :data-event-id="row.event.id"
            :class="['border-t', 'border-neutral-200/70 dark:border-neutral-800/80', 'align-top']"
          >
            <td :class="['px-2 py-1.5 whitespace-nowrap']">
              {{ row.event.kind }}
            </td>
            <td :class="['px-2 py-1.5 font-mono break-all']">
              {{ row.event.topicKey }}
            </td>
            <td :class="['px-2 py-1.5 min-w-48 break-words']">
              {{ row.event.text }}
            </td>
            <td :class="['px-2 py-1.5 whitespace-nowrap']">
              {{ row.age }}
            </td>
            <td :class="['px-2 py-1.5 font-mono']">
              {{ row.event.salience.toFixed(2) }}
            </td>
            <td :class="['px-2 py-1.5 font-mono']">
              {{ row.effective }}
            </td>
            <td :class="['px-2 py-1.5']">
              {{ row.event.tier }}
            </td>
            <td :class="['px-2 py-1.5']">
              {{ row.event.origin }}
            </td>
            <td data-column="shown" :class="['px-2 py-1.5 whitespace-nowrap']">
              {{ row.shown }}
            </td>
            <td data-column="addressed" :class="['px-2 py-1.5 whitespace-nowrap']">
              {{ row.addressed }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Section>
</template>
