import type { CatalogEntry, ComboDocument, CuratedCatalogDocument, CuratedOverride, CustomExpressionDocument } from '@proj-airi/stage-shared/expression-performance'
import type { Ref } from 'vue'

import { entrySlots, parseCuratedCatalogDocument, resolveAlias, validateComboDocument } from '@proj-airi/stage-shared/expression-performance'

export type CreateComboInput = Pick<ComboDocument, 'label' | 'members'> & Partial<Pick<ComboDocument, 'mappings' | 'area'>> & { emotion?: ComboDocument['mappings'][number]['emotion'] }
/** `area: null` clears a stored area so the combo falls back to the area derived from its members. */
export type ComboPatch = Partial<Pick<ComboDocument, 'label' | 'members' | 'mappings' | 'exposedToLlm'>> & { area?: ComboDocument['area'] | null }
/** `area: null` clears a stored area override so the entry falls back to its derived area; an absent key leaves it unchanged. */
export type EntryPatch = Omit<CuratedOverride, 'id' | 'area'> & { area?: CuratedOverride['area'] | null }
export type CustomPatch = Partial<Omit<CustomExpressionDocument, 'id' | 'parameterId'>>

export interface CatalogPersistenceContext {
  modelId: Ref<string>
  derived: Ref<CatalogEntry[]>
  curated: Ref<CuratedCatalogDocument>
  catalog: Readonly<Ref<CatalogEntry[]>>
}

export function createCatalogPersistence(context: CatalogPersistenceContext) {
  const { modelId, derived, curated, catalog } = context

  function persistCurated(document: unknown) {
    const parsed = parseCuratedCatalogDocument(document)
    if (!parsed.success)
      throw new Error(JSON.stringify(parsed.issues))
    if (!modelId.value)
      return
    localStorage.setItem(`expression-catalog:${modelId.value}`, JSON.stringify(parsed.value))
    curated.value = parsed.value
  }

  function updateEntry(id: string, patch: EntryPatch) {
    if (id.startsWith('combo:') || id.startsWith('custom:')) {
      console.warn('[expression-store] Use the combo or custom command:', id)
      return
    }
    if (!derived.value.some(entry => entry.id === id))
      throw new Error(`Unknown expression: ${id}`)
    const previous = curated.value.overrides.find(entry => entry.id === id)
    const { area, ...rest } = patch
    const merged: CuratedOverride = { ...previous, ...rest, id }
    if (area === null)
      delete merged.area
    else if (area)
      merged.area = area
    persistCurated({ ...curated.value, overrides: [
      ...curated.value.overrides.filter(entry => entry.id !== id),
      merged,
    ] })
  }

  function resetEntry(id: string) {
    persistCurated({ ...curated.value, overrides: curated.value.overrides.filter(entry => entry.id !== id) })
  }

  /** Commands are an untrusted settings-window boundary; malformed documents leave storage intact. */
  function write(document: CuratedCatalogDocument) {
    const parsed = parseCuratedCatalogDocument(document)
    if (!parsed.success) {
      console.warn('[expression-store] Invalid catalog command:', parsed.issues)
      return false
    }
    persistCurated(parsed.value)
    return true
  }

  function checkedCombo(document: ComboDocument) {
    const parsed = parseCuratedCatalogDocument({ version: 1, overrides: [], combos: [document] })
    if (!parsed.success) {
      console.warn('[expression-store] Invalid combo:', parsed.issues)
      return
    }
    const combo = parsed.value.combos![0]
    combo.members = combo.members.map(member => ({ ...member, expressionId: resolveAlias(member.expressionId, catalog.value) }))
    const validation = validateComboDocument(combo, catalog.value)
    if (!validation.success) {
      console.warn('[expression-store] Invalid combo:', validation.error)
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
    if (write({ ...curated.value, combos: [...curated.value.combos ?? [], document] }))
      return id
  }

  function updateCombo(id: string, patch: ComboPatch) {
    const previous = curated.value.combos?.find(combo => combo.id === id)
    if (!previous)
      return
    const { area, ...rest } = patch
    const merged = { ...previous, ...rest, id }
    if (area === null)
      delete merged.area
    else if (area)
      merged.area = area
    const document = checkedCombo(merged)
    if (document)
      return write({ ...curated.value, combos: curated.value.combos!.map(combo => combo.id === id ? document : combo) })
  }

  function deleteCombo(id: string) {
    return write({ ...curated.value, combos: (curated.value.combos ?? []).filter(combo => combo.id !== id) })
  }

  function createCustom(input: Omit<CustomExpressionDocument, 'id'>) {
    const id = `custom:${crypto.randomUUID()}`
    if (write({ ...curated.value, customs: [...curated.value.customs ?? [], { ...input, id }] }))
      return id
  }

  function updateCustom(id: string, patch: CustomPatch) {
    if (!curated.value.customs?.some(custom => custom.id === id))
      return
    return write({ ...curated.value, customs: curated.value.customs.map(custom => custom.id === id ? { ...custom, ...patch, id } : custom) })
  }

  function deleteCustom(id: string) {
    return write({
      ...curated.value,
      customs: (curated.value.customs ?? []).filter(custom => custom.id !== id),
      combos: curated.value.combos?.map(combo => ({ ...combo, members: combo.members.filter(member => member.expressionId !== id) }))
        .filter(combo => combo.members.length > 0),
    })
  }

  return { persistCurated, updateEntry, resetEntry, createCombo, updateCombo, deleteCombo, createCustom, updateCustom, deleteCustom }
}
