<script setup lang="ts">
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.rig'

const { t } = useI18n()
const { snapshot } = storeToRefs(useMMDMotionDiagnostics())

const list = (names: readonly string[]) => names.length ? names.join(', ') : '-'
const number = (value: number | null, digits: number) => value === null ? '-' : value.toFixed(digits)

const bones = computed(() => {
  const rig = snapshot.value.rig
  return rig ? Object.entries(rig.bones).map(([humanoid, name]) => ({ humanoid, name: name ?? '-' })) : []
})

const rows = computed(() => {
  const rig = snapshot.value.rig
  if (!rig)
    return []
  const chain = (side: 'left' | 'right') => {
    const leg = rig.legIk[side]
    return leg ? `${leg.ikBone} -> ${leg.target}${leg.knee ? ` (${leg.knee})` : ''}` : '-'
  }
  return [
    { id: 'missing', value: list(rig.missingBones) },
    { id: 'physics-owned', value: list(rig.physicsOwnedHumanoid) },
    { id: 'center', value: `${rig.hipsTranslation.center ?? '-'} / ${rig.hipsTranslation.groove ?? '-'}` },
    { id: 'leg-ik-left', value: chain('left') },
    { id: 'leg-ik-right', value: chain('right') },
    { id: 'toe-ik', value: `${rig.toeIk.left ?? '-'} / ${rig.toeIk.right ?? '-'}` },
    { id: 'knee', value: `${rig.kneeBendSign > 0 ? '+1' : '-1'} (${rig.kneeBendSource})` },
    { id: 'leg-length', value: number(rig.legLength, 3) },
    { id: 'foot-baseline', value: number(rig.footBaselineY, 3) },
    { id: 'rest-arm', value: rig.restArmAngle === null ? '-' : `${(rig.restArmAngle * 180 / Math.PI).toFixed(1)} deg` },
    { id: 'eyes', value: rig.eyeSource },
    { id: 'waist-cancel', value: t(`${prefix}.${rig.waistCancel ? 'yes' : 'no'}`) },
  ].map(row => ({ ...row, label: t(`${prefix}.rows.${row.id}`) }))
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:structure-bold-duotone"
    inner-class="gap-4"
  >
    <ReadoutGrid data-testid="mmd-rig" :rows="rows" :empty="t(`${prefix}.empty`)" />
    <table v-if="bones.length" data-testid="mmd-rig-bones" :class="['w-full text-left text-xs']">
      <thead>
        <tr :class="['text-neutral-500 dark:text-neutral-400']">
          <th :class="['py-1 font-medium']">
            {{ t(`${prefix}.columns.humanoid`) }}
          </th>
          <th :class="['py-1 font-medium']">
            {{ t(`${prefix}.columns.bone`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="bone in bones" :key="bone.humanoid" :class="['border-t border-neutral-200 dark:border-neutral-700']">
          <td :class="['py-1 font-mono']">
            {{ bone.humanoid }}
          </td>
          <td :class="['py-1 font-mono']">
            {{ bone.name }}
          </td>
        </tr>
      </tbody>
    </table>
  </Section>
</template>
