<script setup lang="ts">
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { StageRow, StageRowDisplay, StageRowSlot } from '@proj-airi/stage-shared/stage-world'
import type { MMDStageWorld } from '@proj-airi/stage-ui-mmd/composables/mmd'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

import type { StageCharacterPlacement, StageHostState } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { electron } from '@proj-airi/electron-eventa'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defaultHomeDipX, dipToPlane, homeDipToWorldX, layoutStageRow, placementRectAt, worldToHomeDipX } from '@proj-airi/stage-shared/stage-world'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useMMD, useMMDExpressionStore, useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import {
  createEmptyModelSettingsRuntimeSnapshot,
  resolveComponentStateToRuntimePhase,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { CanvasRegionAlphaReader, isCanvasRegionTransparent } from '@proj-airi/stage-ui/composables/canvas-alpha'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { refDebounced, useEventListener, useRafFn } from '@vueuse/core'
import { isEqual } from 'es-toolkit'
import { clamp } from 'es-toolkit/math'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onScopeDispose, ref, shallowRef, toRef, watch } from 'vue'

import ControlsIslandRoot from '../components/stage-islands/controls-island/controls-island-root.vue'
import ControlsIsland from '../components/stage-islands/controls-island/index.vue'

import { defaultFloatingChatWidthDip } from '../../shared/chat-floating'
import {
  electronStageGetState,
  electronStageMoveToDisplay,
  electronStageRehome,
  electronStageSetHome,
  electronStageStateChanged,
} from '../../shared/eventa'
import { isStageClickThroughUsable } from '../../shared/stage-click-through'
import { useModelSettingsRuntimeOwner } from '../composables/model-settings-runtime-owner'
import { contradictStageCursor, createStageClickThroughState, createStageCursorTrust, createStageHitReadState, isInsidePaddedRect, observeStageCursor, planStageHitRead, resolveStageClickThrough, trustedStageCursor } from '../composables/stage-click-through'
import { createFollowMeState, followCursor } from '../composables/stage-hand-off'
import { useScreenAmbientLight } from '../composables/use-screen-ambient-light'
import { useStageHandOff } from '../composables/use-stage-hand-off'
import { useStageHostWiring } from '../composables/use-stage-host-wiring'
import { stageOpaqueAttribute } from '../composables/use-stage-painted-mask'
import { useStagePlacementPublisher } from '../composables/use-stage-placement-publisher'
import { useStageWindowLifecycleStore } from '../stores/stage-window-lifecycle'

/** The floor row sits this far above the work-area bottom, so her toes never touch the Dock or taskbar edge. */
const toeMarginDip = 8
/** A press on her becomes a drag once the cursor has moved this far. */
const dragStartDip = 8
/** The calibration stands in this model height until the scene has measured the loaded model; PMX models are ~20 units. */
const provisionalModelHeight = 20

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

// The stage window owns the same app-wide services and Natural inputs as the classic page, because it replaces that
// page in desktop mode.
const { cursorPosition, screenPlacement, chatTarget, chatTargetRead } = useStageHostWiring('stage')

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

// Stage state from the main process: the displays, the home display, the display the window covers and the saved homes.
const eventaContext = useElectronEventaContext()
const hostCapabilities = useHostCapabilitiesStore()
const hostState = shallowRef<StageHostState | null>(null)
const homeDisplay = computed(() => hostState.value?.displays.find(display => display.id === hostState.value?.homeDisplayId) ?? null)
// The display the stage window covers. The camera is that display's slot on the stage row.
const stageDisplay = computed(() => hostState.value?.displays.find(display => display.id === hostState.value?.stageDisplayId) ?? null)

