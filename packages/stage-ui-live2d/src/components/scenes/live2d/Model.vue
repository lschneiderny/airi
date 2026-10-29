<script setup lang="ts">
import type { Application } from '@pixi/app'
import type { Filter } from '@pixi/core'
import type { ExpressionPerformanceSettings, HoldCommand, PerformanceEmotion, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type {
  AmbientLightEnvironment,
  AmbientLightFilterOptions,
  NormalizedRectangle,
  ScreenAmbientLightMode,
} from '@proj-airi/stage-shared/screen-ambient-light'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { Cubism4MotionManager } from 'pixi-live2d-display/cubism4'

import type { PixiLive2DInternalModel } from '../../../composables/live2d'
import type { ArchiveExpressionFile, Model3ExpressionRef } from '../../../composables/live2d/expression-controller'
import type { SpeechEvent } from '../../../composables/live2d/expression/slots'
import type { Live2DModelCanvasRect } from '../../../composables/live2d/head-anchor'
import type { NaturalChatActivity, NaturalChatTarget } from '../../../composables/live2d/natural-chat-input'
import type { NaturalChatInput } from '../../../composables/live2d/natural-motion'
import type { Live2DNaturalMotionAttention } from '../../../composables/live2d/natural-motion-adapter'
import type { NaturalMotionObserver } from '../../../composables/live2d/natural-motion/frame-types'
import type { NaturalEpisode } from '../../../composables/live2d/natural-motion/mood'
import type { PhysicsRigLike } from '../../../composables/live2d/natural-motion/rig-profile'
import type { Live2DTouchDebugOverlay, Live2DTouchDebugSource } from '../../../composables/live2d/touch-debug'
import type { Live2DTouchEvent, Live2DTouchSample } from '../../../composables/live2d/touch-gestures'
import type { NaturalCaptureRequest } from '../../../stores'

import { errorMessageFrom } from '@moeru/std'
import { Point } from '@pixi/math'
import { listenBeatSyncBeatSignal } from '@proj-airi/stage-shared/beat-sync'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { ambientLightDefaults, ambientLightNeutralEnvironment, ambientLightPerceptualLevel, wholeWindowRectangle } from '@proj-airi/stage-shared/screen-ambient-light'
import { screenInwardness } from '@proj-airi/stage-shared/stage-placement'
import { useTheme } from '@proj-airi/ui'
import { until, useRafFn } from '@vueuse/core'
import { animate } from 'animejs'
import { formatHex } from 'culori'
import { Mutex } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { DropShadowFilter } from 'pixi-filters'
import { Live2DFactory, Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, toRef, watch } from 'vue'

import TouchDebugOverlay from './touch-debug-overlay.vue'

import {
  createBeatSyncController,
  createLive2DHeadTracker,
  createLive2DMotionSpring,
  disableLive2DSdkBreath,
  live2DCanvasRectToParent,
  useExpressionController,
  useLive2DMotionManagerUpdate,
  useMotionUpdatePluginAutoEyeBlink,
  useMotionUpdatePluginBeatSync,
  useMotionUpdatePluginBreathControl,
  useMotionUpdatePluginExpression,
  useMotionUpdatePluginIdleDisable,
  useMotionUpdatePluginIdleFocus,
  useMotionUpdatePluginLightSquint,
  useMotionUpdatePluginLipSync,
  useMotionUpdatePluginManualControl,
  useSettingsLive2d,
} from '../../../composables/live2d'
import { EmotionHoldPerformer, selectManualHold } from '../../../composables/live2d/expression/hold'
import { useFitModel } from '../../../composables/live2d/fit-model'
import { live2DCanvasRectToViewport } from '../../../composables/live2d/head-anchor'
import { createUnfoldCounter, naturalChatInput } from '../../../composables/live2d/natural-chat-input'
import { Live2DNaturalMotionAdapter } from '../../../composables/live2d/natural-motion-adapter'
import { scoreLiveliness } from '../../../composables/live2d/natural-motion/liveliness'
import { manualControlParameterIds, readLive2DRigProfile } from '../../../composables/live2d/natural-motion/rig-profile'
import { NaturalTraceRecorder } from '../../../composables/live2d/natural-motion/trace'
import { chatTargetOffset, headScreenX, ScreenPlacement } from '../../../composables/live2d/screen-placement'
import { buildLive2DTouchDebug } from '../../../composables/live2d/touch-debug'
import { Live2DTouchGestures } from '../../../composables/live2d/touch-gestures'
import { live2DTouchRegionAt, live2DVisibleBounds, scaleLive2DRect } from '../../../composables/live2d/touch-regions'
import { Emotion, EmotionNeutralMotionName } from '../../../constants/emotions'
import { ScreenAmbientLightFilter } from '../../../filters/screen-ambient-light'
import { getLive2DMotionControlModelOffset, useL2dViewControl, useLive2DMotionControl, useLive2dParams, useNaturalMotionDiagnostics } from '../../../stores'
import { useExpressionStore } from '../../../stores/expression-store'
import { readParameterDisplayNames } from '../../../utils/expression-catalog/display-names'
import { findFreeParameters } from '../../../utils/expression-catalog/free-parameters'
import { naturalVoiceLevel } from './natural-voice-level'

type CubismMotionCurve = NonNullable<NonNullable<Cubism4MotionManager['motionGroups'][string]>[number]>['_motionData']['curves'][number]

const props = withDefaults(defineProps<{
  modelSrc?: string
  modelId?: string

  app?: Application
  mouthOpenSize?: number
  nowSpeaking?: boolean
  width: number
  height: number
  paused?: boolean
  focusAt?: { x: number, y: number }
  eyeTracking?: boolean
  eyeFocusSourceActive?: boolean
  themeColorsHue?: number
  themeColorsHueDynamic?: boolean
  live2dIdleAnimationEnabled?: boolean
  live2dForceIdleEyeAnimation?: boolean
  live2dAutoBlinkEnabled?: boolean
  live2dForceAutoBlinkEnabled?: boolean
  live2dExpressionEnabled?: boolean
  live2dShadowEnabled?: boolean
  screenAmbientLightActive?: boolean
  screenAmbientLightFilterOptions?: AmbientLightFilterOptions
  screenAmbientLightEnvironment?: AmbientLightEnvironment
  screenAmbientLightSubject?: NormalizedRectangle
  screenAmbientLightMode?: ScreenAmbientLightMode
  screenAmbientLightStrength?: number
  screenAmbientLightSquint?: number
  /** Resolved by the stage; the Natural driver reads it every frame to pick mode amplitude and gaze. */
  performance?: PerformanceState
  /** Natural energy 0..1, 0.5 neutral. */
  naturalEnergy?: number
  /**
   * The user's auto-blink setting before the scene masks the blink plugin props in Natural.
   * Natural's own blink scheduler blinks only while it is true.
   */
  naturalAutoBlink?: boolean
  /** Expression-performance switches and tunables; Natural and the expression slots apply them on change. */
  performanceSettings?: ExpressionPerformanceSettings
  /** This model's per-emotion strength multipliers from the user's settings; absent means 1 for every emotion. */
  naturalEmotionStrength?: Partial<Record<PerformanceEmotion, number>>
  /**
   * Displays and this window's content bounds in Electron DIP screen coordinates. Natural turns the head toward
   * the screen interior while the screen-aware setting is on; hosts without window bounds leave it undefined.
   */
  screenPlacement?: { displays: PlacementRect[], windowBounds: PlacementRect }
  /**
   * The host's chat window: shown or not, and its bounds in the same DIP space as `screenPlacement`. Natural looks at
   * it while the screen-aware setting is on; hosts without a chat window target (web, pocket) leave it undefined.
   */
  chatTarget?: NaturalChatTarget
  /** Typing timing and typed-send counters from the host's composers; never text. */
  chatActivity?: NaturalChatActivity
}>(), {
  mouthOpenSize: 0,
  nowSpeaking: false,
  paused: false,
  focusAt: () => ({ x: 0, y: 0 }),
  eyeTracking: false,
  eyeFocusSourceActive: false,
  disableFocusAt: false,
  scale: 1,
  themeColorsHue: 220.44,
  themeColorsHueDynamic: false,
  live2dIdleAnimationEnabled: true,
  live2dForceIdleEyeAnimation: true,
  live2dAutoBlinkEnabled: true,
  live2dForceAutoBlinkEnabled: false,
  live2dExpressionEnabled: true,
  live2dShadowEnabled: true,
  screenAmbientLightActive: false,
  screenAmbientLightFilterOptions: () => ({ ...ambientLightDefaults.filter }),
  screenAmbientLightEnvironment: () => ambientLightNeutralEnvironment,
  screenAmbientLightSubject: () => wholeWindowRectangle,
  screenAmbientLightMode: ambientLightDefaults.mode,
  screenAmbientLightStrength: ambientLightDefaults.strength,
  screenAmbientLightSquint: ambientLightDefaults.squint,
  performance: () => ({ mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }),
  naturalEnergy: 0.5,
  naturalAutoBlink: true,
  performanceSettings: () => defaultExpressionPerformanceSettings,
})

const emits = defineEmits<{
  (e: 'modelLoaded'): void
  (e: 'error', error: Error): void
  /** A poke or pet the Natural driver reacted to; nothing else consumes it yet. */
  (e: 'touch', event: Live2DTouchEvent): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const { position, scale } = useL2dViewControl()
const {
  breathControl: manualBreathControl,
  control: manualMotionControl,
  exclusiveOwnerId,
} = storeToRefs(useLive2DMotionControl())
const { live2dMotionDriver, live2dNaturalCursorAttention, live2dNaturalScreenAwareness, live2dNaturalTouch, live2dNaturalTouchPetRequiresHold, live2dNaturalTouchHeadScale } = storeToRefs(useSettingsLive2d())
const naturalDiagnostics = useNaturalMotionDiagnostics()
const { pendingRequest: naturalCaptureRequest } = storeToRefs(naturalDiagnostics)
let naturalMotion: Live2DNaturalMotionAdapter | undefined
/** The chat input the latest composition handed to Natural; published to diagnostics after the adapter step. */
let composedChat: NaturalChatInput | null = null
/** Owned by the loaded model; replaced on load and cleared before destruction. */
let rebuildNaturalMotion: (() => void) | undefined
/** A capture can span an adapter rebuild; reattach its observer without restarting the recorder. */
let naturalCaptureObserver: NaturalMotionObserver | null = null
/** Detaches the running trace capture without answering it; set only while a capture runs. */
let stopNaturalCapture: (() => void) | undefined
const localFocus = new Point()
/** Hidden -> visible transitions of the host's chat; the first observation only records visibility. */
const chatUnfolds = createUnfoldCounter()
watch(() => props.chatTarget?.visible, (visible) => {
  if (visible !== undefined)
    chatUnfolds.observe(visible)
}, { immediate: true })

/** Emotions for the Natural driver; the adapter drains the queue on its next composition. */
const pendingNaturalEmotions: NaturalEpisode[] = []
/** Pokes for the Natural driver; the adapter drains the queue like the emotion queue. */
const pendingNaturalPokes: Live2DNaturalMotionAttention['pendingPokes'] = []
/** Hand position relative to the head center while the user pets it, read on every composition. */
let naturalPetHand: { x: number, y: number } | null = null
const touchGestures = new Live2DTouchGestures({ requireHold: live2dNaturalTouchPetRequiresHold.value })
const touchPoint = new Point()
/** Head and body boxes in model canvas space, re-measured at most every 100 ms while the pointer moves. */
let touchRegions: { head: Live2DModelCanvasRect | undefined, unscaledHead: Live2DModelCanvasRect | undefined, eyeAnchor: { x: number, y: number } | undefined, body: Live2DModelCanvasRect | undefined, source: Live2DTouchDebugSource, measuredAtMs: number } | undefined
const touchRegionsMaxAgeMs = 100
/** Latest primary pointermove over the canvas in model canvas space, stamped with `performance.now()`. */
let latestPointer: { x: number, y: number, atMs: number } | undefined
/** A pointer sample younger than this drives Natural attention instead of the host cursor mapping. */
const pointerFreshMs = 100
/** Parameter ids the playing explicit clip animates; Natural masks them. Empty while no clip plays. */
let clipOwnedIds: ReadonlySet<string> = new Set<string>()
/** Latest SDK timestamp (seconds) seen by the Natural frame hook; NaN before the first frame of a model. */
let sdkNowSeconds = Number.NaN
/** SDK seconds at which assistant speech last ended on the loaded model, for Natural's mouth handoff. */
let speechEndedAtSeconds: number | null = null

const modelSrcRef = toRef(() => props.modelSrc)

const modelLoading = ref(false)
// NOTICE: boolean is sufficient; this flag is only used inside loadModel to bail out if the component unmounts mid-load.
let isUnmounted = false

const modelLoadMutex = new Mutex()

const manualMotionSpring = createLive2DMotionSpring()
const manualControlOffset = computed(() => getLive2DMotionControlModelOffset(manualMotionSpring.output.value))
const offset = computed(() => ({
  x: (position.value.x / 100) * props.width + manualControlOffset.value.x,
  y: -(position.value.y / 100) * props.height + manualControlOffset.value.y,
}))

const pixiApp = toRef(() => props.app)
const paused = toRef(() => props.paused)
const focusAt = toRef(() => props.focusAt)
const model = shallowRef<Live2DModel<PixiLive2DInternalModel>>()
const initialModelWidth = ref<number>(0)
const initialModelHeight = ref<number>(0)
const mouthOpenSize = computed(() => Math.max(0, Math.min(100, props.mouthOpenSize)))
const nowSpeaking = toRef(() => props.nowSpeaking)
const lastUpdateTime = ref(0)

const { isDark: dark } = useTheme()

/** Shadow opacity over a black screen, before the exposure fades it. */
const dropShadowBaseAlpha = 0.2

/**
 * Softness of the drop shadow, in pixels.
 *
 * At 0 the shadow is a hard copy of the silhouette, offset by its distance. A
 * dark desktop hides that copy at this opacity, but over a white window it
 * reads as a second character. It also carries the theme hue: measured over
 * white, the hard shadow took the band beside the character to red 242.3 while
 * blue stayed at 252.7, which shows as a cyan edge.
 */
const dropShadowBlur = 10

/**
 * How much a bright screen fades the drop shadow out.
 *
 * The shadow separates the character from the desktop, and the light wrap
 * blends the same edge. A bright desktop is where the shadow is most visible,
 * so it recedes there and keeps full strength over a dark desktop.
 */
const dropShadowExposureFalloff = 0.75

const dropShadowFilter = shallowRef(new DropShadowFilter({
  alpha: dropShadowBaseAlpha,
  blur: dropShadowBlur,
  distance: 20,
  rotation: 45,
}))
const screenAmbientLightFilter = shallowRef(new ScreenAmbientLightFilter())

let resizeAnimation: ReturnType<typeof animate> | undefined

const modelNormalizeParams = useFitModel(
  () => ({ width: props.width, height: props.height }),
  () => ({ width: initialModelWidth.value, height: initialModelHeight.value }),
)

watch([offset, scale, modelNormalizeParams], () => {
  setScaleAndPosition()
})

function setScaleAndPosition(animated = false) {
  if (!model.value)
    return

  const normalized = modelNormalizeParams.value

  if (!animated) {
    model.value.scale.set(normalized.scale * scale.value, normalized.scale * scale.value)
    model.value.x = normalized.x + offset.value.x
    model.value.y = normalized.y + offset.value.y
    return
  }

  resizeAnimation?.pause()

  const current = {
    scale: model.value.scale.x,
    x: model.value.x,
    y: model.value.y,
  }

  resizeAnimation = animate(current, {
    scale: normalized.scale * scale.value,
    x: normalized.x + offset.value.x,
    y: normalized.y + offset.value.y,
    duration: 200,
    ease: 'outQuad',
    onUpdate: () => {
      if (!model.value)
        return
      model.value.scale.set(current.scale, current.scale)
      model.value.x = current.x
      model.value.y = current.y
    },
  })
}

const live2dStore = useLive2dParams()
const {
  currentMotion,
  availableMotions,
  motionMap,
  modelParameters,
} = storeToRefs(live2dStore)

const themeColorsHue = toRef(() => props.themeColorsHue)
const themeColorsHueDynamic = toRef(() => props.themeColorsHueDynamic)
const live2dIdleAnimationEnabled = toRef(() => props.live2dIdleAnimationEnabled)
const live2dEyeTrackingEnabled = toRef(() => props.eyeTracking)
const live2dEyeFocusSourceActive = toRef(() => props.eyeFocusSourceActive)
const live2dForceIdleEyeAnimation = toRef(() => props.live2dForceIdleEyeAnimation)
const live2dAutoBlinkEnabled = toRef(() => props.live2dAutoBlinkEnabled)
const live2dForceAutoBlinkEnabled = toRef(() => props.live2dForceAutoBlinkEnabled)
const live2dExpressionEnabled = toRef(() => props.live2dExpressionEnabled)
const live2dShadowEnabled = toRef(() => props.live2dShadowEnabled)
const screenAmbientLightActive = toRef(() => props.screenAmbientLightActive)
const screenAmbientLightFilterOptions = toRef(() => props.screenAmbientLightFilterOptions)
const screenAmbientLightEnvironment = toRef(() => props.screenAmbientLightEnvironment)
const screenAmbientLightSubject = toRef(() => props.screenAmbientLightSubject)
const screenAmbientLightMode = toRef(() => props.screenAmbientLightMode)
const screenAmbientLightStrength = toRef(() => props.screenAmbientLightStrength)
const screenAmbientLightSquint = toRef(() => props.screenAmbientLightSquint)

// --- Expression controller
// Chooses which drawables stand in for the head once per model, so it is reset
// whenever the model is replaced.
const headTracker = createLive2DHeadTracker()
const internalModelRef = shallowRef<PixiLive2DInternalModel>()
const expressionStore = useExpressionStore()
// Hold lifetimes share the conductor's monotonic clock (`performance.now() / 1000`), which stamps
// hold commands; the adapter's accumulated motion time is a different clock.
const holdClock = () => performance.now() / 1000
const holdPerformer = new EmotionHoldPerformer()
/** Stable identity for the strengths of a model without customization. */
const defaultEmotionStrengths: Partial<Record<PerformanceEmotion, number>> = {}
// The preview of the latest manual toggle outranks the decider's lease while it lasts. Saved
// defaults (the rest set) are not toggles, so they never preview.
watch(() => selectManualHold({
  manualActive: expressionStore.manualActive,
  restSet: expressionStore.restSet,
  catalog: expressionStore.catalog,
  intensity: props.performanceSettings.intensity,
}), hold => holdPerformer.setManual(hold), { immediate: true })

/** Releases the lease of the model that goes away so another model never inherits its held face. */
function releaseHeldEmotion() {
  holdPerformer.applyHolds([{ emotion: null, strength: 0, holdSeconds: 0, until: 'hold' }], holdClock())
}
const expressionController = useExpressionController({
  internalModel: internalModelRef,
})
// This identity belongs to model.value. It changes only when a model load
// commits, so expression initialization cannot observe a newer prop by mistake.
let loadedModelId: string | undefined
// Saved SDK manager references for runtime expression toggle (restore on disable)
const savedEyeBlink = shallowRef<any>(null)
const savedExpressionManager = shallowRef<any>(null)

const localCurrentMotion = ref<{ group: string, index: number }>({ group: 'Idle', index: 0 })
const beatSync = createBeatSyncController({
  baseAngles: () => ({
    x: modelParameters.value.angleX,
    y: modelParameters.value.angleY,
    z: modelParameters.value.angleZ,
  }),
  initialStyle: 'sway-sine',
})

// Listen for model reload requests (e.g., when runtime motion is uploaded)
const disposeShouldUpdateView = live2dStore.onShouldUpdateView(() => {
  loadModel()
})

// The textures sit in the global Pixi texture cache under the model's blob URLs.
// Each cached texture holds a listener into the renderer that uploaded it, so a
// texture left there keeps that renderer's WebGL context and GPU memory alive.
function destroyModel(target: Live2DModel) {
  // The capture listens on this model's internal model, so it cannot outlive it.
  if (stopNaturalCapture) {
    stopNaturalCapture()
    if (naturalCaptureRequest.value)
      naturalDiagnostics.failCapture(naturalCaptureRequest.value.id, 'The Live2D model was unloaded during the capture.')
  }
  naturalMotion?.dispose()
  naturalMotion = undefined
  rebuildNaturalMotion = undefined
  releaseHeldEmotion()
  target.destroy({ texture: true, baseTexture: true })
}

async function loadModel() {
  await until(modelLoading).not.toBeTruthy()

  await modelLoadMutex.acquire()
  try {
    await performModelLoad()
  }
  finally {
    modelLoadMutex.release()
  }
}

async function performModelLoad() {
  modelLoading.value = true
  componentState.value = 'loading'

  if (!pixiApp.value || !pixiApp.value.stage) {
    try {
      // NOTICE: shouldUpdateView can fire while the canvas (pixiApp) is being torn down/recreated.
      // Wait briefly for the new stage instead of bailing out, otherwise we keep a blank screen.
      await until(() => !!pixiApp.value && !!pixiApp.value.stage).toBeTruthy({ timeout: 1500 })
    }
    catch {
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }
  }

  // REVIEW: here as await until(...) guarded the pixiApp and stage to be valid.
  if (model.value && pixiApp.value?.stage) {
    // Dispose expression controller before destroying the old model
    expressionController.dispose()
    internalModelRef.value = undefined
    loadedModelId = undefined
    naturalDiagnostics.setLoadedModelId(null)

    try {
      pixiApp.value.stage.removeChild(model.value)
      destroyModel(model.value)
    }
    catch (error) {
      console.warn('Error removing old model:', error)
    }
    model.value = undefined
    headTracker.reset()
    resetTouch(performance.now())
  }
  const pendingModel = {
    id: props.modelId,
    src: modelSrcRef.value,
  }
  if (!pendingModel.src) {
    console.warn('No Live2D model source provided.')
    modelLoading.value = false
    componentState.value = 'mounted'
    return
  }

  try {
    if (isUnmounted) {
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    const live2DModel = new Live2DModel<PixiLive2DInternalModel>()
    await Live2DFactory.setupLive2DModel(live2DModel, { url: pendingModel.src, id: pendingModel.id }, { autoInteract: false })
    // The unmount hook ran while the model was loading, so it had no model to destroy.
    if (isUnmounted) {
      destroyModel(live2DModel)
      return
    }

    availableMotions.value.forEach((motion) => {
      if (motion.motionName in Emotion) {
        motionMap.value[motion.fileName] = motion.motionName
      }
      else {
        motionMap.value[motion.fileName] = EmotionNeutralMotionName
      }
    })

    // --- Scene

    model.value = live2DModel
    // REVIEW: pixiApp and stage are guaranteed to be valid here due to the until(...) above.
    pixiApp.value!.stage.addChild(model.value)
    initialModelWidth.value = model.value.width
    initialModelHeight.value = model.value.height
    model.value.anchor.set(0.5, 0.5)
    setScaleAndPosition()

    // --- Interaction

    model.value.on('hit', (hitAreas) => {
      if (model.value && hitAreas.includes('body'))
        model.value.motion('tap_body')
    })

    // --- Motion

    const internalModel = model.value.internalModel
    const coreModel = internalModel.coreModel
    const motionManager = internalModel.motionManager
    disableLive2DSdkBreath(internalModel)
    coreModel.setParameterValueById('ParamMouthOpenY', mouthOpenSize.value)

    availableMotions.value = Object
      .entries(motionManager.definitions)
      .flatMap(([motionName, definition]) => (definition?.map((motion, index) => ({
        motionName,
        motionIndex: index,
        fileName: motion.File,
      })) || []))
      .filter(Boolean)

    // Check if user has selected a runtime motion to play as idle
    const selectedMotionGroup = localStorage.getItem('selected-runtime-motion-group')
    const selectedMotionIndex = localStorage.getItem('selected-runtime-motion-index')

    // Configure the selected motion to loop
    if (selectedMotionGroup !== null && selectedMotionIndex) {
      const groupIndex = (motionManager.groups as Record<string, string | undefined>)[selectedMotionGroup]
      if (groupIndex !== undefined && motionManager.motionGroups[groupIndex]) {
        const motionIndex = Number.parseInt(selectedMotionIndex)
        const motion = motionManager.motionGroups[groupIndex][motionIndex]
        if (motion && motion._looper) {
          // Force the motion to loop
          motion._looper.loopDuration = 0 // 0 means infinite loop
          console.info('Configured motion to loop infinitely:', selectedMotionGroup, motionIndex)
        }
      }
    }

    if (selectedMotionGroup !== null && selectedMotionIndex && live2dIdleAnimationEnabled.value) {
      setTimeout(() => {
        if (!live2dIdleAnimationEnabled.value)
          return
        console.info('Playing selected runtime motion:', selectedMotionGroup, selectedMotionIndex)
        currentMotion.value = {
          group: selectedMotionGroup,
          index: Number.parseInt(selectedMotionIndex),
        }
      }, 300)
    }

    // Remove eye ball movements from idle motion group to prevent conflicts
    // This is too hacky
    // FIXME: it cannot blink if loading a model only have idle motion
    if (motionManager.groups.idle) {
      motionManager.motionGroups[motionManager.groups.idle]?.forEach((motion) => {
        motion._motionData.curves.forEach((curve: CubismMotionCurve) => {
        // TODO: After emotion mapper, stage editor, eye related parameters should be take cared to be dynamical instead of hardcoding
          if (curve.id === 'ParamEyeBallX' || curve.id === 'ParamEyeBallY') {
            curve.id = `_${curve.id}`
          }
        })
      })
    }

    // This is hacky too
    const motionManagerUpdate = useLive2DMotionManagerUpdate({
      internalModel,
      motionManager,
      modelParameters,
      live2dEyeTrackingEnabled,
      live2dEyeFocusSourceActive,
      live2dIdleAnimationEnabled,
      live2dForceIdleEyeAnimation,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      lastUpdateTime,
    })

    motionManagerUpdate.register(ctx => expressionController.restoreExpressionBases(ctx.model), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginBeatSync(beatSync), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleDisable(), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleFocus(), 'post')
    // Both run in 'final' stage (ignores handled state).
    // Expression first: sets desired parameter values (e.g. closed eyes = 0).
    // Blink second: reads post-expression eye values, Multiply-modulates on top.
    // This ensures blink respects expression state (0 × blinkFactor = 0).
    motionManagerUpdate.register(useMotionUpdatePluginExpression(expressionController), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginAutoEyeBlink(live2dExpressionEnabled), 'final')
    // After the blink plugin, so that it only narrows the value a blink returns
    // to. The signal is the light behind the character, not the screen level:
    // that is a mean over the whole capture, and a bright window opening in a
    // far corner would otherwise reach the eyes.
    motionManagerUpdate.register(
      useMotionUpdatePluginLightSquint(
        () => ambientLightPerceptualLevel(screenAmbientLightEnvironment.value.behindLuminance),
        () => (screenAmbientLightActive.value ? screenAmbientLightSquint.value : 0),
      ),
      'final',
    )
    motionManagerUpdate.register(useMotionUpdatePluginManualControl(manualMotionControl, manualMotionSpring), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginLipSync(mouthOpenSize, nowSpeaking), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginBreathControl(manualBreathControl), 'final')
    // NOTICE:
    // Natural must know which parameters physics drives, and the parsed rig is only reachable
    // through the framework-internal `_physicsRig` field of the Cubism physics instance.
    // Source: pixi-live2d-display 0.4.0 types/index.d.ts (CubismPhysics._physicsRig).
    // Remove when pixi-live2d-display exposes the parsed physics rig through a public API.
    const readRigProfile = () => readLive2DRigProfile(coreModel.getModel().parameters, internalModel.physics?._physicsRig, (internalModel.settings as { _cdiData?: unknown })._cdiData)
    sdkNowSeconds = Number.NaN
    speechEndedAtSeconds = null
    clipOwnedIds = new Set<string>()
    pendingNaturalEmotions.length = 0
    pendingNaturalPokes.length = 0
    releaseHeldEmotion()
    /** Measured eye anchor and unscaled head width in model canvas px: the cursor unit, which the chat target shares. */
    const eyeUnit = () => {
      const regions = readTouchRegions(performance.now())
      const head = regions?.unscaledHead
      return {
        anchorX: regions?.eyeAnchor?.x ?? 0.5 * internalModel.originalWidth,
        anchorY: regions?.eyeAnchor?.y ?? 0.3 * internalModel.originalHeight,
        unit: head && head.width > 0 ? head.width : 0.3 * internalModel.originalWidth,
      }
    }
    const createNaturalAdapter = () => new Live2DNaturalMotionAdapter(
      internalModel,
      readRigProfile(),
      () => {
        let cursor = null
        // A fresh canvas pointer sample wins over the host cursor mapping, so gaze and touch share one input.
        const pointer = latestPointer && performance.now() - latestPointer.atMs < pointerFreshMs ? latestPointer : undefined
        // The controller decides what an aside or screen cue does with the cursor; the host only reports it.
        if (live2dNaturalCursorAttention.value && (props.eyeFocusSourceActive || pointer)) {
          if (pointer) {
            localFocus.set(pointer.x, pointer.y)
          }
          else {
            localFocus.set(props.focusAt.x, props.focusAt.y)
            live2DModel.toModelPosition(localFocus, localFocus)
          }
          // Offset from the measured eye anchor in head widths, y up; the user's touch scale never changes the cursor unit.
          const eye = eyeUnit()
          cursor = { x: (localFocus.x - eye.anchorX) / eye.unit, y: (eye.anchorY - localFocus.y) / eye.unit }
        }
        const placement = naturalPlacement()
        // A QA override other than `undefined` wins over the host's chat signal.
        const chatOverride = naturalDiagnostics.chatOverride
        const chat = chatOverride !== undefined
          ? chatOverride
          : naturalChatInput({
              enabled: live2dNaturalScreenAwareness.value,
              chatTarget: props.chatTarget,
              activity: props.chatActivity,
              unfoldSeq: chatUnfolds.seq,
              locate: bounds => locateChat(bounds, live2DModel, eyeUnit()),
            })
        composedChat = chat
        return {
          driver: live2dMotionDriver.value,
          exclusive: !!exclusiveOwnerId.value,
          manualActive: manualMotionControl.value.active,
          springActive: manualMotionSpring.output.value.active,
          performance: props.performance,
          energy: props.naturalEnergy,
          voice: { speaking: nowSpeaking.value, level: naturalVoiceLevel(mouthOpenSize.value), speechEndedAtSeconds },
          autoBlink: props.naturalAutoBlink,
          manualBreathActive: manualBreathControl.value.active,
          clipOwnedIds,
          pendingEmotions: pendingNaturalEmotions,
          heldEmotion: holdPerformer.current(holdClock()),
          emotionStrengths: props.naturalEmotionStrength ?? defaultEmotionStrengths,
          cursor,
          cursorDismissed: !live2dNaturalCursorAttention.value || props.performance.attention === 'aside',
          placement,
          chat,
          pendingPokes: pendingNaturalPokes,
          pet: naturalPetHand,
        }
      },
      document,
      Math.random,
      { home: naturalDiagnostics.postureHome },
    )
    let naturalAdapter = createNaturalAdapter()
    naturalMotion = naturalAdapter
    // QA reads the yaw bias of the step that just ran, not the one before it.
    naturalAdapter.onPlacementStep = naturalDiagnostics.reportPlacement
    naturalAdapter.setPaused(paused.value)
    naturalAdapter.setPerformanceSettings(props.performanceSettings)
    rebuildNaturalMotion = () => {
      naturalAdapter.natural.setObserver(null)
      naturalAdapter.dispose()
      naturalAdapter = createNaturalAdapter()
      naturalMotion = naturalAdapter
      naturalAdapter.onPlacementStep = naturalDiagnostics.reportPlacement
      naturalAdapter.setPaused(paused.value)
      naturalAdapter.setPerformanceSettings(props.performanceSettings)
      naturalAdapter.natural.setObserver(naturalCaptureObserver)
    }
    // Physics normally loads inside setupLive2DModel; a late load must still hand its outputs back to physics.
    live2DModel.on('physicsLoaded', () => naturalAdapter.setRigProfile(readRigProfile()))
    motionManagerUpdate.register((ctx) => {
      sdkNowSeconds = ctx.now
      // A pet ends and a held press commits as a poke while the pointer rests, which produces no pointer event.
      if (touchGestures.petting || touchGestures.pressPending)
        handleTouchEvents(touchGestures.update(performance.now()))
      naturalAdapter.frame(ctx.now)
      naturalDiagnostics.reportChat(composedChat)
    }, 'final')

    const hookedUpdate = motionManager.update as (model: PixiLive2DInternalModel['coreModel'], now: number) => boolean
    motionManager.update = function (model: PixiLive2DInternalModel['coreModel'], now: number) {
      return motionManagerUpdate.hookUpdate(model, now, hookedUpdate)
    }

    motionManager.on('motionStart', (group, index) => {
      localCurrentMotion.value = { group, index }
      // NOTICE:
      // Natural masks the channels the explicit clip animates, and the curve ids are only
      // reachable through the framework-internal `_motionData` (same access as the idle eyeball patch above).
      // Source: pixi-live2d-display 0.4.0 CubismMotion._motionData.
      // Remove when pixi-live2d-display exposes a motion's animated parameter ids.
      const curves: { id: string }[] = motionManager.motionGroups[group]?.[index]?._motionData.curves ?? []
      clipOwnedIds = new Set(curves.map(curve => curve.id))
    })

    // Listen for motion finish to restart runtime motion for looping
    motionManager.on('motionFinish', () => {
      clipOwnedIds = new Set<string>()
      const selectedMotionGroup = localStorage.getItem('selected-runtime-motion-group')
      const selectedMotionIndex = localStorage.getItem('selected-runtime-motion-index')

      if (selectedMotionGroup !== null && selectedMotionIndex && live2dIdleAnimationEnabled.value) {
        // Restart the selected runtime motion at once, so the loop has no gap
        console.info('Motion finished, restarting runtime motion:', selectedMotionGroup, selectedMotionIndex)
        // Use requestAnimationFrame to restart on the next frame for smooth transition
        requestAnimationFrame(() => {
          currentMotion.value = {
            group: selectedMotionGroup,
            index: Number.parseInt(selectedMotionIndex),
          }
        })
      }
    })

    // Apply all stored parameters to the model
    coreModel.setParameterValueById('ParamAngleX', modelParameters.value.angleX)
    coreModel.setParameterValueById('ParamAngleY', modelParameters.value.angleY)
    coreModel.setParameterValueById('ParamAngleZ', modelParameters.value.angleZ)
    coreModel.setParameterValueById('ParamEyeLOpen', modelParameters.value.leftEyeOpen)
    coreModel.setParameterValueById('ParamEyeROpen', modelParameters.value.rightEyeOpen)
    coreModel.setParameterValueById('ParamEyeSmile', modelParameters.value.leftEyeSmile)
    coreModel.setParameterValueById('ParamBrowLX', modelParameters.value.leftEyebrowLR)
    coreModel.setParameterValueById('ParamBrowRX', modelParameters.value.rightEyebrowLR)
    coreModel.setParameterValueById('ParamBrowLY', modelParameters.value.leftEyebrowY)
    coreModel.setParameterValueById('ParamBrowRY', modelParameters.value.rightEyebrowY)
    coreModel.setParameterValueById('ParamBrowLAngle', modelParameters.value.leftEyebrowAngle)
    coreModel.setParameterValueById('ParamBrowRAngle', modelParameters.value.rightEyebrowAngle)
    coreModel.setParameterValueById('ParamBrowLForm', modelParameters.value.leftEyebrowForm)
    coreModel.setParameterValueById('ParamBrowRForm', modelParameters.value.rightEyebrowForm)
    coreModel.setParameterValueById('ParamMouthOpenY', modelParameters.value.mouthOpen)
    coreModel.setParameterValueById('ParamMouthForm', modelParameters.value.mouthForm)
    coreModel.setParameterValueById('ParamCheek', modelParameters.value.cheek)
    coreModel.setParameterValueById('ParamBodyAngleX', modelParameters.value.bodyAngleX)
    coreModel.setParameterValueById('ParamBodyAngleY', modelParameters.value.bodyAngleY)
    coreModel.setParameterValueById('ParamBodyAngleZ', modelParameters.value.bodyAngleZ)
    coreModel.setParameterValueById('ParamBreath', modelParameters.value.breath)

    // Save SDK manager references so they can be restored if expression is
    // toggled off at runtime.
    savedEyeBlink.value = internalModel.eyeBlink
    savedExpressionManager.value = motionManager.expressionManager
    loadedModelId = pendingModel.id
    naturalDiagnostics.setLoadedModelId(pendingModel.id ?? null)

    // --- Expression controller initialisation (conditional)
    if (live2dExpressionEnabled.value) {
      // Disable built-in Cubism expression manager — our expression-controller
      // replaces it. The SDK's manager runs after motionManager.update() and
      // would overwrite our final-plugin values every frame.
      if (motionManager.expressionManager) {
        motionManager.expressionManager = undefined
      }
      // Disable SDK eyeBlink — it runs on frames where motionUpdated=false and
      // would conflict with expression eye parameter overrides. Our auto-blink
      // plugin (Force Auto Blink setting) provides the replacement for models
      // without idle-motion blink curves.
      if (internalModel.eyeBlink) {
        internalModel.eyeBlink = undefined
      }

      internalModelRef.value = internalModel
    }

    emits('modelLoaded')
  }
  catch (error) {
    console.error('[Live2D] Failed to load model:', error)
    emits('error', error instanceof Error ? error : new Error(String(error)))
  }
  finally {
    modelLoading.value = false
    componentState.value = 'mounted'
    await initExpressionController(internalModelRef.value, loadedModelId).catch((err) => {
      console.warn('[Model.vue] Expression controller initialization failed:', err)
    })
  }
}

/**
 * Initialise the expression controller by reading expression definitions from
 * the model settings (model3.json) and parsing each referenced exp3.json file.
 *
 * This is intentionally fire-and-forget from loadModel so that a failure in
 * expression loading does not prevent the model itself from rendering.
 */
async function initExpressionController(internalModel?: PixiLive2DInternalModel, modelId?: string) {
  // Dispose any previous state (handles model reloads)
  expressionController.dispose()

  const settings = internalModel?.settings as (PixiLive2DInternalModel['settings'] & {
    expressions?: Model3ExpressionRef[]
    _expFiles?: ArchiveExpressionFile[]
    _vtubeData?: unknown
  }) | undefined
  if (!settings || !internalModel)
    return

  // model3.json stores expressions as { Name, File }[] under settings.expressions
  const expressionRefs: { Name: string, File: string }[] = settings.expressions ?? []
  // Build a function that can read exp3 files relative to the model root.
  // For URL-loaded models, resolveURL gives us the full URL. For ZIP-loaded
  // models the resolved URL points to an in-memory blob/object URL.
  const readExpFile = async (filePath: string): Promise<string> => {
    const resolvedUrl: string = settings.resolveURL?.(filePath) ?? filePath
    const response = await fetch(resolvedUrl)
    if (!response.ok)
      throw new Error(`Failed to fetch exp3 file: ${filePath} (${response.status})`)
    return response.text()
  }

  // Archive ids stay relative to the archive, not to a temporary blob URL.
  const resolvePath = (path: string) => {
    if (!settings._expFiles)
      return settings.resolveURL(path)
    const base = new URL(settings.url, 'https://archive.invalid/')
    return decodeURI(new URL(path, base).pathname.slice(1))
  }
  const displayInfo = (settings as { _cdiData?: unknown })._cdiData
  const parameters = internalModel.coreModel.getModel().parameters
  const physicsRig: PhysicsRigLike | undefined = internalModel.physics?._physicsRig
  const profile = readLive2DRigProfile(parameters, physicsRig, displayInfo)
  const freeParameters = findFreeParameters({
    parameters,
    // The controller excludes exp3 writes after it has loaded and parsed the files.
    exp3Definitions: [],
    drivenIds: new Set([
      ...manualControlParameterIds,
      ...[...profile.channels.values()].map(channel => channel.id),
      ...physicsRig?.outputs.map(output => output.destination.id) ?? [],
    ]),
    displayNames: readParameterDisplayNames(displayInfo),
  })
  const modelParameters = parameters.ids.map((id, index) => ({
    id,
    min: parameters.minimumValues[index],
    max: parameters.maximumValues[index],
    default: parameters.defaultValues[index],
  }))
  await expressionController.initialise(modelId, expressionRefs, readExpFile, settings._expFiles, resolvePath, settings._vtubeData, displayInfo, modelParameters, freeParameters)
}

async function setMotion(motionName: string, index?: number) {
  // TODO: motion? Not every Live2D model has motion, we do need to help users to set motion
  if (!model.value) {
    console.warn('Cannot set motion: model not loaded')
    return
  }

  console.info('Setting motion:', motionName, 'index:', index)
  try {
    await model.value.motion(motionName, index, MotionPriority.FORCE)
    console.info('Motion started successfully:', motionName)
  }
  catch (error) {
    console.error('Failed to start motion:', motionName, error)
  }
}

const dropShadowColorComputer = ref<HTMLDivElement>()
const dropShadowAnimationId = ref(0)

function updateAmbientLightFilter() {
  if (!screenAmbientLightActive.value)
    return

  screenAmbientLightFilter.value.update({
    environment: screenAmbientLightEnvironment.value,
    // The measurement placed its maps around this rectangle, so the shader has
    // to read them from it rather than from the whole window.
    subject: screenAmbientLightSubject.value,
    mode: screenAmbientLightMode.value,
    strength: screenAmbientLightStrength.value,
    options: screenAmbientLightFilterOptions.value,
  })
}

function updateDropShadow() {
  // The measured screen level only applies while the ambient light is running.
  // Without it the shadow keeps one strength, which is the behavior for a stage
  // that never samples the screen.
  const exposure = screenAmbientLightActive.value
    ? screenAmbientLightEnvironment.value.exposure
    : 0
  dropShadowFilter.value.alpha = dropShadowBaseAlpha * (1 - dropShadowExposureFalloff * exposure)

  if (!dropShadowColorComputer.value)
    return

  const color = getComputedStyle(dropShadowColorComputer.value).backgroundColor
  dropShadowFilter.value.color = Number(formatHex(color)!.replace('#', '0x'))
}

// The filter array is replaced only when the set of filters changes. The
// shadow loop below runs every frame, and a fresh array per frame would make
// Pixi re-evaluate the filter stack for nothing.
function updateFilterStack() {
  if (!model.value)
    return

  const filters: Filter[] = []
  if (screenAmbientLightActive.value)
    filters.push(screenAmbientLightFilter.value)
  if (live2dShadowEnabled.value)
    filters.push(dropShadowFilter.value)

  const current = model.value.filters ?? []
  const unchanged = current.length === filters.length
    && current.every((filter, index) => filter === filters[index])
  if (!unchanged)
    model.value.filters = filters
}

function updateModelFilters() {
  updateAmbientLightFilter()
  updateDropShadow()
  updateFilterStack()
}

watch(modelSrcRef, async () => await loadModel(), { immediate: true })
watch(dark, updateModelFilters, { immediate: true })
watch([model, themeColorsHue], updateModelFilters)
watch([live2dShadowEnabled, screenAmbientLightActive], updateFilterStack)
watch(
  [
    screenAmbientLightActive,
    screenAmbientLightFilterOptions,
    screenAmbientLightEnvironment,
    screenAmbientLightMode,
    screenAmbientLightStrength,
  ],
  updateModelFilters,
)

// TODO: This is hacky!
// The theme hue animates, so the shadow color follows it once per frame. Only
// the shadow color belongs here. The ambient-light uniforms update on change,
// and the light maps would otherwise upload on every frame.
function updateDropShadowFilterLoop() {
  updateDropShadow()
  if (!live2dShadowEnabled.value) {
    dropShadowAnimationId.value = 0
    return
  }

  dropShadowAnimationId.value = requestAnimationFrame(updateDropShadowFilterLoop)
}

watch([themeColorsHueDynamic, live2dShadowEnabled], ([dynamic, shadowEnabled]) => {
  if (dynamic && shadowEnabled) {
    dropShadowAnimationId.value = requestAnimationFrame(updateDropShadowFilterLoop)
  }
  else {
    cancelAnimationFrame(dropShadowAnimationId.value)
    dropShadowAnimationId.value = 0
  }
}, { immediate: true })

watch(currentMotion, value => setMotion(value.group, value.index))
watch(paused, value => value ? pixiApp.value?.stop() : pixiApp.value?.start())

// Watch and apply model parameters
watch(() => modelParameters.value.angleX, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamAngleX', value)
  }
})

watch(() => modelParameters.value.angleY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamAngleY', value)
  }
})

