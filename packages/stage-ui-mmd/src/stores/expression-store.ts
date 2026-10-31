import type { CatalogEntry, ComboDocument, CuratedCatalogDocument, CuratedOverride, SlotCommand } from '@proj-airi/stage-shared/expression-performance'

import type { MorphLayer } from '../composables/mmd/morph-runtime'
import type { PmxMorphInfo } from '../utils/expression-catalog/derive'
import type { SlotLeases, SlotLeaseSettings, SlotName, SpeechEvent } from './expression-slots'

import { errorMessageFrom } from '@moeru/std'
import { defaultExpressionPerformanceSettings, entrySlots, expandEntry, isAutoEligible, isLlmEligible, mergeCatalog, parseCuratedCatalogDocument, parseRestSet, resolveAlias, validateComboDocument } from '@proj-airi/stage-shared/expression-performance'
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { deriveMMDCatalog } from '../utils/expression-catalog/derive'
import { applySpeechEvent, createLease, emptyLeases, ExpressionFader, leaseReleaseAt, slotNames, speechEvents } from './expression-slots'

/** The morph-runtime seam this store writes; `createMMDMorphRuntime(mmd)` satisfies it. */
export interface ExpressionMorphSink {
  setChannel: (layer: MorphLayer, morphName: string, weight: number) => void
  clearChannel: (layer: MorphLayer, morphName: string) => void
}

export type CreateComboInput = Pick<ComboDocument, 'label' | 'members'> & Partial<Pick<ComboDocument, 'mappings' | 'area'>> & { emotion?: ComboDocument['mappings'][number]['emotion'] }
/** `area: null` clears a stored area; an absent key leaves it unchanged. */
export type ComboPatch = Partial<Pick<ComboDocument, 'label' | 'members' | 'mappings' | 'exposedToLlm'>> & { area?: ComboDocument['area'] | null }
/** `area: null` clears a stored area override; an absent key leaves it unchanged. */
export type EntryPatch = Omit<CuratedOverride, 'id' | 'area'> & { area?: CuratedOverride['area'] | null }

export interface ExpressionPanelEntry extends CatalogEntry {
  name: string
  active: boolean
  effective: boolean
  overriddenBy: string | null
  via: string[]
  isDefault: boolean
}

/** Renderer-neutral expression panel state; other windows read it and send `ExpressionPanelCommand`s back. */
export interface ExpressionPanelSnapshot {
  modelId: string
  entries: ExpressionPanelEntry[]
  groups: { id: string, memberIds: string[] }[]
  activeIds: string[]
  restIds: string[]
}

export type ExpressionPanelCommand
  = | { type: 'toggle', id: string }
    | { type: 'save-defaults' }
    | { type: 'reset-all' }
    | { type: 'update-entry', id: string, patch: EntryPatch }
    | { type: 'reset-entry', id: string }
    | { type: 'set-active', id: string, active: boolean }
    | { type: 'create-combo', combo: CreateComboInput }
    | { type: 'update-combo', id: string, patch: ComboPatch }
    | { type: 'delete-combo', id: string }

interface Claim {
  expressionId: string
  layer: number
  seq: number
}

/** Later and higher-layer claims own a group; masked members keep their claims for when the owner releases. */
function resolveClaims(claims: readonly Claim[], catalog: readonly CatalogEntry[]) {
  const ordered = [...claims].sort((a, b) => b.layer - a.layer || b.seq - a.seq)
  const holder = new Map<string, { memberId: string, triggerId: string }>()
  const weights = new Map<string, number>()
  const masked = new Map<string, string>()
  const effective = new Set<string>()
  const via = new Map<string, string[]>()
  for (const claim of ordered) {
    const entry = catalog.find(candidate => candidate.id === claim.expressionId)
    if (!entry)
      continue
    for (const { expressionId, strength } of expandEntry(entry, catalog)) {
      const member = catalog.find(candidate => candidate.id === expressionId)!
      const held = member.group === null ? undefined : holder.get(member.group)
      if (held && held.memberId !== expressionId) {
        masked.set(expressionId, held.triggerId)
        continue
      }
      if (member.group !== null)
        holder.set(member.group, { memberId: expressionId, triggerId: held?.triggerId ?? entry.id })
      weights.set(expressionId, Math.max(weights.get(expressionId) ?? 0, strength))
      effective.add(expressionId)
      effective.add(entry.id)
      if (entry.kind === 'combo')
        via.set(expressionId, [...new Set([...via.get(expressionId) ?? [], entry.id])])
    }
  }
  return { targets: [...weights].map(([id, weight]) => ({ id, weight })), masked, effective, via }
}

