import type { ClipKind, ClipLayer, DerivedClipMeta } from '@proj-airi/motion-driver-humanoid/clip-meta'
import type { NaturalEmotionStrengthsByModel } from '@proj-airi/motion-driver-natural/emotion-strengths'

import type { MMDStanceSlots } from '../composables/mmd/stance'
import type { Emotion } from '../constants/emotions'
import type { MorphSlot } from '../constants/morphs'

import localforage from 'localforage'

import { CLIP_LABEL_PATTERN, effectiveLayer } from '@proj-airi/motion-driver-humanoid/clip-meta'
import { parseNaturalEmotionStrengths } from '@proj-airi/motion-driver-natural/emotion-strengths'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { clamp } from 'es-toolkit'
import { nanoid } from 'nanoid/non-secure'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { EMOTION_ACTION_NAME } from '../constants/actions'
import { supportedControl, useMMDViewControl } from './view-control'

type BroadcastChannelEvents
  = | BroadcastChannelEventShouldUpdateView
    | BroadcastChannelEventPlayOneShot
    | BroadcastChannelEventPerform

interface BroadcastChannelEventShouldUpdateView {
  type: 'mmd-should-update-view'
}

interface BroadcastChannelEventPlayOneShot {
  type: 'mmd-play-one-shot'
  request: MMDOneShotAction
}

interface BroadcastChannelEventPerform {
  type: 'mmd-perform'
  request: MMDPerformRequest
}

/**
 * A VMD motion imported for use across windows.
 *
 * Holds only an id + display name; the VMD file itself lives in IndexedDB
 * (keyed by `id`) so the list can sync through localStorage and each window
 * can materialize its own object URL. Blob URLs are window-scoped and cannot
 * be shared, which is why the URL is never persisted here.
 */
export interface MMDMotionDescriptor {
  id: string
  name: string
  /** Bumped when the same name is imported again, so a scene that already registered the clip loads the new file. */
  revision?: number
}

/** IndexedDB record for a persisted VMD file. */
interface PersistedMMDMotion {
  id: string
  name: string
  file: File
}

/** A material ("part") of the loaded model, for the materials settings UI. */
export interface MMDMaterialDescriptor {
  /** Raw material name; the key used for opacity overrides. */
  name: string
  /** Human-friendly label (falls back to `Material N` for unnamed parts). */
  label: string
  /** Order index within the model. */
  index: number
}

const MOTION_STORAGE_PREFIX = 'mmd-motion-'
const NATURAL_ENERGY_DEFAULT = 0.5

/** Eye/head tracking mode, mirroring the VRM renderer's tracking modes. */
export type MMDGazeMode = 'camera' | 'mouse' | 'none'
export type MMDMotionDriver = 'natural' | 'classic'
/** Whether she stays near home (`stay`) or occasionally wanders the ground line (`roam`) on the desktop stage. */
export type MMDRoamMode = 'stay' | 'roam'

/** User-owned curation of one imported clip; derived fields are recomputed on load and never stored here. */
export interface MMDClipCuration {
  /** The name the chat model can use; `null` keeps the clip out of the library. */
  label: string | null
  kind: ClipKind | null
  loop: boolean | null
  /** Whether the chat model may trigger the clip. */
  aiMayUse: boolean
}

export interface MMDLabeledClip {
  name: string
  label: string
  kind: ClipKind
  layer: ClipLayer
  exposed: boolean
}

/** Transient request to perform a clip (or stop with `name: null`), bumped per request. */
export interface MMDPerformRequest {
  name: string | null
  loop: boolean
  source: string
  nonce: number
}

const LIBRARY_KINDS: readonly ClipKind[] = ['gesture', 'action', 'dance']

function defaultCuration(): MMDClipCuration {
  return { label: null, kind: null, loop: null, aiMayUse: false }
}

// NOTICE:
// `MMDOneShotAction` and `playOneShotAction` stay for two unchecked callers that bypass the body director.
// `requestPerform` replaces them (plan mmd-actions-library, todos 9, 10, 14).
// Removal condition: todo 14 deletes both once `MMD.vue` and `model-settings/mmd.vue` call `requestPerform`.
/** Transient request to play a one-shot motion, bumped per request. */
export interface MMDOneShotAction {
  name: string
  loop: boolean
  nonce: number
}

