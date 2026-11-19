import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatUnpromptedPayload, ChatUnpromptedResult } from '../../chat'

import { createChatHooks } from '@proj-airi/core-agent'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { getSpeechBusContext, voiceRequestTurns, voiceTurnsChanged } from '../../../services/speech/bus'
import { connectMind } from '../../../test/connect-mind'
import { useLlmStreamingControlStore } from '../../ai/chat-llm/streaming-control'
import { useSituationStore } from '../../situation'
import { useContextBridgeStore } from './context-bridge'

// The situation store feeds the character state, whose store reads the active card id from the card store. The real
// card store's setup needs an i18n application context.
vi.mock('../../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', {
      state: () => ({ activeCardId: 'default', cards: new Map<string, unknown>() }),
    }),
  }
})

// The reaction is a widget turn that the leader's mind lets through; its reply text is the reaction.
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

/** The leader's inner state lives in localStorage, which the Node project does not provide. */
class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function leaderRuntime(): SyncedPiniaRuntime {
  return {
    addRole: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    getParticipants: vi.fn(() => []),
    getRoles: vi.fn(() => []),
    isLeader: () => true,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(true)
      return () => {}
    }),
    participantId: 'performance-call-test',
    plugin: vi.fn(),
  }
}

/** Makes this window the leader with a connected mind, which serves widget requests through `submitUnprompted`. */
function leadWithMind() {
  const situation = useSituationStore()
  situation.setHostCapabilities({ unprompted: true })
  situation.observeChat(createChatHooks(), {
    sending: () => false,
    pendingQueuedSendCount: () => 0,
    unpromptedPending: () => false,
    activeSessionId: () => 'session-1',
    submitUnprompted: payload => submitUnprompted(payload),
    submitReaction: async () => ({ status: 'failed', error: 'No reaction turns in this test' }),
    cancelTurn: async () => {},
    sessionMessages: () => [],
    extractionSelection: async () => null,
    stream: async () => {},
  })
  situation.initialize(leaderRuntime())
  // The gate's seed is irrelevant here: no test ticks long enough for a reach-out.
  connectMind(situation, 1)
}

describe('dispatchSparkNotifyPerformance', () => {
  let stopVoiceHost: () => void

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', new MemoryStorage())
    submittedTurnId = Promise.withResolvers<string>()
    submitUnprompted.mockReset().mockImplementation(async (payload) => {
      submittedTurnId.resolve(payload.messageId!)
      return { status: 'spoken', text: 'reaction text' }
    })
    // The audio host reports a quiet character, so the mind lets a reaction through at once.
    const bus = getSpeechBusContext()
    stopVoiceHost = bus.on(voiceRequestTurns, () => bus.emit(voiceTurnsChanged, []))
  })

  afterEach(() => {
    stopVoiceHost()
    useSituationStore().dispose()
    vi.unstubAllGlobals()
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
    leadWithMind()
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
      // The caller's wait is also the turn's deadline, so it leaves the turn time to speak.
      timeoutMs: 10_000,
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
      widget: true,
      supplement: expect.stringContaining('<|CALL ["plugin.action"]|>'),
    }))
  })

  it('includes the CALL payload in the performance result', async () => {
    const store = useContextBridgeStore()
    store.setSparkNotifyHostRole('main')
    leadWithMind()
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
    leadWithMind()
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
    leadWithMind()
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
