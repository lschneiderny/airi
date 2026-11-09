<script setup lang="ts">
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { CameraCalibration } from '@proj-airi/stage-shared/stage-world'
import type { MMDStageWorld } from '@proj-airi/stage-ui-mmd/composables/mmd'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

import type { ChatAttentionTarget, StageCharacterPlacement, StageHostState } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { electron } from '@proj-airi/electron-eventa'
import {
  useElectronAllDisplays,
  useElectronEventaContext,
  useElectronEventaInvoke,
  useElectronRelativeMouse,
  useElectronWindowBounds,
} from '@proj-airi/electron-vueuse'
import { calibrateCamera, defaultHomeDipX, dipToPlane, groundLineOf, homeDipToWorldX, worldToHomeDipX } from '@proj-airi/stage-shared/stage-world'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useMMD, useMMDExpressionStore, useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import {
  createEmptyModelSettingsRuntimeSnapshot,
  resolveComponentStateToRuntimePhase,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { CanvasRegionAlphaReader, isCanvasRegionTransparent } from '@proj-airi/stage-ui/composables/canvas-alpha'
import { useVoiceListening } from '@proj-airi/stage-ui/composables/voice-input-mode'
import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'
import { refDebounced, useEventListener, useRafFn } from '@vueuse/core'
import { clamp } from 'es-toolkit/math'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onScopeDispose, ref, shallowRef, toRef, watch } from 'vue'
import { toast } from 'vue-sonner'

import ControlsIslandRoot from '../components/stage-islands/controls-island/controls-island-root.vue'
import ControlsIsland from '../components/stage-islands/controls-island/index.vue'

import { defaultFloatingChatWidthDip } from '../../shared/chat-floating'
import {
  electronChatAttentionTargetChanged,
  electronGetChatAttentionTarget,
  electronOpenInlay,
  electronOpenOnboarding,
  electronStageGetState,
  electronStageSetHome,
  electronStageStateChanged,
} from '../../shared/eventa'
import { isStageClickThroughUsable } from '../../shared/stage-click-through'
import { useModelSettingsRuntimeOwner } from '../composables/model-settings-runtime-owner'
import { contradictStageCursor, createStageClickThroughState, createStageCursorTrust, createStageHitReadState, isInsidePaddedRect, observeStageCursor, planStageHitRead, resolveStageClickThrough, trustedStageCursor } from '../composables/stage-click-through'
import { usePresenceNotice } from '../composables/use-presence-notice'
import { usePushToTalkShortcut } from '../composables/use-push-to-talk-shortcut'
import { useScreenAmbientLight } from '../composables/use-screen-ambient-light'
import { useStageActiveRenderer } from '../composables/use-stage-active-renderer'
import { stageOpaqueAttribute } from '../composables/use-stage-painted-mask'
import { useStagePlacementPublisher } from '../composables/use-stage-placement-publisher'
import { useDesktopActivityProducerStore } from '../stores/desktop-activity'
import { useForegroundWindowProducerStore } from '../stores/foreground-window'
import { useStageWindowLifecycleStore } from '../stores/stage-window-lifecycle'
import { useToolSelectionStore } from '../stores/tools'

/** The floor row sits this far above the work-area bottom, so her toes never touch the Dock or taskbar edge. */
const toeMarginDip = 8
/** A press on her becomes a drag once the cursor has moved this far. */
const dragStartDip = 8
/** The calibration stands in this model height until the scene has measured the loaded model; PMX models are ~20 units. */
const provisionalModelHeight = 20

useStageActiveRenderer()

const settingsStore = useSettings()
const { stageModelRenderer, stageModelSelectedUrl } = storeToRefs(settingsStore)
const { stageCharacterHeight } = storeToRefs(useMMD())
const motionDiagnostics = useMMDMotionDiagnostics()
const mmdExpressionStore = useMMDExpressionStore()
const { stagePaused } = storeToRefs(useStageWindowLifecycleStore())

const widgetStageRef = ref<InstanceType<typeof WidgetStage>>()
const stageCanvas = toRef(() => widgetStageRef.value?.canvasElement())
const componentStateStage = ref<'pending' | 'loading' | 'mounted'>('pending')
useScreenAmbientLight({ stageCanvas: () => stageCanvas.value })

// The stage window owns the same app-wide producers as the classic page, because it replaces that page in desktop mode.
const desktopActivityProducer = useDesktopActivityProducerStore()
desktopActivityProducer.start()
onScopeDispose(() => desktopActivityProducer.stop())
const foregroundWindowProducer = useForegroundWindowProducerStore()
const situationSettings = useSituationSettings()
watch(() => situationSettings.document.shareForegroundWindow, (sharing) => {
  if (sharing)
    foregroundWindowProducer.start()
  else
    foregroundWindowProducer.stop()
}, { immediate: true })
onScopeDispose(() => foregroundWindowProducer.stop())

