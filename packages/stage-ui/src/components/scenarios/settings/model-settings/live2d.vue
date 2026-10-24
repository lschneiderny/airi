<script setup lang="ts">
import type { ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type {
  Live2DExpressionSettingsCommand,
  Live2DExpressionSettingsSnapshot,
  Live2DMotionDriver,
} from '@proj-airi/stage-ui-live2d'
import type { SelectTabOption } from '@proj-airi/ui'

import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { defaultModelParameters, useExpressionStore, useLive2dParams, useSettingsLive2d } from '@proj-airi/stage-ui-live2d'
import { OPFSCache } from '@proj-airi/stage-ui-live2d/utils/opfs-loader'
import { Button, Checkbox, Collapsible, FieldCheckbox, FieldCombobox, FieldRange, Input, SelectTab } from '@proj-airi/ui'
import { omit } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import MagicMotionSettings from '../../../../features/motions/live2d/components/magic-settings.vue'
import Live2dExpressionEntry from './live2d-expression-entry.vue'
import Live2dExpressionGroupRow from './live2d-expression-group-row.vue'

import { useExpressionPerformanceSettings } from '../../../../features/performance/settings'
import { useSettingsStageModel } from '../../../../stores/settings/stage-model'
import { PropertyPoint } from '../../../data-pane'
import { Section } from '../../../layouts'
import { ColorPalette } from '../../../widgets'
import { groupDisplayName } from './expression-group-name'

const props = withDefaults(defineProps<{
  palette: string[]
  allowExtractColors?: boolean
  runtimeSnapshot: ModelSettingsRuntimeSnapshot
}>(), {
  allowExtractColors: true,
})
const emit = defineEmits<{
  (e: 'extractColorsFromModel'): void
  (e: 'live2dExpressionCommand', command: Live2DExpressionSettingsCommand): void
}>()

const { t } = useI18n()

const settings = useSettingsLive2d()
const {
  live2dMotionDriver,
  live2dEyeTracking,
  live2dNaturalCursorAttention,
  live2dNaturalTouch,
  live2dNaturalTouchPetRequiresHold,
  live2dNaturalTouchHeadScale,
  live2dNaturalEmotionStrength,
  live2dNaturalEnergy,
  live2dModelEyeOffset,
  live2dIdleAnimationEnabled,
  live2dAutoBlinkEnabled,
  live2dForceAutoBlinkEnabled,
  live2dExpressionEnabled,
  live2dShadowEnabled,
  live2dMaxFps,
  live2dRenderScale,
  live2dForceIdleEyeAnimation,
} = storeToRefs(settings)

const motionDriverOptions = computed<SelectTabOption<Live2DMotionDriver>[]>(() => [
  {
    value: 'universal',
    label: t('settings.live2d.animation.motion-driver.options.universal.title'),
    description: t('settings.live2d.animation.motion-driver.options.universal.description'),
  },
  {
    value: 'natural',
    label: t('settings.live2d.animation.motion-driver.options.natural.title'),
    description: t('settings.live2d.animation.motion-driver.options.natural.description'),
  },
  {
    value: 'magic',
    label: t('settings.live2d.animation.motion-driver.options.magic.title'),
    description: t('settings.live2d.animation.motion-driver.options.magic.description'),
  },
])

const live2d = useLive2dParams()
const {
  scale,
  position,
  modelParameters,
  currentMotion,
} = storeToRefs(live2d)

const expressionStore = useExpressionStore()
const expressionSettingsSnapshot = computed(() => props.runtimeSnapshot.live2dExpressions ?? expressionStore.settingsSnapshot)
const usesRemoteExpressionRuntime = computed(() => props.runtimeSnapshot.live2dExpressions != null)

function applyExpressionSettingsCommand(command: Live2DExpressionSettingsCommand) {
  if (usesRemoteExpressionRuntime.value) {
    emit('live2dExpressionCommand', command)
    return
  }

  expressionStore.applySettingsCommand(command)
}

const expressionGroups = computed(() => {
  const groups = new Map<string, string[]>()
  for (const entry of expressionSettingsSnapshot.value.groups) {
    if (entry.group)
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry.label])
  }
  return [...groups].map(([name, labels]) => ({ name, labels }))
})

