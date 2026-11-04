<script setup lang="ts">
import { Section } from '@proj-airi/stage-ui/components'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatClock } from '../../situation/situation-format'
import { bodyClass, errorClass, formatDateTime, formatOffset } from '../character-state-styles'

const props = defineProps<{
  /** Whether this window holds the record itself. */
  localLeading: boolean
  /** Whether the window that answered leads; `null` before the first answer. An optional boolean would be cast to `false`. */
  sourceLeading: boolean | null
  /** The leader's clock at the answer, jump included. */
  leaderNowMs?: number
  clockOffsetMs?: number
  cardId?: string | null
  inspectedAtMs?: number
  error?: string
}>()

const { t } = useI18n()

const message = computed(() => {
  if (props.sourceLeading === null)
    return t('tamagotchi.settings.devtools.pages.character-state.source.waiting')
  if (!props.sourceLeading)
    return t('tamagotchi.settings.devtools.pages.character-state.source.not-leading')
  if (props.cardId === null)
    return t('tamagotchi.settings.devtools.pages.character-state.source.no-card')
  return t(props.localLeading ? 'tamagotchi.settings.devtools.pages.character-state.source.leading' : 'tamagotchi.settings.devtools.pages.character-state.source.following')
})

const pillClass = ['rounded-full px-2 py-0.5 font-medium']
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.character-state.source.title')" icon="i-solar:routing-2-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['flex flex-wrap items-center gap-2 text-xs']">
      <span
        data-testid="character-state-window-role"
        :class="[
          ...pillClass,
          localLeading
            ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300'
            : 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-300',
        ]"
      >
        {{ t('tamagotchi.settings.devtools.pages.character-state.source.this-window', { role: t(localLeading ? 'tamagotchi.settings.devtools.pages.character-state.source.leader' : 'tamagotchi.settings.devtools.pages.character-state.source.follower') }) }}
      </span>
      <span
        v-if="leaderNowMs !== undefined"
        data-testid="character-state-leader-clock"
        :class="[
          ...pillClass,
          clockOffsetMs
            ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
            : 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-300',
        ]"
      >
        {{ t('tamagotchi.settings.devtools.pages.character-state.source.leader-clock', { clock: formatDateTime(leaderNowMs) }) }}
        <template v-if="clockOffsetMs">
          {{ t('tamagotchi.settings.devtools.pages.character-state.source.jumped', { offset: formatOffset(clockOffsetMs) }) }}
        </template>
      </span>
      <span v-if="inspectedAtMs !== undefined" :class="['text-neutral-500 dark:text-neutral-400']">
        {{ t('tamagotchi.settings.devtools.pages.character-state.source.refreshed', { clock: formatClock(inspectedAtMs) }) }}
      </span>
    </div>
    <div data-testid="character-state-source-message" :class="bodyClass">
      {{ message }}
    </div>
    <div v-if="error" data-testid="character-state-source-error" :class="errorClass">
      {{ t('tamagotchi.settings.devtools.pages.character-state.source.error', { error }) }}
    </div>
  </Section>
</template>
