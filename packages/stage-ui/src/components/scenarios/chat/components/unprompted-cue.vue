<script setup lang="ts">
import type { ChatHistoryItem } from '../../../../types/chat'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSituationSettings } from '../../../../features/situation/settings'
import { getChatHistoryItemCopyText, getUnpromptedCueKind } from '../utils'

const props = withDefaults(defineProps<{
  /** The trigger message of a turn the character started without user input. */
  message: ChatHistoryItem
  variant?: 'desktop' | 'mobile'
}>(), {
  variant: 'desktop',
})

const { t, te } = useI18n()
const settings = useSituationSettings()
/** A trigger without topic text shows no cue, never the prompt that was sent to the model. */
const topic = computed(() => getChatHistoryItemCopyText(props.message).trim())
/** A kind without a label key (unknown or missing) falls back to the topic text. */
const label = computed(() => {
  const kind = getUnpromptedCueKind(props.message)
  const key = `stage.chat.unprompted.labels.${kind}`
  return kind && te(key) ? t(key) : topic.value
})
</script>

<template>
  <p
    v-if="settings.document.showUnpromptedCue && topic"
    data-chat-unprompted-cue
    :class="[
      'm-0 px-1 pb-1 text-xs italic',
      'text-neutral-500 dark:text-neutral-400',
      variant === 'mobile' ? 'mr-0' : 'mr-12',
    ]"
  >
    {{ t('stage.chat.unprompted.cue', { label }) }}
  </p>
</template>
