<script setup lang="ts">
import type { CatalogEntry, TagSuggestion } from '@proj-airi/stage-shared/expression-performance'

import type { AnyExpressionPanelCommand } from './source'

import { errorMessageFrom } from '@moeru/std'
import { tagSuggestionPatch } from '@proj-airi/stage-shared/expression-performance'
import { Button, Checkbox } from '@proj-airi/ui'
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { NoChatModelError, requestExpressionTagSuggestions } from '../../../../../composables/performance/expression-tag-suggestions'

/**
 * Lets the user ask the chat model how the character could use this model's expressions on her own.
 *
 * The model never changes the setup. The user starts the request, the reply is shown as a list of proposals, and
 * only the proposals the user leaves checked are sent as entry edits when they press Apply. A proposal that would
 * replace a choice the user already made starts unchecked.
 */
const props = defineProps<{
  entries: readonly CatalogEntry[]
  /** Replaces the request to the chat model, for tests and stories. */
  request?: (entries: readonly CatalogEntry[], signal: AbortSignal) => Promise<TagSuggestion[]>
}>()
const emit = defineEmits<{
  (e: 'command', command: AnyExpressionPanelCommand): void
}>()

const { t } = useI18n()
const prefix = 'settings.live2d.expressions.suggestions'

const status = ref<'idle' | 'asking' | 'ready' | 'failed'>('idle')
const failure = ref('')
const suggestions = ref<TagSuggestion[]>([])
const accepted = ref<Record<string, boolean>>({})
let controller: AbortController | undefined
onUnmounted(() => controller?.abort())

async function ask() {
  controller?.abort()
  const current = controller = new AbortController()
  status.value = 'asking'
  try {
    const result = await (props.request ?? requestExpressionTagSuggestions)(props.entries, current.signal)
    if (current.signal.aborted)
      return
    suggestions.value = result
    // What the user already chose is kept unless they ask for the change.
    accepted.value = Object.fromEntries(result.map(suggestion => [suggestion.id, !suggestion.replaces]))
    status.value = 'ready'
  }
  catch (error) {
    if (current.signal.aborted)
      return
    failure.value = error instanceof NoChatModelError ? t(`${prefix}.no-model`) : t(`${prefix}.failed`, { error: errorMessageFrom(error) ?? '' })
    status.value = 'failed'
  }
}

function dismiss() {
  controller?.abort()
  suggestions.value = []
  status.value = 'idle'
}

const acceptedCount = computed(() => suggestions.value.filter(suggestion => accepted.value[suggestion.id]).length)

function apply() {
  for (const suggestion of suggestions.value) {
    if (!accepted.value[suggestion.id])
      continue
    const patch = tagSuggestionPatch(suggestion)
    if (suggestion.id.startsWith('item:'))
      emit('command', { type: 'update-item', id: suggestion.id, patch })
    else if (suggestion.id.startsWith('custom:'))
      emit('command', { type: 'update-custom', id: suggestion.id, patch })
    else
      emit('command', { type: 'update-entry', id: suggestion.id, patch })
  }
  dismiss()
}

function summary(suggestion: TagSuggestion) {
  const parts: string[] = []
  if (suggestion.idleUse !== 'never')
    parts.push(t(`settings.live2d.expressions.idle-use.options.${suggestion.idleUse}`))
  parts.push(...suggestion.occasions.map(occasion => t(`settings.live2d.expressions.occasions.options.${occasion}`)))
  if (suggestion.moments.length > 0)
    parts.push(t('settings.live2d.expressions.moments.tag', { moments: suggestion.moments.map(moment => t(`settings.live2d.expressions.moments.options.${moment}`)).join(', ') }))
  return parts.join(' · ')
}
</script>

<template>
  <div
    data-testid="expression-tag-suggestions"
    :class="[
      'flex flex-col gap-2 p-2',
      'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
      'text-xs text-neutral-500 dark:text-neutral-400',
    ]"
  >
    <div :class="['flex flex-wrap items-center justify-between gap-2']">
      <span :class="['min-w-0 flex-1 break-words']">{{ t(`${prefix}.description`) }}</span>
      <Button v-if="status === 'asking'" size="sm" variant="secondary" @click="dismiss">
        {{ t(`${prefix}.cancel`) }}
      </Button>
      <Button v-else size="sm" variant="secondary" @click="ask">
        {{ t(`${prefix}.ask`) }}
      </Button>
    </div>

    <span v-if="status === 'asking'" role="status">{{ t(`${prefix}.asking`) }}</span>
    <span v-else-if="status === 'failed'" role="alert" :class="['break-words', 'text-red-500']">{{ failure }}</span>
    <span v-else-if="status === 'ready' && suggestions.length === 0" role="status">{{ t(`${prefix}.none`) }}</span>

    <template v-if="status === 'ready' && suggestions.length > 0">
      <span>{{ t(`${prefix}.review`) }}</span>
      <ul role="list" :class="['flex flex-col gap-1.5 m-0 p-0 list-none']">
        <li
          v-for="suggestion in suggestions"
          :key="suggestion.id"
          :data-suggestion="suggestion.id"
          :class="['flex items-start gap-2']"
        >
          <Checkbox
            v-model="accepted[suggestion.id]"
            :aria-label="t(`${prefix}.accept`, { label: suggestion.label })"
          />
          <div :class="['min-w-0 flex flex-1 flex-col']">
            <span :class="['break-words', 'text-sm text-neutral-700 dark:text-neutral-300']">{{ suggestion.label }}</span>
            <span :class="['break-words']">{{ summary(suggestion) }}</span>
            <span v-if="suggestion.reason" :class="['break-words italic']">{{ suggestion.reason }}</span>
            <span v-if="suggestion.replaces" :class="['break-words', 'text-amber-700 dark:text-amber-300']">{{ t(`${prefix}.replaces`) }}</span>
          </div>
        </li>
      </ul>
      <div :class="['flex flex-wrap gap-2']">
        <Button size="sm" :disabled="acceptedCount === 0" @click="apply">
          {{ t(`${prefix}.apply`, { count: acceptedCount }) }}
        </Button>
        <Button size="sm" variant="secondary" @click="dismiss">
          {{ t(`${prefix}.dismiss`) }}
        </Button>
      </div>
    </template>
  </div>
</template>
