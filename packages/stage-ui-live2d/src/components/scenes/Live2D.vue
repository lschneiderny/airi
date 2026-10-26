<script setup lang="ts">
import type { PresenceBubbleState } from '@proj-airi/stage-shared'
import type { ExpressionPerformanceSettings, HoldCommand, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

import type { Live2DEyeFocusSource } from '../../composables/live2d'
import type { SpeechEvent } from '../../composables/live2d/expression/slots'
import type { NaturalEpisode } from '../../composables/live2d/natural-motion/mood'
import type { Live2DTouchEvent } from '../../composables/live2d/touch-gestures'

import { presenceBubbleIdle } from '@proj-airi/stage-shared'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { useScreenAmbientLightEnvironment, useSettingsScreenAmbientLight } from '@proj-airi/stage-shared/stores/screen-ambient-light'
import { Screen } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'

import Live2DCanvas from './live2d/Canvas.vue'
import Live2DModel from './live2d/Model.vue'
import Live2DPresenceBubble from './live2d/presence-bubble.vue'

import { useLive2DEyeFocusFor, useSettingsLive2d } from '../../composables/live2d'
import { createCursorExpiry } from './live2d/cursor-expiry'

import '../../utils/live2d-zip-loader'
import '../../utils/live2d-opfs-registration'

const props = withDefaults(defineProps<{
  cursorPosition?: Live2DEyeFocusSource
  modelSrc?: string
  modelId?: string
  /** Scene painted inside the canvas, behind the model. */
  backgroundUrl?: string | null

  paused?: boolean
  mouthOpenSize?: number
  nowSpeaking?: boolean
  themeColorsHue?: number
  themeColorsHueDynamic?: boolean
  /** Drives the bubble above the character. */
  presence?: PresenceBubbleState
  /** Resolved by the stage and read by the Natural motion driver. */
  performance?: PerformanceState
  /**
   * Energy forced on the Natural driver (devtools lab override), 0..1.
   * When omitted, the user's Natural energy setting applies.
   */
  naturalEnergy?: number
  /** Effective expression-performance settings from the stage; Natural and the expression slots read them. */
  performanceSettings?: ExpressionPerformanceSettings
  /** Displays and window content bounds in Electron DIP screen coordinates; Natural reads them for screen placement. */
  screenPlacement?: { displays: PlacementRect[], windowBounds: PlacementRect }
}>(), {
  presence: () => presenceBubbleIdle,
  performance: () => ({ mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }),
  naturalEnergy: undefined,
  performanceSettings: () => defaultExpressionPerformanceSettings,
  paused: false,
  mouthOpenSize: 0,
  nowSpeaking: false,
  themeColorsHue: 220.44,
  themeColorsHueDynamic: false,
})

const emit = defineEmits<{
  error: [error: Error]
  /** A poke or pet the Natural driver reacted to, for consumers such as a future chat reaction. */
  touch: [event: Live2DTouchEvent]
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const componentStateCanvas = defineModel<'pending' | 'loading' | 'mounted'>('canvasState', { default: 'pending' })
const componentStateModel = defineModel<'pending' | 'loading' | 'mounted'>('modelState', { default: 'pending' })

const live2dCanvasRef = ref<InstanceType<typeof Live2DCanvas>>()
const live2dModelRef = ref<InstanceType<typeof Live2DModel>>()
const activeCursorPosition = ref<Live2DEyeFocusSource | null>(null)
const cursorExpiry = createCursorExpiry(() => {
  activeCursorPosition.value = null
})

const {
  live2dMotionDriver,
  live2dEyeTracking,
  live2dIdleAnimationEnabled,
  live2dForceIdleEyeAnimation,
  live2dAutoBlinkEnabled,
  live2dForceAutoBlinkEnabled,
  live2dExpressionEnabled,
  live2dMaxFps,
  live2dRenderScale,
  live2dShadowEnabled,
  live2dNaturalEnergy,
  live2dNaturalEmotionStrength,
} = storeToRefs(useSettingsLive2d())
const universalMotionEnabled = computed(() => live2dMotionDriver.value === 'universal')
const {
  screenAmbientLightBacklight,
  screenAmbientLightBaseCurve,
  screenAmbientLightColorBoost,
  screenAmbientLightDarkBase,
  screenAmbientLightLocalShare,
  screenAmbientLightEnabled,
  screenAmbientLightMode,
  screenAmbientLightSquint,
  screenAmbientLightStrength,
  screenAmbientLightTint,
  screenAmbientLightTranslucentWrap,
  screenAmbientLightWrapDiffuse,
  screenAmbientLightWrapIntensity,
  screenAmbientLightWrapSaturation,
} = storeToRefs(useSettingsScreenAmbientLight())
const {
  active: screenAmbientLightActive,
  environment: screenAmbientLightEnvironment,
  subject: screenAmbientLightSubject,
} = storeToRefs(useScreenAmbientLightEnvironment())
const screenAmbientLightFilterOptions = computed(() => ({
  darkBase: screenAmbientLightDarkBase.value,
  baseCurve: screenAmbientLightBaseCurve.value,
  localShare: screenAmbientLightLocalShare.value,
  tint: screenAmbientLightTint.value,
  colorBoost: screenAmbientLightColorBoost.value,
  wrapIntensity: screenAmbientLightWrapIntensity.value,
  wrapSaturation: screenAmbientLightWrapSaturation.value,
  wrapDiffuse: screenAmbientLightWrapDiffuse.value,
  backlight: screenAmbientLightBacklight.value,
  translucentWrap: screenAmbientLightTranslucentWrap.value,
}))
const mouseFocus = useLive2DEyeFocusFor({
  canvas: () => live2dCanvasRef.value?.canvasElement(),
  model: () => ({
    normalizedScale: live2dModelRef.value?.modelNormalizeParams.scale ?? 1,
    modelWidth: live2dModelRef.value?.initialModelWidth ?? 1000,
    modelHeight: live2dModelRef.value?.initialModelHeight ?? 1000,
  }),
  source: activeCursorPosition,
})
watch(() => props.cursorPosition, (cursorPosition) => {
  activeCursorPosition.value = cursorPosition ? { ...cursorPosition } : null
  // Natural eases its own attention, so its cursor clears only when the host stops reporting one; an expiry would snap the gaze away.
  cursorExpiry.onCursor(live2dMotionDriver.value, activeCursorPosition.value !== null)
})

watch(live2dMotionDriver, (driver, previousDriver) => {
  cursorExpiry.onDriverChange(previousDriver, driver, activeCursorPosition.value !== null)
})

onUnmounted(() => {
  cursorExpiry.dispose()
})

watch([componentStateModel, componentStateCanvas], () => {
  componentState.value = (componentStateModel.value === 'mounted' && componentStateCanvas.value === 'mounted')
    ? 'mounted'
    : 'loading'
})

defineExpose({
  canvasElement: () => {
    return live2dCanvasRef.value?.canvasElement()
  },
  captureFrame: () => {
    return live2dCanvasRef.value?.captureFrame()
  },
  /** Queues a Natural emotion impulse. Callers use it only while the Natural driver is selected. */
  setEmotion: (episode: NaturalEpisode) => live2dModelRef.value?.setEmotion(episode),
  applySlots: (commands: SlotCommand[], now: number) => live2dModelRef.value?.applySlots(commands, now),
  applyHolds: (commands: HoldCommand[], now: number) => live2dModelRef.value?.applyHolds(commands, now),
  onSpeech: (event: SpeechEvent, turnId: string, now: number) => live2dModelRef.value?.onSpeech(event, turnId, now),
  setMuted: (muted: boolean) => live2dModelRef.value?.setMuted(muted),
  getMood: () => live2dModelRef.value?.getMood() ?? null,
})
</script>

<template>
  <Screen v-slot="{ width, height }" relative>
    <Live2DCanvas
      ref="live2dCanvasRef"
      v-slot="{ app }"
      v-model:state="componentStateCanvas"
      :background-url="props.backgroundUrl"
      :width="width"
      :height="height"
      :resolution="live2dRenderScale"
      :max-fps="live2dMaxFps"
      @error="emit('error', $event)"
    >
      <Live2DModel
        ref="live2dModelRef"
        v-model:state="componentStateModel"
        :model-src="modelSrc"
        :model-id="modelId"
        :app="app"
        :mouth-open-size="mouthOpenSize"
        :now-speaking="nowSpeaking"
        :width="width"
        :height="height"
        :paused="paused"
        :focus-at="mouseFocus"
        :eye-tracking="universalMotionEnabled && live2dEyeTracking"
        :eye-focus-source-active="(universalMotionEnabled || live2dMotionDriver === 'natural') && !!activeCursorPosition"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        :live2d-idle-animation-enabled="universalMotionEnabled && live2dIdleAnimationEnabled"
        :live2d-force-idle-eye-animation="universalMotionEnabled && live2dForceIdleEyeAnimation"
        :live2d-auto-blink-enabled="live2dAutoBlinkEnabled && live2dMotionDriver !== 'natural'"
        :live2d-force-auto-blink-enabled="live2dForceAutoBlinkEnabled && live2dMotionDriver !== 'natural'"
        :natural-auto-blink="live2dAutoBlinkEnabled"
        :performance="props.performance"
        :natural-energy="props.naturalEnergy ?? live2dNaturalEnergy"
        :natural-emotion-strength="live2dNaturalEmotionStrength[props.modelId ?? '']"
        :performance-settings="props.performanceSettings"
        :screen-placement="props.screenPlacement"
        :live2d-expression-enabled="live2dExpressionEnabled"
        :live2d-shadow-enabled="live2dShadowEnabled"
        :screen-ambient-light-active="screenAmbientLightEnabled && screenAmbientLightActive"
        :screen-ambient-light-filter-options="screenAmbientLightFilterOptions"
        :screen-ambient-light-environment="screenAmbientLightEnvironment"
        :screen-ambient-light-subject="screenAmbientLightSubject"
        :screen-ambient-light-mode="screenAmbientLightMode"
        :screen-ambient-light-strength="screenAmbientLightStrength"
        :screen-ambient-light-squint="screenAmbientLightSquint"
        @error="emit('error', $event)"
        @touch="emit('touch', $event)"
      />
      <Live2DPresenceBubble
        v-if="app"
        :app="app"
        :head-anchor="() => live2dModelRef?.headAnchor()"
        :state="props.presence"
        :width="width"
        :height="height"
        :resolution="live2dRenderScale"
      />
    </Live2DCanvas>
  </Screen>
</template>
