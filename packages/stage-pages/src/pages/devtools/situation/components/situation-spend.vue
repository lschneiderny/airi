<script setup lang="ts">
import type { SituationSpend } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { Section } from '@proj-airi/stage-ui/components'

import { formatAgo } from '../situation-format'

defineProps<{
  spend: SituationSpend
  nowMs: number
}>()

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
  <Section title="Unprompted spend" icon="i-solar:wallet-money-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid', 'gap-2', 'md:grid-cols-2']">
      <div :class="['overflow-x-auto', ...cardClass]">
        <div :class="labelClass">
          Turns since the leader window started
        </div>
        <table data-testid="situation-spend-sessions" :class="['mt-2 w-full text-sm', 'text-neutral-700 dark:text-neutral-200']">
          <thead :class="labelClass">
            <tr>
              <th :class="cellClass">
                Session
              </th>
              <th :class="cellClass">
                Spoken
              </th>
              <th :class="cellClass">
                Declined
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="session in spend.sessions"
              :key="session.sessionId"
              :class="['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']"
            >
              <td :class="[...cellClass, 'font-mono text-xs break-all']">
                {{ session.sessionId }}
              </td>
              <td :class="cellClass">
                {{ session.spoken }}
              </td>
              <td :class="cellClass">
                {{ session.declined }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="spend.sessions.length === 0" :class="['py-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
          No unprompted turn has been spoken or declined yet.
        </div>
      </div>

      <div data-testid="situation-spend-last-request" :class="cardClass">
        <div :class="labelClass">
          Last unprompted request
        </div>
        <template v-if="spend.lastUnpromptedRequest">
          <div :class="['mt-1 text-2xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
            {{ spend.lastUnpromptedRequest.chars }} chars
          </div>
          <div :class="noteClass">
            {{ spend.lastUnpromptedRequest.messageCount }} messages, sent {{ formatAgo(spend.lastUnpromptedRequest.capturedAtMs, nowMs) }}
          </div>
          <div :class="['mt-0.5 font-mono break-all', ...noteClass]">
            Turn {{ spend.lastUnpromptedRequest.turnId }}
          </div>
        </template>
        <div v-else :class="['mt-1 text-sm', 'text-neutral-500 dark:text-neutral-400']">
          No unprompted turn has sent a provider request yet.
        </div>
        <div :class="['mt-2', ...noteClass]">
          Counts message text only. Images, audio, and tool calls are not included.
        </div>
      </div>
    </div>
  </Section>
</template>
