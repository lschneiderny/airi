import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type {} from 'pinia-plugin-synced'

import { isEqual } from 'es-toolkit'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type MappedExpressionEntry = Pick<CatalogEntry, 'id' | 'label' | 'mappings'>

/** The stage's loaded display model, without renderer assets or performance-profile multipliers. */
export interface LoadedExpressionCatalog {
  modelId: string
  entries: MappedExpressionEntry[]
}

/**
 * Tier 5 runtime memory, never persisted. The stage conductor publishes the local renderer's catalog;
 * card editors in every window read it. Reader windows never publish received snapshots.
 */
export const useStageExpressionCatalogStore = defineStore('stage-expression-catalog', () => {
  const snapshot = ref<LoadedExpressionCatalog | null>(null)

  /**
   * Copies only mapped entries. Stage item entries stay out: their ids name files in this device's item library, so a
   * card that carried them would not work on another device. Repeated publications do not send synchronization proposals.
   */
  function publish(modelId: string, catalog: readonly CatalogEntry[]) {
    const next: LoadedExpressionCatalog | null = modelId
      ? {
          modelId,
          entries: catalog.filter(entry => entry.mappings.length > 0 && !entry.id.startsWith('item:')).map(entry => ({
            id: entry.id,
            label: entry.label,
            mappings: entry.mappings.map(mapping => ({ ...mapping })),
          })),
        }
      : null
    if (!isEqual(snapshot.value, next))
      snapshot.value = next
  }

  /** A retiring stage must not clear a different model that a replacement stage already published. */
  function clear(modelId: string) {
    if (snapshot.value?.modelId === modelId)
      snapshot.value = null
  }

  return { snapshot, publish, clear }
}, {
  synced: { state: true },
})
