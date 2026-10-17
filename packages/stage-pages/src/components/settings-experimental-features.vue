<script setup lang="ts">
import { CHARACTER_CARD_SYNC_FLAG } from '@proj-airi/stage-ui/libs/feature-flags'
import { useFeatureFlagsStore } from '@proj-airi/stage-ui/stores/feature-flags'
import { Button, FieldCheckbox } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const experiments = useFeatureFlagsStore()
const features = computed(() => experiments.features.filter(feature => feature.key !== CHARACTER_CARD_SYNC_FLAG.key))
const prefix = 'settings.pages.system.experimental'
</script>

<template>
  <div :class="['flex flex-col gap-4', 'pb-6']">
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t(`${prefix}.notice`) }}
    </p>
    <div v-if="experiments.error" role="status" :class="['flex items-center justify-between gap-3', 'rounded-xl bg-amber-100 p-4 dark:bg-amber-950']">
      <p :class="['text-sm']">
        {{ t(`${prefix}.load-error`) }}
      </p>
      <Button :loading="experiments.loading" @click="experiments.refresh()">
        {{ t(`${prefix}.retry`) }}
      </Button>
    </div>
    <div v-if="!features.length" :class="['rounded-xl bg-neutral-50 p-6 dark:bg-neutral-900', 'flex flex-col items-center gap-2 text-center']">
      <div aria-hidden="true" :class="['i-solar:test-tube-bold-duotone', 'size-8 text-primary-500']" />
      <h2 :class="['font-medium']">
        {{ t(`${prefix}.empty-title`) }}
      </h2>
    </div>
    <section
      v-for="feature in features"
      :key="feature.key"
      :class="['flex flex-col gap-3', 'rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900']"
    >
      <FieldCheckbox
        :model-value="feature.enabled"
        :label="t(feature.titleKey)"
        :description="t(feature.descriptionKey)"
        @update:model-value="experiments.setPreference(feature.key, $event)"
      />
      <div :class="['flex items-center justify-between gap-3']">
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.sources.${feature.source}`) }}
        </p>
        <Button v-if="feature.preference !== undefined" size="sm" @click="experiments.setPreference(feature.key, undefined)">
          {{ t(`${prefix}.reset`) }}
        </Button>
      </div>
    </section>
    <div :class="['flex justify-end']">
      <Button :loading="experiments.loading" @click="experiments.refresh()">
        {{ t(`${prefix}.refresh`) }}
      </Button>
    </div>
  </div>
</template>
