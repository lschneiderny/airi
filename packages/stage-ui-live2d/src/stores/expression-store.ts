import type { CatalogEntry, CuratedCatalogDocument, CustomExpressionDocument, ExpressionRefusal, ItemExpressionDocument, ItemRenderState } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../composables/live2d/expression/compose'
import type { SlotLeaseSettings } from '../composables/live2d/expression/slots'
import type { FreeParameter } from '../utils/expression-catalog/free-parameters'
import type { ComboPatch, CreateComboInput, CreateItemInput, CustomPatch, EntryPatch, ItemPatch } from './expression-catalog-persistence'
import type { SlotLeases } from './expression-slot-leases'

import { errorMessageFrom } from '@moeru/std'
import { customEntryFromDocument, defaultExpressionPerformanceSettings, expandEntry, isAutoEligible, isLlmEligible, itemEntryFromDocument, MAX_SHOWN_ITEMS, MAX_SHOWN_LIVE2D_ITEMS, mergeCatalog, parseCuratedCatalogDocument, parseRestSet, resolveAlias } from '@proj-airi/stage-shared/expression-performance'
import { createEventHook } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, toRaw } from 'vue'

import { ExpressionComposer } from '../composables/live2d/expression/compose'
import { slotNames } from '../composables/live2d/expression/slots'
import { suggestArea } from '../utils/expression-catalog/area'
import { deriveCatalog, suggestKind } from '../utils/expression-catalog/derive'
import { createCatalogPersistence, removeItemsByAsset } from './expression-catalog-persistence'
import { createSlotLeases, emptyLeases } from './expression-slot-leases'

export interface NamedExpressionDefinition extends ExpressionDefinition {
  name: string
}

/** One stage item of the loaded model as the panel sees it. `state` is the renderer's last report, null while it draws nothing. */
export interface Live2DItemSnapshot {
  document: ItemExpressionDocument
  /** The item's library asset exists on this device. */
  available: boolean
  /** The entry is in the resolved effective set, whoever claims it. */
  shown: boolean
  state: ItemRenderState | null
}

/** A shown item the renderer draws, with the strength of the claim that shows it. */
export interface ItemTarget {
  document: ItemExpressionDocument
  weight: number
}

