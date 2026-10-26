import type { ChatToolCallRerunEvent } from '@proj-airi/stage-ui/stores/tool-call-rerun'

import { errorMessageFrom } from '@moeru/std'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { nanoid } from 'nanoid'

/**
 * Runs a stored tool call again from the chat history of the web and mobile layouts.
 *
 * The chat store action runs in the synchronization leader and stores the new result there, so a follower tab never
 * writes the history itself. A failed rerun leaves an error item in the chat.
 */
export function useChatToolCallRerun() {
  const chatStore = useChatStore()
  const chatSession = useChatSessionStore()

  /**
   * Triggering workflow: ChatHistory `toolCallRerun` -> rerunToolCall
   * -> chatStore.rerunToolCall, which stores the new result in the leader.
   */
  async function rerunToolCall(payload: ChatToolCallRerunEvent) {
    const sessionId = chatSession.activeSessionId
    try {
      await chatStore.rerunToolCall({
        sessionId,
        messageId: payload.message.id,
        index: payload.index,
        toolCallId: payload.toolCallId,
        invocationId: payload.invocationId,
        toolName: payload.toolName,
        args: payload.args,
      })
    }
    catch (error) {
      await chatSession.storeMessage(sessionId, {
        role: 'error',
        content: errorMessageFrom(error) ?? 'Failed to rerun tool call.',
        id: nanoid(),
        createdAt: Date.now(),
      })
    }
  }

  return {
    rerunToolCall,
  }
}
