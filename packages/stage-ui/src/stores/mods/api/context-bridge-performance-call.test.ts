import type { ChatUnpromptedPayload, ChatUnpromptedResult } from '../../chat'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { getSpeechBusContext, voiceRequestTurns, voiceTurnsChanged } from '../../../services/speech/bus'
import { useLlmStreamingControlStore } from '../../ai/chat-llm/streaming-control'
import { useContextBridgeStore } from './context-bridge'

// The reaction is a forced unprompted chat turn; its reply text is the reaction.
const submitUnprompted = vi.fn<(payload: ChatUnpromptedPayload) => Promise<ChatUnpromptedResult>>()
/** Resolves with the message id of the next reaction turn. CALL specials of that chat turn carry it as turn id. */
let submittedTurnId: PromiseWithResolvers<string>

vi.mock('../../character', () => ({
  useCharacterOrchestratorStore: () => ({
    handleSparkNotify: vi.fn(async () => undefined),
  }),
  useCharacterStore: () => ({
    recordSparkNotifyReaction: vi.fn(),
  }),
}))

vi.mock('../../chat', () => ({
  useChatStore: () => ({ submitUnprompted }),
}))

vi.mock('../../chat/session-store', () => ({
  useChatSessionStore: () => ({}),
}))

vi.mock('../../chat/stream-store', () => ({
  useChatStreamStore: () => ({}),
}))

vi.mock('../../devtools/context-observability', () => ({
  useContextObservabilityStore: () => ({
    recordLifecycle: vi.fn(),
  }),
}))

vi.mock('../../modules/consciousness', () => ({
  useConsciousnessStore: () => ({
    activeProvider: ref(undefined),
    activeModel: ref(undefined),
    getChatProviderInstance: vi.fn(async () => ({})),
  }),
}))

vi.mock('../../providers/provider', () => ({
  useProviderStore: () => ({}),
}))

vi.mock('./channel-server', () => ({
  useModsServerChannelStore: () => ({
    ensureConnected: vi.fn(async () => undefined),
    send: vi.fn(),
    onReconnected: vi.fn(() => () => undefined),
    onContextUpdate: vi.fn(() => () => undefined),
    onEvent: vi.fn(() => () => undefined),
  }),
}))

