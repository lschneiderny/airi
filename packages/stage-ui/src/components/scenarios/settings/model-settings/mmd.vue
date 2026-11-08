<script setup lang="ts">
import type { ClipKind, MMDClipCuration, MMDGazeMode, MMDMotionDriver, MMDRoamMode, MorphSlot } from '@proj-airi/stage-ui-mmd'
import type { SelectTabOption } from '@proj-airi/ui'

import type { DesktopStageDisplay, DesktopStageMode } from './desktop-stage'
import type { ExpressionPanelCommand, ExpressionPanelSnapshot, ExpressionPanelSource } from './expressions/source'
import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { CLIP_LABEL_PATTERN, controlConfig, effectiveLayer, useMMD, useMMDExpressionStore } from '@proj-airi/stage-ui-mmd/stores'
import { Button, Checkbox, FieldCheckbox, FieldCombobox, FieldRange, GhostButton, Input, Select, SelectTab } from '@proj-airi/ui'
import { useFileDialog } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ExpressionPanel from './expressions/panel.vue'
import NaturalEmotionStrength from './natural-emotion-strength.vue'

import { useSettingsStageModel } from '../../../../stores/settings/stage-model'
import { Container, PropertyColor, PropertyNumber } from '../../../data-pane'
import { Section } from '../../../layouts'
import { ColorPalette } from '../../../widgets'
import { desktopStageNeedsRelaunch as needsRelaunch, useDesktopStageHost } from './desktop-stage'

const props = withDefaults(defineProps<{
  palette: string[]
  allowExtractColors?: boolean
  runtimeSnapshot: ModelSettingsRuntimeSnapshot
}>(), {
  allowExtractColors: true,
})

const emit = defineEmits<{
  (e: 'extractColorsFromModel'): void
  (e: 'mmdExpressionCommand', command: ExpressionPanelCommand): void
}>()

const { t } = useI18n()

const mmdStore = useMMD()
// Stance slots are keyed by the id the stage passes to the MMD scene as `modelId`.
const { stageModelSelected } = storeToRefs(useSettingsStageModel())
// In Electron the settings window has no model; the stage window publishes `mmdExpressions` and applies the commands.
const localExpressionSource: ExpressionPanelSource = useMMDExpressionStore()
const usesRemoteExpressionRuntime = computed(() => props.runtimeSnapshot.mmdExpressions != null)
const expressionSettingsSnapshot = computed<ExpressionPanelSnapshot>(() => props.runtimeSnapshot.mmdExpressions ?? localExpressionSource.settingsSnapshot)
const expressionSearch = ref('')
const showAllExpressions = ref(false)

function applyExpressionSettingsCommand(command: ExpressionPanelCommand) {
  if (usesRemoteExpressionRuntime.value) {
    emit('mmdExpressionCommand', command)
    return
  }

  localExpressionSource.applySettingsCommand(command)
}

const {
  scale,
  position,
  rotationY,
  physicsEnabled,
  ikEnabled,
  grantEnabled,
  physicsGravity,
  gazeMode,
  motionDriver,
  naturalEnergy,
  naturalTouch,
  naturalTouchPetRequiresHold,
  naturalEmotionStrength,
  stanceSlots,
  idleMotionName,
  availableMotions,
  availableClipMeta,
  availableMorphs,
  availableMaterials,
  materialOpacity,
  morphOverrides,
  cameraFov,
  ambientColor,
  ambientIntensity,
  directionalColor,
  directionalIntensity,
  directionalPosition,
  albedoGlow,
  renderScale,
  stageCharacterHeight,
  roamMode,
} = storeToRefs(mmdStore)

const desktopStage = useDesktopStageHost()
const desktopStageState = computed(() => desktopStage?.state.value ?? null)
const desktopStageExperimental = computed<boolean>({
  get: () => desktopStageState.value?.experimental ?? false,
  set: (enabled) => { void desktopStage?.setExperimental(enabled) },
})
const desktopStageMode = computed<DesktopStageMode>({
  get: () => desktopStageState.value?.mode ?? 'window',
  set: (mode) => { void desktopStage?.setMode(mode) },
})
const desktopStageNeedsRelaunch = computed(() => desktopStageState.value !== null && needsRelaunch(desktopStageState.value))
const desktopStageModeOptions = computed<SelectTabOption<DesktopStageMode>[]>(() => [
  {
    value: 'window',
    label: t('settings.mmd.stage.mode.options.window.title'),
    description: t('settings.mmd.stage.mode.options.window.description'),
  },
  {
    value: 'desktop',
    label: t('settings.mmd.stage.mode.options.desktop.title'),
    description: t('settings.mmd.stage.mode.options.desktop.description'),
  },
])

