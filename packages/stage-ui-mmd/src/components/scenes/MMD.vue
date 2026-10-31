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

import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { NaturalChatInput } from '@proj-airi/motion-driver-natural/natural-motion'
import type { ExpressionPerformanceSettings, HoldCommand, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { SkinnedMesh, Texture } from 'three'

import type { GazeOffset, MMDAnimationManager, MorphController } from '../../composables/mmd'
import type { MMDTouchEvent } from '../../composables/mmd/touch'
import type { SpeechEvent } from '../../stores/expression-slots'
import type { ResolvedMMDModel } from '../../utils/mmd-loader'

import { errorMessageFrom } from '@moeru/std'
import { coverRect } from '@proj-airi/stage-shared'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { screenInwardness } from '@proj-airi/stage-shared/stage-placement'
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
import { computed, onMounted, onUnmounted, ref, toRaw, toRef, watch } from 'vue'

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
import { MMDBody } from '../../composables/mmd/body'
import { resolveBodyTarget } from '../../composables/mmd/body/attention'
import { resolveFrameBounds } from '../../composables/mmd/camera-bounds'
import { createMMDMorphRuntime } from '../../composables/mmd/morph-runtime'
import { MMDNaturalAdapter, mmdScreenInwardness, projectMMDHead } from '../../composables/mmd/natural/adapter'
import { readMMDRigProfile } from '../../composables/mmd/rig'
import { frameClocks, MMDStanceDirector } from '../../composables/mmd/stance'
import { MMDTouch } from '../../composables/mmd/touch'
import { Emotion, EMOTION_VALUES } from '../../constants/emotions'
import { useMMDExpressionStore } from '../../stores/expression-store'
import { useMMD } from '../../stores/mmd'
import { useMMDMotionDiagnostics } from '../../stores/motion-diagnostics'
import { loadMMDModelFromSource } from '../../utils/mmd-loader'
import {
  applyMMDMaterialOpacity,
  collectMMDMaterials,
  disposeMMDObject,
  setMMDMaterialGlow,
} from '../../utils/mmd-materials'

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
  (e: 'touch', event: MMDTouchEvent): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const mmdStore = useMMD()
const diagnostics = useMMDMotionDiagnostics()
const expressions = useMMDExpressionStore()
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
  naturalEnergy,
  naturalTouch,
  naturalTouchPetRequiresHold,
  position,
  scale,
  rotationY,
  morphOverrides,
  emotionActionMap,
  materialOpacity,
  idleMotionName,
  availableMotions,
  stanceSlots,
  oneShotAction,
  cameraFov,
  ambientColor,
  ambientIntensity,
  directionalColor,
  directionalIntensity,
  directionalPosition,
  albedoGlow,
  renderScale,
} = storeToRefs(mmdStore)

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
let body: MMDBody | undefined
let rig: ReturnType<typeof readMMDRigProfile> | undefined
let stopMorphOverrides: (() => void) | undefined
let touch: MMDTouch | undefined
let stance: MMDStanceDirector | undefined
// Natural's clock for the current frame; the director clock offset never reaches it.
let naturalSeconds = performance.now() / 1000
// Motion names already bound to the current model runtime.
const registeredMotions = new Set<string>()
let rafHandle = 0
let previousFrameTime: number | undefined
let lastDiagnosticsTime = 0
let loadedModelKey: string | null = null
let loadGeneration = 0

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
  modelGroup.scale.setScalar(scale.value)
  modelGroup.rotation.y = rotationY.value
  modelGroup.position.set(position.value.x, position.value.y, 0)
  animation?.pipeline.requestPhysicsReset()
}

/**
 * three.Color rejects 8-digit `#RRGGBBAA` hex, which the color picker emits.
 * Strip the alpha channel so light colors actually apply.
 */
function normalizeHex(hex: string): string {
  return /^#[0-9a-f]{8}$/i.test(hex) ? hex.slice(0, 7) : hex
}

function setupScene() {
  const canvas = canvasRef.value!
  renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = SRGBColorSpace
  // MMD toon materials are not PBR/HDR; filmic tone mapping desaturates and
  // washes them out, so render their colors directly.
  renderer.toneMapping = NoToneMapping
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * renderScale.value)

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
  controls.enabled = props.enableOrbitControls
}

/** Frames the camera so the whole model fits the viewport, and centers it. */
function frameCamera() {
  if (!camera || !controls || !modelGroup)
    return
  modelGroup.updateMatrixWorld(true)
  const box = new Box3().setFromObject(modelGroup)
  const boneByName = new Map(mesh?.skeleton.bones.map(bone => [bone.name, bone]))
  const scratch = new Vector3()
  const bounds = resolveFrameBounds(
    rig?.bones ?? {},
    (name) => {
      const bone = boneByName.get(name)
      if (!bone)
        return null
      bone.getWorldPosition(scratch)
      return [scratch.x, scratch.y, scratch.z]
    },
    box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
  )
  if (!bounds)
    return
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
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  layoutBackground()
}