const voice = useVoiceStore()
const toolSelection = useToolSelectionStore()
onScopeDispose(voice.connectTools(() => toolSelection.requestTools))
const openInlay = useElectronEventaInvoke(electronOpenInlay)
useVoiceListening()
usePushToTalkShortcut()
usePresenceNotice('stage')
watch(() => voice.state?.phase === 'capturing', (capturing) => {
  if (capturing)
    void openInlay()
})
watch(() => voice.error, (error) => {
  if (error)
    toast.error(error)
})
watch(
  () => voice.drafts.filter(draft => !draft.sending).map(draft => `${draft.id}:${draft.rawText}`).join('\0'),
  (speechDrafts) => {
    if (speechDrafts)
      void openInlay()
  },
)

const onboardingStore = useOnboardingStore()
const openOnboarding = useElectronEventaInvoke(electronOpenOnboarding)
onMounted(() => {
  if (onboardingStore.needsOnboarding)
    openOnboarding()
})

// The desktop stage is built only for an MMD model; another renderer chosen while it runs applies at the next launch,
// so this page reports a runtime owner for MMD only.
const modelSettingsRuntimeOwnerInstanceId = `tamagotchi-desktop-stage:${Math.random().toString(36).slice(2, 10)}`
const modelSettingsRuntimeSnapshot = computed<ModelSettingsRuntimeSnapshot>(() => {
  if (stageModelRenderer.value !== 'mmd')
    return createEmptyModelSettingsRuntimeSnapshot({ ownerInstanceId: modelSettingsRuntimeOwnerInstanceId, updatedAt: Date.now() })

  const hasModel = !!stageModelSelectedUrl.value
  const phase = resolveComponentStateToRuntimePhase(componentStateStage.value, { hasModel })
  return createEmptyModelSettingsRuntimeSnapshot({
    ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
    modelId: mmdExpressionStore.modelId,
    renderer: 'mmd',
    phase,
    controlsLocked: hasModel ? phase !== 'mounted' : false,
    previewAvailable: hasModel,
    canCapturePreview: false,
    mmdExpressions: mmdExpressionStore.settingsSnapshot,
    updatedAt: Date.now(),
  })
})
useModelSettingsRuntimeOwner({
  ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
  renderer: () => stageModelRenderer.value,
  runtimeSnapshot: modelSettingsRuntimeSnapshot,
  // The owner checks the command's renderer against the snapshot first, and this snapshot never reports Live2D.
  applyLive2DExpressionCommand: () => {},
  applyMMDExpressionCommand: command => mmdExpressionStore.applySettingsCommand(command),
})

// Natural inputs, as on the classic page: the cursor, where this window sits among the displays, and the chat window.
const { x: relativeMouseX, y: relativeMouseY, available: cursorAvailable } = useElectronRelativeMouse()
const hostCapabilities = useHostCapabilitiesStore()
const cursorPosition = computed(() => hostCapabilities.status('cursorScreenPoint')?.kind === 'live' && cursorAvailable.value
  ? { x: relativeMouseX.value, y: relativeMouseY.value }
  : undefined)
const allDisplays = useElectronAllDisplays()
const { x: windowX, y: windowY, width: windowWidth, height: windowHeight, available: boundsAvailable } = useElectronWindowBounds()
// Raw bounds may hide the origin on Wayland; wait for explicit trust before forwarding them.
const screenPlacement = computed(() => boundsAvailable.value && hostCapabilities.status('windowOrigin')?.kind === 'live'
  ? {
      displays: allDisplays.value.map(display => display.bounds),
      windowBounds: { x: windowX.value, y: windowY.value, width: windowWidth.value, height: windowHeight.value },
    }
  : undefined)
const eventaContext = useElectronEventaContext()
const chatTarget = shallowRef<ChatAttentionTarget | null>(null)
let chatTargetChanged = false
onScopeDispose(eventaContext.value.on(electronChatAttentionTargetChanged, (event) => {
  if (!event?.body)
    return
  chatTargetChanged = true
  chatTarget.value = event.body
}))
const chatTargetRead = useElectronEventaInvoke(electronGetChatAttentionTarget)()
  .then((target) => {
    if (!chatTargetChanged)
      chatTarget.value = target
  })
  .catch(error => console.warn('[Stage] Failed to read the chat attention target; Natural treats the chat as hidden:', errorMessageFrom(error)))
