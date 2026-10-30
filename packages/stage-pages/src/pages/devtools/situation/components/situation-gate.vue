<script setup lang="ts">
import type { RitualKind, UrgeGateHazards, UrgeGateMultipliers } from '@proj-airi/stage-shared/situation'
import type { SituationGateEvaluation, SituationUrgeDecisionHistoryEntry, SituationUrgeDecisionRecord, SituationUrgeInspection } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { Section } from '@proj-airi/stage-ui/components'
import { SITUATION_URGE_HISTORY_MAX } from '@proj-airi/stage-ui/stores/devtools/situation-observability'
import { Button } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatAgo, formatClock, formatSpan } from '../situation-format'

const props = defineProps<{
  urge: SituationUrgeInspection
  nowMs: number
  evaluation?: { atMs: number, result: SituationGateEvaluation }
  evaluating: boolean
  evaluateError?: string
}>()

const emit = defineEmits<{
  (event: 'evaluate'): void
}>()

const { t } = useI18n()

const TIMING_REASONS: ReadonlySet<string> = new Set(['floor', 'awaiting-reply', 'quiet-unanswered', 'urge', 'safety-cap'])
const HAZARD_KEYS = ['open', 'continuation', 'ritual', 'due', 'total'] as const satisfies readonly (keyof UrgeGateHazards)[]
const MULTIPLIER_KEYS = ['base', 'pressure', 'exchange', 'clear', 'damping', 'floor', 'game'] as const satisfies readonly (keyof UrgeGateMultipliers)[]
const RITUAL_KINDS = ['greeting', 'sign-off', 'welcome-back'] as const satisfies readonly RitualKind[]

/** Which group a decision belongs to, so a hard suppressor reads differently from a timing hold. */
function reasonKind(decision: Pick<SituationUrgeDecisionRecord, 'fire' | 'reason'>): string {
  if (decision.fire)
    return decision.reason === 'forced' ? 'fired, timing skipped' : 'fired'
  if (decision.reason === 'no-topic')
    return 'no reason to pick'
  return TIMING_REASONS.has(decision.reason) ? 'timing hold' : 'hard suppressor'
}

function decisionText(decision: Pick<SituationUrgeDecisionRecord, 'fire' | 'topicKey'>): string {
  return decision.fire ? `fire: ${decision.topicKey}` : 'hold'
}

/** A moment as a wall-clock time plus its distance from now, or `-` when there is none. */
function whenText(atMs: number | null): string {
  if (atMs === null)
    return '-'
  return atMs <= props.nowMs
    ? `${formatClock(atMs)} (${formatSpan(props.nowMs - atMs)} ago)`
    : `${formatClock(atMs)} (in ${formatSpan(atMs - props.nowMs)})`
}

const trace = computed(() => props.urge.trace)

/**
 * The urge as a share of its threshold. A threshold of 0 or a non-finite value has no meaningful share, so it shows
 * `--` instead of `Infinity%` or `NaN%`.
 */
const urgeShare = computed(() => {
  const current = trace.value
  if (!current || !Number.isFinite(current.urge) || !Number.isFinite(current.urgeThreshold) || current.urgeThreshold <= 0)
    return null
  return current.urge / current.urgeThreshold
})
const urgePercentText = computed(() => urgeShare.value === null ? '--' : `${Math.round(urgeShare.value * 100)}%`)
const urgeBarWidth = computed(() => `${Math.min(100, Math.max(0, (urgeShare.value ?? 0) * 100))}%`)

const expectedWaitText = computed(() => {
  const waitMs = trace.value?.expectedWaitMs ?? null
  return waitMs === null ? '-' : `~${Math.round(waitMs / 60_000)} min`
})

const ritualsText = computed(() => {
  const rituals = trace.value?.rituals
  if (!rituals)
    return '-'
  return RITUAL_KINDS.map(kind => `${kind}: ${rituals.states[kind]}`).join(', ')
})

const pendingText = computed(() => {
  const pending = props.urge.memory?.pending
  if (!pending)
    return 'none'
  const outcome = pending.spokenAtMs === null ? 'waiting for its outcome' : `spoken ${formatAgo(pending.spokenAtMs, props.nowMs)}`
  return `${pending.topicKey} (${pending.category}, ${pending.reasonKind}; fired ${formatAgo(pending.firedAtMs, props.nowMs)}, ${outcome})`
})

