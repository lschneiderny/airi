<script setup lang="ts">
import type { GateDecision, GateMemory } from '@proj-airi/stage-shared/situation'
import type { SituationGateEvaluation, SituationGateHistoryEntry, SituationGateRecord } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { BACKOFF_LEVEL_MAX, HOURLY_WINDOW_MS } from '@proj-airi/stage-shared/situation'
import { Section } from '@proj-airi/stage-ui/components'
import { SITUATION_GATE_HISTORY_MAX } from '@proj-airi/stage-ui/stores/devtools/situation-observability'
import { Button } from '@proj-airi/ui'
import { computed } from 'vue'

import { formatAgo, formatClock, formatSpan } from '../situation-format'

const props = defineProps<{
  gate: SituationGateRecord | null
  memory: GateMemory
  history: readonly SituationGateHistoryEntry[]
  nowMs: number
  evaluation?: { atMs: number, result: SituationGateEvaluation }
  evaluating: boolean
  evaluateError?: string
}>()

const emit = defineEmits<{
  (event: 'evaluate'): void
}>()

const TIMING_REASONS: ReadonlySet<string> = new Set(['in-exchange', 'gap', 'hourly-cap'])

/** Which group of guards a reason belongs to, so a hard suppressor reads differently from a timing hold. */
function reasonKind(decision: Pick<GateDecision, 'fire' | 'reason'>): string {
  if (decision.fire)
    return decision.reason === 'forced' ? 'fired, timing skipped' : 'fired'
  if (decision.reason === 'no-topic')
    return 'no topic above the threshold'
  return TIMING_REASONS.has(decision.reason) ? 'timing guard' : 'hard suppressor'
}

function decisionText(decision: GateDecision): string {
  return decision.fire ? `Fire: ${decision.topicKey}` : `Hold: ${decision.reason}`
}

/** When the timing guards next let a topic through. A fire starts a new gap from its own time. */
const nextEligibleText = computed(() => {
  const decision = props.gate?.decision
  if (!decision)
    return '-'
  const atMs = decision.fire ? decision.trace.nowMs + decision.trace.gapMs : decision.trace.nextEligibleAtMs
  if (atMs === null)
    return '-'
  return atMs <= props.nowMs ? 'now' : `${formatClock(atMs)} (in ${formatSpan(atMs - props.nowMs)})`
})

const firesLastHour = computed(() => props.memory.fires.filter(atMs => props.nowMs - atMs < HOURLY_WINDOW_MS).length)

const pendingText = computed(() => {
  const pending = props.memory.pending
  if (!pending)
    return 'none'
  const outcome = pending.spokenAtMs === null ? 'waiting for its outcome' : `spoken ${formatAgo(pending.spokenAtMs, props.nowMs)}`
  return `${pending.topicKey} (fired ${formatAgo(pending.firedAtMs, props.nowMs)}, ${outcome})`
})

interface GateCard {
  id: string
  title: string
  value: string
  details: string[]
}

const cards = computed<GateCard[]>(() => {
  const decision = props.gate?.decision
  const trace = decision?.trace
  return [
    {
      id: 'decision',
      title: 'Current decision',
      value: decision ? decisionText(decision) : 'not evaluated yet',
      details: decision && trace
        ? [
            `Reason: ${decision.reason} (${reasonKind(decision)})`,
            `Evaluated: ${formatAgo(trace.nowMs, props.nowMs)}${trace.forceTiming ? ', timing skipped' : ''}`,
            `Candidate: ${trace.candidate ? `${trace.candidate.topicKey} (${trace.candidate.salience.toFixed(2)} / ${trace.threshold.toFixed(2)})` : '-'}`,
          ]
        : [],
    },
    {
      id: 'next-eligible',
      title: 'Next eligible',
      value: nextEligibleText.value,
      details: trace ? [`Gap: ${formatSpan(trace.gapMs)}`, 'Hard suppressors and topics aside'] : [],
    },
    {
      id: 'backoff',
      title: 'Backoff level',
      value: `${props.memory.backoffLevel} / ${BACKOFF_LEVEL_MAX}`,
      details: [`Ignore streak: ${props.memory.ignoreStreak}`],
    },
    {
      id: 'fires',
      title: 'Fires in the last hour',
      value: trace ? `${firesLastHour.value} / ${trace.hourlyCap}` : String(firesLastHour.value),
      details: [`Last fire: ${formatAgo(props.memory.lastFireAtMs, props.nowMs)}`],
    },
    {
      id: 'pending',
      title: 'Pending topic',
      value: props.memory.pending?.topicKey ?? 'none',
      details: [pendingText.value],
    },
  ]
})

