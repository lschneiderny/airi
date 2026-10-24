import type { CatalogEntry, CuratedCatalogDocument, CuratedOverride } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../composables/live2d/expression/compose'
import type { SlotLeaseSettings } from '../composables/live2d/expression/slots'
import type { SlotLeases } from './expression-slot-leases'

import { errorMessageFrom } from '@moeru/std'
import { defaultExpressionPerformanceSettings, expandEntry, isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet, resolveAlias } from '@proj-airi/stage-shared/expression-performance'
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
  groups: (CatalogEntry & { name: string, active: boolean, effective: boolean, overriddenBy: string | null, via: string[], isDefault: boolean })[]
}

export interface ExpressionClaim {
  expressionId: string
  layer: number
  seq: number
}

/** Resolves ownership without deleting losing claims or changing the catalog. */
export function resolve(claims: ExpressionClaim[], catalog: CatalogEntry[]) {
  const ordered = [...claims].sort((a, b) => b.layer - a.layer || b.seq - a.seq)
  const holder = new Map<string, { memberId: string, triggerId: string }>()
  const weights = new Map<string, number>()
  const masked = new Map<string, string>()
  const effective = new Set<string>()
  const via = new Map<string, string[]>()
  const accepted = new Map<ExpressionClaim, string[]>()
  for (const claim of ordered) {
    const entry = catalog.find(entry => entry.id === claim.expressionId)
    if (!entry)
      continue
    const members: string[] = []
    for (const { expressionId, strength } of expandEntry(entry, catalog)) {
      const member = catalog.find(entry => entry.id === expressionId)!
      const held = member.group === null ? undefined : holder.get(member.group)
      if (held && held.memberId !== expressionId) {
        masked.set(expressionId, held.triggerId)
        continue
      }
      if (member.group !== null)
        holder.set(member.group, { memberId: expressionId, triggerId: held?.triggerId ?? entry.id })
      weights.set(expressionId, Math.max(weights.get(expressionId) ?? 0, strength))
      members.push(expressionId)
      effective.add(expressionId)
      effective.add(entry.id)
      if (entry.kind === 'combo') {
        const owners = via.get(expressionId) ?? []
        if (!owners.includes(entry.id))
          via.set(expressionId, [...owners, entry.id])
      }
    }
    accepted.set(claim, members)
  }
  const ids = new Set<string>()
  for (const claim of [...ordered].reverse()) {
    for (const id of accepted.get(claim) ?? [])
      ids.add(id)
  }
  return { targets: [...ids].map(id => ({ id, weight: weights.get(id)! })), masked, effective, via }
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
  const manualSeq = ref<Record<string, number>>({})
  let claimSeq = 0
  const composer = markRaw(new ExpressionComposer())
  const derived = ref<CatalogEntry[]>([])
  const curated = ref<CuratedCatalogDocument>({ version: 1, overrides: [] })
  let deriveInputs: { defs: NamedExpressionDefinition[], model3Refs: { File: string, Name?: unknown }[], vtube?: unknown, displayInfo?: unknown } | undefined
  const catalog = computed(() => mergeCatalog(derived.value, curated.value))
  const llmEligibleEntries = computed(() => catalog.value.filter(isLlmEligible))
  const autoEligibleEntries = computed(() => catalog.value.filter(isAutoEligible))
  // Rest-set members the user toggled off this session; cleared by resetAll and saveDefaults.
  const restSuppressed = ref<string[]>([])
  const leases = ref<SlotLeases>(emptyLeases())
  const muted = ref(false)
  const slotSettings = ref<SlotLeaseSettings>({ ...defaultExpressionPerformanceSettings.slots })

  /** The single ownership computation behind the composer target, the snapshot and group protection. */
  function ownersOf(id: string) {
    return {
      rest: restSet.value.includes(id) && manualActive.value.includes(id),
      manual: manualActive.value.includes(id),
      slot: slotNames.some(slot => leases.value[slot]?.expressionId === id),
    }
  }

  function isActive(id: string) {
    const owners = ownersOf(id)
    return owners.rest || owners.manual || owners.slot
  }

  const claims = computed<ExpressionClaim[]>(() => [
    ...manualActive.value.map(expressionId => ({ expressionId, layer: 0, seq: manualSeq.value[expressionId] })),
    ...[...new Set(slotNames.flatMap(slot => leases.value[slot] ? [leases.value[slot]!.expressionId] : []))]
      .map(expressionId => ({ expressionId, layer: 1, seq: Math.max(...slotNames.flatMap(slot => leases.value[slot]?.expressionId === expressionId ? [leases.value[slot]!.claimSequence] : [])) })),
  ])
  const resolved = computed(() => resolve(claims.value, catalog.value))
  function reconcile(now = performance.now() / 1000) {
    composer.setTargets(resolved.value.targets, now)
  }

  const { activateFromSlot, releaseSlot, applySlots, onSpeech, setMuted, setSlotSettings, tickLeases } = createSlotLeases({
    catalog,
    manualActive,
    leases,
    muted,
    slotSettings,
    composer,
    reconcile,
    nextClaimSequence: () => ++claimSeq,
  })
  const persistence = createCatalogPersistence({ modelId, derived, curated })
  function updateEntry(id: string, patch: Omit<CuratedOverride, 'id'>) {
    persistence.updateEntry(id, patch)
    reconcile()
  }
  function resetEntry(id: string) {
    persistence.resetEntry(id)
    reconcile()
  }

  const settingsSnapshot = computed<Live2DExpressionSettingsSnapshot>(() => ({
    groups: catalog.value.map(entry => ({
      ...entry,
      parameterIds: [...entry.parameterIds],
      mappings: entry.mappings.map(mapping => ({ ...mapping })),
      name: entry.label,
      active: isActive(entry.id),
      effective: resolved.value.effective.has(entry.id),
      overriddenBy: resolved.value.effective.has(entry.id) ? null : catalog.value.find(trigger => trigger.id === resolved.value.masked.get(entry.id))?.label ?? null,
      via: resolved.value.via.get(entry.id) ?? [],
      isDefault: restSet.value.includes(entry.id),
    })),
  }))

  /** Rebuild duplicate ownership after curated keepSeparate changes without reloading the model. */
  function rederive() {
    if (!deriveInputs)
      return
    const { defs, model3Refs, vtube, displayInfo } = deriveInputs
    const keepSeparate = new Set(curated.value.overrides.filter(override => override.keepSeparate === true).map(override => override.id))
    derived.value = deriveCatalog(defs, model3Refs, vtube, displayInfo, keepSeparate)
  }

  function registerDefinitions(id: string, defs: NamedExpressionDefinition[], model3Refs: { File: string, Name?: unknown }[] = [], vtube?: unknown, displayInfo?: unknown) {
    modelId.value = id
    definitions.value = defs
    deriveInputs = { defs, model3Refs, vtube, displayInfo }
    curated.value = { version: 1, overrides: [] }
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
    rederive()
    restSet.value = []
    composer.define(defs)
    try {
      const raw = localStorage.getItem(`expression-rest:${id}`)
      if (raw !== null) {
        const parsed = parseRestSet(JSON.parse(raw))
        if (parsed.success)
          restSet.value = [...new Set(parsed.value.active.map(activeId => resolveAlias(activeId, catalog.value)))].filter(activeId => catalog.value.some(entry => entry.id === activeId))
        else
          console.warn('[expression-store] Invalid rest set:', parsed.issues)
      }
    }
    catch (error) {
      console.warn('[expression-store] Failed to load rest set:', errorMessageFrom(error))
    }
    resetAll()
  }

  function activate(id: string, now = performance.now() / 1000) {
    id = resolveAlias(id, catalog.value)
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry)
      return
    if (entry.kind !== 'combo' && entry.group !== null) {
      for (const other of catalog.value) {
        if (other.id !== id && other.kind !== 'combo' && other.group === entry.group && manualActive.value.includes(other.id)) {
          removeBaseClaim(other.id)
        }
      }
    }
    // Slot precedence must not make a user's newly asserted switch invisible.
    const claim = { expressionId: id, layer: 0, seq: ++claimSeq }
    const members = expandEntry(entry, catalog.value)
    while (true) {
      const pending = resolve([...claims.value, claim], catalog.value)
      if (pending.effective.has(id))
        break
      const maskingSlot = slotNames.find(slot => leases.value[slot] && members.some(member => pending.masked.get(member.expressionId) === leases.value[slot]!.expressionId))
      if (!maskingSlot)
        break
      releaseSlot(maskingSlot, now, false)
    }
    manualSeq.value = { ...manualSeq.value, [id]: claim.seq }
    if (!manualActive.value.includes(id))
      manualActive.value = [...manualActive.value, id]
    restSuppressed.value = restSuppressed.value.filter(suppressedId => suppressedId !== id)
    reconcile(now)
  }

  function removeBaseClaim(id: string) {
    if (restSet.value.includes(id) && !restSuppressed.value.includes(id))
      restSuppressed.value = [...restSuppressed.value, id]
    manualActive.value = manualActive.value.filter(activeId => activeId !== id)
    delete manualSeq.value[id]
  }

  function deactivate(id: string, now = performance.now() / 1000) {
    removeBaseClaim(resolveAlias(id, catalog.value))
    reconcile(now)
  }

  function toggle(id: string) {
    id = resolveAlias(id, catalog.value)
    if (manualActive.value.includes(id))
      deactivate(id)
    else
      activate(id)
  }

  function saveDefaults() {
    if (!modelId.value)
      return
    restSet.value = [...manualActive.value].sort((a, b) => manualSeq.value[a] - manualSeq.value[b])
    restSuppressed.value = []
    reconcile()
    try {
      localStorage.setItem(`expression-rest:${modelId.value}`, JSON.stringify({ version: 1, active: restSet.value }))
    }
    catch (error) {
      console.warn('[expression-store] Failed to save rest set:', errorMessageFrom(error))
    }
  }

  function resetAll() {
    restSuppressed.value = []
    manualActive.value = [...restSet.value]
    manualSeq.value = Object.fromEntries(restSet.value.map(id => [id, ++claimSeq]))
    leases.value = emptyLeases()
    reconcile()
  }

  function dispose() {
    composer.restoreBases(() => {})
    definitions.value = []
    modelId.value = ''
    restSet.value = []
    manualActive.value = []
    manualSeq.value = {}
    claimSeq = 0
    restSuppressed.value = []
    leases.value = emptyLeases()
    derived.value = []
    deriveInputs = undefined
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

  return { definitions, modelId, restSet, restSuppressed, manualActive, manualSeq, leases, composer, derived, curated, catalog, llmEligibleEntries, autoEligibleEntries, settingsSnapshot, ownersOf, reconcile, registerDefinitions, rederive, activate, activateFromSlot, releaseSlot, applySlots, onSpeech, setMuted, setSlotSettings, tickLeases, deactivate, toggle, saveDefaults, resetAll, updateEntry, resetEntry, dispose, applySettingsCommand }
})
