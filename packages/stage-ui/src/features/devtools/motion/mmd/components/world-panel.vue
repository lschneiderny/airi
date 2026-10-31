<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.world'

const { t } = useI18n()
const { snapshot } = storeToRefs(useMMDMotionDiagnostics())

const rows = computed(() => {
  const world = snapshot.value.world
  if (!world)
    return []
  const placement = snapshot.value.characterPlacement
  const model = snapshot.value.stageModel
  return [
    { id: 'units-per-dip', value: world.unitsPerDip.toFixed(5) },
    { id: 'floor-row', value: `${world.floorRowDip.toFixed(1)} DIP` },
    { id: 'ground', value: `${world.ground.minX.toFixed(2)} .. ${world.ground.maxX.toFixed(2)}` },
    { id: 'home-x', value: world.homeX.toFixed(3) },
    { id: 'character-height', value: `${world.characterHeightDip.toFixed(1)} DIP` },
    { id: 'model-height', value: model ? `${model.height.toFixed(3)} / ${model.footBaselineY.toFixed(3)}` : '-' },
    { id: 'placement', value: placement ? `${placement.x.toFixed(1)}, ${placement.y.toFixed(1)} ${placement.width.toFixed(1)} x ${placement.height.toFixed(1)}` : '-' },
  ].map(row => ({ ...row, label: t(`${prefix}.rows.${row.id}`) }))
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:planet-bold-duotone"
    inner-class="gap-4"
  >
    <ReadoutGrid data-testid="mmd-world" :rows="rows" :empty="t(`${prefix}.empty`)" />
  </Section>
</template>