// The row lays every display out on one world x axis. It keeps its identity while the geometry is equal, so a home
// change or a state event with equal work areas keeps the row and her place on it.
const rowDisplays = computed<StageRowDisplay[]>((previous) => {
  const next = (hostState.value?.displays ?? [])
    .filter(display => display.workArea.width > 0 && display.workArea.height > 0)
    .map(display => ({ id: display.id, workArea: display.workArea }))
  return previous && isEqual(previous, next) ? previous : next
})
const measuredModelHeight = computed(() => motionDiagnostics.snapshot.stageModel?.height ?? null)
const row = computed<StageRow | null>(() => {
  if (rowDisplays.value.length === 0)
    return null
  return layoutStageRow({
    displays: rowDisplays.value,
    modelHeight: measuredModelHeight.value ?? provisionalModelHeight,
    characterHeightDip: stageCharacterHeight.value,
    toeMarginDip,
    halfWidthDip: 0.3 * stageCharacterHeight.value,
  })
})
const stageSlot = computed(() => row.value?.slots.find(slot => slot.id === stageDisplay.value?.id) ?? null)
const homeSlot = computed(() => row.value?.slots.find(slot => slot.id === homeDisplay.value?.id) ?? null)
const rootX = shallowRef<number | null>(null)

// Hand-off: she may walk to another display, and the window follows her, only while the host can vouch for where the
// window and the cursor are.
let clickThrough = createStageClickThroughState()
const moveToDisplay = useElectronEventaInvoke(electronStageMoveToDisplay)
const handOff = useStageHandOff({
  row,
  stageSlot,
  rootX,
  live: () => hostCapabilities.status('windowOrigin')?.kind === 'live' && hostCapabilities.status('cursorScreenPoint')?.kind === 'live',
  move: async (displayId) => {
    const state = await moveToDisplay(displayId)
    acceptHostState(state)
    return state.stageDisplayId
  },
  // Main made the window click-through again when it arrived; the hit test starts from that.
  onWalked: () => {
    clickThrough = createStageClickThroughState()
  },
})

/** Takes a state from the main process, from an event or an invoke result. */
function acceptHostState(state: StageHostState) {
  handOff.observe(state.stageDisplayId)
  hostState.value = state
}
let hostStateChanged = false
onScopeDispose(eventaContext.value.on(electronStageStateChanged, (event) => {
  if (!event?.body)
    return
  hostStateChanged = true
  acceptHostState(event.body)
}))
const setHome = useElectronEventaInvoke(electronStageSetHome)
const rehome = useElectronEventaInvoke(electronStageRehome)
const savedHomeDipX = computed(() => homeDisplay.value ? hostState.value?.homes[homeDisplay.value.id]?.xDip ?? null : null)
const homeDipX = shallowRef<number | null>(null)
watch(savedHomeDipX, (xDip) => {
  if (xDip !== null)
    homeDipX.value = xDip
})

/** The default home of a display: beside the chat on the left. */
function defaultHomeOn(workArea: { width: number, height: number }): number {
  const chatWidthDip = chatTarget.value.bounds?.width ?? defaultFloatingChatWidthDip
  return defaultHomeDipX(workArea, 'left', chatWidthDip, 0.3 * stageCharacterHeight.value)
}

// A home display without a saved home gets the default once, saved through main so the chat and the next launch agree
// on it.
let defaultHomeSavedFor: string | null = null
async function ensureHome() {
  const display = homeDisplay.value
  if (!display || savedHomeDipX.value !== null || defaultHomeSavedFor === display.id)
    return
  defaultHomeSavedFor = display.id
  const xDip = defaultHomeOn(display.workArea)
  homeDipX.value = xDip
  try {
    acceptHostState(await setHome({ displayId: display.id, xDip }))
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
      acceptHostState(state)
  }
  catch (error) {
    console.error('[Stage] Failed to read the stage state; the character stays hidden:', errorMessageFrom(error))
  }
})

/** Her home on `slot` as a world x: the saved home on the home display, a display's own saved or default home elsewhere. */
function homeXOn(slot: StageRowSlot): number | null {
  const xDip = slot === homeSlot.value ? homeDipX.value : hostState.value?.homes[slot.id]?.xDip ?? defaultHomeOn(slot.workArea)
  return xDip === null ? null : homeDipToWorldX(slot.calibration, xDip, slot.calibration.floorRowDip)
}
// She lives on the home display. While she cannot walk there, she rests on the display the window covers.
const restSlot = computed(() => handOff.on.value && homeSlot.value ? homeSlot.value : stageSlot.value)
/** Where a teleport puts her: always on the display the window covers, so she is seen afterwards. */
const stageHomeX = computed(() => stageSlot.value ? homeXOn(stageSlot.value) : null)
const stageWorld = computed<MMDStageWorld | undefined>(() => {
  const slot = stageSlot.value
  const homeX = restSlot.value ? homeXOn(restSlot.value) : null
  if (!slot || homeX === null || stageHomeX.value === null)
    return undefined
  return {
    workArea: { width: slot.workArea.width, height: slot.workArea.height },
    calibration: slot.calibration,
    ground: slot.ground,
    homeX,
    row: handOff.on.value ? row.value ?? undefined : undefined,
  }
})

