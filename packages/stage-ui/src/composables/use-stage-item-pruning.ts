import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import { useStageItemLibraryStore } from '../stores/stage-item-library'

/**
 * Removes deleted library assets from the Live2D expression documents: every model's stored items, combo members, and
 * rest sets, and the loaded model's live claims. Call it once in the stage window, which writes expression documents;
 * the library reports removals from this window and from every other window. Returns the unsubscribe.
 */
export function useStageItemPruning() {
  const expressions = useExpressionStore()
  return useStageItemLibraryStore().onAssetsRemoved(ids => expressions.removeItemAssets(ids)).off
}
