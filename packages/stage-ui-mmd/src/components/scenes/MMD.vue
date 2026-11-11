<script setup lang="ts">
/*
  * Root MMD scene component.
  *
  * Unlike the VRM renderer (which is declarative via TresJS), MMD is driven
  * imperatively: the MMD runtime coordinates mixer, IK, grant, and physics in
  * a hand-managed render loop. This component owns the WebGLRenderer, camera,
  * lights, OrbitControls, and the per-frame pipeline, and exposes the same
  * contract Stage.vue expects from every renderer.
*/

import type { ClipBoneMask, ClipMaskGroup } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { BodyActionKind, BodyActionRequest } from '@proj-airi/motion-driver-humanoid/director'
import type { IdleClipCandidate } from '@proj-airi/motion-driver-humanoid/idle-clips'
import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'
import type { FaceBaseline } from '@proj-airi/motion-driver-natural/baseline'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { NaturalEmotionStrengths } from '@proj-airi/motion-driver-natural/emotion-strengths'
import type { NaturalTouchGesture } from '@proj-airi/motion-driver-natural/frame-types'
import type { IdleBehaviourReport, IdleCueKind, NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { NaturalChatInput } from '@proj-airi/motion-driver-natural/natural-motion'
import type { ExpressionPerformanceSettings, HoldCommand, MoodDose, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { SelfObservation } from '@proj-airi/stage-shared/situation'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { AnimationClip, SkinnedMesh, Texture } from 'three'

import type { GazeOffset, MMDAnimationManager, MorphController } from '../../composables/mmd'
import type { ActActionDropReason } from '../../composables/mmd/actions/resolve-act-action'
import type { MMDOverlayStage } from '../../composables/mmd/overlays'
import type { MMDStageExtent, MMDStageWorld } from '../../composables/mmd/stage-world'
import type { MMDStanceWorld } from '../../composables/mmd/stance'
import type { SpeechEvent } from '../../stores/expression-slots'
import type { MMDMotionSnapshot } from '../../stores/motion-diagnostics'
import type { MMDMotionTraceSource } from '../../stores/motion-trace'
import type { ResolvedMMDModel } from '../../utils/mmd-loader'

import { errorMessageFrom } from '@moeru/std'
import { deriveClipMeta, effectiveLayer } from '@proj-airi/motion-driver-humanoid/clip-meta'
import { decideIdleClip, initialIdleClipMemory } from '@proj-airi/motion-driver-humanoid/idle-clips'
import { coverRect } from '@proj-airi/stage-shared'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { screenInwardness } from '@proj-airi/stage-shared/stage-placement'
import { dipToPlane, worldToDip } from '@proj-airi/stage-shared/stage-world'
import { Screen } from '@proj-airi/ui'
import { useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  NoToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three-stdlib'
import { computed, onMounted, onUnmounted, ref, shallowRef, toRaw, toRef, watch } from 'vue'

import {
  createGazeController,
  createMMDAnimationManager,
  createMorphController,
  EYE_PITCH_LIMIT,
  EYE_YAW_LIMIT,
  loadMMDAnimationClip,
  MMDFrameMetrics,
  useMMDBlink,
  useMMDEmote,
  useMMDLipSync,
} from '../../composables/mmd'
import { MMDActionPort } from '../../composables/mmd/action-port'
import { resolveActAction } from '../../composables/mmd/actions/resolve-act-action'
import { MMDBody } from '../../composables/mmd/body'
import { MMDBodyToolPort } from '../../composables/mmd/body-tool-port'
import { resolveBodyPoints, resolveBodyTarget } from '../../composables/mmd/body/attention'
import { MMDBodyPose } from '../../composables/mmd/body/pose'
import { ARM_SWING_REACH, resolveFrameBounds } from '../../composables/mmd/camera-bounds'
import { createMMDMorphRuntime } from '../../composables/mmd/morph-runtime'
import { MotionRegistrations } from '../../composables/mmd/motion-registrations'
import { createMMDMotionTraceSampler, mmdBodyTraceEvent } from '../../composables/mmd/motion-trace'
import { MMDNaturalAdapter, mmdScreenInwardness, projectMMDHead } from '../../composables/mmd/natural/adapter'
import { fnv1a32 } from '../../composables/mmd/natural/seed'
import { createOverlayLabel } from '../../composables/mmd/overlay-label'
import { MMDOverlays } from '../../composables/mmd/overlays'
import { readMMDRigProfile } from '../../composables/mmd/rig'
import { buildMMDClipMask, mmdClipMaskBones } from '../../composables/mmd/rig/clip-mask'
import { composeMMDStages } from '../../composables/mmd/stage-composition'
import { applyStageCamera, applyStageRoot, measureStageExtent, projectCharacterPlacement, rowInputs, stagePixelRatio } from '../../composables/mmd/stage-world'
import { chatStandX, frameClocks, MMDStanceDirector } from '../../composables/mmd/stance'
import { buildMMDTouchColliders, MMDTouch, mmdTouchRegionRoots } from '../../composables/mmd/touch'
import { Emotion, EMOTION_VALUES } from '../../constants/emotions'
import { useMMDExpressionStore } from '../../stores/expression-store'
import { useMMD } from '../../stores/mmd'
import { useMMDMotionDiagnostics } from '../../stores/motion-diagnostics'
import { useMMDNaturalSettings } from '../../stores/natural-settings'
import { loadMMDModelFromSource } from '../../utils/mmd-loader'
import {
  applyMMDMaterialOpacity,
  collectMMDMaterials,
  disposeMMDObject,
  setMMDMaterialGlow,
} from '../../utils/mmd-materials'

/** Something her body does on its own, as the stage forwards it to the situation; the stage stamps the time. */
type MMDSelfReport = Pick<SelfObservation, 'activity' | 'phase' | 'label'>

const props = withDefaults(defineProps<{
  /** The context that owns `currentAudioSource`. */
  audioContext?: AudioContext
  modelSrc?: string
  modelId?: string
  paused?: boolean
  cursorPosition?: { x: number, y: number }
  performance?: PerformanceState
  naturalEnergy?: number
  performanceSettings?: ExpressionPerformanceSettings
  screenPlacement?: { displays: PlacementRect[], windowBounds: PlacementRect }
  chatTarget?: { visible: boolean, bounds: PlacementRect | null }
  chatActivity?: Pick<NaturalChatInput, 'typing' | 'sentSeq' | 'sentWords'>
  mouthOpenSize?: number
  nowSpeaking?: boolean
  /**
   * Scene painted behind the model, inside this canvas rather than under it, so one
   * readback answers for the whole stage.
   */
  backgroundUrl?: string | null
  currentAudioSource?: AudioBufferSourceNode
  enableOrbitControls?: boolean
  /**
   * The desktop stage world. When set, the camera comes from the calibration (no framing, no orbit controls), the root
   * stands at `homeX` on the floor line, and the classic scale, position and rotation settings are ignored. With a
   * `row`, a change of calibration moves the camera to another display and leaves the root where it is.
   */
  stageWorld?: MMDStageWorld
  /**
   * Counts the host's own interactions with her (a drag release). A new value starts the chase window the way a poke
   * does. Stage mode only.
   */
  interactionSeq?: number
}>(), {
  paused: false,
  performance: () => ({ mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }),
  naturalEnergy: undefined,
  performanceSettings: () => defaultExpressionPerformanceSettings,
  mouthOpenSize: 0,
  nowSpeaking: false,
  enableOrbitControls: false,
})

const emit = defineEmits<{
  (e: 'error', err: unknown): void
  (e: 'touch', event: NaturalTouchGesture): void
  /** A self-directed idle behaviour of the Natural driver started or ended. */
  (e: 'idle', report: IdleBehaviourReport): void
  /** Something her body did on its own started or ended: sitting down, sleeping, a walk of her own, an unasked clip. */
  (e: 'self', report: MMDSelfReport): void
  /** The character's projected rect in work-area DIP changed (stage mode only). */
  (e: 'placement', rect: PlacementRect): void
  /** The live root x in model units changed (stage mode only); walking moves it without the host's help. */
  (e: 'root', x: number): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const mmdStore = useMMD()
const naturalSettings = useMMDNaturalSettings()
const diagnostics = useMMDMotionDiagnostics()
const expressions = useMMDExpressionStore()
// Interactions that start the director's chase window: touch pokes and pets, host drags and sent chat messages.
let interactionSeq = 0
let interactionAtMs: number | null = null
// Sent chat messages count apart from touches: they start the chase window and end looping clips, never a one-shot.
let chatSendSeq = 0
let directorNowMs = 0
// The host reports a drag in progress; the director refuses clips and ends broad ones while it lasts.
let dragging = false
function noteInteraction() {
  interactionSeq++
  interactionAtMs = directorNowMs
}
watch(() => props.interactionSeq, (next, previous) => {
  if (next !== undefined && next !== previous) {
    noteInteraction()
    // A drag release bumps the host's counter; the drag is over whatever the pointer handlers reported.
    dragging = false
  }
})
watch(() => props.chatActivity?.sentSeq, (next, previous) => {
  if (next !== undefined && previous !== undefined && next > previous) {
    chatSendSeq++
    interactionAtMs = directorNowMs
  }
})
const bodyToolPort = new MMDBodyToolPort()
// Self-directed idle behaviour. The stage sends the drive every second; this scene narrows it and adds unasked clips.
let hostIdleDrive: NaturalIdleDrive | null = null
let sceneIdleDrive: NaturalIdleDrive | null = null
/** The stage drive `sceneIdleDrive` was built from. */
let sceneIdleSource: NaturalIdleDrive | null = null
let idleClipMemory = initialIdleClipMemory
/** The request seq of the clip she plays unasked, so its performance can be told from an asked one. */
let unaskedActionSeq: number | null = null
let reportedBody: MMDSelfReport | null = null
// Clip performance. The scene queues one request; the director accepts it; the animation manager plays the layer it
// names. The director decides, this component only obeys.
const FULL_BODY_GROUPS: readonly ClipMaskGroup[] = ['root', 'leftLegIk', 'rightLegIk']
let performSeq = 0
let pendingAction: BodyActionRequest | null = null
let actionFeedback: { seq: number, state: 'finished' | 'failed' } | null = null
let playedActionSeq: number | null = null
let layerClip: string | null = null
const requestedKinds = new Map<number, BodyActionKind>()
const loadedClips = new Map<string, { clip: AnimationClip, mask: ClipBoneMask }>()
const actionDrops = { unknown: 0, notExposed: 0, notGesture: 0, superseded: 0 }
const ACT_DROP_COUNTER: Record<ActActionDropReason, keyof typeof actionDrops> = {
  'unknown': 'unknown',
  'not-exposed': 'notExposed',
  'not-gesture': 'notGesture',
  'superseded': 'superseded',
}
// Where she stands beside the open chat this frame; the tool port reports her position against it.
let chatStandSpotX: number | null = null
let chatVisible: boolean | undefined
let chatUnfoldSeq = 0
watch(() => props.chatTarget?.visible, (visible) => {
  if (chatVisible === false && visible)
    chatUnfoldSeq++
  chatVisible = visible
}, { immediate: true })
const {
  physicsEnabled,
  ikEnabled,
  grantEnabled,
  physicsGravity,
  gazeMode,
  motionDriver,
  position,
  scale,
  rotationY,
  morphOverrides,
  emotionActionMap,
  materialOpacity,
  idleMotionName,
  availableMotions,
  stanceSlots,
  performRequest,
  clipCuration,
  availableClipMeta,
  cameraFov,
  ambientColor,
  ambientIntensity,
  directionalColor,
  directionalIntensity,
  directionalPosition,
  albedoGlow,
  renderScale,
  roamMode,
} = storeToRefs(mmdStore)
/** A model without saved strengths performs every emotion at 1. */
const defaultEmotionStrengths: NaturalEmotionStrengths = {}

const canvasRef = ref<HTMLCanvasElement>()

// Imperative three.js objects (no reactivity — mutated in the render loop).
let renderer: WebGLRenderer | undefined
let scene: Scene | undefined
let camera: PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let ambientLight: AmbientLight | undefined
let directionalLight: DirectionalLight | undefined
let modelGroup: Group | undefined
let resolved: ResolvedMMDModel | undefined
let mesh: SkinnedMesh | undefined
let morphs: MorphController | undefined
let animation: MMDAnimationManager | undefined
let emote: ReturnType<typeof useMMDEmote> | undefined
let morphRuntime: ReturnType<typeof createMMDMorphRuntime> | undefined
let natural: MMDNaturalAdapter | undefined
let traceSource: MMDMotionTraceSource | null = null
let stopTraceEvents: (() => void) | undefined
let body: MMDBody | undefined
let rig: ReturnType<typeof readMMDRigProfile> | undefined
let stopMorphOverrides: (() => void) | undefined
let touch: MMDTouch | undefined
let stance: MMDStanceDirector | undefined
// The body director's target points for the current frame, in model units.
let bodyPoints: ReturnType<typeof resolveBodyPoints> = null
let overlays: MMDOverlays | undefined
// Natural's clock for the current frame; the director clock offset never reaches it.
let naturalSeconds = performance.now() / 1000
// Motion names already bound to the current model runtime.
const registeredMotions = new MotionRegistrations()
let rafHandle = 0
let previousFrameTime: number | undefined
let lastDiagnosticsTime = 0
let loadedModelKey: string | null = null
// The same key, reactive, so a reader of the clip library (`listActions`, the action port) follows a model load.
const libraryModelKey = shallowRef<string | null>(null)
/** The clips the user allowed her to play on her own while idle. */
const idleClips = computed<IdleClipCandidate[]>(() => libraryModelKey.value
  ? mmdStore.labeledClips(libraryModelKey.value).flatMap(clip => clip.idle && clip.kind !== 'stance' && clip.kind !== 'unusable' ? [{ clipId: clip.name, kind: clip.kind }] : [])
  : [])
// perform_action queues through `requestPerform` like every other clip, so the director reads one request queue.
const actionPort = new MMDActionPort({
  clips: () => libraryModelKey.value ? mmdStore.labeledClips(libraryModelKey.value) : [],
  submit: name => requestPerform(name, { source: 'tool' }) ? performSeq : null,
  withdraw: (seq) => {
    if (pendingAction?.seq === seq)
      pendingAction = null
  },
})
let loadGeneration = 0
// Stage mode: the character's root-relative extent and foot baseline, measured once per load, and the live root x.
let stageExtent: MMDStageExtent | undefined
let stageFootBaselineY = 0
let stageRootX = 0
let stageRootYaw = 0
const characterPlacement = shallowRef<PlacementRect | null>(null)
const stageModel = shallowRef<{ height: number, footBaselineY: number } | null>(null)

// Lip-sync owns Vue lifecycle hooks, so it must be created during setup.
const lipSync = useMMDLipSync(
  toRef(props, 'audioContext'),
  toRef(props, 'currentAudioSource'),
)
const blink = useMMDBlink()
let gaze: ReturnType<typeof createGazeController> | undefined

function canvasElement() {
  return canvasRef.value
}

function captureFrame(): Promise<Blob | null> | undefined {
  if (!renderer || !scene || !camera)
    return undefined
  // preserveDrawingBuffer keeps the last frame readable for the snapshot.
  renderer.render(scene, camera)
  return new Promise(resolve => canvasRef.value?.toBlob(resolve, 'image/png'))
}

/**
 * Resolves the gaze target for the current tracking mode.
 *
 * - `none`   → `undefined`, so the gaze controller idle-saccades.
 * - `camera` → centered offset, so the model looks forward toward the camera.
 * - `mouse`  → cursor position normalized to the canvas, or `undefined`
 *   (idle saccades) when there is no cursor.
 */
function resolveGazeOffset(): GazeOffset | undefined {
  if (gazeMode.value === 'none')
    return undefined

  if (gazeMode.value === 'camera') {
    // Aim the eyes at the camera: take the camera direction relative to the
    // look-at center, bring it into the model's local frame (so the user's
    // rotation is accounted for), and convert to yaw/pitch fractions of the
    // eye swing limits. Clamped, so an off-axis camera reads as a hard look.
    if (!camera || !controls || !modelGroup)
      return { x: 0, y: 0 }
    const dir = camera.position.clone().sub(controls.target).normalize()
    dir.applyQuaternion(new Quaternion().copy(modelGroup.quaternion).invert())
    const yaw = Math.atan2(dir.x, dir.z)
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)))
    return {
      x: Math.max(-1, Math.min(1, yaw / EYE_YAW_LIMIT)),
      y: Math.max(-1, Math.min(1, -pitch / EYE_PITCH_LIMIT)),
    }
  }

  // mouse
  if (!props.cursorPosition || !canvasRef.value)
    return undefined
  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0)
    return undefined
  const nx = ((props.cursorPosition.x - rect.left) / rect.width) * 2 - 1
  const ny = ((props.cursorPosition.y - rect.top) / rect.height) * 2 - 1
  return { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) }
}

