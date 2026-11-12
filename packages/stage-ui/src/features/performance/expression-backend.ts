import type { CatalogEntry, SlotCommand } from '@proj-airi/stage-shared/expression-performance'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { useMMDExpressionStore } from '@proj-airi/stage-ui-mmd/stores'

/** Catalog and performer state read by the conductor; commands go through the selected scene. */
export interface StageExpressionBackend {
  readonly catalog: readonly CatalogEntry[]
  readonly modelId: string
  readonly llmEligibleEntries: readonly CatalogEntry[]
  readonly leases: Readonly<Record<SlotCommand['slot'], { expressionId: string } | null>>
  /** The entries the user switched on by hand; present on a store that lets the character use entries on her own. */
  readonly manualActive?: readonly string[]
  /** The entries she holds on her own right now. */
  readonly idleActive?: readonly string[]
  /** Replaces the entries she holds on her own and returns what she holds now. Only Live2D has it. */
  setIdleClaims?: (ids: readonly string[]) => readonly string[]
}

export function useLive2DExpressionBackend(): StageExpressionBackend {
  return useExpressionStore()
}

export function useMMDExpressionBackend(): StageExpressionBackend {
  return useMMDExpressionStore()
}
