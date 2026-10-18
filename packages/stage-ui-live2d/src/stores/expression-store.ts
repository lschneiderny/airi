import type { CatalogEntry, CuratedCatalogDocument, CuratedOverride, ExpressionKind } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../composables/live2d/expression/compose'

import { errorMessageFrom } from '@moeru/std'
import { isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet } from '@proj-airi/stage-shared/expression-performance'
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { ExpressionComposer } from '../composables/live2d/expression/compose'
import { deriveCatalog } from '../utils/expression-catalog/derive'

export interface NamedExpressionDefinition extends ExpressionDefinition {
  name: string
}

/** Target activation state; fading releases remain owned by the composer until zero. */
export interface Live2DExpressionSettingsSnapshot {
  groups: (CatalogEntry & { name: string, active: boolean })[]
}

export type Live2DExpressionSettingsCommand
  = | { type: 'toggle', id: string }
    | { type: 'save-defaults' }
    | { type: 'reset-all' }
    | { type: 'update-entry', id: string, patch: Omit<CuratedOverride, 'id'> }
    | { type: 'reset-entry', id: string }
    | { type: 'confirm-all-suggested' }

/** Local to the renderer that owns the model. Other windows use snapshots and commands. */
export const useExpressionStore = defineStore('live2d-expressions', () => {
  const definitions = ref<NamedExpressionDefinition[]>([])
  const modelId = ref('')
  const restSet = ref<string[]>([])
  // Current non-transient targets, including rest entries until manually toggled off.
  const manualActive = ref<string[]>([])
  const composer = markRaw(new ExpressionComposer())
  const derived = ref<CatalogEntry[]>([])
  const curated = ref<CuratedCatalogDocument>({ version: 1, overrides: [] })
  const catalog = computed(() => mergeCatalog(derived.value, curated.value))
  const llmEligibleEntries = computed(() => catalog.value.filter(isLlmEligible))
  const autoEligibleEntries = computed(() => catalog.value.filter(isAutoEligible))
  const slotActive = ref<string[]>([])

  const settingsSnapshot = computed<Live2DExpressionSettingsSnapshot>(() => ({
    groups: catalog.value.map(entry => ({
      ...entry,
      parameterIds: [...entry.parameterIds],
      mappings: entry.mappings.map(mapping => ({ ...mapping })),
      name: entry.label,
      active: manualActive.value.includes(entry.id) || slotActive.value.includes(entry.id),
    })),
  }))

  function registerDefinitions(id: string, defs: NamedExpressionDefinition[], model3Refs: { File: string, Name?: unknown }[] = [], vtube?: unknown) {
    modelId.value = id
    definitions.value = defs
    derived.value = deriveCatalog(defs, model3Refs, vtube)
    curated.value = { version: 1, overrides: [] }
    slotActive.value = []
    try {
      const raw = localStorage.getItem(`expression-catalog:${id}`)
      if (raw !== null) {
        const parsed = parseCuratedCatalogDocument(JSON.parse(raw))
        if (!parsed.success)
          throw new Error(JSON.stringify(parsed.issues))
        curated.value = parsed.value
      }
    }
    catch (error) {
      console.warn('[expression-store] Invalid curated catalog discarded:', errorMessageFrom(error))
    }
    restSet.value = []
    composer.define(defs)
    try {
      const raw = localStorage.getItem(`expression-rest:${id}`)
      if (raw !== null) {
        const parsed = parseRestSet(JSON.parse(raw))
        if (parsed.success)
          restSet.value = [...new Set(parsed.value.active)].filter(activeId => defs.some(def => def.id === activeId))
        else
          console.warn('[expression-store] Invalid rest set:', parsed.issues)
      }
    }
    catch (error) {
      console.warn('[expression-store] Failed to load rest set:', errorMessageFrom(error))
    }
    resetAll()
  }

  function activate(id: string) {
    if (!definitions.value.some(def => def.id === id) || manualActive.value.includes(id))
      return
    const entry = catalog.value.find(entry => entry.id === id)!
    if (entry.group !== null) {
      for (const other of catalog.value) {
        if (other.id !== id && other.group === entry.group)
          deactivate(other.id)
      }
    }
    manualActive.value = [...manualActive.value, id]
    composer.activate(id, performance.now() / 1000)
  }

  function deactivate(id: string) {
    manualActive.value = manualActive.value.filter(activeId => activeId !== id)
    slotActive.value = slotActive.value.filter(activeId => activeId !== id)
    composer.deactivate(id, performance.now() / 1000)
  }

  function toggle(id: string) {
    if (manualActive.value.includes(id))
      deactivate(id)
    else
      activate(id)
  }

  function saveDefaults() {
    if (!modelId.value)
      return
    restSet.value = [...manualActive.value]
    try {
      localStorage.setItem(`expression-rest:${modelId.value}`, JSON.stringify({ version: 1, active: restSet.value }))
    }
    catch (error) {
      console.warn('[expression-store] Failed to save rest set:', errorMessageFrom(error))
    }
  }

  function resetAll() {
    manualActive.value = []
    slotActive.value = []
    composer.setActiveSet([], performance.now() / 1000)
    for (const id of restSet.value)
      activate(id)
  }

  /** Checks every conflicting owner before changing any target; leases are owned by the performer. */
  function activateFromSlot(id: string, kind: ExpressionKind): boolean {
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry || entry.kind !== kind || !['face', 'effect', 'prop'].includes(kind))
      return false
    const conflicts = catalog.value.filter(other => other.id !== id && entry.group !== null && other.group === entry.group
      && (manualActive.value.includes(other.id) || slotActive.value.includes(other.id)))
    if (conflicts.some(other => other.kind !== kind || restSet.value.includes(other.id) || manualActive.value.includes(other.id))) {
      console.warn('[expression-store] Slot activation skipped for protected group:', id)
      return false
    }
    for (const other of conflicts)
      deactivate(other.id)
    if (!slotActive.value.includes(id))
      slotActive.value = [...slotActive.value, id]
    composer.activate(id, performance.now() / 1000)
    return true
  }

  function persistCurated(document: unknown) {
    const parsed = parseCuratedCatalogDocument(document)
    if (!parsed.success)
      throw new Error(JSON.stringify(parsed.issues))
    if (!modelId.value)
      return
    localStorage.setItem(`expression-catalog:${modelId.value}`, JSON.stringify(parsed.value))
    curated.value = parsed.value
  }

  function updateEntry(id: string, patch: Omit<CuratedOverride, 'id'>) {
    if (!derived.value.some(entry => entry.id === id))
      throw new Error(`Unknown expression: ${id}`)
    const previous = curated.value.overrides.find(entry => entry.id === id)
    persistCurated({ version: 1, overrides: [
      ...curated.value.overrides.filter(entry => entry.id !== id),
      { ...previous, ...patch, id },
    ] })
  }

  function resetEntry(id: string) {
    persistCurated({ version: 1, overrides: curated.value.overrides.filter(entry => entry.id !== id) })
  }

  function confirmAllSuggested() {
    persistCurated({ version: 1, overrides: derived.value.map(entry => ({
      ...curated.value.overrides.find(override => override.id === entry.id),
      id: entry.id,
      confirmed: true,
    })) })
  }

  function dispose() {
    composer.restoreBases(() => {})
    definitions.value = []
    modelId.value = ''
    restSet.value = []
    manualActive.value = []
    slotActive.value = []
    derived.value = []
    curated.value = { version: 1, overrides: [] }
    composer.define([])
  }

  function applySettingsCommand(command: Live2DExpressionSettingsCommand) {
    switch (command.type) {
      case 'toggle':
        return toggle(command.id)
      case 'save-defaults':
        return saveDefaults()
      case 'reset-all':
        return resetAll()
      case 'update-entry':
        return updateEntry(command.id, command.patch)
      case 'reset-entry':
        return resetEntry(command.id)
      case 'confirm-all-suggested':
        return confirmAllSuggested()
    }
  }

  return { definitions, modelId, restSet, manualActive, slotActive, composer, derived, curated, catalog, llmEligibleEntries, autoEligibleEntries, settingsSnapshot, registerDefinitions, activate, activateFromSlot, deactivate, toggle, saveDefaults, resetAll, updateEntry, resetEntry, confirmAllSuggested, dispose, applySettingsCommand }
})