/** Local to the renderer that owns the MMD model; other windows use snapshots and commands. */
export const useMMDExpressionStore = defineStore('mmd-expressions', () => {
  const modelId = ref('')
  const derived = ref<CatalogEntry[]>([])
  const curated = ref<CuratedCatalogDocument>({ version: 1, overrides: [] })
  const catalog = computed(() => mergeCatalog(derived.value, curated.value))
  const llmEligibleEntries = computed(() => catalog.value.filter(isLlmEligible))
  const autoEligibleEntries = computed(() => catalog.value.filter(isAutoEligible))
  const restSet = ref<string[]>([])
  const manualActive = ref<string[]>([])
  const manualSeq = ref<Record<string, number>>({})
  const leases = ref<SlotLeases>(emptyLeases())
  const muted = ref(false)
  const slotSettings = ref<SlotLeaseSettings>({ ...defaultExpressionPerformanceSettings.slots })
  const fader = markRaw(new ExpressionFader())
  fader.fadeSeconds = defaultExpressionPerformanceSettings.slots.defaultFadeSeconds
  let sink: ExpressionMorphSink | null = null
  const written = new Map<string, number>()
  const warnedUnknown = new Set<string>()
  let claimSeq = 0

  const claims = computed<Claim[]>(() => [
    ...manualActive.value.map(expressionId => ({ expressionId, layer: 0, seq: manualSeq.value[expressionId] })),
    ...slotNames.flatMap(slot => leases.value[slot] ? [{ expressionId: leases.value[slot]!.expressionId, layer: 1, seq: leases.value[slot]!.claimSequence }] : []),
  ])
  const resolved = computed(() => resolveClaims(claims.value, catalog.value))

  function isActive(id: string) {
    return manualActive.value.includes(id) || slotNames.some(slot => leases.value[slot]?.expressionId === id)
  }

  /** Unknown ids come from LLM output and settings windows; each one is reported once per model. */
  function findEntry(id: string): CatalogEntry | undefined {
    const entry = catalog.value.find(candidate => candidate.id === resolveAlias(id, catalog.value))
    if (!entry && !warnedUnknown.has(id)) {
      warnedUnknown.add(id)
      console.warn('[mmd-expression-store] Unknown expression ignored:', id)
    }
    return entry
  }

  function reconcile(now: number) {
    fader.setTargets(resolved.value.targets, now)
  }

  /** Writes changed morph weights into the morph-runtime expression layer; finished releases clear their channel. */
  function writeChannels(now: number) {
    const morphWeights = new Map<string, number>()
    for (const [id, weight] of fader.sample(now)) {
      const entry = catalog.value.find(candidate => candidate.id === id)
      if (!entry || weight === 0)
        continue
      for (const morphName of entry.parameterIds)
        morphWeights.set(morphName, Math.max(morphWeights.get(morphName) ?? 0, weight))
    }
    for (const morphName of written.keys()) {
      if (!morphWeights.has(morphName)) {
        sink?.clearChannel('expression', morphName)
        written.delete(morphName)
      }
    }
    for (const [morphName, weight] of morphWeights) {
      if (written.get(morphName) !== weight) {
        sink?.setChannel('expression', morphName, weight)
        written.set(morphName, weight)
      }
    }
  }

  function releaseSlot(slot: SlotName) {
    const lease = leases.value[slot]
    if (!lease)
      return
    const next = { ...leases.value }
    for (const other of slotNames) {
      if (next[other]?.expressionId === lease.expressionId)
        next[other] = null
    }
    leases.value = next
  }

  function expireLeases(now: number) {
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (lease && now >= leaseReleaseAt(lease, muted.value, slotSettings.value))
        releaseSlot(slot)
    }
  }

  /** Executes decider output; invalid commands are dropped, never partially applied. */
  function applySlots(commands: readonly SlotCommand[], now = performance.now() / 1000) {
    if (!Number.isFinite(now))
      return
    for (const command of commands) {
      if (!slotNames.includes(command.slot)) {
        console.warn('[mmd-expression-store] Unknown slot dropped:', command.slot)
        continue
      }
      if (command.expressionId === null) {
        releaseSlot(command.slot)
        continue
      }
      if (!Number.isFinite(command.holdSeconds) || command.holdSeconds < 0 || (command.until !== 'speech' && command.until !== 'hold')) {
        console.warn('[mmd-expression-store] Slot command with invalid lifetime dropped:', command.expressionId)
        continue
      }
      const entry = findEntry(command.expressionId)
      if (!entry || !entrySlots(entry, catalog.value).includes(command.slot))
        continue
      if (leases.value[command.slot]?.expressionId !== entry.id)
        releaseSlot(command.slot)
      leases.value = { ...leases.value, [command.slot]: createLease(entry.id, command, now, ++claimSeq) }
    }
    reconcile(now)
  }

  /** Only leases of the same turn react; leases without a turn follow their hold rule. */
  function onSpeech(event: SpeechEvent, turnId: string, now = performance.now() / 1000) {
    if (!Number.isFinite(now) || !speechEvents.includes(event))
      return
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (!lease || lease.turnId === null || lease.turnId !== turnId)
        continue
      const next = applySpeechEvent(lease, event, now, muted.value, slotSettings.value)
      if (next === null)
        releaseSlot(slot)
      else
        leases.value = { ...leases.value, [slot]: next }
    }
    expireLeases(now)
    reconcile(now)
  }

  function setMuted(value: boolean) {
    muted.value = value
  }

  function setSlotSettings(settings: SlotLeaseSettings & { defaultFadeSeconds: number }) {
    slotSettings.value = { speechGrace: settings.speechGrace, unstartedExpiry: settings.unstartedExpiry, holdCap: settings.holdCap }
    fader.fadeSeconds = settings.defaultFadeSeconds
  }

  function tickLeases(now: number) {
    if (!Number.isFinite(now))
      return
    expireLeases(now)
    reconcile(now)
  }

  /** Per-frame entry point: expires leases, advances fades and writes the expression layer. */
  function update(now: number) {
    if (!Number.isFinite(now))
      return
    tickLeases(now)
    writeChannels(now)
  }

  function persistCurated(document: CuratedCatalogDocument): boolean {
    const parsed = parseCuratedCatalogDocument(document)
    if (!parsed.success) {
      console.warn('[mmd-expression-store] Invalid catalog command:', parsed.issues)
      return false
    }
    curated.value = parsed.value
    if (modelId.value)
      localStorage.setItem(`expression-catalog:${modelId.value}`, JSON.stringify(parsed.value))
    return true
  }

  function persistRestSet() {
    try {
      localStorage.setItem(`expression-rest:${modelId.value}`, JSON.stringify({ version: 1, active: restSet.value }))
    }
    catch (error) {
      console.warn('[mmd-expression-store] Failed to save rest set:', errorMessageFrom(error))
    }
  }

  function loadCurated(id: string) {
    curated.value = { version: 1, overrides: [] }
    try {
      const raw = localStorage.getItem(`expression-catalog:${id}`)
      if (raw === null)
        return
      const parsed = parseCuratedCatalogDocument(JSON.parse(raw))
      if (!parsed.success)
        throw new Error(JSON.stringify(parsed.issues))
      curated.value = parsed.value
    }
    catch (error) {
      console.warn('[mmd-expression-store] Invalid curated catalog discarded:', errorMessageFrom(error))
    }
  }

  function loadRestSet(id: string) {
    restSet.value = []
    try {
      const raw = localStorage.getItem(`expression-rest:${id}`)
      if (raw === null)
        return
      const parsed = parseRestSet(JSON.parse(raw))
      if (!parsed.success) {
        console.warn('[mmd-expression-store] Invalid rest set:', parsed.issues)
        return
      }
      restSet.value = [...new Set(parsed.value.active.map(activeId => resolveAlias(activeId, catalog.value)))]
        .filter(activeId => catalog.value.some(entry => entry.id === activeId))
    }
    catch (error) {
      console.warn('[mmd-expression-store] Failed to load rest set:', errorMessageFrom(error))
    }
  }

  /** Clears the channels this store wrote so a reload never leaves a morph held by the expression layer. */
  function clearWritten() {
    for (const morphName of written.keys())
      sink?.clearChannel('expression', morphName)
    written.clear()
    fader.clear()
  }

  function registerMorphs(id: string, morphs: readonly PmxMorphInfo[], morphSink: ExpressionMorphSink | null = null, now = performance.now() / 1000) {
    clearWritten()
    sink = morphSink ? markRaw(morphSink) : null
    modelId.value = id
    warnedUnknown.clear()
    leases.value = emptyLeases()
    loadCurated(id)
    derived.value = deriveMMDCatalog(morphs)
    loadRestSet(id)
    resetAll(now)
  }

  function activate(id: string, now = performance.now() / 1000) {
    const entry = findEntry(id)
    if (!entry)
      return
    if (entry.kind !== 'combo' && entry.group !== null)
      manualActive.value = manualActive.value.filter(other => catalog.value.find(candidate => candidate.id === other)?.group !== entry.group)
    manualSeq.value = { ...manualSeq.value, [entry.id]: ++claimSeq }
    if (!manualActive.value.includes(entry.id))
      manualActive.value = [...manualActive.value, entry.id]
    reconcile(now)
  }

  function deactivate(id: string, now = performance.now() / 1000) {
    const resolvedId = resolveAlias(id, catalog.value)
    manualActive.value = manualActive.value.filter(activeId => activeId !== resolvedId)
    manualSeq.value = Object.fromEntries(Object.entries(manualSeq.value).filter(([key]) => key !== resolvedId))
    reconcile(now)
  }

  function toggle(id: string) {
    const resolvedId = resolveAlias(id, catalog.value)
    if (manualActive.value.includes(resolvedId))
      deactivate(resolvedId)
    else
      activate(resolvedId)
  }

  function saveDefaults() {
    if (!modelId.value)
      return
    restSet.value = [...manualActive.value].sort((a, b) => manualSeq.value[a] - manualSeq.value[b])
    persistRestSet()
  }

  function resetAll(now = performance.now() / 1000) {
    manualActive.value = [...restSet.value]
    manualSeq.value = Object.fromEntries(restSet.value.map(id => [id, ++claimSeq]))
    leases.value = emptyLeases()
    reconcile(now)
  }

  function removeDeletedClaims() {
    const ids = new Set(catalog.value.map(entry => entry.id))
    manualActive.value = manualActive.value.filter(id => ids.has(id))
    for (const slot of slotNames) {
      if (leases.value[slot] && !ids.has(leases.value[slot]!.expressionId))
        releaseSlot(slot)
    }
    const remaining = restSet.value.filter(id => ids.has(id))
    if (remaining.length !== restSet.value.length) {
      restSet.value = remaining
      persistRestSet()
    }
  }

  function updateEntry(id: string, patch: EntryPatch) {
    if (!derived.value.some(entry => entry.id === id)) {
      findEntry(id)
      return
    }
    const previous = curated.value.overrides.find(entry => entry.id === id)
    const { area, ...fields } = patch
    const merged: CuratedOverride = { ...previous, ...fields, id }
    if (area === null)
      delete merged.area
    else if (area)
      merged.area = area
    persistCurated({ ...curated.value, overrides: [...curated.value.overrides.filter(entry => entry.id !== id), merged] })
    reconcile(performance.now() / 1000)
  }

  function resetEntry(id: string) {
    persistCurated({ ...curated.value, overrides: curated.value.overrides.filter(entry => entry.id !== id) })
    reconcile(performance.now() / 1000)
  }

  function checkedCombo(document: ComboDocument): ComboDocument | undefined {
    const parsed = parseCuratedCatalogDocument({ version: 1, overrides: [], combos: [document] })
    if (!parsed.success) {
      console.warn('[mmd-expression-store] Invalid combo:', parsed.issues)
      return
    }
    const combo = parsed.value.combos![0]
    combo.members = combo.members.map(member => ({ ...member, expressionId: resolveAlias(member.expressionId, catalog.value) }))
    const validation = validateComboDocument(combo, catalog.value)
    if (!validation.success) {
      console.warn('[mmd-expression-store] Invalid combo:', validation.error)
      return
    }
    return combo
  }

  function createCombo(input: CreateComboInput) {
    const id = `combo:${crypto.randomUUID()}`
    const document = checkedCombo({
      id,
      label: input.label,
      members: input.members,
      mappings: input.mappings ?? (input.emotion ? [{ emotion: input.emotion, weight: 1, minBand: 'clear' }] : []),
      exposedToLlm: false,
      ...(input.area ? { area: input.area } : {}),
    })
    if (!document)
      return
    document.exposedToLlm = entrySlots({ ...document, kind: 'combo', mappings: [], group: null, confirmed: true, fileName: '', parameterIds: [] }, catalog.value).length > 0
    if (persistCurated({ ...curated.value, combos: [...curated.value.combos ?? [], document] }))
      return id
  }

  function updateCombo(id: string, patch: ComboPatch) {
    const previous = curated.value.combos?.find(combo => combo.id === id)
    if (!previous) {
      findEntry(id)
      return
    }
    const { area, ...fields } = patch
    const merged: ComboDocument = { ...previous, ...fields, id }
    if (area === null)
      delete merged.area
    else if (area)
      merged.area = area
    const document = checkedCombo(merged)
    if (document && persistCurated({ ...curated.value, combos: curated.value.combos!.map(combo => combo.id === id ? document : combo) }))
      reconcile(performance.now() / 1000)
  }

  function deleteCombo(id: string) {
    if (persistCurated({ ...curated.value, combos: (curated.value.combos ?? []).filter(combo => combo.id !== id) })) {
      removeDeletedClaims()
      reconcile(performance.now() / 1000)
    }
  }

  const settingsSnapshot = computed<ExpressionPanelSnapshot>(() => {
    const groups = new Map<string, string[]>()
    for (const entry of catalog.value) {
      if (entry.group !== null)
        groups.set(entry.group, [...groups.get(entry.group) ?? [], entry.id])
    }
    return {
      modelId: modelId.value,
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
      })),
      groups: [...groups].map(([id, memberIds]) => ({ id, memberIds })),
      activeIds: catalog.value.filter(entry => isActive(entry.id)).map(entry => entry.id),
      restIds: [...restSet.value],
    }
  })

  function applySettingsCommand(command: ExpressionPanelCommand) {
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
    }
  }

  function dispose() {
    clearWritten()
    sink = null
    modelId.value = ''
    derived.value = []
    curated.value = { version: 1, overrides: [] }
    restSet.value = []
    manualActive.value = []
    manualSeq.value = {}
    leases.value = emptyLeases()
    warnedUnknown.clear()
    claimSeq = 0
  }

  return { modelId, derived, curated, catalog, llmEligibleEntries, autoEligibleEntries, restSet, manualActive, leases, settingsSnapshot, registerMorphs, activate, deactivate, toggle, saveDefaults, resetAll, updateEntry, resetEntry, createCombo, updateCombo, deleteCombo, applySlots, releaseSlot, onSpeech, setMuted, setSlotSettings, tickLeases, update, applySettingsCommand, dispose }
})
