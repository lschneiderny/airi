<script setup lang="ts">
import type { NaturalEmotionStrengthsByModel } from '@proj-airi/motion-driver-natural/emotion-strengths'
import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import { naturalEmotionStrengthMax } from '@proj-airi/motion-driver-natural/emotion-strengths'
import { Button, Collapsible, FieldRange } from '@proj-airi/ui'
import { omit } from 'es-toolkit'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * The per-model Natural emotion strengths of any Natural renderer. Each renderer's settings store owns its record;
 * this panel edits the entry of `modelId` and replaces the record on every write, so the stage sees a new identity.
 */
const props = defineProps<{
  modelId: string
}>()

const strengths = defineModel<NaturalEmotionStrengthsByModel>({ required: true })

const { t } = useI18n()

/** Neutral is never performed as an emotion, so it has no strength. */
const emotions: Exclude<PerformanceEmotion, 'neutral'>[] = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']
const defaultStrength = 1

function strength(emotion: PerformanceEmotion) {
  return strengths.value[props.modelId]?.[emotion] ?? defaultStrength
}

function setStrength(emotion: PerformanceEmotion, value: number) {
  strengths.value = {
    ...strengths.value,
    [props.modelId]: { ...strengths.value[props.modelId], [emotion]: value },
  }
}

const customized = computed(() => props.modelId in strengths.value)

function reset() {
  strengths.value = omit(strengths.value, [props.modelId])
}

function formatScale(value: number) {
  return `${value.toFixed(2)}×`
}
</script>

<template>
  <Collapsible>
    <template #trigger="slotProps">
      <button
        type="button"
        :class="['w-full flex items-center gap-2 text-left']"
        :aria-expanded="slotProps.visible"
        @click="slotProps.setVisible(!slotProps.visible)"
      >
        <div :class="['flex-1']">
          <div :class="['flex items-center gap-1 text-sm font-medium']">
            {{ t('settings.live2d.animation.natural-emotion-strength.title') }}
          </div>
          <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.live2d.animation.natural-emotion-strength.description') }}
          </div>
        </div>
        <div
          :class="[
            'i-solar:alt-arrow-down-linear',
            'shrink-0 text-neutral-500 dark:text-neutral-400',
            'transition-transform duration-250',
            slotProps.visible ? 'rotate-180' : '',
          ]"
        />
      </button>
    </template>
    <div :class="['mt-4 flex flex-col gap-4']">
      <FieldRange
        v-for="emotion in emotions"
        :key="emotion"
        :model-value="strength(emotion)"
        :min="0"
        :max="naturalEmotionStrengthMax"
        :step="0.05"
        :label="t(`settings.live2d.expressions.emotions.${emotion}`)"
        :format-value="formatScale"
        @update:model-value="setStrength(emotion, $event)"
      />
      <Button
        :class="['w-full']"
        :disabled="!customized"
        @click="reset"
      >
        {{ t('settings.live2d.animation.natural-emotion-strength.reset') }}
      </Button>
    </div>
  </Collapsible>
</template>