function applyTransform() {
  if (!modelGroup)
    return
  if (props.stageWorld) {
    applyStageRoot(modelGroup, stageRootX, stageFootBaselineY, stageRootYaw)
    return
  }
  modelGroup.scale.setScalar(scale.value)
  modelGroup.rotation.y = rotationY.value
  modelGroup.position.set(position.value.x, position.value.y, 0)
  animation?.pipeline.requestPhysicsReset()
}

/** Re-applies the calibration camera and republishes the placement; runs on resize and whenever `stageWorld` changes. */
function applyStageWorld() {
  const world = props.stageWorld
  if (!world || !camera || !controls)
    return
  applyStageCamera(camera, world.calibration)
  controls.target.set(world.calibration.position.x, world.calibration.position.y, 0)
  publishPlacement()
}

function publishPlacement() {
  const world = props.stageWorld
  if (!world || !stageExtent)
    return
  const next = projectCharacterPlacement(world.calibration, stageExtent, stageRootX)
  const previous = characterPlacement.value
  characterPlacement.value = next
  if (!previous || previous.x !== next.x || previous.y !== next.y || previous.width !== next.width || previous.height !== next.height) {
    emit('placement', next)
    emit('root', stageRootX)
  }
}

/**
 * Moves the root along the floor line in model units, for drags and teleports. The body re-plants both feet beside the
 * new root and drops its walk goal, so the next gait frame never undoes the move. `teleport: true` resets physics once;
 * `teleport: false` leaves physics simulating. Locomotion moves the root through the body's root handle instead.
 */
