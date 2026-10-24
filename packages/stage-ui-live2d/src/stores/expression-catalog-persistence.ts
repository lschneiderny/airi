import type { CatalogEntry, CuratedCatalogDocument, CuratedOverride } from '@proj-airi/stage-shared/expression-performance'
import type { Ref } from 'vue'

import { parseCuratedCatalogDocument } from '@proj-airi/stage-shared/expression-performance'

export interface CatalogPersistenceContext {
  modelId: Ref<string>
  derived: Ref<CatalogEntry[]>
  curated: Ref<CuratedCatalogDocument>
}

export function createCatalogPersistence(context: CatalogPersistenceContext) {
  const { modelId, derived, curated } = context

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

  return { persistCurated, updateEntry, resetEntry }
}
