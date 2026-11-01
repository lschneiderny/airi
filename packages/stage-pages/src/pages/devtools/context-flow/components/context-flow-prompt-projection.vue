<script setup lang="ts">
import type { PromptReportEntry } from '@proj-airi/core-agent'
import type { PromptProjectionSnapshot } from '@proj-airi/stage-ui/stores/devtools/context-observability'

import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  currentPromptText: string
  currentSourceCount: number
  lastProjection?: PromptProjectionSnapshot
}>()

const { t } = useI18n()

const REPORT_KEY = 'tamagotchi.settings.devtools.pages.context-flow.prompt-report'

const reportTotal = computed(() => {
  const report = props.lastProjection?.promptReport ?? []
  return report.reduce(
    (total, entry) => ({ chars: total.chars + entry.chars, estimatedTokens: total.estimatedTokens + entry.estimatedTokens }),
    { chars: 0, estimatedTokens: 0 },
  )
})

/** Budget outcomes of one segment, as text; a palette alone would not say what happened. */
function segmentFlags(entry: PromptReportEntry): string[] {
  const flags: string[] = []
  if (entry.overBudget)
    flags.push(t(`${REPORT_KEY}.over-budget`))
  if (entry.truncated)
    flags.push(t(`${REPORT_KEY}.truncated`))
  if (entry.dropped > 0)
    flags.push(t(`${REPORT_KEY}.dropped`, { count: entry.dropped }))
  return flags
}

const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
const emptyClass = ['text-sm', 'text-neutral-500 dark:text-neutral-400']
const tableWrapClass = ['overflow-x-auto', 'rounded-xl border', 'border-neutral-200/70 dark:border-neutral-800/80']
const tableClass = ['w-full border-collapse text-left text-xs', 'text-neutral-700 dark:text-neutral-200']
const headClass = ['bg-neutral-100/80 dark:bg-neutral-900/80', 'text-neutral-500 dark:text-neutral-400']
const headCellClass = ['px-2 py-1.5 font-medium whitespace-nowrap']
const rowClass = ['border-t', 'border-neutral-200/70 dark:border-neutral-800/80', 'align-top']
const cellClass = ['px-2 py-1.5']
const numberCellClass = [...cellClass, 'text-right font-mono tabular-nums whitespace-nowrap']
const flagClass = ['font-medium', 'text-orange-600 dark:text-orange-400']
</script>