function setRootX(x: number, options: { teleport: boolean }) {
  dragging = !options.teleport
  stageRootX = x
  if (!props.stageWorld || !modelGroup || !stageExtent)
    return
  // The host placed her, so the director drops its goal and held goal; the body drops its own in `rebase`.
  stance?.clearGoal()
  modelGroup.position.x = x
  modelGroup.updateMatrixWorld(true)
  body?.rebase(x)
  if (options.teleport)
    animation?.pipeline.requestPhysicsReset()
  publishPlacement()
}

/** The host's pointer handlers report a drag in progress; the director refuses clips and ends broad ones while it lasts. */
function setDragging(on: boolean) {
  dragging = on
}

const headScratch = new Vector3()

/** The head bone's window DIP column, for screen inwardness in stage mode. */
function stageHeadDipX(world: MMDStageWorld): number | null {
  const name = rig?.bones.head
  const bone = name ? mesh?.skeleton.bones.find(candidate => candidate.name === name) : undefined
  if (!bone)
    return null
  bone.getWorldPosition(headScratch)
  return worldToDip(world.calibration, headScratch).x
}

/**
 * three.Color rejects 8-digit `#RRGGBBAA` hex, which the color picker emits.
 * Strip the alpha channel so light colors actually apply.
 */
function normalizeHex(hex: string): string {
  return /^#[0-9a-f]{8}$/i.test(hex) ? hex.slice(0, 7) : hex
}

/** The drawing buffer scale for the display the canvas is on now. */
function pixelRatio(): number {
  return props.stageWorld ? stagePixelRatio(window.devicePixelRatio, renderScale.value) : Math.min(window.devicePixelRatio, 2) * renderScale.value
}

function setupScene() {
  const canvas = canvasRef.value!
  renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = SRGBColorSpace
  // MMD toon materials are not PBR/HDR; filmic tone mapping desaturates and
  // washes them out, so render their colors directly.
  renderer.toneMapping = NoToneMapping
  renderer.setPixelRatio(pixelRatio())

  scene = new Scene()
  // The scene is already chosen when the renderer mounts, so the watcher below never
  // fires for it.
  void syncBackground()
  camera = new PerspectiveCamera(cameraFov.value, 1, 0.1, 1000)
  camera.position.set(0, 1, 3)

  // Toon shading with an albedo self-glow (applied at load): keep direct lights
  // moderate so the lit side doesn't blow out, while the glow + ambient keep the
  // shadow side bright. All values are user-adjustable via the settings store.
  ambientLight = new AmbientLight(new Color(normalizeHex(ambientColor.value)), ambientIntensity.value)
  scene.add(ambientLight)
  directionalLight = new DirectionalLight(new Color(normalizeHex(directionalColor.value)), directionalIntensity.value)
  directionalLight.position.set(directionalPosition.value.x, directionalPosition.value.y, directionalPosition.value.z)
  scene.add(directionalLight)

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.enabled = props.enableOrbitControls && !props.stageWorld
}

/** The hands and the distal finger bones: the stage placement rect must hold them while she stands and swings her arms in a walk. */
function stageReachBones(): string[] {
  const hands = [rig?.bones.leftHand, rig?.bones.rightHand]
  const fingertips = Object.entries(rig?.fingerBones ?? {}).filter(([finger]) => finger.endsWith('Distal')).map(([, name]) => name)
  return [...hands, ...fingertips].filter((name): name is string => name !== undefined)
}

/** Frames the camera so the whole model fits the viewport, and centers it. */
function frameCamera() {
  if (!camera || !controls || !modelGroup)
    return
  if (props.stageWorld)
    applyStageRoot(modelGroup, 0, 0)
  modelGroup.updateMatrixWorld(true)
  const box = new Box3().setFromObject(modelGroup)
  const boneByName = new Map(mesh?.skeleton.bones.map(bone => [bone.name, bone]))
  const scratch = new Vector3()
  // The rect holds the hands where the arm-rest stage puts them, not where the bind A-pose does.
  const reachBones = props.stageWorld ? stageReachBones() : []
  const rested = body && animation && reachBones.length > 0 ? body.restPositions(animation.pipeline.clean, reachBones) : undefined
  const bounds = resolveFrameBounds(
    rig?.bones ?? {},
    (name) => {
      const restedPosition = rested?.get(name)
      if (restedPosition)
        return restedPosition
      const bone = boneByName.get(name)
      if (!bone)
        return null
      bone.getWorldPosition(scratch)
      return [scratch.x, scratch.y, scratch.z]
    },
    box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
    reachBones,
    ARM_SWING_REACH,
  )
  if (!bounds)
    return
  if (props.stageWorld) {
    const measured = measureStageExtent(bounds)
    stageFootBaselineY = measured.footBaselineY
    stageExtent = measured.extent
    stageModel.value = { height: measured.extent.height, footBaselineY: stageFootBaselineY }
    stageRootX = props.stageWorld.homeX
    stageRootYaw = 0
    applyStageRoot(modelGroup, stageRootX, stageFootBaselineY)
    modelGroup.updateMatrixWorld(true)
    body?.rebase(stageRootX, 0)
    animation?.pipeline.requestPhysicsReset()
    applyStageWorld()
    return
  }
  const size = new Vector3(...bounds.size)
  const center = new Vector3(...bounds.center)

  // Fit to BOTH axes using the camera aspect, so the model fills a portrait or
  // landscape viewport without being cropped (mirrors Spine's auto-fit).
  const vFov = (camera.fov * Math.PI) / 180
  const fitHeightDistance = (size.y / 2) / Math.tan(vFov / 2)
  const fitWidthDistance = (size.x / 2) / (Math.tan(vFov / 2) * camera.aspect)
  const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance)

  camera.position.set(center.x, center.y, center.z + distance)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  camera.lookAt(center)
  controls.target.copy(center)
  controls.update()
}

let backgroundTexture: Texture | undefined

/**
 * Fits the scene over the canvas, matching the `cover` framing it had as a CSS layer.
 *
 * A background texture covers the viewport whatever its own shape, so the fit is
 * expressed by sampling a smaller window of it rather than by placing a rectangle.
 *
 * Nothing is marked dirty: a background rebuilds its own texture matrix each frame,
 * while marking the texture would re-upload it and recompile the background shader.
 */
function layoutBackground() {
  if (!backgroundTexture || !renderer)
    return

  // `Texture.image` is whatever the loader produced; a decoded image carries its size.
  const image = backgroundTexture.image as { width?: number, height?: number } | undefined
  if (!image?.width || !image?.height)
    return

  const size = renderer.getSize(new Vector2())
  if (!size.x || !size.y)
    return

  const rect = coverRect({ width: size.x, height: size.y }, { width: image.width, height: image.height })
  backgroundTexture.repeat.set(size.x / rect.width, size.y / rect.height)
  backgroundTexture.offset.set(-rect.x / rect.width, -rect.y / rect.height)
}

async function syncBackground() {
  if (!scene)
    return

  const url = props.backgroundUrl
  if (!url) {
    scene.background = null
    backgroundTexture?.dispose()
    backgroundTexture = undefined
    return
  }

  const owner = scene
  // A scene that cannot decode leaves the stage as it is, rather than throwing where
  // nothing is waiting to catch it.
  let texture: Texture
  try {
    texture = await new TextureLoader().loadAsync(url)
  }
  catch {
    return
  }

  // Scene art is authored in sRGB. Saying so keeps the renderer from encoding it a
  // second time, and marks the background as already display-referred so tone mapping
  // leaves it alone.
  texture.colorSpace = SRGBColorSpace
  // This renderer keeps three's premultiplied drawing buffer, and a background is
  // written to it unblended, so the scene has to arrive premultiplied as well. Scene art
  // is roughly half soft alpha, which is where the difference would show.
  texture.premultiplyAlpha = true

  // A later scene wins, and so does a later stage: both can be replaced while the
  // texture loads.
  if (props.backgroundUrl !== url || scene !== owner) {
    texture.dispose()
    return
  }

  backgroundTexture?.dispose()
  backgroundTexture = texture
  scene.background = texture
  layoutBackground()
}

watch(() => props.backgroundUrl, () => void syncBackground())