watch(() => modelParameters.value.angleZ, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamAngleZ', value)
  }
})

watch(() => modelParameters.value.leftEyeOpen, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamEyeLOpen', value)
  }
})

watch(() => modelParameters.value.rightEyeOpen, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamEyeROpen', value)
  }
})

watch(() => modelParameters.value.mouthOpen, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamMouthOpenY', value)
  }
})

watch(() => modelParameters.value.mouthForm, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamMouthForm', value)
  }
})

watch(() => modelParameters.value.cheek, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamCheek', value)
  }
})

watch(() => modelParameters.value.bodyAngleX, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBodyAngleX', value)
  }
})

watch(() => modelParameters.value.bodyAngleY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBodyAngleY', value)
  }
})

watch(() => modelParameters.value.bodyAngleZ, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBodyAngleZ', value)
  }
})

watch(() => modelParameters.value.breath, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBreath', value)
  }
})

// Watch eyebrow parameters
watch(() => modelParameters.value.leftEyebrowLR, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLX', value)
  }
})

watch(() => modelParameters.value.rightEyebrowLR, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRX', value)
  }
})

watch(() => modelParameters.value.leftEyebrowY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLY', value)
  }
})

watch(() => modelParameters.value.rightEyebrowY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRY', value)
  }
})

watch(() => modelParameters.value.leftEyebrowAngle, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLAngle', value)
  }
})

