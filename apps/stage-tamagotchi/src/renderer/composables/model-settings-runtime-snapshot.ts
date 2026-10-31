import type { Live2DExpressionSettingsCommand } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { ExpressionPanelCommand } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/expressions/source'
import type {
  ModelSettingsRuntimeSnapshot,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

import type { ApplyExpressionSettingsCommandResponse, ModelSettingsRuntimeContext } from '../../shared/model-settings-runtime'

import { defineInvoke } from '@moeru/eventa'
import {
  createEmptyModelSettingsRuntimeSnapshot,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { onMounted, onUnmounted, ref } from 'vue'

import {
  applyLive2DExpressionSettingsCommand,
  applyMMDExpressionSettingsCommand,
  getModelSettingsRuntimeContext,
  modelSettingsRuntimeOwnerGone,
  modelSettingsRuntimeSnapshotChanged,
  modelSettingsRuntimeSnapshotRequested,
} from '../../shared/model-settings-runtime'

interface UseModelSettingsRuntimeSnapshotOptions {
  context?: ModelSettingsRuntimeContext
  /** Maximum wait for the stage owner to respond. @default 1000 */
  commandTimeoutMs?: number
}

export function useModelSettingsRuntimeSnapshot(options: UseModelSettingsRuntimeSnapshotOptions = {}) {
  const runtimeSnapshot = ref<ModelSettingsRuntimeSnapshot>(createEmptyModelSettingsRuntimeSnapshot())
  const context = options.context ?? getModelSettingsRuntimeContext()
  const invokeLive2DExpressionCommand = defineInvoke(context, applyLive2DExpressionSettingsCommand)
  const invokeMMDExpressionCommand = defineInvoke(context, applyMMDExpressionSettingsCommand)

  const requestCurrent = () => {
    void context.emit(modelSettingsRuntimeSnapshotRequested, undefined)
  }

  /** Sends one command to the owner of the matching renderer and adopts the snapshot it answers with. */
  async function sendExpressionCommand<Command>(
    renderer: ModelSettingsRuntimeSnapshot['renderer'],
    invoke: (request: { ownerInstanceId: string, modelId: string, command: Command }, options: { signal: AbortSignal }) => Promise<ApplyExpressionSettingsCommandResponse>,
    command: Command,
  ) {
    const snapshot = runtimeSnapshot.value
    if (!snapshot.ownerInstanceId || !snapshot.modelId || snapshot.renderer !== renderer || snapshot.controlsLocked)
      return false

    try {
      const response = await invoke({
        ownerInstanceId: snapshot.ownerInstanceId,
        modelId: snapshot.modelId,
        command,
      }, {
        signal: AbortSignal.timeout(options.commandTimeoutMs ?? 1000),
      })
      runtimeSnapshot.value = response.snapshot
      return response.applied
    }
    catch (error) {
      runtimeSnapshot.value = createEmptyModelSettingsRuntimeSnapshot()
      requestCurrent()
      console.warn(`[Model Settings Runtime] Failed to apply the ${renderer} expression command:`, error)
      return false
    }
  }

  const sendLive2DExpressionCommand = (command: Live2DExpressionSettingsCommand) => sendExpressionCommand('live2d', invokeLive2DExpressionCommand, command)
  const sendMMDExpressionCommand = (command: ExpressionPanelCommand) => sendExpressionCommand('mmd', invokeMMDExpressionCommand, command)

  const syncFromOwner = () => {
    requestCurrent()
  }
  const syncFromOwnerWhenVisible = () => {
    if (document.visibilityState === 'visible')
      requestCurrent()
  }

  const stopSnapshots = context.on(modelSettingsRuntimeSnapshotChanged, (event) => {
    if (event.body)
      runtimeSnapshot.value = event.body
  })
  const stopOwnerGone = context.on(modelSettingsRuntimeOwnerGone, (event) => {
    if (!event.body || runtimeSnapshot.value.ownerInstanceId !== event.body.ownerInstanceId)
      return

    runtimeSnapshot.value = createEmptyModelSettingsRuntimeSnapshot()
  })

  onMounted(() => {
    requestCurrent()
    window.addEventListener('focus', syncFromOwner)
    document.addEventListener('visibilitychange', syncFromOwnerWhenVisible)
  })

  onUnmounted(() => {
    window.removeEventListener('focus', syncFromOwner)
    document.removeEventListener('visibilitychange', syncFromOwnerWhenVisible)
    stopSnapshots()
    stopOwnerGone()
  })

  return {
    runtimeSnapshot,
    requestCurrent,
    sendLive2DExpressionCommand,
    sendMMDExpressionCommand,
  }
}