function resize() {
  if (!renderer || !camera || !canvasRef.value)
    return
  const w = canvasRef.value.clientWidth
  const h = canvasRef.value.clientHeight
  if (w === 0 || h === 0)
    return
  renderer.setSize(w, h, false)
  if (props.stageWorld) {
    applyStageWorld()
  }
  else {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  layoutBackground()
}

function renderLoop(now = performance.now()) {
  rafHandle = requestAnimationFrame(renderLoop)
  const delta = previousFrameTime === undefined ? 0 : (now - previousFrameTime) / 1000
  previousFrameTime = now

  if (props.paused || !renderer || !scene || !camera)
    return

  // The stage window can land on a display with another backing scale. The classic window keeps the ratio it started with.
  if (props.stageWorld && renderer.getPixelRatio() !== pixelRatio())
    renderer.setPixelRatio(pixelRatio())

  expressions.setSlotSettings(props.performanceSettings.slots)
  expressions.update(now / 1000)
  const clocks = frameClocks(now, diagnostics.directorClockOffsetMs)
  naturalSeconds = clocks.naturalSeconds
  if (animation && stance && loadedModelKey) {
    directorNowMs = clocks.directorMs
    bodyPoints = motionDriver.value === 'natural' && natural && mesh && camera && canvasRef.value
      ? resolveBodyPoints({ mesh, camera, viewport: canvasRef.value.getBoundingClientRect(), gazeMode: gazeMode.value, calibration: props.stageWorld?.calibration }, natural.bodyFrame)
      : null
    const base = stance.update({
      nowMs: clocks.directorMs,
      performance: props.performance,
      slots: stanceSlots.value[loadedModelKey] ?? {},
      idleMotionName: idleMotionName.value,
      isRegistered: name => registeredMotions.has(name),
      points: bodyPoints ?? undefined,
      world: props.stageWorld ? directorWorld(props.stageWorld, loadedModelKey) : undefined,
      // Pokes and drags exist in the classic window too, so the interaction inputs ride outside the world.
      baseEligible: isBaseEligible,
      interaction: { interactionSeq, chatSendSeq, interactionAtMs, actionRequest: pendingAction, actionFeedback, dragging },
    })
    if (base.changed)
      animation.setBaseMotion(base.motion)
    obeyAction()
    // Outside the stage-world block: perform_action answers in the classic window too.
    actionPort.observe({ directorMs: clocks.directorMs, diagnostics: stance.diagnostics })
    reportBody(stance.intent)
    playUnasked(clocks.directorMs, loadedModelKey, stance.intent)
    if (props.stageWorld) {
      bodyToolPort.observe({
        rootX: stageRootX,
        homeX: props.stageWorld.homeX,
        standX: chatStandSpotX,
        locomotionMode: body?.locomotionFrame?.mode ?? 'idle',
        directorMs: clocks.directorMs,
        diagnostics: stance.diagnostics,
      })
    }
    // Sent every frame: the body drops a goal set while a clip owns the root, so the intent is the only source of truth.
    const locomotion = stance.intent?.locomotion
    body?.setLocomotionGoal(locomotion && locomotion.goalX !== null
      ? { goalX: locomotion.goalX, pace: locomotion.pace, arriveFacing: locomotion.arriveFacing, reason: locomotion.reason }
      : null)
  }
  layerClip = animation?.snapshot().layer?.name ?? null
  animation?.update(delta)
  if (touch)
    handleTouchEvents(touch.update(now))
  overlays?.update()

  if (!props.stageWorld)
    controls?.update()
  const activeRenderer = renderer
  const activeScene = scene
  const activeCamera = camera
  diagnostics.measure('render', () => activeRenderer.render(activeScene, activeCamera))
  diagnostics.recordFrame(delta)
  if (now - lastDiagnosticsTime >= 100) {
    lastDiagnosticsTime = now
    diagnostics.publish({
      loadedModelKey,
      driver: motionDriver.value,
      rig: rig ? { ...rig, capabilities: body?.capabilities ?? null } : null,
      natural: natural ? { ...natural.diagnostics, headYaw: body?.diagnostics.lookAt.yaw ?? 0 } : null,
      feet: motionDriver.value === 'natural' ? body?.diagnostics.feet ?? null : null,
      lookAt: motionDriver.value === 'natural' ? body?.diagnostics.lookAt ?? null : null,
      locomotion: motionDriver.value === 'natural' ? body?.diagnostics.locomotion ?? null : null,
      arms: motionDriver.value === 'natural' ? body?.diagnostics.arms ?? null : null,
      touch: touch && canvasRef.value ? touch.diagnostics(activeCamera, canvasRef.value.getBoundingClientRect()) : null,
      director: stance ? { ...stance.diagnostics, clockOffsetMs: diagnostics.directorClockOffsetMs, centerY: centerModelY() } : null,
      animation: animation?.snapshot() ?? { idle: null, currentAction: null, actionsStarted: 0, layer: null },
      action: actionSnapshot(),
      clips: clipsSnapshot(),
      characterPlacement: characterPlacement.value,
      stageModel: stageModel.value,
      world: worldSnapshot(),
      ownership: motionDriver.value === 'natural' && body ? { ...body.ownership() } : null,
      performance: motionDriver.value === 'natural' ? body?.diagnostics.performance ?? null : null,
    })
  }
}

/** The stage calibration for the lab's World card; `characterHeightDip` follows from the calibration's `s = Hm / P`. */
function worldSnapshot(): MMDMotionSnapshot['world'] {
  const world = props.stageWorld
  const model = stageModel.value
  if (!world || !model)
    return null
  const { unitsPerDip, floorRowDip, originX } = world.calibration
  return {
    unitsPerDip,
    floorRowDip,
    ground: { minX: world.ground.minX, maxX: world.ground.maxX },
    homeX: world.homeX,
    characterHeightDip: model.height / unitsPerDip,
    originX,
    reach: world.row?.slots.map(slot => ({ minX: slot.ground.minX, maxX: slot.ground.maxX })) ?? null,
  }
}

/** What the world overlays draw this frame: the work-area edges on the floor line, the ground, home and the director's goal. */
function overlayStage(): MMDOverlayStage | null {
  const world = props.stageWorld
  if (!world)
    return null
  const { calibration, workArea } = world
  const floorX = (xDip: number) => dipToPlane(calibration, { x: xDip, y: calibration.floorRowDip }, 0).x
  const director = stance?.diagnostics
  return {
    floor: { minX: floorX(0), maxX: floorX(workArea.width) },
    ground: { minX: world.ground.minX, maxX: world.ground.maxX },
    homeX: world.homeX,
    goalX: director?.goalX ?? null,
    goalReason: director?.reason ?? null,
  }
}

/** The world half of the director input for this frame; only called in stage mode. */
function directorWorld(world: MMDStageWorld, modelKey: string): MMDStanceWorld {
  const { calibration } = world
  const placement = props.screenPlacement
  const dipScale = placement ? placement.windowBounds.width / document.documentElement.clientWidth : 0
  const chat = props.chatTarget?.visible ? props.chatTarget.bounds : null
  const legLength = rig?.legLength ?? 1
  const halfWidth = (characterPlacement.value?.width ?? 0) / 2 * calibration.unitsPerDip
  const cursor = props.cursorPosition
  // On a row the cursor and the chat can be on another display, so their screen positions place them, not this window.
  const onRow = world.row && placement
    ? rowInputs(world.row, { cursor: cursor ? { x: cursor.x + placement.windowBounds.x, y: cursor.y + placement.windowBounds.y } : null, chat })
    : null
  // The chat's left and right edges, projected to the ground at the floor row.
  const edges = onRow
    ? onRow.chat && [onRow.chat.minX, onRow.chat.maxX]
    : chat && placement && dipScale > 0
      ? [chat.x, chat.x + chat.width].map(x => dipToPlane(calibration, { x: (x - placement.windowBounds.x) / dipScale, y: calibration.floorRowDip }, 0).x)
      : null
  const chatX = edges ? chatStandX({ minX: edges[0], maxX: edges[1] }, stageRootX, world.homeX, halfWidth, legLength, onRow?.chat?.ground ?? world.ground) : null
  chatStandSpotX = chatX === null ? null : chatX + Math.sign(world.homeX - chatX) * legLength
  const owned = body?.ownership()
  return {
    ground: world.ground,
    reach: onRow?.reach,
    rootX: stageRootX,
    homeX: world.homeX,
    locomotionMode: body?.locomotionFrame?.mode ?? 'idle',
    clipOwnsRoot: !!owned && (owned.root > 0 || owned.leftLegIk > 0 || owned.rightLegIk > 0),
    speaking: props.nowSpeaking || props.performance.mode === 'talking',
    roamMode: roamMode.value,
    chatUnfoldSeq,
    chatX,
    cursorX: onRow ? onRow.cursorX : cursor ? dipToPlane(calibration, cursor, 0).x : null,
    cursorOnStage: onRow ? onRow.cursorOnStage : !!cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x <= world.workArea.width && cursor.y <= world.workArea.height,
    toolRequest: bodyToolPort.request,
    debugGoal: diagnostics.goalRequest,
    legLength,
    seed: fnv1a32(modelKey),
  }
}

/** センター height in model units, so stance checks do not depend on the view scale. */
function centerModelY(): number | null {
  const name = rig?.hipsTranslation.center
  const center = name ? mesh?.skeleton.bones.find(bone => bone.name === name) : undefined
  if (!mesh || !center)
    return null
  return mesh.worldToLocal(center.getWorldPosition(new Vector3())).y
}

function disposeModel() {
  // Invalidate pending loader, physics initialization and motion continuations.
  loadGeneration++
  stopTraceEvents?.()
  stopTraceEvents = undefined
  diagnostics.setTraceSource(null)
  traceSource = null
  expressions.dispose()
  stopMorphOverrides?.()
  stopMorphOverrides = undefined
  emote?.dispose()
  overlays?.dispose()
  overlays = undefined
  morphRuntime?.resetToBase()
  const runtimeDisposedByManager = animation !== undefined
  if (animation) {
    animation.dispose()
    animation = undefined
  }
  if (!runtimeDisposedByManager)
    resolved?.mmd.dispose()

  if (modelGroup && scene) {
    scene.remove(modelGroup)
    disposeMMDObject(modelGroup)
  }
  resolved?.dispose()
  registeredMotions.clear()
  loadedClips.clear()
  requestedKinds.clear()
  pendingAction = null
  actionFeedback = null
  playedActionSeq = null
  layerClip = null
  dragging = false
  modelGroup = undefined
  mesh = undefined
  morphs = undefined
  emote = undefined
  morphRuntime = undefined
  // The model goes away: whatever she was doing on her own ends for the situation too.
  for (const report of natural?.endIdleReports() ?? [])
    emit('idle', report)
  reportBody(null)
  unaskedActionSeq = null
  idleClipMemory = initialIdleClipMemory
  natural = undefined
  body = undefined
  stance = undefined
  rig = undefined
  gaze = undefined
  resolved = undefined
  loadedModelKey = null
  libraryModelKey.value = null
  stageExtent = undefined
  stageFootBaselineY = 0
  stageRootYaw = 0
  characterPlacement.value = null
  stageModel.value = null
  diagnostics.setMetrics(new MMDFrameMetrics())
  diagnostics.publish({ loadedModelKey: null, rig: null, natural: null, feet: null, lookAt: null, director: null, animation: { idle: null, currentAction: null, actionsStarted: 0, layer: null }, action: actionSnapshot(), clips: [], characterPlacement: null, stageModel: null, locomotion: null, ownership: null })
  mmdStore.isModelLoaded = false
}

/**
 * Loads and registers any imported VMD motions not yet bound to the current
 * model. The render loop's stance director picks the base clip once a motion
 * is registered. Safe to call repeatedly; already-registered motions are skipped.
 */
async function syncMotions() {
  if (!animation || !mesh)
    return

  const generation = loadGeneration
  const activeAnimation = animation
  const activeMesh = mesh
  const activeRig = rig
  if (!activeRig)
    return
  // A removed motion must not keep its binding: a later import under the same name is a different file.
  for (const name of registeredMotions.prune(availableMotions.value.map(descriptor => descriptor.name)))
    loadedClips.delete(name)
  for (const descriptor of availableMotions.value) {
    const revision = descriptor.revision ?? 0
    if (registeredMotions.isCurrent(descriptor.name, revision))
      continue
    try {
      // The VMD file lives in IndexedDB (shared across windows); build a
      // window-local object URL to load it, then revoke it once parsed.
      const file = await mmdStore.getMotionFile(descriptor.id)
      if (generation !== loadGeneration)
        return
      if (!file) {
        console.warn(`[mmd] motion file "${descriptor.name}" (${descriptor.id}) not found in storage`)
        continue
      }
      const url = URL.createObjectURL(file)
      try {
        const clip = await loadMMDAnimationClip(url, activeMesh)
        if (generation !== loadGeneration)
          return
        const mask = buildMMDClipMask(clip, activeRig)
        const meta = deriveClipMeta(mask, clip.duration * 1000, descriptor.name)
        loadedClips.set(descriptor.name, { clip, mask })
        availableClipMeta.value = { ...availableClipMeta.value, [descriptor.name]: { name: descriptor.name, ...meta } }
        activeAnimation.registerClip(descriptor.name, clip, {
          layer: meta.layer === 'upper' ? 'upper' : 'full',
          split: meta.layer !== 'none',
          animatedBones: mask.animatedBones,
        })
        registerBodyClip(descriptor.name)
        registeredMotions.mark(descriptor.name, revision)
        if (clip.tracks.length === 0) {
          console.warn(
            `[mmd] motion "${descriptor.name}" loaded but has 0 tracks matching this model. `
            + 'The VMD\'s bone/morph names likely do not match the model (different rig/naming).',
          )
        }
      }
      finally {
        URL.revokeObjectURL(url)
      }
    }
    catch (err) {
      if (generation !== loadGeneration)
        return
      console.error('[mmd] failed to load motion', descriptor.name, errorMessageFrom(err))
      emit('error', err)
    }
  }
}

/** What her body is doing on its own in this frame, or `null`: an unasked clip first, then a walk, then a resting stance. */
function bodyActivity(intent: BodyIntent | null): MMDSelfReport | null {
  if (!intent || motionDriver.value !== 'natural')
    return null
  if (intent.action !== null && intent.action.seq === unaskedActionSeq && intent.action.phase === 'playing') {
    const label = loadedModelKey ? mmdStore.curationFor(loadedModelKey, intent.action.clipId).label : null
    return { activity: 'clip', phase: 'start', ...(label === null ? {} : { label }) }
  }
  const walk = { 'wander': 'wander', 'visit': 'visit', 'return-home': 'go-home' } as const
  const reason = intent.locomotion.goalX === null ? undefined : walk[intent.locomotion.reason as keyof typeof walk]
  if (reason)
    return { activity: reason, phase: 'start' }
  return intent.stance === 'stand' ? null : { activity: intent.stance, phase: 'start' }
}

/** Emits a `self` report when her body starts or stops doing something on its own. */
function reportBody(intent: BodyIntent | null) {
  const next = bodyActivity(intent)
  if (next?.activity === reportedBody?.activity && next?.label === reportedBody?.label)
    return
  if (reportedBody)
    emit('self', { ...reportedBody, phase: 'end' })
  if (next)
    emit('self', next)
  reportedBody = next
}

/**
 * Lets her play one of the clips the user allowed for idle, when the scheduler says so and her body is quiet. The
 * director still decides: the request goes through `requestPerform` with the `idle` source.
 */
function playUnasked(directorMs: number, modelKey: string, intent: BodyIntent | null) {
  const { mode, away } = props.performance
  const quiet = naturalSettings.document.idleActivities
    && motionDriver.value === 'natural'
    && (mode === 'idle' || mode === 'watching')
    && !away
    && !props.nowSpeaking
    && !dragging
    && intent !== null
    && intent.stance === 'stand'
    && intent.action === null
    && intent.locomotion.goalX === null
    // One thing at a time: a stretch or a yawn finishes before a clip starts.
    && natural?.natural.idleState.behaviour == null
  const decision = decideIdleClip({ nowMs: directorMs, clips: idleClips.value, quiet, pace: hostIdleDrive?.rate ?? 0, seed: fnv1a32(modelKey) }, idleClipMemory)
  idleClipMemory = decision.memory
  if (decision.clipId !== null && requestPerform(decision.clipId, { source: 'idle' }))
    unaskedActionSeq = performSeq
}

/**
 * The drive this scene hands to Natural: the stage's drive, without sleep when the model has its own sleep clip, and
 * without new activities while a clip plays. Rebuilt only when one of the three changes, so Natural sees a new drive
 * only then.
 */
function resolveIdleDrive(): NaturalIdleDrive | null {
  if (hostIdleDrive === null || !naturalSettings.document.idleActivities)
    return sceneIdleDrive = null
  const slots = loadedModelKey ? stanceSlots.value[loadedModelKey] : undefined
  const allowSleep = !slots?.sleep || !registeredMotions.has(slots.sleep)
  const rate = stance?.intent?.action ? 0 : hostIdleDrive.rate
  if (sceneIdleDrive === null || sceneIdleSource !== hostIdleDrive || sceneIdleDrive.allowSleep !== allowSleep || sceneIdleDrive.rate !== rate) {
    sceneIdleSource = hostIdleDrive
    sceneIdleDrive = { ...hostIdleDrive, allowSleep, rate }
  }
  return sceneIdleDrive
}

/** Tells the body which groups a clip owns even where its tracks key none of them: a full-body action stops the gait. */
function registerBodyClip(name: string) {
  const loaded = loadedClips.get(name)
  if (!loaded || !body || !loadedModelKey)
    return
  const kind = mmdStore.curationFor(loadedModelKey, name).kind ?? availableClipMeta.value[name]?.kind
  body.registerClip(name, loaded.clip, { forceGroups: kind === 'action' || kind === 'dance' ? FULL_BODY_GROUPS : undefined })
}

/**
 * Whether a clip may loop as a standing base. An exposed action never does. A clip the user put in a stance slot is
 * their explicit choice and stands whatever its derived kind; any other clip needs the `stance` kind.
 */
function isBaseEligible(name: string): boolean {
  const key = loadedModelKey
  if (!key)
    return true
  if (mmdStore.exposedActions(key).some(clip => clip.name === name))
    return false
  const slots = stanceSlots.value[key] ?? {}
  if (name === slots.idle || name === slots.sit || name === slots.sleep)
    return true
  const kind = mmdStore.curationFor(key, name).kind ?? availableClipMeta.value[name]?.kind
  return kind === undefined || kind === 'stance'
}

/**
 * Queues a clip for the director (or a stop with `null`). Returns false when the clip is not usable on this model.
 * Kind, layer and loop come from the derived metadata and the user's curation; an unknown clip defaults to an upper gesture.
 */
function requestPerform(name: string | null, options: { loop?: boolean, source: BodyActionRequest['source'] }): boolean {
  if (!stance || !loadedModelKey)
    return false
  // A request the director has not read yet gives way to this one.
  if (pendingAction && pendingAction.seq > stance.diagnostics.lastActionSeq)
    actionDrops.superseded++
  const seq = ++performSeq
  if (name === null || name === '') {
    pendingAction = { seq, clipId: '', kind: 'action', layer: 'full', loop: false, durationMs: 0, source: options.source === 'act' ? 'debug' : options.source }
    return true
  }
  if (!registeredMotions.has(name)) {
    actionDrops.unknown++
    console.warn(`[mmd] perform skipped: "${name}" is not registered on this model`)
    return false
  }
  const meta = availableClipMeta.value[name]
  const curation = mmdStore.curationFor(loadedModelKey, name)
  const kind = curation.kind ?? meta?.kind ?? 'gesture'
  if (kind === 'unusable') {
    console.warn(`[mmd] perform skipped: "${name}" is unusable`)
    return false
  }
  const layer = meta ? effectiveLayer(meta, curation.kind) : 'upper'
  const actionKind: BodyActionKind = kind === 'stance' ? 'action' : kind
  pendingAction = {
    seq,
    clipId: name,
    kind: actionKind,
    layer: layer === 'full' ? 'full' : 'upper',
    loop: options.loop ?? curation.loop ?? meta?.loop ?? false,
    durationMs: meta?.durationMs ?? 0,
    source: options.source,
  }
  requestedKinds.set(seq, actionKind)
  if (requestedKinds.size > 16)
    requestedKinds.delete(requestedKinds.keys().next().value as number)
  return true
}

/** Plays the layer the director accepted and ends it when the director lets go. */
function obeyAction() {
  if (!animation || !stance)
    return
  const action = stance.intent?.action ?? null
  if (action?.phase === 'playing') {
    if (playedActionSeq !== action.seq) {
      playedActionSeq = action.seq
      animation.playLayer(action.clipId, {
        seq: action.seq,
        layer: action.layer,
        loop: action.loop,
        kind: requestedKinds.get(action.seq) === 'dance' ? 'dance' : 'action',
      })
    }
    return
  }
  // No performance, or one still settling: a layer of an earlier performance ends now.
  if (playedActionSeq !== null && playedActionSeq !== action?.seq) {
    animation.stopLayer(playedActionSeq)
    playedActionSeq = null
  }
}

function actionSnapshot(): MMDMotionSnapshot['action'] {
  const diagnostics = stance?.diagnostics
  return {
    performing: diagnostics?.performing ? { name: diagnostics.performing.clipId, layer: diagnostics.performing.layer, phase: diagnostics.performing.phase, seq: diagnostics.performing.seq } : null,
    lastActionSeq: diagnostics?.lastActionSeq ?? 0,
    refusal: diagnostics?.actionRefusal ?? null,
    retryAfterMs: diagnostics?.actionRetryAfterMs ?? null,
    drops: { ...actionDrops },
  }
}

function clipsSnapshot(): MMDMotionSnapshot['clips'] {
  const key = loadedModelKey
  if (!key)
    return []
  const clips: MMDMotionSnapshot['clips'] = []
  for (const { name } of availableMotions.value) {
    const meta = availableClipMeta.value[name]
    if (!meta || !registeredMotions.has(name))
      continue
    const curation = mmdStore.curationFor(key, name)
    const layer = effectiveLayer(meta, curation.kind)
    clips.push({
      name,
      kind: curation.kind ?? meta.kind,
      layer,
      loop: curation.loop ?? meta.loop,
      label: curation.label,
      exposed: curation.aiMayUse && curation.label !== null,
      downgraded: layer !== meta.layer,
      notes: [...meta.notes],
    })
  }
  return clips
}

async function loadModel(src: string) {
  if (!scene)
    return

  componentState.value = 'loading'
  disposeModel()
  const generation = loadGeneration
  const modelId = props.modelId
  const modelKey = modelId ?? src

  try {
    const loaded = await loadMMDModelFromSource(src, { cacheKey: modelId })
    // A stale result never acquires scene or expression-store ownership.
    if (generation !== loadGeneration) {
      loaded.mmd.dispose()
      disposeMMDObject(loaded.mesh)
      loaded.dispose()
      return
    }
    resolved = loaded
    mesh = resolved.mesh

    modelGroup = new Group()
    modelGroup.add(mesh)
    applyTransform()
    scene.add(modelGroup)

    morphs = createMorphController(mesh, morphOverrides.value)
    mmdStore.availableMorphs = morphs.availableMorphs
    if (!morphs.resolvedSlots.some(slot => slot.startsWith('vowel'))) {
      console.warn(
        '[mmd] no vowel mouth morphs (あ/い/う/え/お) resolved; lip-sync cannot move the mouth. '
        + 'Available morphs:',
        morphs.availableMorphs,
      )
    }

    const runtime = createMMDMorphRuntime(resolved.mmd)
    morphRuntime = runtime
    expressions.registerMorphs(modelKey, runtime.morphs, runtime)
    const expressionMorphs = createMorphController(mesh, morphOverrides.value, (name, weight) => runtime.setChannel('expression', name, weight))
    const blinkMorphs = createMorphController(mesh, morphOverrides.value, (name, weight) => runtime.setChannel('blink', name, weight, { alpha: weight > 0 ? 1 : 0 }))
    const lipMorphs = createMorphController(mesh, morphOverrides.value, (name, weight) => runtime.setChannel('lipSync', name, weight))
    emote = useMMDEmote(expressionMorphs)
    gaze = createGazeController(mesh)
    rig = readMMDRigProfile(resolved.mmd.pmx)
    natural = new MMDNaturalAdapter(modelKey)
    const activeStance = new MMDStanceDirector()
    stance = activeStance
    const activeMesh = mesh
    // The pure morph core copies enumerable x/y/z/w fields. Three's quaternion
    // stores _x/_y/_z/_w, so serialize explicitly at this renderer boundary.
    const proceduralPose = mesh.skeleton.bones.map(bone => ({
      position: bone.position,
      quaternion: { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w },
    }))

    animation = createMMDAnimationManager(resolved.mmd, { physicsEnabled: physicsEnabled.value, maskBones: mmdClipMaskBones(rig) })
    animation.onLayerEvent((event) => {
      // The director reads only the end of a performance; `playing` needs no answer.
      if (event.state !== 'playing')
        actionFeedback = { seq: event.seq, state: event.state }
    })
    body = new MMDBody(resolved.mmd, rig, {
      modelKey,
      input: () => {
        if (!natural || !camera || !canvasRef.value)
          return null
        return {
          enabled: motionDriver.value === 'natural',
          // The root is placed on the floor line (and the body re-based there) once the stage extent is measured.
          rootMotion: props.stageWorld !== undefined && stageExtent !== undefined,
          frame: natural.bodyFrame.frame,
          intent: natural.bodyFrame.intent,
          energy: props.naturalEnergy ?? naturalSettings.document.energy,
          stance: activeStance.intent?.stance,
          target: resolveBodyTarget(bodyPoints, natural.bodyFrame, gazeMode.value, activeStance.intent),
          ...diagnostics.debugFlags,
          stanceClips: activeStance.baseClips,
          dragging,
          layerClip,
          fullLayerPlaying: activeStance.intent?.action?.phase === 'playing' && activeStance.intent.action.layer === 'full',
        }
      },
      // Per-frame root motion: no physics reset on this path, so Ammo feels the travel.
      root: { setPose: (x, yaw) => {
        if (!modelGroup)
          return
        stageRootX = x
        stageRootYaw = yaw
        modelGroup.position.x = x
        modelGroup.rotation.y = yaw
        modelGroup.updateMatrixWorld(true)
        publishPlacement()
      } },
    })
    diagnostics.setMetrics(animation.pipeline.metrics)
    const activeBody = body
    const sampler = createMMDMotionTraceSampler(resolved.mmd, rig, new MMDBodyPose(resolved.mmd, rig))
    let source: MMDMotionTraceSource | undefined
    let lastGoal: string | null = null
    const stages = composeMMDStages({
      body: activeBody,
      host: {
        'natural': ({ dt }) => {
          if (motionDriver.value !== 'natural' || !natural || !camera || !canvasRef.value)
            return
          const rect = canvasRef.value.getBoundingClientRect()
          activeMesh.updateWorldMatrix(true, false)
          const head = projectMMDHead(activeMesh, camera, rect)
          const cursor = gazeMode.value === 'mouse' && head && props.cursorPosition
            ? { x: (props.cursorPosition.x - head.x) / head.width, y: (head.y - props.cursorPosition.y) / head.width }
            : gazeMode.value === 'camera' ? { x: 0, y: 0 } : null
          const headX = props.stageWorld ? stageHeadDipX(props.stageWorld) ?? head?.x : head?.x
          const speaking = props.nowSpeaking
          const placement = props.screenPlacement
          const dipScale = placement ? placement.windowBounds.width / document.documentElement.clientWidth : 0
          const bounds = props.chatTarget?.bounds
          const chatPoint = head && placement && bounds && dipScale > 0
            ? {
                x: ((bounds.x + bounds.width / 2 - placement.windowBounds.x) / dipScale - head.x) / head.width,
                y: (head.y - (bounds.y + bounds.height / 2 - placement.windowBounds.y) / dipScale) / head.width,
              }
            : null
          natural.setPerformanceSettings(toRaw(props.performanceSettings))
          natural.setIdleDrive(resolveIdleDrive())
          natural.advance(dt, {
            performance: props.performance,
            energy: props.naturalEnergy ?? naturalSettings.document.energy,
            voice: { speaking, speechActiveOrRecent: speaking, level: props.mouthOpenSize },
            cursor,
            chat: props.chatTarget
              ? { ...props.chatActivity ?? { typing: false, sentSeq: 0, sentWords: 0 }, target: props.chatTarget.visible ? chatPoint : null, unfoldSeq: chatUnfoldSeq }
              : null,
            placement: !head || headX === undefined
              ? null
              : placement && dipScale > 0
                ? screenInwardness(placement.displays, placement.windowBounds.x + headX * dipScale)
                : mmdScreenInwardness(rect, headX),
            emotionStrengths: naturalSettings.document.emotionStrength[props.modelId ?? ''] ?? defaultEmotionStrengths,
          }, naturalSeconds)
          for (const report of natural.idleBehaviours)
            emit('idle', report)
          // Channels must be prepared before bone-morph evaluation. Their surface
          // effects are applied after physics by the morph-runtime surface stage.
          natural.applySurface(runtime, morphOverrides.value, activeBody.lidClose)
        },
        'classic-gaze': ({ dt, clean }) => {
          if (motionDriver.value === 'classic')
            gaze?.update(resolveGazeOffset(), dt, clean)
        },
        'classic-face': ({ dt }) => {
          if (motionDriver.value !== 'classic')
            return
          emote?.update(dt)
          blink.update(blinkMorphs, dt)
        },
        'lip-sync': ({ dt }) => {
          lipSync.update(lipMorphs, dt)
          runtime.setComposition({ speakEnv: props.currentAudioSource ? 1 : 0 })
        },
        'bone-morphs': () => {
          activeMesh.skeleton.bones.forEach((bone, index) => {
            const quaternion = proceduralPose[index].quaternion
            quaternion.x = bone.quaternion.x
            quaternion.y = bone.quaternion.y
            quaternion.z = bone.quaternion.z
            quaternion.w = bone.quaternion.w
          })
          runtime.setMaterialOpacityOverrides(materialOpacity.value)
          runtime.applyBoneStage(proceduralPose)
        },
        'morphs': () => runtime.applySurfaceStage(),
        'motion-trace': (context) => {
          if (!source || sampler.recorder.state() !== 'recording')
            return
          if (sampler.recorder.frames === 0)
            lastGoal = null
          else
            source.seconds += context.dt
          const gait = activeBody.locomotionFrame
          const target = activeBody.diagnostics.lookAt.target
          const voice = natural?.bodyFrame.input?.voice
          sampler.inputs.channels = {
            voiceLevel: voice?.level ?? 0,
            speaking: voice?.speaking ? 1 : 0,
            targetX: target?.x,
            targetY: target?.y,
            targetZ: target?.z,
            locomotionMode: gait ? ['idle', 'turning', 'starting', 'walking', 'stopping'].indexOf(gait.mode) : 0,
            gaitWeight: gait?.weight ?? 0,
          }
          sampler.stage.run(context)
          for (const event of gait?.events ?? [])
            sampler.recorder.event({ t: source.seconds, kind: 'gait', gait: event.kind, foot: event.foot })
          const goal = stance?.intent?.locomotion
          const key = `${goal?.goalX ?? null}:${goal?.pace ?? null}`
          if (key !== lastGoal) {
            sampler.recorder.event({ t: source.seconds, kind: 'goal', x: goal?.goalX ?? null, pace: goal?.pace ?? null })
            lastGoal = key
          }
          if (source.seconds >= source.maxSeconds)
            sampler.recorder.stop()
        },
      },
    })
    animation.pipeline.poseStages.push(...stages.pose)
    animation.pipeline.surfaceStages.push(...stages.surface)
    // The scene reports the stages it actually registered; `qa:stage capture` compares them with the shared composition.
    source = {
      recorder: sampler.recorder,
      rig: { ...sampler.rig, id: modelKey },
      stages: { pose: animation.pipeline.poseStages.map(stage => stage.id), surface: animation.pipeline.surfaceStages.map(stage => stage.id) },
      seconds: 0,
      maxSeconds: 0,
    }
    traceSource = source
    diagnostics.setTraceSource(source)
    observeTraceEvents()
    stopMorphOverrides = watch(morphOverrides, (overrides) => {
      for (const morph of runtime.morphs) {
        runtime.clearChannel('naturalFace', morph.name)
        runtime.clearChannel('blink', morph.name)
      }
      for (const controller of [expressionMorphs, blinkMorphs, lipMorphs]) {
        for (const slot of controller.resolvedSlots)
          controller.override(slot, overrides[slot] ?? '')
        for (const [slot, name] of Object.entries(overrides))
          controller.override(slot as Parameters<MorphController['override']>[0], name ?? '')
      }
    }, { deep: true })
    // No preset idle VMD ships yet; the runtime still advances solvers and
    // physics without an animation action.
    await animation.init()
    if (generation !== loadGeneration)
      return
    animation.setIKEnabled(ikEnabled.value)
    animation.setGrantEnabled(grantEnabled.value)
    animation.setGravity(physicsGravity.value)

    // Ensure the camera aspect matches the live canvas before fitting.
    resize()
    frameCamera()
    setMMDMaterialGlow(modelGroup, albedoGlow.value)
    mmdStore.availableMaterials = collectMMDMaterials(modelGroup)
    applyMMDMaterialOpacity(modelGroup, materialOpacity.value)

    mmdStore.isModelLoaded = true
    loadedModelKey = modelKey
    libraryModelKey.value = modelKey
    componentState.value = 'mounted'

    // Bind any motions imported before this model mounted.
    await syncMotions()
  }
  catch (err) {
    if (generation !== loadGeneration)
      return
    disposeModel()
    componentState.value = 'pending'
    console.error('[mmd] failed to load model:', errorMessageFrom(err))
    emit('error', err)
  }
}

/** Plays the gesture motion mapped to an emotion, if the model has one. */
function setClassicEmotion(emotion: string, intensity = 1) {
  const value = EMOTION_VALUES.includes(emotion as Emotion) ? emotion as Emotion : Emotion.Neutral
  if (motionDriver.value === 'classic')
    emote?.setEmotion(value, intensity)
  else
    natural?.setEmotion(value, intensity)

  const actionName = emotionActionMap.value[value]
  if (actionName && registeredMotions.has(actionName))
    requestPerform(actionName, { source: 'act' })
}

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  setupScene()
  resizeObserver = new ResizeObserver(() => resize())
  if (canvasRef.value)
    resizeObserver.observe(canvasRef.value)
  resize()
  renderLoop()

  if (props.modelSrc)
    loadModel(props.modelSrc)
})