type ExpressionSnapshotEntry = Live2DExpressionSettingsSnapshot['groups'][number]
type ExpressionRow
  = | { type: 'group', group: string, members: ExpressionSnapshotEntry[] }
    | { type: 'entry', entry: ExpressionSnapshotEntry }

/** One row per group at its first member's position, and one row per ungrouped entry, in catalog order. */
const expressionRows = computed<ExpressionRow[]>(() => {
  const entries = expressionSettingsSnapshot.value.groups
  const seen = new Set<string>()
  const rows: ExpressionRow[] = []
  for (const entry of entries) {
    if (!entry.group) {
      rows.push({ type: 'entry', entry })
      continue
    }
    if (seen.has(entry.group))
      continue
    seen.add(entry.group)
    rows.push({ type: 'group', group: entry.group, members: entries.filter(member => member.group === entry.group) })
  }
  return rows
})

function expressionRowInUse(row: ExpressionRow) {
  if (row.type === 'group')
    return true
  if (row.entry.kind === 'system')
    return row.entry.active
  return row.entry.active || row.entry.mappings.length > 0
}

function expressionRowKey(row: ExpressionRow) {
  return row.type === 'group' ? `group:${row.group}` : row.entry.id
}

const showAllExpressions = ref(false)
const expressionSearch = ref('')
const expressionSearchActive = computed(() => expressionSearch.value.trim() !== '')
const inUseExpressionRows = computed(() => expressionRows.value.filter(expressionRowInUse))
const hiddenExpressionRowCount = computed(() => expressionRows.value.length - inUseExpressionRows.value.length)
const visibleExpressionRows = computed(() => {
  if (expressionSearchActive.value) {
    const query = expressionSearch.value.trim().toLowerCase()
    const matches = (text: string) => text.toLowerCase().includes(query)
    return expressionRows.value.filter(row => row.type === 'group'
      ? matches(groupDisplayName(row.members.map(member => member.label))) || row.members.some(member => matches(member.label))
      : matches(row.entry.label))
  }
  return showAllExpressions.value ? expressionRows.value : inUseExpressionRows.value
})
const performanceSettings = useExpressionPerformanceSettings()
const deciderOptions = computed<SelectTabOption<ExpressionPerformanceSettings['decider']>[]>(() => [
  {
    value: 'picker',
    label: t('settings.live2d.performance.decider.options.picker.title'),
    description: t('settings.live2d.performance.decider.options.picker.description'),
  },
  {
    value: 'planner',
    label: t('settings.live2d.performance.decider.options.planner.title'),
    description: t('settings.live2d.performance.decider.options.planner.description'),
  },
])
// `update` is a leader-routed synced action, so callers await it instead of dropping the promise.
async function updatePerformanceSettings(patch: Parameters<typeof performanceSettings.update>[0]) {
  await performanceSettings.update(patch)
}

const selectedRuntimeMotion = ref<string>('')
const runtimeMotions = ref<Array<{ name: string, displayPath: string, group: string, index: number }>>([])
const canExtractColors = computed(() => props.runtimeSnapshot.canCapturePreview)
const runtimeMotionOptions = computed(() => {
  const options = runtimeMotions.value.map(motion => ({
    label: motion.name,
    value: motion.displayPath,
    description: motion.displayPath,
  }))
  if (options.length > 0) {
    options.unshift({
      label: t('settings.live2d.animation.idle-motion.disable-motion'),
      value: '<motion disabled>',
      description: t('settings.live2d.animation.idle-motion.disable-motion-description'),
    })
  }
  return options
})
const fpsOptions = computed(() => [
  { value: 30, label: '30' },
  { value: 60, label: '60' },
  { value: 0, label: t('settings.live2d.parameters.fps.options.unlimited') },
])
const blinkModeOptions = computed(() => [
  {
    value: 'auto',
    label: t('settings.live2d.animation.auto-blink.title'),
    description: t('settings.live2d.animation.auto-blink.description'),
  },
  {
    value: 'force',
    label: t('settings.live2d.animation.force-auto-blink.title'),
    description: t('settings.live2d.animation.force-auto-blink.description'),
  },
])
const live2dBlinkMode = computed<'auto' | 'force'>({
  get() {
    return live2dForceAutoBlinkEnabled.value ? 'force' : 'auto'
  },
  set(mode) {
    live2dAutoBlinkEnabled.value = true
    live2dForceAutoBlinkEnabled.value = mode === 'force'
  },
})