/** Target activation state; fading releases remain owned by the composer until zero. */
export interface Live2DExpressionSettingsSnapshot {
  entries: (CatalogEntry & { name: string, active: boolean, effective: boolean, overriddenBy: string | null, via: string[], isDefault: boolean, usesOverwrite: boolean })[]
  /** Choose-one sets in catalog order; the shared expression panel reads them from every renderer. */
  groups: { id: string, memberIds: string[] }[]
  activeIds: string[]
  restIds: string[]
  freeParameters: FreeParameter[]
  /** This renderer lets her use entries on her own, so the panel offers the choice. The store always sets it. */
  supportsIdleUse?: true
  /** Every stored item of the model, including those whose asset is missing. The store always sets it. */
  items?: Live2DItemSnapshot[]
  /** Her model canvas in canvas units, once the scene reports it; new items are placed relative to it. */
  canvas?: { width: number, height: number }
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
    | { type: 'update-entry', id: string, patch: EntryPatch }
    | { type: 'reset-entry', id: string }
    | { type: 'set-active', id: string, active: boolean }
    | { type: 'create-combo', combo: CreateComboInput }
    | { type: 'update-combo', id: string, patch: ComboPatch }
    | { type: 'delete-combo', id: string }
    | { type: 'create-custom', custom: { label: string, parameterId: string, target: number } }
    | { type: 'update-custom', id: string, patch: Omit<CustomPatch, 'delta'> & { target?: number } }
    | { type: 'delete-custom', id: string }
    | { type: 'create-item', item: CreateItemInput }
    | { type: 'update-item', id: string, patch: ItemPatch }
    | { type: 'delete-item', id: string }

/** Local to the renderer that owns the model. Other windows use snapshots and commands. */
export const useExpressionStore = defineStore('live2d-expressions', () => {
  const definitions = ref<NamedExpressionDefinition[]>([])
  const modelId = ref('')
  const restSet = ref<string[]>([])
  // Current non-transient targets, including rest entries until manually toggled off.
  const manualActive = ref<string[]>([])
  const manualSeq = ref<Record<string, number>>({})
  // Entries she holds on her own: a pastime, and what she takes to sleep. They outrank the user's switches and yield
  // to slot leases, so a reaction the model asks for still shows.
  const idleActive = ref<string[]>([])
  const idleSeq = ref<Record<string, number>>({})
  let claimSeq = 0
  // Entries the last idle request left out at a cap, so a repeated request does not report them again.
  let idleRefused = new Set<string>()
  const composer = markRaw(new ExpressionComposer())
  /** Highest-priority, frame-scoped input from the Root context; never persisted or exposed as catalog entries. */
  const contextPreview = shallowRef<ExpressionDefinition['parameters']>([])
  const derived = ref<CatalogEntry[]>([])
  const curated = ref<CuratedCatalogDocument>({ version: 1, overrides: [] })
  const parameters = ref<Omit<FreeParameter, 'name'>[]>([])
  const freeParameters = ref<FreeParameter[]>([])
  let deriveInputs: { defs: NamedExpressionDefinition[], model3Refs: { File: string, Name?: unknown }[], vtube?: unknown, displayInfo?: unknown } | undefined
  const validCustoms = computed(() => (curated.value.customs ?? []).filter(custom => parameters.value.some(parameter => parameter.id === custom.parameterId)))
  /** A custom without a stored area lands where a derived entry of its kind would; the area is never saved. */
  function withKindArea(custom: CustomExpressionDocument): CatalogEntry {
    const entry = customEntryFromDocument(custom)
    if (entry.area === undefined)
      entry.area = entry.kind === 'unsorted' ? 'hidden' : suggestArea(entry.kind, entry.parameterIds, entry.label)
    return entry
  }
  // Library assets on this device; the stage sets them from the item library. An item without its asset is not in the
  // catalog, so every request for it is refused `missing-asset`, but its document and rest-set place stay.
  const availableItemAssets = shallowRef<ReadonlySet<string>>(new Set())
  const live2dItemAssets = shallowRef<ReadonlySet<string>>(new Set())
  const itemStates = ref<Record<string, ItemRenderState>>({})
  const modelCanvas = shallowRef<{ width: number, height: number } | null>(null)
  // Fires once per item refusal outside `applySlots`, which returns its own: a switch, her own claims, a renderer failure.
  const itemRefusals = createEventHook<ExpressionRefusal>()
  const validItems = computed(() => (curated.value.items ?? []).filter(item => availableItemAssets.value.has(item.assetId)))
  function itemEntry(item: ItemExpressionDocument): CatalogEntry {
    const entry = itemEntryFromDocument(item)
    entry.area ??= suggestArea(entry.kind, entry.parameterIds, entry.label)
    return entry
  }
  const catalog = computed(() => mergeCatalog(derived.value, curated.value, [...validCustoms.value.map(withKindArea), ...validItems.value.map(itemEntry)]))
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
      idle: idleActive.value.includes(id),
      slot: slotNames.some(slot => leases.value[slot]?.expressionId === id),
    }
  }

  function isActive(id: string) {
    const owners = ownersOf(id)
    return owners.rest || owners.manual || owners.idle || owners.slot
  }

  const claims = computed<ExpressionClaim[]>(() => [
    ...manualActive.value.map(expressionId => ({ expressionId, layer: 0, seq: manualSeq.value[expressionId] })),
    ...idleActive.value.map(expressionId => ({ expressionId, layer: 0.5, seq: idleSeq.value[expressionId] })),
    ...[...new Set(slotNames.flatMap(slot => leases.value[slot] ? [leases.value[slot]!.expressionId] : []))]
      .map(expressionId => ({ expressionId, layer: 1, seq: Math.max(...slotNames.flatMap(slot => leases.value[slot]?.expressionId === expressionId ? [leases.value[slot]!.claimSequence] : [])) })),
  ])
  const resolved = computed(() => resolve(claims.value, catalog.value))
  function reconcile(now = performance.now() / 1000) {
    composer.setTargets(resolved.value.targets, now)
  }

  /** Shown items for the renderer, in catalog order. The composer ignores item ids, because no definition names them. */
  const itemTargets = computed<ItemTarget[]>(() => {
    const weights = new Map(resolved.value.targets.map(target => [target.id, target.weight]))
    return validItems.value
      .filter(item => resolved.value.effective.has(item.id))
      .map(document => ({ document, weight: weights.get(document.id) ?? 1 }))
  })