onUnmounted(() => {
  bodyToolPort.dispose()
  actionPort.dispose()
  cancelAnimationFrame(rafHandle)
  resizeObserver?.disconnect()
  disposeModel()
  controls?.dispose()
  backgroundTexture?.dispose()
  backgroundTexture = undefined
  if (renderer) {
    renderer.dispose()
    renderer.forceContextLoss()
  }
  scene = undefined
  camera = undefined
  renderer = undefined
  controls = undefined
  ambientLight = undefined
  directionalLight = undefined
})

watch(() => props.modelSrc, (src) => {
  if (src)
    loadModel(src)
  else
    disposeModel()
})

// --- Touch
// Pokes and pets are a Natural reaction, so touch runs only while Natural drives the model.
const touchActive = computed(() => naturalSettings.document.touch && motionDriver.value === 'natural' && !props.paused)

function handleTouchEvents(events: NaturalTouchGesture[]) {
  if (!touch)
    return
  for (const poke of touch.takePokes()) {
    natural?.poke(poke.region, poke)
    noteInteraction()
  }
  natural?.setPet(touch.petHand)
  for (const event of events) {
    if (event.kind === 'pet-start')
      noteInteraction()
    emit('touch', event)
  }
}

function resetTouch() {
  if (touch)
    handleTouchEvents(touch.reset(performance.now()))
}

