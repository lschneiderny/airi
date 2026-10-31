<script setup lang="ts">
import type { ChatHistoryItem } from '../../../../types/chat'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { getWordlessCueWords } from '../utils'

const props = withDefaults(defineProps<{
  /** A reply that answered without words. It has no copy text, so the frame offers no reply to it. */
  message: ChatHistoryItem
  variant?: 'desktop' | 'mobile'
}>(), {
  variant: 'desktop',
})

const { t, te } = useI18n()
/** A cue word without a label (an emotion, or a gesture the locale does not know) shows as itself. */
const label = computed(() => {
  const cues = getWordlessCueWords(props.message).map((word) => {
    const key = `stage.chat.wordless.cues.${word}`
    return te(key) ? t(key) : word
  })
  return cues.length ? t('stage.chat.wordless.reacted', { cues: cues.join(', ') }) : t('stage.chat.wordless.silent')
})
</script>

<template>
  <!-- A chip, not a bubble: the reply holds no text, so it takes neither the bubble surface nor its actions. -->
  <div :class="['flex', variant === 'mobile' ? 'mr-0' : 'mr-12']">
    <span
      data-chat-wordless-chip
      :class="[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'text-xs italic',
        'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400',
      ]"
    >
      <span :class="['i-solar:emoji-funny-circle-linear', 'size-3.5']" aria-hidden="true" />
      {{ label }}
    </span>
  </div>
</template>
