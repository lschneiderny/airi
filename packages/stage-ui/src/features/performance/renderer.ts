import type { PerformerCapabilities } from '@proj-airi/character-mind'

import type { StagePerformanceScene } from '../../composables/performance/use-stage-performance-conductor'
import type { StageExpressionBackend } from './expression-backend'

import { NO_CAPABILITIES } from '@proj-airi/character-mind'

interface StagePerformanceRenderer {
  scene: StagePerformanceScene | undefined
  capabilities: PerformerCapabilities
  expressionBackend: StageExpressionBackend | undefined
}

/** Selects the renderer that owns performance dispatch and expression feedback. */
export function selectStagePerformanceRenderer(renderer: string | undefined, live2d: StagePerformanceRenderer, mmd: StagePerformanceRenderer): StagePerformanceRenderer {
  switch (renderer) {
    case 'live2d':
      return live2d
    case 'mmd':
      return mmd
    default:
      return { scene: undefined, capabilities: NO_CAPABILITIES, expressionBackend: undefined }
  }
}
