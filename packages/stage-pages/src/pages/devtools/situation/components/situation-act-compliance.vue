<script setup lang="ts">
import type { ActComplianceOutcome, ActComplianceRecord } from '@proj-airi/stage-ui/stores/devtools/act-compliance'

import { Section } from '@proj-airi/stage-ui/components'
import {
  ACT_COMPLIANCE_HISTORY_MAX,
  ACT_COMPLIANCE_RATE_WINDOW,
  actComplianceOutcome,
  actComplianceRates,
} from '@proj-airi/stage-ui/stores/devtools/act-compliance'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatClock } from '../situation-format'

const props = defineProps<{
  records: readonly ActComplianceRecord[]
  error?: string
}>()

const { t } = useI18n()

const rates = computed(() => actComplianceRates(props.records))

const rateItems = computed(() => {
  const { turns, parsed, recovered, rejected, none } = rates.value
  const items: Array<{ outcome: ActComplianceOutcome, label: string, count: number }> = [
    { outcome: 'parsed', label: 'With ACT', count: parsed },
    { outcome: 'recovered', label: 'Recovered', count: recovered },
    { outcome: 'rejected', label: 'Rejected', count: rejected },
    { outcome: 'none', label: 'None', count: none },
  ]
  return items.map(item => ({ ...item, percent: turns === 0 ? '-' : `${Math.round(item.count / turns * 100)}%` }))
})

function outcomeLabel(record: ActComplianceRecord) {
  return record.declined ? 'declined' : actComplianceOutcome(record)
}

const cardClass = [
  'rounded-xl border p-4',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
const cellClass = ['px-2 py-1.5 text-left align-top']
</script>

<template>
  <Section title="ACT compliance" icon="i-solar:chart-2-bold-duotone" inner-class="gap-3" :expand="true">
    <div
      v-if="error"
      :class="['rounded-lg px-3 py-2 text-sm', 'bg-red-500/10 text-red-700 dark:text-red-300']"
    >
      Compliance unavailable: {{ error }}
    </div>

    <div data-testid="act-compliance-rates" :class="['grid grid-cols-2 gap-3', 'md:grid-cols-4']">
      <div v-for="item in rateItems" :key="item.outcome" :data-outcome="item.outcome" :class="cardClass">
        <div :class="labelClass">
          {{ item.label }}
        </div>
        <div :class="['mt-1 text-2xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
          {{ item.count }}
        </div>
        <div :class="noteClass">
          {{ item.percent }}
        </div>
      </div>
    </div>
    <div :class="noteClass">
      Rates cover the {{ rates.turns }} spoken turns among the last {{ ACT_COMPLIANCE_RATE_WINDOW }} recorded.
      {{ rates.declined }} declined turns are excluded. A turn with a rejected marker counts as rejected even when the
      marker was recovered from prose.
      {{ t('tamagotchi.settings.devtools.pages.situation.act-compliance.stripped-note') }}
    </div>

    <div :class="['overflow-x-auto', ...cardClass]">
      <table data-testid="act-compliance-turns" :class="['w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              Time
            </th>
            <th :class="cellClass">
              Turn
            </th>
            <th :class="cellClass">
              Origin
            </th>
            <th :class="cellClass">
              Outcome
            </th>
            <th :class="cellClass">
              ACT
            </th>
            <th :class="cellClass">
              Recovered
            </th>
            <th :class="cellClass">
              Rejected
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.situation.act-compliance.stripped') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in records"
            :key="record.turnId"
            :class="['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']"
          >
            <td :class="cellClass">
              {{ formatClock(record.atMs) }}
            </td>
            <td :class="[...cellClass, 'font-mono text-xs']">
              {{ record.turnId }}
            </td>
            <td :class="cellClass">
              {{ record.origin }}
            </td>
            <td :class="cellClass">
              {{ outcomeLabel(record) }}
            </td>
            <td :class="cellClass">
              {{ record.act }}
            </td>
            <td :class="cellClass">
              {{ record.recovered }}
            </td>
            <td :class="cellClass">
              {{ record.rejected }}
              <div v-if="record.rejectedTokens.length > 0" :class="['font-mono', ...noteClass]">
                {{ record.rejectedTokens.join(' ') }}
              </div>
            </td>
            <td :class="cellClass" data-column="stripped">
              {{ record.stripped }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="records.length === 0" :class="['py-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
        No reply has finished since this window started.
      </div>
      <div :class="['mt-2', ...noteClass]">
        {{ records.length }} of the last {{ ACT_COMPLIANCE_HISTORY_MAX }} turns kept.
      </div>
    </div>
  </Section>
</template>