function homeDisplayLabel(display: DesktopStageDisplay) {
  const label = t('settings.mmd.stage.home-display.option', {
    id: display.id,
    width: display.workArea.width,
    height: display.workArea.height,
  })
  return display.primary ? `${label} (${t('settings.mmd.stage.home-display.primary')})` : label
}

const homeDisplayOptions = computed(() => (desktopStageState.value?.displays ?? []).map(display => ({
  label: homeDisplayLabel(display),
  value: display.id,
  description: '',
})))

function setHomeDisplay(value: string | number | undefined) {
  if (typeof value !== 'string' || value === desktopStageState.value?.homeDisplayId)
    return
  void desktopStage?.setHomeDisplay(value)
}

const roamModeOptions = computed<SelectTabOption<MMDRoamMode>[]>(() => [
  {
    value: 'stay',
    label: t('settings.mmd.stage.roam.options.stay.title'),
    description: t('settings.mmd.stage.roam.options.stay.description'),
  },
  {
    value: 'roam',
    label: t('settings.mmd.stage.roam.options.roam.title'),
    description: t('settings.mmd.stage.roam.options.roam.description'),
  },
])

function formatCharacterHeight(value: number) {
  return `${Math.round(value)} pt`
}

const canExtractColors = computed(() => props.runtimeSnapshot.canCapturePreview)

// VRM-style eye-tracking buttons placed in the scene grid (cols 3–5).
const trackingOptions = computed<{ value: MMDGazeMode, label: string, class: string }[]>(() => [
  { value: 'camera', label: t('settings.mmd.gaze.options.camera'), class: 'col-start-3' },
  { value: 'mouse', label: t('settings.mmd.gaze.options.cursor'), class: 'col-start-4' },
  { value: 'none', label: t('settings.mmd.gaze.options.none'), class: 'col-start-5' },
])

const motionOptions = computed(() => availableMotions.value.map(motion => ({
  label: motion.name,
  value: motion.name,
  description: '',
})))

const motionDriverOptions = computed<SelectTabOption<MMDMotionDriver>[]>(() => [
  {
    value: 'natural',
    label: t('settings.mmd.motion.driver.options.natural.title'),
    description: t('settings.mmd.motion.driver.options.natural.description'),
  },
  {
    value: 'classic',
    label: t('settings.mmd.motion.driver.options.classic.title'),
    description: t('settings.mmd.motion.driver.options.classic.description'),
  },
])

function formatNaturalEnergy(value: number) {
  return `${Math.round(value * 100)}%`
}

type StanceSlotName = keyof (typeof stanceSlots.value)[string]
const STANCE_SLOTS: readonly StanceSlotName[] = ['idle', 'sit', 'sleep']

/**
 * Option value for the "none" state: no slot, or a slot naming a motion that was
 * removed. The combobox drops options with an empty value, and a motion name
 * comes from a file name, which cannot contain a slash, so this never collides.
 */
const STANCE_NONE = '/none'
const stanceOptions = computed(() => [
  { label: t('settings.mmd.motion.stance.none'), value: STANCE_NONE, description: '' },
  ...motionOptions.value,
])

function stanceSlotValue(slot: StanceSlotName): string {
  const name = stanceSlots.value[stageModelSelected.value]?.[slot]
  return name && availableMotions.value.some(motion => motion.name === name) ? name : STANCE_NONE
}

function setStanceSlot(slot: StanceSlotName, value: string | number | undefined) {
  if (typeof value !== 'string')
    return
  const modelId = stageModelSelected.value
  const { [slot]: _, ...rest } = stanceSlots.value[modelId] ?? {}
  stanceSlots.value = { ...stanceSlots.value, [modelId]: value === STANCE_NONE ? rest : { ...rest, [slot]: value } }
}

