import type { ItemRenderState } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DStageItem } from '@proj-airi/stage-ui-live2d/composables/live2d/items/layer'

import { errorMessageFrom } from '@moeru/std'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { useStageItemLibraryStore } from '../stores/stage-item-library'

/**
 * The stage items a Live2D scene of this window draws: the shown item entries of the window's Live2D expression store,
 * each with an object URL of its library file. It also tells the store which library assets exist, so an item whose
 * asset is gone is refused `missing-asset`, and it hands the scene's render states back to the store.
 *
 * Object URLs are owned here, one per shown asset. A URL is revoked as soon as no shown item needs its asset (the item
 * hides, the asset leaves the library, the model swaps, or `active` turns false) and when the calling scope ends.
 */
export function useLive2DStageItems(options: { active: () => boolean }) {
  const library = useStageItemLibraryStore()
  const expressions = useExpressionStore()
  /** Object URLs by asset id; replaced, never mutated, so `items` recomputes. */
  const urls = shallowRef<ReadonlyMap<string, string>>(new Map())
  const loading = new Set<string>()
  let disposed = false

  watch(() => library.assets, (assets) => {
    expressions.setAvailableItemAssets(
      new Set(assets.map(asset => asset.id)),
      new Set(assets.filter(asset => asset.format === 'live2d-zip').map(asset => asset.id)),
    )
  }, { immediate: true })

  const shownTargets = computed(() => options.active() ? expressions.itemTargets : [])
  const neededAssets = computed(() => new Set(shownTargets.value.map(target => target.document.assetId)))

  async function load(assetId: string) {
    loading.add(assetId)
    try {
      const blob = await library.blobOf(assetId)
      // The item may have hidden, or the scope ended, while the file was read.
      if (disposed || !neededAssets.value.has(assetId))
        return
      if (!blob) {
        console.warn('[stage-items] The library lists an asset without its file:', assetId)
        return
      }
      urls.value = new Map([...urls.value, [assetId, URL.createObjectURL(blob)]])
    }
    catch (error) {
      console.warn('[stage-items] Failed to read an item file:', assetId, errorMessageFrom(error))
    }
    finally {
      loading.delete(assetId)
    }
  }

  watch(neededAssets, (needed) => {
    const kept = new Map<string, string>()
    for (const [assetId, url] of urls.value) {
      if (needed.has(assetId))
        kept.set(assetId, url)
      else
        URL.revokeObjectURL(url)
    }
    if (kept.size !== urls.value.size)
      urls.value = kept
    for (const assetId of needed) {
      if (!kept.has(assetId) && !loading.has(assetId))
        void load(assetId)
    }
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    disposed = true
    for (const url of urls.value.values())
      URL.revokeObjectURL(url)
    urls.value = new Map()
  })

  /** In catalog order; an item waits here until its file's URL exists. */
  const items = computed<Live2DStageItem[]>(() => {
    const formats = new Map(library.assets.map(asset => [asset.id, asset.format]))
    return shownTargets.value.flatMap(({ document }) => {
      const url = urls.value.get(document.assetId)
      const format = formats.get(document.assetId)
      return url && format ? [{ document, url, format }] : []
    })
  })

  return {
    items,
    reportStates: (states: Readonly<Record<string, ItemRenderState>>) => expressions.reportItemStates(states),
  }
}