watch(() => modelParameters.value.rightEyebrowAngle, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRAngle', value)
  }
})

watch(() => modelParameters.value.leftEyebrowForm, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLForm', value)
  }
})

watch(() => modelParameters.value.rightEyebrowForm, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRForm', value)
  }
})

// Watch for idle animation setting changes and stop motions if disabled
watch(live2dIdleAnimationEnabled, (enabled) => {
  if (!enabled && model.value) {
    const internalModel = model.value.internalModel
    const group = internalModel.motionManager.state.currentGroup
    if (live2dMotionDriver.value === 'natural'
      && group && group !== internalModel.motionManager.groups.idle
      && group !== localStorage.getItem('selected-runtime-motion-group')) {
      return
    }
    if (internalModel?.motionManager) {
      internalModel.motionManager.stopAllMotions()
    }
  }
})

watch(live2dMotionDriver, async (driver, previous) => {
  const manager = model.value?.internalModel.motionManager
  if (!manager)
    return
  const group = manager.state.currentGroup
  const selected = localStorage.getItem('selected-runtime-motion-group')
  if (driver === 'natural' && group && (group === manager.groups.idle || group === selected))
    manager.stopAllMotions()
  if (previous === 'natural' && driver === 'universal' && selected) {
    await nextTick()
    if (live2dMotionDriver.value !== 'universal' || !live2dIdleAnimationEnabled.value
      || model.value?.internalModel.motionManager !== manager) {
      return
    }
    const currentGroup = manager.state.currentGroup
    if (currentGroup && currentGroup !== manager.groups.idle && currentGroup !== selected)
      return
    const index = localStorage.getItem('selected-runtime-motion-index')
    if (index !== null)
      model.value?.motion(selected, Number.parseInt(index), MotionPriority.FORCE)
  }
})

