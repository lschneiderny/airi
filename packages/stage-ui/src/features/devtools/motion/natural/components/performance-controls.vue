<script setup lang="ts">
import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'
import type { SelectTabOption } from '@proj-airi/ui'

import { FieldCheckbox, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'
import { useNaturalPerformanceOverride } from '../../../../../stores/natural-performance-override'

/** Energy the slider starts at when the override is turned on; 0.5 is the neutral Natural energy. */
const neutralEnergy = 0.5

const { t } = useI18n()
const { overrideEnabled, overrideMode, overrideEnergy } = storeToRefs(useNaturalPerformanceOverride())

const modeOptions = computed<SelectTabOption<PerformanceMode>[]>(() =>
  (['idle', 'watching', 'listening', 'thinking', 'talking'] as const).map(mode => ({
    value: mode,
    label: t(`tamagotchi.settings.devtools.pages.live2d-natural-motion.mode.options.${mode}`),
  })),
)

// `null` keeps the user's Energy setting; the stage only forces energy while this is on.
const energyOverridden = computed({
  get: () => overrideEnergy.value !== null,
  set: (enabled: boolean) => {
    overrideEnergy.value = enabled ? neutralEnergy : null
  },
})
const energy = computed({
  get: () => overrideEnergy.value ?? neutralEnergy,
  set: (value: number) => {
    overrideEnergy.value = value
  },
})
</script>

<template>
  <Section
    :title="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.override.title')"
    icon="i-solar:user-speak-rounded-bold-duotone"
    inner-class="gap-4"
  >
    <FieldCheckbox
      v-model="overrideEnabled"
      data-testid="natural-override-enabled"
      :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.override.enabled.title')"
      :description="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.override.enabled.description')"
    />
    <div :class="['flex flex-col gap-2']">
      <div :class="['text-sm font-medium']">
        {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.mode.title') }}
      </div>
      <SelectTab
        v-model="overrideMode"
        data-testid="natural-override-mode"
        size="sm"
        tab-space="compact"
        :options="modeOptions"
        :disabled="!overrideEnabled"
      />
    </div>
    <FieldCheckbox
      v-model="energyOverridden"
      data-testid="natural-override-energy-enabled"
      :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.energy.override.title')"
      :description="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.energy.override.description')"
      :disabled="!overrideEnabled"
    />
    <!-- The stage reads the energy only through the state override, so the slider is inert while it is off.
         FieldRange has no disabled prop; the fieldset disables its range input natively. -->
    <fieldset
      v-if="energyOverridden"
      data-testid="natural-override-energy"
      :disabled="!overrideEnabled"
      :class="['contents']"
    >
      <FieldRange
        v-model="energy"
        as="div"
        :min="0"
        :max="1"
        :step="0.05"
        :format-value="value => value.toFixed(2)"
        :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.energy.title')"
        :description="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.energy.description')"
      />
    </fieldset>
  </Section>
</template>
