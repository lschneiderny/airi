<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.body'

const { t } = useI18n()
const { snapshot } = storeToRefs(useMMDMotionDiagnostics())

const degrees = (radians: number) => `${(radians * 180 / Math.PI).toFixed(1)} deg`
const point = (value: { x: number, y: number, z: number } | null) => value ? `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)}` : '-'

const lookAtRows = computed(() => {
  const lookAt = snapshot.value.lookAt
  if (!lookAt)
    return []
  return [
    { id: 'target', value: point(lookAt.target) },
    { id: 'yaw', value: degrees(lookAt.yaw) },
    { id: 'pitch', value: degrees(lookAt.pitch) },
    { id: 'turning', value: t(`${prefix}.look-at.${lookAt.turning ? 'turning' : 'settled'}`) },
    { id: 'turns', value: String(lookAt.turns) },
  ].map(row => ({ ...row, label: t(`${prefix}.look-at.rows.${row.id}`) }))
})

const feetRows = computed(() => {
  const feet = snapshot.value.feet
  if (!feet)
    return []
  return [
    { id: 'max-error', value: feet.maxError.toFixed(4) },
    { id: 'error-left', value: feet.errorL.toFixed(4) },
    { id: 'error-right', value: feet.errorR.toFixed(4) },
    { id: 'contact', value: feet.contact.toFixed(2) },
  ].map(row => ({ ...row, label: t(`${prefix}.feet.rows.${row.id}`) }))
})

const touchRows = computed(() => {
  const touch = snapshot.value.touch
  if (!touch)
    return []
  return [
    { id: 'last-region', value: touch.lastRegion ?? '-' },
    { id: 'hit-body', value: t(`${prefix}.touch.${touch.hitBody ? 'yes' : 'no'}`) },
    { id: 'pet-active', value: t(`${prefix}.touch.${touch.petActive ? 'yes' : 'no'}`) },
    { id: 'head-screen-point', value: touch.headScreenPoint ? `${Math.round(touch.headScreenPoint.x)}, ${Math.round(touch.headScreenPoint.y)}` : '-' },
    { id: 'events', value: String(touch.events) },
  ].map(row => ({ ...row, label: t(`${prefix}.touch.rows.${row.id}`) }))
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:body-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['grid gap-4 md:grid-cols-3']">
      <div :class="['grid content-start gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.look-at.title`) }}
        </div>
        <ReadoutGrid data-testid="mmd-look-at" :rows="lookAtRows" :empty="t(`${prefix}.natural-only`)" />
      </div>
      <div :class="['grid content-start gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.feet.title`) }}
        </div>
        <ReadoutGrid data-testid="mmd-feet" :rows="feetRows" :empty="t(`${prefix}.natural-only`)" />
      </div>
      <div :class="['grid content-start gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.touch.title`) }}
        </div>
        <ReadoutGrid data-testid="mmd-touch" :rows="touchRows" :empty="t(`${prefix}.touch.empty`)" />
      </div>
    </div>
  </Section>
</template>
