<script setup lang="ts">
import type { MMDOverlayFlags } from '@proj-airi/stage-ui-mmd/composables/mmd'

import { mmdOverlayColors, mmdOverlayFlagNames } from '@proj-airi/stage-ui-mmd/composables/mmd'
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { FieldCheckbox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.overlays'

const { t } = useI18n()
const diagnostics = useMMDMotionDiagnostics()
const { overlays } = storeToRefs(diagnostics)

const toggles = mmdOverlayFlagNames.map(flag => ({
  flag,
  model: computed({
    get: () => overlays.value[flag],
    set: (enabled: boolean) => diagnostics.setOverlays({ [flag]: enabled } satisfies Partial<MMDOverlayFlags>),
  }),
}))

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

const legend = [
  ['collider-head', hex(mmdOverlayColors.colliderHead)],
  ['collider-body', hex(mmdOverlayColors.colliderBody)],
  ['foot-anchor', hex(mmdOverlayColors.footAnchor)],
  ['ankle', hex(mmdOverlayColors.ankle)],
  ['look-at', hex(mmdOverlayColors.lookAt)],
] as const
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:layers-minimalistic-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t(`${prefix}.description`) }}
    </div>
    <FieldCheckbox
      v-for="toggle in toggles"
      :key="toggle.flag"
      v-model="toggle.model.value"
      :data-testid="`mmd-overlay-${toggle.flag}`"
      :label="t(`${prefix}.flags.${toggle.flag}.title`)"
      :description="t(`${prefix}.flags.${toggle.flag}.description`)"
    />
    <ul :class="['flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300']">
      <li v-for="[id, color] in legend" :key="id" :class="['flex items-center gap-1.5']">
        <span :class="['inline-block size-3 rounded-full']" :style="{ backgroundColor: color }" />
        {{ t(`${prefix}.legend.${id}`) }}
      </li>
    </ul>
  </Section>
</template>