// The model is ready once the scene reports it mounted; any other state means it is gone or loading.
watch(componentState, (state) => {
  resetTouch()
  touch = state === 'mounted' && mesh && resolved && rig
    ? new MMDTouch(mesh, resolved.mmd.pmx, rig, { requireHold: naturalSettings.document.touchPetRequiresHold })
    : undefined
  if (!touch)
    diagnostics.publish({ touch: null })
}, { flush: 'sync' })

watch(touchActive, (active) => {
  if (!active)
    resetTouch()
})

watch(() => naturalSettings.document.touchPetRequiresHold, (requireHold) => {
  resetTouch()
  if (touch)
    touch.gestures.requireHold = requireHold
})

// --- Devtools overlays
// Overlay objects live in the scene only while the lab has them on; the model's lifecycle recreates them.
watch(componentState, (state) => {
  overlays?.dispose()
  overlays = undefined
  if (state !== 'mounted' || !mesh || !resolved || !rig || !scene)
    return
  const { mmd } = resolved
  const activeMesh = mesh
  overlays = new MMDOverlays(scene, {
    mesh: activeMesh,
    rig,
    colliders: buildMMDTouchColliders(mmd.pmx, activeMesh.skeleton.boneInverses, activeMesh.bindMatrix, mmdTouchRegionRoots(rig)),
    createIkHelper: () => mmd.ikSolver.createHelper(),
    lookAtTarget: () => motionDriver.value === 'natural' ? body?.diagnostics.lookAt.target ?? null : null,
    stage: overlayStage,
    createLabel: createOverlayLabel,
  })
  overlays.apply(diagnostics.overlays)
}, { flush: 'sync' })

