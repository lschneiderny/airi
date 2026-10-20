<script setup lang="ts">
import type { SituationPreview, SituationRenderRecord } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { SITUATION_MAX_CHARS, SITUATION_MAX_LINES } from '@proj-airi/stage-shared/situation'
import { Section } from '@proj-airi/stage-ui/components'
import { SITUATION_RENDER_HISTORY_MAX, situationBlockUsage } from '@proj-airi/stage-ui/stores/devtools/situation-observability'
import { Button } from '@proj-airi/ui'
import { computed } from 'vue'

import { formatClock } from '../situation-format'

const props = defineProps<{
  renders: readonly SituationRenderRecord[]
  preview?: SituationPreview
  previewing: boolean
  previewError?: string
}>()

const emit = defineEmits<{
  (event: 'preview'): void
}>()

const lastRender = computed(() => props.renders[0])
const earlierRenders = computed(() => props.renders.slice(1))

function usageText(text: string) {
  const usage = situationBlockUsage(text)
  return `${usage.lines} / ${SITUATION_MAX_LINES} lines, ${usage.chars} / ${SITUATION_MAX_CHARS} chars`
}

const blockClass = [
  'max-h-80 overflow-auto rounded-lg p-3',
  'whitespace-pre-wrap break-words font-mono text-xs',
  'bg-neutral-900/90 text-neutral-100',
]
const cardClass = [
  'rounded-xl border p-4',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
</script>

<template>
  <Section title="Situation block" icon="i-solar:document-text-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid', 'gap-3', 'xl:grid-cols-2']">
      <div data-testid="situation-last-render" :class="cardClass">
        <div :class="['flex flex-wrap items-center justify-between gap-2']">
          <div :class="labelClass">
            Last sent block
          </div>
          <span v-if="lastRender" :class="noteClass">
            {{ formatClock(lastRender.nowMs) }} · {{ usageText(lastRender.text) }}
          </span>
        </div>
        <template v-if="lastRender">
          <pre :class="['mt-3', ...blockClass]">{{ lastRender.text }}</pre>
          <div :class="['mt-2', ...noteClass]">
            Marked shown: {{ lastRender.shownEventIds.join(', ') || 'none' }}
          </div>
        </template>
        <div v-else :class="['mt-3 text-sm', 'text-neutral-500 dark:text-neutral-400']">
          No chat request has carried a situation block yet.
        </div>
        <div :class="['mt-2', ...noteClass]">
          {{ renders.length }} of the last {{ SITUATION_RENDER_HISTORY_MAX }} renders kept.
        </div>
        <details v-if="earlierRenders.length > 0" :class="['mt-2']">
          <summary :class="['cursor-pointer', ...noteClass]">
            Earlier renders
          </summary>
          <div v-for="render in earlierRenders" :key="render.id" :class="['mt-2']">
            <div :class="noteClass">
              {{ formatClock(render.nowMs) }} · {{ usageText(render.text) }} · marked {{ render.shownEventIds.length }}
            </div>
            <pre :class="['mt-1', ...blockClass]">{{ render.text }}</pre>
          </div>
        </details>
      </div>

      <div data-testid="situation-preview" :class="cardClass">
        <div :class="['flex flex-wrap items-center justify-between gap-2']">
          <div :class="labelClass">
            Preview
          </div>
          <Button
            label="Render now"
            icon="i-solar:refresh-bold-duotone"
            size="sm"
            :loading="previewing"
            @click="emit('preview')"
          />
        </div>
        <div :class="['mt-2', ...noteClass]">
          Renders the block the next request would carry. It does not mark any event as shown.
        </div>
        <div
          v-if="previewError"
          :class="['mt-3 rounded-lg px-3 py-2 text-sm', 'bg-red-500/10 text-red-700 dark:text-red-300']"
        >
          Preview failed: {{ previewError }}
        </div>
        <template v-else-if="preview">
          <div :class="['mt-3', ...noteClass]">
            {{ formatClock(preview.nowMs) }} · {{ usageText(preview.text) }}
          </div>
          <pre :class="['mt-1', ...blockClass]">{{ preview.text }}</pre>
          <div :class="['mt-2', ...noteClass]">
            A request would mark shown: {{ preview.shownEventIds.join(', ') || 'none' }}
          </div>
        </template>
      </div>
    </div>
  </Section>
</template>