watch(paused, value => naturalMotion?.setPaused(value))
// Synchronous so a scenario's first dispatch cannot precede its requested home.
watch(() => naturalDiagnostics.postureHome, () => rebuildNaturalMotion?.(), { flush: 'sync' })
// A model loaded later receives the current settings when its Natural adapter is created.
watch(() => props.performanceSettings, (settings) => {
  naturalMotion?.setPerformanceSettings(settings)
  expressionStore.setSlotSettings(settings.slots)
  holdPerformer.setSlotSettings(settings.slots)
}, { immediate: true })
watch(nowSpeaking, (speaking, wasSpeaking) => {
  // A speech end before the first SDK frame has no clock value to anchor the handoff to.
  if (!speaking && wasSpeaking)
    speechEndedAtSeconds = Number.isNaN(sdkNowSeconds) ? null : sdkNowSeconds
})

/**
 * Records post-physics parameter values for one lab capture request.
 *
 * Samples come from `beforeModelUpdate`, which the SDK emits after focus (where Natural
 * composes), physics, and pose, and before `model.update()` and `loadParameters()`. A ticker or
 * `postrender` read would see the restored values from before Natural and physics instead.
 * Source: pixi-live2d-display cubism4 `Cubism4InternalModel.update()`.
 *
 * The listener exists only while a request is pending. It detaches when the duration elapses,
 * when the request is cancelled, or when the model is destroyed.
 *
 * While it runs, the trace also stamps what Natural performed (its observer) and the scenario events
 * that `markCaptureEvent` receives in this window, on the same clock as the samples.
 */