watch(() => diagnostics.overlays, (flags) => {
  overlays?.apply(flags)
})

watch(() => diagnostics.roamModeRequest, (request) => {
  if (request)
    roamMode.value = request.mode
})

// Tuning switches one performance layer at a time; the stack eases it in or out.
watch(() => diagnostics.performanceLayerRequest, (request) => {
  if (request)
    body?.setPerformanceLayer(request.layer, request.enabled)
})

// Lab Play and Stop are debug requests: the director's busy, asleep and dragging rules apply, and a loop skips the
// gesture repeat cooldown so QA can replay a gesture.
watch(() => diagnostics.clipRequest, (request) => {
  if (request)
    requestPerform(request.name, { source: 'debug', loop: request.loop })
})

useEventListener(canvasRef, ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'pointercancel'], (event: PointerEvent) => {
  if (!event.isPrimary || !touch || !mesh || !camera || !canvasRef.value || !touchActive.value)
    return
  handleTouchEvents(touch.pointer(event, camera, canvasRef.value.getBoundingClientRect()))
})

watch(() => props.enableOrbitControls, (enabled) => {
  if (controls)
    controls.enabled = enabled && !props.stageWorld
})

watch(() => props.stageWorld, () => applyStageWorld())

// View transform sliders.
watch([scale, rotationY, () => position.value.x, () => position.value.y], () => applyTransform())

