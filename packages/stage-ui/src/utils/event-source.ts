import type { MetadataEventSource } from '@proj-airi/server-sdk'

interface EventSourcePayload {
  source?: string
  metadata?: { source?: MetadataEventSource }
}

/**
 * Returns a human-readable source label for extension identities.
 *
 * Use when:
 * - UI stores need to display or compare websocket event sources
 * - Protocol metadata may come from extension, module, or kit peers
 *
 * Expects:
 * - `source` is a protocol metadata identity from server-shared/server-sdk
 *
 * Returns:
 * - A stable label, preferring extension-scoped module ids
 */
export function getMetadataSourceLabel(source?: MetadataEventSource) {
  if (!source)
    return undefined

  if ('extension' in source) {
    return `${source.extension.id}:${source.id}`
  }

  return source.id
}

function formatMetadataSource(source?: MetadataEventSource) {
  if (!source)
    return undefined

  return getMetadataSourceLabel(source)
}

export function getEventSourceKey(event: EventSourcePayload, fallback = 'unknown') {
  return (
    formatMetadataSource(event.metadata?.source)
    ?? event.source
    ?? fallback
  )
}

/** Longest source key that a system prompt names. Plugin and module source keys are short ids. */
export const PROMPT_SOURCE_KEY_MAX_CHARS = 64

/**
 * Returns the source key of an event for a host-written system prompt that names the sender.
 *
 * Use when:
 * - A segment with system authority interpolates the module that sent an event
 *
 * Expects:
 * - The server channel or a plugin supplied the key, so it can hold any text
 *
 * Returns:
 * - The key on one line, without double quotes, cut to `PROMPT_SOURCE_KEY_MAX_CHARS`, or `unknown` when nothing is left
 */
export function getPromptSourceKey(event: EventSourcePayload) {
  const key = getEventSourceKey(event).replace(/[\s"\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, PROMPT_SOURCE_KEY_MAX_CHARS).trim()
  return key || 'unknown'
}
