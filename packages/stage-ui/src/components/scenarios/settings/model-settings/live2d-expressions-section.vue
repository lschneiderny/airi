<script setup lang="ts">
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d'

import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import Live2dExpressionAreas from './live2d-expression-areas.vue'
import Live2dExpressionCombos from './live2d-expression-combos.vue'

const props = defineProps<{
  snapshot: Live2DExpressionSettingsSnapshot
  enabled: boolean
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
}>()

const { t } = useI18n()

function applyExpressionSettingsCommand(command: Live2DExpressionSettingsCommand) {
  emit('command', command)
}

// The parent owns these so they survive the section unmounting when its Collapsible closes.
const expressionSearch = defineModel<string>('search', { required: true })
const showAllExpressions = defineModel<boolean>('showAll', { required: true })
</script>

<template>
  <div v-if="!props.enabled" py-2 text-xs text-neutral-500 dark:text-neutral-400>
    {{ t('settings.live2d.expressions.sdk-preset-preserved-notice') }}
  </div>
  <template v-else-if="props.snapshot.entries.length === 0">
    <div py-2 text-sm text-neutral-500 dark:text-neutral-400>
      {{ t('settings.live2d.expressions.no-expression') }}
    </div>
  </template>
  <template v-else>
    <Live2dExpressionAreas
      v-model:search="expressionSearch"
      v-model:show-all="showAllExpressions"
      :snapshot="props.snapshot"
      @command="applyExpressionSettingsCommand"
    />

    <Live2dExpressionCombos :entries="props.snapshot.entries" :class="['mt-4']" @command="applyExpressionSettingsCommand" />

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
