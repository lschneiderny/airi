<script setup lang="ts">
import type { EmotionMapping } from '@proj-airi/stage-shared/expression-performance'

import { Button, Checkbox, Input, Select } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/** A mapping while it is being edited; the weight input may hold a non-number until it is valid. */
export interface DraftMapping {
  emotion: EmotionMapping['emotion']
  weight: number | undefined
  minBand: EmotionMapping['minBand']
}

const props = defineProps<{
  /** Hides the "Let the AI use it" control when false; the mappings stay editable. */
  canExposeToLlm: boolean
  /** The band a newly added mapping starts with. */
  defaultMinBand: EmotionMapping['minBand']
}>()
const minWeight = 0.1
const maxWeight = 5

const mappings = defineModel<DraftMapping[]>('mappings', { required: true })
const exposedToLlm = defineModel<boolean>('exposedToLlm', { required: true })

const { t } = useI18n()

const emotions: EmotionMapping['emotion'][] = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']
const bands: EmotionMapping['minBand'][] = ['slight', 'clear', 'strong']

const emotionOptions = computed(() => emotions.map(emotion => ({ value: emotion, label: t(`settings.live2d.expressions.emotions.${emotion}`) })))
const bandOptions = computed(() => bands.map(band => ({ value: band, label: t(`settings.live2d.expressions.bands.${band}`) })))

function weightError(weight: number | undefined) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= minWeight && weight <= maxWeight
    ? ''
    : t('settings.live2d.expressions.validation.weight-range', { min: minWeight, max: maxWeight })
}
/** True while any mapping weight is outside 0.1-5; parents gate their Save on it. */
const hasErrors = computed(() => mappings.value.some(mapping => weightError(mapping.weight) !== ''))
defineExpose({ hasErrors })

function addMapping() {
  mappings.value = [...mappings.value, { emotion: 'happy', weight: 1, minBand: props.defaultMinBand }]
}

function removeMapping(index: number) {
  mappings.value = mappings.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div :class="['flex flex-col gap-3']">
    <label
      v-if="canExposeToLlm"
      :class="['flex items-center justify-between gap-2', 'text-sm text-neutral-700 dark:text-neutral-300']"
    >
      {{ t('settings.live2d.expressions.llm-exposed') }}
      <Checkbox v-model="exposedToLlm" :class="['shrink-0']" :aria-label="t('settings.live2d.expressions.llm-exposed')" />
    </label>

    <div :class="['flex flex-col gap-2']">
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ t('settings.live2d.expressions.fields.mappings') }}</span>
      <div
        v-for="(mapping, index) in mappings"
        :key="index"
        :class="['flex flex-col gap-2 rounded-lg p-2', 'bg-neutral-50 dark:bg-neutral-900']"
      >
        <div :class="['grid grid-cols-1 gap-2 sm:grid-cols-3']">
          <div :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.live2d.expressions.fields.emotion') }}
            <Select v-model="mapping.emotion" :options="emotionOptions" />
          </div>
          <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.live2d.expressions.fields.weight') }}
            <Input v-model="mapping.weight" type="number" :aria-label="`${t('settings.live2d.expressions.fields.weight')} ${index + 1}`" />
          </label>
          <div :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.live2d.expressions.fields.min-band') }}
            <Select v-model="mapping.minBand" :options="bandOptions" />
          </div>
        </div>
        <span v-if="weightError(mapping.weight)" :class="['text-xs text-red-500']" role="alert">{{ weightError(mapping.weight) }}</span>
        <div>
          <Button size="sm" @click="removeMapping(index)">
            {{ t('settings.live2d.expressions.remove-mapping') }}
          </Button>
        </div>
      </div>
      <div>
        <Button size="sm" @click="addMapping">
          {{ t('settings.live2d.expressions.add-mapping') }}
        </Button>
      </div>
    </div>
  </div>
</template>