function startNaturalCapture(request: NaturalCaptureRequest) {
  stopNaturalCapture?.()
  const current = model.value
  const adapter = naturalMotion
  if (!current || !adapter) {
    naturalDiagnostics.failCapture(request.id, 'No Live2D model is loaded in the stage.')
    return
  }
  const internalModel = current.internalModel
  const coreModel = internalModel.coreModel
  const recorder = new NaturalTraceRecorder(coreModel.getModel().parameters, {
    extraParameterIds: request.extraParameterIds,
    displayInfo: (internalModel.settings as { _cdiData?: unknown })._cdiData,
  })
  const capturedAt = new Date().toISOString()
  const readDiagnostics = () => naturalMotion!.diagnostics
  adapter.resetDiagnostics()

  const stop = () => {
    internalModel.off('beforeModelUpdate', onFrame)
    naturalCaptureObserver = null
    naturalMotion?.natural.setObserver(null)
    naturalDiagnostics.setCaptureMarker(null)
    stopNaturalCapture = undefined
  }
  function finish() {
    stop()
    const { home, weightMean, bodyWrites, physicsOutputSkips } = readDiagnostics()
    const trace = recorder.build({
      model: props.modelId ?? null,
      driver: live2dMotionDriver.value,
      energy: props.naturalEnergy,
      home,
      adapter: { weightMean, bodyWrites, physicsOutputSkips },
      capturedAt,
      durationSeconds: request.durationSeconds,
    })
    try {
      naturalDiagnostics.completeCapture(request.id, trace, scoreLiveliness(trace, trace.ranges))
    }
    catch (error) {
      naturalDiagnostics.failCapture(request.id, errorMessageFrom(error) ?? 'The trace could not be scored.')
    }
  }
  function onFrame() {
    recorder.sample(performance.now() / 1000, index => coreModel.getParameterValueByIndex(index))
    if (recorder.elapsedSeconds >= request.durationSeconds)
      finish()
  }

  naturalCaptureObserver = event => recorder.mark(performance.now() / 1000, 'natural', event)
  adapter.natural.setObserver(naturalCaptureObserver)
  naturalDiagnostics.setCaptureMarker(event => recorder.mark(performance.now() / 1000, 'scenario', event))
  internalModel.on('beforeModelUpdate', onFrame)
  stopNaturalCapture = stop
}

