import type { CatalogEntry, SlotCommand } from '@proj-airi/stage-shared/expression-performance'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'

/** Catalog and performer state read by the conductor; commands go through the selected scene. */
export interface StageExpressionBackend {
  readonly catalog: readonly CatalogEntry[]
  readonly modelId: string
  readonly llmEligibleEntries: readonly CatalogEntry[]
  readonly leases: Readonly<Record<SlotCommand['slot'], { expressionId: string } | null>>
}

export function useLive2DExpressionBackend(): StageExpressionBackend {
  return useExpressionStore()
}