const { stageModelSelected } = storeToRefs(useSettingsStageModel())
/** The head area adjustment of the selected stage model; the stage keys it by the same id. */
const naturalTouchHeadScale = computed({
  get: () => live2dNaturalTouchHeadScale.value[stageModelSelected.value] ?? 1,
  set: (value: number) => {
    live2dNaturalTouchHeadScale.value = { ...live2dNaturalTouchHeadScale.value, [stageModelSelected.value]: value }
  },
})

function formatScale(value: number) {
  return `${value.toFixed(2)}×`
}

/** Neutral is never performed as an emotion, so it has no strength. */
const naturalEmotionStrengthEmotions: Exclude<PerformanceEmotion, 'neutral'>[] = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']
const naturalEmotionStrengthDefault = 1

function naturalEmotionStrength(emotion: PerformanceEmotion) {
  return live2dNaturalEmotionStrength.value[stageModelSelected.value]?.[emotion] ?? naturalEmotionStrengthDefault
}

/** Writes replace the record, like the head scale, so the stage sees a new identity per change. */
function setNaturalEmotionStrength(emotion: PerformanceEmotion, value: number) {
  const modelId = stageModelSelected.value
  live2dNaturalEmotionStrength.value = {
    ...live2dNaturalEmotionStrength.value,
    [modelId]: { ...live2dNaturalEmotionStrength.value[modelId], [emotion]: value },
  }
}

const naturalEmotionStrengthCustomized = computed(() => stageModelSelected.value in live2dNaturalEmotionStrength.value)

function resetNaturalEmotionStrength() {
  live2dNaturalEmotionStrength.value = omit(live2dNaturalEmotionStrength.value, [stageModelSelected.value])
}

function formatNaturalEnergy(value: number) {
  return `${Math.round(value * 100)}%`
}

watch(() => live2d.availableMotions, (motions) => {
  runtimeMotions.value = motions.map(m => ({
    name: m.fileName.split('/').pop() || m.fileName,
    displayPath: m.fileName,
    group: m.motionName,
    index: m.motionIndex,
  }))

  console.info('Available motions:', runtimeMotions.value)
}, { immediate: true })

// Get available runtime motions from the model
onMounted(() => {
  // Restore selected motion
  const savedPath = localStorage.getItem('selected-runtime-motion')
  if (savedPath) {
    selectedRuntimeMotion.value = savedPath
  }
})

// Function to reset all parameters to default values
function resetToDefaultParameters() {
  modelParameters.value = { ...defaultModelParameters }
}

const clearingCache = ref(false)

async function clearModelCache() {
  clearingCache.value = true
  try {
    await OPFSCache.clearAll()
  }
  finally {
    clearingCache.value = false
  }
}

function handleMotionSelect(selectedMotionPath: string | number | undefined) {
  if (typeof selectedMotionPath !== 'string') {
    return
  }

  const motion = runtimeMotions.value.find(item => item.displayPath === selectedMotionPath)
  if (!motion) {
    live2dIdleAnimationEnabled.value = false
    return
  }

  localStorage.setItem('selected-runtime-motion', motion.displayPath)
  localStorage.setItem('selected-runtime-motion-group', motion.group)
  localStorage.setItem('selected-runtime-motion-index', motion.index.toString())

  // Enable idle animation
  live2dIdleAnimationEnabled.value = true

  // Set the current motion to the selected runtime motion
  currentMotion.value = { group: motion.group, index: motion.index }

  console.info('Selected runtime motion:', motion.name)
  console.info('Full path:', motion.displayPath)
  console.info('Group:', motion.group, 'Index:', motion.index)
}

// async function patchMotionMap(source: File, motionMap: Record<string, string>): Promise<File> {
//   if (!Object.keys(motionMap).length)
//     return source

//   const jsZip = new JSZip()
//   const zip = await jsZip.loadAsync(source)
//   const fileName = Object.keys(zip.files).find(key => key.endsWith('model3.json'))
//   if (!fileName) {
//     throw new Error('model3.json not found')
//   }

//   const model3Json = await zip.file(fileName)!.async('string')
//   const model3JsonObject = JSON.parse(model3Json)

//   const motions: Record<string, { File: string }[]> = {}
//   Object.entries(motionMap).forEach(([key, value]) => {
//     if (motions[value]) {
//       motions[value].push({ File: key })
//       return
//     }
//     motions[value] = [{ File: key }]
//   })

