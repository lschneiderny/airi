<script setup lang="ts">
import type { ChatReadIntent, TouchReactionIntent, TouchReport } from '@proj-airi/character-mind'
import type { FaceBaseline } from '@proj-airi/motion-driver-natural/baseline'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { CursorOrder, CursorReport } from '@proj-airi/motion-driver-natural/cursor-notice'
import type { IdleBehaviourReport, IdleCueKind, NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleErrandReport } from '@proj-airi/motion-driver-natural/idle-errands'
import type { IdleOrder, IdleReport } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { PresenceBubbleState } from '@proj-airi/stage-shared'
import type { ExpressionPerformanceSettings, HoldCommand, ItemRenderState, MoodDose, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

import type { Live2DEyeFocusSource, Live2DTouch } from '../../composables/live2d'
import type { SpeechEvent } from '../../composables/live2d/expression/slots'
import type { Live2DStageItem } from '../../composables/live2d/items/layer'
import type { NaturalChatActivity, NaturalChatTarget } from '../../composables/live2d/natural-chat-input'
import type { Live2DContext } from '../../contexts/live2d'

import { NO_CAPABILITIES } from '@proj-airi/character-mind'
import { presenceBubbleIdle } from '@proj-airi/stage-shared'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { useScreenAmbientLightEnvironment, useSettingsScreenAmbientLight } from '@proj-airi/stage-shared/stores/screen-ambient-light'
import { Screen } from '@proj-airi/ui'
import { useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'

import Live2DCanvas from './live2d/Canvas.vue'
import Live2DModel from './live2d/Model.vue'
import Live2DPresenceBubble from './live2d/presence-bubble.vue'

import { createLive2DTouchGestureTracker, useLive2DEyeFocusFor, useLive2DNaturalSettings, useSettingsLive2d } from '../../composables/live2d'
import { LIVE2D_NATURAL_CAPABILITIES } from '../../composables/live2d/natural-motion-adapter'
import { createLive2D, provideLive2D } from '../../contexts/live2d'
import { useExpressionStore } from '../../stores/expression-store'
import { createCursorExpiry } from './live2d/cursor-expiry'

import '../../utils/live2d-zip-loader'
import '../../utils/live2d-opfs-registration'

const props = withDefaults(defineProps<{
  cursorPosition?: Live2DEyeFocusSource
  /** Controls of this renderer. The scene owns a new context when this is not set. */
  context?: Live2DContext
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
  /** Decision permissions supplied by the stage's character-behavior document. */
  idleActivities?: boolean
  touchReactions?: boolean
  cursorAttention?: boolean
  chatAttention?: boolean
  /** Displays and window content bounds in Electron DIP screen coordinates; Natural reads them for screen placement. */
  screenPlacement?: { displays: PlacementRect[], windowBounds: PlacementRect }
  /** The host's chat window, visible or not, in the same DIP space; hosts without one leave it undefined. */
  chatTarget?: NaturalChatTarget
  /** Typing timing and typed-send counters from the host's composers; never text. */
  chatActivity?: NaturalChatActivity
  /** Stage items drawn inside her render pass, with their library URLs; the host owns the URLs. */
  items?: readonly Live2DStageItem[]
}>(), {
  presence: () => presenceBubbleIdle,
  performance: () => ({ mode: 'idle', attention: 'camera', away: false }),
  naturalEnergy: undefined,
  performanceSettings: () => defaultExpressionPerformanceSettings,
  idleActivities: true,
  touchReactions: true,
  cursorAttention: true,
  chatAttention: true,
  items: () => [],
  paused: false,
  mouthOpenSize: 0,
  nowSpeaking: false,
  themeColorsHue: 220.44,
  themeColorsHueDynamic: false,
})

const emit = defineEmits<{
  error: [error: Error]
  /** A pointer tapped the character, or stroked its head. The model already plays its own reaction from the press. */
  touch: [touch: Live2DTouch]
  /** A poke or pet the Natural classifier recognized. The stage answers with `reactToTouch`; nothing shows before it. */
  naturalTouch: [report: TouchReport]
  idle: [report: IdleBehaviourReport]
  errand: [report: IdleErrandReport]
  idleReports: [reports: readonly IdleReport[]]
  cursorReports: [reports: readonly CursorReport[]]
  /** How each shown item attached to her model. */
  itemStates: [states: Readonly<Record<string, ItemRenderState>>]
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const componentStateCanvas = defineModel<'pending' | 'loading' | 'mounted'>('canvasState', { default: 'pending' })
const componentStateModel = defineModel<'pending' | 'loading' | 'mounted'>('modelState', { default: 'pending' })

const live2d = props.context ?? createLive2D()
provideLive2D(live2d)

const live2dCanvasRef = ref<InstanceType<typeof Live2DCanvas>>()
const live2dModelRef = ref<InstanceType<typeof Live2DModel>>()
/** The stage's mood seed, kept here so a model that mounts later (a model switch) is seeded too. */
let moodSource: (() => Omit<MoodDose, 'id'>) | undefined
watch(live2dModelRef, (model) => {
  if (model && moodSource)
    model.seedMood(moodSource)
})
// Her model canvas at load, before the stage scales her, is the unit of item placement; the panel reads it.
const expressionStore = useExpressionStore()
watch(
  () => [live2dModelRef.value?.initialModelWidth ?? 0, live2dModelRef.value?.initialModelHeight ?? 0] as const,
  ([width, height]) => expressionStore.setModelCanvas({ width, height }),
  { immediate: true },
)
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
  live2dExpressionActive,
  live2dMaxFps,
  live2dRenderScale,
  live2dShadowEnabled,
} = storeToRefs(useSettingsLive2d())
const naturalSettings = useLive2DNaturalSettings()
const capabilities = computed(() => live2dMotionDriver.value === 'natural' ? LIVE2D_NATURAL_CAPABILITIES : NO_CAPABILITIES)
const universalMotionEnabled = computed(() => live2dMotionDriver.value === 'universal')
const magicMotionEnabled = computed(() => live2dMotionDriver.value === 'magic')
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

const touchGestures = createLive2DTouchGestureTracker()
// One decider for each driver. Under Natural, the pokes and pets of the model are the only reaction to a touch,
// so no gesture starts here: no pointer capture, no reaction, no touch motion, and no `touch` event.
const touchGesturesActive = computed(() => !capabilities.value.posture)

function touchSampleOf(event: PointerEvent) {
  const rect = live2dCanvasRef.value?.canvasElement()?.getBoundingClientRect()
  const hit = rect
    ? live2dModelRef.value?.touchAt({
        x: (event.clientX - rect.left) * live2dRenderScale.value,
        y: (event.clientY - rect.top) * live2dRenderScale.value,
      })
    : undefined
  return { x: event.clientX, y: event.clientY, atMs: event.timeStamp, hit }
}

function emitTouch(touch: Live2DTouch | undefined) {
  if (touch)
    emit('touch', touch)
}

// One gesture at a time. `isPrimary` holds for each pointer type, so a mouse and a touch can both be primary.
// A new press during a gesture is ignored, and pointer capture makes sure the release of the gesture arrives.
let gesturePointerId: number | undefined
/** True when the press of the current gesture landed on the character. */
let gestureOnCharacter = false

function endGesture() {
  gesturePointerId = undefined
  gestureOnCharacter = false
}

function cancelGesture() {
  endGesture()
  touchGestures.cancel()
}

// A paused stage does not advance the motion clock, so a reaction would wait and then play late.
watch([() => props.paused, touchGesturesActive], ([paused, active]) => {
  if (paused || !active)
    cancelGesture()
})

useEventListener(() => live2dCanvasRef.value?.canvasElement(), 'pointerdown', (event: PointerEvent) => {
  if (!touchGesturesActive.value || props.paused || gesturePointerId !== undefined || !event.isPrimary || event.button !== 0)
    return
  gesturePointerId = event.pointerId
  try {
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
  }
  catch {
    // A pointer that already ended cannot be captured. Its release does not come, and lostpointercapture ends the gesture.
  }
  const sample = touchSampleOf(event)
  gestureOnCharacter = !!sample.hit
  touchGestures.down(sample)
  // A tap is known only on release, about 100 ms later. The reaction starts on the press, so it does not lag.
  if (sample.hit)
    live2dModelRef.value?.react({ ...sample.hit, gesture: 'tap' })
})
useEventListener(() => live2dCanvasRef.value?.canvasElement(), 'pointermove', (event: PointerEvent) => {
  // The primary button is held while the pointer strokes.
  if (event.pointerId !== gesturePointerId || event.buttons % 2 !== 1)
    return
  const pat = touchGestures.move(touchSampleOf(event))
  if (pat)
    live2dModelRef.value?.react(pat)
  emitTouch(pat)
})
useEventListener(() => live2dCanvasRef.value?.canvasElement(), 'pointerup', (event: PointerEvent) => {
  if (event.pointerId !== gesturePointerId)
    return
  endGesture()
  const tap = touchGestures.up(touchSampleOf(event))
  if (tap)
    live2dModelRef.value?.playTouchMotion(tap.region)
  emitTouch(tap)
})
useEventListener(() => live2dCanvasRef.value?.canvasElement(), ['pointercancel', 'lostpointercapture'], (event: PointerEvent) => {
  if (event.pointerId === gesturePointerId)
    cancelGesture()
})
// A pan of the page cancels the pointer and ends the pat. Only a touch on the character holds the page.
// `touch-action: none` would also stop the scroll over the empty canvas. touchstart comes after pointerdown.
useEventListener(() => live2dCanvasRef.value?.canvasElement(), 'touchstart', (event: TouchEvent) => {
  if (gestureOnCharacter && event.cancelable)
    event.preventDefault()
}, { passive: false })

onUnmounted(() => {
  cursorExpiry.dispose()
  if (!props.context)
    live2d.dispose()
})

watch([componentStateModel, componentStateCanvas], () => {
  componentState.value = (componentStateModel.value === 'mounted' && componentStateCanvas.value === 'mounted')
    ? 'mounted'
    : 'loading'
})

defineExpose({
  capabilities,
  canvasElement: () => {
    return live2dCanvasRef.value?.canvasElement()
  },
  captureFrame: () => {
    return live2dCanvasRef.value?.captureFrame()
  },
  /** Queues a Natural emotion impulse. Callers use it only while the Natural driver is selected. */
  setEmotion: (episode: NaturalEpisode) => live2dModelRef.value?.setEmotion(episode),
  gesture: (kind: CueGestureKind, count: number) => live2dModelRef.value?.gesture(kind, count),
  addMood: (dose: MoodDose) => live2dModelRef.value?.addMood(dose),
  /** Natural only: seeds every Natural controller of this scene from the mind's mood. */
  seedMood: (source: () => Omit<MoodDose, 'id'>) => {
    moodSource = source
    live2dModelRef.value?.seedMood(source)
  },
  /** Natural only: performs the mind's reaction to a touch this scene reported. */
  reactToTouch: (intent: TouchReactionIntent) => live2dModelRef.value?.reactToTouch(intent),
  /** Natural only: ends a sleep with the gentle wake; ignored while she is awake. */
  wakeFromSleep: () => live2dModelRef.value?.wakeFromSleep(),
  /** Natural only: a brief reaction to the desktop; `wake` also rouses her from sleep with a start. */
  reactToDesktop: (reaction: 'wake' | 'screen-change') => live2dModelRef.value?.reactToDesktop(reaction),
  /** Natural only: reads the chat, as the character mind decided. */
  chatRead: (intent: ChatReadIntent) => live2dModelRef.value?.chatRead(intent),
  setFaceBaseline: (baseline: FaceBaseline) => live2dModelRef.value?.setFaceBaseline(baseline),
  setIdleDrive: (drive: NaturalIdleDrive | null) => live2dModelRef.value?.setIdleDrive(drive),
  idleCue: (kind: IdleCueKind, intentId: string) => live2dModelRef.value?.idleCue(kind, intentId),
  idle: (order: IdleOrder) => live2dModelRef.value?.idle(order),
  beat: (intervalSeconds: number) => live2dModelRef.value?.beat(intervalSeconds),
  cursorEpisode: (order: CursorOrder) => live2dModelRef.value?.cursorEpisode(order),
  answerIdleErrand: (seq: number, outcome: 'done' | 'refused') => live2dModelRef.value?.answerIdleErrand(seq, outcome),
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
        :eye-focus-source-active="!!activeCursorPosition"
        :focus-bias="magicMotionEnabled && live2dEyeTracking"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        :live2d-idle-animation-enabled="universalMotionEnabled && live2dIdleAnimationEnabled"
        :live2d-force-idle-eye-animation="universalMotionEnabled && live2dForceIdleEyeAnimation"
        :live2d-auto-blink-enabled="live2dAutoBlinkEnabled && live2dMotionDriver !== 'natural'"
        :live2d-force-auto-blink-enabled="live2dForceAutoBlinkEnabled && live2dMotionDriver !== 'natural'"
        :natural-auto-blink="live2dAutoBlinkEnabled"
        :performance="props.performance"
        :natural-energy="props.naturalEnergy ?? naturalSettings.document.energy"
        :natural-emotion-strength="naturalSettings.document.emotionStrength[props.modelId ?? '']"
        :performance-settings="props.performanceSettings"
        :idle-activities="props.idleActivities"
        :touch-reactions="props.touchReactions"
        :cursor-attention="props.cursorAttention"
        :chat-attention="props.chatAttention"
        :screen-placement="props.screenPlacement"
        :chat-target="props.chatTarget"
        :chat-activity="props.chatActivity"
        :live2d-expression-enabled="live2dExpressionActive"
        :live2d-shadow-enabled="live2dShadowEnabled"
        :screen-ambient-light-active="screenAmbientLightEnabled && screenAmbientLightActive"
        :screen-ambient-light-filter-options="screenAmbientLightFilterOptions"
        :screen-ambient-light-environment="screenAmbientLightEnvironment"
        :screen-ambient-light-subject="screenAmbientLightSubject"
        :screen-ambient-light-mode="screenAmbientLightMode"
        :screen-ambient-light-strength="screenAmbientLightStrength"
        :screen-ambient-light-squint="screenAmbientLightSquint"
        :items="props.items"
        @error="emit('error', $event)"
        @touch="emit('naturalTouch', $event)"
        @idle="emit('idle', $event)"
        @errand="emit('errand', $event)"
        @idle-reports="emit('idleReports', $event)"
        @cursor-reports="emit('cursorReports', $event)"
        @item-states="emit('itemStates', $event)"
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
