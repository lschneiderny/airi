import { defineInvokeEventa } from '@moeru/eventa'

/** Main owns stored credentials. Renderers receive only their public state. */
export interface GoConfiguration {
  configured: boolean
  revision: number
  keyPreview: string
}

export interface GoProfile {
  providerId: string
}

/** Only these operations can reach the fixed Go endpoint. */
export interface GoRequest extends GoProfile {
  requestId: string
  operation: 'models' | 'chat'
  sessionId?: string
  body?: string
}

export interface GoResponse {
  status: number
  statusText: string
  headers: [string, string][]
}

/** Each pull reads at most one upstream chunk, preserving consumer backpressure. */
export type GoChunk = { done: true } | { done: false, data: Uint8Array }

export const goGetConfiguration = defineInvokeEventa<GoConfiguration, GoProfile>('eventa:invoke:opencode-go:configuration:get')
export const goSetConfiguration = defineInvokeEventa<GoConfiguration, GoProfile & { apiKey: string }>('eventa:invoke:opencode-go:configuration:set')
export const goOpenRequest = defineInvokeEventa<GoResponse, GoRequest>('eventa:invoke:opencode-go:request:open')
export const goReadChunk = defineInvokeEventa<GoChunk, { requestId: string }>('eventa:invoke:opencode-go:request:read')
export const goCancelRequest = defineInvokeEventa<void, { requestId: string }>('eventa:invoke:opencode-go:request:cancel')