function renderLoop(now = performance.now()) {
  rafHandle = requestAnimationFrame(renderLoop)
  const delta = previousFrameTime === undefined ? 0 : (now - previousFrameTime) / 1000
  previousFrameTime = now

  if (props.paused || !renderer || !scene || !camera)
    return

  expressions.setSlotSettings(props.performanceSettings.slots)
  expressions.update(now / 1000)
  const clocks = frameClocks(now, diagnostics.directorClockOffsetMs)
  naturalSeconds = clocks.naturalSeconds
  if (animation && stance && loadedModelKey) {
    const base = stance.update({
      nowMs: clocks.directorMs,
      performance: props.performance,
      slots: stanceSlots.value[loadedModelKey] ?? {},
      idleMotionName: idleMotionName.value,
      isRegistered: name => registeredMotions.has(name),
    })
    if (base.changed)
      animation.setBaseMotion(base.motion)
  }
  animation?.update(delta)
  if (touch)
    handleTouchEvents(touch.update(now))

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
      rig: rig ?? null,
      natural: natural?.diagnostics ?? null,
      feet: motionDriver.value === 'natural' ? body?.diagnostics.feet ?? null : null,
      lookAt: motionDriver.value === 'natural' ? body?.diagnostics.lookAt ?? null : null,
      touch: touch && canvasRef.value ? touch.diagnostics(activeCamera, canvasRef.value.getBoundingClientRect()) : null,
      director: stance ? { ...stance.diagnostics, clockOffsetMs: diagnostics.directorClockOffsetMs, centerY: centerModelY() } : null,
      animation: animation?.snapshot() ?? { idle: null, currentAction: null, actionsStarted: 0 },
    })
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
  expressions.dispose()
  stopMorphOverrides?.()
  stopMorphOverrides = undefined
  emote?.dispose()
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
  modelGroup = undefined
  mesh = undefined
  morphs = undefined
  emote = undefined
  morphRuntime = undefined
  natural = undefined
  body = undefined
  stance = undefined
  rig = undefined
  gaze = undefined
  resolved = undefined
  loadedModelKey = null
  diagnostics.setMetrics(new MMDFrameMetrics())
  diagnostics.publish({ loadedModelKey: null, rig: null, natural: null, feet: null, lookAt: null, director: null, animation: { idle: null, currentAction: null, actionsStarted: 0 } })
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
  for (const descriptor of availableMotions.value) {
    if (registeredMotions.has(descriptor.name))
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
        activeAnimation.registerClip(descriptor.name, clip)
        body?.registerClip(descriptor.name, clip)
        registeredMotions.add(descriptor.name)
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
    natural = new MMDNaturalAdapter(mesh, rig, modelKey)
    const activeStance = new MMDStanceDirector()
    stance = activeStance
    const activeMesh = mesh
    // The pure morph core copies enumerable x/y/z/w fields. Three's quaternion
    // stores _x/_y/_z/_w, so serialize explicitly at this renderer boundary.
    const proceduralPose = mesh.skeleton.bones.map(bone => ({
      position: bone.position,
      quaternion: { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w },
    }))

    animation = createMMDAnimationManager(resolved.mmd, { physicsEnabled: physicsEnabled.value })
    body = new MMDBody(resolved.mmd, rig, {
      modelKey,
      input: () => {
        if (!natural || !camera || !canvasRef.value)
          return null
        return {
          enabled: motionDriver.value === 'natural',
          frame: natural.bodyFrame.frame,
          target: resolveBodyTarget({ mesh: activeMesh, camera, viewport: canvasRef.value.getBoundingClientRect(), gazeMode: gazeMode.value }, natural.bodyFrame),
          ...diagnostics.debugFlags,
          stanceClips: activeStance.baseClips,
        }
      },
    })
    diagnostics.setMetrics(animation.pipeline.metrics)
    animation.pipeline.poseStages.push(
      { id: 'natural', run: ({ dt, clean }) => {
        if (motionDriver.value !== 'natural' || !natural || !camera || !canvasRef.value)
          return
        const rect = canvasRef.value.getBoundingClientRect()
        activeMesh.updateWorldMatrix(true, false)
        const head = projectMMDHead(activeMesh, camera, rect)
        const cursor = gazeMode.value === 'mouse' && head && props.cursorPosition
          ? { x: (props.cursorPosition.x - head.x) / head.width, y: (head.y - props.cursorPosition.y) / head.width }
          : gazeMode.value === 'camera' ? { x: 0, y: 0 } : null
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
        natural.advance(dt, {
          performance: props.performance,
          energy: props.naturalEnergy ?? naturalEnergy.value,
          voice: { speaking, speechActiveOrRecent: speaking, level: props.mouthOpenSize },
          cursor,
          chat: props.chatTarget
            ? { ...props.chatActivity ?? { typing: false, sentSeq: 0, sentWords: 0 }, target: props.chatTarget.visible ? chatPoint : null, unfoldSeq: chatUnfoldSeq }
            : null,
          placement: !head
            ? null
            : placement && dipScale > 0
              ? screenInwardness(placement.displays, placement.windowBounds.x + head.x * dipScale)
              : mmdScreenInwardness(rect, head.x),
        }, naturalSeconds)
        natural.applyPose(clean, true)
        // Channels must be prepared before bone-morph evaluation. Their surface
        // effects are applied after physics by the morph-runtime surface stage.
        natural.applySurface(runtime, morphOverrides.value)
      } },
      ...body.poseStages,
      { id: 'classic-gaze', run: ({ dt, clean }) => {
        if (motionDriver.value === 'classic')
          gaze?.update(resolveGazeOffset(), dt, clean)
      } },
      { id: 'classic-face', run: ({ dt }) => {
        if (motionDriver.value !== 'classic')
          return
        emote?.update(dt)
        blink.update(blinkMorphs, dt)
      } },
      { id: 'lip-sync', run: ({ dt }) => {
        lipSync.update(lipMorphs, dt)
        runtime.setComposition({ speakEnv: props.currentAudioSource ? 1 : 0 })
      } },
      { id: 'bone-morphs', run: () => {
        activeMesh.skeleton.bones.forEach((bone, index) => {
          const quaternion = proceduralPose[index].quaternion
          quaternion.x = bone.quaternion.x
          quaternion.y = bone.quaternion.y
          quaternion.z = bone.quaternion.z
          quaternion.w = bone.quaternion.w
        })
        runtime.setMaterialOpacityOverrides(materialOpacity.value)
        runtime.applyBoneStage(proceduralPose)
      } },
    )
    animation.pipeline.surfaceStages.push(
      body.surfaceStage,
      { id: 'morphs', run: () => runtime.applySurfaceStage() },
    )
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
    animation?.playAction(actionName, { loop: false })
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
const touchActive = computed(() => naturalTouch.value && motionDriver.value === 'natural' && !props.paused)

function handleTouchEvents(events: MMDTouchEvent[]) {
  if (!touch)
    return
  for (const poke of touch.takePokes())
    natural?.poke(poke.region, poke)
  natural?.setPet(touch.petHand)
  for (const event of events)
    emit('touch', event)
}

function resetTouch() {
  if (touch)
    handleTouchEvents(touch.reset(performance.now()))
}

// The model is ready once the scene reports it mounted; any other state means it is gone or loading.
watch(componentState, (state) => {
  resetTouch()
  touch = state === 'mounted' && mesh && resolved && rig
    ? new MMDTouch(mesh, resolved.mmd.pmx, rig, { requireHold: naturalTouchPetRequiresHold.value })
    : undefined
  if (!touch)
    diagnostics.publish({ touch: null })
}, { flush: 'sync' })

watch(touchActive, (active) => {
  if (!active)
    resetTouch()
})

watch(naturalTouchPetRequiresHold, (requireHold) => {
  resetTouch()
  if (touch)
    touch.gestures.requireHold = requireHold
})

useEventListener(canvasRef, ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'pointercancel'], (event: PointerEvent) => {
  if (!event.isPrimary || !touch || !mesh || !camera || !canvasRef.value || !touchActive.value)
    return
  handleTouchEvents(touch.pointer(event, camera, canvasRef.value.getBoundingClientRect()))
})

