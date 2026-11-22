import type { ClipKind, ClipLayer, DerivedClipMeta } from '@proj-airi/motion-driver-humanoid/clip-meta'
import type { SettingsDocument } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import type { MMDStanceSlots } from '../composables/mmd/stance'

import { CLIP_LABEL_PATTERN, effectiveLayer } from '@proj-airi/motion-driver-humanoid/clip-meta'
import { activeDisplayModelForSettings, modelScopedStorageKey, useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { isEqual, omit } from 'es-toolkit'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import * as v from 'valibot'

export type MMDMotionDriver = 'natural' | 'classic'
export type MMDRoamMode = 'stay' | 'roam'

/** Durable user choices. Derived metadata belongs to the loaded model, never to this record. */
const curationSchema = v.strictObject({
  /** The tool label; null keeps this clip out of the library. */
  label: v.optional(v.nullable(v.pipe(v.string(), v.regex(CLIP_LABEL_PATTERN))), null),
  kind: v.optional(v.nullable(v.picklist(['gesture', 'action', 'dance', 'stance', 'unusable'])), null),
  loop: v.optional(v.nullable(v.boolean()), null),
  /** Whether the chat model may trigger this clip. */
  aiMayUse: v.optional(v.boolean(), false),
  /** Whether she may play this clip on her own while idle. */
  idleMayUse: v.optional(v.boolean(), false),
})
export type MMDClipCuration = v.InferOutput<typeof curationSchema>

export interface MMDLabeledClip {
  name: string
  label: string
  kind: ClipKind
  layer: ClipLayer
  exposed: boolean
  idle: boolean
}

/** Missing curation is read-only and shares one stable default across projections. */
const defaultCuration = Object.freeze(v.parse(curationSchema, {}))
const driverSchema = v.picklist(['natural', 'classic'])
const heightSchema = v.pipe(v.number(), v.finite(), v.minValue(200), v.maxValue(1200))
const roamSchema = v.picklist(['stay', 'roam'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function recordEntries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : []
}

function sanitizeDrivers(value: unknown): Record<string, MMDMotionDriver> {
  return Object.fromEntries(recordEntries(value).map(([id, driver]) => {
    const result = v.safeParse(driverSchema, driver)
    return [id, result.success ? result.output : 'natural']
  }))
}

function sanitizeStances(value: unknown): Record<string, MMDStanceSlots> {
  return Object.fromEntries(recordEntries(value).map(([id, slots]) => [
    id,
    Object.fromEntries(recordEntries(slots).filter(([slot, name]) => ['idle', 'sit', 'sleep'].includes(slot) && typeof name === 'string')),
  ]))
}

function sanitizeCuration(value: unknown): Record<string, Record<string, MMDClipCuration>> {
  return Object.fromEntries(recordEntries(value).map(([id, clips]) => {
    const labels = new Set<string>()
    return [id, Object.fromEntries(recordEntries(clips).map(([name, raw]) => {
      const fields: Record<string, unknown> = {}
      for (const [field, schema] of Object.entries(curationSchema.entries)) {
        const result = v.safeParse(schema, isRecord(raw) ? raw[field] : undefined)
        if (result.success)
          fields[field] = result.output
      }
      const curation = v.parse(curationSchema, fields)
      if (curation.label !== null) {
        if (labels.has(curation.label))
          curation.label = null
        else
          labels.add(curation.label)
      }
      if (curation.kind === 'stance' || curation.kind === 'unusable') {
        curation.aiMayUse = false
        curation.idleMayUse = false
      }
      return [name, curation]
    }))]
  }))
}

const entries = {
  motionDrivers: v.optional(v.pipe(v.unknown(), v.transform(sanitizeDrivers)), {}),
  stageCharacterHeight: v.optional(heightSchema, 560),
  roamMode: v.optional(roamSchema, 'stay'),
  stanceSlots: v.optional(v.pipe(v.unknown(), v.transform(sanitizeStances)), {}),
  clipCuration: v.optional(v.pipe(v.unknown(), v.transform(sanitizeCuration)), {}),
  // NOTICE:
  // Keep the old unscoped driver until the first eligible model has an identity.
  // Root cause: owner initialization can precede model selection.
  // Source: settings/mmd/motion-driver in the pre-S2 mmd store.
  // Removal condition: no supported release writes the old fork MMD keys.
  unassignedMotionDriver: v.optional(driverSchema),
}
export type MMDPerformanceSettings = SettingsDocument<typeof entries>

const documentKey = 'settings/mmd/performance'
const legacyKeys = {
  motionDriver: 'settings/mmd/motion-driver',
  stageCharacterHeight: 'settings/mmd/stage-character-height',
  roamMode: 'settings/mmd/roam-mode',
  stanceSlots: 'settings/mmd/stance-slots',
  clipCuration: 'settings/mmd/clip-curation',
}

// NOTICE:
// Existing profiles need all model choices carried into the leader-owned document once.
// Root cause: fork settings previously shared upstream's plain-ref persistence.
// Source: packages/stage-ui-mmd/src/stores/mmd.ts before S2.
// Removal condition: no supported release writes the old fork MMD keys.
function readLegacySettings() {
  if (typeof localStorage === 'undefined' || localStorage.getItem(documentKey) !== null)
    return {}
  const fields: Record<string, unknown> = {}
  for (const [field, key] of Object.entries(legacyKeys)) {
    const raw = localStorage.getItem(key)
    if (raw === null)
      continue
    if (field === 'motionDriver') {
      fields.unassignedMotionDriver = raw
    }
    else if (field === 'roamMode') {
      fields.roamMode = raw
    }
    else {
      try {
        fields[field] = JSON.parse(raw)
      }
      catch {
        // Only this corrupt field returns to its default; other model settings survive.
      }
    }
  }
  const motionDrivers: Record<string, unknown> = {}
  for (const key of Object.keys(localStorage)) {
    const match = key.match(/^settings\/models\/([^/]+)\/mmd\/motion-driver$/)
    if (match)
      motionDrivers[match[1]] = localStorage.getItem(key)
  }
  return { ...fields, motionDrivers }
}

function removeLegacySettings() {
  if (typeof localStorage === 'undefined')
    return
  for (const key of Object.values(legacyKeys))
    localStorage.removeItem(key)
  for (const key of Object.keys(localStorage)) {
    const match = key.match(/^settings\/models\/([^/]+)\/mmd\/motion-driver$/)
    if (match)
      localStorage.removeItem(modelScopedStorageKey(match[1], legacyKeys.motionDriver))
  }
}

/** MMD realisation settings. Read projections; await commands instead of proposing whole maps from a follower. */
export const useMMDPerformanceSettings = defineStore('mmd-performance-settings', () => {
  const settings = useSettingsDocument(documentKey, entries, { label: 'mmd-performance-settings', initial: readLegacySettings })
  const motionDriver = computed(() => settings.document.value.motionDrivers[activeDisplayModelForSettings('mmd')] ?? 'natural')
  const stageCharacterHeight = computed(() => settings.document.value.stageCharacterHeight)
  const roamMode = computed(() => settings.document.value.roamMode)
  const stanceSlots = computed(() => settings.document.value.stanceSlots)
  const clipCuration = computed(() => settings.document.value.clipCuration)
  const curationFor = computed(() => (modelId: string, name: string): MMDClipCuration => clipCuration.value[modelId]?.[name] ?? defaultCuration)
  const labeledClips = computed(() => (modelId: string, motions: readonly { name: string }[], metadata: Record<string, DerivedClipMeta & { name: string }>): MMDLabeledClip[] => {
    return motions.flatMap(({ name }) => {
      const meta = metadata[name]
      const curation = curationFor.value(modelId, name)
      const kind = curation.kind ?? meta?.kind
      if (!meta || curation.label === null || !kind || kind === 'stance' || kind === 'unusable')
        return []
      return [{ name, label: curation.label, kind, layer: effectiveLayer(meta, curation.kind), exposed: curation.aiMayUse, idle: curation.idleMayUse }]
    })
  })
  const exposedActions = computed(() => (modelId: string, motions: readonly { name: string }[], metadata: Record<string, DerivedClipMeta & { name: string }>) =>
    labeledClips.value(modelId, motions, metadata).filter(clip => clip.exposed))

  async function commit(patch: Partial<MMDPerformanceSettings>) {
    const result = await settings.update(patch)
    if (result.success)
      removeLegacySettings()
    return result
  }

  async function initialize() {
    const modelId = activeDisplayModelForSettings('mmd')
    const pending = settings.document.value.unassignedMotionDriver
    await commit(modelId && pending && !Object.hasOwn(settings.document.value.motionDrivers, modelId)
      ? { motionDrivers: { ...settings.document.value.motionDrivers, [modelId]: pending }, unassignedMotionDriver: undefined }
      : {})
  }

  async function selectModel(modelId: string) {
    const pending = settings.document.value.unassignedMotionDriver
    if (!modelId || !pending || Object.hasOwn(settings.document.value.motionDrivers, modelId))
      return
    await commit({ motionDrivers: { ...settings.document.value.motionDrivers, [modelId]: pending }, unassignedMotionDriver: undefined })
  }

  async function update(patch: Partial<Pick<MMDPerformanceSettings, 'stageCharacterHeight' | 'roamMode'>>) {
    const result = v.safeParse(v.pipe(v.unknown(), v.check(isRecord), v.partial(v.strictObject({ stageCharacterHeight: heightSchema, roamMode: roamSchema }))), patch)
    return result.success ? commit(result.output) : { success: false as const, issues: result.issues }
  }

  async function setMotionDriver(modelId: string, driver: MMDMotionDriver) {
    if (!modelId || !v.safeParse(driverSchema, driver).success)
      return false
    if (settings.document.value.motionDrivers[modelId] === driver)
      return true
    return (await commit({ motionDrivers: { ...settings.document.value.motionDrivers, [modelId]: driver } })).success
  }

  async function setStanceSlot(modelId: string, slot: keyof MMDStanceSlots, name: string | null) {
    if (!modelId || !v.safeParse(v.picklist(['idle', 'sit', 'sleep']), slot).success || (name !== null && typeof name !== 'string'))
      return false
    const slots = settings.document.value.stanceSlots[modelId] ?? {}
    const next = name === null ? omit(slots, [slot]) : { ...slots, [slot]: name }
    if (isEqual(slots, next))
      return true
    return (await commit({ stanceSlots: { ...settings.document.value.stanceSlots, [modelId]: next } })).success
  }

  async function setCuration(modelId: string, name: string, patch: Partial<MMDClipCuration>, derivedKind?: ClipKind) {
    if (!modelId || !isRecord(patch))
      return false
    const previous = curationFor.value(modelId, name)
    const result = v.safeParse(curationSchema, { ...previous, ...patch })
    if (!result.success)
      return false
    const next = result.output
    const model = clipCuration.value[modelId] ?? {}
    if (next.label !== null && Object.entries(model).some(([other, curation]) => other !== name && curation.label === next.label))
      return false
    const kind = next.kind ?? derivedKind
    if (next.label === null || kind === 'stance' || kind === 'unusable') {
      next.aiMayUse = false
      next.idleMayUse = false
    }
    if (isEqual(previous, next))
      return true
    return (await commit({ clipCuration: { ...clipCuration.value, [modelId]: { ...model, [name]: next } } })).success
  }

  /** Motion files are shared by name; removing one drops references across the same model maps as before. */
  async function removeClip(name: string) {
    await commit({
      stanceSlots: Object.fromEntries(Object.entries(stanceSlots.value).map(([id, slots]) => [id, Object.fromEntries(Object.entries(slots).filter(([, clip]) => clip !== name))])),
      clipCuration: Object.fromEntries(Object.entries(clipCuration.value).map(([id, clips]) => [id, omit(clips, [name])])),
    })
  }

  async function removeModel(modelId: string) {
    const current = settings.document.value
    if (![current.motionDrivers, current.stanceSlots, current.clipCuration].some(map => Object.hasOwn(map, modelId)))
      return
    await commit({ motionDrivers: omit(current.motionDrivers, [modelId]), stanceSlots: omit(current.stanceSlots, [modelId]), clipCuration: omit(current.clipCuration, [modelId]) })
  }

  async function reset() {
    await settings.reset()
    removeLegacySettings()
  }

  return {
    document: settings.document,
    motionDriver,
    stageCharacterHeight,
    roamMode,
    stanceSlots,
    clipCuration,
    curationFor,
    labeledClips,
    exposedActions,
    initialize,
    selectModel,
    update,
    setMotionDriver,
    setStanceSlot,
    setCuration,
    removeClip,
    removeModel,
    reset,
  }
}, {
  synced: { state: true, actions: ['initialize', 'selectModel', 'update', 'setMotionDriver', 'setStanceSlot', 'setCuration', 'removeClip', 'removeModel', 'reset'] },
})
