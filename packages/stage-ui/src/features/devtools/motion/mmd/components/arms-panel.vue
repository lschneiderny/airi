<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.arms'

const { t } = useI18n()
const { snapshot } = storeToRefs(useMMDMotionDiagnostics())

const rows = computed(() => {
  const arms = snapshot.value.arms
  if (!arms)
    return []
  return [
    { id: 'weight', value: arms.weight.toFixed(2) },
    { id: 'owned-left-arm', value: arms.owned.leftArm.toFixed(2) },
    { id: 'owned-right-arm', value: arms.owned.rightArm.toFixed(2) },
    { id: 'owned-left-fingers', value: arms.owned.leftFingers.toFixed(2) },
    { id: 'owned-right-fingers', value: arms.owned.rightFingers.toFixed(2) },
    { id: 'penetration-left', value: arms.penetration.left.toFixed(4) },
    { id: 'penetration-right', value: arms.penetration.right.toFixed(4) },
    { id: 'cloth-contact-left', value: arms.clothContact.left.toFixed(4) },
    { id: 'cloth-contact-right', value: arms.clothContact.right.toFixed(4) },
    { id: 'hang', value: `${arms.hangDeg.toFixed(1)} deg` },
    { id: 'hand-below-hip', value: t(`${prefix}.${arms.handBelowHip ? 'yes' : 'no'}`) },
  ].map(row => ({ ...row, label: t(`${prefix}.rows.${row.id}`) }))
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:hand-shake-bold-duotone"
    inner-class="gap-4"
  >
    <ReadoutGrid data-testid="mmd-arms" :rows="rows" :empty="t(`${prefix}.empty`)" />
  </Section>
</template>
