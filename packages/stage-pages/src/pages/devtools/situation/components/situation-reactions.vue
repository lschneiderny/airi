<script setup lang="ts">
import type { ReactionKind, SituationEvent, SituationTracking } from '@proj-airi/stage-shared/situation'
import type { SituationReactionInspection, SituationReactionOutcomeStatus } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatAgo, formatSpan } from '../situation-format'

const props = defineProps<{
  reactions: SituationReactionInspection
  events: readonly SituationEvent[]
  tracking: SituationTracking
  nowMs: number
}>()

const { t } = useI18n()

const KEY = 'tamagotchi.settings.devtools.pages.situation.reactions'
const REACTION_KINDS = ['pet-soft', 'poke-protest'] as const satisfies readonly ReactionKind[]
const OUTCOME_STATUSES = ['spoken', 'declined', 'cancelled', 'failed', 'refused'] as const satisfies readonly SituationReactionOutcomeStatus[]

interface Row {
  id: string
  label: string
  value: string
}

// The state keeps events oldest first, so the last touch event is the newest one.
const lastTouch = computed(() => props.events.findLast(event => event.kind === 'touch'))

const touchRows = computed<Row[]>(() => {
  const event = lastTouch.value
  if (!event)
    return []
  return [
    { id: 'text', label: t(`${KEY}.text`), value: event.text },
    { id: 'salience', label: t(`${KEY}.salience`), value: event.salience.toFixed(2) },
    { id: 'shown', label: t(`${KEY}.shown`), value: event.shownAtMs === null ? t(`${KEY}.not-shown`) : formatAgo(event.shownAtMs, props.nowMs) },
    { id: 'age', label: t(`${KEY}.age`), value: formatAgo(event.atMs, props.nowMs) },
  ]
})

const decisionText = computed(() => {
  const decision = props.reactions.decision
  if (!decision)
    return '-'
  const ago = formatAgo(decision.atMs, props.nowMs)
  if (decision.speak) {
    return t(`${KEY}.decision-speak`, {
      kind: decision.kind ?? '-',
      roll: decision.roll?.toFixed(3) ?? '-',
      probability: decision.probability?.toFixed(3) ?? '-',
      ago,
    })
  }
  return t(`${KEY}.decision-hold`, {
    reason: decision.reason ?? '-',
    kind: decision.kind ?? '-',
    roll: decision.roll?.toFixed(3) ?? '-',
    ago,
  })
})

/** A hold that has run out reads as `none`, so a zero never looks like an active wait. */
function remainingText(ms: number): string {
  return ms > 0 ? formatSpan(ms) : t(`${KEY}.none`)
}

const pokeTimesText = computed(() => {
  const times = props.tracking.pokeTimes
  if (times.length === 0)
    return t(`${KEY}.none`)
  // Newest first, matching the other inspector lists.
  return `${times.length}: ${[...times].reverse().map(atMs => formatAgo(atMs, props.nowMs)).join(', ')}`
})

const pendingText = computed(() => {
  const pending = props.reactions.pending
  if (!pending)
    return t(`${KEY}.none`)
  return t(`${KEY}.pending-value`, { kind: pending.kind, eventId: pending.eventId, ago: formatAgo(pending.atMs, props.nowMs) })
})

const policyRows = computed<Row[]>(() => {
  const memory = props.reactions.memory
  return [
    { id: 'decision', label: t(`${KEY}.decision`), value: decisionText.value },
    { id: 'pets-seen', label: t(`${KEY}.pets-seen`), value: memory ? String(memory.petsSeen) : '-' },
    { id: 'poke-times', label: t(`${KEY}.poke-times`), value: pokeTimesText.value },
    { id: 'last-line', label: t(`${KEY}.last-line`), value: memory ? (memory.lastLineAtMs === null ? t(`${KEY}.never`) : formatAgo(memory.lastLineAtMs, props.nowMs)) : '-' },
    { id: 'pending', label: t(`${KEY}.pending`), value: pendingText.value },
    { id: 'refractory', label: t(`${KEY}.refractory`), value: remainingText(props.reactions.refractoryRemainingMs) },
    { id: 'retry', label: t(`${KEY}.retry`), value: remainingText(props.reactions.retryRemainingMs) },
  ]
})

const cardClass = [
  'rounded-xl border p-3',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
const emptyClass = ['mt-2 text-sm', 'text-neutral-500 dark:text-neutral-400']
const cellClass = ['px-2 py-1.5 text-left align-top']
const rowClass = ['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']
</script>

<template>
  <Section :title="t(`${KEY}.title`)" icon="i-solar:hand-heart-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid', 'gap-2', 'md:grid-cols-2']">
      <div data-testid="situation-reactions-touch" :class="['overflow-x-auto', ...cardClass]">
        <div :class="labelClass">
          {{ t(`${KEY}.last-touch`) }}
        </div>
        <table v-if="touchRows.length > 0" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
          <tbody>
            <tr v-for="(row, index) in touchRows" :key="row.id" :data-row="row.id" :class="index === 0 ? [] : rowClass">
              <th :class="[...cellClass, ...labelClass, 'w-1/3']">
                {{ row.label }}
              </th>
              <td :class="[...cellClass, 'break-words']">
                {{ row.value }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else :class="emptyClass">
          {{ t(`${KEY}.last-touch-empty`) }}
        </div>
      </div>

      <div :class="['overflow-x-auto', ...cardClass]">
        <div :class="labelClass">
          {{ t(`${KEY}.policy`) }}
        </div>
        <table data-testid="situation-reactions-policy" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
          <tbody>
            <tr v-for="(row, index) in policyRows" :key="row.id" :data-row="row.id" :class="index === 0 ? [] : rowClass">
              <th :class="[...cellClass, ...labelClass, 'w-1/3']">
                {{ row.label }}
              </th>
              <td :class="[...cellClass, 'break-words']">
                {{ row.value }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!reactions.memory" :class="emptyClass">
          {{ t(`${KEY}.not-started`) }}
        </div>
      </div>
    </div>

    <div :class="['overflow-x-auto', ...cardClass]">
      <div :class="labelClass">
        {{ t(`${KEY}.outcomes`) }}
      </div>
      <table data-testid="situation-reactions-outcomes" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              {{ t(`${KEY}.columns.kind`) }}
            </th>
            <th v-for="status in OUTCOME_STATUSES" :key="status" :class="[...cellClass, 'text-right']">
              {{ t(`${KEY}.columns.${status}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="kind in REACTION_KINDS" :key="kind" :data-kind="kind" :class="rowClass">
            <td :class="cellClass">
              {{ kind }}
            </td>
            <td v-for="status in OUTCOME_STATUSES" :key="status" :data-status="status" :class="[...cellClass, 'font-mono text-right']">
              {{ reactions.outcomes[kind][status] }}
            </td>
          </tr>
        </tbody>
      </table>
      <div :class="['mt-2', ...noteClass]">
        {{ t(`${KEY}.outcomes-note`) }}
      </div>
    </div>
  </Section>
</template>