//   model3JsonObject.FileReferences.Motions = motions

//   zip.file(fileName, JSON.stringify(model3JsonObject, null, 2))
//   const zipBlob = await zip.generateAsync({ type: 'blob' })

//   return new File([zipBlob], source.name, {
//     type: source.type,
//     lastModified: source.lastModified,
//   })
// }

// async function saveMotionMap() {
//   const fileFromIndexedDB = await localforage.getItem<File>('live2dModel')
//   if (!fileFromIndexedDB) {
//     return
//   }

//   const patchedFile = await patchMotionMap(fileFromIndexedDB, motionMap.value)
//   modelFile.value = patchedFile
// }
</script>

<template>
  <Section
    :title="t('settings.live2d.scale-and-position.title')"
    icon="i-solar:scale-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <FieldRange v-model="scale" as="div" :min="0.1" :max="3" :step="0.01" :label="t('settings.live2d.scale-and-position.scale')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.scale-and-position.scale') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => scale = 1">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="position.x" as="div" :min="-3000" :max="3000" :step="1" :label="t('settings.live2d.scale-and-position.x')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.scale-and-position.x') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => position.x = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="position.y" as="div" :min="-3000" :max="3000" :step="1" :label="t('settings.live2d.scale-and-position.y')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.scale-and-position.y') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => position.y = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
  </Section>
  <Section
    v-if="allowExtractColors"
    :title="t('settings.live2d.theme-color-from-model.title')"
    icon="i-solar:magic-stick-3-bold-duotone"
    inner-class="text-sm"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <p text="neutral-500 dark:neutral-400">
      {{ t('settings.live2d.theme-color-from-model.description') }}
    </p>
    <ColorPalette class="mb-4 mt-2" :colors="palette.map(hex => ({ hex, name: hex }))" mx-auto />
    <Button :disabled="!canExtractColors" @click="$emit('extractColorsFromModel')">
      {{ t('settings.live2d.theme-color-from-model.button-extract.title') }}
    </Button>
  </Section>
  <!-- <Section
    v-if="modelFile"
    :title="t('settings.live2d.edit-motion-map.title')"
    icon="i-solar:face-scan-circle-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <div v-for="motion in availableMotions" :key="motion.fileName" flex items-center justify-between text-sm>
      <span font-medium font-mono>{{ motion.fileName }}</span>

      <div flex gap-2>
        <select v-model="motionMap[motion.fileName]">
          <option v-for="emotion in Object.keys(Emotion)" :key="emotion">
            {{ emotion }}
          </option>
        </select>

        <Button
          class="form-control"
          @click="currentMotion = { group: motion.motionName, index: motion.motionIndex }"
        >
          Play
        </Button>
      </div>
    </div>
    <Button @click="saveMotionMap">
      Save and patch
    </Button>
    <a
      mt-2 block :href="exportObjectUrl"
      :download="`${modelFile?.name || 'live2d'}-motion-edited.zip`"
    >
      <Button w-full>Export</button>
    </a>
  </Section> -->
  <Section
    :title="t('settings.live2d.animation.title')"
    icon="i-solar:settings-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <label :class="['flex flex-wrap gap-4']">
      <div :class="['min-w-0 flex-1 basis-full sm:basis-auto']">
        <div :class="['flex items-center gap-1 text-sm font-medium']">
          {{ t('settings.live2d.animation.motion-driver.title') }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.animation.motion-driver.description') }}
        </div>
      </div>
      <SelectTab
        v-model="live2dMotionDriver"
        :options="motionDriverOptions"
        size="sm"
        :class="['shrink-0']"
      />
    </label>
    <MagicMotionSettings v-if="live2dMotionDriver === 'magic'" />
    <FieldRange
      v-if="live2dMotionDriver === 'natural'"
      v-model="live2dNaturalEnergy"
      :min="0"
      :max="1"
      :step="0.05"
      :label="t('settings.live2d.animation.natural-energy.title')"
      :description="t('settings.live2d.animation.natural-energy.description')"
      :format-value="formatNaturalEnergy"
    />
    <FieldCheckbox
      v-if="live2dMotionDriver === 'natural'"
      v-model="live2dNaturalCursorAttention"
      :label="t('settings.live2d.animation.natural-cursor-attention.title')"
      :description="t('settings.live2d.animation.natural-cursor-attention.description')"
      placement="right"
    />
    <FieldCheckbox
      v-if="live2dMotionDriver === 'natural'"
      v-model="live2dNaturalTouch"
      :label="t('settings.live2d.animation.natural-touch.title')"
      :description="t('settings.live2d.animation.natural-touch.description')"
      placement="right"
    />
    <FieldCheckbox
      v-if="live2dMotionDriver === 'natural' && live2dNaturalTouch"
      v-model="live2dNaturalTouchPetRequiresHold"
      :label="t('settings.live2d.animation.natural-touch-pet-requires-hold.title')"
      :description="t('settings.live2d.animation.natural-touch-pet-requires-hold.description')"
      placement="right"
    />
    <FieldRange
      v-if="live2dMotionDriver === 'natural' && live2dNaturalTouch"
      v-model="naturalTouchHeadScale"
      :min="0.5"
      :max="2"
      :step="0.05"
      :label="t('settings.live2d.animation.natural-touch-head-scale.title')"
      :description="t('settings.live2d.animation.natural-touch-head-scale.description')"
      :format-value="formatScale"
    />
    <FieldCheckbox
      v-if="live2dMotionDriver !== 'natural'"
      v-model="live2dEyeTracking"
      :label="t('settings.live2d.animation.focus.title')"
      :description="t('settings.live2d.animation.focus.description')"
      :disabled="live2dMotionDriver === 'magic'"
      placement="right"
    />
    <Collapsible v-if="live2dMotionDriver === 'natural'">
      <template #trigger="slotProps">
        <button
          type="button"
          :class="['w-full flex items-center gap-2 text-left']"
          :aria-expanded="slotProps.visible"
          @click="slotProps.setVisible(!slotProps.visible)"
        >
          <div :class="['flex-1']">
            <div :class="['flex items-center gap-1 text-sm font-medium']">
              {{ t('settings.live2d.animation.natural-emotion-strength.title') }}
            </div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.live2d.animation.natural-emotion-strength.description') }}
            </div>
          </div>
          <div
            :class="[
              'i-solar:alt-arrow-down-linear',
              'shrink-0 text-neutral-500 dark:text-neutral-400',
              'transition-transform duration-250',
              slotProps.visible ? 'rotate-180' : '',
            ]"
          />
        </button>
      </template>
      <div :class="['mt-4 flex flex-col gap-4']">
        <FieldRange
          v-for="emotion in naturalEmotionStrengthEmotions"
          :key="emotion"
          :model-value="naturalEmotionStrength(emotion)"
          :min="0"
          :max="2"
          :step="0.05"
          :label="t(`settings.live2d.expressions.emotions.${emotion}`)"
          :format-value="formatScale"
          @update:model-value="setNaturalEmotionStrength(emotion, $event)"
        />
        <Button
          :class="['w-full']"
          :disabled="!naturalEmotionStrengthCustomized"
          @click="resetNaturalEmotionStrength"
        >
          {{ t('settings.live2d.animation.natural-emotion-strength.reset') }}
        </Button>
      </div>
    </Collapsible>
    <div v-if="(live2dMotionDriver === 'universal' && live2dEyeTracking) || (live2dMotionDriver === 'natural' && live2dNaturalCursorAttention)" :class="['grid grid-cols-4']">
      <PropertyPoint
        v-model:x="live2dModelEyeOffset.x"
        v-model:y="live2dModelEyeOffset.y"

        :x-config="{ min: -100, max: 100, step: 0.01, label: 'X', formatValue: (val: number) => val?.toFixed(2) }"
        :y-config="{ min: -100, max: 100, step: 0.01, label: 'Y', formatValue: (val: number) => val?.toFixed(2) }"
      >
        <template #label>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ t('settings.live2d.animation.focus.offset') }}
          </p>
        </template>
      </PropertyPoint>
    </div>
    <FieldCheckbox
      v-model="live2dForceIdleEyeAnimation"
      :label="t('settings.live2d.animation.force-idle-eye-animation.title')"
      :description="t('settings.live2d.animation.force-idle-eye-animation.description')"
      :disabled="live2dMotionDriver !== 'universal'"
      placement="right"
    />
    <FieldCheckbox
      v-model="live2dAutoBlinkEnabled"
      :label="t('settings.live2d.animation.blink-enable.title')"
      :description="t('settings.live2d.animation.blink-enable.description')"
      placement="right"
    />
    <label v-if="live2dAutoBlinkEnabled" class="flex flex-wrap gap-4">
      <div class="flex-1">
        <div class="flex items-center gap-1 text-sm font-medium">
          {{ t('settings.live2d.animation.blink-mode.title') }}
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('settings.live2d.animation.blink-mode.description') }}
        </div>
      </div>
      <SelectTab v-model="live2dBlinkMode" :options="blinkModeOptions" size="sm" :class="['shrink-0']" />
    </label>
    <FieldCombobox
      v-model="selectedRuntimeMotion"
      :label="t('settings.live2d.animation.idle-motion.title')"
      :options="runtimeMotionOptions"
      :placeholder="t('settings.live2d.animation.idle-motion.placeholder')"
      :select-class="['w-full']"
      :content-min-width="256"
      :disabled="live2dMotionDriver !== 'universal'"
      @update:model-value="handleMotionSelect"
    >
      <template #empty>
        {{ t('settings.live2d.animation.idle-motion.no-motion') }}
      </template>
    </FieldCombobox>
  </Section>
  <Section
    :title="t('settings.live2d.parameters.title')"
    icon="i-solar:settings-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <FieldRange
      v-model="live2dRenderScale"
      as="div"
      :min="0.5"
      :max="2"
      :step="0.25"
      :label="t('settings.live2d.parameters.render-scale.title')"
    />

    <label class="flex flex-wrap gap-4">
      <div class="flex-1">
        <div class="flex items-center gap-1 text-sm font-medium">
          <slot name="label">
            {{ t('settings.live2d.parameters.fps.title') }}
          </slot>
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">
          <slot name="description">
            {{ t('settings.live2d.parameters.fps.description') }}
          </slot>
        </div>
      </div>
      <SelectTab v-model="live2dMaxFps" :options="fpsOptions" size="sm" :class="['shrink-0']" />
    </label>

    <div mt-4 flex items-center justify-between>
      <span text-sm>{{ t('settings.live2d.parameters.shadow') }}</span>
      <Checkbox v-model="live2dShadowEnabled" />
    </div>

    <Button

      class="mt-4 w-full"
      @click="resetToDefaultParameters"
    >
      {{ t('settings.live2d.parameters.reset-parameters') }}
    </Button>

    <Button

      class="mt-2 w-full"
      :disabled="clearingCache"
      :loading="clearingCache"
      @click="clearModelCache"
    >
      {{ t('settings.live2d.clear-model-cache') }}
    </Button>

    <!-- Head Rotation -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      Head Rotation
    </div>
    <FieldRange v-model="modelParameters.angleX" as="div" :min="-30" :max="30" :step="0.1" label="Angle X">
      <template #label>
        <div flex items-center>
          <div>Angle X</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.angleX = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.angleY" as="div" :min="-30" :max="30" :step="0.1" label="Angle Y">
      <template #label>
        <div flex items-center>
          <div>Angle Y</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.angleY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.angleZ" as="div" :min="-30" :max="30" :step="0.1" label="Angle Z">
      <template #label>
        <div flex items-center>
          <div>Angle Z</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.angleZ = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Eyes -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      Eyes
    </div>
    <FieldRange v-model="modelParameters.leftEyeOpen" as="div" :min="0" :max="1" :step="0.01" label="Left Eye Open/Close">
      <template #label>
        <div flex items-center>
          <div>Left Eye Open/Close</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.leftEyeOpen = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.rightEyeOpen" as="div" :min="0" :max="1" :step="0.01" label="Right Eye Open/Close">
      <template #label>
        <div flex items-center>
          <div>Right Eye Open/Close</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.rightEyeOpen = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.leftEyeSmile" as="div" :min="0" :max="1" :step="0.01" label="Left Eye Smiling">
      <template #label>
        <div flex items-center>
          <div>Left Eye Smiling</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.leftEyeSmile = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.rightEyeSmile" as="div" :min="0" :max="1" :step="0.01" label="Right Eye Smiling">
      <template #label>
        <div flex items-center>
          <div>Right Eye Smiling</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.rightEyeSmile = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Eyebrows -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      Eyebrows
    </div>
    <FieldRange v-model="modelParameters.leftEyebrowLR" as="div" :min="-1" :max="1" :step="0.01" label="Left eyebrow Left/Right">
      <template #label>
        <div flex items-center>
          <div>Left eyebrow Left/Right</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.leftEyebrowLR = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.rightEyebrowLR" as="div" :min="-1" :max="1" :step="0.01" label="Right eyebrow Left/Right">
      <template #label>
        <div flex items-center>
          <div>Right eyebrow Left/Right</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.rightEyebrowLR = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.leftEyebrowY" as="div" :min="-1" :max="1" :step="0.01" label="Left Eyebrow Y (Up/Down)">
      <template #label>
        <div flex items-center>
          <div>Left Eyebrow Y</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.leftEyebrowY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.rightEyebrowY" as="div" :min="-1" :max="1" :step="0.01" label="Right Eyebrow Y (Up/Down)">
      <template #label>
        <div flex items-center>
          <div>Right Eyebrow Y</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.rightEyebrowY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.leftEyebrowAngle" as="div" :min="-1" :max="1" :step="0.01" label="Left Eyebrow Angle">
      <template #label>
        <div flex items-center>
          <div>Left Eyebrow Angle</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.leftEyebrowAngle = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.rightEyebrowAngle" as="div" :min="-1" :max="1" :step="0.01" label="Right Eyebrow Angle">
      <template #label>
        <div flex items-center>
          <div>Right Eyebrow Angle</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.rightEyebrowAngle = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.leftEyebrowForm" as="div" :min="-1" :max="1" :step="0.01" label="Left Eyebrow Form (Deformation)">
      <template #label>
        <div flex items-center>
          <div>Left Eyebrow Form</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.leftEyebrowForm = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.rightEyebrowForm" as="div" :min="-1" :max="1" :step="0.01" label="Right Eyebrow Form (Deformation)">
      <template #label>
        <div flex items-center>
          <div>Right Eyebrow Form</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.rightEyebrowForm = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Mouth -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      Mouth
    </div>
    <FieldRange v-model="modelParameters.mouthOpen" as="div" :min="0" :max="1" :step="0.01" label="Mouth Open/Close">
      <template #label>
        <div flex items-center>
          <div>Mouth Open/Close</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.mouthOpen = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.mouthForm" as="div" :min="-1" :max="1" :step="0.01" label="Mouth Form (Deformation)">
      <template #label>
        <div flex items-center>
          <div>Mouth Form</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.mouthForm = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Face -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      Face
    </div>
    <FieldRange v-model="modelParameters.cheek" as="div" :min="0" :max="1" :step="0.01" label="Cheek">
      <template #label>
        <div flex items-center>
          <div>Cheek</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.cheek = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Body -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      Body
    </div>
    <FieldRange v-model="modelParameters.bodyAngleX" as="div" :min="-10" :max="10" :step="0.1" label="Body rotation X">
      <template #label>
        <div flex items-center>
          <div>Body rotation X</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.bodyAngleX = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.bodyAngleY" as="div" :min="-10" :max="10" :step="0.1" label="Body rotation Y">
      <template #label>
        <div flex items-center>
          <div>Body rotation Y</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.bodyAngleY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.bodyAngleZ" as="div" :min="-10" :max="10" :step="0.1" label="Body rotation Z">
      <template #label>
        <div flex items-center>
          <div>Body rotation Z</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.bodyAngleZ = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="modelParameters.breath" as="div" :min="0" :max="1" :step="0.01" label="Breath">
      <template #label>
        <div flex items-center>
          <div>Breath</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => modelParameters.breath = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
  </Section>
  <Section
    :title="t('settings.live2d.expressions.title')"
    icon="i-solar:face-scan-circle-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <div flex items-center justify-between>
      <span text-sm text-neutral-600 dark:text-neutral-400>{{ t('settings.live2d.expressions.override-toggle') }}</span>
      <Checkbox v-model="live2dExpressionEnabled" />
    </div>
    <div v-if="!live2dExpressionEnabled" py-2 text-xs text-neutral-500 dark:text-neutral-400>
      {{ t('settings.live2d.expressions.sdk-preset-preserved-notice') }}
    </div>
    <template v-else-if="expressionSettingsSnapshot.groups.length === 0">
      <div py-2 text-sm text-neutral-500 dark:text-neutral-400>
        {{ t('settings.live2d.expressions.no-expression') }}
      </div>
    </template>
    <template v-else>
      <Input
        v-model="expressionSearch"
        type="search"
        :placeholder="t('settings.live2d.expressions.search')"
        :aria-label="t('settings.live2d.expressions.search')"
        :class="['mb-2']"
      />
      <div
        v-if="visibleExpressionRows.length === 0"
        :class="['py-2', 'text-sm text-neutral-500 dark:text-neutral-400']"
      >
        {{ expressionSearchActive ? t('settings.live2d.expressions.no-match') : t('settings.live2d.expressions.none-in-use') }}
      </div>
      <div v-else :class="['flex flex-col gap-2']">
        <template v-for="row in visibleExpressionRows" :key="expressionRowKey(row)">
          <Live2dExpressionGroupRow
            v-if="row.type === 'group'"
            :group="row.group"
            :members="row.members"
            :groups="expressionGroups"
            @command="applyExpressionSettingsCommand"
          />
          <Live2dExpressionEntry
            v-else
            :entry="row.entry"
            :groups="expressionGroups"
            @command="applyExpressionSettingsCommand"
          />
        </template>
      </div>
      <div v-if="!expressionSearchActive && hiddenExpressionRowCount > 0" :class="['mt-2']">
        <Button size="sm" :aria-expanded="showAllExpressions" @click="showAllExpressions = !showAllExpressions">
          {{ showAllExpressions ? t('settings.live2d.expressions.show-fewer') : t('settings.live2d.expressions.show-all', { count: hiddenExpressionRowCount }) }}
        </Button>
      </div>

      <!-- Action buttons -->
      <div :class="['mt-4', 'flex flex-wrap gap-2']">
        <Button @click="applyExpressionSettingsCommand({ type: 'save-defaults' })">
          {{ t('settings.live2d.expressions.save-default') }}
        </Button>
        <Button @click="applyExpressionSettingsCommand({ type: 'reset-all' })">
          {{ t('settings.live2d.expressions.reset') }}
        </Button>
      </div>
    </template>
  </Section>
  <Section
    :title="t('settings.live2d.performance.title')"
    icon="i-solar:magic-stick-3-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <FieldCheckbox
      :model-value="performanceSettings.document.bands"
      :label="t('settings.live2d.performance.bands.title')"
      :description="t('settings.live2d.performance.bands.description')"
      placement="right"
      @update:model-value="updatePerformanceSettings({ bands: $event })"
    />
    <FieldCheckbox
      :model-value="performanceSettings.document.mood"
      :label="t('settings.live2d.performance.mood.title')"
      :description="t('settings.live2d.performance.mood.description')"
      placement="right"
      @update:model-value="updatePerformanceSettings({ mood: $event })"
    />
    <FieldCheckbox
      :model-value="performanceSettings.document.heldEmotions"
      :label="t('settings.live2d.performance.held-emotions.title')"
      :description="t('settings.live2d.performance.held-emotions.description')"
      placement="right"
      @update:model-value="updatePerformanceSettings({ heldEmotions: $event })"
    />
    <FieldCheckbox
      :model-value="performanceSettings.document.autoExpressions"
      :label="t('settings.live2d.performance.auto-expressions.title')"
      :description="t('settings.live2d.performance.auto-expressions.description')"
      placement="right"
      @update:model-value="updatePerformanceSettings({ autoExpressions: $event })"
    />
    <FieldCheckbox
      :model-value="performanceSettings.document.stateFeedback"
      :label="t('settings.live2d.performance.state-feedback.title')"
      :description="t('settings.live2d.performance.state-feedback.description')"
      placement="right"
      @update:model-value="updatePerformanceSettings({ stateFeedback: $event })"
    />
    <label :class="['flex flex-wrap gap-4']">
      <div :class="['min-w-0 flex-1 basis-full sm:basis-auto']">
        <div :class="['flex items-center gap-1 text-sm font-medium']">
          {{ t('settings.live2d.performance.decider.title') }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.performance.decider.description') }}
        </div>
      </div>
      <SelectTab
        :model-value="performanceSettings.document.decider"
        :options="deciderOptions"
        size="sm"
        :class="['shrink-0']"
        @update:model-value="updatePerformanceSettings({ decider: $event })"
      />
    </label>
  </Section>
</template>