const stageChatTarget = computed(() => chatTarget.value ?? { visible: false, bounds: null })

// Stage state from the main process: the home display, its work area and the saved home.
const hostState = shallowRef<StageHostState | null>(null)
let hostStateChanged = false
onScopeDispose(eventaContext.value.on(electronStageStateChanged, (event) => {
  if (!event?.body)
    return
  hostStateChanged = true
  hostState.value = event.body
}))
const setHome = useElectronEventaInvoke(electronStageSetHome)
const homeDisplay = computed(() => hostState.value?.displays.find(display => display.id === hostState.value?.homeDisplayId) ?? null)
const savedHomeDipX = computed(() => homeDisplay.value ? hostState.value?.homes[homeDisplay.value.id]?.xDip ?? null : null)
const homeDipX = shallowRef<number | null>(null)
watch(savedHomeDipX, (xDip) => {
  if (xDip !== null)
    homeDipX.value = xDip
})

// A display without a saved home gets the default once: beside the chat on the left, saved through main so the chat
// and the next launch agree on it.
let defaultHomeSavedFor: string | null = null
async function ensureHome() {
  const display = homeDisplay.value
  if (!display || savedHomeDipX.value !== null || defaultHomeSavedFor === display.id)
    return
  defaultHomeSavedFor = display.id
  const chatWidthDip = chatTarget.value?.bounds?.width ?? defaultFloatingChatWidthDip
  const xDip = defaultHomeDipX(display.workArea, 'left', chatWidthDip, 0.3 * stageCharacterHeight.value)
  homeDipX.value = xDip
  try {
    hostState.value = await setHome({ displayId: display.id, xDip })
  }
  catch (error) {
    console.warn('[Stage] Failed to save the default home:', errorMessageFrom(error))
  }
}
watch([homeDisplay, savedHomeDipX], () => void ensureHome())
onMounted(async () => {
  try {
    const state = await useElectronEventaInvoke(electronStageGetState)()
    await chatTargetRead
    if (!hostStateChanged)
      hostState.value = state
  }
  catch (error) {
    console.error('[Stage] Failed to read the stage state; the character stays hidden:', errorMessageFrom(error))
  }
})

// The calibration depends only on these numbers, so a home change or a state event with an equal work area keeps it.
const workAreaWidth = computed(() => homeDisplay.value?.workArea.width ?? 0)
const workAreaHeight = computed(() => homeDisplay.value?.workArea.height ?? 0)
const measuredModelHeight = computed(() => motionDiagnostics.snapshot.stageModel?.height ?? null)
const calibration = computed<CameraCalibration | null>(() => {
  if (workAreaWidth.value <= 0 || workAreaHeight.value <= 0)
    return null
  return calibrateCamera({
    workArea: { width: workAreaWidth.value, height: workAreaHeight.value },
    modelHeight: measuredModelHeight.value ?? provisionalModelHeight,
    characterHeightDip: stageCharacterHeight.value,
    floorRowDip: workAreaHeight.value - toeMarginDip,
  })
})
const stageWorld = computed<MMDStageWorld | undefined>(() => {
  const cal = calibration.value
  if (!cal || homeDipX.value === null)
    return undefined
  const workArea = { width: workAreaWidth.value, height: workAreaHeight.value }
  return {
    workArea,
    calibration: cal,
    ground: groundLineOf(workArea, cal, 0.3 * stageCharacterHeight.value * cal.unitsPerDip),
    homeX: homeDipToWorldX(cal, homeDipX.value, cal.floorRowDip),
  }
})

// A load places the root at the provisional `homeX`. Once she is measured, and on every calibration change, the root
// teleports to the new home with one physics reset. A home change alone (a drag release) never moves her.
const rootX = shallowRef<number | null>(null)
watch([calibration, () => measuredModelHeight.value !== null], ([, measured]) => {
  const world = stageWorld.value
  if (!measured || !world) {
    rootX.value = world?.homeX ?? null
    return
  }
  rootX.value = world.homeX
  widgetStageRef.value?.setStageRootX(world.homeX, { teleport: true })
}, { flush: 'post' })

// Placement: the scene reports work-area DIP; main and the chat use screen DIP.
const placementRect = shallowRef<PlacementRect | null>(null)
watch(stageWorld, (world) => {
  if (!world)
    placementRect.value = null
})
watch(() => motionDiagnostics.snapshot.stageModel, (model) => {
  if (!model)
    placementRect.value = null
})
const placement = computed<StageCharacterPlacement | null>(() => {
  const display = homeDisplay.value
  const world = stageWorld.value
  const rect = placementRect.value
  if (!display || !world || !rect)
    return null
  const homeShift = worldToHomeDipX(world.calibration, world.homeX) - worldToHomeDipX(world.calibration, rootX.value ?? world.homeX)
  const bounds = { ...rect, x: rect.x + display.workArea.x, y: rect.y + display.workArea.y }
  return { displayId: display.id, bounds, homeBounds: { ...bounds, x: bounds.x + homeShift } }
})
useStagePlacementPublisher(placement)

