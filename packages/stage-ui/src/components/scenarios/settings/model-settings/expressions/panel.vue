<script setup lang="ts">
import type { ExpressionPanelCommand, ExpressionPanelCustomCommand, ExpressionPanelSnapshot } from './source'

import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import ExpressionAreas from './areas.vue'
import ExpressionCombos from './combos.vue'
import ExpressionReactions from './reactions.vue'

import { isExpressionPanelCustomCommand } from './source'

const props = withDefaults(defineProps<{
  snapshot: ExpressionPanelSnapshot
  /** When false the panel renders the `disabled` slot instead of its controls. */
  enabled?: boolean
}>(), {
  enabled: true,
})
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelCommand): void
  (e: 'customCommand', command: ExpressionPanelCustomCommand): void
}>()

const { t } = useI18n()

// Custom switches exist only for sources that publish free parameters, so they travel on their own event.
function applyExpressionSettingsCommand(command: ExpressionPanelCommand | ExpressionPanelCustomCommand) {
  if (isExpressionPanelCustomCommand(command))
    emit('customCommand', command)
  else
    emit('command', command)
}

// The parent owns these so they survive the panel unmounting when its Collapsible closes.
const expressionSearch = defineModel<string>('search', { required: true })
const showAllExpressions = defineModel<boolean>('showAll', { required: true })
</script>

<template>
  <slot v-if="!props.enabled" name="disabled" />
  <template v-else-if="props.snapshot.entries.length === 0">
    <div py-2 text-sm text-neutral-500 dark:text-neutral-400>
      {{ t('settings.live2d.expressions.no-expression') }}
    </div>
  </template>
  <template v-else>
    <!-- Emotion first: what the character shows, then the combos behind it, then every single expression. -->
    <ExpressionReactions :entries="props.snapshot.entries" @command="applyExpressionSettingsCommand" />

    <ExpressionCombos :entries="props.snapshot.entries" :class="['mt-4']" @command="applyExpressionSettingsCommand" />

    <ExpressionAreas
      v-model:search="expressionSearch"
      v-model:show-all="showAllExpressions"
      :snapshot="props.snapshot"
      :class="['mt-4']"
      @command="applyExpressionSettingsCommand"
    />

    <!-- Action buttons -->
    <div :class="['mt-4', 'flex flex-wrap gap-2']">
      <Button @click="applyExpressionSettingsCommand({ type: 'save-defaults' })">
        {{ t('settings.live2d.expressions.save-default') }}
      </Button>
      <Button @click="applyExpressionSettingsCommand({ type: 'reset-all' })">
        {{ t('settings.live2d.expressions.reset') }}
      </Button>
    </div>
  </template>
</template>