// Read on demand by the dev-only motion QA bridge in this window; nothing reads it otherwise.
const releaseStageReader = naturalDiagnostics.registerStageReader(() => ({
  naturalActive: naturalMotion !== undefined && live2dMotionDriver.value === 'natural' && !paused.value,
  hold: holdPerformer.current(holdClock()),
  head: headViewportRect(),
}))

const measuredPlacement = new ScreenPlacement()
watch(model, () => measuredPlacement.update(false, null), { flush: 'sync' })
watch([live2dMotionDriver, live2dNaturalScreenAwareness, () => props.screenPlacement], ([driver, enabled, screen]) => {
  if (driver !== 'natural' || !enabled || !screen)
    measuredPlacement.update(false, null)
}, { flush: 'sync' })

/**
 * Screen inwardness of the head for Natural, or `null` without a signal. A QA override other than `undefined` wins;
 * otherwise the Natural driver, the setting, and the host's screen placement must all be present.
 * Missing measurements keep the last valid placement; only disabling the host signal clears it.
 */
function naturalPlacement(): number | null {
  const override = naturalDiagnostics.placementOverride
  if (override !== undefined) {
    measuredPlacement.update(false, null)
    return override
  }
  const screen = props.screenPlacement
  // Only the Natural driver reads placement, so other drivers skip the per-frame head measurement.
  if (live2dMotionDriver.value !== 'natural' || !live2dNaturalScreenAwareness.value || !screen)
    return measuredPlacement.update(false, null)
  const head = headViewportRect()
  if (!head)
    return measuredPlacement.update(true, null)
  // The main window is frameless, so its bounds are the content bounds and the viewport origin.
  const x = headScreenX(screen.windowBounds, document.documentElement.clientWidth, head)
  return measuredPlacement.update(true, x === null ? null : screenInwardness(screen.displays, x))
}