<template>
  <Section
    title="Next Prompt Projection"
    icon="i-solar:document-text-bold-duotone"
    inner-class="gap-3"
    :expand="true"
  >
    <div
      :class="[
        'rounded-xl',
        'border',
        currentPromptText
          ? 'border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-900/80 dark:bg-emerald-950/30'
          : 'border-neutral-200/70 bg-white/70 dark:border-neutral-800/80 dark:bg-neutral-950/40',
        'p-4',
      ]"
    >
      <div :class="['text-xs', 'font-medium', 'uppercase', 'tracking-[0.08em]', currentPromptText ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400 dark:text-neutral-500']">
        Prompt Readiness
      </div>
      <div v-if="currentPromptText" :class="['mt-2', 'text-sm', 'text-neutral-700', 'dark:text-neutral-200']">
        {{ currentSourceCount }} retained source bucket{{ currentSourceCount === 1 ? '' : 's' }} are ready for the next compose in this runtime.
        `Last Actual Compose` stays empty until a real send starts.
      </div>
      <div v-else :class="['mt-2', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
        No retained contexts are ready to inject right now.
      </div>
    </div>

    <div :class="['grid', 'gap-3', 'xl:grid-cols-2']">
      <div
        :class="[
          'rounded-xl',
          'border',
          'border-neutral-200/70',
          'bg-white/80',
          'p-4',
          'dark:border-neutral-800/80',
          'dark:bg-neutral-950/60',
        ]"
      >
        <div :class="['text-xs', 'font-medium', 'uppercase', 'tracking-[0.08em]', 'text-neutral-400', 'dark:text-neutral-500']">
          Current Derived Prompt Block
        </div>
        <div :class="['mt-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          Built directly from the current `chat-context` snapshot. This does not require a compose to have started yet.
        </div>
        <pre
          v-if="currentPromptText"
          :class="['mt-3', 'max-h-80', 'overflow-auto', 'whitespace-pre-wrap', 'break-words', 'rounded-lg', 'bg-neutral-900/90', 'p-3', 'text-xs', 'font-mono', 'text-neutral-100']"
        >{{ currentPromptText }}</pre>
        <div v-else :class="['mt-3', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
          No retained contexts to inject right now.
        </div>
      </div>

      <div
        :class="[
          'rounded-xl',
          'border',
          'border-neutral-200/70',
          'bg-white/80',
          'p-4',
          'dark:border-neutral-800/80',
          'dark:bg-neutral-950/60',
        ]"
      >
        <div :class="['flex', 'flex-wrap', 'items-center', 'justify-between', 'gap-2']">
          <div :class="['text-xs', 'font-medium', 'uppercase', 'tracking-[0.08em]', 'text-neutral-400', 'dark:text-neutral-500']">
            Last Actual Compose
          </div>
          <span v-if="lastProjection" :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ new Date(lastProjection.capturedAt).toLocaleTimeString() }} · {{ lastProjection.sessionId }}
          </span>
        </div>
        <div :class="['mt-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          Captured only after the chat orchestrator begins a real compose/send flow.
        </div>

        <template v-if="lastProjection">
          <div :class="['mt-3', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
            Message: {{ lastProjection.message }}
          </div>
          <pre
            v-if="lastProjection.promptText"
            :class="['mt-3', 'max-h-80', 'overflow-auto', 'whitespace-pre-wrap', 'break-words', 'rounded-lg', 'bg-neutral-900/90', 'p-3', 'text-xs', 'font-mono', 'text-neutral-100']"
          >{{ lastProjection.promptText }}</pre>
          <div v-else :class="['mt-3', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            The last compose had no injected context block.
          </div>

          <div data-testid="prompt-report" :class="['mt-3 flex min-w-0 flex-col gap-2']">
            <div :class="labelClass">
              {{ t(`${REPORT_KEY}.title`) }}
            </div>
            <div :class="noteClass">
              {{ t(`${REPORT_KEY}.note`) }}
            </div>
            <div v-if="!lastProjection.promptReport?.length" data-testid="prompt-report-empty" :class="emptyClass">
              {{ t(`${REPORT_KEY}.empty`) }}
            </div>
            <div v-else :class="tableWrapClass">
              <table data-testid="prompt-report-table" :class="tableClass">
                <thead :class="headClass">
                  <tr>
                    <th :class="headCellClass">
                      {{ t(`${REPORT_KEY}.columns.segment`) }}
                    </th>
                    <th :class="[...headCellClass, 'text-right']">
                      {{ t(`${REPORT_KEY}.columns.chars`) }}
                    </th>
                    <th :class="[...headCellClass, 'text-right']">
                      {{ t(`${REPORT_KEY}.columns.tokens`) }}
                    </th>
                    <th :class="headCellClass">
                      {{ t(`${REPORT_KEY}.columns.flags`) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="entry in lastProjection.promptReport"
                    :key="entry.id"
                    :data-segment="entry.id"
                    :data-over-budget="entry.overBudget ? 'true' : undefined"
                    :class="rowClass"
                  >
                    <td :class="[...cellClass, 'font-mono']">
                      {{ entry.id }}
                    </td>
                    <td :class="numberCellClass">
                      {{ entry.chars }}
                    </td>
                    <td :class="numberCellClass">
                      {{ entry.estimatedTokens }}
                    </td>
                    <td :class="cellClass">
                      <span v-if="segmentFlags(entry).length" :class="flagClass">{{ segmentFlags(entry).join(' · ') }}</span>
                      <template v-else>
                        -
                      </template>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr data-testid="prompt-report-total" :class="[...rowClass, 'font-medium', 'text-neutral-800 dark:text-neutral-100']">
                    <td :class="cellClass">
                      {{ t(`${REPORT_KEY}.total`) }}
                    </td>
                    <td :class="numberCellClass">
                      {{ reportTotal.chars }}
                    </td>
                    <td :class="numberCellClass">
                      {{ reportTotal.estimatedTokens }}
                    </td>
                    <td :class="cellClass" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <details :class="['mt-3']">
            <summary :class="['cursor-pointer', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Details
            </summary>
            <pre :class="['mt-2', 'max-h-72', 'overflow-auto', 'rounded-lg', 'bg-neutral-900/90', 'p-3', 'text-xs', 'text-neutral-100']">{{ JSON.stringify(lastProjection, null, 2) }}</pre>
          </details>
        </template>

        <div v-else-if="currentPromptText" :class="['mt-3', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
          Retained context is ready, but no real compose has started in this runtime yet.
        </div>

        <div v-else :class="['mt-3', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
          No compose snapshot recorded yet, and there is no retained context ready to inject.
        </div>
      </div>
    </div>
  </Section>
</template>
