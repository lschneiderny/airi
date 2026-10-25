<script setup lang="ts">
import type { Live2DModelCanvasRect } from '@proj-airi/stage-ui-live2d/composables/live2d'

import { live2DTouchDebugColors } from '@proj-airi/stage-ui-live2d/composables/live2d/touch-debug'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { Button, FieldCheckbox } from '@proj-airi/ui'
import { useClipboard } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.live2d-natural-motion.touch-regions'

const { t } = useI18n()
const diagnostics = useNaturalMotionDiagnostics()
const { touchOverlayEnabled, touchOverlaySnapshot: snapshot } = storeToRefs(diagnostics)
const { copy, copied } = useClipboard({ legacy: true })

const enabled = computed({
  get: () => touchOverlayEnabled.value,
  set: (value: boolean) => diagnostics.setTouchOverlay(value),
})

const legend = computed(() => ([
  ['touch', live2DTouchDebugColors.touch, 'solid'],
  ['zone', live2DTouchDebugColors.zone, 'dashed'],
  ['cursor-unit', live2DTouchDebugColors.cursorUnit, 'dotted'],
  ['body', live2DTouchDebugColors.body, 'solid'],
  ['eye-anchor', live2DTouchDebugColors.eyeAnchor, 'solid'],
  ['pointer', live2DTouchDebugColors.pointer, 'solid'],
  ['host-cursor', live2DTouchDebugColors.hostCursor, 'solid'],
  ['trail-in-head', live2DTouchDebugColors.trailInHead, 'solid'],
  ['trail-in-zone', live2DTouchDebugColors.trailInZone, 'solid'],
] as const).map(([id, color, style]) => ({ id, color, style, label: t(`${prefix}.legend.${id}`) })))

const boxRows = computed(() => {
  const current = snapshot.value
  if (!current)
    return []
  return (['touch', 'zone', 'cursorUnit', 'body'] as const).map(id => ({
    id,
    label: t(`${prefix}.boxes.${id}`),
    model: current.model[id],
    viewport: current.viewport[id],
  }))
})

const drawables = computed(() => {
  const counts = snapshot.value?.drawables
  if (!counts)
    return '-'
  const parts = (['face', 'eyes', 'physics'] as const)
    .filter(measure => counts[measure] !== undefined)
    .map(measure => `${t(`${prefix}.measures.${measure}`)} ${counts[measure]}`)
  return parts.length ? parts.join(', ') : '-'
})

/** Pet start checks against their thresholds; reversals apply only without a held button. */
const petChecks = computed(() => {
  const current = snapshot.value
  if (!current)
    return []
  const { gesture, thresholds } = current
  const checks = [
    {
      id: 'in-head',
      value: gesture.inHeadShare === null ? '-' : `${Math.round(gesture.inHeadShare * 100)}%`,
      target: `${Math.round(thresholds.inHeadShare * 100)}%`,
      pass: gesture.inHeadShare !== null && gesture.inHeadShare >= thresholds.inHeadShare,
    },
    {
      id: 'travel',
      value: gesture.travel.toFixed(2),
      target: thresholds.travel.toFixed(2),
      pass: gesture.travel >= thresholds.travel,
    },
  ]
  if (!gesture.requireHold) {
    checks.push({
      id: 'reversals',
      value: String(gesture.reversals),
      target: String(thresholds.reversals),
      pass: gesture.reversals >= thresholds.reversals,
    })
  }
  return checks.map(check => ({ ...check, label: t(`${prefix}.pet.${check.id}`) }))
})

function formatRect(rect: Live2DModelCanvasRect | null) {
  if (!rect)
    return '-'
  return `${Math.round(rect.x)}, ${Math.round(rect.y)} (${Math.round(rect.width)} x ${Math.round(rect.height)})`
}

