import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatHistoryItem, ChatStreamEvent, ChatStreamEventContext, ContextMessage, StreamingAssistantMessage } from '../../../types/chat'

import { createChatHooks } from '@proj-airi/core-agent'
import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'

import ChatHistory from '../../../components/scenarios/chat/components/history.vue'

import { chatAssetsRepo } from '../../../database/repos/chat-assets.repo'
import { storeChatAsset } from '../../../libs/chat-assets'
import { connectMind } from '../../../test/connect-mind'
import { CHAT_STREAM_CHANNEL_NAME, CONTEXT_CHANNEL_NAME } from '../../chat/constants'
import { useConsciousnessStore } from '../../modules/consciousness'
import { useConsciousnessSettingsStore } from '../../modules/consciousness-settings'
import { useMinecraftStore } from '../../modules/gaming-minecraft'
import { useSituationStore } from '../../situation'
import { useContextBridgeStore } from './context-bridge'
import { createContextChannel } from './context-channel'

type HookCallback = (...args: unknown[]) => Promise<void> | void

const contextUpdateHooks: HookCallback[] = []
const serverEventHooks = new Map<string, HookCallback[]>()

// Delegates to the real situation sensor. A test forces a failure with `mockImplementationOnce`.
const { situationIngestMock } = vi.hoisted(() => ({ situationIngestMock: vi.fn() }))
/**
 * The character stores of every bridge, in creation order: each window records reactions in its own store and names
 * only the notifies listed in its `notifyIds`.
 */
const { characterWindows } = vi.hoisted(() => ({
  characterWindows: [] as Array<{ reactions: Array<[string, string]>, notifyIds: Map<string, string> }>,
}))
const showStreamMock = vi.fn()
const streamActiveTurns = shallowRef<Array<{ sessionId: string, turnId: string, message: StreamingAssistantMessage }>>([])
const finalizeStreamMock = vi.fn()
const resetStreamMock = vi.fn()
const refreshSessionMock = vi.fn()
const serverSendMock = vi.fn()
const ensureConnectedMock = vi.fn().mockResolvedValue(undefined)
const onReconnectedMock = vi.fn(() => () => {})
const onContextUpdateMock = vi.fn((callback: HookCallback) => registerHook(contextUpdateHooks, callback))
const onEventMock = vi.fn((eventName: string, callback: HookCallback) => registerServerEventHook(eventName, callback))
const getProviderInstanceMock = vi.fn()
const recordLifecycleMock = vi.fn()

let pinia: ReturnType<typeof createPinia>
let consciousness: ReturnType<typeof useConsciousnessStore>

const beforeComposeHooks: HookCallback[] = []
const afterComposeHooks: HookCallback[] = []
const beforeSendHooks: HookCallback[] = []
const afterSendHooks: HookCallback[] = []
const tokenLiteralHooks: HookCallback[] = []
const tokenSpecialHooks: HookCallback[] = []
const streamEndHooks: HookCallback[] = []
const assistantEndHooks: HookCallback[] = []
const assistantMessageHooks: HookCallback[] = []
const turnCompleteHooks: HookCallback[] = []

const activeSessionIdRef = ref('session-1')
const storedSessionMessages: Record<string, unknown[]> = {}
let currentGeneration = 7
const testChannels: Array<ReturnType<typeof createContextChannel>> = []

function registerHook(target: HookCallback[], callback: HookCallback) {
  target.push(callback)
  return () => {
    const index = target.indexOf(callback)
    if (index >= 0)
      target.splice(index, 1)
  }
}

function registerServerEventHook(eventName: string, callback: HookCallback) {
  const hooks = serverEventHooks.get(eventName) ?? []
  serverEventHooks.set(eventName, hooks)
  return registerHook(hooks, callback)
}

function createTestChannel(name: string) {
  const channel = createContextChannel()
  testChannels.push(channel)
  return {
    postMessage(message: ContextMessage | ChatStreamEvent) {
      return name === CONTEXT_CHANNEL_NAME
        ? channel.emitContext(message as ContextMessage)
        : channel.emitStream(message as ChatStreamEvent)
    },
  }
}

function collectChannelMessages<T>(name: string) {
  const messages: T[] = []
  const channel = createContextChannel()
  testChannels.push(channel)
  if (name === CONTEXT_CHANNEL_NAME) {
    channel.onContext((message) => {
      messages.push(message as T)
    })
  }
  else {
    channel.onStream((message) => {
      messages.push(message as T)
    })
  }
  return messages
}

function closeTestChannels() {
  for (const channel of testChannels) {
    channel.dispose(new Error('Context bridge contract test ended'))
  }
  testChannels.length = 0
}

/** A reply as the producing renderer sends it whole: its text, and any tool call before the text. */
function reply(text: string, toolCalls: string[] = []): StreamingAssistantMessage {
  return {
    role: 'assistant',
    id: 'reply-1',
    content: text,
    slices: [
      ...toolCalls.map(name => ({ type: 'tool-call' as const, toolCall: { toolCallId: `call-${name}`, toolCallType: 'function' as const, toolName: name, args: '{}' } })),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ],
    tool_results: [],
  }
}

async function waitForBroadcastDelivery() {
  await new Promise(resolve => setTimeout(resolve, 50))
}

async function emitHooks(target: HookCallback[], ...args: unknown[]) {
  for (const callback of target) {
    await callback(...args)
  }
}

async function emitContextUpdate(event: unknown) {
  await emitHooks(contextUpdateHooks, event)
}

async function emitServerEvent(eventName: string, event: unknown) {
  await emitHooks(serverEventHooks.get(eventName) ?? [], event)
}

/** Makes this window the situation leader, so context reaches the situation, or a follower that ingests nothing. */
function initializeSituation(isLeader: boolean) {
  const runtime: SyncedPiniaRuntime = {
    addRole: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    getParticipants: vi.fn(() => []),
    getRoles: vi.fn(() => []),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(isLeader)
      return () => {}
    }),
    participantId: 'context-bridge-test',
    plugin: vi.fn(),
  }
  const situation = useSituationStore(pinia)
  situation.initialize(runtime)
  return situation
}

function createMetadata(extensionId: string, moduleId: string) {
  return {
    source: {
      id: moduleId,
      extension: {
        id: extensionId,
      },
    },
  }
}

function createContextMessage(overrides: Record<string, unknown> = {}) {
  const id = typeof overrides.id === 'string' ? overrides.id : 'context-1'

  return {
    id,
    contextId: typeof overrides.contextId === 'string' ? overrides.contextId : id,
    strategy: ContextUpdateStrategy.AppendSelf,
    text: 'context text',
    createdAt: 1,
    ...overrides,
  }
}

function createContextUpdateEvent(overrides: Record<string, unknown> = {}) {
  const id = typeof overrides.id === 'string' ? overrides.id : 'context-1'

  return {
    type: 'context:update',
    source: 'extension-module-host',
    metadata: createMetadata('weather', 'station-1'),
    data: {
      id,
      contextId: id,
      strategy: ContextUpdateStrategy.AppendSelf,
      text: 'weather changed',
      ...overrides,
    },
  }
}

