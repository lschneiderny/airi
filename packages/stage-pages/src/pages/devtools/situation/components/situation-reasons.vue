<script setup lang="ts">
import type { Reason, ReasonKind, Thread } from '@proj-airi/stage-shared/situation'
import type { SituationExtraction, SituationReasonOutcomes } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { threadMinAgeMs } from '@proj-airi/stage-shared/situation'
import { Section } from '@proj-airi/stage-ui/components'
import { SITUATION_EXTRACTION_LEDGER_MAX } from '@proj-airi/stage-ui/stores/devtools/situation-observability'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatAgo, formatClock, formatSpan } from '../situation-format'

const props = defineProps<{
  reasons: readonly Reason[]
  threads: readonly Thread[]
  extraction: SituationExtraction
  outcomes: SituationReasonOutcomes
  nowMs: number
}>()

const { t } = useI18n()

const COLUMN_KEY = 'tamagotchi.settings.devtools.pages.situation.reasons.columns'

/** A moment as a wall-clock time plus its distance from now. */
function whenText(atMs: number): string {
  return atMs <= props.nowMs
    ? `${formatClock(atMs)} (${formatSpan(props.nowMs - atMs)} ago)`
    : `${formatClock(atMs)} (in ${formatSpan(atMs - props.nowMs)})`
}

const threadRows = computed(() => props.threads.map(thread => ({
  thread,
  born: formatAgo(thread.bornAtMs, props.nowMs),
  // Ripening starts at this moment; the thread becomes a reason once its ripeness clears the minimum.
  ripeAt: whenText(thread.bornAtMs + threadMinAgeMs(thread)),
  expires: whenText(thread.expiresAtMs),
  raised: thread.lastRaisedAtMs === null ? String(thread.raisedCount) : `${thread.raisedCount} (${formatAgo(thread.lastRaisedAtMs, props.nowMs)})`,
})))

const outcomeRows = computed(() => (Object.entries(props.outcomes) as [ReasonKind, SituationReasonOutcomes[ReasonKind]][])
  .map(([kind, outcome]) => ({ kind, ...outcome })))

const tableWrapClass = ['overflow-x-auto', 'rounded-xl border', 'border-neutral-200/70 dark:border-neutral-800/80']
const tableClass = ['w-full border-collapse text-left text-xs', 'text-neutral-700 dark:text-neutral-200']
const headClass = ['bg-neutral-100/80 dark:bg-neutral-900/80', 'text-neutral-500 dark:text-neutral-400']
const headCellClass = ['px-2 py-1.5 font-medium whitespace-nowrap']
const rowClass = ['border-t', 'border-neutral-200/70 dark:border-neutral-800/80', 'align-top']
const cellClass = ['px-2 py-1.5']
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const emptyClass = ['text-sm', 'text-neutral-500 dark:text-neutral-400']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.situation.reasons.title')" icon="i-solar:lightbulb-bolt-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['flex min-w-0 flex-col gap-2']">
      <div :class="labelClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.current') }}
      </div>
      <div v-if="reasons.length === 0" data-testid="situation-reasons-empty" :class="emptyClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.current-empty') }}
      </div>
      <div v-else :class="tableWrapClass">
        <table data-testid="situation-reasons" :class="tableClass">
          <thead :class="headClass">
            <tr>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.kind`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.category`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.text`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.ripeness`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.weight`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.urgent`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reason in reasons" :key="reason.key" :data-reason-key="reason.key" :class="rowClass">
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ reason.kind }}
              </td>
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ reason.category }}
              </td>
              <td :class="[...cellClass, 'min-w-48 break-words']">
                {{ reason.text }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ reason.ripeness.toFixed(2) }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ reason.weight.toFixed(3) }}
              </td>
              <td :class="cellClass">
                {{ reason.urgent ? 'yes' : 'no' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div :class="['flex min-w-0 flex-col gap-2']">
      <div :class="labelClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.threads') }}
      </div>
      <div v-if="threadRows.length === 0" data-testid="situation-threads-empty" :class="emptyClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.threads-empty') }}
      </div>
      <div v-else :class="tableWrapClass">
        <table data-testid="situation-threads" :class="tableClass">
          <thead :class="headClass">
            <tr>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.kind`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.summary`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.born`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.ripe-at`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.expires`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.raised`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in threadRows" :key="row.thread.id" :data-thread-id="row.thread.id" :class="rowClass">
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ row.thread.kind }}
              </td>
              <td :class="[...cellClass, 'min-w-48 break-words']">
                {{ row.thread.summary }}
              </td>
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ row.born }}
              </td>
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ row.ripeAt }}
              </td>
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ row.expires }}
              </td>
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ row.raised }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div :class="['flex min-w-0 flex-col gap-2']">
      <div :class="labelClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.extraction') }}
      </div>
      <div v-if="extraction.inFlight" data-testid="situation-extraction-in-flight" :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.extraction-in-flight') }}
      </div>
      <div v-if="extraction.ledger.length === 0" :class="emptyClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.extraction-empty') }}
      </div>
      <div v-else :class="tableWrapClass">
        <table data-testid="situation-extraction" :class="tableClass">
          <thead :class="headClass">
            <tr>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.time`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.status`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.request-chars`) }}
              </th>
              <th :class="headCellClass">
                {{ t('tamagotchi.settings.devtools.pages.situation.reasons.threads') }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.error`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in extraction.ledger" :key="`${entry.atMs}-${index}`" :class="rowClass">
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ formatClock(entry.atMs) }}
              </td>
              <td :class="cellClass">
                {{ entry.status }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ entry.requestChars }}
              </td>
              <td :class="[...cellClass, 'min-w-48 break-words']">
                <div v-for="(thread, threadIndex) in entry.threads" :key="threadIndex">
                  {{ thread.kind }}: {{ thread.summary }}
                </div>
                <template v-if="entry.threads.length === 0">
                  -
                </template>
              </td>
              <td :class="[...cellClass, 'break-words']">
                {{ entry.error ?? '-' }}
                <div v-if="entry.answer" data-testid="situation-extraction-answer" :class="['font-mono', 'op-70']">
                  {{ t('tamagotchi.settings.devtools.pages.situation.reasons.extraction-answer', { chars: entry.answer.chars, finishReason: entry.answer.finishReason ?? '-', excerpt: entry.answer.excerpt ?? '-' }) }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.extraction-note', { count: extraction.ledger.length, max: SITUATION_EXTRACTION_LEDGER_MAX }) }}
      </div>
    </div>

    <div :class="['flex min-w-0 flex-col gap-2']">
      <div :class="labelClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.outcomes') }}
      </div>
      <div :class="tableWrapClass">
        <table data-testid="situation-outcomes" :class="tableClass">
          <thead :class="headClass">
            <tr>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.kind`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.spoken`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.declined`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.engaged`) }}
              </th>
              <th :class="headCellClass">
                {{ t(`${COLUMN_KEY}.ignored`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in outcomeRows" :key="row.kind" :data-outcome-kind="row.kind" :class="rowClass">
              <td :class="[...cellClass, 'whitespace-nowrap']">
                {{ row.kind }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ row.spoken }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ row.declined }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ row.engaged }}
              </td>
              <td :class="[...cellClass, 'font-mono']">
                {{ row.ignored }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.reasons.outcomes-note') }}
      </div>
    </div>
  </Section>
</template>
