<script setup lang="ts">
import { EMOTION_VALUES } from '@proj-airi/stage-ui-live2d/constants/emotions'
import { Button, FieldRange } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

const { t } = useI18n()
const override = useNaturalPerformanceOverride()
const intensity = ref(1)
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
    <FieldRange
      v-model="intensity"
      as="div"
      :min="0"
      :max="1"
      :step="0.05"
      :format-value="value => value.toFixed(2)"
      :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.emotions.intensity')"
    />
    <div :class="['flex flex-wrap gap-2']">
      <Button
        v-for="emotion in EMOTION_VALUES"
        :key="emotion"
        :data-emotion="emotion"
        size="sm"
        variant="secondary"
        :label="t(`tamagotchi.settings.devtools.pages.live2d-natural-motion.emotions.names.${emotion}`)"
        @click="override.pulseEmotion(emotion, intensity)"
      />
    </div>
  </Section>
</template>
