<script setup lang="ts">
import type { AnyExpressionPanelCommand, ExpressionPanelCommand, ExpressionPanelCustomCommand, ExpressionPanelItemCommand, ExpressionPanelSnapshot } from './source'

import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import ExpressionAreas from './areas.vue'
import ExpressionCombos from './combos.vue'
import ExpressionReactions from './reactions.vue'
import ExpressionStageItems from './stage-items.vue'

import { isExpressionPanelCustomCommand, isExpressionPanelItemCommand } from './source'

const props = withDefaults(defineProps<{
  snapshot: ExpressionPanelSnapshot
  /** When false the panel renders the `disabled` slot instead of its controls. */
  enabled?: boolean
  /** Whether the model keeps item documents while disabled; the snapshot carries none then, and a note says they are only shown while the system is on. */
  hasStoredItems?: boolean
}>(), {
  enabled: true,
  hasStoredItems: false,
})
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelCommand): void
  (e: 'customCommand', command: ExpressionPanelCustomCommand): void
  (e: 'itemCommand', command: ExpressionPanelItemCommand): void
}>()

const { t } = useI18n()

// Custom switches and stage items exist only for sources that publish them, so each travels on its own event.
function applyExpressionSettingsCommand(command: AnyExpressionPanelCommand) {
  if (isExpressionPanelItemCommand(command))
    emit('itemCommand', command)
  else if (isExpressionPanelCustomCommand(command))
    emit('customCommand', command)
  else
    emit('command', command)
}

// The parent owns these so they survive the panel unmounting when its Collapsible closes.
const expressionSearch = defineModel<string>('search', { required: true })
const showAllExpressions = defineModel<boolean>('showAll', { required: true })
</script>

<template>
  <template v-if="!props.enabled">
    <slot name="disabled" />
    <!-- Stored items stay stored, but nothing draws them while the expression system is off. -->
    <p
      v-if="props.hasStoredItems"
      role="note"
      :class="['py-2', 'text-xs text-neutral-500 dark:text-neutral-400']"
    >
      {{ t('settings.live2d.expressions.items.system-off-hint') }}
    </p>
  </template>
  <template v-else-if="props.snapshot.entries.length === 0">
    <div py-2 text-sm text-neutral-500 dark:text-neutral-400>
      {{ t('settings.live2d.expressions.no-expression') }}
    </div>
    <ExpressionStageItems v-if="props.snapshot.items" :snapshot="props.snapshot" @command="applyExpressionSettingsCommand" />
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

    <!-- The library and the way into this model's catalog; item entries themselves sit in the areas above. -->
    <ExpressionStageItems
      v-if="props.snapshot.items"
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
