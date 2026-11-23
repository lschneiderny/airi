import type { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { useMMDExpressionStore } from '@proj-airi/stage-ui-mmd/stores'
import type { ModelSettingsRuntimePhase, ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import type { StageModelRenderer } from '@proj-airi/stage-ui/stores/settings/stage-model'

import {
  createEmptyModelSettingsRuntimeSnapshot,
  resolveComponentStateToRuntimePhase,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

export interface MainStageModelSettingsSnapshotInput {
  ownerInstanceId: string
  renderer: StageModelRenderer
  hasModel: boolean
  componentState: 'pending' | 'loading' | 'mounted'
  scenePhase: ModelSettingsRuntimePhase
  sceneMutationLocked: boolean
  live2dExpressionStore: Pick<ReturnType<typeof useExpressionStore>, 'modelId' | 'settingsSnapshot'>
  mmdExpressionStore: Pick<ReturnType<typeof useMMDExpressionStore>, 'modelId' | 'settingsSnapshot'>
}

/**
 * Builds the model-settings runtime snapshot of the main stage page.
 *
 * The settings window has its own Pinia stores, so a renderer's expression panel is live only when this snapshot
 * carries the stage's model ID and expression state for that renderer.
 */
export function createMainStageModelSettingsSnapshot(input: MainStageModelSettingsSnapshotInput): ModelSettingsRuntimeSnapshot {
  const { ownerInstanceId, renderer, hasModel } = input

  if (renderer === 'vrm') {
    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId,
      renderer,
      phase: hasModel ? input.scenePhase : 'no-model',
      controlsLocked: hasModel ? (input.componentState !== 'mounted' || input.sceneMutationLocked) : false,
      previewAvailable: hasModel,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  if (renderer === 'godot') {
    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId,
      renderer,
      phase: hasModel ? 'mounted' : 'no-model',
      controlsLocked: false,
      previewAvailable: false,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  if (renderer === 'live2d' || renderer === 'spine' || renderer === 'tachie' || renderer === 'mmd') {
    const phase = resolveComponentStateToRuntimePhase(input.componentState, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId,
      renderer,
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: false,
      ...(renderer === 'live2d'
        ? { modelId: input.live2dExpressionStore.modelId, live2dExpressions: input.live2dExpressionStore.settingsSnapshot }
        : {}),
      ...(renderer === 'mmd'
        ? { modelId: input.mmdExpressionStore.modelId, mmdExpressions: input.mmdExpressionStore.settingsSnapshot }
        : {}),
      updatedAt: Date.now(),
    })
  }

  return createEmptyModelSettingsRuntimeSnapshot({ ownerInstanceId, updatedAt: Date.now() })
}
