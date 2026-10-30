import type { ChatOrchestratorSessionPort, Conversation, StreamOptions, Turn } from '@proj-airi/core-agent'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { Tool } from '@xsai/shared-chat'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatHistoryItem } from '../types/chat'
import type { LlmStreamOptions } from './ai/chat-llm/llm'

import { errorMessageFrom } from '@moeru/std'
import { SpanStatusCode } from '@opentelemetry/api'
import { IOAttributes, IOSpanNames } from '@proj-airi/stage-shared'
import { notifyTopicKey } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { computed, createApp, nextTick, reactive, ref, toRaw } from 'vue'

import { usePerformanceRuntimeState } from '../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { isCloudSyncableMessage } from '../libs/chat-sync'
import {
  AIRI_CHAT_APP_SURFACE_HEADER,
  AIRI_CHAT_ROUND_ID_HEADER,
  AIRI_CHAT_SESSION_ID_HEADER,
} from '../libs/product-signals/headers'
import { getSpeechBusContext, voiceGenerationEnded } from '../services/speech/bus'
import { useChatStore } from './chat'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useSituationObservabilityStore } from './devtools/situation-observability'
import { useConsciousnessSettingsStore } from './modules/consciousness-settings'
import { useProviderConfigStore } from './providers/config'
import { useSituationStore } from './situation'

vi.hoisted(() => {
  ;(globalThis as any).window = {
    location: {
      origin: 'http://localhost',
    },
  }
})

const ioTracerMocks = vi.hoisted(() => {
  /** The registered turn spans, by turn ID, like the tracer registry. */
  const turnSpans = new Map<string, unknown>()
  const spans: any[] = []
  const startSpanMock = vi.fn((name: string, _parent?: unknown, _attributes?: Record<string, unknown>) => {
    const context = { traceId: `trace-${spans.length}`, spanId: `span-${spans.length}` }
    const span = {
      name,
      addEvent: vi.fn(),
      end: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      spanContext: () => context,
    }
    spans.push(span)
    return span
  })

  return {
    turnSpans,
    registerTurnSpan: vi.fn((turnId: string, span: unknown) => {
      turnSpans.set(turnId, span)
      return () => turnSpans.delete(turnId)
    }),
    spans,
    startSpanMock,
    /** Voice input spans by turn ID. A typed turn has none. */
    takeVoiceTurnParent: vi.fn((_turnId: string): unknown => undefined),
    /** The composer dictation span of a session. */
    takeComposerVoiceParent: vi.fn((_sessionId: string): unknown => undefined),
  }
})

const llmStreamMock = vi.fn()
const trackFirstMessageMock = vi.fn()
const chatAnalyticsMocks = vi.hoisted(() => ({
  trackMessageRound: vi.fn(),
  trackMessageRoundFailed: vi.fn(),
  trackMessageSent: vi.fn(),
}))
const redundantChatAnalyticsMocks = vi.hoisted(() => ({
  trackAssistantResponseCompleted: vi.fn(),
  trackChatFailed: vi.fn(),
  trackChatStarted: vi.fn(),
  trackFeatureUsed: vi.fn(),
}))
const ingestContextMessageMock = vi.fn()
const getContextsSnapshotMock = vi.fn()
const createUserAccountContextMock = vi.fn()
const persistSessionMessagesMock = vi.fn()
const forkSessionMock = vi.fn()
const loadSessionMock = vi.fn()
const deleteSessionMock = vi.fn()
const initializeSessionMock = vi.fn()
const disposeSessionMock = vi.fn()
const ensureCurrentSessionMock = vi.fn()
const getChatProviderInstanceMock = vi.fn()
const pushMessageToCloudMock = vi.fn()
/** Control records that the chat store asked the session store to persist. */
const controlRecords: unknown[] = []
const getToolsByNamesMock = vi.fn<(names: string[]) => Tool[]>()
const visionMocks = vi.hoisted(() => ({ configured: false, model: 'system', runInference: vi.fn(), useForToolImages: true }))
/** A catalog model can omit its abilities, as most provider catalogs do. */
interface CatalogModel { id: string, inputModalities?: string[], metadata: { abilities?: { vision: boolean } } }
const consciousnessModels = vi.hoisted(() => ({ value: [{ id: 'gpt-test', metadata: { abilities: { vision: false } } }] as CatalogModel[] }))

const activeSessionIdRef = ref('session-1')
const activeProviderRef = ref('mock-provider')
const cardSelections = new Map<string, { provider: string, model: string }>()
const sessionSystemPrompts = new Map<string, string>()
/** The stage contract that the chat store passed to the session store, which ends every session system prompt. */
const stageContract = { value: '' }
const activeModelRef = ref('gpt-test')
const chatReadyRef = computed(() => !!activeProviderRef.value && !!activeModelRef.value)
const streamingMessageRef = ref<any>({ role: 'assistant', content: '', slices: [], tool_results: [] })
// The chat session store keeps messages in reactive state, so the mock does too.
const sessionMessages = reactive<Record<string, any[]>>({})
let currentGeneration = 1

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return {
    ...actual,
    storeToRefs: (store: any) => store,
  }
})

vi.mock('../composables', () => ({
  getConversationAnalyticsSurface: () => 'web',
}))

vi.mock('../libs/product-signals', () => ({
  getAnalytics: () => ({
    emit: (event: { name: string }, properties: unknown) => {
      switch (event.name) {
        case 'message_round':
          chatAnalyticsMocks.trackMessageRound(properties)
          break
        case 'message_round_failed':
          chatAnalyticsMocks.trackMessageRoundFailed(properties)
          break
        case 'message_sent':
          chatAnalyticsMocks.trackMessageSent(properties)
          break
        default:
          return false
      }

      return true
    },
    recordFirstMessage: trackFirstMessageMock,
  }),
}))

vi.mock('../composables/use-io-tracer', () => ({
  registerTurnSpan: ioTracerMocks.registerTurnSpan,
  startSpan: ioTracerMocks.startSpanMock,
  takeVoiceTurnParent: ioTracerMocks.takeVoiceTurnParent,
  takeComposerVoiceParent: ioTracerMocks.takeComposerVoiceParent,
}))

vi.mock('./chat/context-providers', () => ({
  createUserAccountContext: () => createUserAccountContextMock(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('en'),
    t: (key: string) => key,
    te: () => true,
  }),
}))

vi.mock('./chat/context-store', () => ({
  useChatContextStore: () => ({
    ingestContextMessage: ingestContextMessageMock,
    getContextsSnapshot: getContextsSnapshotMock,
  }),
}))

// IndexedDB is a browser boundary. Browser tests exercise the real sticker repository.
vi.mock('../database/repos/chat-assets.repo')

vi.mock('../database/repos/stickers.repo', () => ({
  stickersRepo: { read: async () => ({ records: [], images: [] }) },
}))

vi.mock('./modules/vision', () => ({
  useVisionStore: () => ({
    get configured() {
      return visionMocks.configured
    },
    activeProvider: 'apple-vision',
    get activeModel() {
      return visionMocks.model
    },
    useForChat: true,
    get useForToolImages() {
      return visionMocks.useForToolImages
    },
  }),
}))

vi.mock('../composables/vision/use-vision-inference', () => ({
  useVisionInference: () => ({ runVisionInference: visionMocks.runInference }),
}))

vi.mock('./chat/session-store', () => ({
  useChatSessionStore: () => ({
    activeSessionId: activeSessionIdRef,
    sessionMessages,
    storeMessage: async (sessionId: string, message: ChatHistoryItem & { id: string }) => {
      const messages = sessionMessages[sessionId] ?? []
      const index = messages.findIndex(item => item.id === message.id)
      sessionMessages[sessionId] = index < 0 ? [...messages, message] : messages.with(index, message)
    },
    updateUserMessage: async (sessionId: string, messageId: string, fields: Partial<ChatHistoryItem>) => {
      sessionMessages[sessionId] = (sessionMessages[sessionId] ?? []).map(message => message.id === messageId ? { ...toRaw(message), ...fields } as ChatHistoryItem : message)
    },
    replaceSessionHistory: async (sessionId: string, messages: ChatHistoryItem[]) => {
      sessionMessages[sessionId] = messages
    },
    commitUserMessage: (async (sessionId, message) => {
      sessionMessages[sessionId] ??= []
      const existing = sessionMessages[sessionId].some(item => item.id === message.id)
      if (!existing)
        sessionMessages[sessionId].push(message)
      await persistSessionMessagesMock(sessionId)
      return { status: existing ? 'existing' : 'inserted', messageId: message.id }
    }) satisfies ChatOrchestratorSessionPort['commitUserMessage'],
    clearSessionMessages: async (sessionId: string) => {
      sessionMessages[sessionId] = []
    },
    sessionMetas: { 'session-1': { characterId: 'alice' }, 'session-2': { characterId: 'bob' }, 'session-b': { characterId: 'bob' }, 'session-forked': { characterId: 'alice' } },
    getSessionMessages: (sessionId: string) => sessionMessages[sessionId] ?? [],
    // Mirrors the session store: the character prompt, then the stage contract that the chat store set.
    getSessionSystemPrompt: (sessionId: string) => [sessionSystemPrompts.get(sessionId) ?? 'system prompt', stageContract.value].filter(Boolean).join('\n\n'),
    setStageContract: (contract: string) => {
      stageContract.value = contract
    },
    getSessionMessagesIfLoaded: (sessionId: string) => sessionMessages[sessionId],
    loadSession: loadSessionMock,
    deleteSession: deleteSessionMock,
    initialize: initializeSessionMock,
    dispose: disposeSessionMock,
    ensureCurrentSession: ensureCurrentSessionMock,
    persistSessionMessages: persistSessionMessagesMock,
    getSessionGeneration: () => currentGeneration,
    forkSession: forkSessionMock,
    deleteMessage: async ({ sessionId, messageId }: { sessionId: string, messageId: string }) => {
      sessionMessages[sessionId] = (sessionMessages[sessionId] ?? []).filter(message => message.id !== messageId)
    },
    // Cloud sync surface used by `chat.ts performSend`. Mocked as a no-op so
    // the orchestrator contract tests do not need a real WS / cloud mapper.
    pushMessageToCloud: pushMessageToCloudMock,
    recordInterruption: async (event: unknown) => {
      controlRecords.push(event)
      return { status: 'queued' }
    },
    recordUnpromptedDecline: async (event: unknown) => {
      controlRecords.push(event)
      return { status: 'queued' }
    },
  }),
}))

vi.mock('./chat/stream-store', () => ({
  useChatStreamStore: () => ({
    streamingMessage: streamingMessageRef,
    activeTurns: [],
    updateActiveTurns: vi.fn(),
  }),
}))

vi.mock('./ai/chat-llm/llm', () => ({
  useLLM: () => ({
    stream: llmStreamMock,
  }),
}))

vi.mock('./ai/chat-llm/tools', () => ({
  useLlmToolsStore: () => ({
    activeTools: [],
    getToolsByNames: (...names: string[]) => getToolsByNamesMock(names),
    tools: [{ function: { name: 'computer_use' }, requiresExplicitSelection: true }],
  }),
}))

vi.mock('./ai/chat-llm/toolset-prompts', () => ({
  useLlmToolsetPromptsStore: () => ({
    activeToolsetPrompt: 'Plugin toolset guidance.',
  }),
}))

vi.mock('./modules/consciousness', () => ({
  useConsciousnessStore: () => ({
    activeModel: activeModelRef,
    activeProvider: activeProviderRef,
    chatReady: chatReadyRef,
    providerModels: consciousnessModels.value,
    getModelsForProvider: async () => consciousnessModels.value,
    getChatProviderInstance: (providerId: string) => getChatProviderInstanceMock(providerId, {
      reasoning: useConsciousnessSettingsStore().reasoning ? 'enabled' : 'disabled',
    }),
  }),
}))

