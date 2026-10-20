import type { UserMessage } from '@xsai/shared-chat'

import type { ContextMessage } from '../types/chat'

/**
 * Active context messages grouped by core registry source key.
 *
 * The record values are cloned snapshots owned by callers; mutating them must
 * not mutate the underlying context registry.
 */
export type ContextSnapshot = Record<string, ContextMessage[]>

/**
 * Joins runtime context texts verbatim, with a blank line between them. Empty and whitespace-only texts are skipped.
 *
 * Each context source owns its own heading (the situation block starts with `[Situation HH:MM]`), so no shared
 * header or source prefix is added.
 *
 * Why plain text (not XML):
 * - Weak local models (8B/14B) tend to mirror conspicuous structured
 *   wrappers (`<context>...</context>`) back into their replies, treating
 *   them as data to be quoted. Plain text and flat bullets look like ordinary
 *   narrative, which suppresses that mirroring tendency.
 * - See: https://github.com/moeru-ai/airi/issues/1539
 */
export function joinContextTexts(texts: readonly string[]) {
  return texts.filter(text => text.trim() !== '').join('\n\n')
}

/**
 * Render runtime context modules into one plain-text block.
 *
 * Use when:
 * - Composing chat prompts that need to attach side-channel runtime context
 *   (e.g. the situation block) to the latest user message.
 *
 * Expects:
 * - A snapshot keyed by `contextId`. Only the per-message `text` field is
 *   included; the `contextId` and volatile metadata (random IDs, ms timestamps)
 *   are excluded so the output stays deterministic and KV-cache-friendly.
 *
 * Returns:
 * - Empty string when no message carries text.
 * - Otherwise every message text verbatim, joined by {@link joinContextTexts}.
 */
export function formatContextPromptText(contextsSnapshot: ContextSnapshot) {
  return joinContextTexts(Object.values(contextsSnapshot).flatMap(messages => messages.map(message => message.text)))
}

/**
 * Builds a user-role context prompt message from active runtime context.
 *
 * Use when:
 * - A caller needs the historical standalone context prompt shape.
 *
 * Expects:
 * - Context messages have already been bucketed and cloned by the context registry.
 *
 * Returns:
 * - `null` when no prompt text is available.
 * - A user message carrying the rendered context text otherwise.
 */
export function buildContextPromptMessage(contextsSnapshot: ContextSnapshot): UserMessage | null {
  const promptText = formatContextPromptText(contextsSnapshot)
  if (!promptText)
    return null

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: promptText,
      },
    ],
  }
}
