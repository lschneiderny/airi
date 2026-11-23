import type { CatalogEntry, ComboDocument, CuratedCatalogDocument, CuratedOverride, CustomExpressionDocument, ItemExpressionDocument } from '@proj-airi/stage-shared/expression-performance'
import type { Ref } from 'vue'

import { errorMessageFrom } from '@moeru/std'
import { entrySlots, parseCuratedCatalogDocument, parseRestSet, resolveAlias, validateComboDocument } from '@proj-airi/stage-shared/expression-performance'

export type CreateComboInput = Pick<ComboDocument, 'label' | 'members'> & Partial<Pick<ComboDocument, 'mappings' | 'area'>> & { emotion?: ComboDocument['mappings'][number]['emotion'] }
/** `area: null` clears a stored area so the combo falls back to the area derived from its members. */
export type ComboPatch = Partial<Pick<ComboDocument, 'label' | 'members' | 'mappings' | 'exposedToLlm'>> & { area?: ComboDocument['area'] | null }
/** `area: null` clears a stored area override so the entry falls back to its derived area; an absent key leaves it unchanged. */
export type EntryPatch = Omit<CuratedOverride, 'id' | 'area'> & { area?: CuratedOverride['area'] | null }
/** `area: null` clears a stored custom area so the custom falls back to the area derived from its kind; an absent key leaves it unchanged. */
export type CustomPatch = Partial<Omit<CustomExpressionDocument, 'id' | 'parameterId' | 'area'>> & { area?: CustomExpressionDocument['area'] | null }
/** A new item; `exposedToLlm` defaults to false because its label comes from a file name, and `hides` and `link` take their schema defaults. */
export type CreateItemInput = Omit<ItemExpressionDocument, 'id' | 'exposedToLlm' | 'hides' | 'link'> & Partial<Pick<ItemExpressionDocument, 'exposedToLlm' | 'hides' | 'link'>>
/** `area: null` clears a stored item area; an absent key leaves it unchanged. */
export type ItemPatch = Partial<Omit<ItemExpressionDocument, 'id' | 'area'>> & { area?: ItemExpressionDocument['area'] | null }

/** A model holds at most this many item entries, so its catalog and the panel stay bounded. */
export const MAX_MODEL_ITEMS = 32

const catalogKeyPrefix = 'expression-catalog:'

/** Removes item documents whose asset is gone, and their combo memberships; combos left empty go too. */
function withoutItemAssets(document: CuratedCatalogDocument, assetIds: ReadonlySet<string>) {
  const removedIds = new Set((document.items ?? []).filter(item => assetIds.has(item.assetId)).map(item => item.id))
  if (removedIds.size === 0)
    return { document, removedIds }
  return {
    document: {
      ...document,
      items: document.items!.filter(item => !removedIds.has(item.id)),
      combos: document.combos?.map(combo => ({ ...combo, members: combo.members.filter(member => !removedIds.has(member.expressionId)) }))
        .filter(combo => combo.members.length > 0),
    },
    removedIds,
  }
}

/** The ids of every model with a stored expression catalog, loaded or not. */
function storedCatalogModelIds(): string[] {
  const modelIds: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(catalogKeyPrefix))
      modelIds.push(key.slice(catalogKeyPrefix.length))
  }
  return modelIds
}

/** The stored catalog of a model, loaded or not; `undefined` when there is none or it fails to parse, which the model's own load discards. */
function storedCatalogDocument(modelId: string): CuratedCatalogDocument | undefined {
  try {
    const parsed = parseCuratedCatalogDocument(JSON.parse(localStorage.getItem(`${catalogKeyPrefix}${modelId}`) ?? 'null'))
    return parsed.success ? parsed.value : undefined
  }
  catch {
    return undefined
  }
}

/** How many models place the library asset, so a removal confirmation can name them. */
export function countModelsPlacingAsset(assetId: string): number {
  return storedCatalogModelIds().filter(modelId => storedCatalogDocument(modelId)?.items?.some(item => item.assetId === assetId)).length
}

/**
 * How many items a model's stored catalog holds. The settings window reads it while the expression system is off,
 * because the stage then disposes its store and its snapshot carries no items.
 */
export function countStoredItems(modelId: string): number {
  return modelId ? storedCatalogDocument(modelId)?.items?.length ?? 0 : 0
}

/**
 * Strips the given library assets from the stored expression documents of every model, loaded or not: their item
 * documents, combo members, and rest-set entries. A document that fails to parse is left for its model's load to
 * discard. Returns the removed item ids by model id, so the store can prune the loaded model in memory.
 */
