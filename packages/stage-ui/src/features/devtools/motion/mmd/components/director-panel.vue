<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { Button, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.director'

const { t } = useI18n()
const diagnostics = useMMDMotionDiagnostics()
const { snapshot } = storeToRefs(diagnostics)

const debugAdvanceMs = ref('60000')
const advanceMs = computed(() => {
  const value = Number(debugAdvanceMs.value)
  return Number.isFinite(value) && value > 0 ? value : null
})

function advance() {
  if (advanceMs.value !== null)
    diagnostics.command({ type: 'command', name: 'advanceDirectorClock', value: advanceMs.value })
}

const rows = computed(() => {
  const director = snapshot.value.director
  if (!director)
    return []
  return [
    { id: 'stance', value: director.stance },
    { id: 'since', value: `${(director.sinceMs / 1000).toFixed(1)} s` },
    { id: 'reason', value: director.reason },
    { id: 'clock-offset', value: `${(director.clockOffsetMs / 1000).toFixed(1)} s` },
    { id: 'center-y', value: director.centerY === null ? '-' : director.centerY.toFixed(3) },
  ].map(row => ({ ...row, label: t(`${prefix}.rows.${row.id}`) }))
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:clock-circle-bold-duotone"
    inner-class="gap-4"
  >
    <ReadoutGrid data-testid="mmd-director" :rows="rows" :empty="t(`${prefix}.empty`)" />
    <div :class="['flex items-end gap-3']">
      <FieldInput
        v-model="debugAdvanceMs"
        data-testid="mmd-director-advance-ms"
        type="number"
        inputmode="numeric"
        :class="['flex-1']"
        :label="t(`${prefix}.advance.title`)"
        :description="t(`${prefix}.advance.description`)"
      />
      <Button
        data-testid="mmd-director-advance"
        size="sm"
        variant="secondary"
        icon="i-solar:forward-bold-duotone"
        :label="t(`${prefix}.advance.button`)"
        :disabled="advanceMs === null"
        @click="advance"
      />
    </div>
  </Section>
</template>
