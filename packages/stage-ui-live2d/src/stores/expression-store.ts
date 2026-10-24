import type { CatalogEntry, CuratedCatalogDocument, CuratedOverride } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../composables/live2d/expression/compose'
import type { SlotLeaseSettings } from '../composables/live2d/expression/slots'
import type { SlotLeases } from './expression-slot-leases'

import { errorMessageFrom } from '@moeru/std'
import { defaultExpressionPerformanceSettings, isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet } from '@proj-airi/stage-shared/expression-performance'
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { ExpressionComposer } from '../composables/live2d/expression/compose'
import { slotNames } from '../composables/live2d/expression/slots'
import { deriveCatalog } from '../utils/expression-catalog/derive'
import { createCatalogPersistence } from './expression-catalog-persistence'
import { createSlotLeases, emptyLeases } from './expression-slot-leases'

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
    | { type: 'set-active', id: string, active: boolean }

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
  // Rest-set members the user toggled off this session; cleared by resetAll and saveDefaults.
  const restSuppressed = ref<string[]>([])
  const leases = ref<SlotLeases>(emptyLeases())
  const muted = ref(false)
  const slotSettings = ref<SlotLeaseSettings>({ ...defaultExpressionPerformanceSettings.slots })

  /** The single ownership computation behind the composer target, the snapshot and group protection. */
  function ownersOf(id: string) {
    return {
      rest: restSet.value.includes(id) && !restSuppressed.value.includes(id),
      manual: manualActive.value.includes(id),
      slot: slotActive.value.includes(id),
    }
  }

  function isActive(id: string) {
    const owners = ownersOf(id)
    return owners.rest || owners.manual || owners.slot
  }

  const { activateFromSlot, applySlots, onSpeech, setMuted, setSlotSettings, tickLeases } = createSlotLeases({ catalog, slotActive, leases, muted, slotSettings, composer, ownersOf, isActive, deactivate })
  const { updateEntry, resetEntry } = createCatalogPersistence({ modelId, derived, curated })

  const settingsSnapshot = computed<Live2DExpressionSettingsSnapshot>(() => ({
    groups: catalog.value.map(entry => ({
      ...entry,
      parameterIds: [...entry.parameterIds],
      mappings: entry.mappings.map(mapping => ({ ...mapping })),
      name: entry.label,
      active: isActive(entry.id),
    })),
  }))

  function registerDefinitions(id: string, defs: NamedExpressionDefinition[], model3Refs: { File: string, Name?: unknown }[] = [], vtube?: unknown) {
    modelId.value = id
    definitions.value = defs
    derived.value = deriveCatalog(defs, model3Refs, vtube)
    curated.value = { version: 1, overrides: [] }
    slotActive.value = []
    leases.value = emptyLeases()
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
    restSuppressed.value = restSuppressed.value.filter(suppressedId => suppressedId !== id)
    manualActive.value = [...manualActive.value, id]
    composer.activate(id, performance.now() / 1000)
  }

  function deactivate(id: string, now = performance.now() / 1000) {
    if (restSet.value.includes(id) && !restSuppressed.value.includes(id))
      restSuppressed.value = [...restSuppressed.value, id]
    manualActive.value = manualActive.value.filter(activeId => activeId !== id)
    slotActive.value = slotActive.value.filter(activeId => activeId !== id)
    for (const slot of slotNames) {
      if (leases.value[slot]?.expressionId === id)
        leases.value = { ...leases.value, [slot]: null }
    }
    composer.deactivate(id, now)
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
    restSuppressed.value = []
    try {
      localStorage.setItem(`expression-rest:${modelId.value}`, JSON.stringify({ version: 1, active: restSet.value }))
    }
    catch (error) {
      console.warn('[expression-store] Failed to save rest set:', errorMessageFrom(error))
    }
  }

  function resetAll() {
    restSuppressed.value = []
    manualActive.value = []
    slotActive.value = []
    leases.value = emptyLeases()
    composer.setActiveSet([], performance.now() / 1000)
    for (const id of restSet.value)
      activate(id)
  }

  function dispose() {
    composer.restoreBases(() => {})
    definitions.value = []
    modelId.value = ''
    restSet.value = []
    manualActive.value = []
    slotActive.value = []
    restSuppressed.value = []
    leases.value = emptyLeases()
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
      case 'set-active':
        return command.active ? activate(command.id) : deactivate(command.id)
    }
  }

  return { definitions, modelId, restSet, restSuppressed, manualActive, slotActive, leases, composer, derived, curated, catalog, llmEligibleEntries, autoEligibleEntries, settingsSnapshot, registerDefinitions, activate, activateFromSlot, applySlots, onSpeech, setMuted, setSlotSettings, tickLeases, deactivate, toggle, saveDefaults, resetAll, updateEntry, resetEntry, dispose, applySettingsCommand }
})