vi.mock('./modules/airi-card', () => ({
  useAiriCardStore: () => ({
    activeCard: undefined,
    getCard: () => undefined,
    getModules: (id: string) => ({
      consciousness: cardSelections.get(id) ?? { provider: activeProviderRef.value, model: activeModelRef.value },
      vision: { provider: visionMocks.configured ? 'vision-provider' : '', model: visionMocks.configured ? 'vision-model' : '' },
    }),
  }),
}))

vi.mock('./modules/artistry-autonomous', () => ({
  useAutonomousArtistryStore: () => ({
    runArtistTask: vi.fn(),
  }),
}))

// The chat orchestrator instantiates the web-search store for its side effect
// (registering the web-search toolset prompt); stub it so the contract test does
// not pull in the real store's toolset-prompt watcher.
vi.mock('./modules/web-search', () => ({
  useWebSearchStore: () => ({}),
}))

const provider: GenerationProvider = {
  generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.com/' } }),
}

/** An assistant message whose stored tool result holds an original screenshot. */
function storedToolImageMessage() {
  return {
    role: 'assistant',
    id: 'assistant-1',
    content: '',
    createdAt: 3,
    slices: [],
    tool_results: [],
    generationTranscript: {
      type: 'assistant',
      id: 'assistant-1',
      status: 'completed',
      rounds: [{
        id: 'round-1',
        content: [{ type: 'tool', invocationId: 'invocation-1' }],
        projectionIssues: [],
        toolInvocations: [{ id: 'invocation-1', callId: 'call-1', name: 'computer_use_read_image', arguments: '{}', execution: { status: 'succeeded', output: [{ type: 'image', url: 'data:image/png;base64,aW1hZ2U=' }] } }],
      }],
    },
  }
}

/** Makes this window the situation leader for one test, so requests carry the situation block. */
function leadSituation() {
  const store = useSituationStore()
  store.initialize(createLeaderRuntime())
  // The leader owns a 1 s ticker; stop it even when an assertion fails.
  onTestFinished(() => store.dispose())
}

/** A synced runtime in which this window leads. */
function createLeaderRuntime(): SyncedPiniaRuntime {
  return {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: vi.fn(() => true),
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(true)
      return vi.fn()
    }),
    participantId: 'chat-situation-test',
    plugin: vi.fn(),
  }
}