const chatOrchestratorMock = {
  activeSendSessionId: undefined as string | undefined,
  sending: false,
  send: vi.fn(),
  submitUnprompted: vi.fn(),
  chatReadyFor: vi.fn<(sessionId: string) => boolean>(),
  cancelPendingSends: vi.fn(),
  cancelTurn: vi.fn(),

  onBeforeMessageComposed: (callback: HookCallback) => registerHook(beforeComposeHooks, callback),
  onAfterMessageComposed: (callback: HookCallback) => registerHook(afterComposeHooks, callback),
  onBeforeSend: (callback: HookCallback) => registerHook(beforeSendHooks, callback),
  onAfterSend: (callback: HookCallback) => registerHook(afterSendHooks, callback),
  onTokenLiteral: (callback: HookCallback) => registerHook(tokenLiteralHooks, callback),
  onTokenSpecial: (callback: HookCallback) => registerHook(tokenSpecialHooks, callback),
  onStreamEnd: (callback: HookCallback) => registerHook(streamEndHooks, callback),
  onAssistantResponseEnd: (callback: HookCallback) => registerHook(assistantEndHooks, callback),
  onAssistantMessage: (callback: HookCallback) => registerHook(assistantMessageHooks, callback),
  onChatTurnComplete: (callback: HookCallback) => registerHook(turnCompleteHooks, callback),

  emitBeforeMessageComposedHooks: (...args: unknown[]) => emitHooks(beforeComposeHooks, ...args),
  emitAfterMessageComposedHooks: (...args: unknown[]) => emitHooks(afterComposeHooks, ...args),
  emitBeforeSendHooks: (...args: unknown[]) => emitHooks(beforeSendHooks, ...args),
  emitAfterSendHooks: (...args: unknown[]) => emitHooks(afterSendHooks, ...args),
  emitTokenLiteralHooks: (...args: unknown[]) => emitHooks(tokenLiteralHooks, ...args),
  emitTokenSpecialHooks: (...args: unknown[]) => emitHooks(tokenSpecialHooks, ...args),
  emitStreamEndHooks: (...args: unknown[]) => emitHooks(streamEndHooks, ...args),
  emitAssistantResponseEndHooks: (...args: unknown[]) => emitHooks(assistantEndHooks, ...args),
}

vi.mock('@proj-airi/stage-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/stage-shared')>()
  return {
    ...actual,
    isStageTamagotchi: () => false,
  }
})

vi.mock('vue-i18n', () => ({
  // The chat history reads `locale` and `te` too, for the test that renders it.
  useI18n: () => ({
    t: (key: string) => key,
    te: () => false,
    locale: { value: 'en' },
  }),
}))

vi.mock('../../character', () => ({
  // A bridge resolves the orchestrator, then the character store, once each when it is created.
  useCharacterOrchestratorStore: () => {
    const window = { reactions: [] as Array<[string, string]>, notifyIds: new Map<string, string>() }
    characterWindows.push(window)
    return {
      handleSparkNotify: vi.fn(async () => undefined),
      sparkNotifyIdOf: (topicKey: string) => window.notifyIds.get(topicKey),
    }
  },
  useCharacterStore: () => {
    const window = characterWindows.at(-1)!
    return {
      recordSparkNotifyReaction: (id: string, message: string) => window.reactions.push([id, message]),
    }
  },
}))

vi.mock('../../chat', () => ({
  useChatStore: () => chatOrchestratorMock,
}))

vi.mock('../../situation/sensors/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../situation/sensors/context')>()
  situationIngestMock.mockImplementation(actual.ingestContextMessage)
  return { ...actual, ingestContextMessage: situationIngestMock }
})

vi.mock('../../chat/session-store', () => ({
  useChatSessionStore: () => ({
    get activeSessionId() {
      return activeSessionIdRef.value
    },
    getSessionGenerationValue: () => currentGeneration,
    ensureBoundSession: async (binding: string) => `bound:${binding}`,
    getSessionMessagesIfLoaded: (sessionId: string) => storedSessionMessages[sessionId],
    refreshSession: (sessionId: string) => refreshSessionMock(sessionId),
  }),
}))

vi.mock('../../chat/stream-store', () => ({
  useChatStreamStore: () => ({
    get activeTurns() {
      return streamActiveTurns.value
    },
    get streamingMessage() {
      return showStreamMock.mock.lastCall?.[0]
    },
    set streamingMessage(message: StreamingAssistantMessage) {
      showStreamMock(message)
    },
    finalizeStream: finalizeStreamMock,
    resetStream: resetStreamMock,
  }),
}))

vi.mock('../../devtools/context-observability', () => ({
  useContextObservabilityStore: () => ({
    recordLifecycle: recordLifecycleMock,
  }),
}))

vi.mock('../../providers/provider', () => ({
  useProviderStore: () => ({
    configuredSpeechProvidersMetadata: [],
    getProviderConfig: vi.fn(() => ({})),
    getProviderInstance: getProviderInstanceMock,
    getChatProviderInstance: getProviderInstanceMock,
    providerRuntimeState: {},
  }),
}))

vi.mock('./channel-server', () => ({
  useModsServerChannelStore: () => ({
    ensureConnected: ensureConnectedMock,
    onReconnected: onReconnectedMock,
    onContextUpdate: onContextUpdateMock,
    onEvent: onEventMock,
    send: serverSendMock,
  }),
}))

/**
 * Makes this window the leader with a connected character mind, as the main window is: only it serves widget
 * reactions, and its mind runs them through the chat mock's `submitUnprompted`.
 */
function leadWithMind() {
  const situation = initializeSituation(true)
  situation.setHostCapabilities({ unprompted: true })
  situation.observeChat(createChatHooks(), {
    sending: () => false,
    pendingQueuedSendCount: () => 0,
    unpromptedPending: () => false,
    activeSessionId: () => 'session-1',
    submitUnprompted: payload => chatOrchestratorMock.submitUnprompted(payload),
    submitReaction: async () => ({ status: 'failed', error: 'No reaction turns in this test' }),
    cancelTurn: turn => chatOrchestratorMock.cancelTurn(turn),
    sessionMessages: () => [],
    extractionSelection: async () => null,
    stream: async () => {},
  })
  // The gate's seed is irrelevant here: no test ticks long enough for a reach-out.
  connectMind(situation, 1)
}

