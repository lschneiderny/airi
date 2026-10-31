import type { Live2DExpressionSettingsCommand } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { ExpressionPanelCommand } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/expressions/source'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import type { MaybeRefOrGetter } from 'vue'

import type { ApplyExpressionSettingsCommandResponse, ModelSettingsRuntimeContext } from '../../shared/model-settings-runtime'

import { defineInvokeHandler } from '@moeru/eventa'
import { onBeforeUnmount, toValue, watch } from 'vue'

import {
  applyLive2DExpressionSettingsCommand,
  applyMMDExpressionSettingsCommand,
  getModelSettingsRuntimeContext,
  modelSettingsRuntimeOwnerGone,
  modelSettingsRuntimeSnapshotChanged,
  modelSettingsRuntimeSnapshotRequested,
} from '../../shared/model-settings-runtime'

interface UseModelSettingsRuntimeOwnerOptions {
  ownerInstanceId: string
  renderer: MaybeRefOrGetter<ModelSettingsRuntimeSnapshot['renderer'] | undefined>
  runtimeSnapshot: MaybeRefOrGetter<ModelSettingsRuntimeSnapshot>
  applyLive2DExpressionCommand: (command: Live2DExpressionSettingsCommand) => void
  applyMMDExpressionCommand: (command: ExpressionPanelCommand) => void
  context?: ModelSettingsRuntimeContext
}

/**
 * Owns the model-settings channel for the renderer that controls the active model.
 *
 * The owner publishes runtime snapshots and accepts commands for its current owner ID.
 * Commands for stale owners or for a renderer other than the one they address do not change any expression store.
 */
export function useModelSettingsRuntimeOwner(options: UseModelSettingsRuntimeOwnerOptions) {
  const context = options.context ?? getModelSettingsRuntimeContext()

  function postSnapshot(snapshot: ModelSettingsRuntimeSnapshot) {
    void context.emit(modelSettingsRuntimeSnapshotChanged, snapshot).catch((error) => {
      console.warn('[Model Settings Runtime] Failed to publish the runtime snapshot:', error)
    })
  }

  watch(() => toValue(options.runtimeSnapshot), (snapshot) => {
    postSnapshot(snapshot)
  }, { immediate: true })

  const stopSnapshotRequests = context.on(modelSettingsRuntimeSnapshotRequested, () => {
    postSnapshot(toValue(options.runtimeSnapshot))
  })
  /** Checks owner, model and renderer before `apply` runs; the answer always carries the current snapshot. */
  function handleExpressionCommand<Command>(
    renderer: ModelSettingsRuntimeSnapshot['renderer'],
    apply: (command: Command) => void,
  ) {
    return (request: { ownerInstanceId: string, modelId: string, command: Command }): ApplyExpressionSettingsCommandResponse => {
      const currentSnapshot = toValue(options.runtimeSnapshot)
      if (request.ownerInstanceId !== options.ownerInstanceId) {
        return {
          applied: false,
          snapshot: currentSnapshot,
          rejectionReason: 'owner-changed',
        }
      }

      if (!request.modelId || request.modelId !== currentSnapshot.modelId) {
        return {
          applied: false,
          snapshot: currentSnapshot,
          rejectionReason: 'model-changed',
        }
      }

      if (toValue(options.renderer) !== renderer || currentSnapshot.controlsLocked) {
        return {
          applied: false,
          snapshot: currentSnapshot,
          rejectionReason: 'runtime-unavailable',
        }
      }

      apply(request.command)
      return {
        applied: true,
        snapshot: toValue(options.runtimeSnapshot),
      }
    }
  }

  const stopLive2DExpressionCommands = defineInvokeHandler(context, applyLive2DExpressionSettingsCommand, handleExpressionCommand('live2d', options.applyLive2DExpressionCommand))
  const stopMMDExpressionCommands = defineInvokeHandler(context, applyMMDExpressionSettingsCommand, handleExpressionCommand('mmd', options.applyMMDExpressionCommand))

  onBeforeUnmount(() => {
    stopSnapshotRequests()
    stopLive2DExpressionCommands()
    stopMMDExpressionCommands()
    void context.emit(modelSettingsRuntimeOwnerGone, {
      ownerInstanceId: options.ownerInstanceId,
    }).catch((error) => {
      console.warn('[Model Settings Runtime] Failed to publish owner shutdown:', error)
    })
  })
}
