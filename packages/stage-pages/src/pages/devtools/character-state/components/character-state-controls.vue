<script setup lang="ts">
import type { CharacterEvent, CharacterEventKind } from '@proj-airi/stage-shared/character-state'

import type { TestEventKind } from '../character-state-test-events'

import { Section } from '@proj-airi/stage-ui/components'
import { Button, Select } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { cardClass, errorClass, formatDateTime, formatOffset, labelClass, noteClass, okClass } from '../character-state-styles'
import { TEST_EVENT_KINDS, testEvent } from '../character-state-test-events'

/** What the page reports after an action, so the controls show one line about the last one. */
export type CharacterControlsOutcome
  = | { action: 'jump', atMs: number }
    | { action: 'apply', atMs: number, kind: CharacterEventKind, status: 'applied' | 'ignored' }
    | { action: 'apply', atMs: number, kind: CharacterEventKind, status: 'invalid', error: string }
    | { action: 'reset', atMs: number }

const props = defineProps<{
  clockOffsetMs: number
  busy: boolean
  outcome?: CharacterControlsOutcome
  error?: string
}>()

const emit = defineEmits<{
  (event: 'jump', ms: number): void
  (event: 'apply', characterEvent: CharacterEvent): void
  (event: 'reset'): void
}>()

const { t } = useI18n()

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const JUMPS = [
  { id: 'hour', ms: HOUR_MS, key: 'jump-hour' },
  { id: 'day', ms: DAY_MS, key: 'jump-day' },
  { id: 'week', ms: 7 * DAY_MS, key: 'jump-week' },
] as const

const selectedKind = ref<TestEventKind>('touch-pleasant')

const options = computed(() => TEST_EVENT_KINDS.map(kind => ({ value: kind, label: t(`tamagotchi.settings.devtools.pages.character-state.controls.event-kinds.${kind}`) })))

const outcomeText = computed(() => {
  const outcome = props.outcome
  if (!outcome)
    return undefined
  const clock = formatDateTime(outcome.atMs)
  switch (outcome.action) {
    case 'jump':
      return t('tamagotchi.settings.devtools.pages.character-state.controls.jumped', { clock })
    case 'reset':
      return t('tamagotchi.settings.devtools.pages.character-state.controls.reset-done', { clock })
    case 'apply':
      if (outcome.status === 'invalid')
        return t('tamagotchi.settings.devtools.pages.character-state.controls.invalid', { error: outcome.error })
      return t(outcome.status === 'applied' ? 'tamagotchi.settings.devtools.pages.character-state.controls.applied' : 'tamagotchi.settings.devtools.pages.character-state.controls.ignored', { kind: outcome.kind, clock })
  }
})

const outcomeIsError = computed(() => props.outcome?.action === 'apply' && props.outcome.status !== 'applied')
</script>

<template>
  <Section :title="t('tamagotchi.settings.devtools.pages.character-state.controls.title')" icon="i-solar:stopwatch-play-bold-duotone" inner-class="gap-3" :expand="true">
    <div :class="['grid gap-2 lg:grid-cols-3']">
      <div data-testid="character-state-jump" :class="['flex flex-col gap-2', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.jump') }}
        </div>
        <div :class="['flex flex-wrap gap-2']">
          <Button
            v-for="jump in JUMPS"
            :key="jump.id"
            :data-jump="jump.id"
            :label="t(`tamagotchi.settings.devtools.pages.character-state.controls.${jump.key}`)"
            icon="i-solar:forward-bold-duotone"
            size="sm"
            :disabled="busy"
            @click="emit('jump', jump.ms)"
          />
        </div>
        <div data-testid="character-state-offset" :class="['font-mono text-sm', 'text-neutral-700 dark:text-neutral-200']">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.offset', { offset: formatOffset(clockOffsetMs) }) }}
        </div>
        <div :class="noteClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.jump-note') }}
        </div>
      </div>

      <div data-testid="character-state-apply" :class="['flex flex-col gap-2', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.apply') }}
        </div>
        <div :class="['flex flex-wrap items-center gap-2']">
          <div :class="['min-w-48 flex-1']">
            <Select v-model="selectedKind" :options="options" :disabled="busy" :placeholder="t('tamagotchi.settings.devtools.pages.character-state.controls.event')" />
          </div>
          <Button
            data-testid="character-state-apply-action"
            :label="t('tamagotchi.settings.devtools.pages.character-state.controls.apply-action')"
            icon="i-solar:play-bold-duotone"
            size="sm"
            :disabled="busy"
            @click="emit('apply', testEvent(selectedKind))"
          />
        </div>
        <div :class="noteClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.apply-note') }}
        </div>
      </div>

      <div data-testid="character-state-reset" :class="['flex flex-col gap-2', ...cardClass]">
        <div :class="labelClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.reset') }}
        </div>
        <div>
          <Button
            data-testid="character-state-reset-action"
            :label="t('tamagotchi.settings.devtools.pages.character-state.controls.reset-action')"
            icon="i-solar:restart-bold-duotone"
            size="sm"
            color="red"
            :disabled="busy"
            @click="emit('reset')"
          />
        </div>
        <div :class="noteClass">
          {{ t('tamagotchi.settings.devtools.pages.character-state.controls.reset-note') }}
        </div>
      </div>
    </div>

    <div v-if="error" data-testid="character-state-controls-error" :class="errorClass">
      {{ t('tamagotchi.settings.devtools.pages.character-state.controls.failed', { error }) }}
    </div>
    <div v-else-if="outcomeText" data-testid="character-state-controls-outcome" :class="outcomeIsError ? errorClass : okClass">
      {{ outcomeText }}
    </div>
  </Section>
</template>