// Once she is measured, she teleports to her home on the display the window covers, with one physics reset, and again
// when the row is laid out anew or the hand-off asks for it. A confirmed walk to another display and a home change
// alone never move her.
watch([row, () => measuredModelHeight.value !== null, handOff.teleportSeq], ([, measured]) => {
  const homeX = stageWorld.value ? stageHomeX.value : null
  rootX.value = homeX
  if (measured && homeX !== null)
    widgetStageRef.value?.setStageRootX(homeX, { teleport: true })
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
  const display = stageDisplay.value
  const slot = stageSlot.value
  const rest = restSlot.value
  const world = stageWorld.value
  const rect = placementRect.value
  if (!display || !slot || !rest || !world || !rect)
    return null
  // Her rectangle at home, on the display her home is on: the chat attaches to where she lives.
  const atHome = placementRectAt(rect, { calibration: slot.calibration, rootX: rootX.value ?? world.homeX }, { calibration: rest.calibration, rootX: world.homeX })
  return {
    displayId: display.id,
    bounds: { ...rect, x: rect.x + display.workArea.x, y: rect.y + display.workArea.y },
    homeBounds: { ...atHome, x: atHome.x + rest.workArea.x, y: atHome.y + rest.workArea.y },
  }
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
  const display = stageDisplay.value
  if (!current.dragging || !world || !display)
    return
  widgetStageRef.value?.setStageRootX(current.rootX, { teleport: true })
  const xDip = worldToHomeDipX(world.calibration, current.rootX)
  const onHomeDisplay = display.id === homeDisplay.value?.id
  if (onHomeDisplay)
    homeDipX.value = xDip
  interactionSeq.value += 1
  // Dropped on a display she walked to, she lives there now: it becomes the home display, and the window stays.
  setHome({ displayId: display.id, xDip })
    .then(() => onHomeDisplay ? undefined : rehome(display.id))
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

// Follow me: the display the cursor stays on becomes the home display, and her return home walks her there.
let followMe = createFollowMeState()
function cursorDisplayId(): string | null {
  const cursor = cursorPosition.value
  const origin = screenPlacement.value?.windowBounds
  if (!cursor || !origin)
    return null
  const x = cursor.x + origin.x
  const y = cursor.y + origin.y
  return hostState.value?.displays.find(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height)?.id ?? null
}

useRafFn(({ timestamp }) => {
  cursorTrust = observeStageCursor(cursorTrust, cursorPosition.value ?? null, timestamp)
  const cursor = clickThroughEmulated.value ? trustedStageCursor(cursorTrust) : cursorTrust.reading
  const rect = placementRect.value
  // While no display shows her, nothing of hers can be clicked, and the window may be between two displays.
  const unseen = handOff.frame({ dragging: press.value !== null })
  const forceIgnore = !clickThroughUsable.value || unseen
  // She can only follow to a display she can walk to, so Follow me waits for hand-off.
  if (hostState.value?.followMe && handOff.on.value) {
    const follow = followCursor(followMe, { nowMs: timestamp, cursorDisplayId: cursorDisplayId(), homeDisplayId: hostState.value.homeDisplayId })
    followMe = follow.state
    if (follow.rehomeTo !== null)
      rehome(follow.rehomeTo).catch(error => console.warn('[Stage] Failed to follow the cursor to its display:', errorMessageFrom(error)))
  }
  else {
    followMe = createFollowMeState()
  }
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
      :style="{ visibility: handOff.moving.value ? 'hidden' : undefined }"
      :cursor-position="cursorPosition"
      :screen-placement="screenPlacement"
      :chat-target="chatTarget"
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
