<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { Button, FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.locomotion'

const { t } = useI18n()
const diagnostics = useMMDMotionDiagnostics()
const { snapshot } = storeToRefs(diagnostics)

// The number field binds through `v-model.number`: a typed value arrives as a number, an empty field as ''.
const walkDip = ref<number | string>(400)
const walkOffsetDip = computed(() => {
  const raw = walkDip.value
  if (typeof raw === 'string' && raw.trim() === '')
    return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
})
const walkGoalX = computed(() => {
  const { locomotion, world } = snapshot.value
  if (!locomotion || !world || walkOffsetDip.value === null)
    return null
  return locomotion.position.x + walkOffsetDip.value * world.unitsPerDip
})

function walkHere() {
  if (walkGoalX.value !== null)
    diagnostics.command({ type: 'command', name: 'requestGoal', value: { x: walkGoalX.value, pace: 'walk' } })
}

function setHome() {
  const locomotion = snapshot.value.locomotion
  if (locomotion)
    diagnostics.command({ type: 'command', name: 'setHome', value: { x: locomotion.position.x } })
}

// Until the lab sets a mode, the director's roam mode in the snapshot shows it.
const roamsSet = ref<boolean | null>(null)
const roams = computed({
  get: () => roamsSet.value ?? snapshot.value.director?.roamMode === 'roam',
  set: (enabled: boolean) => {
    roamsSet.value = enabled
    diagnostics.command({ type: 'command', name: 'setRoamMode', value: { mode: enabled ? 'roam' : 'stay' } })
  },
})

const rows = computed(() => {
  const locomotion = snapshot.value.locomotion
  if (!locomotion)
    return []
  const director = snapshot.value.director
  const goalX = director?.goalX ?? locomotion.goalX
  return [
    { id: 'mode', value: locomotion.mode },
    { id: 'position', value: `${locomotion.position.x.toFixed(3)}, ${locomotion.position.z.toFixed(3)}` },
    { id: 'yaw', value: `${(locomotion.yaw * 180 / Math.PI).toFixed(1)} deg` },
    { id: 'goal', value: goalX === null ? '-' : goalX.toFixed(3) },
    { id: 'reason', value: director?.reason ?? locomotion.reason ?? '-' },
    { id: 'pace', value: director?.pace ?? locomotion.pace ?? '-' },
    { id: 'speed', value: locomotion.speed.toFixed(3) },
    { id: 'phase', value: locomotion.phase.toFixed(2) },
    { id: 'weight', value: locomotion.weight.toFixed(2) },
    { id: 'skate', value: locomotion.skate.toFixed(4) },
    { id: 'leash-clamps', value: String(locomotion.leashClamps) },
    { id: 'enabled', value: t(`${prefix}.${locomotion.enabled ? 'yes' : 'no'}`) },
    { id: 'pending-goal', value: director?.pendingGoal ? `${director.pendingGoal.x.toFixed(3)} (${director.pendingGoal.reason})` : '-' },
  ].map(row => ({ ...row, label: t(`${prefix}.rows.${row.id}`) }))
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:walking-round-bold-duotone"
    inner-class="gap-4"
  >
    <ReadoutGrid data-testid="mmd-locomotion" :rows="rows" :empty="t(`${prefix}.empty`)" />
    <div :class="['flex items-end gap-3']">
      <FieldInput
        v-model="walkDip"
        data-testid="mmd-locomotion-walk-dip"
        type="number"
        inputmode="numeric"
        :class="['flex-1']"
        :label="t(`${prefix}.walk.title`)"
        :description="t(`${prefix}.walk.description`)"
      />
      <Button
        data-testid="mmd-locomotion-walk"
        size="sm"
        variant="secondary"
        icon="i-solar:map-arrow-right-bold-duotone"
        :label="t(`${prefix}.walk.button`)"
        :disabled="walkGoalX === null"
        @click="walkHere"
      />
      <Button
        data-testid="mmd-locomotion-set-home"
        size="sm"
        variant="secondary"
        icon="i-solar:home-2-bold-duotone"
        :label="t(`${prefix}.set-home`)"
        :disabled="!snapshot.locomotion"
        @click="setHome"
      />
    </div>
    <FieldCheckbox
      v-model="roams"
      data-testid="mmd-locomotion-roam"
      :label="t(`${prefix}.roam.title`)"
      :description="t(`${prefix}.roam.description`)"
    />
  </Section>
</template>
