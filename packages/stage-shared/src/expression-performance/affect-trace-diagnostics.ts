import type { BroadcastChannelEmitOptions } from '@moeru/eventa/adapters/broadcast-channel'

import type { AffectTrace } from './trace'

import { createContext, defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

/** A lab request to start an affect recording in the stage, or to export the open one. */
export interface AffectTraceRequest {
  id: string
  action: 'start' | 'export'
}

/** The stage's answer to an affect-trace request. */
export interface AffectTraceResult {
  id: string
  action: AffectTraceRequest['action']
  /** Entries in the exported trace; 0 for a started recording. */
  entries: number
  truncated: boolean
  /** Where the sink saved the exported trace, or `null` for a start or before saving. */
  savedPath: string | null
}

/**
 * Stable reasons an affect-trace request fails. The lab translates each code.
 *
 * - `no-recording`: the stage had no open recording to export.
 * - `save-failed`: the requesting window could not save the exported trace.
 */
export type AffectTraceFailureCode = 'no-recording' | 'save-failed'

/** The lab asks the stage to start or export its affect recording. Every window shows the request as pending. */
export const affectTraceRequestedEvent = defineEventa<AffectTraceRequest>('eventa:event:live2d:natural-motion-diagnostics:affect-trace:requested')
/** The stage answers a request. An export carries the trace; a start carries `null`. */
export const affectTraceCompletedEvent = defineEventa<{ result: AffectTraceResult, trace: AffectTrace | null }>('eventa:event:live2d:natural-motion-diagnostics:affect-trace:completed')
/** The stage could not answer a request. */
export const affectTraceFailedEvent = defineEventa<{ id: string, code: AffectTraceFailureCode }>('eventa:event:live2d:natural-motion-diagnostics:affect-trace:failed')

/**
 * Creates the Eventa context that carries the affect-trace events over the Natural motion
 * diagnostics BroadcastChannel. The caller owns the channel; dispose the context before closing
 * it. Without a channel the context only delivers to listeners in this window.
 */
export function createAffectTraceDiagnosticsContext(channel: BroadcastChannel | undefined) {
  if (channel)
    return createBroadcastChannelContext(channel)
  return { context: createContext<undefined, BroadcastChannelEmitOptions>(), dispose: () => {} }
}
