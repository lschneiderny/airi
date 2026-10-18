import type { CatalogEntry, CuratedCatalogDocument, CuratedOverride, ExpressionKind, SlotCommand } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../composables/live2d/expression/compose'
import type { SlotLease, SlotLeaseSettings, SlotName, SpeechEvent } from '../composables/live2d/expression/slots'

import { errorMessageFrom } from '@moeru/std'
import { defaultExpressionPerformanceSettings, isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet } from '@proj-airi/stage-shared/expression-performance'
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { ExpressionComposer } from '../composables/live2d/expression/compose'
import { applySpeechEvent, createLease, isLeaseExpired, slotNames } from '../composables/live2d/expression/slots'
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

type SlotLeases = Record<SlotName, SlotLease | null>

function emptyLeases(): SlotLeases {
  return { face: null, effect: null, prop: null }
}

const speechEvents: readonly SpeechEvent[] = ['clip-start', 'clip-end', 'clip-stopped', 'turn-end']

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

  /** Checks every conflicting owner before changing any target; leases are owned by the performer. */
  function activateFromSlot(id: string, kind: ExpressionKind, now = performance.now() / 1000): boolean {
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry || entry.kind !== kind || !['face', 'effect', 'prop'].includes(kind))
      return false
    const conflicts = catalog.value.filter(other => other.id !== id && entry.group !== null && other.group === entry.group
      && isActive(other.id))
    if (conflicts.some((other) => {
      const owners = ownersOf(other.id)
      return other.kind !== kind || owners.rest || owners.manual
    })) {
      console.warn('[expression-store] Slot activation skipped for protected group:', id)
      return false
    }
    for (const other of conflicts)
      deactivate(other.id, now)
    if (!slotActive.value.includes(id))
      slotActive.value = [...slotActive.value, id]
    composer.activate(id, now)
    return true
  }

  /** Ends a lease; the expression stays active while an unsuppressed rest entry or a manual toggle also owns it. */
  function releaseSlot(slot: SlotName, now: number) {
    const lease = leases.value[slot]
    if (!lease)
      return
    leases.value = { ...leases.value, [slot]: null }
    slotActive.value = slotActive.value.filter(id => id !== lease.expressionId)
    if (!isActive(lease.expressionId))
      composer.deactivate(lease.expressionId, now)
  }

  /** Executes decider output; invalid commands are dropped, never partially applied. */
  function applySlots(commands: SlotCommand[], now: number) {
    if (!Number.isFinite(now))
      return
    for (const command of commands) {
      const slot = command.slot
      if (!slotNames.includes(slot)) {
        console.warn('[expression-store] Unknown slot dropped:', slot)
        continue
      }
      if (command.expressionId === null) {
        releaseSlot(slot, now)
        continue
      }
      if (!Number.isFinite(command.holdSeconds) || command.holdSeconds < 0 || (command.until !== 'speech' && command.until !== 'hold')) {
        console.warn('[expression-store] Slot command with invalid lifetime dropped:', command.expressionId)
        continue
      }
      const previous = leases.value[slot]
      if (previous?.expressionId !== command.expressionId && !activateFromSlot(command.expressionId, slot, now))
        continue
      if (previous?.expressionId === command.expressionId)
        slotActive.value = slotActive.value.includes(command.expressionId) ? slotActive.value : [...slotActive.value, command.expressionId]
      else
        releaseSlot(slot, now)
      leases.value = { ...leases.value, [slot]: createLease(command.expressionId, command, now) }
    }
  }

  /** Releases every lease whose lifetime ended; called from the final plugin before compose. */
  function tickLeases(now: number) {
    if (!Number.isFinite(now))
      return
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (lease && isLeaseExpired(lease, now, muted.value, slotSettings.value))
        releaseSlot(slot, now)
    }
  }

  /** Only leases of the same turn react; leases without a turn follow their hold rule. */
  function onSpeech(event: SpeechEvent, turnId: string, now: number) {
    if (!Number.isFinite(now) || !speechEvents.includes(event))
      return
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (!lease || lease.turnId === null || lease.turnId !== turnId)
        continue
      const next = applySpeechEvent(lease, event, now, muted.value, slotSettings.value)
      if (next === null)
        releaseSlot(slot, now)
      else
        leases.value = { ...leases.value, [slot]: next }
    }
    tickLeases(now)
  }

  function setMuted(value: boolean) {
    muted.value = value
  }

  function setSlotSettings(settings: SlotLeaseSettings & { defaultFadeSeconds: number }) {
    slotSettings.value = { speechGrace: settings.speechGrace, unstartedExpiry: settings.unstartedExpiry, holdCap: settings.holdCap }
    composer.setDefaultFadeSeconds(settings.defaultFadeSeconds)
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
      case 'confirm-all-suggested':
        return confirmAllSuggested()
    }
  }

  return { definitions, modelId, restSet, restSuppressed, manualActive, slotActive, leases, composer, derived, curated, catalog, llmEligibleEntries, autoEligibleEntries, settingsSnapshot, registerDefinitions, activate, activateFromSlot, applySlots, onSpeech, setMuted, setSlotSettings, tickLeases, deactivate, toggle, saveDefaults, resetAll, updateEntry, resetEntry, confirmAllSuggested, dispose, applySettingsCommand }
})
