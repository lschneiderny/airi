<script setup lang="ts">
import type { SituationState } from '@proj-airi/stage-shared/situation'

import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'

import { formatAgo } from '../situation-format'

const props = defineProps<{
  state: SituationState
  nowMs: number
}>()

interface SummaryCard {
  id: string
  title: string
  value: string
  details: string[]
}

const cards = computed<SummaryCard[]>(() => {
  const { presence, activity, recentActivities, busy, conversation, contexts, stage } = props.state
  const now = props.nowMs
  const contextKeys = Object.keys(contexts)

  return [
    {
      id: 'presence',
      title: 'Presence',
      value: presence.state,
      details: [
        `Reason: ${presence.reason ?? '-'}`,
        `Since: ${formatAgo(presence.sinceMs, now)}`,
      ],
    },
    {
      id: 'activity',
      title: 'Activity',
      value: activity ? `${activity.label} (${activity.category})` : 'none',
      details: activity
        ? [
            `Title: ${activity.title ?? '-'}`,
            `Since: ${formatAgo(activity.sinceMs, now)}`,
            `Before: ${recentActivities.map(recent => recent.label).join(', ') || '-'}`,
          ]
        : [`Before: ${recentActivities.map(recent => recent.label).join(', ') || '-'}`],
    },
    {
      id: 'busy',
      title: 'Busy',
      value: busy.state,
      details: [`Reported: ${formatAgo(busy.atMs, now)}`],
    },
    {
      id: 'conversation',
      title: 'Conversation',
      value: `user ${formatAgo(conversation.lastUserAtMs, now)}`,
      details: [
        `Character: ${formatAgo(conversation.lastCharacterAtMs, now)}`,
        `Spoke up: ${formatAgo(conversation.lastUnpromptedAtMs, now)}`,
      ],
    },
    {
      id: 'contexts',
      title: 'Contexts',
      value: `${contextKeys.length} source${contextKeys.length === 1 ? '' : 's'}`,
      details: contextKeys.length > 0 ? contextKeys : ['-'],
    },
    {
      id: 'stage',
      title: 'Stage',
      value: stage ? (stage.mood || '-') : 'none',
      details: stage
        ? [`On stage: ${stage.exposed || '-'}`, `Active: ${stage.active || '-'}`]
        : [],
    },
  ]
})
</script>

<template>
  <Section title="Presence, activity and busy" icon="i-solar:user-check-rounded-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid', 'gap-2', 'sm:grid-cols-2', 'xl:grid-cols-3']">
      <div
        v-for="card in cards"
        :key="card.id"
        :data-testid="`situation-summary-${card.id}`"
        :class="[
          'rounded-xl border p-3',
          'border-neutral-200/70 bg-white/80',
          'dark:border-neutral-800/80 dark:bg-neutral-950/60',
        ]"
      >
        <div :class="['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']">
          {{ card.title }}
        </div>
        <div :class="['mt-1 text-sm font-medium break-words', 'text-neutral-800 dark:text-neutral-100']">
          {{ card.value }}
        </div>
        <div
          v-for="(detail, index) in card.details"
          :key="index"
          :class="['mt-0.5 text-xs break-words', 'text-neutral-500 dark:text-neutral-400']"
        >
          {{ detail }}
        </div>
      </div>
    </div>
  </Section>
</template>
