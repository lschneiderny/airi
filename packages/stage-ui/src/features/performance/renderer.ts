import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import type { StagePerformanceScene } from '../../composables/performance/use-stage-performance-conductor'
import type { StageExpressionBackend } from './expression-backend'

interface StagePerformanceRenderer {
  scene: StagePerformanceScene | undefined
  driver: Live2DMotionDriver
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
      return { scene: undefined, driver: live2d.driver, expressionBackend: undefined }
  }
}