watch(() => props.enableOrbitControls, (enabled) => {
  if (controls)
    controls.enabled = enabled
})

// View transform sliders.
watch([scale, rotationY, () => position.value.x, () => position.value.y], () => applyTransform())

// Solver/physics toggles.
watch(physicsEnabled, v => animation?.setPhysicsEnabled(v))
watch(ikEnabled, v => animation?.setIKEnabled(v))
watch(grantEnabled, v => animation?.setGrantEnabled(v))
watch(physicsGravity, v => animation?.setGravity(v))

watch(motionDriver, () => {
  if (morphRuntime) {
    for (const morph of morphRuntime.morphs) {
      for (const layer of ['naturalFace', 'blink', 'expression', 'lipSync'] as const)
        morphRuntime.clearChannel(layer, morph.name)
    }
  }
  if (mesh && rig)
    natural = new MMDNaturalAdapter(mesh, rig, props.modelId ?? props.modelSrc ?? '')
})

// Morph-slot overrides: rebind each slot the user remapped (empty = auto).
watch(morphOverrides, (overrides) => {
  if (!morphs)
    return
  for (const [slot, name] of Object.entries(overrides))
    morphs.override(slot as Parameters<MorphController['override']>[0], name ?? '')
}, { deep: true })

// One-shot motion requests from tools/the act bus.
watch(oneShotAction, (request) => {
  if (request)
    animation?.playAction(request.name, { loop: request.loop })
})

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
  if (!camera)
    return
  camera.fov = cameraFov.value
  camera.updateProjectionMatrix()
})
watch(renderScale, () => {
  renderer?.setPixelRatio(Math.min(window.devicePixelRatio, 2) * renderScale.value)
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
      animation?.playAction(actionName)
  },
  applySlots: (commands: SlotCommand[], now: number) => expressions.applySlots(commands, now),
  applyHolds: (commands: HoldCommand[], now: number) => natural?.applyHolds(commands, now),
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
})
</script>

<template>
  <Screen relative>
    <canvas ref="canvasRef" h-full w-full />
  </Screen>
</template>