// '(auto)' lets the renderer pick the morph by its standard-name candidates.
const morphOptions = computed(() => [
  { label: t('settings.mmd.morphs.auto'), value: '', description: '' },
  ...availableMorphs.value.map(name => ({ label: name, value: name, description: '' })),
])

/** Logical morph slots exposed for manual remapping, grouped by purpose. */
const MORPH_SLOTS: { slot: MorphSlot, label: string }[] = [
  { slot: 'vowelA', label: 'Mouth あ (A)' },
  { slot: 'vowelI', label: 'Mouth い (I)' },
  { slot: 'vowelU', label: 'Mouth う (U)' },
  { slot: 'vowelE', label: 'Mouth え (E)' },
  { slot: 'vowelO', label: 'Mouth お (O)' },
  { slot: 'blink', label: 'Blink' },
  { slot: 'blinkLeft', label: 'Wink (L)' },
  { slot: 'blinkRight', label: 'Wink (R)' },
  { slot: 'smile', label: 'Smile' },
  { slot: 'anger', label: 'Anger' },
  { slot: 'sad', label: 'Sad' },
  { slot: 'surprise', label: 'Surprise' },
  { slot: 'troubled', label: 'Troubled' },
  { slot: 'serious', label: 'Serious' },
]

function handleIdleMotionSelect(name: string | number | undefined) {
  if (typeof name !== 'string')
    return
  idleMotionName.value = name
}

function setMorphOverride(slot: MorphSlot, value: string | number | undefined) {
  if (typeof value !== 'string')
    return
  morphOverrides.value = { ...morphOverrides.value, [slot]: value }
}

function setMaterialOpacity(name: string, value: number) {
  materialOpacity.value = { ...materialOpacity.value, [name]: value }
}

const vmdDialog = useFileDialog({ accept: '.vmd', multiple: true, reset: true })
vmdDialog.onChange(async (files) => {
  if (!files)
    return
  for (const file of Array.from(files)) {
    const descriptor = await mmdStore.addMotion(file)
    // Make the first imported motion the idle if none is chosen yet, so the
    // character immediately animates instead of standing in rest pose.
    if (!idleMotionName.value)
      idleMotionName.value = descriptor.name
  }
})

function playMotionOnce(name: string) {
  mmdStore.requestPerform(name, { source: 'debug' })
}

// === Clip library ===
/** The kinds a user can set. */
const KIND_OVERRIDES: readonly ClipKind[] = ['gesture', 'action', 'dance', 'stance']
/** Option value for "auto" (`null` in the store): the select rejects an empty value, and no kind contains a slash. */
const KIND_AUTO = '/auto'
const kindOptions = computed(() => [
  { label: t('settings.mmd.animation.clips.kinds.auto'), value: KIND_AUTO },
  ...KIND_OVERRIDES.map(kind => ({ label: t(`settings.mmd.animation.clips.kinds.${kind}`), value: kind })),
])

interface ClipRow {
  name: string
  /** `null` until the scene has derived the clip (model not loaded yet). */
  derivedKind: ClipKind | null
  effectiveKind: ClipKind | null
  layer: 'upper' | 'full' | 'none' | null
  downgraded: boolean
  notes: readonly string[]
  kindOverride: ClipKind | typeof KIND_AUTO
  loop: boolean
  loopLocked: boolean
  label: string | null
  exposed: boolean
  exposeHint: string | null
}

// `curationFor` reads the store's `clipCuration`, so an edit from another window recomputes the rows.
const clipRows = computed<ClipRow[]>(() => availableMotions.value.map(({ name }) => {
  const meta = availableClipMeta.value[name]
  const curation = mmdStore.curationFor(stageModelSelected.value, name)
  const effectiveKind = curation.kind ?? meta?.kind ?? null
  const layer = meta ? effectiveLayer(meta, curation.kind) : null
  const exposeHint = curation.label === null
    ? t('settings.mmd.animation.clips.hints.needs-label')
    : effectiveKind === 'stance' || effectiveKind === 'unusable'
      ? t('settings.mmd.animation.clips.hints.kind-not-usable')
      : null
  return {
    name,
    derivedKind: meta?.kind ?? null,
    effectiveKind,
    layer,
    downgraded: meta !== undefined && layer !== meta.layer,
    notes: meta?.notes ?? [],
    kindOverride: curation.kind ?? KIND_AUTO,
    loop: curation.loop ?? meta?.loop ?? false,
    loopLocked: effectiveKind === 'dance',
    label: curation.label,
    exposed: curation.aiMayUse,
    exposeHint,
  }
}))