  function shownItemCounts(effective: ReadonlySet<string>) {
    let all = 0
    let live2d = 0
    for (const item of validItems.value) {
      if (!effective.has(item.id))
        continue
      all++
      if (live2dItemAssets.value.has(item.assetId))
        live2d++
    }
    return { all, live2d }
  }

  /**
   * Whether adding `claim` to `base` would show more items than the caps allow. A claim that adds no item, or that
   * shows no more items than are shown now, always passes, so a look already over a cap can still change.
   */
  function exceedsItemLimit(base: readonly ExpressionClaim[], claim: ExpressionClaim) {
    const next = shownItemCounts(resolve([...base, claim], catalog.value).effective)
    const now = shownItemCounts(resolved.value.effective)
    return (next.all > MAX_SHOWN_ITEMS && next.all > now.all) || (next.live2d > MAX_SHOWN_LIVE2D_ITEMS && next.live2d > now.live2d)
  }

  function refuseItem(entryId: string, reason: ExpressionRefusal['reason']) {
    console.warn('[expression-store] Item refused:', entryId, reason)
    void itemRefusals.trigger({ entryId, reason })
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
    exceedsItemLimit: (expressionId, replacedId) => exceedsItemLimit(
      claims.value.filter(claim => claim.layer !== 1 || claim.expressionId !== replacedId),
      { expressionId, layer: 1, seq: claimSeq + 1 },
    ),
  })
  const persistence = createCatalogPersistence({ modelId, derived, curated, catalog })
  function updateEntry(id: string, patch: EntryPatch) {
    persistence.updateEntry(id, patch)
    if (patch.keepSeparate !== undefined)
      rederive()
    reconcile()
  }
  function resetEntry(id: string) {
    persistence.resetEntry(id)
    rederive()
    reconcile()
  }

  const settingsSnapshot = computed<Live2DExpressionSettingsSnapshot>(() => {
    const groups = new Map<string, string[]>()
    for (const entry of catalog.value) {
      if (entry.group !== null)
        groups.set(entry.group, [...groups.get(entry.group) ?? [], entry.id])
    }
    return {
      groups: [...groups].map(([id, memberIds]) => ({ id, memberIds })),
      activeIds: catalog.value.filter(entry => isActive(entry.id)).map(entry => entry.id),
      restIds: [...restSet.value],
      entries: catalog.value.map(entry => ({
        ...entry,
        parameterIds: [...entry.parameterIds],
        mappings: entry.mappings.map(mapping => ({ ...mapping })),
        members: entry.members?.map(member => ({ ...member })),
        aliases: entry.aliases ? [...entry.aliases] : undefined,
        slots: entry.slots ? [...entry.slots] : undefined,
        name: entry.label,
        active: isActive(entry.id),
        effective: resolved.value.effective.has(entry.id),
        overriddenBy: resolved.value.effective.has(entry.id) ? null : catalog.value.find(trigger => trigger.id === resolved.value.masked.get(entry.id))?.label ?? null,
        via: resolved.value.via.get(entry.id) ?? [],
        isDefault: restSet.value.includes(entry.id),
        usesOverwrite: expandEntry(entry, catalog.value).some(member => definitions.value.find(def => def.id === member.expressionId)?.parameters.some(parameter => parameter.blend === 'Overwrite')),
      })),
      freeParameters: freeParameters.value.filter(parameter => !validCustoms.value.some(custom => custom.parameterId === parameter.id)).map(parameter => ({ ...parameter })),
      supportsIdleUse: true,
      items: (curated.value.items ?? []).map(document => ({
        document: structuredClone(toRaw(document)),
        available: availableItemAssets.value.has(document.assetId),
        shown: resolved.value.effective.has(document.id),
        state: itemStates.value[document.id] ?? null,
      })),
      // Her canvas outlives an unloaded model in the scene, but an item can only be added to a loaded one.
      ...modelId.value && modelCanvas.value ? { canvas: { ...modelCanvas.value } } : {},
    }
  })

  function defineExpressions() {
    for (const custom of curated.value.customs ?? []) {
      if (!parameters.value.some(parameter => parameter.id === custom.parameterId))
        console.warn('[expression-store] Custom expression parameter is not in the model:', custom.parameterId)
    }
    definitions.value = [
      ...deriveInputs?.defs ?? [],
      ...validCustoms.value.map(custom => ({
        id: custom.id,
        name: custom.label,
        parameters: [{ id: custom.parameterId, value: custom.delta, blend: 'Add' as const }],
      })),
    ]
    composer.define(definitions.value)
  }

  /** Prune deleted triggers, not the members they masked. Reconciliation restores those members. */
  function removeDeletedClaims() {
    // An item whose asset is missing is not in the catalog, but it still exists: keep its claims and rest-set place.
    const ids = new Set([...catalog.value.map(entry => entry.id), ...(curated.value.items ?? []).map(item => item.id)])
    manualActive.value = manualActive.value.filter(id => ids.has(id))
    manualSeq.value = Object.fromEntries(Object.entries(manualSeq.value).filter(([id]) => ids.has(id)))
    restSuppressed.value = restSuppressed.value.filter(id => ids.has(id))
    idleActive.value = idleActive.value.filter(id => ids.has(id))
    for (const slot of slotNames) {
      if (leases.value[slot] && !ids.has(leases.value[slot]!.expressionId))
        leases.value[slot] = null
    }
    const remaining = restSet.value.filter(id => ids.has(id))
    if (remaining.length !== restSet.value.length) {
      restSet.value = remaining
      localStorage.setItem(`expression-rest:${modelId.value}`, JSON.stringify({ version: 1, active: remaining }))
    }
  }

  function customDelta(parameterId: string, target: number) {
    const parameter = parameters.value.find(parameter => parameter.id === parameterId)
    if (!parameter || !Number.isFinite(target)) {
      console.warn('[expression-store] Invalid custom expression target:', parameterId, target)
      return
    }
    return Math.max(parameter.min, Math.min(parameter.max, target)) - parameter.default
  }

  function createCustom(input: { label: string, parameterId: string, target: number }) {
    const delta = customDelta(input.parameterId, input.target)
    if (delta === undefined)
      return
    const suggested = suggestKind(input.label, '')
    const kind = suggested === 'face' ? 'unsorted' : suggested
    const id = persistence.createCustom({ label: input.label, parameterId: input.parameterId, delta, kind, mappings: [], exposedToLlm: kind === 'effect' || kind === 'prop' })
    if (id) {
      defineExpressions()
      reconcile()
    }
    return id
  }

  function updateCustom(id: string, patch: Omit<CustomPatch, 'delta'> & { target?: number }) {
    const custom = curated.value.customs?.find(custom => custom.id === id)
    if (!custom)
      return
    const { target, ...fields } = patch
    if (target !== undefined) {
      const delta = customDelta(custom.parameterId, target)
      if (delta === undefined)
        return
      if (!persistence.updateCustom(id, { ...fields, delta }))
        return
    }
    else if (!persistence.updateCustom(id, fields)) {
      return
    }
    defineExpressions()
    reconcile()
  }

  function deleteCustom(id: string) {
    if (persistence.deleteCustom(id)) {
      defineExpressions()
      removeDeletedClaims()
      reconcile()
    }
  }

  function createItem(input: CreateItemInput) {
    const id = persistence.createItem(input)
    if (id)
      reconcile()
    return id
  }

  function updateItem(id: string, patch: ItemPatch) {
    if (persistence.updateItem(id, patch))
      reconcile()
  }

  function deleteItem(id: string) {
    if (persistence.deleteItem(id)) {
      forgetItemStates([id])
      removeDeletedClaims()
      reconcile()
    }
  }

  function forgetItemStates(ids: Iterable<string>) {
    const states = { ...itemStates.value }
    for (const id of ids)
      delete states[id]
    itemStates.value = states
  }

  /**
   * Sets the library assets on this device. `live2dIds` names the ones that are Live2D models, which count against
   * their own cap. An item whose asset leaves keeps its claims, so it shows again when the asset returns.
   */
  function setAvailableItemAssets(ids: ReadonlySet<string>, live2dIds: ReadonlySet<string> = new Set()) {
    availableItemAssets.value = new Set(ids)
    live2dItemAssets.value = new Set(live2dIds)
    reconcile()
  }

  /**
   * Removes deleted library assets from every model's stored documents, then from the loaded model in memory. Run it
   * in the stage window only, which writes expression documents. The loaded model's rest set is pruned in memory
   * first, so a model whose documents were already swept is not written back.
   */
  function removeItemAssets(assetIds: readonly string[]) {
    removeItemsByAsset(assetIds)
    const removed = persistence.forgetItemAssets(assetIds)
    if (removed.size === 0)
      return
    restSet.value = restSet.value.filter(id => !removed.has(id))
    forgetItemStates(removed)
    removeDeletedClaims()
    reconcile()
  }

  /** The scene reports her model canvas after each model load, and null while no model is loaded. */
  function setModelCanvas(canvas: { width: number, height: number } | null) {
    modelCanvas.value = canvas && canvas.width > 0 && canvas.height > 0 ? { ...canvas } : null
  }

  /**
   * Takes the renderer's per-item states, replacing the previous report. An item that turns `failed` after it was
   * admitted is refused `missing-asset` once, never dropped silently; it stays claimed, so the panel shows it failed.
   */
  function reportItemStates(states: Readonly<Record<string, ItemRenderState>>) {
    for (const [id, state] of Object.entries(states)) {
      if (state === 'failed' && itemStates.value[id] !== 'failed')
        refuseItem(id, 'missing-asset')
    }
    itemStates.value = { ...states }
  }

  function createCombo(input: CreateComboInput) {
    const id = persistence.createCombo(input)
    if (id)
      reconcile()
    return id
  }

  function updateCombo(id: string, patch: ComboPatch) {
    if (persistence.updateCombo(id, patch))
      reconcile()
  }

  function deleteCombo(id: string) {
    if (persistence.deleteCombo(id)) {
      removeDeletedClaims()
      reconcile()
    }
  }

  /** Rebuild duplicate ownership after curated keepSeparate changes without reloading the model. */
  function rederive() {
    if (!deriveInputs)
      return
    const { defs, model3Refs, vtube, displayInfo } = deriveInputs
    const keepSeparate = new Set(curated.value.overrides.filter(override => override.keepSeparate === true).map(override => override.id))
    derived.value = deriveCatalog(defs, model3Refs, vtube, displayInfo, keepSeparate)
  }

  function registerDefinitions(id: string, defs: NamedExpressionDefinition[], model3Refs: { File: string, Name?: unknown }[] = [], vtube?: unknown, displayInfo?: unknown, modelParameters: Omit<FreeParameter, 'name'>[] = [], modelFreeParameters: FreeParameter[] = [], hidesArt?: (definition: NamedExpressionDefinition) => boolean) {
    contextPreview.value = []
    modelId.value = id
    parameters.value = modelParameters.map(parameter => ({ ...parameter }))
    freeParameters.value = modelFreeParameters.map(parameter => ({ ...parameter }))
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
    defineExpressions()
    let restSaved = false
    try {
      const raw = localStorage.getItem(`expression-rest:${id}`)
      if (raw !== null) {
        restSaved = true
        const parsed = parseRestSet(JSON.parse(raw))
        if (parsed.success) {
          restSet.value = [...new Set(parsed.value.active.map(activeId => resolveAlias(activeId, catalog.value)))]
            .filter(activeId => catalog.value.some(entry => entry.id === activeId) || curated.value.items?.some(item => item.id === activeId))
        }
        else {
          console.warn('[expression-store] Invalid rest set:', parsed.issues)
        }
      }
    }
    catch (error) {
      console.warn('[expression-store] Failed to load rest set:', errorMessageFrom(error))
    }
    // Until the user saves a resting look, a watermark the rig can switch off starts switched off. Only a switch
    // measured to hide art counts, so a rig whose switch draws its watermark keeps it off.
    if (!restSaved && hidesArt) {
      restSet.value = defs
        .filter(def => catalog.value.some(entry => entry.id === def.id && entry.kind === 'system' && entry.duplicateOf === undefined) && hidesArt(def))
        .map(def => def.id)
    }
    resetAll()
  }

  /**
   * Sets the entries she holds on her own, replacing the previous set, and returns what she holds now. Unknown
   * entries are left out, and so are entries the user already switched on: those stay the user's.
   */
  function setIdleClaims(ids: readonly string[], now = performance.now() / 1000): string[] {
    const requested = [...new Set(ids.map(id => resolveAlias(id, catalog.value)))]
      .filter(id => catalog.value.some(entry => entry.id === id) && !manualActive.value.includes(id))
    // Items past a cap are left out in request order. A refusal is reported when an entry is first left out, not again
    // while the same request repeats.
    const base = claims.value.filter(claim => claim.layer !== 0.5)
    const wanted: string[] = []
    const refused = new Set<string>()
    for (const id of requested) {
      const claim = { expressionId: id, layer: 0.5, seq: idleSeq.value[id] ?? claimSeq + 1 }
      if (exceedsItemLimit([...base, ...wanted.map(expressionId => ({ expressionId, layer: 0.5, seq: idleSeq.value[expressionId] ?? claimSeq + 1 }))], claim)) {
        refused.add(id)
        if (!idleRefused.has(id))
          refuseItem(id, 'item-limit')
        continue
      }
      wanted.push(id)
    }
    idleRefused = refused
    if (wanted.length === idleActive.value.length && wanted.every(id => idleActive.value.includes(id)))
      return idleActive.value
    idleSeq.value = Object.fromEntries(wanted.map(id => [id, idleSeq.value[id] ?? ++claimSeq]))
    idleActive.value = wanted
    reconcile(now)
    return wanted
  }

  /** The user changed her look by hand, so she puts her own things away; whoever set them sees the empty list. */
  function dropIdleClaims() {
    if (idleActive.value.length === 0)
      return
    idleActive.value = []
    idleSeq.value = {}
  }

  function activate(id: string, now = performance.now() / 1000) {
    id = resolveAlias(id, catalog.value)
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry)
      return
    // Switching on drops her own claims first, so they do not count against the caps.
    if (exceedsItemLimit(claims.value.filter(claim => claim.layer !== 0.5), { expressionId: id, layer: 0, seq: claimSeq + 1 })) {
      refuseItem(id, 'item-limit')
      return
    }
    dropIdleClaims()
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
    dropIdleClaims()
    removeBaseClaim(resolveAlias(id, catalog.value))
    reconcile(now)
  }

  function toggle(id: string) {
    id = resolveAlias(id, catalog.value)
    // An entry she holds on her own shows as on, so toggling it takes it away.
    if (manualActive.value.includes(id) || idleActive.value.includes(id))
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
    dropIdleClaims()
    manualActive.value = [...restSet.value]
    manualSeq.value = Object.fromEntries(restSet.value.map(id => [id, ++claimSeq]))
    leases.value = emptyLeases()
    reconcile()
  }

  function dispose() {
    contextPreview.value = []
    composer.restoreBases(() => {})
    definitions.value = []
    parameters.value = []
    freeParameters.value = []
    modelId.value = ''
    restSet.value = []
    manualActive.value = []
    manualSeq.value = {}
    idleActive.value = []
    idleSeq.value = {}
    idleRefused = new Set()
    itemStates.value = {}
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
      case 'create-combo':
        return createCombo(command.combo)
      case 'update-combo':
        return updateCombo(command.id, command.patch)
      case 'delete-combo':
        return deleteCombo(command.id)
      case 'create-custom':
        return createCustom(command.custom)
      case 'update-custom':
        return updateCustom(command.id, command.patch)
      case 'delete-custom':
        return deleteCustom(command.id)
      case 'create-item':
        return createItem(command.item)
      case 'update-item':
        return updateItem(command.id, command.patch)
      case 'delete-item':
        return deleteItem(command.id)
    }
  }

  return { definitions, modelId, restSet, restSuppressed, manualActive, manualSeq, idleActive, setIdleClaims, leases, contextPreview, composer, derived, curated, catalog, llmEligibleEntries, autoEligibleEntries, settingsSnapshot, itemTargets, ownersOf, reconcile, registerDefinitions, rederive, activate, activateFromSlot, releaseSlot, applySlots, onSpeech, setMuted, setSlotSettings, tickLeases, deactivate, toggle, saveDefaults, resetAll, updateEntry, resetEntry, setAvailableItemAssets, removeItemAssets, reportItemStates, setModelCanvas, dispose, applySettingsCommand, onItemRefusal: itemRefusals.on }
})
