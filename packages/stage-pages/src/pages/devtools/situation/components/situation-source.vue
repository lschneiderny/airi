<script setup lang="ts">
import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'

import { formatClock } from '../situation-format'

const props = defineProps<{
  /** Whether this window folds observations itself. */
  localLeading: boolean
  /** Whether the window that answered the inspection folds observations; `undefined` before the first answer. */
  sourceLeading?: boolean
  inspectedAtMs?: number
  error?: string
}>()

const message = computed(() => {
  if (props.sourceLeading === undefined)
    return 'Waiting for the leader window to answer.'
  if (!props.sourceLeading)
    return 'The leader window has not started the situation model, so there is no live situation. Hosts that never initialize the situation store show this.'
  if (props.localLeading)
    return 'This window is the leader. It folds observations and renders the block for every chat request.'
  return 'This window is a follower and keeps no situation of its own. Everything below comes from the leader window.'
})
</script>

<template>
  <Section title="Source" icon="i-solar:routing-2-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['flex', 'flex-wrap', 'items-center', 'gap-2', 'text-xs']">
      <span
        data-testid="situation-window-role"
        :class="[
          'rounded-full', 'px-2', 'py-0.5', 'font-medium',
          localLeading
            ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300'
            : 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-300',
        ]"
      >
        This window: {{ localLeading ? 'leader' : 'follower' }}
      </span>
      <span
        v-if="sourceLeading !== undefined"
        data-testid="situation-source-role"
        :class="[
          'rounded-full', 'px-2', 'py-0.5', 'font-medium',
          sourceLeading
            ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300'
            : 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
        ]"
      >
        Leader situation: {{ sourceLeading ? 'running' : 'not started' }}
      </span>
      <span v-if="inspectedAtMs !== undefined" :class="['text-neutral-500', 'dark:text-neutral-400']">
        Refreshed {{ formatClock(inspectedAtMs) }}
      </span>
    </div>
    <div :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
      {{ message }}
    </div>
    <div
      v-if="error"
      data-testid="situation-source-error"
      :class="['rounded-lg', 'bg-red-500/10', 'px-3', 'py-2', 'text-sm', 'text-red-700', 'dark:text-red-300']"
    >
      Could not read the leader window: {{ error }}
    </div>
  </Section>
</template>