describe('context bridge contract', () => {
  beforeEach(() => {
    localStorage.clear()
    characterWindows.length = 0
    pinia = createPinia()
    setActivePinia(pinia)
    consciousness = useConsciousnessStore(pinia)

    situationIngestMock.mockClear()
    showStreamMock.mockReset()
    streamActiveTurns.value = []
    finalizeStreamMock.mockReset()
    resetStreamMock.mockReset()
    refreshSessionMock.mockReset().mockResolvedValue(true)
    serverSendMock.mockReset()
    ensureConnectedMock.mockClear()
    ensureConnectedMock.mockResolvedValue(undefined)
    onReconnectedMock.mockClear()
    onContextUpdateMock.mockClear()
    onEventMock.mockClear()
    getProviderInstanceMock.mockReset()
    recordLifecycleMock.mockReset()
    chatOrchestratorMock.send.mockReset().mockResolvedValue(undefined)
    chatOrchestratorMock.submitUnprompted.mockReset()
    chatOrchestratorMock.chatReadyFor.mockReset().mockReturnValue(true)
    chatOrchestratorMock.cancelPendingSends.mockReset().mockResolvedValue(undefined)
    chatOrchestratorMock.cancelTurn.mockReset().mockResolvedValue(undefined)

    consciousness.activeProvider = ''
    consciousness.activeModel = ''
    activeSessionIdRef.value = 'session-1'
    chatOrchestratorMock.activeSendSessionId = undefined
    currentGeneration = 7
    chatOrchestratorMock.sending = false

    beforeComposeHooks.length = 0
    afterComposeHooks.length = 0
    beforeSendHooks.length = 0
    afterSendHooks.length = 0
    tokenLiteralHooks.length = 0
    tokenSpecialHooks.length = 0
    streamEndHooks.length = 0
    assistantEndHooks.length = 0
    assistantMessageHooks.length = 0
    turnCompleteHooks.length = 0
    contextUpdateHooks.length = 0
    serverEventHooks.clear()
  })

  afterEach(async () => {
    // A failed assertion skips the test's explicit disposal. Close the bridge
    // before its peers and Pinia scope so later tests cannot receive old hooks.
    await useContextBridgeStore(pinia).dispose()
    useSituationStore(pinia).dispose()
    useMinecraftStore(pinia).dispose()
    closeTestChannels()
    disposePinia(pinia)
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('lists the images and recordings of the turn in the chat message event', async () => {
    storedSessionMessages['session-1'] = [{
      id: 'turn-1',
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'airi-asset:image' } },
        { type: 'input_audio', input_audio: { data: 'airi-asset:voice', format: 'wav' } },
      ],
      audioTranscripts: ['hello there'],
    }]
    const store = useContextBridgeStore()
    await store.initialize()

    await emitHooks(assistantMessageHooks, { role: 'assistant', content: 'hi' }, 'hi', {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'look' },
      contexts: {},
      composedMessage: [],
    })

    const event = serverSendMock.mock.calls.find(([sent]) => sent.type === 'output:gen-ai:chat:message')?.[0]
    expect(event?.data['gen-ai:chat'].attachments).toEqual([
      { type: 'image', ref: 'airi-asset:image' },
      { type: 'audio', ref: 'airi-asset:voice', mimeType: 'audio/wav', transcript: 'hello there' },
    ])
    delete storedSessionMessages['session-1']
  })

  it('ignores an asset read that the server did not attribute to a module', async () => {
    const ref = await storeChatAsset(new Uint8Array([82, 73, 70, 70]), 'audio/wav', 'session-1')
    const store = useContextBridgeStore()
    await store.initialize()

    // The source claims a module, but the server-stamped sender names no announced module.
    await emitServerEvent('asset:get:request', {
      type: 'asset:get:request',
      data: { ref },
      metadata: { ...createMetadata('discord', 'discord-1'), event: { id: 'request-3' }, sender: { peerId: 'peer-8', modules: [] } },
    })
    await emitServerEvent('asset:get:request', {
      type: 'asset:get:request',
      data: { ref },
      metadata: { ...createMetadata('discord', 'discord-1'), event: { id: 'request-4' } },
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(serverSendMock.mock.calls.filter(([event]) => event.type === 'asset:get:response')).toEqual([])
    await chatAssetsRepo.clear()
  })

  it('answers an asset read to the asking module only', async () => {
    const ref = await storeChatAsset(new Uint8Array([82, 73, 70, 70]), 'audio/wav', 'session-1')
    const store = useContextBridgeStore()
    await store.initialize()

    await emitServerEvent('asset:get:request', {
      type: 'asset:get:request',
      data: { ref },
      metadata: { ...createMetadata('discord', 'discord-1'), event: { id: 'request-1' }, sender: { peerId: 'peer-7', modules: ['discord'] } },
    })
    await emitServerEvent('asset:get:request', {
      type: 'asset:get:request',
      data: { ref: 'airi-asset:missing' },
      metadata: { ...createMetadata('discord', 'discord-1'), event: { id: 'request-2' }, sender: { peerId: 'peer-7', modules: ['discord'] } },
    })

    const answers = () => serverSendMock.mock.calls.filter(([event]) => event.type === 'asset:get:response')
    await vi.waitFor(() => expect(answers()).toHaveLength(2))
    expect(serverSendMock).toHaveBeenCalledWith({
      type: 'asset:get:response',
      data: { ref, mimeType: 'audio/wav', data: 'UklGRg==' },
      metadata: { event: { parentId: 'request-1' } },
      route: { destinations: ['peer:peer-7'] },
    })
    expect(serverSendMock).toHaveBeenCalledWith(expect.objectContaining({
      data: { ref: 'airi-asset:missing', error: expect.stringContaining('missing') },
      metadata: { event: { parentId: 'request-2' } },
    }))
    await chatAssetsRepo.clear()
  })

  it('sends input with a scene binding to the bound session', async () => {
    consciousness.activeProvider = 'mock-provider'
    consciousness.activeModel = 'mock-model'
    const store = useContextBridgeStore()
    await store.initialize()

    await emitServerEvent('input:text', {
      type: 'input:text',
      source: 'discord',
      metadata: createMetadata('discord', 'bot'),
      data: { text: 'hello', overrides: { binding: 'discord:channel:a' } },
    })

    expect(chatOrchestratorMock.send).toHaveBeenCalledTimes(1)
    expect(chatOrchestratorMock.send.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'bound:discord:channel:a' })
    await store.dispose()
  })

  // https://github.com/moeru-ai/airi/pull/3492#discussion_r4538897976
  // ROOT CAUSE: The gate read the selection of the consciousness store. That store holds the global default,
  // so an input for a character with its own chat model got no reply while the default was empty.
  it('sends input when the target session can send and the consciousness store has no selection', async () => {
    const store = useContextBridgeStore()
    await store.initialize()

    await emitServerEvent('input:text', {
      type: 'input:text',
      source: 'discord',
      metadata: createMetadata('discord', 'bot'),
      data: { text: 'hello', overrides: { binding: 'discord:channel:a' } },
    })

    expect(chatOrchestratorMock.chatReadyFor).toHaveBeenCalledWith('bound:discord:channel:a')
    expect(chatOrchestratorMock.send).toHaveBeenCalledTimes(1)
    await store.dispose()
  })

  it('does not send input when the target session cannot send', async () => {
    chatOrchestratorMock.chatReadyFor.mockReturnValue(false)
    const store = useContextBridgeStore()
    await store.initialize()

    await emitServerEvent('input:text', {
      type: 'input:text',
      source: 'discord',
      metadata: createMetadata('discord', 'bot'),
      data: { text: 'hello', overrides: { binding: 'discord:channel:a' } },
    })

    expect(chatOrchestratorMock.send).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('records the situation ingest result for broadcast context updates', async () => {
    const situation = initializeSituation(true)
    const store = useContextBridgeStore()
    await store.initialize()
    const contextSender = createTestChannel(CONTEXT_CHANNEL_NAME)

    contextSender.postMessage(createContextMessage({
      id: 'broadcast-context',
      metadata: createMetadata('weather', 'station-1'),
      text: 'broadcast weather',
    }))

    await vi.waitFor(() => {
      expect(situationIngestMock).toHaveBeenCalledTimes(1)
    })
    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'store-ingested',
      channel: 'broadcast',
      sourceKey: 'weather:station-1',
      mutation: 'replace',
      details: expect.objectContaining({
        entryCount: 1,
      }),
    }))
    expect(situation.state.contexts['weather:station-1']?.text).toBe('broadcast weather')

    await store.dispose()
  })

  it('turns a server context update into a situation context line before broadcasting', async () => {
    const situation = initializeSituation(true)
    const store = useContextBridgeStore()
    await store.initialize()

    await emitContextUpdate(createContextUpdateEvent({
      id: 'server-context',
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'server weather',
    }))

    expect(situationIngestMock).toHaveBeenCalledTimes(1)
    expect(situation.renderForRequest(Date.now())?.split('\n')).toContain('- server weather')
    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'store-ingested',
      channel: 'server',
      sourceKey: 'weather:station-1',
      mutation: 'replace',
      details: expect.objectContaining({
        entryCount: 1,
      }),
    }))
    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'broadcast-posted',
      channel: 'broadcast',
      contextId: 'server-context',
    }))

    await store.dispose()
  })

  // https://github.com/moeru-ai/airi/actions/runs/34237304157/job/102098223378
  // ROOT CAUSE:
  // The old consciousness mock omitted temperature and top-p. Input handling
  // failed before ingest. Use the real store and verify both request settings.
  it('records the situation ingest result for input context updates and forwards accepted updates', async () => {
    const situation = initializeSituation(true)
    consciousness.activeProvider = 'mock-provider'
    consciousness.activeModel = 'mock-model'
    consciousness.temperature = 0.3
    consciousness.topP = 0.8
    await useConsciousnessSettingsStore().setTemperatureEnabled(true)
    await useConsciousnessSettingsStore().setTopPEnabled(true)
    getProviderInstanceMock.mockResolvedValueOnce({})
    const store = useContextBridgeStore()
    await store.initialize()

    await emitServerEvent('input:text', {
      type: 'input:text',
      source: 'extension-module-host',
      metadata: createMetadata('weather', 'station-1'),
      data: {
        text: 'hello',
        contextUpdates: [
          {
            strategy: ContextUpdateStrategy.AppendSelf,
            text: 'input weather',
          },
        ],
      },
    })

    expect(situationIngestMock).toHaveBeenCalledTimes(1)
    expect(situation.state.contexts['weather:station-1']?.text).toBe('input weather')
    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'store-ingested',
      channel: 'input',
      sourceKey: 'weather:station-1',
      mutation: 'replace',
      details: expect.objectContaining({
        entryCount: 1,
        inputType: 'input:text',
      }),
    }))
    expect(chatOrchestratorMock.send).toHaveBeenCalledTimes(1)
    expect(chatOrchestratorMock.send.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'session-1',
      text: 'hello',
      topP: 0.8,
    })
    // The chat store resolves the temperature, so the session character's card can outrank the Consciousness setting.
    expect(chatOrchestratorMock.send.mock.calls[0]?.[0]).not.toHaveProperty('temperature')
    expect(chatOrchestratorMock.send.mock.calls[0]?.[0]?.input?.data.contextUpdates).toEqual([
      expect.objectContaining({
        contextId: expect.any(String),
        id: expect.any(String),
        text: 'input weather',
      }),
    ])

    await store.dispose()
  })

  it('records and broadcasts a server context update in a follower without ingesting it', async () => {
    const situation = initializeSituation(false)
    const postedContexts = collectChannelMessages<ContextMessage>(CONTEXT_CHANNEL_NAME)
    const store = useContextBridgeStore()
    await store.initialize()

    await emitContextUpdate(createContextUpdateEvent({ id: 'follower-context', text: 'follower weather' }))
    await vi.waitFor(() => expect(postedContexts).toHaveLength(1))

    expect(situation.state.contexts).toEqual({})
    expect(recordLifecycleMock).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'store-ingested' }))
    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({ phase: 'server-received', contextId: 'follower-context' }))
    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({ phase: 'broadcast-posted', contextId: 'follower-context' }))

    await store.dispose()
  })

  it('keeps the vision metadata of a server context update so the situation times it by its capture', async () => {
    const situation = initializeSituation(true)
    const store = useContextBridgeStore()
    await store.initialize()
    const capturedAt = Date.now() - 4_000

    await emitContextUpdate(createContextUpdateEvent({
      id: 'vision-context',
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'A code editor with a failing test.',
      metadata: { module: 'vision', capturedAt },
    }))

    expect(situation.state.contexts['weather:station-1']).toEqual({ text: 'A code editor with a failing test.', title: null, atMs: capturedAt })
    expect(situationIngestMock.mock.calls[0]?.[0]?.metadata).toMatchObject({
      module: 'vision',
      capturedAt,
      source: createMetadata('weather', 'station-1').source,
    })

    await store.dispose()
  })

  it('feeds Minecraft bot context into the situation through the Minecraft sensor', async () => {
    const situation = initializeSituation(true)
    const store = useContextBridgeStore()
    await store.initialize()

    await emitContextUpdate({
      type: 'context:update',
      source: 'minecraft-bot',
      metadata: { source: { id: 'minecraft-bot' } },
      data: { id: 'mc-1', contextId: 'mc-1', strategy: ContextUpdateStrategy.ReplaceSelf, text: 'Mining iron at y=12.' },
    })

    await vi.waitFor(() => {
      expect(situation.state.contexts['system:minecraft-integration']?.text).toBe('Minecraft bot (offline): Mining iron at y=12.')
    })

    await store.dispose()
  })

  it('records rejected lifecycle for broadcast ingest failures without interrupting the watcher', async () => {
    situationIngestMock.mockImplementationOnce(() => {
      throw new Error('Cannot clone broadcast context')
    })
    const store = useContextBridgeStore()
    await store.initialize()
    const contextSender = createTestChannel(CONTEXT_CHANNEL_NAME)

    contextSender.postMessage(createContextMessage({
      id: 'bad-broadcast-context',
      metadata: createMetadata('weather', 'station-1'),
      text: 'bad broadcast weather',
    }))

    await vi.waitFor(() => {
      expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'store-ingest-rejected',
        channel: 'broadcast',
        contextId: 'bad-broadcast-context',
        details: expect.objectContaining({
          errorMessage: 'Cannot clone broadcast context',
        }),
      }))
    })

    await store.dispose()
  })

  it('records rejected lifecycle and skips broadcast when server context ingest fails', async () => {
    situationIngestMock.mockImplementationOnce(() => {
      throw new Error('Cannot clone server context')
    })
    const postedContexts = collectChannelMessages(CONTEXT_CHANNEL_NAME)
    const store = useContextBridgeStore()
    await store.initialize()

    await emitContextUpdate(createContextUpdateEvent({
      id: 'bad-server-context',
      text: 'bad server weather',
    }))
    await waitForBroadcastDelivery()

    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'store-ingest-rejected',
      channel: 'server',
      contextId: 'bad-server-context',
      details: expect.objectContaining({
        errorMessage: 'Cannot clone server context',
      }),
    }))
    expect(recordLifecycleMock).not.toHaveBeenCalledWith(expect.objectContaining({
      phase: 'broadcast-posted',
      contextId: 'bad-server-context',
    }))
    expect(postedContexts).toHaveLength(0)

    await store.dispose()
  })

  it('records rejected lifecycle and continues text ingestion when input context ingest fails', async () => {
    situationIngestMock.mockImplementationOnce(() => {
      throw new Error('Cannot clone input context')
    })
    consciousness.activeProvider = 'mock-provider'
    consciousness.activeModel = 'mock-model'
    getProviderInstanceMock.mockResolvedValueOnce({})
    const store = useContextBridgeStore()
    await store.initialize()

    await emitServerEvent('input:text', {
      type: 'input:text',
      source: 'extension-module-host',
      metadata: createMetadata('weather', 'station-1'),
      data: {
        text: 'hello',
        contextUpdates: [
          {
            strategy: ContextUpdateStrategy.AppendSelf,
            text: 'bad input weather',
          },
        ],
      },
    })

    expect(recordLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'store-ingest-rejected',
      channel: 'input',
      details: expect.objectContaining({
        errorMessage: 'Cannot clone input context',
      }),
    }))
    expect(chatOrchestratorMock.send).toHaveBeenCalledTimes(1)
    expect(chatOrchestratorMock.send.mock.calls[0]?.[0]?.input?.data.contextUpdates).toEqual([])

    await store.dispose()
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3743366445
  it('keeps a remote stream visible locally without publishing chat authority state for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Plain Pinia consumers have remote stream tokens update only the
    // local stream store. The history requires a sending flag, but writing
    // that flag to the synchronized chat store would let a follower overwrite
    // the elected authority's stream snapshot.
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)

    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    await vi.waitFor(() => {
      expect(store.isReceivingRemoteStream).toBe(true)
    })
    expect(chatOrchestratorMock.sending).toBe(false)

    streamSender.postMessage({ type: 'assistant-progress', message: reply('hello'), sessionId: 'session-1', context })
    await vi.waitFor(() => {
      expect(showStreamMock).toHaveBeenCalledWith(reply('hello'))
    })

    streamSender.postMessage({ type: 'assistant-end', message: 'final answer', sessionId: 'session-1', context })
    await vi.waitFor(() => {
      expect(resetStreamMock).toHaveBeenCalledTimes(1)
    })

    expect(chatOrchestratorMock.sending).toBe(false)
    expect(store.isReceivingRemoteStream).toBe(false)

    await store.dispose()
  })

  it('shows a remote stream in a minimal window without the server channel or chat hooks', async () => {
    // ROOT CAUSE:
    //
    // The chat window and the floating chat window run with `stage-runtime=minimal`, so they do not call
    // `initialize`. Since #2771, the stream store does not synchronize the live reply. The renderer that runs
    // the turn publishes it on the context channel, and only `initialize` listened to that channel:
    //
    //   const fullStageRuntime = windowContext.stageRuntime === 'full' ? createFullStageRuntime() : null
    //
    // A chat window showed the reply only after the whole message was stored.
    //
    // We fixed this with `initializeStreamView`. It listens to the context channel and shows the stream.
    // It does not connect the server channel and does not run the chat hooks of the window.
    const localTokenHook = vi.fn()
    chatOrchestratorMock.onTokenLiteral(localTokenHook)
    const store = useContextBridgeStore()
    await store.initializeStreamView()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('hel'), sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'token-literal', literal: 'hel', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('hello'), sessionId: 'session-1', context })
    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledTimes(2))
    streamSender.postMessage({ type: 'assistant-end', message: 'hello', sessionId: 'session-1', context })
    await vi.waitFor(() => expect(refreshSessionMock).toHaveBeenCalledWith('session-1'))

    expect(showStreamMock).toHaveBeenNthCalledWith(1, reply('hel'))
    expect(showStreamMock).toHaveBeenNthCalledWith(2, reply('hello'))
    expect(localTokenHook).not.toHaveBeenCalled()
    expect(ensureConnectedMock).not.toHaveBeenCalled()
    expect(serverSendMock).not.toHaveBeenCalled()

    await store.dispose()
  })

  it('keeps a chat window reply on its break schedule when the stored reply replaces the stream', async () => {
    // ROOT CAUSE:
    //
    // The chat window keyed the remote stream by turn, but the reply is stored under its own id. The refresh
    // mounted the stored reply as complete, which showed a pending bubble early.
    //
    // The whole reply that the producing renderer sends carries the reply id, so the stored reply keeps the history item.
    const emptyStream: StreamingAssistantMessage = { role: 'assistant', content: '', slices: [], tool_results: [] }
    const shown = shallowRef<StreamingAssistantMessage>(emptyStream)
    // Each store call the bridge makes is recorded, so the test waits for the exact call instead of a delay.
    const streamCalls: string[] = []
    let streamCallWaiter: { call: string, resolve: () => void } | undefined
    const recordStreamCall = (call: string) => {
      streamCalls.push(call)
      if (streamCallWaiter?.call === call) {
        streamCallWaiter.resolve()
        streamCallWaiter = undefined
      }
    }
    const untilStreamCall = (call: string) => {
      if (streamCalls.includes(call))
        return Promise.resolve()
      const waiter = Promise.withResolvers<void>()
      streamCallWaiter = { call, resolve: waiter.resolve }
      return waiter.promise
    }
    showStreamMock.mockImplementation((message: StreamingAssistantMessage) => {
      shown.value = message
      recordStreamCall(`show:${message.slices.length}`)
    })
    resetStreamMock.mockImplementation(() => {
      shown.value = emptyStream
      recordStreamCall('reset')
    })
    const userMessage: ChatHistoryItem = { id: 'turn-1', role: 'user', content: 'ping' }
    const replyText = 'hey :3\n\nyou there? ^^'
    const storedReply: ChatHistoryItem = {
      id: 'assistant-1',
      role: 'assistant',
      content: replyText,
      slices: [{ type: 'text', text: 'hey :3' }, { type: 'break', seconds: 1 }, { type: 'text', text: 'you there? ^^' }],
      tool_results: [],
    }
    const firstBubble: StreamingAssistantMessage = { id: 'assistant-1', role: 'assistant', content: 'hey :3', slices: [{ type: 'text', text: 'hey :3' }], tool_results: [], createdAt: Date.now() }
    const bothBubbles: StreamingAssistantMessage = { ...firstBubble, content: replyText, slices: storedReply.slices }
    const sessionMessages = ref<ChatHistoryItem[]>([userMessage])
    refreshSessionMock.mockImplementation(async () => {
      sessionMessages.value = [userMessage, storedReply]
      return true
    })
    const store = useContextBridgeStore()
    await store.initializeStreamView()
    // The producing renderer's turn has already ended here, so only the bridge keeps the reply in view.
    const screen = render(defineComponent({
      setup: () => () => h(ChatHistory, {
        style: 'height: 480px; width: 480px; overflow-y: auto;',
        messages: sessionMessages.value,
        sending: store.isReceivingRemoteStream,
        streamingMessage: shown.value,
      }),
    }), { global: { plugins: [pinia] } })
    onTestFinished(() => screen.unmount())
    const bubbleTexts = () => Array.from(screen.container.querySelectorAll<HTMLElement>('[data-chat-bubble]')).map(bubble => bubble.textContent?.trim())
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      assistantMessageId: 'assistant-1',
      message: userMessage,
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: firstBubble, sessionId: 'session-1', context })
    await untilStreamCall('show:1')
    await vi.waitFor(() => expect(bubbleTexts()).toEqual([expect.stringContaining('hey :3')]))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      streamSender.postMessage({ type: 'assistant-progress', message: bothBubbles, sessionId: 'session-1', context })
      await untilStreamCall('show:3')
      await nextTick()
      expect(bubbleTexts()).toEqual([expect.stringContaining('hey :3')])

      // Generation ends 400 ms later, before the break's second: the stored reply replaces the stream.
      vi.advanceTimersByTime(400)
      streamSender.postMessage({ type: 'assistant-end', message: replyText, sessionId: 'session-1', context })
      await untilStreamCall('reset')
      await nextTick()
      expect(bubbleTexts()).toEqual([expect.stringContaining('hey :3')])

      vi.advanceTimersByTime(599)
      await nextTick()
      expect(bubbleTexts()).toEqual([expect.stringContaining('hey :3')])

      vi.advanceTimersByTime(1)
      await nextTick()
      expect(bubbleTexts()).toEqual([expect.stringContaining('hey :3'), 'you there? ^^'])
    }
    finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }

    await store.dispose()
  })

  it('shows the tool calls of a remote reply before its text', async () => {
    // ROOT CAUSE:
    //
    // A stream view rebuilt the reply from `token-literal` events only. Tool calls never crossed windows,
    // so the floating chat showed a waiting bubble through every tool round.
    //
    // We fixed this by sending the whole reply after each change.
    const store = useContextBridgeStore()
    await store.initializeStreamView()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = { sessionId: 'session-1', turnId: 'turn-1', message: { role: 'user', content: 'weather?' }, contexts: {}, composedMessage: [] } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'weather?', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('', ['get_weather']), sessionId: 'session-1', context })

    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledWith(reply('', ['get_weather'])))
    await store.dispose()
  })

  it('sends each change of a local reply whole to the stream views', async () => {
    const outgoingStreamMessages = collectChannelMessages<ChatStreamEvent>(CHAT_STREAM_CHANNEL_NAME)
    const store = useContextBridgeStore()
    await store.initialize()
    const context = { sessionId: 'session-1', turnId: 'turn-1', message: { role: 'user', content: 'weather?' }, contexts: {}, composedMessage: [] } satisfies ChatStreamEventContext

    streamActiveTurns.value = [{ sessionId: 'session-1', turnId: 'turn-1', message: reply('') }]
    await chatOrchestratorMock.emitBeforeSendHooks('weather?', context)
    streamActiveTurns.value = [{ sessionId: 'session-1', turnId: 'turn-1', message: reply('', ['get_weather']) }]

    await vi.waitFor(() => expect(outgoingStreamMessages).toHaveLength(3))
    expect(outgoingStreamMessages.map(event => event.type)).toEqual(['before-send', 'assistant-progress', 'assistant-progress'])
    expect(outgoingStreamMessages[2]).toMatchObject({ sessionId: 'session-1', message: reply('', ['get_weather']) })
    await store.dispose()
  })

  it('routes remote stream cancellation to the renderer that produced the turn', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamPeer = createContextChannel()
    testChannels.push(streamPeer)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    await chatOrchestratorMock.emitBeforeSendHooks('ping', context)
    await streamPeer.emitStreamCancel({ sessionId: 'session-1', turnId: 'turn-1' })

    await vi.waitFor(() => {
      expect(chatOrchestratorMock.cancelTurn).toHaveBeenCalledWith({ sessionId: 'session-1', turnId: 'turn-1' })
    })
    await store.dispose()
  })

  it('broadcasts cancellation when the producing renderer stops its turn', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamPeer = createContextChannel()
    testChannels.push(streamPeer)
    const cancellations: Array<{ sessionId: string, turnId: string }> = []
    streamPeer.onStreamCancel((command) => {
      cancellations.push(command)
    })
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    await chatOrchestratorMock.emitBeforeSendHooks('ping', context)
    await store.cancelRemoteStream('session-1')

    await vi.waitFor(() => {
      expect(cancellations).toEqual([{ sessionId: 'session-1', turnId: 'turn-1' }])
    })
    expect(chatOrchestratorMock.cancelPendingSends).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('retires the producer correlation before cancellation settles', async () => {
    let resolveCancellation: (() => void) | undefined
    chatOrchestratorMock.cancelTurn.mockImplementation(() => new Promise<void>((resolve) => {
      resolveCancellation = resolve
    }))
    const store = useContextBridgeStore()
    await store.initialize()
    const streamPeer = createContextChannel()
    testChannels.push(streamPeer)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    await chatOrchestratorMock.emitBeforeSendHooks('ping', context)
    void streamPeer.emitStreamCancel({ sessionId: 'session-1', turnId: 'turn-1' })
    await vi.waitFor(() => expect(chatOrchestratorMock.cancelTurn).toHaveBeenCalledTimes(1))

    await streamPeer.emitStreamCancel({ sessionId: 'session-1', turnId: 'turn-1' })
    expect(chatOrchestratorMock.cancelTurn).toHaveBeenCalledTimes(1)

    resolveCancellation?.()
    await store.dispose()
  })

  it('clears a mirrored stream when another receiver cancels it', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamPeer = createContextChannel()
    testChannels.push(streamPeer)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    await streamPeer.emitStream({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    await streamPeer.emitStream({ type: 'assistant-progress', message: reply(''), sessionId: 'session-1', context })
    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledWith(reply('')))
    expect(store.isReceivingRemoteStream).toBe(true)

    await streamPeer.emitStreamCancel({ sessionId: 'session-1', turnId: 'turn-1' })

    await vi.waitFor(() => expect(store.isReceivingRemoteStream).toBe(false))
    expect(resetStreamMock).toHaveBeenCalledTimes(1)
    expect(chatOrchestratorMock.cancelPendingSends).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('clears failed remote generation and rejects its late tokens', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const peer = createContextChannel()
    testChannels.push(peer)
    const context = { sessionId: 'session-1', turnId: 'failed', message: { role: 'user', content: 'ping' }, contexts: {}, composedMessage: [] } satisfies ChatStreamEventContext
    await peer.emitStream({ type: 'before-send', message: 'ping', sessionId: context.sessionId, context })
    await peer.emitStream({ type: 'assistant-progress', message: reply('partial'), sessionId: context.sessionId, context })
    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledWith(reply('partial')))
    await peer.emitStreamFailed(context)
    await vi.waitFor(() => expect(store.isReceivingRemoteStream).toBe(false))
    await peer.emitStream({ type: 'assistant-progress', message: reply('late'), sessionId: context.sessionId, context })
    await waitForBroadcastDelivery()
    expect(showStreamMock).not.toHaveBeenCalledWith(reply('late'))
    expect(resetStreamMock).toHaveBeenCalledOnce()
  })

  it('emits cancellation for the correlated remote turn', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamPeer = createContextChannel()
    testChannels.push(streamPeer)
    const cancellations: Array<{ sessionId: string, turnId: string }> = []
    streamPeer.onStreamCancel((command) => {
      cancellations.push(command)
    })
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    await streamPeer.emitStream({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    await streamPeer.emitStream({ type: 'assistant-progress', message: reply(''), sessionId: 'session-1', context })
    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledWith(reply('')))
    expect(store.isReceivingRemoteStream).toBe(true)

    await store.cancelRemoteStream('session-1')

    await vi.waitFor(() => {
      expect(cancellations).toEqual([{ sessionId: 'session-1', turnId: 'turn-1' }])
    })
    expect(store.isReceivingRemoteStream).toBe(false)
    expect(resetStreamMock).toHaveBeenCalledTimes(1)
    await store.dispose()
  })

  it('suppresses outbound broadcast while processing remote stream events', async () => {
    const outgoingStreamMessages = collectChannelMessages<{ sessionId: string }>(CHAT_STREAM_CHANNEL_NAME)
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)

    const context = {
      sessionId: 'remote-session',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    await chatOrchestratorMock.emitTokenSpecialHooks('manual-special', context)
    await vi.waitFor(() => {
      expect(outgoingStreamMessages).toHaveLength(1)
    })

    streamSender.postMessage({ type: 'token-special', special: 'remote-special', sessionId: 'remote-session', context })
    await waitForBroadcastDelivery()

    // The sender and local hook each publish once. Remote handling must not echo the sender.
    expect(outgoingStreamMessages.filter(message => message.sessionId === 'remote-session')).toHaveLength(2)

    await store.dispose()
  })

  it('labels outbound stream events with the session that owns the send', async () => {
    const outgoingStreamMessages = collectChannelMessages<{ sessionId: string }>(CHAT_STREAM_CHANNEL_NAME)
    const store = useContextBridgeStore()
    await store.initialize()
    // The context names its own session. Concurrent sends cannot borrow another send's owner.
    const context = {
      sessionId: 'session-a',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    chatOrchestratorMock.activeSendSessionId = 'session-c'
    activeSessionIdRef.value = 'session-b'
    await chatOrchestratorMock.emitTokenLiteralHooks('session A token', context)
    await vi.waitFor(() => expect(outgoingStreamMessages).toHaveLength(1))

    expect(outgoingStreamMessages[0]?.sessionId).toBe('session-a')
    await store.dispose()
  })

  it('clears remote stream visibility when an end hook rejects', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext
    chatOrchestratorMock.onStreamEnd(async () => {
      throw new Error('end hook failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    streamSender.postMessage({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply(''), sessionId: 'session-1', context })
    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledWith(reply('')))
    streamSender.postMessage({ type: 'stream-end', sessionId: 'session-1', context })
    await vi.waitFor(() => expect(store.isReceivingRemoteStream).toBe(false))

    expect(resetStreamMock).toHaveBeenCalledTimes(1)
    await store.dispose()
  })

  it('ignores stream events that do not match the active remote session', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    await vi.waitFor(() => expect(store.isReceivingRemoteStream).toBe(true))
    streamSender.postMessage({ type: 'assistant-progress', message: reply('foreign reply'), sessionId: 'session-2', context })
    streamSender.postMessage({ type: 'stream-end', sessionId: 'session-2', context })
    await waitForBroadcastDelivery()

    expect(showStreamMock).not.toHaveBeenCalled()
    expect(store.isReceivingRemoteStream).toBe(true)
    streamSender.postMessage({ type: 'assistant-end', message: 'done', sessionId: 'session-1', context })
    await vi.waitFor(() => expect(store.isReceivingRemoteStream).toBe(false))
    await store.dispose()
  })

  it('does not replace the foreground stream for an inactive remote session', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-2',
      turnId: 'turn-2',
      message: { role: 'user', content: 'background ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'background ping', sessionId: 'session-2', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('background reply'), sessionId: 'session-2', context })
    await waitForBroadcastDelivery()
    expect(showStreamMock).not.toHaveBeenCalled()
    expect(store.isReceivingRemoteStream).toBe(false)

    streamSender.postMessage({ type: 'stream-end', sessionId: 'session-2', context })
    await waitForBroadcastDelivery()
    expect(resetStreamMock).not.toHaveBeenCalled()
    await store.dispose()
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3755585351
  it('shows the whole remote reply after a mid-stream session switch for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // The bridge discarded literals while their session was not selected.
    // Selecting that session during the stream showed only later literals.
    // Each event now carries the whole reply, so the switch shows the latest one.
    activeSessionIdRef.value = 'session-2'
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-3',
      message: { role: 'user', content: 'background ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'background ping', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('first half '), sessionId: 'session-1', context })
    await waitForBroadcastDelivery()
    expect(showStreamMock).not.toHaveBeenCalled()

    activeSessionIdRef.value = 'session-1'
    await vi.waitFor(() => expect(showStreamMock).toHaveBeenCalledWith(reply('first half ')))
    streamSender.postMessage({ type: 'assistant-progress', message: reply('first half second half'), sessionId: 'session-1', context })

    await vi.waitFor(() => expect(showStreamMock).toHaveBeenLastCalledWith(reply('first half second half')))

    await store.dispose()
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3755711154
  it('reloads a completed remote stream when its plain-Pinia session becomes active for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // A plain-Pinia tab discarded a completed background stream.
    // Its loaded-session cache then prevented a later IndexedDB refresh.
    activeSessionIdRef.value = 'session-1'
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-2',
      turnId: 'turn-4',
      message: { role: 'user', content: 'background ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'background ping', sessionId: 'session-2', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('complete answer'), sessionId: 'session-2', context })
    streamSender.postMessage({ type: 'stream-end', sessionId: 'session-2', context })
    streamSender.postMessage({ type: 'assistant-end', message: 'complete answer', sessionId: 'session-2', context })
    await waitForBroadcastDelivery()

    expect(refreshSessionMock).not.toHaveBeenCalled()
    expect(resetStreamMock).not.toHaveBeenCalled()

    activeSessionIdRef.value = 'session-2'
    await vi.waitFor(() => expect(refreshSessionMock).toHaveBeenCalledWith('session-2'))
    await vi.waitFor(() => expect(resetStreamMock).toHaveBeenCalledTimes(1))
    expect(showStreamMock).toHaveBeenCalledWith(reply('complete answer'))
    expect(store.isReceivingRemoteStream).toBe(false)

    await store.dispose()
  })

  // https://github.com/moeru-ai/airi/pull/2741#discussion_r4170050033
  it('reports no live remote activity after a background response completes', async () => {
    // ROOT CAUSE:
    //
    // `assistant-end` marks a background remote guard completed and keeps it for
    // the later refresh. `remoteStreamSessionId` then names a finished response.
    //
    // After: `liveRemoteStreamSessionId` publishes the guard only while it is not
    // completed, and has no value after `assistant-end`.
    activeSessionIdRef.value = 'session-1'
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)
    const context = {
      sessionId: 'session-2',
      turnId: 'turn-5',
      message: { role: 'user', content: 'background ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'background ping', sessionId: 'session-2', context })
    await vi.waitFor(() => expect(store.liveRemoteStreamSessionId).toBe('session-2'))
    // Each session keeps its own remote stream. The retained id names only the visible session's stream.
    expect(store.remoteStreamSessionId).toBeUndefined()

    streamSender.postMessage({ type: 'assistant-end', message: 'complete answer', sessionId: 'session-2', context })
    await waitForBroadcastDelivery()

    expect(store.liveRemoteStreamSessionId).toBeUndefined()

    await store.dispose()
  })

  it('ignores remote replies and end events when generation guard is stale', async () => {
    const store = useContextBridgeStore()
    await store.initialize()
    const streamSender = createTestChannel(CHAT_STREAM_CHANNEL_NAME)

    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { role: 'user', content: 'ping' },
      contexts: {},
      composedMessage: [],
    } satisfies ChatStreamEventContext

    streamSender.postMessage({ type: 'before-send', message: 'ping', sessionId: 'session-1', context })
    streamSender.postMessage({ type: 'assistant-progress', message: reply('fresh'), sessionId: 'session-1', context })
    await vi.waitFor(() => {
      expect(showStreamMock).toHaveBeenCalledWith(reply('fresh'))
    })

    currentGeneration = 8
    streamSender.postMessage({ type: 'assistant-progress', message: reply('stale'), sessionId: 'session-1', context })
    await waitForBroadcastDelivery()

    streamSender.postMessage({ type: 'stream-end', sessionId: 'session-1', context })
    await waitForBroadcastDelivery()

    expect(showStreamMock).not.toHaveBeenCalledWith(reply('stale'))
    expect(finalizeStreamMock).not.toHaveBeenCalled()
    expect(chatOrchestratorMock.sending).toBe(false)
    expect(store.isReceivingRemoteStream).toBe(false)

    await store.dispose()
  })

  /** A widget window: its own Pinia, whose bridge asks the main window for reactions over the broadcast channel. */
  async function createWidgetBridge() {
    const widgetPinia = createPinia()
    const widget = useContextBridgeStore(widgetPinia)
    widget.setSparkNotifyHostRole('client')
    // Responses arrive through the listener that `initialize` starts, as in the widgets window.
    await widget.initialize()
    onTestFinished(async () => {
      await widget.dispose()
      disposePinia(widgetPinia)
      setActivePinia(pinia)
    })
    return widget
  }

  it('answers a widget window\'s reaction request with the reply of the main window\'s chat turn', async () => {
    leadWithMind()
    const main = useContextBridgeStore()
    main.setSparkNotifyHostRole('main')
    await main.initialize()
    chatOrchestratorMock.submitUnprompted.mockResolvedValue({ status: 'spoken', text: 'Oh, a QA widget!' })
    const widget = await createWidgetBridge()

    const reaction = await widget.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })

    expect(reaction).toBe('Oh, a QA widget!')
    expect(chatOrchestratorMock.submitUnprompted).toHaveBeenCalledOnce()
    expect(chatOrchestratorMock.submitUnprompted).toHaveBeenCalledWith(expect.objectContaining({ widget: true, topicText: 'QA widget', messageId: expect.stringMatching(/^spark:/) }))
  })

  /** Another Stage window, such as settings: its own Pinia and bridge, initialized as every non-widget window is. */
  async function createSecondWindowBridge() {
    const windowPinia = createPinia()
    const bridge = useContextBridgeStore(windowPinia)
    await bridge.initialize()
    onTestFinished(async () => {
      await bridge.dispose()
      disposePinia(windowPinia)
      setActivePinia(pinia)
    })
    return { bridge, character: characterWindows.at(-1)! }
  }

  it('records a spoken widget reaction once in its own window and once in every other window', async () => {
    leadWithMind()
    const main = useContextBridgeStore()
    main.setSparkNotifyHostRole('main')
    await main.initialize()
    const mainCharacter = characterWindows[0]
    const second = await createSecondWindowBridge()
    chatOrchestratorMock.submitUnprompted.mockResolvedValue({ status: 'spoken', text: 'Oh, a QA widget!' })

    const reaction = await main.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })
    const notifyId = (chatOrchestratorMock.submitUnprompted.mock.calls[0]![0] as { messageId: string }).messageId.replace(/^spark:/, '')
    await vi.waitFor(() => {
      expect(second.character.reactions).toEqual([[notifyId, 'Oh, a QA widget!']])
    })
    // The same reaction arriving again, here and in the main window, records nothing new. One channel delivers in
    // order, so once the sentinel is recorded everywhere, the repeat was handled before it.
    const repeat = new BroadcastChannel('airi-spark-notify-bridge')
    onTestFinished(() => repeat.close())
    repeat.postMessage({ type: 'reaction', topicKey: 'notify:plugin-module-host:any', id: notifyId, text: 'Oh, a QA widget!' })
    repeat.postMessage({ type: 'reaction', topicKey: 'notify:qa:sentinel', id: 'sentinel', text: 'sentinel' })
    await vi.waitFor(() => {
      expect(mainCharacter.reactions.at(-1)).toEqual(['sentinel', 'sentinel'])
      expect(second.character.reactions.at(-1)).toEqual(['sentinel', 'sentinel'])
    })

    expect(reaction).toBe('Oh, a QA widget!')
    expect(mainCharacter.reactions).toEqual([[notifyId, 'Oh, a QA widget!'], ['sentinel', 'sentinel']])
    expect(second.character.reactions).toEqual([[notifyId, 'Oh, a QA widget!'], ['sentinel', 'sentinel']])
  })

  it('records a gate reaction that names only its topic in the window that received the notify', async () => {
    const second = await createSecondWindowBridge()
    // The settings window ran the simulator, so it alone knows the notify id behind the topic.
    second.character.notifyIds.set('notify:devtools:qa-video', 'qa-video-delivery')
    const leader = new BroadcastChannel('airi-spark-notify-bridge')
    onTestFinished(() => leader.close())

    // A notify this window never handled, and a malformed post, record nothing; the last post arrives after both.
    leader.postMessage({ type: 'reaction', topicKey: 'notify:devtools:unknown', text: 'Not mine.' })
    leader.postMessage({ type: 'reaction', topicKey: 'notify:devtools:qa-video', id: 7, text: 42 })
    leader.postMessage({ type: 'reaction', topicKey: 'notify:devtools:qa-video', text: 'Oh, a QA video!' })
    await vi.waitFor(() => {
      expect(second.character.reactions).toHaveLength(1)
    })

    expect(second.character.reactions).toEqual([['qa-video-delivery', 'Oh, a QA video!']])
  })

  it('answers a declined widget reaction with its fallback text', async () => {
    leadWithMind()
    const main = useContextBridgeStore()
    main.setSparkNotifyHostRole('main')
    await main.initialize()
    chatOrchestratorMock.submitUnprompted.mockResolvedValue({ status: 'declined' })
    const widget = await createWidgetBridge()

    const reaction = await widget.dispatchSparkNotifyReaction({ headline: 'QA widget', fallbackResponseText: 'fallback' })

    expect(reaction).toBe('fallback')
    expect(chatOrchestratorMock.submitUnprompted).toHaveBeenCalledOnce()
    // The main window ran the declined turn, so it would have recorded a reaction before answering.
    expect(characterWindows[0].reactions).toEqual([])
  })
})
