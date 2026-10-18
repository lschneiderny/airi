<script setup lang="ts">
import type { Band } from '@proj-airi/stage-shared/expression-performance'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { EMOTION_VALUES } from '@proj-airi/stage-ui-live2d/constants/emotions'
import { Button } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

const { t } = useI18n()
const override = useNaturalPerformanceOverride()
const band = ref<Band>('clear')
const bands: Band[] = ['slight', 'clear', 'strong']
</script>

<template>
  <Section
    :title="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.emotions.title')"
    icon="i-solar:emoji-funny-circle-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.emotions.description') }}
    </div>
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="choice in bands"
        :key="choice"
        :label="t(`tamagotchi.settings.devtools.pages.live2d-natural-motion.emotions.bands.${choice}`)"
        :aria-pressed="band === choice"
        :variant="band === choice ? 'primary' : 'secondary'"
        size="sm"
        @click="band = choice"
      />
    </div>
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="emotion in EMOTION_VALUES"
        :key="emotion"
        :data-emotion="emotion"
        size="sm"
        variant="secondary"
        :label="t(`tamagotchi.settings.devtools.pages.live2d-natural-motion.emotions.names.${emotion}`)"
        @click="override.pulseEmotion(emotion, defaultExpressionPerformanceSettings.intensity[band])"
      />
    </div>
  </Section>
</template>
