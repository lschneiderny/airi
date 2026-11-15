<script setup lang="ts">
import type { Moment, Occasion } from '@proj-airi/stage-shared/expression-performance'

import type { NaturalLabIdleLife } from '../../../../../stores/natural-performance-override'

import { MOMENTS, OCCASIONS } from '@proj-airi/stage-shared/expression-performance'
import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { Button, FieldCheckbox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import TagPicker from '../../../../../components/scenarios/settings/model-settings/expressions/tag-picker.vue'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

const prefix = 'tamagotchi.settings.devtools.pages.live2d-natural-motion.own-expressions'
const tags = 'settings.live2d.expressions'

const { t } = useI18n()
const override = useNaturalPerformanceOverride()
const { occasionOverride } = storeToRefs(override)
const { live2dMotionDriver } = storeToRefs(useSettingsLive2d())
// Pastimes and moments are hers only under Live2D Natural, and only with the Idle activities setting on.
const disabled = computed(() => live2dMotionDriver.value !== 'natural')

const occasionOptions = computed(() => OCCASIONS.map(value => ({ value, label: t(`${tags}.occasions.options.${value}`) })))
const choosing = computed({
  get: () => occasionOverride.value !== null,
  set: (value: boolean) => {
    occasionOverride.value = value ? [] : null
  },
})
const chosen = computed({
  get: () => occasionOverride.value ?? [],
  set: (value: Occasion[]) => {
    occasionOverride.value = value
  },
})

// The stage publishes what she shows once a second; nothing arrives while no stage runs.
const life = ref<NaturalLabIdleLife | null>(null)
onUnmounted(override.onIdleLife((state) => {
  life.value = state
}))
const none = computed(() => t(`${prefix}.now.none`))
const now = computed(() => life.value && {
  occasions: life.value.occasions.map(occasion => t(`${tags}.occasions.options.${occasion}`)).join(', ') || none.value,
  pastime: life.value.pastime ?? none.value,
  moment: life.value.moment ? `${t(`${tags}.moments.options.${life.value.moment.moment}`)}: ${life.value.moment.label}` : none.value,
})
const moments: readonly Moment[] = MOMENTS
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:cup-hot-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ disabled ? t(`${prefix}.requires-natural`) : t(`${prefix}.description`) }}
    </div>

    <fieldset data-testid="natural-own-expressions" :disabled="disabled" :class="['contents']">
      <dl data-testid="natural-own-now" :class="['grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 m-0', 'text-xs font-mono']">
        <template v-if="now">
          <dt>{{ t(`${prefix}.now.occasions`) }}</dt><dd :class="['m-0']">
            {{ now.occasions }}
          </dd>
          <dt>{{ t(`${prefix}.now.pastime`) }}</dt><dd :class="['m-0']">
            {{ now.pastime }}
          </dd>
          <dt>{{ t(`${prefix}.now.moment`) }}</dt><dd :class="['m-0']">
            {{ now.moment }}
          </dd>
        </template>
        <dd v-else :class="['col-span-2 m-0', 'text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.now.waiting`) }}
        </dd>
      </dl>

      <FieldCheckbox
        v-model="choosing"
        data-testid="natural-own-choose-occasions"
        :label="t(`${prefix}.occasions.title`)"
        :description="t(`${prefix}.occasions.description`)"
        :disabled="disabled"
      />
      <div v-if="choosing" data-testid="natural-own-occasions">
        <TagPicker v-model="chosen" :options="occasionOptions" :disabled="disabled" />
      </div>

      <div :class="['flex flex-col gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.pastime.title`) }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.pastime.description`) }}
        </div>
        <div>
          <Button
            data-testid="natural-own-pastime"
            size="sm"
            :disabled="disabled"
            :label="t(`${prefix}.pastime.start`)"
            @click="override.requestPastime()"
          />
        </div>
      </div>

      <div :class="['flex flex-col gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.moments.title`) }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.moments.description`) }}
        </div>
        <div :class="['flex flex-wrap gap-2']">
          <Button
            v-for="moment in moments"
            :key="moment"
            :data-own-moment="moment"
            size="sm"
            variant="secondary"
            :disabled="disabled"
            :label="t(`${tags}.moments.options.${moment}`)"
            @click="override.requestMoment(moment)"
          />
        </div>
      </div>
    </fieldset>
  </Section>
</template>