/**
 * What the user typed per clip, so a refused label stays visible next to its error.
 * Keyed by model and clip name: this component survives a model switch, and a same-named clip of another model must not inherit the draft.
 */
const labelDrafts = ref<Record<string, string>>({})
const labelErrors = ref<Record<string, 'invalid' | 'duplicate'>>({})

function draftKey(name: string): string {
  return JSON.stringify([stageModelSelected.value, name])
}

function labelDraft(row: ClipRow): string {
  return labelDrafts.value[draftKey(row.name)] ?? row.label ?? ''
}

function labelError(name: string): 'invalid' | 'duplicate' | undefined {
  return labelErrors.value[draftKey(name)]
}

function setClipLabel(name: string, value: string | undefined) {
  const draft = value ?? ''
  const key = draftKey(name)
  labelDrafts.value = { ...labelDrafts.value, [key]: draft }
  const { [key]: _, ...otherErrors } = labelErrors.value
  // An empty input removes the label; the store refuses an empty string, so clear it with `null`.
  if (draft === '') {
    mmdStore.setCuration(stageModelSelected.value, name, { label: null, aiMayUse: false })
    labelErrors.value = otherErrors
    return
  }
  if (!CLIP_LABEL_PATTERN.test(draft)) {
    labelErrors.value = { ...otherErrors, [key]: 'invalid' }
    return
  }
  labelErrors.value = mmdStore.setCuration(stageModelSelected.value, name, { label: draft })
    ? otherErrors
    : { ...otherErrors, [key]: 'duplicate' }
}

function setClipKind(name: string, value: string | undefined) {
  if (value === undefined)
    return
  const kind = value === KIND_AUTO ? null : value as ClipKind
  const patch: Partial<MMDClipCuration> = { kind }
  const meta = availableClipMeta.value[name]
  // A stance or unusable clip cannot stay exposed.
  if ((kind ?? meta?.kind) === 'stance' || (kind ?? meta?.kind) === 'unusable')
    patch.aiMayUse = false
  mmdStore.setCuration(stageModelSelected.value, name, patch)
}

function setClipLoop(name: string, loop: boolean) {
  mmdStore.setCuration(stageModelSelected.value, name, { loop })
}

function setClipExposed(name: string, aiMayUse: boolean) {
  mmdStore.setCuration(stageModelSelected.value, name, { aiMayUse })
}

function removeMotion(id: string) {
  void mmdStore.removeMotion(id)
}
</script>