// Controls Island: anchored to the top of her rect. It and its portaled panels keep the pointer.
const controlsIslandRef = ref<InstanceType<typeof ControlsIsland>>()
const controlsIslandInteractionActive = shallowRef(false)
const isOutsideControls = computed(() => controlsIslandRef.value?.isOutside ?? true)
const isOutsideControlsFor250Ms = refDebounced(isOutsideControls, 250)
const controlsHoldPointer = computed(() =>
  (controlsIslandRef.value?.overlayActive ?? false) || !isOutsideControls.value || !isOutsideControlsFor250Ms.value,
)
const cursorAwayFromCharacter = computed(() =>
  cursorPosition.value !== undefined && isOutsideControls.value && !isInsidePaddedRect(cursorPosition.value, placementRect.value),
)
// The anchor is a zero-height strip on her top edge: the Island's fixed position resolves against it (the transform
// makes it the containing block), and her body stays canvas for the hit test's `elementFromPoint`.
const controlsAnchorStyle = computed(() => {
  const rect = placementRect.value
  return rect ? { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: '0px' } : undefined
})

// Drag: a press on her that moves past `dragStartDip` slides her root along the ground line. Moves write the root
// without a physics reset so hair and skirt keep simulating; the release teleports once and saves the home.
interface StagePress {
  pointerId: number
  startX: number
  startY: number
  rootStartX: number
  worldStartX: number
  dragging: boolean
  rootX: number
}
const press = shallowRef<StagePress | null>(null)
/** Counts drag releases; the scene feeds it to the director, whose chase window starts like it does after a poke. */
const interactionSeq = shallowRef(0)

useEventListener(window, 'pointerdown', (event: PointerEvent) => {
  const world = stageWorld.value
  // The window only receives a press while it holds the pointer, that is, on her pixels.
  if (event.button !== 0 || !world || rootX.value === null || event.target !== stageCanvas.value)
    return
  press.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    rootStartX: rootX.value,
    worldStartX: dipToPlane(world.calibration, { x: event.clientX, y: event.clientY }, 0).x,
    dragging: false,
    rootX: rootX.value,
  }
})
useEventListener(window, 'pointermove', (event: PointerEvent) => {
  const current = press.value
  const world = stageWorld.value
  if (!current || !world || event.pointerId !== current.pointerId)
    return
  if (!current.dragging && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= dragStartDip)
    return
  const cursorX = dipToPlane(world.calibration, { x: event.clientX, y: event.clientY }, 0).x
  const x = clamp(current.rootStartX + cursorX - current.worldStartX, world.ground.minX, world.ground.maxX)
  if (!current.dragging)
    widgetStageRef.value?.setStageDragging(true)
  press.value = { ...current, dragging: true, rootX: x }
  rootX.value = x
  widgetStageRef.value?.setStageRootX(x, { teleport: false })
})
function endPress(event: PointerEvent) {
  const current = press.value
  if (!current || event.pointerId !== current.pointerId)
    return
  press.value = null
  if (current.dragging)
    widgetStageRef.value?.setStageDragging(false)
  const world = stageWorld.value
  const display = homeDisplay.value
  if (!current.dragging || !world || !display)
    return
  widgetStageRef.value?.setStageRootX(current.rootX, { teleport: true })
  const xDip = worldToHomeDipX(world.calibration, current.rootX)
  homeDipX.value = xDip
  interactionSeq.value += 1
  setHome({ displayId: display.id, xDip })
    .catch(error => console.warn('[Stage] Failed to save the dragged home:', errorMessageFrom(error)))
}
useEventListener(window, 'pointerup', endPress)
useEventListener(window, 'pointercancel', endPress)

// Click-through: no readback outside her padded rect; inside, one readback per frame (`resolveStageClickThrough`).

// The window starts click-through and stays so until click-through is usable: live forwarding, or Linux emulation.
// Unusable click-through lets everything through, because a captured full-screen stage would trap the desktop.
const clickThroughUsable = computed(() => isStageClickThroughUsable(hostCapabilities.status('clickThroughForward')))
// Emulation decides from the host cursor alone, so the window's own pointer events check that reading.
const clickThroughEmulated = computed(() => clickThroughUsable.value && hostCapabilities.status('clickThroughForward')?.kind === 'degraded')
let cursorTrust = createStageCursorTrust()
useEventListener(window, 'pointermove', (event: PointerEvent) => {
  if (clickThroughEmulated.value)
    cursorTrust = contradictStageCursor(cursorTrust, { x: event.clientX, y: event.clientY }, performance.now())
})

