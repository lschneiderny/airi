import type { Conversation } from '@proj-airi/core-agent'
import type { CatalogEntry, TagSuggestion } from '@proj-airi/stage-shared/expression-performance'

import { buildTagSuggestionPrompt, parseTagSuggestions, tagSuggestionEntries } from '@proj-airi/stage-shared/expression-performance'

import { useLLM } from '../../stores/ai/chat-llm/llm'
import { useConsciousnessStore } from '../../stores/modules/consciousness'

/** Thrown when no chat model is selected, so the panel can say what to do about it. */
export class NoChatModelError extends Error {
  constructor() {
    super('No chat model is configured')
  }
}

/**
 * Asks the user's chat model how the character could use this model's expressions on her own, and returns its
 * suggestions. It writes nothing: the caller shows the suggestions and the user applies the ones they accept.
 *
 * - One request, outside the chat: no tools, no chat history, nothing added to the conversation.
 * - It sends each entry's label, kind, file name and parameter ids to the chat provider, and nothing else.
 * - It runs in the calling window, so the settings window asks with its own provider instance.
 *
 * Rejects with `NoChatModelError` without a chat model, and with the request's or the parser's error otherwise.
 * Resolves to an empty list when the model has nothing a suggestion may touch.
 */
export async function requestExpressionTagSuggestions(catalog: readonly CatalogEntry[], signal?: AbortSignal): Promise<TagSuggestion[]> {
  if (tagSuggestionEntries(catalog).length === 0)
    return []
  const consciousness = useConsciousnessStore()
  const providerId = consciousness.activeProvider
  const model = consciousness.activeModel
  if (!providerId || !model)
    throw new NoChatModelError()
  const provider = await consciousness.getChatProviderInstance(providerId)
  const prompt = buildTagSuggestionPrompt(catalog)
  const conversation: Conversation = { turns: [
    { id: 'expression-tag-suggestions-instructions', type: 'system', authority: 'system', content: [{ type: 'text', text: prompt.system }] },
    { id: 'expression-tag-suggestions-entries', type: 'user', content: [{ type: 'text', text: prompt.user }] },
  ] }
  let reply = ''
  await useLLM().stream(model, provider, conversation, {
    supportsTools: false,
    abortSignal: signal,
    onStreamEvent: (event) => {
      if (event.type === 'text-delta')
        reply += event.text
    },
  })
  return parseTagSuggestions(reply, catalog)
}
