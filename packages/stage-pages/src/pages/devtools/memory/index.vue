<script setup lang="ts">
import type { MemoryInspection } from '@proj-airi/stage-ui/stores/devtools/memory-observability'

import { errorMessageFrom } from '@moeru/std'
import { Section } from '@proj-airi/stage-ui/components'
import { useMemoryObservabilityStore } from '@proj-airi/stage-ui/stores/devtools/memory-observability'
import { useIntervalFn } from '@vueuse/core'
import { onMounted, ref, shallowRef } from 'vue'

import { formatClock } from '../situation/situation-format'

/** Matches the situation inspector, so a tool call shows within a second of its run. */
const REFRESH_INTERVAL_MS = 1_000

// The page reads the leader window over the devtools inspector bus and never changes memory.
const observability = useMemoryObservabilityStore()

const inspection = shallowRef<MemoryInspection>()
const inspectedAtMs = ref<number>()
const inspectError = ref<string>()
let refreshing = false

async function refresh() {
  if (refreshing)
    return
  refreshing = true
  try {
    inspection.value = await observability.inspectLeader()
    inspectedAtMs.value = Date.now()
    inspectError.value = undefined
  }
  catch (error) {
    // The only signal `inspectLeader` carries is its own timeout, so an abort means that no window answered. Eventa
    // rethrows it as a DOMException `AbortError` whose message quotes the timeout.
    const timedOut = error instanceof DOMException && error.name === 'AbortError'
    inspectError.value = timedOut ? 'The leader window did not answer.' : (errorMessageFrom(error) ?? 'The leader window did not answer.')
  }
  finally {
    refreshing = false
  }
}

useIntervalFn(refresh, REFRESH_INTERVAL_MS)
onMounted(refresh)

const cardClass = [
  'rounded-xl border p-3',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
const cellClass = ['px-2 py-1.5 text-left align-top']
const outcomeClass: Record<MemoryInspection['history'][number]['outcome'], string> = {
  ok: 'bg-primary-500/15 text-primary-700 dark:text-primary-300',
  missing: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  refused: 'bg-red-500/15 text-red-700 dark:text-red-300',
}
</script>

<template>
  <div :class="['flex flex-col gap-2']">
    <Section title="Source" icon="i-solar:routing-2-bold-duotone" inner-class="gap-3" :expand="true">
      <div :class="['flex', 'flex-wrap', 'items-center', 'gap-2', 'text-xs']">
        <span
          v-if="inspection"
          data-testid="memory-enabled"
          :class="[
            'rounded-full', 'px-2', 'py-0.5', 'font-medium',
            inspection.enabled
              ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300'
              : 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
          ]"
        >
          Long-term memory: {{ inspection.enabled ? 'on' : 'off' }}
        </span>
        <span v-if="inspectedAtMs !== undefined" :class="['text-neutral-500', 'dark:text-neutral-400']">
          Refreshed {{ formatClock(inspectedAtMs) }}
        </span>
      </div>
      <div :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
        {{ inspection ? 'Everything below comes from the leader window, the one that runs chat.' : 'Waiting for the leader window to answer.' }}
      </div>
      <div
        v-if="inspectError"
        data-testid="memory-source-error"
        :class="['rounded-lg', 'bg-red-500/10', 'px-3', 'py-2', 'text-sm', 'text-red-700', 'dark:text-red-300']"
      >
        Could not read the leader window: {{ inspectError }}
      </div>
    </Section>

    <template v-if="inspection">
      <Section title="Index" icon="i-solar:notebook-bookmark-bold-duotone" inner-class="gap-3" :expand="true">
        <div :class="['grid', 'gap-2', 'md:grid-cols-2']">
          <div
            v-for="card in inspection.indexes"
            :key="card.cardId"
            :data-testid="`memory-index-${card.cardId}`"
            :class="cardClass"
          >
            <div :class="labelClass">
              {{ card.name }}
            </div>
            <div :class="['mt-0.5 font-mono break-all', ...noteClass]">
              {{ card.cardId }}
            </div>
            <pre v-if="card.index" :class="['mt-2 whitespace-pre-wrap break-words text-xs', 'text-neutral-700 dark:text-neutral-200']">{{ card.index }}</pre>
            <div v-else :class="['mt-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
              The memory index is empty.
            </div>
          </div>
          <div data-testid="memory-index-general" :class="cardClass">
            <div :class="labelClass">
              General
            </div>
            <div :class="['mt-0.5', ...noteClass]">
              Shared by every character.
            </div>
            <pre v-if="inspection.general" :class="['mt-2 whitespace-pre-wrap break-words text-xs', 'text-neutral-700 dark:text-neutral-200']">{{ inspection.general }}</pre>
            <div v-else :class="['mt-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
              No general memories.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Tool calls" icon="i-solar:history-bold-duotone" inner-class="gap-3" :expand="true">
        <div :class="['overflow-x-auto', ...cardClass]">
          <table data-testid="memory-tool-calls" :class="['w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
            <thead :class="labelClass">
              <tr>
                <th :class="cellClass">
                  Time
                </th>
                <th :class="cellClass">
                  Session
                </th>
                <th :class="cellClass">
                  Origin
                </th>
                <th :class="cellClass">
                  Tool
                </th>
                <th :class="cellClass">
                  Ids
                </th>
                <th :class="cellClass">
                  Outcome
                </th>
                <th :class="cellClass">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="call in inspection.history"
                :key="call.id"
                :class="['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']"
              >
                <td :class="[...cellClass, 'whitespace-nowrap text-xs']">
                  {{ formatClock(call.timestamp) }}
                </td>
                <td :class="[...cellClass, 'font-mono text-xs break-all']">
                  {{ call.sessionId }}
                </td>
                <td :class="cellClass">
                  {{ call.origin }}
                </td>
                <td :class="cellClass">
                  {{ call.tool }}
                </td>
                <td :class="[...cellClass, 'font-mono text-xs break-all']">
                  {{ call.ids.join(', ') || '-' }}
                </td>
                <td :class="cellClass">
                  <span :class="['rounded-full', 'px-2', 'py-0.5', 'text-xs', 'font-medium', outcomeClass[call.outcome]]">
                    {{ call.outcome }}
                  </span>
                </td>
                <td :class="[...cellClass, 'whitespace-pre-wrap break-words text-xs']">
                  {{ call.result }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="inspection.history.length === 0" :class="['py-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
            No memory tool has been called since the leader window started.
          </div>
        </div>
        <div :class="noteClass">
          One row per call, newest first. A call the tool rejected is listed as refused, with the ids the model asked for.
        </div>
      </Section>
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.devtools.pages.memory.title
  subtitleKey: tamagotchi.settings.devtools.title
</route>
