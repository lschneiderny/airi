import type { ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { Observation } from '@proj-airi/stage-shared/situation'

/** The chat hooks the sensor listens to. The chat store exposes them from its runtime. */
export type ConversationHookSource = Pick<ChatHookRegistry, 'onBeforeSend' | 'onAssistantMessage' | 'onChatTurnComplete'>

/** Turns remembered for deduplication. Hooks of one turn fire within seconds, so a short memory suffices. */
const SEEN_TURNS_MAX = 64

/**
 * Turns chat turns into `conversation` observations, once per turn and speaker.
 *
 * A user observation comes from `onBeforeSend` only for user-origin turns: the runtime also emits that hook for
 * unprompted turns, and those must never count as the user speaking. A character observation comes from the first
 * of `onAssistantMessage` and `onChatTurnComplete`, which both fire for one finished reply; it carries the turn's
 * origin. Turns are keyed by session and turn id. Returns the function that unregisters the hooks.
 */
export function startConversationSensor(hooks: ConversationHookSource, ingest: (observation: Observation) => void): () => void {
  const seen = new Set<string>()

  function firstTime(who: 'user' | 'character', context: ChatStreamEventContext): boolean {
    const key = JSON.stringify([who, context.sessionId, context.turnId])
    if (seen.has(key))
      return false
    seen.add(key)
    if (seen.size > SEEN_TURNS_MAX) {
      const oldest = seen.values().next()
      if (!oldest.done)
        seen.delete(oldest.value)
    }
    return true
  }

  function characterSpoke(context: ChatStreamEventContext) {
    if (!firstTime('character', context))
      return
    ingest({ kind: 'conversation', who: 'character', origin: context.origin ?? 'user', atMs: Date.now() })
  }

  const unregister = [
    hooks.onBeforeSend(async (_message, context) => {
      if (context.origin === 'unprompted' || !firstTime('user', context))
        return
      ingest({ kind: 'conversation', who: 'user', origin: 'user', atMs: Date.now() })
    }),
    hooks.onAssistantMessage(async (_message, _messageText, context) => characterSpoke(context)),
    hooks.onChatTurnComplete(async (_chat, context) => characterSpoke(context)),
  ]

  return () => {
    for (const off of unregister)
      off()
  }
}
