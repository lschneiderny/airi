import type { Live2DExpressionSettingsCommand } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components'
import type { ExpressionPanelCommand } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/expressions/source'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

export const modelSettingsRuntimeChannelName = 'airi-model-settings-runtime'

/** A settings mutation request for one loaded Live2D model. */
export interface ApplyLive2DExpressionSettingsCommandRequest {
  /** Identifies the stage renderer that published the source snapshot. */
  ownerInstanceId: string
  /** Identifies the expression store that published the source snapshot. */
  modelId: string
  command: Live2DExpressionSettingsCommand
}

/** A settings mutation request for one loaded MMD model. */
export interface ApplyMMDExpressionSettingsCommandRequest {
  ownerInstanceId: string
  modelId: string
  command: ExpressionPanelCommand
}

/** The current owner state after it accepts or rejects a settings mutation. */
export interface ApplyExpressionSettingsCommandResponse {
  applied: boolean
  snapshot: ModelSettingsRuntimeSnapshot
  rejectionReason?: 'owner-changed' | 'model-changed' | 'runtime-unavailable'
}

export const modelSettingsRuntimeSnapshotRequested = defineEventa<void>('eventa:model-settings-runtime:snapshot:request')
export const modelSettingsRuntimeSnapshotChanged = defineEventa<ModelSettingsRuntimeSnapshot>('eventa:model-settings-runtime:snapshot:changed')
export const modelSettingsRuntimeOwnerGone = defineEventa<{ ownerInstanceId: string }>('eventa:model-settings-runtime:owner:gone')
export const applyLive2DExpressionSettingsCommand = defineInvokeEventa<
  ApplyExpressionSettingsCommandResponse,
  ApplyLive2DExpressionSettingsCommandRequest
>('eventa:model-settings-runtime:live2d-expression:apply')
export const applyMMDExpressionSettingsCommand = defineInvokeEventa<
  ApplyExpressionSettingsCommandResponse,
  ApplyMMDExpressionSettingsCommandRequest
>('eventa:model-settings-runtime:mmd-expression:apply')

let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined

/** The Eventa context that carries model-settings state and commands. */
export type ModelSettingsRuntimeContext = ReturnType<typeof createBroadcastChannelContext>['context']

/** Returns the Eventa context for model-settings state and commands. */
export function getModelSettingsRuntimeContext() {
  context ??= createBroadcastChannelContext(new BroadcastChannel(modelSettingsRuntimeChannelName)).context
  return context
}