export const useMMD = defineStore('mmd', () => {
  const { post, data } = useBroadcastChannel<BroadcastChannelEvents, BroadcastChannelEvents>({
    name: 'airi-stores-stage-ui-mmd',
  })
  const shouldUpdateViewHooks = ref(new Set<() => void>())

  /**
   * Transient one-shot motion request (fire-and-forget; not persisted).
   *
   * Declared before the broadcast handler that writes to it. Delivered across
   * Electron windows via the BroadcastChannel below — NOT localStorage, whose
   * storage events do not fire reliably between BrowserWindows.
   */
  const oneShotAction = ref<MMDOneShotAction>()
  /** Transient perform request (fire-and-forget; not persisted), delivered like `oneShotAction`. */
  const performRequest = ref<MMDPerformRequest>()

  const onShouldUpdateView = (hook: () => void) => {
    shouldUpdateViewHooks.value.add(hook)
    return () => {
      shouldUpdateViewHooks.value.delete(hook)
    }
  }

  function shouldUpdateView() {
    post({ type: 'mmd-should-update-view' })
    shouldUpdateViewHooks.value.forEach(hook => hook())
  }

  watch(data, (event) => {
    if (event?.type === 'mmd-should-update-view')
      shouldUpdateViewHooks.value.forEach(hook => hook())
    else if (event?.type === 'mmd-play-one-shot')
      oneShotAction.value = event.request
    else if (event?.type === 'mmd-perform')
      performRequest.value = event.request
  })

  // === Physics & solver toggles ===
  /** Master switch for the Ammo/Bullet rigid-body simulation (hair, skirt, etc.). */
  const physicsEnabled = useLocalStorageManualReset<boolean>('settings/mmd/physics-enabled', true)
  /** CCD IK solving for limbs/standard rigs. */
  const ikEnabled = useLocalStorageManualReset<boolean>('settings/mmd/ik-enabled', true)
  /** Append-bone ("grant") propagation for derived bones. */
  const grantEnabled = useLocalStorageManualReset<boolean>('settings/mmd/grant-enabled', true)
  /**
   * Physics gravity strength (magnitude). Applied as world gravity (0, -g, 0).
   * MMD's default is 98 (9.8 × 10 for MMD's scale). Lower = floatier hair and
   * cloth, higher = heavier/droopier.
   */
  const physicsGravity = useLocalStorageManualReset<number>('settings/mmd/physics-gravity', 98)

  // === Gaze ===
  /**
   * Eye/head tracking mode, mirroring the VRM renderer:
   * - `mouse`  — follow the cursor
   * - `camera` — look toward the camera (forward)
   * - `none`   — no tracking; idle saccades only
   */
  const gazeMode = useLocalStorageManualReset<MMDGazeMode>('settings/mmd/gaze-mode', 'mouse')
  const motionDriver = useLocalStorageManualReset<MMDMotionDriver>('settings/mmd/motion-driver', 'natural')
  /** Liveliness of Natural movement, 0 (calm) to 1 (energetic); the same scale and default as Live2D's `settings/live2d/natural-energy`. */
  const naturalEnergy = useLocalStorageManualReset<number>('settings/mmd/natural-energy', NATURAL_ENERGY_DEFAULT, {
    serializer: {
      read: (raw) => {
        const value = Number.parseFloat(raw)
        return Number.isFinite(value) ? clamp(value, 0, 1) : NATURAL_ENERGY_DEFAULT
      },
      write: value => String(value),
    },
  })
  /** Let the user poke the model and pet its head with the cursor while Natural drives it. */
  const naturalTouch = useLocalStorageManualReset<boolean>('settings/mmd/natural-touch', true)
  /** Count only strokes made with the primary button held as pets, so passing the cursor over the head never pets it. */
  const naturalTouchPetRequiresHold = useLocalStorageManualReset<boolean>('settings/mmd/natural-touch-pet-requires-hold', false)
  /**
   * How strongly Natural performs each emotion, by stage model id, in the same shape and range as the Live2D setting.
   * Replace the record on write; consumers watch it by identity.
   */
  const naturalEmotionStrength = useLocalStorageManualReset<NaturalEmotionStrengthsByModel>('settings/mmd/natural-emotion-strength', {}, {
    serializer: {
      read: parseNaturalEmotionStrengths,
      write: value => JSON.stringify(value),
    },
  })

  // === Scene: camera ===
  /** Vertical field of view in degrees. */
  const cameraFov = useLocalStorageManualReset<number>('settings/mmd/camera-fov', 30)

  // === Scene: lighting ===
  const ambientColor = useLocalStorageManualReset<string>('settings/mmd/ambient-color', '#FFFFFF')
  const ambientIntensity = useLocalStorageManualReset<number>('settings/mmd/ambient-intensity', 0.6)
  const directionalColor = useLocalStorageManualReset<string>('settings/mmd/directional-color', '#FFFBF5')
  const directionalIntensity = useLocalStorageManualReset<number>('settings/mmd/directional-intensity', 0.75)
  const directionalPosition = useLocalStorageManualReset<{ x: number, y: number, z: number }>(
    'settings/mmd/directional-position',
    () => ({ x: 1, y: 2, z: 2 }),
  )

  // === Scene: rendering ===
  /**
   * Albedo self-illumination, 0–1. Drives `emissiveIntensity` on every
   * material so the model reads as the flat, luminous MMD/anime look. 0 = lit
   * only by scene lights, 1 = nearly self-lit.
   */
  const albedoGlow = useLocalStorageManualReset<number>('settings/mmd/albedo-glow', 0.45)
  /** Device-pixel-ratio multiplier for render resolution. */
  const renderScale = useLocalStorageManualReset<number>('settings/mmd/render-scale', 1)
  /** On-screen character height in DIP on the desktop stage; the stage page calibrates its camera from it. */
  const stageCharacterHeight = useLocalStorageManualReset<number>('settings/mmd/stage-character-height', 560)
  const roamMode = useLocalStorageManualReset<MMDRoamMode>('settings/mmd/roam-mode', 'stay')

  // === Animation ===
  /** Name of the persistent idle motion; empty means none/static. */
  const idleMotionName = useLocalStorageManualReset<string>('settings/mmd/idle-motion', '')
  /**
   * Motions imported for use across windows.
   *
   * localStorage-backed so the list syncs between the settings window and the
   * stage window (the desktop app runs them as separate renderer processes
   * with independent Pinia stores). Only id + name are stored here; the VMD
   * files live in IndexedDB.
   */
  const availableMotions = useLocalStorageManualReset<MMDMotionDescriptor[]>('settings/mmd/motions', () => [])
  /**
   * Per-model stance clips, keyed by model id, naming imported motions. The
   * body director plays `sit` after a long idle and `sleep` while away; `idle`
   * replaces `idleMotionName` for that model.
   */
  const stanceSlots = useLocalStorageManualReset<Record<string, MMDStanceSlots>>('settings/mmd/stance-slots', () => ({}))
  /** Per-model clip curation, keyed by model key then clip name. */
  const clipCuration = useLocalStorageManualReset<Record<string, Record<string, MMDClipCuration>>>('settings/mmd/clip-curation', () => ({}))
  /** Derived metadata of the imported clips, published by the scene so the settings window can render it. */
  const availableClipMeta = useLocalStorageManualReset<Record<string, DerivedClipMeta & { name: string }>>('settings/mmd/available-clip-meta', () => ({}))

  function curationFor(modelKey: string, name: string): MMDClipCuration {
    return clipCuration.value[modelKey]?.[name] ?? defaultCuration()
  }

  /**
   * Merges a patch into a clip's curation. Returns `false` and leaves the state untouched when the
   * label fails `CLIP_LABEL_PATTERN` (an empty string and upper case included; `null` clears it) or
   * another clip of the same model already uses it.
   */
  function setCuration(modelKey: string, name: string, patch: Partial<MMDClipCuration>): boolean {
    const model = clipCuration.value[modelKey] ?? {}
    if (patch.label != null) {
      if (!CLIP_LABEL_PATTERN.test(patch.label))
        return false
      if (Object.entries(model).some(([other, curation]) => other !== name && curation.label === patch.label))
        return false
    }
    clipCuration.value = {
      ...clipCuration.value,
      [modelKey]: { ...model, [name]: { ...curationFor(modelKey, name), ...patch } },
    }
    return true
  }

  /** Every imported clip with a label and a gesture, action or dance kind (override first), in import order. */
  function labeledClips(modelKey: string): MMDLabeledClip[] {
    const clips: MMDLabeledClip[] = []
    for (const { name } of availableMotions.value) {
      const meta = availableClipMeta.value[name]
      const curation = curationFor(modelKey, name)
      const kind = curation.kind ?? meta?.kind
      if (!meta || curation.label === null || kind === undefined || !LIBRARY_KINDS.includes(kind))
        continue
      clips.push({ name, label: curation.label, kind, layer: effectiveLayer(meta, curation.kind), exposed: curation.aiMayUse })
    }
    return clips
  }

  function exposedActions(modelKey: string): MMDLabeledClip[] {
    return labeledClips(modelKey).filter(clip => clip.exposed)
  }

  /**
   * Persists a VMD file to IndexedDB and adds it to the synced list.
   *
   * Re-importing the same name overwrites the stored file (same id) so the
   * list stays stable.
   */
  async function addMotion(file: File): Promise<MMDMotionDescriptor> {
    const name = file.name.replace(/\.vmd$/i, '')
    const existing = availableMotions.value.find(motion => motion.name === name)
    const id = existing?.id ?? `${MOTION_STORAGE_PREFIX}${nanoid()}`

    await localforage.setItem<PersistedMMDMotion>(id, { id, name, file })
    if (existing)
      availableMotions.value = availableMotions.value.map(motion => motion.id === id ? { ...motion, revision: (motion.revision ?? 0) + 1 } : motion)
    else
      availableMotions.value = [...availableMotions.value, { id, name }]

    return { id, name }
  }

  /** Loads a persisted VMD file by id so a window can build its own object URL. */
  async function getMotionFile(id: string): Promise<File | undefined> {
    const persisted = await localforage.getItem<PersistedMMDMotion>(id)
    return persisted?.file
  }

  /** Removes every persisted motion file and clears the synced list. */
  async function clearMotions(): Promise<void> {
    const motions = availableMotions.value
    availableMotions.value = []
    await Promise.all(motions.map(motion => localforage.removeItem(motion.id)))
  }

  /** Removes a single imported motion (from the synced list and IndexedDB). */
  async function removeMotion(id: string): Promise<void> {
    const motion = availableMotions.value.find(m => m.id === id)
    availableMotions.value = availableMotions.value.filter(m => m.id !== id)
    // Drop the idle selection if it pointed at the removed motion.
    if (motion && idleMotionName.value === motion.name)
      idleMotionName.value = ''
    if (motion) {
      stanceSlots.value = Object.fromEntries(Object.entries(stanceSlots.value).map(([modelId, slots]) => [
        modelId,
        Object.fromEntries(Object.entries(slots).filter(([, name]) => name !== motion.name)),
      ]))
      clipCuration.value = Object.fromEntries(Object.entries(clipCuration.value).map(([modelKey, clips]) => [
        modelKey,
        Object.fromEntries(Object.entries(clips).filter(([name]) => name !== motion.name)),
      ]))
      availableClipMeta.value = Object.fromEntries(Object.entries(availableClipMeta.value).filter(([name]) => name !== motion.name))
    }
    await localforage.removeItem(id)
  }
  /** Per-emotion gesture motion overrides; falls back to EMOTION_ACTION_NAME. */
  const emotionActionMap = useLocalStorageManualReset<Record<Emotion, string>>(
    'settings/mmd/emotion-action-map',
    () => ({ ...EMOTION_ACTION_NAME }),
  )

  // === Morphs ===
  /** Manual morph-slot → morph-name overrides for non-standard models. */
  const morphOverrides = useLocalStorageManualReset<Partial<Record<MorphSlot, string>>>(
    'settings/mmd/morph-overrides',
    () => ({}),
  )
  /** All morph names exposed by the active model (runtime). */
  const availableMorphs = useLocalStorageManualReset<string[]>('settings/mmd/available-morphs', () => [])

  /**
   * Materials (parts) of the active model, published by the scene so the
   * settings window can render a control per part.
   */
  const availableMaterials = useLocalStorageManualReset<MMDMaterialDescriptor[]>(
    'settings/mmd/available-materials',
    () => [],
  )
  /**
   * Per-material opacity overrides, keyed by material name. Missing entries
   * render at full opacity. Lets the user fade or hide individual parts.
   */
  const materialOpacity = useLocalStorageManualReset<Record<string, number>>(
    'settings/mmd/material-opacity',
    () => ({}),
  )

  /**
   * Whether an MMD mesh is currently mounted. Runtime-only: the persisted
   * descriptor lists survive reloads and cannot indicate live mount state.
   */
  const isModelLoaded = ref(false)

  /**
   * Queues a one-shot motion. Applies it in this window and broadcasts it to
   * the others. The bumped `nonce` makes repeat requests for the same motion
   * re-trigger the scene's watcher.
   *
   * Uses the BroadcastChannel rather than localStorage because this is a
   * transient trigger that must reach the stage window's animation manager,
   * and localStorage storage events do not fire reliably across Electron
   * BrowserWindows (the live stage and settings run as separate processes).
   */
  function playOneShotAction(name: string, loop = false) {
    const request: MMDOneShotAction = { name, loop, nonce: (oneShotAction.value?.nonce ?? 0) + 1 }
    oneShotAction.value = request
    post({ type: 'mmd-play-one-shot', request })
  }

  /**
   * Queues a clip to perform (or `null` to stop the current one). Applies it in this window and
   * broadcasts it to the others, for the same reason as `playOneShotAction`.
   */
  function requestPerform(name: string | null, options: { loop?: boolean, source: string }) {
    const request: MMDPerformRequest = {
      name,
      loop: options.loop ?? false,
      source: options.source,
      nonce: (performRequest.value?.nonce ?? 0) + 1,
    }
    performRequest.value = request
    post({ type: 'mmd-perform', request })
  }

  const { position, scale, rotationY, reset: resetViewControl } = useMMDViewControl()

  function resetState() {
    supportedControl.forEach(c => resetViewControl(c))
    physicsEnabled.reset()
    ikEnabled.reset()
    grantEnabled.reset()
    physicsGravity.reset()
    gazeMode.reset()
    motionDriver.reset()
    naturalEnergy.reset()
    naturalTouch.reset()
    naturalTouchPetRequiresHold.reset()
    naturalEmotionStrength.reset()
    cameraFov.reset()
    ambientColor.reset()
    ambientIntensity.reset()
    directionalColor.reset()
    directionalIntensity.reset()
    directionalPosition.reset()
    albedoGlow.reset()
    renderScale.reset()
    stageCharacterHeight.reset()
    roamMode.reset()
    idleMotionName.reset()
    stanceSlots.reset()
    clipCuration.reset()
    availableClipMeta.reset()
    void clearMotions()
    oneShotAction.value = undefined
    performRequest.value = undefined
    emotionActionMap.reset()
    morphOverrides.reset()
    availableMorphs.reset()
    availableMaterials.reset()
    materialOpacity.reset()
    shouldUpdateView()
  }

  return {
    position,
    scale,
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

    idleMotionName,
    availableMotions,
    stanceSlots,
    clipCuration,
    availableClipMeta,
    curationFor,
    setCuration,
    labeledClips,
    exposedActions,
    addMotion,
    getMotionFile,
    clearMotions,
    removeMotion,
    emotionActionMap,

    morphOverrides,
    availableMorphs,
    availableMaterials,
    materialOpacity,

    isModelLoaded,
    oneShotAction,
    playOneShotAction,
    performRequest,
    requestPerform,

    onShouldUpdateView,
    shouldUpdateView,
    resetState,
  }
})

export { useMMDViewControl }