describe('dispatchSparkNotifyPerformance', () => {
  let stopVoiceHost: () => void

  beforeEach(() => {
    setActivePinia(createPinia())
    submittedTurnId = Promise.withResolvers<string>()
    submitUnprompted.mockReset().mockImplementation(async (payload) => {
      submittedTurnId.resolve(payload.messageId!)
      return { status: 'spoken', text: 'reaction text' }
    })
    // The audio host reports a quiet character, so a forced reaction starts at once.
    const bus = getSpeechBusContext()
    stopVoiceHost = bus.on(voiceRequestTurns, () => bus.emit(voiceTurnsChanged, []))
  })

  afterEach(() => {
    stopVoiceHost()
  })

  /**
   * @example
   * const resultPromise = store.dispatchSparkNotifyPerformance({ headline: 'x', fallbackResponseText: '', calls: [{ manifest: { name: 'plugin.action', prompt: 'Run it.' }, handler }] })
   * await streamingControl.dispatchWith('<|CALL ["plugin.action"]|>', { turnId })
   * await expect(resultPromise).resolves.toMatchObject({ type: 'called', name: 'plugin.action' })
   */
  it('resolves when a registered generic performance call is emitted', async () => {
    const store = useContextBridgeStore()
    store.setSparkNotifyHostRole('main')
    const handler = vi.fn()
    const streamingControl = useLlmStreamingControlStore()

    const resultPromise = store.dispatchSparkNotifyPerformance({
      headline: 'Plugin performance',
      fallbackResponseText: '',
      calls: [
        {
          manifest: {
            name: 'plugin.action',
            prompt: 'Run the plugin action when the model is ready.',
            examples: [
              '<|CALL ["plugin.action"]|>',
            ],
          },
          handler,
        },
      ],
      timeoutMs: 1000,
    })

    // The chat turn runs under the streaming-control turn id, so the CALL handlers receive its CALL specials.
    const turnId = await submittedTurnId.promise
    expect(turnId).toMatch(/^spark:/)

    await streamingControl.dispatchWith('<|CALL ["plugin.action"]|>', { turnId })

    await expect(resultPromise).resolves.toEqual({
      type: 'called',
      name: 'plugin.action',
      reaction: 'reaction text',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(submitUnprompted).toHaveBeenCalledWith(expect.objectContaining({
      force: true,
      supplement: expect.stringContaining('<|CALL ["plugin.action"]|>'),
    }))
  })

  it('includes the CALL payload in the performance result', async () => {
    const store = useContextBridgeStore()
    store.setSparkNotifyHostRole('main')
    const handler = vi.fn()
    const streamingControl = useLlmStreamingControlStore()

    const resultPromise = store.dispatchSparkNotifyPerformance({
      headline: 'Plugin performance',
      fallbackResponseText: '',
      calls: [
        {
          manifest: {
            name: 'plugin.action',
            prompt: 'Run the plugin action when the model is ready.',
          },
          handler,
        },
      ],
    })
    const turnId = await submittedTurnId.promise
    expect(turnId).toMatch(/^spark:/)

    await streamingControl.dispatchWith('<|CALL ["plugin.action", {"move":"Nf3"}]|>', { turnId })

    await expect(resultPromise).resolves.toEqual({
      type: 'called',
      name: 'plugin.action',
      payload: { move: 'Nf3' },
      reaction: 'reaction text',
    })
    expect(handler).toHaveBeenCalledWith({ move: 'Nf3' })
  })

  it('falls back when a client-side performance bridge request is not answered', async () => {
    vi.useFakeTimers()
    const store = useContextBridgeStore()
    store.setSparkNotifyHostRole('client')

    const resultPromise = store.dispatchSparkNotifyPerformance({
      headline: 'Plugin performance',
      fallbackResponseText: 'fallback text',
      calls: [
        {
          manifest: {
            name: 'plugin.action',
            prompt: 'Run the plugin action when the model is ready.',
          },
          handler: vi.fn(),
        },
      ],
      timeoutMs: 10,
    })

    await vi.advanceTimersByTimeAsync(10)

    await expect(resultPromise).resolves.toEqual({
      type: 'timeout',
      reaction: 'fallback text',
    })
    vi.useRealTimers()
  })

  /**
   * @example
   * const result = store.dispatchSparkNotifyPerformance({ calls: [{ manifest: { name: 'plugin.action', prompt: 'Run it.' }, handler }] })
   * streamingControl.completeTurn(turnId)
   * await expect(result).resolves.toMatchObject({ type: 'completed' })
   */
  it('resolves with completed when the turn ends without CALL', async () => {
    const store = useContextBridgeStore()
    store.setSparkNotifyHostRole('main')
    const handler = vi.fn()
    const streamingControl = useLlmStreamingControlStore()

    const resultPromise = store.dispatchSparkNotifyPerformance({
      headline: 'Plugin performance',
      fallbackResponseText: '',
      calls: [
        {
          manifest: {
            name: 'plugin.action',
            prompt: 'Run the plugin action when the model is ready.',
          },
          handler,
        },
      ],
    })
    const turnId = await submittedTurnId.promise
    expect(turnId).toMatch(/^spark:/)
    streamingControl.completeTurn(turnId)

    await expect(resultPromise).resolves.toEqual({
      type: 'completed',
      reaction: 'reaction text',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  /**
   * @example
   * submitUnprompted.mockResolvedValueOnce({ status: 'declined' })
   * await expect(store.dispatchSparkNotifyPerformance({ fallbackResponseText: 'fallback text', calls })).resolves.toEqual({ type: 'completed', reaction: 'fallback text' })
   */
  it('completes with the fallback when the reaction turn is not spoken, without waiting for a turn end', async () => {
    const store = useContextBridgeStore()
    store.setSparkNotifyHostRole('main')
    const handler = vi.fn()
    submitUnprompted.mockResolvedValueOnce({ status: 'declined' })

    const result = await store.dispatchSparkNotifyPerformance({
      headline: 'Plugin performance',
      fallbackResponseText: 'fallback text',
      calls: [
        {
          manifest: {
            name: 'plugin.action',
            prompt: 'Run the plugin action when the model is ready.',
          },
          handler,
        },
      ],
    })

    expect(result).toEqual({ type: 'completed', reaction: 'fallback text' })
    expect(handler).not.toHaveBeenCalled()
  })
})