<template>
  <Container
    :title="t('settings.pages.models.sections.section.scene')"
    icon="i-solar:people-nearby-bold-duotone"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
  >
    <template v-if="allowExtractColors">
      <ColorPalette class="mb-4 mt-2" :colors="palette.map(hex => ({ hex, name: hex }))" mx-auto />
      <Button :disabled="!canExtractColors" @click="$emit('extractColorsFromModel')">
        {{ t('settings.mmd.theme-color-from-model.button-extract.title') }}
      </Button>
    </template>

    <div grid="~ cols-5 gap-1" p-2>
      <PropertyNumber
        v-model="scale"
        :config="{ min: controlConfig.scale.min, max: controlConfig.scale.max, step: controlConfig.scale.step, label: 'Scale', formatValue: val => val?.toFixed(2) }"
        :label="t('settings.mmd.scale-and-position.scale')"
      />
      <PropertyNumber
        v-model="position.x"
        :config="{ min: controlConfig.x.min, max: controlConfig.x.max, step: controlConfig.x.step, label: 'X', formatValue: val => val?.toFixed(2) }"
        :label="t('settings.mmd.scale-and-position.x')"
      />
      <PropertyNumber
        v-model="position.y"
        :config="{ min: controlConfig.y.min, max: controlConfig.y.max, step: controlConfig.y.step, label: 'Y', formatValue: val => val?.toFixed(2) }"
        :label="t('settings.mmd.scale-and-position.y')"
      />
      <PropertyNumber
        v-model="cameraFov"
        :config="{ min: 10, max: 120, step: 1, label: 'FOV' }"
        label="Camera FOV"
      />
      <PropertyNumber
        v-model="rotationY"
        :config="{ min: controlConfig.rotationY.min, max: controlConfig.rotationY.max, step: controlConfig.rotationY.step, label: 'Rotation', formatValue: val => val?.toFixed(2) }"
        :label="t('settings.mmd.scale-and-position.rotation')"
      />

      <!-- Eye tracking mode -->
      <div class="text-xs">
        {{ t('settings.mmd.gaze.tracking') }}:
      </div>
      <div />
      <template v-for="option in trackingOptions" :key="option.value">
        <GhostButton
          :class="[option.class, 'w-auto']"
          size="sm"
          :active="gazeMode === option.value"
          :label="option.label"
          @click="gazeMode = option.value"
        />
      </template>

      <PropertyNumber
        v-model="directionalPosition.x"
        :config="{ min: -10, max: 10, step: 0.1, label: 'X' }"
        label="Directional Light - X"
      />
      <PropertyNumber
        v-model="directionalPosition.y"
        :config="{ min: -10, max: 10, step: 0.1, label: 'Y' }"
        label="Directional Light - Y"
      />
      <PropertyNumber
        v-model="directionalPosition.z"
        :config="{ min: -10, max: 10, step: 0.1, label: 'Z' }"
        label="Directional Light - Z"
      />
      <PropertyColor
        v-model="directionalColor"
        label="Directional Light Color"
      />
      <PropertyNumber
        v-model="directionalIntensity"
        :config="{ min: 0, max: 3, step: 0.01, label: 'Intensity' }"
        label="Directional Light Intensity"
      />

      <PropertyNumber
        v-model="ambientIntensity"
        :config="{ min: 0, max: 3, step: 0.01, label: 'Intensity' }"
        label="Ambient Light Intensity"
      />
      <PropertyColor
        v-model="ambientColor"
        label="Ambient Light Color"
      />

      <PropertyNumber
        v-model="albedoGlow"
        :config="{ min: 0, max: 1, step: 0.01, label: 'Glow', formatValue: val => val?.toFixed(2) }"
        label="Albedo Glow"
      />
      <PropertyNumber
        v-model="renderScale"
        :config="{ min: 0.5, max: 2, step: 0.1, label: 'Scale' }"
        label="Render Scale"
      />
    </div>
    <p v-if="desktopStageState?.experimental" :class="['px-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.stage.classic-only-note') }}
    </p>
  </Container>

  <Section
    v-if="desktopStage"
    :title="t('settings.mmd.stage.title')"
    icon="i-solar:monitor-bold-duotone"
    inner-class="text-sm"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <p :class="['mb-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.stage.description') }}
    </p>
    <FieldCheckbox
      v-model="desktopStageExperimental"
      :disabled="desktopStageState === null"
      :label="t('settings.mmd.stage.experimental.title')"
      :description="t('settings.mmd.stage.experimental.description')"
    />
    <div
      v-if="desktopStageNeedsRelaunch"
      :class="['flex flex-wrap items-center gap-4']"
    >
      <Button variant="primary" color="primary" @click="desktopStage.relaunch()">
        {{ t('settings.mmd.stage.relaunch.button') }}
      </Button>
      <p :class="['min-w-0 flex-1 basis-full sm:basis-auto', 'text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.mmd.stage.relaunch.description') }}
      </p>
    </div>
    <template v-if="desktopStageState?.experimental">
      <p
        v-if="desktopStageState.mode === 'desktop' && desktopStageState.next === 'window'"
        :class="['text-xs text-neutral-500 dark:text-neutral-400']"
      >
        {{ t('settings.mmd.stage.classic-host-notice') }}
      </p>
      <label :class="['flex flex-wrap gap-4']">
        <div :class="['min-w-0 flex-1 basis-full sm:basis-auto']">
          <div :class="['flex items-center gap-1 text-sm font-medium']">
            {{ t('settings.mmd.stage.mode.title') }}
          </div>
          <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.mmd.stage.mode.description') }}
          </div>
        </div>
        <SelectTab
          v-model="desktopStageMode"
          :options="desktopStageModeOptions"
          :disabled="desktopStageState === null"
          size="sm"
          :class="['shrink-0', 'min-w-72']"
        />
      </label>
      <FieldCombobox
        :model-value="desktopStageState?.homeDisplayId ?? ''"
        :options="homeDisplayOptions"
        :disabled="homeDisplayOptions.length < 2"
        :label="t('settings.mmd.stage.home-display.title')"
        :description="t('settings.mmd.stage.home-display.description')"
        @update:model-value="setHomeDisplay"
      />
      <FieldRange
        v-model="stageCharacterHeight"
        :min="200"
        :max="1200"
        :step="10"
        :label="t('settings.mmd.stage.character-height.title')"
        :description="t('settings.mmd.stage.character-height.description')"
        :format-value="formatCharacterHeight"
      />
      <label :class="['flex flex-wrap gap-4']">
        <div :class="['min-w-0 flex-1 basis-full sm:basis-auto']">
          <div :class="['flex items-center gap-1 text-sm font-medium']">
            {{ t('settings.mmd.stage.roam.title') }}
          </div>
          <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.mmd.stage.roam.description') }}
          </div>
        </div>
        <SelectTab
          v-model="roamMode"
          :options="roamModeOptions"
          size="sm"
          :class="['shrink-0']"
        />
      </label>
    </template>
  </Section>

  <Section
    :title="t('settings.mmd.physics.title')"
    icon="i-solar:atom-bold-duotone"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <FieldCheckbox v-model="physicsEnabled" :label="t('settings.mmd.physics.enabled')" />
    <FieldCheckbox v-model="ikEnabled" :label="t('settings.mmd.physics.ik')" />
    <FieldCheckbox v-model="grantEnabled" :label="t('settings.mmd.physics.grant')" />
    <FieldRange
      v-model="physicsGravity"
      as="div"
      :min="0"
      :max="200"
      :step="1"
      :default-value="98"
      :label="t('settings.mmd.physics.gravity')"
    />
  </Section>

  <Section
    :title="t('settings.mmd.motion.title')"
    icon="i-solar:walking-round-bold-duotone"
    inner-class="text-sm"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <label :class="['flex flex-wrap gap-4']">
      <div :class="['min-w-0 flex-1 basis-full sm:basis-auto']">
        <div :class="['flex items-center gap-1 text-sm font-medium']">
          {{ t('settings.mmd.motion.driver.title') }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.mmd.motion.driver.description') }}
        </div>
      </div>
      <SelectTab
        v-model="motionDriver"
        :options="motionDriverOptions"
        size="sm"
        :class="['shrink-0']"
      />
    </label>
    <FieldRange
      v-if="motionDriver === 'natural'"
      v-model="naturalEnergy"
      :min="0"
      :max="1"
      :step="0.05"
      :label="t('settings.mmd.motion.natural-energy.title')"
      :description="t('settings.mmd.motion.natural-energy.description')"
      :format-value="formatNaturalEnergy"
    />
    <FieldCheckbox
      v-if="motionDriver === 'natural'"
      v-model="naturalTouch"
      :label="t('settings.mmd.motion.natural-touch.title')"
      :description="t('settings.mmd.motion.natural-touch.description')"
      placement="right"
    />
    <FieldCheckbox
      v-if="motionDriver === 'natural' && naturalTouch"
      v-model="naturalTouchPetRequiresHold"
      :label="t('settings.mmd.motion.natural-touch-pet-requires-hold.title')"
      :description="t('settings.mmd.motion.natural-touch-pet-requires-hold.description')"
      placement="right"
    />
    <NaturalEmotionStrength
      v-if="motionDriver === 'natural'"
      v-model="naturalEmotionStrength"
      :model-id="stageModelSelected"
    />
    <p :class="['mt-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.motion.stance.description') }}
    </p>
    <FieldCombobox
      v-for="slot in STANCE_SLOTS"
      :key="slot"
      :model-value="stanceSlotValue(slot)"
      :options="stanceOptions"
      :label="t(`settings.mmd.motion.stance.${slot}`)"
      @update:model-value="value => setStanceSlot(slot, value)"
    />
  </Section>

  <Section
    :title="t('settings.mmd.animation.title')"
    icon="i-solar:play-bold-duotone"
    inner-class="text-sm"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <p :class="['mb-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.animation.description') }}
    </p>
    <Button :class="['mb-2']" @click="vmdDialog.open()">
      {{ t('settings.mmd.animation.import-motion') }}
    </Button>
    <FieldCombobox
      v-if="motionOptions.length > 0"
      :model-value="idleMotionName"
      :options="motionOptions"
      :label="t('settings.mmd.animation.idle-motion')"
      @update:model-value="handleIdleMotionSelect"
    />
    <div v-if="availableMotions.length > 0" :class="['mt-2', 'flex', 'flex-col', 'gap-1']">
      <div
        v-for="motion in availableMotions"
        :key="motion.name"
        :class="['flex', 'items-center', 'justify-between', 'gap-2']"
      >
        <div :class="['truncate', 'text-sm']">
          {{ motion.name }}
        </div>
        <div :class="['flex', 'shrink-0', 'items-center', 'gap-1']">
          <Button @click="playMotionOnce(motion.name)">
            {{ t('settings.mmd.animation.play-once') }}
          </Button>
          <Button

            :aria-label="t('settings.mmd.animation.remove')"
            @click="removeMotion(motion.id)"
          >
            <div i-solar:trash-bin-minimalistic-bold-duotone />
          </Button>
        </div>
      </div>
    </div>
    <template v-if="clipRows.length > 0">
      <div :class="['mt-4', 'text-sm', 'font-medium']">
        {{ t('settings.mmd.animation.clips.title') }}
      </div>
      <p :class="['mb-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
        {{ t('settings.mmd.animation.clips.description') }}
      </p>
      <div :class="['overflow-x-auto', 'rounded-lg', 'border-2', 'border-neutral-100', 'dark:border-neutral-800']">
        <table :class="['w-full', 'text-left', 'text-xs']">
          <thead :class="['bg-neutral-100/80', 'dark:bg-neutral-800/80', 'text-neutral-500', 'dark:text-neutral-400']">
            <tr>
              <th
                v-for="header in ['name', 'derived', 'label', 'kind', 'loop', 'ai-may-use']"
                :key="header"
                scope="col"
                :class="['px-1.5', 'py-1.5', 'font-medium', 'whitespace-nowrap']"
              >
                {{ t(`settings.mmd.animation.clips.headers.${header}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in clipRows"
              :key="row.name"
              :class="['border-t-2', 'border-neutral-100', 'dark:border-neutral-800', 'align-top']"
            >
              <td :class="['max-w-28', 'truncate', 'px-1.5', 'py-1.5', 'text-sm', 'text-neutral-900', 'dark:text-neutral-100']" :title="row.name">
                {{ row.name }}
              </td>
              <td :class="['px-1.5', 'py-1.5']">
                <span v-if="row.derivedKind === null" :class="['text-neutral-500', 'dark:text-neutral-400']">
                  {{ t('settings.mmd.animation.clips.pending') }}
                </span>
                <div v-else :class="['flex', 'flex-wrap', 'items-center', 'gap-1']">
                  <span
                    :class="[
                      'rounded-full px-2 py-0.5',
                      row.derivedKind === 'unusable'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                    ]"
                  >
                    {{ t(`settings.mmd.animation.clips.kinds.${row.derivedKind}`) }}
                  </span>
                  <span
                    v-if="row.layer && row.layer !== 'none'"
                    :class="['rounded-full px-2 py-0.5', 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200']"
                  >
                    {{ t(`settings.mmd.animation.clips.layers.${row.layer}`) }}
                  </span>
                  <span
                    v-if="row.downgraded"
                    :title="t('settings.mmd.animation.clips.badges.downgraded-hint')"
                    :class="['rounded-full px-2 py-0.5', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300']"
                  >
                    {{ t('settings.mmd.animation.clips.badges.downgraded') }}
                  </span>
                  <span
                    v-for="note in row.notes"
                    :key="note"
                    :class="['text-neutral-500', 'dark:text-neutral-400']"
                  >
                    {{ t(`settings.mmd.animation.clips.notes.${note}`) }}
                  </span>
                </div>
              </td>
              <td :class="['px-1.5', 'py-1.5', 'w-28']">
                <Input
                  :model-value="labelDraft(row)"
                  :placeholder="t('settings.mmd.animation.clips.label-placeholder')"
                  :aria-label="`${t('settings.mmd.animation.clips.headers.label')}: ${row.name}`"
                  :aria-invalid="labelError(row.name) !== undefined"
                  @update:model-value="value => setClipLabel(row.name, value)"
                />
                <p v-if="labelError(row.name)" :class="['mt-1', 'text-xs', 'text-red-500']">
                  {{ t(`settings.mmd.animation.clips.errors.${labelError(row.name)}`) }}
                </p>
              </td>
              <td :class="['px-1.5', 'py-1.5', 'w-26']">
                <!-- The select root renders no element, so its accessible name comes from this label. -->
                <label :class="['block']">
                  <span :class="['sr-only']">{{ t('settings.mmd.animation.clips.headers.kind') }}: {{ row.name }}</span>
                  <Select
                    :model-value="row.kindOverride"
                    :options="kindOptions"
                    @update:model-value="value => setClipKind(row.name, value)"
                  />
                </label>
              </td>
              <td :class="['px-1.5', 'py-1.5']" :title="row.loopLocked ? t('settings.mmd.animation.clips.hints.loop-dance') : undefined">
                <Checkbox
                  :model-value="row.loop"
                  :disabled="row.loopLocked"
                  :aria-label="`${t('settings.mmd.animation.clips.headers.loop')}: ${row.name}`"
                  @update:model-value="value => setClipLoop(row.name, value)"
                />
              </td>
              <td :class="['px-1.5', 'py-1.5']" :title="row.exposeHint ?? undefined">
                <Checkbox
                  :model-value="row.exposed"
                  :disabled="row.exposeHint !== null"
                  :aria-label="`${t('settings.mmd.animation.clips.headers.ai-may-use')}: ${row.name}`"
                  @update:model-value="value => setClipExposed(row.name, value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </Section>

  <Section
    :title="t('settings.mmd.expressions.title')"
    icon="i-solar:face-scan-circle-bold-duotone"
    inner-class="text-sm"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <p :class="['mb-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.expressions.description') }}
    </p>
    <ExpressionPanel
      v-model:search="expressionSearch"
      v-model:show-all="showAllExpressions"
      :snapshot="expressionSettingsSnapshot"
      @command="applyExpressionSettingsCommand"
    />
  </Section>

  <Section
    :title="t('settings.mmd.morphs.title')"
    icon="i-solar:emoji-funny-square-bold-duotone"
    inner-class="text-sm"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <p :class="['mb-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.morphs.description') }}
    </p>
    <template v-if="availableMorphs.length > 0">
      <FieldCombobox
        v-for="entry in MORPH_SLOTS"
        :key="entry.slot"
        :model-value="morphOverrides[entry.slot] ?? ''"
        :options="morphOptions"
        :label="entry.label"
        @update:model-value="value => setMorphOverride(entry.slot, value)"
      >
        <template #label>
          <span>{{ entry.label }}</span>
          <button
            v-if="morphOverrides[entry.slot]"
            type="button"
            :title="t('settings.mmd.morphs.revert')"
            :aria-label="t('settings.mmd.morphs.revert')"
            :class="['ml-1', 'inline-flex', 'items-center']"
            @click.stop.prevent="setMorphOverride(entry.slot, '')"
          >
            <div :class="['i-solar:forward-linear', 'transform-scale-x--100', 'text-neutral-500', 'dark:text-neutral-400']" />
          </button>
        </template>
      </FieldCombobox>
    </template>
    <p v-else :class="['text-xs', 'text-amber-600', 'dark:text-amber-400']">
      {{ t('settings.mmd.morphs.no-morphs') }}
    </p>
  </Section>

  <Section
    :title="t('settings.mmd.materials.title')"
    icon="i-solar:layers-bold-duotone"
    inner-class="text-sm"
    :class="['rounded-xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    size="sm"
    :expand="false"
  >
    <p :class="['mb-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
      {{ t('settings.mmd.materials.description') }}
    </p>
    <template v-if="availableMaterials.length > 0">
      <FieldRange
        v-for="material in availableMaterials"
        :key="material.index"
        as="div"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="1"
        :model-value="materialOpacity[material.name] ?? 1"
        :label="material.label"
        @update:model-value="value => setMaterialOpacity(material.name, value)"
      />
    </template>
    <p v-else :class="['text-xs', 'text-amber-600', 'dark:text-amber-400']">
      {{ t('settings.mmd.materials.no-materials') }}
    </p>
  </Section>
</template>
