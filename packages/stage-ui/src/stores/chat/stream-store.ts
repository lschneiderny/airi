import type { ChatOrchestratorRuntimeState } from '@proj-airi/core-agent'

import type { StreamingAssistantMessage } from '../../types/chat'

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { useChatSessionStore } from './session-store'

export const useChatStreamStore = defineStore('chat-stream', () => {
  const chatSession = useChatSessionStore()
  // Live text stays local. Context events supply remote streams without full-store replication.
  const activeTurns = shallowRef<ChatOrchestratorRuntimeState['activeTurns']>([])
  const remoteMessages = ref<Record<string, StreamingAssistantMessage>>({})
  const emptyMessage: StreamingAssistantMessage = { role: 'assistant', content: '', slices: [], tool_results: [] }
  const streamingMessage = computed({
    get: () => activeTurns.value.find(turn => turn.sessionId === chatSession.activeSessionId)?.message
      ?? remoteMessages.value[chatSession.activeSessionId] ?? emptyMessage,
    set: (message: StreamingAssistantMessage) => { remoteMessages.value[chatSession.activeSessionId] = message },
  })

  function updateActiveTurns(turns: ChatOrchestratorRuntimeState['activeTurns']) {
    activeTurns.value = turns
  }

  function beginStream(id: string) {
    streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [], createdAt: Date.now(), id }
  }

  function appendStreamLiteral(literal: string) {
    streamingMessage.value.content += literal

    // Text merges into an open text slice only. After a break slice (or any other slice) a new text slice opens,
    // so history renders the text after a break as its own bubble.
    const lastSlice = streamingMessage.value.slices.at(-1)
    if (lastSlice?.type === 'text') {
      lastSlice.text += literal
      return
    }

    streamingMessage.value.slices.push({
      type: 'text',
      text: literal,
    })
  }

  /**
   * Adds a pause between two bubbles to a stream that this window rebuilds from another renderer's events.
   * The next literal opens a new text slice. A break before the first text has nothing to split and is ignored,
   * as the runtime does.
   */
  function appendStreamBreak(seconds: number) {
    if (!streamingMessage.value.slices.some(slice => slice.type === 'text'))
      return

    streamingMessage.value.slices.push({ type: 'break', seconds })
    streamingMessage.value.content += '\n\n'
  }

  function resetStream() {
    streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
  }

  return {
    streamingMessage,
    activeTurns,
    updateActiveTurns,
    beginStream,
    appendStreamLiteral,
    appendStreamBreak,
    resetStream,
  }
})
