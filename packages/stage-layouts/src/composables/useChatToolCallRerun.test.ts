import type { ChatToolCallRerunEvent } from '@proj-airi/stage-ui/stores/tool-call-rerun'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

const chat = vi.hoisted(() => ({ rerunToolCall: vi.fn() }))
const session = vi.hoisted(() => ({
  activeSessionId: 'session-1',
  getSessionMessages: vi.fn(() => []),
  storeMessage: vi.fn(),
  setSessionMessages: vi.fn(),
}))

// The stores are the boundary: the chat store action runs in the synchronization leader.
vi.mock('@proj-airi/stage-ui/stores/chat', () => ({ useChatStore: () => chat }))
vi.mock('@proj-airi/stage-ui/stores/chat/session-store', () => ({ useChatSessionStore: () => session }))

const { useChatToolCallRerun } = await import('./useChatToolCallRerun')

const event = {
  message: { id: 'assistant-1', role: 'assistant', content: '', slices: [], tool_results: [] },
  index: 2,
  key: 2,
  toolCallId: 'call-1',
  invocationId: 'invocation-1',
  toolName: 'search',
  args: '{"query":"weather"}',
} satisfies ChatToolCallRerunEvent

const cleanups: (() => void)[] = []

function mountRerun() {
  const pinia = createPinia()
  setActivePinia(pinia)
  let rerun!: ReturnType<typeof useChatToolCallRerun>
  const app = createApp(defineComponent({ setup() {
    rerun = useChatToolCallRerun()
    return () => h('div')
  } }))
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} } }))
  const element = document.createElement('div')
  document.body.append(element)
  app.mount(element)
  cleanups.push(() => {
    app.unmount()
    element.remove()
    disposePinia(pinia)
  })
  return rerun
}

describe('useChatToolCallRerun', () => {
  beforeEach(() => {
    chat.rerunToolCall.mockReset().mockResolvedValue(undefined)
    session.storeMessage.mockReset().mockResolvedValue(undefined)
    session.setSessionMessages.mockReset()
  })

  afterEach(() => {
    cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  })

  // ROOT CAUSE:
  //
  // The layouts rewrote the history in the tab that clicked. In a follower tab, that write became a full-state
  // proposal that could overwrite messages the leader had just stored.
  //
  // The rerun now goes through the chat store action, which runs in the leader.
  it('reruns through the chat store action, so the tab never writes the history itself', async () => {
    await mountRerun().rerunToolCall(event)

    expect(chat.rerunToolCall).toHaveBeenCalledWith({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      index: 2,
      toolCallId: 'call-1',
      invocationId: 'invocation-1',
      toolName: 'search',
      args: '{"query":"weather"}',
    })
    expect(session.setSessionMessages).not.toHaveBeenCalled()
    expect(session.storeMessage).not.toHaveBeenCalled()
  })

  it('stores one error item through the session action when the rerun fails', async () => {
    chat.rerunToolCall.mockRejectedValueOnce(new Error('The tool is unavailable'))

    await mountRerun().rerunToolCall(event)

    expect(session.storeMessage).toHaveBeenCalledTimes(1)
    expect(session.storeMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
      role: 'error',
      content: 'The tool is unavailable',
      id: expect.any(String),
    }))
    expect(session.setSessionMessages).not.toHaveBeenCalled()
  })
})