// Solver/physics toggles.
watch(physicsEnabled, v => animation?.setPhysicsEnabled(v))
watch(ikEnabled, v => animation?.setIKEnabled(v))
watch(grantEnabled, v => animation?.setGrantEnabled(v))
watch(physicsGravity, v => animation?.setGravity(v))

/** The observer reads performed events only; idle recording adds no pose work. */
function observeTraceEvents() {
  stopTraceEvents?.()
  let held: string | null = null
  stopTraceEvents = natural?.onEvent((event) => {
    const source = traceSource
    if (!source || source.recorder.state() !== 'recording')
      return
    const t = source.seconds
    let recorded: MotionTraceEvent | undefined
    switch (event.kind) {
      case 'impulse':
        recorded = { t, kind: 'emotion', emotion: event.emotion, band: event.band, phase: 'pulse' }
        break
      case 'hold':
        if (held)
          source.recorder.event({ t, kind: 'emotion', emotion: held, band: 'clear', phase: 'hold-end' })
        held = event.emotion
        if (held)
          recorded = { t, kind: 'emotion', emotion: held, band: 'clear', phase: 'hold-start' }
        break
      case 'gesture':
        recorded = { t, kind: 'gesture', gesture: event.gesture }
        break
      case 'touch':
        recorded = { t, kind: 'touch', touch: event.touch, region: event.region }
        break
    }
    if (recorded)
      source.recorder.event(recorded)
  })
  const stopBodyEvents = body?.onEvent((event) => {
    const source = traceSource
    if (source?.recorder.state() === 'recording')
      source.recorder.event(mmdBodyTraceEvent(event, source.seconds))
  })
  const stopNaturalEvents = stopTraceEvents
  stopTraceEvents = () => {
    stopNaturalEvents?.()
    stopBodyEvents?.()
  }
}

watch(motionDriver, () => {
  traceSource?.recorder.stop()
  if (morphRuntime) {
    for (const morph of morphRuntime.morphs) {
      for (const layer of ['naturalFace', 'blink', 'expression', 'lipSync'] as const)
        morphRuntime.clearChannel(layer, morph.name)
    }
  }
  if (mesh && rig)
    natural = new MMDNaturalAdapter(props.modelId ?? props.modelSrc ?? '')
  body?.resetPerformance()
  observeTraceEvents()
})

// Morph-slot overrides: rebind each slot the user remapped (empty = auto).
watch(morphOverrides, (overrides) => {
  if (!morphs)
    return
  for (const [slot, name] of Object.entries(overrides))
    morphs.override(slot as Parameters<MorphController['override']>[0], name ?? '')
}, { deep: true })

// One-shot motion requests from the lab and the settings window go through the director like every other clip.
watch(performRequest, (request) => {
  if (request)
    requestPerform(request.name, { loop: request.loop || undefined, source: 'debug' })
})

// A curated kind decides whether the body treats a clip as full-body, so re-register the body's view of every clip.
watch(clipCuration, () => {
  for (const name of loadedClips.keys())
    registerBodyClip(name)
}, { deep: true })

// Newly imported VMD motions: load and register them against the live model.
watch(availableMotions, () => {
  void syncMotions()
}, { deep: true })

// Scene settings — lighting.
watch([ambientColor, ambientIntensity], () => {
  if (!ambientLight)
    return
  ambientLight.color.set(normalizeHex(ambientColor.value))
  ambientLight.intensity = ambientIntensity.value
})
watch([directionalColor, directionalIntensity], () => {
  if (!directionalLight)
    return
  directionalLight.color.set(normalizeHex(directionalColor.value))
  directionalLight.intensity = directionalIntensity.value
})
watch(directionalPosition, () => {
  directionalLight?.position.set(directionalPosition.value.x, directionalPosition.value.y, directionalPosition.value.z)
}, { deep: true })

// Scene settings — camera & rendering.
watch(cameraFov, () => {
  if (!camera || props.stageWorld)
    return
  camera.fov = cameraFov.value
  camera.updateProjectionMatrix()
})
watch(renderScale, () => {
  renderer?.setPixelRatio(pixelRatio())
  resize()
})
watch(albedoGlow, () => {
  if (modelGroup)
    setMMDMaterialGlow(modelGroup, albedoGlow.value)
})
watch(materialOpacity, () => {
  if (modelGroup)
    applyMMDMaterialOpacity(modelGroup, materialOpacity.value)
}, { deep: true })

defineExpose({
  canvasElement,
  captureFrame,
  setClassicEmotion,
  setEmotion: (episode: NaturalEpisode) => {
    natural?.impulse(episode)
    const actionName = emotionActionMap.value[episode.emotion]
    if (actionName && registeredMotions.has(actionName))
      requestPerform(actionName, { source: 'act' })
  },
  applySlots: (commands: SlotCommand[], now: number) => expressions.applySlots(commands, now),
  applyHolds: (commands: HoldCommand[], now: number) => natural?.applyHolds(commands, now),
  gesture: (kind: CueGestureKind, count: number) => natural?.gesture(kind, count),
  addMood: (dose: MoodDose) => natural?.addMood(dose),
  setFaceBaseline: (baseline: FaceBaseline) => natural?.setFaceBaseline(baseline),
  /** The drive of self-directed idle behaviour; the stage sends it again every second. */
  setIdleDrive: (drive: NaturalIdleDrive | null) => { hostIdleDrive = drive },
  idleCue: (kind: IdleCueKind) => natural?.idleCue(kind),
  onSpeech: (event: SpeechEvent, turnId: string, now: number) => {
    expressions.onSpeech(event, turnId, now)
    natural?.onSpeech(event, turnId, now)
  },
  setMuted: (muted: boolean) => {
    expressions.setMuted(muted)
    natural?.setMuted(muted)
  },
  getMood: () => natural?.mood ?? null,
  listMorphs: () => morphs?.availableMorphs ?? [],
  listMotions: () => animation?.availableClips() ?? [],
  listActions: () => libraryModelKey.value ? mmdStore.labeledClips(libraryModelKey.value) : [],
  action: (label: string, gesture?: { kind: string }) => {
    if (!loadedModelKey)
      return false
    const { perform, drops } = resolveActAction(label, gesture, mmdStore.labeledClips(loadedModelKey))
    for (const drop of drops)
      actionDrops[ACT_DROP_COUNTER[drop.reason]]++
    return perform ? requestPerform(perform, { source: 'act' }) : false
  },
  setRootX,
  setDragging,
  characterPlacement,
  bodyPort: computed(() => props.stageWorld ? bodyToolPort : null),
  actionPort,
})
</script>

<template>
  <Screen relative>
    <canvas ref="canvasRef" h-full w-full />
  </Screen>
</template>
