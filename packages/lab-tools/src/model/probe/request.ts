import type { AppRequest } from '../run/app-request'
import type { ChatMessage, ChatOutcome } from '../run/chat'

import { buildChatRequest, requestChat } from '../run/chat'

/** One probe request may wait this long: a cold load of a large model on a 16 GB machine takes most of a minute. */
export const PROBE_TIMEOUT_MS = 600_000

/** What every probe sends: the endpoint, the model, and the captured app prompt and tools. */
export interface ProbeTarget {
  baseUrl: string
  model: string
  system: string
  tools: readonly unknown[]
}

/** The request of one probe step: its system prompt, tools, and messages after the system message. */
export interface ProbeRequest {
  system: string
  tools: readonly unknown[]
  messages: readonly ChatMessage[]
}

/** A probe's target from a capture: its system prompt and tools. */
export function targetFrom(baseUrl: string, model: string, capture: AppRequest): ProbeTarget {
  return { baseUrl, model, system: capture.system, tools: capture.tools }
}

/**
 * Sends one request with reasoning off, as the app's Ollama provider does by default, and returns what came back.
 * `maxTokens` stays small for timing probes: the time to first token does not depend on the reply length.
 */
export async function send(target: Pick<ProbeTarget, 'baseUrl' | 'model'>, request: ProbeRequest, options: { maxTokens: number, temperature?: number }): Promise<ChatOutcome> {
  const body = buildChatRequest(
    target.model,
    [{ role: 'system', content: request.system }, ...request.messages],
    { reasoning_effort: 'none', max_tokens: options.maxTokens, ...(options.temperature === undefined ? {} : { temperature: options.temperature }) },
    { tools: request.tools },
  )
  const outcome = await requestChat(target.baseUrl, JSON.stringify(body), PROBE_TIMEOUT_MS)
  if (outcome.error !== null)
    throw new Error(`the endpoint failed: ${outcome.error}`)
  return outcome
}

/** The `prompt_tokens` an endpoint reported, or `null`. */
export function promptTokens(outcome: ChatOutcome): number | null {
  const value = outcome.usage?.prompt_tokens
  return typeof value === 'number' ? value : null
}

/** The median of the values, or `null` for none. */
export function median(values: readonly number[]): number | null {
  if (!values.length)
    return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