const pickText = computed(() => {
  const pick = trace.value?.pick
  if (!pick)
    return '-'
  return `${pick.category}: ${pick.reasonKey ?? 'no reason'} (rolls ${pick.categoryRoll.toFixed(3)} / ${pick.reasonRoll.toFixed(3)})`
})

const decisionValue = computed(() => {
  const decision = props.urge.decision
  if (!decision)
    return '-'
  const category = decision.category ? `, ${decision.category}` : ''
  return `${decisionText(decision)} (${decision.reason}${category}; ${reasonKind(decision)})`
})

interface GateRow {
  id: string
  label: string
  value: string
}

const rows = computed<GateRow[]>(() => {
  const current = trace.value
  return [
    { id: 'decision', label: t('tamagotchi.settings.devtools.pages.situation.gate.decision'), value: decisionValue.value },
    { id: 'phase', label: t('tamagotchi.settings.devtools.pages.situation.gate.phase'), value: current?.phase ?? '-' },
    { id: 'unanswered', label: t('tamagotchi.settings.devtools.pages.situation.gate.unanswered'), value: current ? String(current.unanswered) : '-' },
    { id: 'reopen-at', label: t('tamagotchi.settings.devtools.pages.situation.gate.reopen-at'), value: whenText(current?.reopenAtMs ?? null) },
    { id: 'expected-wait', label: t('tamagotchi.settings.devtools.pages.situation.gate.expected-wait'), value: expectedWaitText.value },
    { id: 'double-text-due', label: t('tamagotchi.settings.devtools.pages.situation.gate.double-text-due'), value: whenText(current?.doubleTextDueAtMs ?? null) },
    { id: 'fires-last-hour', label: t('tamagotchi.settings.devtools.pages.situation.gate.fires-last-hour'), value: current ? String(current.firesLastHour) : '-' },
    { id: 'rituals', label: t('tamagotchi.settings.devtools.pages.situation.gate.rituals'), value: ritualsText.value },
    { id: 'pending', label: t('tamagotchi.settings.devtools.pages.situation.gate.pending'), value: pendingText.value },
    { id: 'pick', label: t('tamagotchi.settings.devtools.pages.situation.gate.pick'), value: pickText.value },
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
  // The evaluation result still carries the legacy gate decision, whose hold reasons are the old timing names. The
  // current decision row shows the urge gate's own reason once the page refreshes after the evaluation.
  return result.decision.fire
    ? `${at}: fired on ${result.decision.topicKey}. The unprompted turn was started.`
    : `${at}: held. Nothing was sent. The current decision shows why.`
})

function historyTime(entry: SituationUrgeDecisionHistoryEntry): string {
  return entry.count === 1 ? formatClock(entry.toMs) : `${formatClock(entry.fromMs)} - ${formatClock(entry.toMs)}`
}

const cardClass = [
  'rounded-xl border p-3',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
const cellClass = ['px-2 py-1.5 text-left align-top']
const rowClass = ['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.situation.gate.title')" icon="i-solar:shield-check-bold-duotone" inner-class="gap-3" :expand="true">
    <div data-testid="situation-gate-urge" :class="['flex flex-col gap-2', ...cardClass]">
      <div :class="['flex flex-wrap items-baseline justify-between gap-2']">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.situation.gate.urge') }}
        </div>
        <div :class="['font-mono text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ trace ? `${trace.urge.toFixed(3)} / ${trace.urgeThreshold.toFixed(3)}` : '-' }}
        </div>
      </div>
      <div :class="['flex items-center gap-3']">
        <div
          role="meter"
          :aria-label="t('tamagotchi.settings.devtools.pages.situation.gate.urge')"
          :aria-valuenow="urgeShare === null ? undefined : Math.round(urgeShare * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :class="['h-2 flex-1 overflow-hidden rounded-full', 'bg-neutral-200 dark:bg-neutral-800']"
        >
          <div :class="['h-full rounded-full', 'bg-primary-500']" :style="{ width: urgeBarWidth }" />
        </div>
        <div data-testid="situation-gate-urge-percent" :class="['text-2xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
          {{ urgePercentText }}
        </div>
      </div>
      <div :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.urge-note') }}
      </div>
      <div v-if="!trace" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.not-evaluated') }}
      </div>
    </div>

    <div :class="['overflow-x-auto', ...cardClass]">
      <table data-testid="situation-gate-rows" :class="['w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            :data-row="row.id"
            :class="index === 0 ? [] : rowClass"
          >
            <th :class="[...cellClass, ...labelClass, 'w-1/3 sm:w-48']">
              {{ row.label }}
            </th>
            <td :class="[...cellClass, 'break-words']">
              {{ row.value }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div :class="['grid', 'gap-2', 'md:grid-cols-2']">
      <div :class="['overflow-x-auto', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.situation.gate.hazards') }}
        </div>
        <table data-testid="situation-gate-hazards" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
          <tbody>
            <tr v-for="key in HAZARD_KEYS" :key="key" :data-hazard="key" :class="rowClass">
              <td :class="cellClass">
                {{ key }}
              </td>
              <td :class="[...cellClass, 'font-mono text-right']">
                {{ trace ? trace.hazardPerHour[key].toFixed(3) : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div :class="['overflow-x-auto', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.situation.gate.multipliers') }}
        </div>
        <table data-testid="situation-gate-multipliers" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
          <tbody>
            <tr v-for="key in MULTIPLIER_KEYS" :key="key" :data-multiplier="key" :class="rowClass">
              <td :class="cellClass">
                {{ key }}
              </td>
              <td :class="[...cellClass, 'font-mono text-right']">
                {{ trace ? trace.multipliers[key].toFixed(3) : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div data-testid="situation-gate-evaluate" :class="['flex flex-col gap-2', ...cardClass]">
      <div :class="['flex flex-wrap items-center justify-between gap-2']">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.situation.gate.evaluate') }}
        </div>
        <Button
          :label="t('tamagotchi.settings.devtools.pages.situation.gate.evaluate-action')"
          icon="i-solar:play-bold-duotone"
          size="sm"
          :loading="evaluating"
          @click="emit('evaluate')"
        />
      </div>
      <div :class="noteClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.evaluate-note') }}
      </div>
      <div
        v-if="evaluateError"
        :class="['rounded-lg px-3 py-2 text-sm', 'bg-red-500/10 text-red-700 dark:text-red-300']"
      >
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.evaluate-failed', { error: evaluateError }) }}
      </div>
      <div v-else-if="evaluationText" data-testid="situation-gate-evaluation" :class="['text-sm', 'text-neutral-700 dark:text-neutral-200']">
        {{ evaluationText }}
      </div>
    </div>

    <div :class="['overflow-x-auto', ...cardClass]">
      <div :class="labelClass">
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.history') }}
      </div>
      <table data-testid="situation-gate-history" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
        <thead :class="labelClass">
          <tr>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.situation.gate.columns.time') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.situation.gate.columns.decision') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.situation.gate.columns.category') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.situation.gate.columns.reason') }}
            </th>
            <th :class="cellClass">
              {{ t('tamagotchi.settings.devtools.pages.situation.gate.columns.count') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in urge.history"
            :key="`${entry.fromMs}-${entry.reason}-${entry.topicKey}`"
            :class="rowClass"
          >
            <td :class="[...cellClass, 'whitespace-nowrap']">
              {{ historyTime(entry) }}
            </td>
            <td :class="[...cellClass, 'min-w-40 break-words']">
              {{ decisionText(entry) }}
            </td>
            <td :class="cellClass">
              {{ entry.category ?? '-' }}
            </td>
            <td :class="cellClass">
              {{ entry.reason }}
              <span :class="noteClass">({{ reasonKind(entry) }})</span>
            </td>
            <td :class="cellClass">
              {{ entry.count }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="urge.history.length === 0" :class="['py-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.not-evaluated') }}
      </div>
      <div :class="['mt-2', ...noteClass]">
        {{ t('tamagotchi.settings.devtools.pages.situation.gate.history-note', { count: urge.history.length, max: SITUATION_URGE_HISTORY_MAX }) }}
      </div>
    </div>
  </Section>
</template>