const evaluationText = computed(() => {
  const evaluation = props.evaluation
  if (!evaluation)
    return undefined
  const { result, atMs } = evaluation
  const at = formatClock(atMs)
  if (result.status === 'skipped') {
    return result.reason === 'unprompted-pending'
      ? `${at}: not evaluated, an unprompted turn is still pending.`
      : `${at}: not evaluated, the leader window runs no gate.`
  }
  const { decision } = result
  return decision.fire
    ? `${at}: fired on ${decision.topicKey} (${decision.reason}). The unprompted turn was started.`
    : `${at}: held with ${decision.reason} (${reasonKind(decision)}). Nothing was sent.`
})

function historyTime(entry: SituationGateHistoryEntry): string {
  return entry.count === 1 ? formatClock(entry.lastAtMs) : `${formatClock(entry.firstAtMs)} - ${formatClock(entry.lastAtMs)}`
}

const cardClass = [
  'rounded-xl border p-3',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
const cellClass = ['px-2 py-1.5 text-left align-top']
</script>

<template>
  <Section title="Opportunity gate" icon="i-solar:shield-check-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid', 'gap-2', 'sm:grid-cols-2', 'xl:grid-cols-5']">
      <div
        v-for="card in cards"
        :key="card.id"
        :data-testid="`situation-gate-${card.id}`"
        :class="cardClass"
      >
        <div :class="labelClass">
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

    <div data-testid="situation-gate-evaluate" :class="['flex flex-col gap-2', ...cardClass]">
      <div :class="['flex flex-wrap items-center justify-between gap-2']">
        <div :class="labelClass">
          Evaluate now
        </div>
        <Button
          label="Evaluate now (ignore timing)"
          icon="i-solar:play-bold-duotone"
          size="sm"
          :loading="evaluating"
          @click="emit('evaluate')"
        />
      </div>
      <div :class="noteClass">
        Asks the leader's gate for one decision that skips the gap, hourly cap, and conversation guards. Hard
        suppressors, such as don't-disturb, still apply. A fire starts a real unprompted turn.
      </div>
      <div
        v-if="evaluateError"
        :class="['rounded-lg px-3 py-2 text-sm', 'bg-red-500/10 text-red-700 dark:text-red-300']"
      >
        Evaluation failed: {{ evaluateError }}
      </div>
      <div v-else-if="evaluationText" data-testid="situation-gate-evaluation" :class="['text-sm', 'text-neutral-700 dark:text-neutral-200']">
        {{ evaluationText }}
      </div>
    </div>

    <div :class="['overflow-x-auto', ...cardClass]">
      <table data-testid="situation-gate-history" :class="['w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              Time
            </th>
            <th :class="cellClass">
              Decision
            </th>
            <th :class="cellClass">
              Reason
            </th>
            <th :class="cellClass">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in history"
            :key="entry.id"
            :class="['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']"
          >
            <td :class="[...cellClass, 'whitespace-nowrap']">
              {{ historyTime(entry) }}
            </td>
            <td :class="cellClass">
              {{ entry.fire ? `fire: ${entry.topicKey}` : 'hold' }}
            </td>
            <td :class="cellClass">
              {{ entry.reason }}
              <span :class="noteClass">({{ reasonKind(entry) }}{{ entry.forced ? ', evaluate now' : '' }})</span>
            </td>
            <td :class="cellClass">
              {{ entry.count }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="history.length === 0" :class="['py-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
        The gate has not evaluated in the leader window yet. It runs only in a host that supports unprompted turns.
      </div>
      <div :class="['mt-2', ...noteClass]">
        {{ history.length }} of the last {{ SITUATION_GATE_HISTORY_MAX }} entries kept. Consecutive decisions with the
        same reason share one entry.
      </div>
    </div>
  </Section>
</template>