function copySnapshot() {
  if (snapshot.value)
    void copy(JSON.stringify(snapshot.value, null, 2))
}
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:hand-shake-bold-duotone"
    inner-class="gap-4"
  >
    <FieldCheckbox
      v-model="enabled"
      data-testid="touch-overlay-enabled"
      :label="t(`${prefix}.enabled.title`)"
      :description="t(`${prefix}.enabled.description`)"
    />

    <ul :class="['flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300']">
      <li v-for="item in legend" :key="item.id" :class="['flex items-center gap-1.5']">
        <span
          :class="['inline-block h-0 w-4 border-t-2']"
          :style="{ borderColor: item.color, borderTopStyle: item.style }"
        />
        {{ item.label }}
      </li>
    </ul>

    <div
      v-if="enabled && !snapshot"
      data-testid="touch-overlay-waiting"
      :class="['text-sm text-neutral-500 dark:text-neutral-400']"
    >
      {{ t(`${prefix}.waiting`) }}
    </div>

    <div v-if="snapshot" data-testid="touch-overlay-readout" :class="['flex flex-col gap-3 text-sm']">
      <div :class="['flex flex-wrap items-center gap-x-4 gap-y-1']">
        <span>
          {{ t(`${prefix}.source.title`) }}
          <span data-testid="touch-overlay-source" :class="['font-semibold']">
            {{ snapshot.source ? t(`${prefix}.source.${snapshot.source}`) : t(`${prefix}.source.none`) }}
          </span>
        </span>
        <span>
          {{ t(`${prefix}.drawables`) }}
          <span :class="['font-mono']">{{ drawables }}</span>
        </span>
        <span>
          {{ t(`${prefix}.head-scale`) }}
          <span :class="['font-mono']">{{ snapshot.headScale.toFixed(2) }}x</span>
        </span>
        <span v-if="snapshot.modelId" :class="['font-mono text-xs text-neutral-500 dark:text-neutral-400']">{{ snapshot.modelId }}</span>
      </div>

      <div :class="['overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800']">
        <table :class="['w-full text-left text-xs']">
          <thead :class="['bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300']">
            <tr>
              <th :class="['px-3 py-2 font-medium']">
                {{ t(`${prefix}.boxes.columns.box`) }}
              </th>
              <th :class="['px-3 py-2 font-medium']">
                {{ t(`${prefix}.boxes.columns.model`) }}
              </th>
              <th :class="['px-3 py-2 font-medium']">
                {{ t(`${prefix}.boxes.columns.viewport`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in boxRows"
              :key="row.id"
              :data-box="row.id"
              :class="['border-t border-neutral-200 dark:border-neutral-800']"
            >
              <td :class="['px-3 py-1.5']">
                {{ row.label }}
              </td>
              <td :class="['px-3 py-1.5 font-mono']">
                {{ formatRect(row.model) }}
              </td>
              <td :class="['px-3 py-1.5 font-mono']">
                {{ formatRect(row.viewport) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div :class="['flex flex-wrap items-center gap-x-4 gap-y-1']">
        <span>
          {{ t(`${prefix}.pointer.title`) }}
          <span data-testid="touch-overlay-pointer-region" :class="['font-semibold']">
            {{ snapshot.pointer ? t(`${prefix}.pointer.regions.${snapshot.pointer.region ?? 'outside'}`) : t(`${prefix}.pointer.none`) }}
          </span>
        </span>
        <span v-if="snapshot.pointer" :class="['font-mono text-xs']">
          {{ t(`${prefix}.pointer.age`, { ms: Math.round(snapshot.pointer.ageMs) }) }}
        </span>
      </div>

      <div :class="['flex flex-col gap-1']">
        <div>
          {{ t(`${prefix}.pet.title`) }}
          <span data-testid="touch-overlay-pet-state" :class="['font-semibold']">
            {{ snapshot.gesture.petting ? t(`${prefix}.pet.petting`) : snapshot.gesture.inZone ? t(`${prefix}.pet.in-zone`) : t(`${prefix}.pet.idle`) }}
          </span>
        </div>
        <ul :class="['flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs']">
          <li
            v-for="check in petChecks"
            :key="check.id"
            :data-pet-check="check.id"
            :class="[check.pass ? 'text-green-600 dark:text-green-400' : 'text-neutral-600 dark:text-neutral-300']"
          >
            {{ check.label }} {{ check.value }} / {{ check.target }}
          </li>
          <li v-if="snapshot.gesture.requireHold" :class="['text-neutral-500 dark:text-neutral-400']">
            {{ t(`${prefix}.pet.hold-only`) }}
          </li>
          <li v-if="snapshot.gesture.idleMs !== null">
            {{ t(`${prefix}.pet.idle-timer`, { ms: Math.round(snapshot.gesture.idleMs), limit: snapshot.thresholds.idleMs }) }}
          </li>
          <li v-if="snapshot.gesture.offHeadMs !== null">
            {{ t(`${prefix}.pet.leave-timer`, { ms: Math.round(snapshot.gesture.offHeadMs), limit: snapshot.thresholds.leaveMs }) }}
          </li>
        </ul>
      </div>

      <div :class="['flex flex-wrap items-center gap-2']">
        <Button
          data-testid="touch-overlay-copy"
          size="sm"
          icon="i-solar:copy-bold-duotone"
          :label="copied ? t(`${prefix}.copied`) : t(`${prefix}.copy`)"
          @click="copySnapshot()"
        />
      </div>
    </div>
  </Section>
</template>