export function removeItemsByAsset(assetIds: readonly string[]): Map<string, Set<string>> {
  const removed = new Map<string, Set<string>>()
  const assets = new Set(assetIds)
  for (const modelId of storedCatalogModelIds()) {
    try {
      const parsed = parseCuratedCatalogDocument(JSON.parse(localStorage.getItem(`expression-catalog:${modelId}`) ?? 'null'))
      if (!parsed.success)
        continue
      const { document, removedIds } = withoutItemAssets(parsed.value, assets)
      if (removedIds.size === 0)
        continue
      localStorage.setItem(`expression-catalog:${modelId}`, JSON.stringify(document))
      removed.set(modelId, removedIds)
      const rest = parseRestSet(JSON.parse(localStorage.getItem(`expression-rest:${modelId}`) ?? 'null'))
      if (rest.success && rest.value.active.some(id => removedIds.has(id)))
        localStorage.setItem(`expression-rest:${modelId}`, JSON.stringify({ version: 1, active: rest.value.active.filter(id => !removedIds.has(id)) }))
    }
    catch (error) {
      console.warn('[expression-store] Failed to remove deleted item assets:', modelId, errorMessageFrom(error))
    }
  }
  return removed
}

/** Removes a model's expression documents. Its display model is deleted, so it is not on stage and nothing holds them in memory. */
export function removeExpressionDocuments(modelId: string) {
  localStorage.removeItem(`expression-catalog:${modelId}`)
  localStorage.removeItem(`expression-rest:${modelId}`)
}

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
    if (id.startsWith('combo:') || id.startsWith('custom:') || id.startsWith('item:')) {
      console.warn('[expression-store] Use the combo, custom, or item command:', id)
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
    const { area, ...rest } = patch
    return write({
      ...curated.value,
      customs: curated.value.customs.map((custom) => {
        if (custom.id !== id)
          return custom
        const merged = { ...custom, ...rest, id }
        if (area === null)
          delete merged.area
        else if (area)
          merged.area = area
        return merged
      }),
    })
  }

  function deleteCustom(id: string) {
    return write({
      ...curated.value,
      customs: (curated.value.customs ?? []).filter(custom => custom.id !== id),
      combos: curated.value.combos?.map(combo => ({ ...combo, members: combo.members.filter(member => member.expressionId !== id) }))
        .filter(combo => combo.members.length > 0),
    })
  }

  /** Returns the new id, or undefined when the document is invalid or the model already holds {@link MAX_MODEL_ITEMS} items. */
  function createItem(input: CreateItemInput) {
    if ((curated.value.items?.length ?? 0) >= MAX_MODEL_ITEMS) {
      console.warn(`[expression-store] Item refused: a model holds at most ${MAX_MODEL_ITEMS} items.`)
      return
    }
    const id = `item:${crypto.randomUUID()}`
    if (write({ ...curated.value, items: [...curated.value.items ?? [], { exposedToLlm: false, hides: [], link: 'none', ...input, id }] }))
      return id
  }

  function updateItem(id: string, patch: ItemPatch) {
    if (!curated.value.items?.some(item => item.id === id))
      return
    const { area, ...rest } = patch
    return write({
      ...curated.value,
      items: curated.value.items.map((item) => {
        if (item.id !== id)
          return item
        const merged = { ...item, ...rest, id }
        if (area === null)
          delete merged.area
        else if (area)
          merged.area = area
        return merged
      }),
    })
  }

  function deleteItem(id: string) {
    if (!curated.value.items?.some(item => item.id === id))
      return
    return write({
      ...curated.value,
      items: curated.value.items.filter(item => item.id !== id),
      combos: curated.value.combos?.map(combo => ({ ...combo, members: combo.members.filter(member => member.expressionId !== id) }))
        .filter(combo => combo.members.length > 0),
    })
  }

  /** Drops the given assets' items from the loaded document in memory only; {@link removeItemsByAsset} already rewrote storage. */
  function forgetItemAssets(assetIds: readonly string[]) {
    const { document, removedIds } = withoutItemAssets(curated.value, new Set(assetIds))
    curated.value = document
    return removedIds
  }

  return { persistCurated, updateEntry, resetEntry, createCombo, updateCombo, deleteCombo, createCustom, updateCustom, deleteCustom, createItem, updateItem, deleteItem, forgetItemAssets }
}