const chatFocus = new Point()

/**
 * Converts the chat window bounds into Natural's cursor unit, or `null` while the host has no screen placement or the
 * canvas has no geometry. The window bounds come from `screenPlacement`, the same source the placement signal reads.
 */
function locateChat(bounds: PlacementRect, live2DModel: Live2DModel<PixiLive2DInternalModel>, eye: { anchorX: number, anchorY: number, unit: number }) {
  const screen = props.screenPlacement
  const canvas = pixiApp.value?.view
  if (!screen || !(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0)
    return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return null
  return chatTargetOffset(bounds, screen.windowBounds, document.documentElement.clientWidth, (client) => {
    // Viewport CSS px to canvas backing px (the inverse of the last step of `headViewportRect`), then into model canvas px.
    chatFocus.set((client.x - rect.left) * canvas.width / rect.width, (client.y - rect.top) * canvas.height / rect.height)
    live2DModel.toModelPosition(chatFocus, chatFocus)
    return { x: chatFocus.x, y: chatFocus.y }
  }, eye)
}

/** Reports the cursor's unscaled face-feature unit in viewport CSS pixels. */
function headViewportRect() {
  const canvas = pixiApp.value?.view
  const current = model.value
  if (!(canvas instanceof HTMLCanvasElement) || !current || canvas.width <= 0 || canvas.height <= 0)
    return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return null
  const head = readTouchRegions(performance.now())?.unscaledHead
  if (!head)
    return null
  // Refresh the full ancestor chain, as toModelPosition does, including the stage's render scale.
  current.toGlobal({ x: 0, y: 0 })
  return live2DCanvasRectToViewport(
    head,
    current.internalModel.localTransform,
    current.worldTransform,
    rect,
    canvas,
  )
}

const { touchOverlayEnabled } = storeToRefs(naturalDiagnostics)
/** What the touch-region overlay draws this frame, or `null` while it is off or no model is loaded. */
const touchOverlay = shallowRef<Live2DTouchDebugOverlay | null>(null)
/** The lab's readout refreshes at this interval; the overlay itself redraws every frame. */
const touchOverlaySnapshotIntervalMs = 100
let touchOverlayPublishedAtMs = Number.NEGATIVE_INFINITY

/** Builds the overlay and readout from the current frame, or `undefined` while nothing can be measured. */
function readTouchDebug(nowMs: number) {
  const current = model.value
  const canvas = pixiApp.value?.view
  if (!current || !(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0)
    return undefined
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return undefined
  const regions = readTouchRegions(nowMs)
  // Refresh the full ancestor chain, as toModelPosition does, including the stage's render scale.
  current.toGlobal({ x: 0, y: 0 })
  return buildLive2DTouchDebug({
    modelId: props.modelId ?? null,
    capturedAt: new Date(),
    nowMs,
    source: regions?.source ?? null,
    drawables: headTracker.selectionCounts(),
    headScale: live2dNaturalTouchHeadScale.value[props.modelId ?? ''] ?? 1,
    touch: regions?.head,
    cursorUnit: regions?.unscaledHead,
    body: regions?.body,
    eyeAnchor: regions?.eyeAnchor,
    pointer: latestPointer,
    hostCursorGlobal: props.eyeFocusSourceActive ? props.focusAt : null,
    gesture: touchGestures.inspect(nowMs),
    internalModelLocalTransform: current.internalModel.localTransform,
    modelWorldTransform: current.worldTransform,
    canvasClient: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    canvasBacking: { width: canvas.width, height: canvas.height },
  })
}

const touchOverlayLoop = useRafFn(() => {
  const nowMs = performance.now()
  const debug = readTouchDebug(nowMs)
  touchOverlay.value = debug?.overlay ?? null
  if (debug && nowMs - touchOverlayPublishedAtMs >= touchOverlaySnapshotIntervalMs) {
    touchOverlayPublishedAtMs = nowMs
    naturalDiagnostics.publishTouchOverlaySnapshot(debug.snapshot)
  }
}, { immediate: false })

watch(touchOverlayEnabled, (enabled) => {
  if (enabled) {
    touchOverlayLoop.resume()
    return
  }
  touchOverlayLoop.pause()
  touchOverlay.value = null
}, { immediate: true })

watch(naturalCaptureRequest, (request, previous) => {
  if (request && request.id !== previous?.id)
    startNaturalCapture(request)
  else if (!request)
    stopNaturalCapture?.()
})

// Watch for expression system toggle — nullify/restore SDK managers at runtime
watch(live2dExpressionEnabled, (enabled) => {
  if (!model.value)
    return
  const im = model.value.internalModel
  const mm = im.motionManager
  if (enabled) {
    if (mm.expressionManager) {
      (mm as any).expressionManager = null
    }
    if (im.eyeBlink) {
      (im as any).eyeBlink = null
    }

    internalModelRef.value = im
    initExpressionController(im, loadedModelId).catch((err) => {
      console.warn('[Model.vue] Expression controller initialisation failed:', err)
    })
  }
  else {
    mm.expressionManager = savedExpressionManager.value
    im.eyeBlink = savedEyeBlink.value
    expressionController.dispose()
    internalModelRef.value = undefined
  }
})

// --- Touch
// Pokes and pets are a Natural reaction, so touch runs only while Natural drives the model.
const touchActive = computed(() => live2dNaturalTouch.value && live2dMotionDriver.value === 'natural' && !paused.value)

watch(live2dNaturalTouchPetRequiresHold, (requireHold) => {
  touchGestures.requireHold = requireHold
  resetTouch(performance.now())
})
watch(touchActive, (active) => {
  if (!active)
    resetTouch(performance.now())
})
// A new head area applies from the next pointer sample instead of after the cache expires.
watch(live2dNaturalTouchHeadScale, () => {
  touchRegions = undefined
})

/** Ends any gesture in progress and drops queued pokes, for a model swap or disabled touch. */
function resetTouch(timeMs: number) {
  handleTouchEvents(touchGestures.reset(timeMs))
  pendingNaturalPokes.length = 0
  naturalPetHand = null
  touchRegions = undefined
}

function readTouchRegions(timeMs: number) {
  const current = model.value
  if (!current)
    return undefined
  if (touchRegions && timeMs - touchRegions.measuredAtMs < touchRegionsMaxAgeMs)
    return touchRegions
  const internalModel = current.internalModel
  const interaction = headTracker.interactionBounds(internalModel)
  const touch = interaction?.touch
  const headScale = live2dNaturalTouchHeadScale.value[props.modelId ?? ''] ?? 1
  touchRegions = { head: touch && scaleLive2DRect(touch, headScale), unscaledHead: interaction?.head, eyeAnchor: interaction?.eyeAnchor, body: live2DVisibleBounds(internalModel), source: interaction?.source ?? null, measuredAtMs: timeMs }
  return touchRegions
}

/** Position of `value` inside `rect` along X, from -1 at its left edge to 1 at its right. */
function acrossRect(value: number, rect: Live2DModelCanvasRect | undefined) {
  return rect && rect.width > 0 ? Math.max(-1, Math.min(1, (value - rect.x) / rect.width * 2 - 1)) : 0
}

/** Position of `value` inside `rect` along Y, from -1 at its top edge to 1 at its bottom. */
function acrossRectY(value: number, rect: Live2DModelCanvasRect | undefined) {
  return rect && rect.height > 0 ? Math.max(-1, Math.min(1, (value - rect.y) / rect.height * 2 - 1)) : 0
}

/**
 * Maps a pointer event into model canvas space, where the head tracker measures.
 *
 * The canvas backing store is the renderer's pixel space, so scaling the client offset by
 * backing size over displayed size gives the global point `toModelPosition` expects. This
 * is the same mapping the eye focus uses, without depending on the render scale setting.
 */
function modelPointFrom(event: PointerEvent, canvas: HTMLCanvasElement) {
  const current = model.value
  const rect = canvas.getBoundingClientRect()
  if (!current || rect.width <= 0 || rect.height <= 0)
    return undefined
  touchPoint.set(
    (event.clientX - rect.left) * canvas.width / rect.width,
    (event.clientY - rect.top) * canvas.height / rect.height,
  )
  current.toModelPosition(touchPoint, touchPoint)
  return touchPoint
}

function touchSampleFrom(event: PointerEvent, canvas: HTMLCanvasElement): Live2DTouchSample | undefined {
  const current = model.value
  const regions = current && readTouchRegions(event.timeStamp)
  if (!current || !regions)
    return undefined
  const point = modelPointFrom(event, canvas)
  if (!point)
    return undefined
  const head = regions.head && regions.head.width > 0 ? regions.head : undefined
  return {
    timeMs: event.timeStamp,
    x: point.x,
    y: point.y,
    region: live2DTouchRegionAt(point, regions),
    scale: regions.head?.width ?? regions.body?.width ?? current.internalModel.originalWidth,
    // Offset from the scaled head center in head widths, so the gesture can allow its margin zone.
    head: head && {
      x: (point.x - (head.x + head.width / 2)) / head.width,
      y: (point.y - (head.y + head.height / 2)) / head.width,
      halfHeight: head.height / 2 / head.width,
    },
  }
}

function handleTouchEvents(events: Live2DTouchEvent[]) {
  for (const event of events) {
    if (event.kind === 'poke') {
      const box = event.region === 'head' ? touchRegions?.head : touchRegions?.body
      pendingNaturalPokes.push({ region: event.region, x: acrossRect(event.x, box), y: acrossRectY(event.y, box) })
    }
    if (event.kind === 'pet-end')
      naturalPetHand = null
    emits('touch', event)
  }
}

function onTouchPointer(event: PointerEvent) {
  if (!event.isPrimary || !(event.currentTarget instanceof HTMLCanvasElement))
    return
  // Natural attention reads this sample even while touch is off, so record it before the touch gate.
  if (event.type === 'pointermove') {
    const point = modelPointFrom(event, event.currentTarget)
    if (point)
      latestPointer = { x: point.x, y: point.y, atMs: performance.now() }
  }
  if (!touchActive.value)
    return
  if (event.type === 'pointerleave' || event.type === 'pointercancel') {
    handleTouchEvents(touchGestures.cancelled(event.timeStamp))
    return
  }
  const sample = touchSampleFrom(event, event.currentTarget)
  if (!sample)
    return
  if (event.type === 'pointerdown') {
    if (event.button === 0)
      handleTouchEvents(touchGestures.pressed(sample))
    return
  }
  if (event.type === 'pointerup') {
    if (event.button === 0)
      handleTouchEvents(touchGestures.released(sample))
    return
  }
  handleTouchEvents(touchGestures.moved(sample))
  naturalPetHand = touchGestures.petting ? { x: acrossRect(sample.x, touchRegions?.head), y: acrossRectY(sample.y, touchRegions?.head) } : null
}

const touchPointerEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'pointercancel'] as const
watch(pixiApp, (app, _, onCleanup) => {
  const canvas = app?.view
  if (!(canvas instanceof HTMLCanvasElement))
    return
  for (const type of touchPointerEvents)
    canvas.addEventListener(type, onTouchPointer)
  onCleanup(() => {
    for (const type of touchPointerEvents)
      canvas.removeEventListener(type, onTouchPointer)
  })
}, { immediate: true })

watch(focusAt, (value) => {
  if (!model.value)
    return
  if (!props.eyeTracking)
    return

  model.value.focus(value.x, value.y)
})

onMounted(() => {
  const removeListener = listenBeatSyncBeatSignal(() => beatSync.scheduleBeat())
  onUnmounted(() => removeListener())
})

onMounted(async () => {
  updateModelFilters()
})

onUnmounted(() => {
  isUnmounted = true
  resizeAnimation?.pause()
  disposeShouldUpdateView?.()
  expressionController.dispose()
  loadedModelId = undefined
  naturalDiagnostics.setLoadedModelId(null)
  releaseStageReader()

  // Destroying a display object does not destroy its filters, and each mount
  // creates its own pair, so the light-map textures and the blur pass would
  // stay on the GPU for every renderer switch. The stack comes off the model
  // first so that nothing can reference a destroyed filter.
  if (model.value)
    model.value.filters = []
  screenAmbientLightFilter.value.destroy()
  dropShadowFilter.value.destroy()

  // The model registers on the global `Ticker.shared` when it is built, and only
  // `destroy()` removes it. Without this, each stage remount leaves the old model
  // updating every frame and holding its Cubism memory. This component unmounts
  // before the canvas, so the stage still exists here.
  if (model.value) {
    pixiApp.value?.stage?.removeChild(model.value)
    destroyModel(model.value)
    model.value = undefined
  }
})

function listMotionGroups() {
  return availableMotions.value
}

/**
 * The head's box in the space the stage draws in, or `undefined` while no model
 * is loaded.
 *
 * The model owns where its head is; a consumer that draws beside the character
 * reads this rather than reaching into the internal model itself.
 */
function headAnchor() {
  const current = model.value
  if (!current)
    return undefined

  // Read the internal model off the instance rather than `internalModelRef`,
  // which the expression controller owns: it holds a value only while Live2D
  // expressions are enabled, and is cleared when they are turned off.
  const internalModel = current.internalModel

  // Pixi refreshes a local transform while it renders. A caller running ahead of
  // the render would otherwise place against the previous scale and position,
  // which is visible on the frame a resize or a fit lands on.
  current.transform.updateLocalTransform()

  const headRect = headTracker.bounds(internalModel)
  if (!headRect)
    return undefined

  return live2DCanvasRectToParent(
    headRect,
    internalModel.localTransform,
    current.transform.localTransform,
  )
}

defineExpose({
  setMotion,
  listMotionGroups,
  modelNormalizeParams,
  initialModelHeight,
  initialModelWidth,
  headAnchor,
  /** The stage calls this only under Natural; Universal and MAGIC retain motion-group routing. */
  setEmotion: (episode: NaturalEpisode) => { pendingNaturalEmotions.push(episode) },
  /** Executes decider slot commands; lifetimes are owned by the expression store. */
  applySlots: (commands: SlotCommand[], now: number) => expressionStore.applySlots(commands, now),
  /** Natural only: the performer owns the lease and manual-preview fallback of the held emotion. */
  applyHolds: (commands: HoldCommand[], now: number) => holdPerformer.applyHolds(commands, now),
  onSpeech: (event: SpeechEvent, turnId: string, now: number) => {
    expressionStore.onSpeech(event, turnId, now)
    holdPerformer.onSpeech(event, turnId, now)
  },
  setMuted: (muted: boolean) => {
    expressionStore.setMuted(muted)
    holdPerformer.setMuted(muted)
  },
  /** The Natural mood afterglow, or `null` while the Natural controller is not running. */
  getMood: () => naturalMotion?.mood ?? null,
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <div ref="dropShadowColorComputer" hidden bg="primary-400 dark:primary-500" />
  <TouchDebugOverlay v-if="touchOverlay" :overlay="touchOverlay" />
  <slot />
</template>