describe('chat store contract', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    llmStreamMock.mockReset()
    trackFirstMessageMock.mockReset()
    for (const analyticsMock of Object.values(chatAnalyticsMocks))
      analyticsMock.mockReset()
    redundantChatAnalyticsMocks.trackAssistantResponseCompleted.mockReset()
    redundantChatAnalyticsMocks.trackChatFailed.mockReset()
    redundantChatAnalyticsMocks.trackChatStarted.mockReset()
    redundantChatAnalyticsMocks.trackFeatureUsed.mockReset()
    ingestContextMessageMock.mockReset()
    getContextsSnapshotMock.mockReset()
    getContextsSnapshotMock.mockReturnValue({})
    createUserAccountContextMock.mockReset().mockReturnValue(null)
    persistSessionMessagesMock.mockReset()
    forkSessionMock.mockReset()
    loadSessionMock.mockReset().mockResolvedValue(true)
    deleteSessionMock.mockReset().mockResolvedValue(undefined)
    initializeSessionMock.mockReset().mockResolvedValue(undefined)
    disposeSessionMock.mockReset()
    ensureCurrentSessionMock.mockReset().mockResolvedValue('session-1')
    getChatProviderInstanceMock.mockReset().mockResolvedValue(provider)
    pushMessageToCloudMock.mockReset().mockResolvedValue(undefined)
    controlRecords.length = 0
    getToolsByNamesMock.mockReset().mockImplementation(names => names.map(name => ({
      type: 'function',
      function: {
        name,
        parameters: { type: 'object', properties: {} },
      },
      execute: vi.fn(),
    })))
    visionMocks.configured = false
    visionMocks.model = 'system'
    visionMocks.useForToolImages = true
    visionMocks.runInference.mockReset()
    consciousnessModels.value = [{ id: 'gpt-test', metadata: { abilities: { vision: false } } }]
    ioTracerMocks.turnSpans.clear()
    ioTracerMocks.spans.length = 0
    ioTracerMocks.startSpanMock.mockClear()
    ioTracerMocks.takeVoiceTurnParent.mockReset()
    ioTracerMocks.takeComposerVoiceParent.mockReset()
    activeSessionIdRef.value = 'session-1'
    activeProviderRef.value = 'mock-provider'
    cardSelections.clear()
    sessionSystemPrompts.clear()
    stageContract.value = ''
    streamingMessageRef.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
    currentGeneration = 1

    for (const key of Object.keys(sessionMessages)) {
      delete sessionMessages[key]
    }

    sessionMessages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
  })

  it('cancels a named submission while session preparation is pending', async () => {
    const loading = Promise.withResolvers<boolean>()
    loadSessionMock.mockReturnValueOnce(loading.promise)
    const store = useChatStore()
    const submission = store.submit({ sessionId: 'session-1', messageId: 'pending-input', text: 'Stop this request' })
    const rejected = expect(submission).rejects.toThrow('Chat turn cancelled')
    await store.cancelTurn({ sessionId: 'session-1', turnId: 'pending-input' })
    loading.resolve(true)
    await rejected
    expect(llmStreamMock).not.toHaveBeenCalled()
    expect(sessionMessages['session-1'].some(message => message.id === 'pending-input')).toBe(false)
  })

  it('waits for the transcript of a submitted voice message instead of transcribing the file', async () => {
    const requests: Conversation[] = []
    llmStreamMock.mockImplementation(async (model: string, chatProvider: GenerationProvider, context: Conversation, options: LlmStreamOptions) => {
      requests.push(await options.prepareConversation!(context, { model, providerId: options.providerId, request: chatProvider.generation(model) }))
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    await store.submit({
      sessionId: 'session-1',
      messageId: 'voice-1',
      text: '',
      attachments: [{ type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' }],
      audioTranscriptPending: true,
    })

    // The message is in the chat at once. The text-only model waits for its transcript.
    expect(sessionMessages['session-1'].some(message => message.id === 'voice-1')).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(llmStreamMock).not.toHaveBeenCalled()

    await store.settleAudioTranscript({ sessionId: 'session-1', messageId: 'voice-1', transcript: 'hello there' })

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].turns.findLast(turn => turn.type === 'user')).toMatchObject({
      content: expect.arrayContaining([{ type: 'text', text: 'hello there' }]),
    })
    expect(sessionMessages['session-1'].find(message => message.id === 'voice-1')?.audioTranscripts).toEqual(['hello there'])
  })

  it('removes a submitted voice message whose transcript has no speech', async () => {
    const store = useChatStore()
    await store.submit({
      sessionId: 'session-1',
      messageId: 'voice-silent',
      text: '',
      attachments: [{ type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' }],
      audioTranscriptPending: true,
    })

    await store.settleAudioTranscript({ sessionId: 'session-1', messageId: 'voice-silent', transcript: '' })

    // The turn ends without a reply or an error message.
    expect(sessionMessages['session-1']).toEqual([{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }])
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('uses the target character settings for a text send to another session', async () => {
    cardSelections.set('bob', { provider: 'bob-provider', model: 'bob-model' })
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    await store.send({ sessionId: 'session-2', text: 'For Bob' })

    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('bob-provider', { reasoning: 'disabled' })
    expect(getChatProviderInstanceMock).not.toHaveBeenCalledWith('mock-provider', expect.anything())
    expect(llmStreamMock.mock.calls[0]?.[0]).toBe('bob-model')
    expect(activeSessionIdRef.value).toBe('session-1')
  })

  it('keeps a queued typed turn on its session character after the active card changes', async () => {
    cardSelections.set('alice', { provider: 'alice-provider', model: 'alice-model' })
    const firstStream = Promise.withResolvers<void>()
    const steps: Array<{ model: string, providerId: string }> = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      if (llmStreamMock.mock.calls.length === 1)
        await firstStream.promise
      const step = await options.resolveStep!()
      steps.push({ model: step.model, providerId: step.providerId })
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    const first = store.send({ sessionId: 'session-1', text: 'First' })
    await vi.waitFor(() => expect(llmStreamMock).toHaveBeenCalledOnce())
    const queued = store.send({ sessionId: 'session-1', text: 'Queued' })
    await vi.waitFor(() => expect(store.pendingQueuedSendCount).toBe(1))

    // Selecting another card writes its selection into the active consciousness settings.
    activeProviderRef.value = 'selected-card-provider'
    activeModelRef.value = 'selected-card-model'
    try {
      firstStream.resolve()
      await Promise.all([first, queued])
    }
    finally {
      activeModelRef.value = 'gpt-test'
    }

    expect(llmStreamMock.mock.calls[1]?.[0]).toBe('alice-model')
    expect(steps).toEqual([
      { model: 'alice-model', providerId: 'alice-provider' },
      { model: 'alice-model', providerId: 'alice-provider' },
    ])
    expect(getChatProviderInstanceMock).not.toHaveBeenCalledWith('selected-card-provider', expect.anything())
  })

  it('reads the session character settings and prompt again before each model step', async () => {
    cardSelections.set('alice', { provider: 'alice-provider', model: 'alice-model' })
    sessionSystemPrompts.set('session-1', 'Alice prompt')
    const steps: Awaited<ReturnType<NonNullable<StreamOptions['resolveStep']>>>[] = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      steps.push(await options.resolveStep!())
      // A tool round edits the character before the next model request.
      cardSelections.set('alice', { provider: 'official-provider', model: 'chat-auto' })
      sessionSystemPrompts.set('session-1', 'Edited Alice prompt')
      steps.push(await options.resolveStep!())
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'Use a tool' })

    expect(steps[0]).toMatchObject({ model: 'alice-model', providerId: 'alice-provider', systemPrompt: `Alice prompt\n\n${stageContract.value}\n\nPlugin toolset guidance.` })
    expect(steps[0]?.headers).not.toHaveProperty(AIRI_CHAT_SESSION_ID_HEADER)
    expect(steps[1]).toMatchObject({ model: 'chat-auto', providerId: 'official-provider', systemPrompt: `Edited Alice prompt\n\n${stageContract.value}\n\nPlugin toolset guidance.` })
    expect(steps[1]?.headers).toMatchObject({
      [AIRI_CHAT_SESSION_ID_HEADER]: 'session-1',
      [AIRI_CHAT_ROUND_ID_HEADER]: expect.any(String),
    })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('official-provider', { reasoning: 'disabled' })
  })

  it('projects stored audio again when a tool step changes to a text-only model', async () => {
    cardSelections.set('alice', { provider: 'mock-provider', model: 'audio-model' })
    consciousnessModels.value = [
      { id: 'audio-model', inputModalities: ['text', 'audio'], metadata: {} },
      { id: 'text-model', inputModalities: ['text'], metadata: {} },
    ]
    const requests: Conversation[] = []
    llmStreamMock.mockImplementation(async (model: string, chatProvider: GenerationProvider, context: Conversation, options: LlmStreamOptions) => {
      requests.push(await options.prepareConversation!(context, { model, providerId: options.providerId, request: chatProvider.generation(model) }))
      // Core passes a new conversation with the completed tool round after a scope change.
      const continued: Conversation = { turns: [...context.turns] }
      requests.push(await options.prepareConversation!(continued, { model: 'text-model', providerId: 'mock-provider', request: chatProvider.generation('text-model') }))
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: '',
      attachments: [{ type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==', transcript: 'spoken words' }],
    })

    expect(requests[0]?.turns.findLast(turn => turn.type === 'user')?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'audio' }),
    ]))
    expect(requests[1]?.turns.findLast(turn => turn.type === 'user')?.content).toEqual(expect.arrayContaining([
      { type: 'text', text: 'spoken words' },
    ]))
    expect(requests[1]?.turns.findLast(turn => turn.type === 'user')?.content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'audio' }),
    ]))
  })

  it('uses the target character settings for a voice submission', async () => {
    cardSelections.set('bob', { provider: 'bob-provider', model: 'bob-model' })
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    await store.submit({ sessionId: 'session-2', messageId: 'bob-voice', text: 'For Bob' })

    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('bob-provider', { reasoning: 'disabled' })
    expect(llmStreamMock.mock.calls[0]?.[0]).toBe('bob-model')
    expect(activeSessionIdRef.value).toBe('session-1')
  })

  it('resolves the provider and rebuilds prior tools inside the serializable send action', async () => {
    const resolvedToolNames: string[][] = []
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      const tools = typeof options.tools === 'function' ? await options.tools() : options.tools
      resolvedToolNames.push(tools.map((tool: Tool) => tool.function.name))
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()
    const result = await store.send({
      sessionId: 'session-1',
      text: 'show a widget',
      tools: [{ name: 'stage_widgets' }],
    })
    await store.send({
      sessionId: 'session-1',
      text: 'continue',
    })

    expect(getChatProviderInstanceMock).toHaveBeenCalledTimes(2)
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'disabled' })
    expect(() => structuredClone(result)).not.toThrow()
    // The session character's wake word tool joins every turn. It is not a selectable stored tool.
    expect(resolvedToolNames).toEqual([
      ['stage_widgets', 'configure_wake_words'],
      ['stage_widgets', 'configure_wake_words'],
    ])
  })

  it('preserves image attachments when retrying a failed turn', async () => {
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
        ],
        id: 'user-image',
      },
      { role: 'error', content: 'Provider failed' },
    ]

    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 2 })

    // The retried turn stores the image as an asset reference. The provider still receives its bytes.
    const retried = sessionMessages['session-1'].findLast(message => message.role === 'user')
    expect(retried.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^airi-asset:[0-9a-f]{64}$/) } },
    ])
    const context = llmStreamMock.mock.calls.at(-1)![2] as Conversation
    expect(context.turns.findLast(turn => turn.type === 'user')).toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ type: 'image', url: 'data:image/png;base64,aW1hZ2U=' })]),
    })
  })

  // ROOT CAUSE:
  //
  // A retry that failed before storage lost its source turn and recording.
  // Retry cut the history, then only appended an error:
  //
  // replaceSessionHistory(sessionId, currentMessages.slice(0, sourceIndex))
  //
  // We fixed this by restoring the history when the storage receipt rejects.
  it('keeps the source turn when a retry fails before its new turn is stored', async () => {
    const recording = {
      role: 'user',
      content: [{ type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } }],
      id: 'user-recording',
    }
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      recording,
      { role: 'error', content: 'Provider failed' },
    ]
    getChatProviderInstanceMock.mockResolvedValueOnce(undefined)

    const store = useChatStore()
    await expect(store.retry({ sessionId: 'session-1', index: 2 })).rejects.toThrow('Failed to resolve chat provider')

    expect(sessionMessages['session-1']).toMatchObject([
      { role: 'system', id: 'system' },
      recording,
      { role: 'error', content: 'Provider failed' },
      { role: 'error', content: 'Failed to resolve chat provider "mock-provider"' },
    ])
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('cancels vision preprocessing when its chat turn is cancelled', async () => {
    visionMocks.configured = true
    let visionSignal: AbortSignal | undefined
    visionMocks.runInference.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => new Promise<string>((_resolve, reject) => {
      visionSignal = abortSignal
      abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
    }))

    const store = useChatStore()
    const sending = store.send({
      sessionId: 'session-1',
      text: 'Read this',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    })
    await vi.waitFor(() => expect(visionSignal).toBeDefined())

    await store.cancelPendingSends('session-1')

    await sending
    expect(visionSignal?.aborted).toBe(true)
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('routes cancellation from a follower window to the leader runtime', async () => {
    // ROOT CAUSE:
    //
    // The Electron chat window owns a follower-only Pinia runtime. Calling an
    // unsynchronized cancellation action there only reached its idle local
    // chat runtime, so the leader window kept generating the LLM response.
    //
    // Cancellation is now a synchronized action. The follower RPC reaches the
    // leader-owned AbortController and waits for the active send to settle.
    const namespace = `chat-cancellation:${crypto.randomUUID()}`
    const leaderPinia = createPinia()
    const leaderRuntime = createSyncedPiniaPlugin({
      callTimeout: 1000,
      leadership: 'leader-only',
      namespace,
    })
    leaderPinia.use(leaderRuntime.plugin)
    createApp({}).use(leaderPinia)

    const followerPinia = createPinia()
    const followerRuntime = createSyncedPiniaPlugin({
      callTimeout: 1000,
      leadership: 'follower-only',
      namespace,
    })
    followerPinia.use(followerRuntime.plugin)
    createApp({}).use(followerPinia)

    try {
      await vi.waitFor(() => expect(leaderRuntime.isLeader()).toBe(true))

      setActivePinia(leaderPinia)
      const leaderStore = useChatStore()

      setActivePinia(followerPinia)
      const followerStore = useChatStore()
      await vi.waitFor(() => expect(followerRuntime.getLeaderId()).toBe(leaderRuntime.participantId))

      let leaderSignal: AbortSignal | undefined
      llmStreamMock.mockImplementationOnce(async (_model, _provider, _messages, options: StreamOptions) => {
        leaderSignal = options.abortSignal
        await new Promise<void>((resolve) => {
          if (options.abortSignal?.aborted) {
            resolve()
            return
          }
          options.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
        })
      })

      setActivePinia(followerPinia)
      const sending = followerStore.send({
        sessionId: 'session-1',
        text: 'keep generating',
      })
      await vi.waitFor(() => expect(leaderSignal).toBeDefined())

      await followerStore.cancelPendingSends('session-1')
      await sending

      expect(leaderSignal?.aborted).toBe(true)
      expect(leaderStore.sending).toBe(false)
    }
    finally {
      followerRuntime.dispose()
      leaderRuntime.dispose()
      disposePinia(followerPinia)
      disposePinia(leaderPinia)
    }
  })

  it('runs a follower send once when a new leader receives it again, so the next send waits behind no replay', async () => {
    // A leader reload ends the leader mid-reply. tab-election then sends every call that was still in flight to the new
    // leader again (at-least-once delivery). The new leader must find the stored user message and run no second turn.
    const namespace = `chat-redelivery:${crypto.randomUUID()}`
    // The follower's call outlives the leader change. The new leader stops waiting for its predecessor's state after 1 s.
    const mountRuntime = (leadership: 'leader-only' | 'follower-only', callTimeout: number) => {
      const pinia = createPinia()
      const runtime = createSyncedPiniaPlugin({ callTimeout, leadership, namespace })
      pinia.use(runtime.plugin)
      createApp({}).use(pinia)
      return { pinia, runtime }
    }
    const first = mountRuntime('leader-only', 1000)
    const follower = mountRuntime('follower-only', 20_000)
    let second: ReturnType<typeof mountRuntime> | undefined
    const stalled = Promise.withResolvers<void>()
    const prompts: string[] = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, context: Conversation, options: StreamOptions) => {
      const user = JSON.stringify(context.turns.findLast(turn => turn.type === 'user')?.content)
      prompts.push(user.includes('first question') ? 'first' : user.includes('second question') ? 'second' : 'other')
      // The first leader never finishes its reply: its page reloads mid-reply.
      if (prompts.length === 1)
        await stalled.promise
      await options.onStreamEvent?.({ type: 'finish' })
    })

    try {
      await vi.waitFor(() => expect(first.runtime.isLeader()).toBe(true))
      setActivePinia(first.pinia)
      useChatStore()
      setActivePinia(follower.pinia)
      const followerStore = useChatStore()
      await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(first.runtime.participantId))

      const firstSend = followerStore.send({ sessionId: 'session-1', text: 'first question' })
      await vi.waitFor(() => expect(prompts).toEqual(['first']))
      first.runtime.dispose()
      disposePinia(first.pinia)

      second = mountRuntime('leader-only', 1000)
      setActivePinia(second.pinia)
      useChatStore()
      await vi.waitFor(() => expect(second!.runtime.isLeader()).toBe(true), { timeout: 5000 })
      await firstSend
      setActivePinia(follower.pinia)
      await followerStore.send({ sessionId: 'session-1', text: 'second question' })

      const userTexts = (sessionMessages['session-1'] ?? []).filter(message => message.role === 'user').map(message => JSON.stringify(message.content))
      expect(userTexts.filter(text => text.includes('first question'))).toHaveLength(1)
      expect(userTexts.filter(text => text.includes('second question'))).toHaveLength(1)
      // The new leader generated no replay of the first turn, so the second turn ran next.
      expect(prompts).toEqual(['first', 'second'])
    }
    finally {
      stalled.resolve()
      follower.runtime.dispose()
      second?.runtime.dispose()
      disposePinia(follower.pinia)
      if (second)
        disposePinia(second.pinia)
    }
  })

  it('marks a follower send whose reply a leader change cut off, so the user sees it and can retry', async () => {
    // A leader reload cuts off the reply, or comes before the reply reached the model. The new leader receives the send
    // again and finds the stored message. It generates nothing, so without a mark the user's message stays unanswered.
    const namespace = `chat-cut-off:${crypto.randomUUID()}`
    const mountRuntime = (leadership: 'leader-only' | 'follower-only', callTimeout: number) => {
      const pinia = createPinia()
      const runtime = createSyncedPiniaPlugin({ callTimeout, leadership, namespace })
      pinia.use(runtime.plugin)
      createApp({}).use(pinia)
      return { pinia, runtime }
    }
    const first = mountRuntime('leader-only', 1000)
    const follower = mountRuntime('follower-only', 20_000)
    let second: ReturnType<typeof mountRuntime> | undefined
    const stalled = Promise.withResolvers<void>()
    let prompts = 0
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      prompts += 1
      // The first leader's page reloads before it has a reply.
      if (prompts === 1)
        await stalled.promise
      await options.onStreamEvent?.({ type: 'finish' })
    })

    try {
      await vi.waitFor(() => expect(first.runtime.isLeader()).toBe(true))
      setActivePinia(first.pinia)
      useChatStore()
      setActivePinia(follower.pinia)
      const followerStore = useChatStore()
      await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(first.runtime.participantId))

      const send = followerStore.send({ sessionId: 'session-1', text: 'cut off question' })
      await vi.waitFor(() => expect(prompts).toBe(1))
      first.runtime.dispose()
      disposePinia(first.pinia)
      second = mountRuntime('leader-only', 1000)
      setActivePinia(second.pinia)
      useChatStore()
      await vi.waitFor(() => expect(second!.runtime.isLeader()).toBe(true), { timeout: 5000 })
      await send

      const messages = sessionMessages['session-1'] ?? []
      const question = messages.findIndex(message => message.role === 'user' && JSON.stringify(message.content).includes('cut off question'))
      expect(question).toBeGreaterThan(-1)
      // The error item carries the retry action, which sends the user message before it again.
      expect(messages.slice(question + 1)).toEqual([expect.objectContaining({ role: 'error', content: 'stage.chat.reply-cut-off' })])
      expect(prompts).toBe(1)
    }
    finally {
      stalled.resolve()
      follower.runtime.dispose()
      second?.runtime.dispose()
      disposePinia(follower.pinia)
      if (second)
        disposePinia(second.pinia)
    }
  })

  it('starts chat-model telemetry and captures the provider prompt after vision preprocessing', async () => {
    visionMocks.configured = true
    let resolveVision!: (description: string) => void
    visionMocks.runInference.mockReturnValue(new Promise<string>((resolve) => {
      resolveVision = resolve
    }))
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    const sending = store.send({
      sessionId: 'session-1',
      text: 'Read this',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    })
    await vi.waitFor(() => expect(visionMocks.runInference).toHaveBeenCalledOnce())

    expect(ioTracerMocks.spans.some(span => span.name === IOSpanNames.LLMInference)).toBe(false)
    expect(llmStreamMock).not.toHaveBeenCalled()

    resolveVision('A red square.')
    await sending

    expect(ioTracerMocks.spans.some(span => span.name === IOSpanNames.LLMInference)).toBe(true)
    expect(useContextObservabilityStore().lastPromptProjection?.composedMessage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('A red square.'),
      }),
    ]))
    expect(useContextObservabilityStore().lastPromptProjection).toMatchObject({ sessionId: 'session-1', turnId: expect.any(String), origin: 'user' })
  })

  it('reuses a persisted image description on later turns', async () => {
    // ROOT CAUSE:
    //
    // The provider projection replaced images for one request. History kept
    // only the image, so later turns ran vision again for the same attachment.
    //
    // We fixed this by storing the description with its user message. Later
    // provider projections reuse the stored value.
    visionMocks.configured = true
    visionMocks.runInference.mockResolvedValue('A red square.')
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    const result = await store.send({
      sessionId: 'session-1',
      text: 'Read this',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    })
    await store.send({
      sessionId: 'session-1',
      text: 'What color was it?',
    })

    // Storing the description spread the reactive message. Its content array
    // stayed a proxy, and `structuredClone` rejected the send result.
    expect(() => structuredClone(result)).not.toThrow()
    expect(visionMocks.runInference).toHaveBeenCalledOnce()
    expect(sessionMessages['session-1'].find(message => message.role === 'user' && Array.isArray(message.content))?.imageDescriptions).toEqual([
      {
        description: 'A red square.',
        imageIndex: 0,
      },
    ])
  })

  it('reports a failed read of the current image and stores no description', async () => {
    // ROOT CAUSE:
    //
    // An earlier fix stored each failed read as the image description. A
    // temporary failure then hid the image for good, and the send reported no error.
    visionMocks.configured = true
    visionMocks.runInference.mockRejectedValue(new Error('Vision inference timed out after 60000ms'))

    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'Read this',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    })).rejects.toThrow('Vision inference timed out after 60000ms')

    expect(sessionMessages['session-1'].find(message => message.role === 'user')?.imageDescriptions).toBeUndefined()
  })

  it('reads a failed earlier image once for each vision selection', async () => {
    // ROOT CAUSE:
    //
    // Nothing kept a failed read, so each later turn read the same earlier
    // image again and failed, even a text message.
    visionMocks.configured = true
    visionMocks.runInference.mockRejectedValue(new Error('Vision inference timed out after 60000ms'))
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'Read this',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    })).rejects.toThrow()
    await store.send({ sessionId: 'session-1', text: 'Hello again' })

    expect(visionMocks.runInference).toHaveBeenCalledOnce()
    expect(useContextObservabilityStore().lastPromptProjection?.composedMessage).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.stringContaining('The vision model failed to read it.') }),
    ]))

    visionMocks.model = 'another-model'
    visionMocks.runInference.mockResolvedValue('A red square.')
    await store.send({ sessionId: 'session-1', text: 'Try again' })

    expect(visionMocks.runInference).toHaveBeenCalledTimes(2)
    expect(sessionMessages['session-1'].find(message => message.role === 'user' && Array.isArray(message.content))?.imageDescriptions)
      .toEqual([{ description: 'A red square.', imageIndex: 0 }])
  })

  it('forgets the failed reads of a deleted session', async () => {
    visionMocks.configured = true
    visionMocks.runInference.mockRejectedValue(new Error('Vision inference timed out after 60000ms'))
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const imageMessage = { role: 'user', content: [{ type: 'text', text: 'Read this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }], createdAt: 2 }
    const store = useChatStore()
    sessionMessages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }, { ...imageMessage }]
    await store.send({ sessionId: 'session-1', text: 'Hello' })

    await store.deleteSession('session-1')
    sessionMessages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }, { ...imageMessage }]
    await store.send({ sessionId: 'session-1', text: 'Hello' })

    expect(visionMocks.runInference).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed earlier read inside its session', async () => {
    // ROOT CAUSE:
    //
    // A stored message without an id gets its turn id from its position. The
    // failed read of one session then skipped the image at that position in
    // another session.
    visionMocks.configured = true
    visionMocks.runInference.mockRejectedValue(new Error('Vision inference timed out after 60000ms'))
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    for (const sessionId of ['session-1', 'session-2']) {
      sessionMessages[sessionId] = [
        { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
        { role: 'user', content: [{ type: 'text', text: 'Read this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }], createdAt: 2 },
      ]
    }

    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'Hello' })
    await store.send({ sessionId: 'session-2', text: 'Hello' })

    expect(visionMocks.runInference).toHaveBeenCalledTimes(2)
  })

  it('reads tool images with the vision model only for a chat model that cannot see them', async () => {
    visionMocks.configured = true
    visionMocks.runInference.mockResolvedValue('A settings window.')
    const toolImageReaders: Array<LlmStreamOptions['describeToolImage']> = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: LlmStreamOptions) => {
      toolImageReaders.push(options.describeToolImage)
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'Look at my screen' })

    expect(await toolImageReaders[0]?.('data:image/png;base64,aW1hZ2U=')).toBe('A settings window.')
    expect(visionMocks.runInference).toHaveBeenCalledWith(expect.objectContaining({ workloadId: 'tool:image' }))
  })

  it('stores the description of an image that a rerun tool returns', async () => {
    // ROOT CAUSE:
    //
    // The rerun entry points resolved tools without the image reader. A rerun
    // stored the original screenshot, and the next turn sent it again.
    visionMocks.configured = true
    visionMocks.runInference.mockResolvedValue('A settings window.')
    getToolsByNamesMock.mockImplementation(() => [{
      type: 'function',
      function: { name: 'computer_use_read_image', parameters: {} },
      execute: async () => [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }],
    }])
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      {
        role: 'assistant',
        id: 'assistant-1',
        content: '',
        createdAt: 2,
        slices: [{ type: 'tool-call', toolCall: { toolCallId: 'call-1', toolCallType: 'function', toolName: 'computer_use_read_image', args: '{}' } }],
        tool_results: [],
      },
    ]

    await useChatStore().rerunToolCall({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      toolCallId: 'call-1',
      toolName: 'computer_use_read_image',
      args: '{}',
      tools: [{ name: 'computer_use_read_image' }],
    })

    const stored = JSON.stringify(sessionMessages['session-1'][1])
    expect(stored).not.toContain('data:image')
    expect(stored).toContain('A settings window.')
  })

  it('sends a note in place of a stored tool image while the vision model reads tool images', async () => {
    visionMocks.configured = true
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      { role: 'user', content: 'Look at my screen', createdAt: 2, id: 'user-1' },
      storedToolImageMessage(),
    ]

    await useChatStore().send({ sessionId: 'session-1', text: 'What did you see?' })

    const prompt = JSON.stringify(useContextObservabilityStore().lastPromptProjection?.composedMessage)
    expect(prompt).not.toContain('data:image')
    expect(prompt).toContain('A tool image was left out of the history.')
  })

  it('replays a stored tool image when no vision model reads tool images', async () => {
    // ROOT CAUSE:
    //
    // The note replaced stored tool images for each model without a declared
    // vision ability. Most catalogs omit it, so a model that sees images lost
    // its earlier screenshots and was told that it cannot see images.
    consciousnessModels.value = [{ id: 'gpt-test', metadata: {} }]
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      { role: 'user', content: 'Look at my screen', createdAt: 2, id: 'user-1' },
      storedToolImageMessage(),
    ]

    await useChatStore().send({ sessionId: 'session-1', text: 'What did you see?' })

    expect(JSON.stringify(useContextObservabilityStore().lastPromptProjection?.composedMessage)).not.toContain('left out')
  })

  it('leaves tool images alone when the tool image setting is off', async () => {
    visionMocks.configured = true
    visionMocks.useForToolImages = false
    const toolImageReaders: Array<LlmStreamOptions['describeToolImage']> = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: LlmStreamOptions) => {
      toolImageReaders.push(options.describeToolImage)
      await options.onStreamEvent?.({ type: 'finish' })
    })

    await useChatStore().send({ sessionId: 'session-1', text: 'Look at my screen' })

    expect(toolImageReaders).toEqual([undefined])
  })

  it('leaves tool images to a chat model that supports vision', async () => {
    visionMocks.configured = true
    consciousnessModels.value = [{ id: 'gpt-test', metadata: { abilities: { vision: true } } }]
    const toolImageReaders: Array<LlmStreamOptions['describeToolImage']> = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: LlmStreamOptions) => {
      toolImageReaders.push(options.describeToolImage)
      await options.onStreamEvent?.({ type: 'finish' })
    })

    await useChatStore().send({ sessionId: 'session-1', text: 'Look at my screen' })

    expect(toolImageReaders).toEqual([undefined])
  })

  it('sends images directly when the selected chat model supports vision', async () => {
    visionMocks.configured = true
    consciousnessModels.value = [{ id: 'gpt-test', metadata: { abilities: { vision: true } } }]
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, context: Conversation, options: StreamOptions) => {
      expect(context.turns.some(turn => turn.type === 'user' && turn.content.some(part => part.type === 'image'))).toBe(true)
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: 'Read this directly',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    })

    expect(visionMocks.runInference).not.toHaveBeenCalled()
  })

  // https://github.com/moeru-ai/airi/pull/2565#discussion_r4028809145
  it('does not restore request-only tools from session history', async () => {
    llmStreamMock.mockImplementation(async (_model: unknown, _provider: unknown, _messages: unknown, options: StreamOptions) => {
      if (typeof options.tools === 'function')
        await options.tools()
      await options.onStreamEvent?.({ type: 'finish' })
    })
    // ROOT CAUSE:
    // History retained tool selections and granted them to every later request.
    // Request-only tools must be selected again, even when history mentions them.
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'Inspect', tools: [{ name: 'computer_use' }] })
    getToolsByNamesMock.mockClear()
    await store.send({ sessionId: 'session-1', text: 'Continue', tools: [] })
    expect(getToolsByNamesMock).toHaveBeenCalledWith([])
    getToolsByNamesMock.mockClear()
    await store.retry({ sessionId: 'session-1', index: 1 })
    expect(getToolsByNamesMock).toHaveBeenCalledWith([])
    await expect(store.rerunToolCall({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'computer_use',
      args: '{}',
      tools: [],
    })).rejects.toThrow('Select this tool before running it again.')
  })

  // https://github.com/moeru-ai/airi/pull/2394#discussion_r3883162024
  it('restarts chat consumers when this renderer becomes the leader', async () => {
    // ROOT CAUSE:
    //
    // The application stopped observing chat leadership changes. If the Web
    // leader closed, the promoted renderer kept the replicated session state
    // but did not start a new cloud WebSocket.
    //
    // The chat store now owns the leadership subscription. It starts the
    // session consumers after promotion and stops local consumers after
    // demotion or disposal.
    let leadershipListener: ((isLeader: boolean) => void) | undefined
    const stopLeadershipListener = vi.fn()
    const syncedPinia: SyncedPiniaRuntime = {
      dispose: vi.fn(),
      getLeaderId: vi.fn(),
      getParticipantCount: vi.fn(() => 1),
      isLeader: vi.fn(() => false),
      onCoordinationChange: vi.fn(() => vi.fn()),
      onLeadershipChange: vi.fn((listener) => {
        leadershipListener = listener
        listener(false)
        return stopLeadershipListener
      }),
      participantId: 'chat-test',
      plugin: vi.fn(),
    }
    const store = useChatStore()

    await store.initialize(syncedPinia)

    expect(initializeSessionMock).toHaveBeenCalledOnce()
    expect(disposeSessionMock).toHaveBeenCalledOnce()
    expect(ensureCurrentSessionMock).not.toHaveBeenCalled()

    leadershipListener?.(true)
    await vi.waitFor(() => expect(ensureCurrentSessionMock).toHaveBeenCalledOnce())

    leadershipListener?.(false)
    expect(disposeSessionMock).toHaveBeenCalledTimes(2)

    store.dispose()
    expect(stopLeadershipListener).toHaveBeenCalledOnce()
    expect(disposeSessionMock).toHaveBeenCalledTimes(3)
  })

  it('passes the current consciousness reasoning option to the chat provider', async () => {
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'reply without changing provider defaults' })

    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'enabled' })
    await settings.setReasoning(false)
  })

  it('passes a native reply relation to the chat runtime', async () => {
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      { role: 'assistant', content: 'Earlier answer', slices: [], tool_results: [], id: 'assistant-1' },
    ]
    llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()

    await store.send({
      sessionId: 'session-1',
      text: 'My follow-up',
      replyToMessageId: 'assistant-1',
    })

    expect(sessionMessages['session-1']?.find(message => message.role === 'user')).toMatchObject({
      content: 'My follow-up',
      replyToMessageId: 'assistant-1',
    })
  })

  // https://github.com/moeru-ai/airi/issues/2085
  it('hydrates the target session before sending for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // A synchronized follower could target a session known only by metadata.
    // Reading through getSessionMessages before hydration created a fresh
    // system-only history that could overwrite the persisted conversation.
    delete sessionMessages['session-2']
    loadSessionMock.mockImplementationOnce(async () => {
      sessionMessages['session-2'] = [
        { role: 'system', content: 'persisted system prompt', createdAt: 1, id: 'system-2' },
      ]
      return true
    })
    llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()
    await store.send({ sessionId: 'session-2', text: 'continue persisted chat' })

    expect(loadSessionMock).toHaveBeenCalledWith('session-2')
    // The user message commits after the history loads, so the commit never writes a history that did not load.
    expect(loadSessionMock.mock.invocationCallOrder[0]).toBeLessThan(persistSessionMessagesMock.mock.invocationCallOrder[0])
    expect(sessionMessages['session-2']?.[0]).toMatchObject({
      content: 'persisted system prompt',
      id: 'system-2',
    })
  })

  // https://github.com/moeru-ai/airi/issues/2085
  it('does not create fallback history when target hydration fails for Issue #2085', async () => {
    delete sessionMessages['session-2']
    loadSessionMock.mockResolvedValueOnce(false)

    const store = useChatStore()
    await expect(
      store.send({ sessionId: 'session-2', text: 'do not overwrite history' }),
    )
      .rejects
      .toThrow('Failed to load the target chat session')

    expect(sessionMessages['session-2']).toBeUndefined()
  })

  it('forwards one correlation identity across the action and result events', async () => {
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()
    await store.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const messageProperties = chatAnalyticsMocks.trackMessageSent.mock.calls[0]?.[0]
    expect(messageProperties).toMatchObject({
      conversation_id: 'session-1',
      round_id: messageProperties.message_id,
      turn_index: 1,
    })

    const correlation = {
      conversation_id: 'session-1',
      round_id: messageProperties.round_id,
      turn_index: 1,
    }
    expect(chatAnalyticsMocks.trackMessageRound).toHaveBeenCalledWith(expect.objectContaining(correlation))
  })

  it('keeps custom and official provider usage in completed message rounds', async () => {
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
      await options.onUsage({
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        source: 'reported',
      })
    })

    const store = useChatStore()
    await store.ingest('custom turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(chatAnalyticsMocks.trackMessageRound).toHaveBeenCalledTimes(1)
    expect(chatAnalyticsMocks.trackMessageRound).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-test',
      usage_source: 'reported',
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
    }))

    activeProviderRef.value = 'official-provider'
    await store.ingest('official turn', {
      model: 'chat-auto',
      chatProvider: provider,
    })

    expect(chatAnalyticsMocks.trackMessageRound).toHaveBeenCalledTimes(2)
    expect(chatAnalyticsMocks.trackMessageRound).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'chat-auto',
      total_tokens: 20,
    }))
    expect(llmStreamMock.mock.calls[1]?.[3]?.headers).toEqual({
      [AIRI_CHAT_APP_SURFACE_HEADER]: 'web',
      [AIRI_CHAT_SESSION_ID_HEADER]: 'session-1',
      [AIRI_CHAT_ROUND_ID_HEADER]: expect.any(String),
    })
  })

  it('keeps the OpenCode Go session header stable across turns', async () => {
    useProviderConfigStore().ensureProvider('saved-go-provider', 'opencode-go')
    activeProviderRef.value = 'saved-go-provider'
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: LlmStreamOptions) => {
      if (!options.onStreamEvent)
        throw new Error('Chat stream event handler is required')
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()
    await store.ingest('first turn', { model: 'glm-5.3', chatProvider: provider })
    await store.ingest('second turn', { model: 'glm-5.3', chatProvider: provider })

    expect(llmStreamMock.mock.calls[0]?.[3]?.headers).toEqual({ 'x-opencode-session': 'session-1' })
    expect(llmStreamMock.mock.calls[1]?.[3]?.headers).toEqual({ 'x-opencode-session': 'session-1' })
  })

  it('uses turn_index on message_sent instead of a second-turn alias', async () => {
    activeProviderRef.value = 'official-provider'
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()

    await store.ingest('first turn', {
      model: 'chat-auto',
      chatProvider: provider,
    })
    await store.ingest('second turn', {
      model: 'chat-auto',
      chatProvider: provider,
    })

    expect(chatAnalyticsMocks.trackMessageSent).toHaveBeenLastCalledWith(expect.objectContaining({
      conversation_id: 'session-1',
      round_id: expect.any(String),
      turn_index: 2,
      trigger_method: 'text_input',
      trigger_type: 'user_action',
    }))
  })

  // ROOT CAUSE:
  //
  // One successful send emitted both the canonical message/latency events
  // and four generic aliases, multiplying event volume without adding a
  // distinct product decision.
  it('does not emit redundant generic chat aliases for a successful send', async () => {
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()
    await store.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(redundantChatAnalyticsMocks.trackChatStarted).not.toHaveBeenCalled()
    expect(redundantChatAnalyticsMocks.trackAssistantResponseCompleted).not.toHaveBeenCalled()
    expect(redundantChatAnalyticsMocks.trackChatFailed).not.toHaveBeenCalled()
    expect(redundantChatAnalyticsMocks.trackFeatureUsed).not.toHaveBeenCalled()
  })

  it('forwards later-turn failures to the canonical round failure event', async () => {
    llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish' })
    })
    llmStreamMock.mockRejectedValueOnce(new Error('later turn rejected'))

    const store = useChatStore()
    await store.ingest('first turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await expect(store.ingest('second turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('later turn rejected')

    expect(chatAnalyticsMocks.trackMessageRoundFailed).toHaveBeenCalledWith({
      conversation_id: 'session-1',
      error_code: 'llm_response_failed',
      failure_stage: 'llm_response',
      model_id: 'gpt-test',
      provider_id: 'mock-provider',
      round_id: expect.any(String),
      source: 'text',
      turn_index: 2,
      trigger_method: 'text_input',
      trigger_type: 'user_flow_result',
    })
  })

  // ROOT CAUSE:
  //
  // The stream store displayed received text, but a later transport failure
  // removed it and left only the error item in durable history.
  //
  // The failed turn now keeps its incomplete assistant output before the error
  // so users can read what arrived and retry the whole turn when needed.
  it('keeps partial assistant output before the send error', async () => {
    llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'text-delta', text: 'partial reply' })
      throw new Error('stream interrupted')
    })

    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'show partial output',
    })).rejects.toThrow('stream interrupted')

    expect(sessionMessages['session-1']?.slice(-3)).toMatchObject([
      { role: 'user', content: 'show partial output' },
      { role: 'assistant', interrupted: true, content: 'partial ' },
      { role: 'error', content: 'stream interrupted', id: expect.any(String), createdAt: expect.any(Number) },
    ])

    llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'text-delta', text: 'complete reply' })
      await options.onStreamEvent?.({ type: 'finish' })
    })
    await store.retry({ sessionId: 'session-1', index: 3 })

    expect(sessionMessages['session-1']?.slice(1)).toMatchObject([
      { role: 'user', content: 'show partial output' },
      { role: 'assistant', content: 'complete reply' },
    ])
  })

  it('rejects retry when an error follows a completed assistant turn', async () => {
    const store = useChatStore()
    sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'complete reply', slices: [{ type: 'text', text: 'complete reply' }], tool_results: [] },
      { role: 'error', content: 'Provider configuration failed' },
    ]

    await expect(store.retry({ sessionId: 'session-1', index: 3 })).rejects.toThrow('Retry target has no retriable source message')
    expect(sessionMessages['session-1']).toHaveLength(4)
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('keeps hook order and composes context prompt after system message', async () => {
    const contextsSnapshot = {
      'system:weather': [
        {
          id: 'weather',
          contextId: 'system:weather',
          source: 'ReplaceSelf',
          text: 'sunny',
          createdAt: 456,
        },
      ],
    }

    getContextsSnapshotMock.mockReturnValue(contextsSnapshot)

    let composedMessages: Turn[] = []
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, context: Conversation, options: any) => {
      composedMessages = context.turns
      expect(options.waitForTools).toBe(true)
      expect(options.captureToolErrors).toBeUndefined()

      await options.onStreamEvent({ type: 'text-delta', text: 'hello' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()
    const hookOrder: string[] = []

    store.onBeforeMessageComposed(async () => {
      hookOrder.push('before-compose')
    })
    store.onAfterMessageComposed(async () => {
      hookOrder.push('after-compose')
    })
    store.onBeforeSend(async () => {
      hookOrder.push('before-send')
    })
    store.onTokenLiteral(async () => {
      hookOrder.push('token-literal')
    })
    store.onStreamEnd(async () => {
      hookOrder.push('stream-end')
    })
    store.onAssistantResponseEnd(async () => {
      hookOrder.push('assistant-end')
    })
    store.onAfterSend(async () => {
      hookOrder.push('after-send')
    })
    store.onAssistantMessage(async () => {
      hookOrder.push('assistant-message')
    })
    store.onChatTurnComplete(async () => {
      hookOrder.push('turn-complete')
    })

    await store.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(store.sending).toBe(false)
    expect(trackFirstMessageMock).toHaveBeenCalledOnce()
    // Datetime is no longer pushed through ingestContextMessage; it is now
    // applied at message-assembly time as per-message [HH:MM] prefixes. The
    // runtime-rule and Minecraft providers are disabled in this test.
    expect(ingestContextMessageMock).not.toHaveBeenCalled()
    expect(persistSessionMessagesMock).toHaveBeenCalledWith('session-1')
    expect(hookOrder).toEqual([
      'before-compose',
      'after-compose',
      'before-send',
      'token-literal',
      'stream-end',
      'assistant-end',
      'after-send',
      'assistant-message',
      'turn-complete',
    ])

    expect(composedMessages).toHaveLength(2)
    expect(composedMessages[0]).toMatchObject({ type: 'system' })
    expect(composedMessages[1]).toMatchObject({ type: 'user' })
    expect(ioTracerMocks.startSpanMock).toHaveBeenCalledWith(
      IOSpanNames.LLMInference,
      expect.anything(),
      expect.objectContaining({
        [IOAttributes.LLMInputMessageCount]: 2,
        [IOAttributes.LLMInputUserMessageCount]: 1,
        [IOAttributes.TurnId]: expect.any(String),
      }),
    )
    const llmSpan = ioTracerMocks.spans.find(span => span.name === IOSpanNames.LLMInference)
    expect(llmSpan.setAttribute).toHaveBeenCalledWith(IOAttributes.LLMInputMessageRoles, ['system', 'user'])
    expect(llmSpan.setAttribute).toHaveBeenCalledWith(IOAttributes.LLMOutputChunkCount, 1)
    expect(llmSpan.setAttribute).toHaveBeenCalledWith(IOAttributes.LLMOutputChunkLengths, [5])
    expect(llmSpan.setAttribute).toHaveBeenCalledWith(IOAttributes.LLMTextLength, 5)

    // The persisted system message stays unchanged. Per-message time prefixes
    // keep the static card prompt cacheable across day boundaries.
    if (composedMessages[0].type !== 'system' || composedMessages[1].type !== 'user')
      throw new Error('Expected system and user turns')
    expect(composedMessages[0].content).toEqual([
      { type: 'text', text: 'system prompt' },
      { type: 'text', text: '\n\nPlugin toolset guidance.' },
    ])
    expect(composedMessages[1].content[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] hello from user$/),
    })
    expect(composedMessages[1].content[1]).toEqual({
      type: 'runtime-context',
      entries: [{ source: 'system:weather', text: 'sunny' }],
    })
  })

  // ROOT CAUSE:
  //
  // Muted speech dispatches special tokens without opening a TTS session.
  // Without a turn id in the hook context, an unhandled plugin CALL cannot be
  // correlated and relayed to a handler in another Electron renderer.
  it('emits special tokens with a stable turn id for cross-renderer routing', async () => {
    getContextsSnapshotMock.mockReturnValue({})
    llmStreamMock.mockImplementationOnce(async (_model, _provider, _messages, options) => {
      await options.onStreamEvent({ type: 'text-delta', text: '<|CALL ["plugin.action"]|>' })
    })

    const store = useChatStore()
    const specialHook = vi.fn()
    store.onTokenSpecial(specialHook)

    await store.ingest('trigger special', {
      chatProvider: provider,
      model: 'mock-model',
    })

    expect(specialHook).toHaveBeenCalledWith('<|CALL ["plugin.action"]|>', expect.objectContaining({
      contexts: {},
      turnId: expect.any(String),
    }))
    expect(specialHook.mock.calls[0]?.[1].turnId.length).toBeGreaterThan(0)
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3743261505
  it('preserves a synchronized sending snapshot without replaying it through the follower runtime for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Applying `sending: true` invoked the follower's idle runtime, whose
    // derived state cleared the synchronized stream payload and could target
    // that follower's unrelated local selection.
    const store = useChatStore()
    store.$patch({
      sending: true,
      activeSendSessionId: 'session-b',
      activeTurns: [{ sessionId: 'session-b', turnId: 'turn-b' }],
    })
    await nextTick()

    expect(store.sending).toBe(true)
    expect(store.activeSendSessionId).toBe('session-b')
    expect(store.activeTurns).toEqual([{ sessionId: 'session-b', turnId: 'turn-b' }])
    expect(store.$state).not.toHaveProperty('activeStreamingMessage')
  })

  it('continues the trace of the voice input that submitted the turn', async () => {
    const voiceInput = { name: IOSpanNames.VoiceInput }
    ioTracerMocks.takeVoiceTurnParent.mockReturnValueOnce(voiceInput)

    const store = useChatStore()
    await store.ingest('spoken text', { model: 'gpt-test', chatProvider: provider })

    const [turnId] = ioTracerMocks.takeVoiceTurnParent.mock.calls[0]!
    expect(turnId).toEqual(expect.any(String))
    expect(turnId).not.toBe('')
    expect(ioTracerMocks.startSpanMock).toHaveBeenCalledWith(IOSpanNames.InteractionTurn, voiceInput, expect.any(Object))
  })

  it('reuses the interaction turn span that the speech output opened before the stream', async () => {
    const voiceInput = { name: IOSpanNames.VoiceInput }
    ioTracerMocks.takeVoiceTurnParent.mockReturnValueOnce(voiceInput)
    let llmParent: unknown
    llmStreamMock.mockImplementationOnce(async () => {
      // The LLM span starts synchronously before the stream call, so it is the latest span.
      llmParent = ioTracerMocks.startSpanMock.mock.calls.at(-1)![1]
    })

    const store = useChatStore()
    const speechParent = store.openTurnSpan({ sessionId: 'session-1', turnId: 'spoken-turn' })
    await store.send({ sessionId: 'session-1', messageId: 'spoken-turn', text: 'Spoken' })

    const turnSpans = ioTracerMocks.spans.filter(span => span.name === IOSpanNames.InteractionTurn)
    expect(turnSpans).toHaveLength(1)
    expect(turnSpans[0]).toBe(speechParent)
    expect(llmParent).toBe(speechParent)
    expect(ioTracerMocks.startSpanMock).toHaveBeenCalledWith(IOSpanNames.InteractionTurn, voiceInput, expect.any(Object))
    expect(speechParent.end).toHaveBeenCalledOnce()
  })

  it('records the IDs and the final status of a turn on its span', async () => {
    llmStreamMock.mockImplementationOnce(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      await options.onStreamEvent?.({ type: 'finish' })
    })
    llmStreamMock.mockImplementationOnce(async () => {
      throw new Error('upstream failed')
    })

    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'Succeed' })
    await store.send({ sessionId: 'session-1', text: 'Fail' }).catch(() => {})

    const turnCalls = ioTracerMocks.startSpanMock.mock.calls.filter(([name]) => name === IOSpanNames.InteractionTurn)
    const turnSpans = ioTracerMocks.spans.filter(span => span.name === IOSpanNames.InteractionTurn)
    expect(turnCalls).toHaveLength(2)
    expect(turnCalls[0]![2]).toEqual({ [IOAttributes.TurnId]: expect.any(String), [IOAttributes.GenAIConversationId]: 'session-1' })
    expect(turnSpans[0].setStatus).not.toHaveBeenCalled()
    expect(turnSpans[1].setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR })
    expect(ioTracerMocks.turnSpans.size).toBe(0)
  })

  it('continues a composer dictation trace when the turn has no voice input of its own', async () => {
    const dictation = { name: IOSpanNames.VoiceInput }
    ioTracerMocks.takeComposerVoiceParent.mockReturnValueOnce(dictation)

    const store = useChatStore()
    await store.ingest('dictated text', { model: 'gpt-test', chatProvider: provider })

    expect(ioTracerMocks.takeComposerVoiceParent).toHaveBeenCalledOnce()
    expect(ioTracerMocks.startSpanMock).toHaveBeenCalledWith(IOSpanNames.InteractionTurn, dictation, expect.any(Object))
  })

  it('does not end the owned IO turn span when external sending mirror is cleared mid-send', async () => {
    let releaseStream: (() => void) | undefined
    llmStreamMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseStream = resolve
      })
    })

    const store = useChatStore()
    const send = store.ingest('hold stream', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(store.sending).toBe(true)
    })
    await vi.waitFor(() => {
      expect(ioTracerMocks.spans.some(span => span.name === IOSpanNames.InteractionTurn)).toBe(true)
    })

    const turnSpan = ioTracerMocks.spans.find(span => span.name === IOSpanNames.InteractionTurn)
    if (!turnSpan)
      throw new Error('Expected the chat facade to create an interaction turn span')

    store.sending = false
    await nextTick()

    expect(turnSpan.end).not.toHaveBeenCalled()

    releaseStream?.()
    await send

    expect(turnSpan.end).toHaveBeenCalledTimes(1)
    expect(ioTracerMocks.turnSpans.size).toBe(0)
  })

  it('keeps a separate interaction turn span for each concurrent session', async () => {
    const releases = new Map<string, () => void>()
    const llmParents = new Map<string, { name: string, end: ReturnType<typeof vi.fn> }>()
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
      const sessionId = options.requestCorrelation!.conversationId
      // The LLM span starts synchronously before the stream call, so it is the latest span.
      llmParents.set(sessionId, ioTracerMocks.startSpanMock.mock.calls.at(-1)![1] as { name: string, end: ReturnType<typeof vi.fn> })
      await new Promise<void>(resolve => releases.set(sessionId, resolve))
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    const alice = store.send({ sessionId: 'session-1', text: 'For Alice' })
    const bob = store.send({ sessionId: 'session-2', text: 'For Bob' })
    await vi.waitFor(() => expect(releases.size).toBe(2))

    const aliceTurn = llmParents.get('session-1')
    const bobTurn = llmParents.get('session-2')
    expect(aliceTurn?.name).toBe(IOSpanNames.InteractionTurn)
    expect(bobTurn?.name).toBe(IOSpanNames.InteractionTurn)
    expect(aliceTurn).not.toBe(bobTurn)

    releases.get('session-2')!()
    await bob

    expect(bobTurn?.end).toHaveBeenCalledOnce()
    expect(aliceTurn?.end).not.toHaveBeenCalled()
    expect([...ioTracerMocks.turnSpans.values()]).toEqual([aliceTurn])

    releases.get('session-1')!()
    await alice

    expect(aliceTurn?.end).toHaveBeenCalledOnce()
    expect(ioTracerMocks.turnSpans.size).toBe(0)
  })

  it('sends the stage contract in the system prompt and the live state only as the situation stage line', async () => {
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    leadSituation()
    const systemPrompts: string[] = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      // The provider adapter replaces the system message with the resolved step prompt for each request.
      systemPrompts.push((await options.resolveStep!()).systemPrompt ?? '')
      await options.onStreamEvent?.({ type: 'finish' })
    })

    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello' })

    expect(ingestContextMessageMock).toHaveBeenCalledOnce()
    expect(ingestContextMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      contextId: 'system:situation',
      text: expect.stringMatching(/^\[Situation \d\d:\d\d\]\n- Stage - on stage: face: smile$/),
    }))
    const composed = useContextObservabilityStore().lastPromptProjection?.composedMessage ?? []
    const system = systemPrompts[0]
    const lastUser = JSON.stringify(composed.findLast(message => message.role === 'user'))
    expect(system).toContain('base.prompt.emotion')
    expect(system).toContain('base.prompt.emoji')
    expect(system).toContain('- happy (Emotion for feeling Happy)')
    expect(system).not.toContain('base.prompt.suffix')
    expect(system).not.toContain('base.prompt.expressions')
    expect(system).not.toContain('face: smile')
    expect(lastUser).toContain('hello')
    expect(lastUser).not.toContain('base.prompt.emotion')
    expect(lastUser).not.toContain('base.prompt.emoji')
  })

  it('keeps the system message identical across two consecutive turns', async () => {
    const systemMessages: string[] = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, _context: Conversation, options: StreamOptions) => {
      // The provider adapter replaces the system message with the resolved step prompt for each request.
      systemMessages.push((await options.resolveStep!()).systemPrompt ?? '')
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    const runtimeState = usePerformanceRuntimeState()
    // A leading situation store renders a timestamped block into every request.
    leadSituation()

    runtimeState.publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    await store.send({ sessionId: 'session-1', text: 'first turn' })
    const firstContext = ingestContextMessageMock.mock.lastCall?.[0]?.text

    // The live state changes between the turns. It reaches the runtime context, not the system message.
    runtimeState.publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [{ slot: 'face', label: 'smile' }], mood: null })
    await useExpressionPerformanceSettings().update({ stateFeedback: true })
    await store.send({ sessionId: 'session-1', text: 'second turn' })

    expect(firstContext).toMatch(/^\[Situation \d\d:\d\d\]/)
    expect(firstContext).toContain('- Stage - on stage: face: smile')
    expect(ingestContextMessageMock.mock.lastCall?.[0]?.text).toContain('- Stage - on stage: face: smile; active: face smile; mood: unknown')
    expect(systemMessages).toHaveLength(2)
    expect(systemMessages[0]).toContain('base.prompt.emotion')
    expect(systemMessages[0]).not.toContain('[Situation')
    expect(systemMessages[1]).toBe(systemMessages[0])
  })

  it('sends no runtime context, not even the live state, when the situation store was never initialized', async () => {
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [{ slot: 'face', label: 'smile' }], mood: null })
    await useExpressionPerformanceSettings().update({ stateFeedback: true })
    let composedMessages: Turn[] = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, context: Conversation, options: StreamOptions) => {
      composedMessages = context.turns
      await options.onStreamEvent?.({ type: 'finish' })
    })

    await useChatStore().send({ sessionId: 'session-1', text: 'hello' })

    expect(ingestContextMessageMock).not.toHaveBeenCalled()
    const lastUser = composedMessages.at(-1)
    expect(lastUser?.type).toBe('user')
    expect(lastUser?.type === 'user' && lastUser.content.some(segment => segment.type === 'runtime-context')).toBe(false)
  })

  it('ingests one situation entry before composing prompt snapshots', async () => {
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    leadSituation()
    let composedMessages: Turn[] = []

    // The registry mock returns what the runtime ingested, like the ReplaceSelf registry.
    getContextsSnapshotMock.mockImplementation(() => {
      const ingested = ingestContextMessageMock.mock.lastCall?.[0]
      return ingested ? { [ingested.contextId]: [ingested] } : {}
    })
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, context: Conversation, options: any) => {
      composedMessages = context.turns
      await options.onStreamEvent({ type: 'text-delta', text: 'minecraft reply' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()

    await store.ingest('where am I?', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(ingestContextMessageMock).toHaveBeenCalledOnce()
    expect(ingestContextMessageMock).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'system:situation', strategy: 'replace-self' }))
    expect(ingestContextMessageMock.mock.invocationCallOrder[0]).toBeLessThan(
      getContextsSnapshotMock.mock.invocationCallOrder[0],
    )
    if (composedMessages[1].type !== 'user')
      throw new Error('Expected user turn')
    expect(composedMessages[1].content[1]).toEqual({
      type: 'runtime-context',
      entries: [{ source: 'system:situation', text: expect.stringMatching(/^\[Situation \d\d:\d\d\]\n- Stage - on stage: face: smile$/) }],
    })
  })

  it('adds account context only to the signed-in request without retaining it in the registry', async () => {
    const account = {
      id: 'account',
      contextId: 'system:user-account',
      strategy: 'replace-self',
      text: 'Account display name: "Alice". Edit it at /settings/account.',
      createdAt: 123,
    }
    const registry = {}
    getContextsSnapshotMock.mockReturnValue(registry)
    createUserAccountContextMock.mockReturnValue(account)
    const prompts: string[] = []
    llmStreamMock.mockImplementation(async (_model: string, _provider: GenerationProvider, messages: Conversation, options: StreamOptions) => {
      prompts.push(JSON.stringify(messages))
      await options.onStreamEvent?.({ type: 'finish' })
    })
    const store = useChatStore()
    await store.ingest('hello', { model: 'gpt-test', chatProvider: provider })
    expect(prompts[0]).toContain('Alice')
    expect(prompts[0]).toContain('/settings/account')
    // The account rides in the system supplement of this request, not in the runtime context of the user turn.
    expect(prompts[0]).not.toContain('system:user-account')
    expect(registry).toEqual({})
    expect(ingestContextMessageMock).not.toHaveBeenCalledWith(account)

    createUserAccountContextMock.mockReturnValue(null)
    await store.ingest('hello again', { model: 'gpt-test', chatProvider: provider })
    expect(prompts[1]).not.toContain('system:user-account')
    expect(prompts[1]).not.toContain('Alice')
    expect(prompts[1]).not.toContain('/settings/account')
  })

  it('rejects cancelled queued sends before they start', async () => {
    let releaseFirstSend: (() => void) | undefined
    llmStreamMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const store = useChatStore()
    const firstSend = store.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = store.ingest('cancel me', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(llmStreamMock).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(store.pendingQueuedSendCount).toBe(1)
    })
    await store.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3742939573
  it('does not recreate a deleted session when queued work is cancelled for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Cancelling queued work rejects the public send action. Its generic error
    // handler used to recreate a system-plus-error history after deletion,
    // leaving a ghost conversation that no longer had session metadata.
    let releaseFirstSend: (() => void) | undefined
    llmStreamMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })
    deleteSessionMock.mockImplementationOnce(async () => {
      currentGeneration += 1
      delete sessionMessages['session-1']
    })

    const store = useChatStore()
    const firstSend = store.send({
      sessionId: 'session-1',
      text: 'active turn',
    })
    const activeOutcome = firstSend.then(
      () => 'resolved',
      error => errorMessageFrom(error) ?? 'unknown error',
    )
    const queuedSend = store.send({
      sessionId: 'session-1',
      text: 'must be cancelled',
    })
    const queuedOutcome = queuedSend.then(
      () => 'resolved',
      error => errorMessageFrom(error) ?? 'unknown error',
    )

    await vi.waitFor(() => {
      expect(llmStreamMock).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(store.pendingQueuedSendCount).toBe(1)
    })
    await store.deleteSession('session-1')

    expect(deleteSessionMock).toHaveBeenCalledWith('session-1')
    expect(await queuedOutcome).toBe('Chat session was reset before send could start')
    expect(sessionMessages['session-1']).toBeUndefined()

    releaseFirstSend?.()
    expect(await activeOutcome).toBe('Chat session was removed before send completed')
    expect(llmStreamMock).toHaveBeenCalledTimes(1)
    expect(sessionMessages['session-1']).toBeUndefined()
  })

  it('mirrors pending queued send snapshots from the core runtime', async () => {
    let releaseFirstSend: (() => void) | undefined
    llmStreamMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const queuedMessage = 'queued-message-'.repeat(12)
    const store = useChatStore()
    const firstSend = store.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = store.ingest(queuedMessage, {
      model: 'gpt-test',
      chatProvider: provider,
      attachments: [
        {
          type: 'image',
          data: 'aW1hZ2U=',
          mimeType: 'image/png',
        },
      ],
      input: {
        type: 'input:text',
        data: {
          text: 'queued input',
        },
      },
    })

    await vi.waitFor(() => {
      expect(llmStreamMock).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(store.pendingQueuedSendCount).toBe(1)
    })

    expect(store.getPendingQueuedSendSnapshot()).toEqual([
      {
        sessionId: 'session-1',
        generation: 1,
        cancelled: false,
        messagePreview: queuedMessage.slice(0, 120),
        hasAttachments: true,
        inputType: 'input:text',
      },
    ])

    await store.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  it('rejects stale generation sends before performSend starts', async () => {
    let releaseFirstSend: (() => void) | undefined
    llmStreamMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const store = useChatStore()
    const firstSend = store.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = store.ingest('stale request', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(llmStreamMock).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(store.pendingQueuedSendCount).toBe(1)
    })
    currentGeneration = 2
    releaseFirstSend?.()

    await firstSend
    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    expect(llmStreamMock).toHaveBeenCalledTimes(1)
  })

  it('uses the forked session id and keeps the chat store contract keys', async () => {
    getContextsSnapshotMock.mockReturnValue({})
    forkSessionMock.mockResolvedValue('session-forked')
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'fork-reply' })
      await options.onStreamEvent({ type: 'finish' })
    })

    const store = useChatStore()

    expect(store.$id).toBe('chat')
    expect(typeof store.send).toBe('function')
    expect(typeof store.ingest).toBe('function')
    expect(typeof store.ingestOnFork).toBe('function')
    expect(typeof store.cancelPendingSends).toBe('function')
    expect(typeof store.onBeforeSend).toBe('function')
    expect(typeof store.emitBeforeSendHooks).toBe('function')

    await store.ingestOnFork('fork me', {
      model: 'gpt-test',
      chatProvider: provider,
    }, {
      fromSessionId: 'session-1',
      atIndex: 3,
      reason: 'retry',
      hidden: true,
    })

    expect(forkSessionMock).toHaveBeenCalledWith({
      fromSessionId: 'session-1',
      atIndex: 3,
      reason: 'retry',
      hidden: true,
    })
    // The send commits its user message to the forked session.
    expect(persistSessionMessagesMock).toHaveBeenCalledWith('session-forked')
  })

  describe('unprompted turns', () => {
    /** Streams `chunks` as text deltas, then finishes, and records each provider request as JSON. */
    function replyWith(chunks: string[], prompts: string[] = []) {
      return async (_model: string, _provider: GenerationProvider, messages: Conversation, options: StreamOptions) => {
        prompts.push(JSON.stringify(messages))
        for (const text of chunks)
          await options.onStreamEvent?.({ type: 'text-delta', text })
        await options.onStreamEvent?.({ type: 'finish' })
      }
    }

    /** Holds the provider request until it is aborted, and reports its signal. */
    function holdUntilAborted(signals: AbortSignal[]) {
      return async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
        signals.push(options.abortSignal!)
        await new Promise<void>((resolve) => {
          if (options.abortSignal?.aborted)
            return resolve()
          options.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    }

    it('speaks a reply and returns its text with the trigger and reply in history', async () => {
      const prompts: string[] = []
      llmStreamMock.mockImplementation(replyWith(['<|ACT happy|>', ' Oh, a QA topic!'], prompts))
      const store = useChatStore()

      const result = await store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-1' })

      expect(result).toEqual({ status: 'spoken', text: expect.stringContaining('Oh, a QA topic!') })
      expect(result.status === 'spoken' && result.text).not.toContain('ACT')
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain('(No one spoke to you. You may speak up about: QA topic)')
      expect(prompts[0]).toContain('base.prompt.unprompted')
      expect(prompts[0]).not.toContain('base.prompt.unprompted-forced')
      expect(sessionMessages['session-1'].slice(1)).toMatchObject([
        { role: 'user', id: 'unprompted-1', origin: 'unprompted', trigger: { topicKey: 'qa', text: 'QA topic' } },
        { role: 'assistant', content: expect.stringContaining('Oh, a QA topic!') },
      ])
      // Neither the trigger nor its reply is mirrored to the cloud.
      expect(pushMessageToCloudMock).not.toHaveBeenCalled()
      expect(controlRecords).toEqual([])
    })

    it('keeps the title and link of a web extension topic out of the stored trigger, while its request still carries them', async () => {
      const prompts: string[] = []
      llmStreamMock.mockImplementation(replyWith(['Enjoying the video?'], prompts))
      const store = useChatStore()
      leadSituation()
      const situation = useSituationStore()
      situation.setHostCapabilities({ unprompted: true })
      situation.setStageVisible(true)
      // Fresh desktop and foreground samples, so only the topic decides whether the gate fires.
      useDesktopActivityStore().setSnapshot({ idleSeconds: 0, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: null, screenChange: null, sampledAtMs: Date.now() })
      useForegroundWindowStore().setSample({ exePath: 'C:\\Windows\\notepad.exe', exeName: 'notepad.exe', title: 'notes.txt - Notepad', pid: 7, ownProcess: false, busy: 'accepts', sampledAtMs: Date.now() })
      // What the web extension sends for one video: a context update and a notify, from one module.
      const source = 'proj-airi:plugin-web-extension:module-a'
      situation.ingest({ kind: 'context', sourceKey: source, text: 'User is watching: Secret video Channel: QA channel. URL: https://example.test/watch?v=secret.', atMs: Date.now() })
      situation.ingest({ kind: 'notify', sourceKey: source, eventId: 'video-1', headline: 'User is watching: Secret video', note: 'Channel: QA channel', urgency: 'soon', reminder: false, critical: false, atMs: Date.now() })
      const completed = new Promise<void>(resolve => store.onChatTurnComplete(async () => resolve()))

      const evaluation = await useSituationObservabilityStore().evaluateGate()
      expect(evaluation).toMatchObject({ status: 'evaluated', decision: { fire: true, topicKey: notifyTopicKey(source, 'video-1') } })
      await completed

      expect(sessionMessages['session-1'].slice(1)).toMatchObject([
        { role: 'user', origin: 'unprompted', trigger: { topicKey: notifyTopicKey(source, 'video-1') } },
        { role: 'assistant', content: expect.stringContaining('Enjoying the video?') },
      ])
      expect(JSON.stringify(sessionMessages['session-1'])).not.toMatch(/secret|example\.test|QA channel/iu)
      // The request of that turn still names the video in its situation block, which only the per-request context holds.
      expect(prompts).toHaveLength(1)
      expect(ingestContextMessageMock).toHaveBeenCalledWith(expect.objectContaining({
        contextId: 'system:situation',
        text: expect.stringContaining('Secret video'),
      }))
      expect(ingestContextMessageMock).toHaveBeenCalledWith(expect.objectContaining({
        contextId: 'system:situation',
        text: expect.stringContaining('https://example.test/watch?v=secret'),
      }))
    })

    it('tags the captured provider request with its turn and origin, and counts spoken and declined turns', async () => {
      llmStreamMock.mockImplementation(replyWith(['Hi.']))
      const store = useChatStore()
      await store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-tag-1' })
      expect(useContextObservabilityStore().lastPromptProjection).toMatchObject({ sessionId: 'session-1', turnId: 'unprompted-tag-1', origin: 'unprompted' })

      llmStreamMock.mockImplementation(replyWith(['<|SILENT|>']))
      await store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-tag-2' })

      const { spend } = await useSituationObservabilityStore().inspect()
      expect(spend.sessions).toEqual([{ sessionId: 'session-1', spoken: 1, declined: 1 }])
      expect(spend.lastUnpromptedRequest).toMatchObject({ sessionId: 'session-1', turnId: 'unprompted-tag-2', chars: expect.any(Number) })
      expect(spend.lastUnpromptedRequest?.chars).toBeGreaterThan('(No one spoke to you. You may speak up about: QA topic)'.length)
    })

    it('asks for a reply without the silence allowance when forced, and appends the supplement after it', async () => {
      const prompts: string[] = []
      llmStreamMock.mockImplementation(replyWith(['Hi.'], prompts))
      const store = useChatStore()

      await store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', force: true, supplement: 'CALL manifest text' })

      const forced = prompts[0].indexOf('base.prompt.unprompted-forced')
      expect(forced).toBeGreaterThan(-1)
      expect(prompts[0].indexOf('CALL manifest text')).toBeGreaterThan(forced)
    })

    // A widget reaction registers its CALL handlers under `spark:<id>` and submits that id as the message id.
    it('runs a forced turn under its message id, so the CALL specials of a widget reaction reach its handlers', async () => {
      llmStreamMock.mockImplementation(replyWith(['<|CALL ["plugin.action"]|>', ' Nice move.']))
      const store = useChatStore()
      const specialHook = vi.fn()
      store.onTokenSpecial(specialHook)

      const result = await store.submitUnprompted({ topicKey: 'notify:widget:e-1', topicText: 'QA widget', force: true, messageId: 'spark:widget-1' })

      expect(result).toEqual({ status: 'spoken', text: expect.stringContaining('Nice move.') })
      expect(specialHook).toHaveBeenCalledWith('<|CALL ["plugin.action"]|>', expect.objectContaining({ turnId: 'spark:widget-1', origin: 'unprompted' }))
    })

    // Pin (e) of the gate hard contract: a widget reaction speaks through the real chat store while the leader's situation
    // store observes its hooks, and the gate neither fires nor keeps anything pending.
    it('speaks a forced widget turn through the real chat store without the gate firing, and leaves nothing pending', async () => {
      llmStreamMock.mockImplementation(replyWith(['Nice move.']))
      const store = useChatStore()
      leadSituation()
      const situation = useSituationStore()
      situation.setHostCapabilities({ unprompted: true })
      situation.setStageVisible(true)
      const observability = useSituationObservabilityStore()
      const before = observability.gateMemory

      const result = await store.submitUnprompted({ topicKey: 'notify:widget:e-1', topicText: 'QA widget', force: true, messageId: 'spark:widget-1' })

      expect(result).toEqual({ status: 'spoken', text: expect.stringContaining('Nice move.') })
      expect(llmStreamMock).toHaveBeenCalledOnce()
      expect(sessionMessages['session-1'].slice(1)).toMatchObject([
        { role: 'user', id: 'spark:widget-1', origin: 'unprompted', trigger: { topicKey: 'notify:widget:e-1' } },
        { role: 'assistant', content: expect.stringContaining('Nice move.') },
      ])
      // The situation store saw her unprompted turn through the chat hooks, yet recorded no gate fire for it.
      expect(situation.state.conversation.lastUnpromptedAtMs).toEqual(expect.any(Number))
      expect(observability.gateMemory).toEqual(before)
      expect(observability.gateMemory.pending).toBeNull()
      expect(observability.gateMemory.fires).toEqual([])
      // Nothing is pending in the chat store either: the next unprompted turn starts instead of failing as busy.
      llmStreamMock.mockImplementation(replyWith(['Again.']))
      expect(await store.submitUnprompted({ topicKey: 'notify:widget:e-2', topicText: 'QA widget 2', force: true, messageId: 'spark:widget-2' })).toMatchObject({ status: 'spoken' })
    })

    it('declines on SILENT without changing history, syncing, or opening a voice turn that never ends', async () => {
      llmStreamMock.mockImplementation(replyWith(['<|SILENT|>']))
      const ended: unknown[] = []
      const off = getSpeechBusContext().on(voiceGenerationEnded, ({ body }) => ended.push(body))
      onTestFinished(() => off())
      const store = useChatStore()
      const messageCount = sessionMessages['session-1'].length

      const result = await store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-2' })

      expect(result).toEqual({ status: 'declined' })
      expect(sessionMessages['session-1']).toHaveLength(messageCount)
      expect(pushMessageToCloudMock).not.toHaveBeenCalled()
      expect(controlRecords).toEqual([{
        eventId: expect.any(String),
        turn: { sessionId: 'session-1', turnId: 'unprompted-2' },
        topicKey: 'qa',
        atMs: expect.any(Number),
      }])
      // Speech consumers know no declined turn. They close the response as cancelled.
      expect(ended).toEqual([{ sessionId: 'session-1', turnId: 'unprompted-2', status: 'cancelled' }])
      expect(store.sending).toBe(false)
    })

    it('cancels a generating unprompted turn when the user sends, and the user turn proceeds', async () => {
      const signals: AbortSignal[] = []
      llmStreamMock
        .mockImplementationOnce(holdUntilAborted(signals))
        .mockImplementationOnce(replyWith(['Sure.']))
      const store = useChatStore()

      const unprompted = store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-3' })
      await vi.waitFor(() => expect(signals).toHaveLength(1))
      // The undecided turn holds the raw flag but no user-facing stream, so presence stays idle and no placeholder shows.
      expect(store.sending).toBe(true)
      expect(store.userSending).toBe(false)
      expect(store.activeTurns).toEqual([])

      await store.send({ sessionId: 'session-1', text: 'hi there' })

      expect(await unprompted).toEqual({ status: 'cancelled' })
      expect(signals[0].aborted).toBe(true)
      expect(sessionMessages['session-1'].some(message => message.id === 'unprompted-3')).toBe(false)
      expect(sessionMessages['session-1'].slice(1)).toMatchObject([
        { role: 'user', content: 'hi there' },
        { role: 'assistant', content: 'Sure.' },
      ])
      expect(controlRecords).toEqual([])
    })

    it('removes a queued unprompted turn when the user sends, before it reaches the provider', async () => {
      const release = Promise.withResolvers<void>()
      llmStreamMock
        .mockImplementationOnce(async (_model: string, _provider: GenerationProvider, _messages: Conversation, options: StreamOptions) => {
          await release.promise
          await options.onStreamEvent?.({ type: 'finish' })
        })
        .mockImplementation(replyWith(['Sure.']))
      const store = useChatStore()
      const holder = store.ingest('hold queue', { model: 'gpt-test', chatProvider: provider })
      await vi.waitFor(() => expect(llmStreamMock).toHaveBeenCalledTimes(1))

      const unprompted = store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-queued' })
      await vi.waitFor(() => expect(store.pendingQueuedSendCount).toBe(1))
      const userSend = store.send({ sessionId: 'session-1', text: 'hi there' })

      expect(await unprompted).toEqual({ status: 'cancelled' })
      release.resolve()
      await holder
      await userSend

      // The holder and the user turn reached the provider. The unprompted turn never did.
      expect(llmStreamMock).toHaveBeenCalledTimes(2)
      expect(sessionMessages['session-1'].some(message => message.id === 'unprompted-queued')).toBe(false)
      expect(sessionMessages['session-1'].slice(-2)).toMatchObject([
        { role: 'user', content: 'hi there' },
        { role: 'assistant', content: 'Sure.' },
      ])
    })

    it('starts no second unprompted turn while one is pending, and joins a repeated call for the same turn', async () => {
      const signals: AbortSignal[] = []
      llmStreamMock.mockImplementationOnce(holdUntilAborted(signals))
      const store = useChatStore()

      const first = store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-4' })
      const repeated = store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-4' })
      const second = store.submitUnprompted({ topicKey: 'other', topicText: 'Other topic' })

      expect(await second).toEqual({ status: 'failed', error: 'Another unprompted turn is still pending' })
      await vi.waitFor(() => expect(signals).toHaveLength(1))
      await store.cancelTurn({ sessionId: 'session-1', turnId: 'unprompted-4' })

      // The repeated call joined the pending turn: one provider request, one shared outcome.
      expect(await first).toEqual({ status: 'cancelled' })
      expect(await repeated).toEqual({ status: 'cancelled' })
      expect(llmStreamMock).toHaveBeenCalledTimes(1)
    })

    it('cancels an undecided unprompted turn on voice input without storing an interruption', async () => {
      const signals: AbortSignal[] = []
      llmStreamMock.mockImplementationOnce(holdUntilAborted(signals))
      const store = useChatStore()

      const unprompted = store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-5' })
      await vi.waitFor(() => expect(signals).toHaveLength(1))
      const receipt = await store.receiveInterruption({
        eventId: 'interruption-1',
        turn: { sessionId: 'session-1', turnId: 'unprompted-5' },
        cause: 'user-speech',
        playback: { groupId: 'group-1', played: [], status: 'silent' },
      })

      expect(receipt).toEqual({ status: 'acknowledged' })
      expect(await unprompted).toEqual({ status: 'cancelled' })
      expect(signals[0].aborted).toBe(true)
      expect(controlRecords).toEqual([])
    })

    it('returns a failure without adding an error message to the chat', async () => {
      llmStreamMock.mockImplementationOnce(async () => {
        throw new Error('provider down')
      })
      const store = useChatStore()
      const messageCount = sessionMessages['session-1'].length

      expect(await store.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic' })).toEqual({ status: 'failed', error: 'provider down' })
      expect(sessionMessages['session-1']).toHaveLength(messageCount)
    })

    it('marks unprompted trigger messages as not cloud-syncable', () => {
      expect(isCloudSyncableMessage({ role: 'user', content: '(No one spoke to you.)', origin: 'unprompted', trigger: { topicKey: 'qa', text: 'QA topic' } })).toBe(false)
      expect(isCloudSyncableMessage({ role: 'user', content: 'hello' })).toBe(true)
    })

    it('runs an unprompted turn that a follower window submits in the leader', async () => {
      const namespace = `chat-unprompted:${crypto.randomUUID()}`
      const leaderPinia = createPinia()
      const leaderRuntime = createSyncedPiniaPlugin({ callTimeout: 1000, leadership: 'leader-only', namespace })
      leaderPinia.use(leaderRuntime.plugin)
      createApp({}).use(leaderPinia)
      const followerPinia = createPinia()
      const followerRuntime = createSyncedPiniaPlugin({ callTimeout: 1000, leadership: 'follower-only', namespace })
      followerPinia.use(followerRuntime.plugin)
      createApp({}).use(followerPinia)
      onTestFinished(() => {
        followerRuntime.dispose()
        leaderRuntime.dispose()
        disposePinia(followerPinia)
        disposePinia(leaderPinia)
      })

      await vi.waitFor(() => expect(leaderRuntime.isLeader()).toBe(true))
      setActivePinia(leaderPinia)
      useChatStore()
      setActivePinia(followerPinia)
      const followerStore = useChatStore()
      await vi.waitFor(() => expect(followerRuntime.getLeaderId()).toBe(leaderRuntime.participantId))
      llmStreamMock.mockImplementation(replyWith(['Hello from the leader.']))

      const result = await followerStore.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-follower' })

      expect(result).toEqual({ status: 'spoken', text: 'Hello from the leader.' })
      expect(llmStreamMock).toHaveBeenCalledTimes(1)
      expect(sessionMessages['session-1'].filter(message => message.id === 'unprompted-follower')).toHaveLength(1)
    })
  })
})