const setIgnoreMouseEvents = useElectronEventaInvoke(electron.window.setIgnoreMouseEvents)
let clickThrough = createStageClickThroughState()

// Right after the scene submits its frame, a synchronous readPixels waits for the GPU (4-5 ms measured). On WebGL2
// the reader copies the pixel asynchronously and answers a frame or two later.
let alphaReader: { gl: WebGL2RenderingContext, reader: CanvasRegionAlphaReader } | null = null
onScopeDispose(() => alphaReader?.reader.dispose())

/**
 * Polls the read in flight and, when `request` is set, starts a read under the cursor. Returns whether her pixel is
 * under the cursor, or `undefined` when no answer arrived this frame. Polling runs every frame a read is in flight, so
 * the answer arrives two or three frames after the request whatever the request interval.
 */
function readHit(cursor: { x: number, y: number }, request: boolean): boolean | undefined {
  const canvas = stageCanvas.value
  if (componentStateStage.value !== 'mounted' || !canvas)
    return request ? false : undefined
  if (request && document.elementFromPoint(cursor.x, cursor.y) !== canvas)
    return false
  const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null
  if (!gl)
    return request ? false : undefined
  if (!(gl instanceof WebGL2RenderingContext)) {
    if (!request)
      return undefined
    const bounds = canvas.getBoundingClientRect()
    const readbackStart = performance.now()
    const transparent = isCanvasRegionTransparent({ gl, clientX: cursor.x, clientY: cursor.y, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, radius: 0, threshold: 10 })
    motionDiagnostics.reportReadback(performance.now() - readbackStart)
    return !transparent
  }
  if (alphaReader?.gl !== gl) {
    alphaReader?.reader.dispose()
    alphaReader = { gl, reader: new CanvasRegionAlphaReader(gl) }
  }
  const { reader } = alphaReader
  if (!request && !reader.pending)
    return undefined
  const bounds = request ? canvas.getBoundingClientRect() : null
  const readbackStart = performance.now()
  const finished = reader.poll()
  let hit = finished === undefined ? undefined : !finished
  if (bounds && reader.request({ clientX: cursor.x, clientY: cursor.y, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, radius: 0, threshold: 10 }) === 'transparent')
    hit = false
  motionDiagnostics.reportReadback(performance.now() - readbackStart)
  return hit
}

let hitRead = createStageHitReadState()

useRafFn(({ timestamp }) => {
  cursorTrust = observeStageCursor(cursorTrust, cursorPosition.value ?? null, timestamp)
  const cursor = clickThroughEmulated.value ? trustedStageCursor(cursorTrust) : cursorTrust.reading
  const rect = placementRect.value
  const forceIgnore = !clickThroughUsable.value
  const forceCapture = stagePaused.value || press.value !== null || controlsHoldPointer.value
  const plan = planStageHitRead(hitRead, { nowMs: timestamp, cursor, rect, forceCapture, forceIgnore })
  hitRead = plan.state
  const hit = cursor ? readHit(cursor, plan.read) : undefined
  const result = resolveStageClickThrough(clickThrough, { nowMs: timestamp, cursor, rect, forceCapture, forceIgnore, hit })
  clickThrough = result.state
  if (result.changed)
    setIgnoreMouseEvents([result.state.ignoring, { forward: true }])
})
</script>

<template>
  <div relative h-full w-full overflow-hidden>
    <WidgetStage
      v-if="stageWorld"
      ref="widgetStageRef"
      v-model:state="componentStateStage"
      h-full w-full
      :cursor-position="cursorPosition"
      :screen-placement="screenPlacement"
      :chat-target="stageChatTarget"
      :stage-world="stageWorld"
      :interaction-seq="interactionSeq"
      :paused="stagePaused"
      @placement="placementRect = $event"
      @root="rootX = $event"
    />
    <div
      v-if="controlsAnchorStyle"
      :class="['absolute', '[transform:translateZ(0)]']"
      :style="controlsAnchorStyle"
    >
      <ControlsIslandRoot :frozen="controlsIslandInteractionActive">
        <ControlsIsland
          ref="controlsIslandRef"
          :cursor-away="cursorAwayFromCharacter"
          :[stageOpaqueAttribute]="true"
          @interaction-change="controlsIslandInteractionActive = $event"
        />
      </ControlsIslandRoot>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
