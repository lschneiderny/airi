import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { Message, Tool } from '@xsai/shared-chat'

import type { Conversation } from '../messages/types'
import type { ChatHistoryItem, ChatTurnCueStats, ContextMessage, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent, StreamOptions } from '../types/llm'
import type { ChatOrchestratorPromptProjection, ChatOrchestratorRuntimeDeps, ChatOrchestratorRuntimeState, ChatOrchestratorSessionPort, ChatOrchestratorStageConfig } from './chat-orchestrator-runtime'

import { chunkTtsInput } from '@proj-airi/pipelines-audio'
import { ContextUpdateStrategy } from '@proj-airi/server-shared/types'
import { describe, expect, it, vi } from 'vitest'

import { chatMessagesToTurns, conversationToChatMessages } from '../messages/chat-completions'
import { createChatOrchestratorRuntime } from './chat-orchestrator-runtime'
import { streamFrom } from './llm-service'
import { replayReplyAtEveryChunking } from './reply-replay'

const provider: GenerationProvider = {
  generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.com/' } }),
}

/** Mirrors the stage rules that AIRI hosts pass; core-agent cannot import them from stage-shared. */
const liveStage: ChatOrchestratorStageConfig = { declineMarker: '<|SILENT|>', recoverCueNames: ['ACT', 'DELAY'] }

function createHarness(getActiveProvider = () => 'mock-provider', stage = liveStage) {
  const sessionMessages: Record<string, ChatHistoryItem[]> = {
    'session-1': [
      {
        role: 'system',
        content: 'system prompt',
        createdAt: new Date(2026, 3, 25, 18, 0).getTime(),
        id: 'system',
      },
    ],
  }
  const contextSnapshot: Record<string, ContextMessage[]> = {}
  const foregroundPatches: StreamingAssistantMessage[] = []
  const foregroundResets: StreamingAssistantMessage[] = []
  const lifecycleRecords: unknown[] = []
  const promptProjections: unknown[] = []
  const userAppended: unknown[] = []
  const assistantAppended: unknown[] = []
  const userTurns: unknown[] = []
  const assistantTurns: unknown[] = []
  const stateChanges: unknown[] = []
  const settled: unknown[] = []
  const declined: unknown[] = []
  // One ordered log of every runtime callback, so hook-ordering invariants can be asserted across ports.
  const order: string[] = []
  const orderWaiters = new Set<{ matches: (entries: readonly string[]) => boolean, resolve: () => void }>()
  function log(entry: string) {
    order.push(entry)
    for (const waiter of orderWaiters) {
      if (!waiter.matches(order))
        continue
      orderWaiters.delete(waiter)
      waiter.resolve()
    }
  }
  /** Resolves once the callback log satisfies `matches`. Call it before triggering the awaited work. */
  function untilOrder(matches: (entries: readonly string[]) => boolean) {
    if (matches(order))
      return Promise.resolve()
    const waiter = Promise.withResolvers<void>()
    orderWaiters.add({ matches, resolve: waiter.resolve })
    return waiter.promise
  }
  const telemetry = {
    chatActivationStarted: [] as unknown[],
    chatActivationSucceeded: [] as unknown[],
    chatActivationFailed: [] as unknown[],
    messageSendStarted: [] as unknown[],
    llmRequestStarted: [] as unknown[],
    llmFirstToken: [] as unknown[],
    assistantResponseRendered: [] as unknown[],
    llmGeneration: [] as unknown[],
    messageRound: [] as unknown[],
    messageRoundFailed: [] as unknown[],
  }
  const stream = vi.fn(async (_model: string, _chatProvider: GenerationProvider, _messages: Conversation, options?: StreamOptions) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
    await options?.onStreamEvent?.({ type: 'finish' })
  })
  const ids = ['stream-context', 'assistant-id', 'user-id', 'fallback-id']
  let nextId = 0
  let nowValue = new Date(2026, 3, 25, 18, 47).getTime()
  let monotonicNowValues = [1000]
  let generation = 1
  let contextWindow = -1
  let assistantResponseRenderedError: Error | undefined
  const commitUserMessage = vi.fn<ChatOrchestratorSessionPort['commitUserMessage']>(async (sessionId, message) => {
    log('commitUserMessage')
    sessionMessages[sessionId] ??= []
    const existing = sessionMessages[sessionId].some(item => item.id === message.id)
    if (!existing)
      sessionMessages[sessionId].push(message)
    return { status: existing ? 'existing' : 'inserted', messageId: message.id }
  })

  const runtime = createChatOrchestratorRuntime({
    stage,
    session: {
      commitUserMessage,
      getSessionMessages: sessionId => sessionMessages[sessionId] ?? [],
      commitAssistantMessage: async (sessionId, message) => {
        log(`commitAssistantMessage:${message.role}${message.interrupted ? ':interrupted' : ''}`)
        sessionMessages[sessionId] ??= []
        sessionMessages[sessionId].push(message)
      },
      getSessionGeneration: () => generation,
    },
    context: {
      ingest: vi.fn(),
      snapshot: () => structuredClone(contextSnapshot),
    },
    foregroundStream: {
      patch: (message) => {
        log('foreground:patch')
        foregroundPatches.push(message)
      },
      reset: () => {
        log('foreground:reset')
        foregroundResets.push({ role: 'assistant', content: '', slices: [], tool_results: [] })
      },
    },
    llm: {
      stream,
    },
    getActiveSessionId: () => 'session-1',
    getActiveProvider,
    getContextWindow: () => contextWindow,
    now: () => nowValue,
    monotonicNow: () => monotonicNowValues.shift() ?? 1000,
    createId: () => ids.shift() ?? `generated-${nextId++}`,
    onLifecycle: (record) => {
      log(`lifecycle:${record.phase}`)
      lifecycleRecords.push(record)
    },
    onPromptProjection: (payload) => {
      log('promptProjection')
      promptProjections.push(payload)
    },
    onUserMessageAppended: (event) => {
      log('userMessageAppended')
      userAppended.push(event)
    },
    onAssistantMessageAppended: (event) => {
      log('assistantMessageAppended')
      assistantAppended.push(event)
    },
    onUserTurnReady: (event) => {
      log('userTurnReady')
      userTurns.push(event)
    },
    onAssistantTurnReady: (event) => {
      log('assistantTurnReady')
      assistantTurns.push(event)
    },
    onStateChange: state => stateChanges.push(state),
    onSendSettled: (event) => {
      log(`settled:${event.status}`)
      settled.push(event)
    },
    onTurnDeclined: (event) => {
      log('turnDeclined')
      declined.push(event)
    },
    onTrackFirstMessage: () => {
      log('trackFirstMessage')
    },
    onChatActivationStarted: (event) => {
      log('chatActivationStarted')
      telemetry.chatActivationStarted.push(event)
    },
    onChatActivationSucceeded: (event) => {
      log('chatActivationSucceeded')
      telemetry.chatActivationSucceeded.push(event)
    },
    onChatActivationFailed: (event) => {
      log('chatActivationFailed')
      telemetry.chatActivationFailed.push(event)
    },
    onMessageSendStarted: (event) => {
      log('messageSendStarted')
      telemetry.messageSendStarted.push(event)
    },
    onLlmRequestStarted: (event) => {
      log('llmRequestStarted')
      telemetry.llmRequestStarted.push(event)
    },
    onLlmFirstToken: (event) => {
      log('llmFirstToken')
      telemetry.llmFirstToken.push(event)
    },
    onAssistantResponseRendered: (event) => {
      log('assistantResponseRendered')
      if (assistantResponseRenderedError)
        throw assistantResponseRenderedError
      telemetry.assistantResponseRendered.push(event)
    },
    onLlmGeneration: (event) => {
      log('llmGeneration')
      telemetry.llmGeneration.push(event)
    },
    onMessageRound: (event) => {
      log('messageRound')
      telemetry.messageRound.push(event)
    },
    onMessageRoundFailed: (event) => {
      log('messageRoundFailed')
      telemetry.messageRoundFailed.push(event)
    },
  })

  /** Records every chat hook in `order`, including literal and special payloads. */
  function recordHooks() {
    runtime.hooks.onBeforeMessageComposed(async () => {
      log('hook:before-compose')
    })
    runtime.hooks.onAfterMessageComposed(async () => {
      log('hook:after-compose')
    })
    runtime.hooks.onBeforeSend(async () => {
      log('hook:before-send')
    })
    runtime.hooks.onTokenLiteral(async (literal) => {
      log(`hook:token-literal:${literal}`)
    })
    runtime.hooks.onTokenSpecial(async (special) => {
      log(`hook:token-special:${special}`)
    })
    runtime.hooks.onStreamEnd(async () => {
      log('hook:stream-end')
    })
    runtime.hooks.onAssistantResponseEnd(async (message) => {
      log(`hook:assistant-end:${message}`)
    })
    runtime.hooks.onAfterSend(async () => {
      log('hook:after-send')
    })
    runtime.hooks.onAssistantMessage(async (_message, messageText) => {
      log(`hook:assistant-message:${messageText}`)
    })
    runtime.hooks.onChatTurnComplete(async () => {
      log('hook:turn-complete')
    })
  }

  return {
    declined,
    order,
    recordHooks,
    untilOrder,
    settled,
    commitUserMessage,
    assistantAppended,
    assistantResponseRenderedError: {
      set: (error: Error | undefined) => {
        assistantResponseRenderedError = error
      },
    },
    assistantTurns,
    contextSnapshot,
    contextWindow: {
      set: (next: number) => {
        contextWindow = next
      },
    },
    foregroundPatches,
    foregroundResets,
    generation: {
      set: (next: number) => {
        generation = next
      },
    },
    lifecycleRecords,
    now: {
      set: (next: number) => {
        nowValue = next
      },
    },
    monotonicNow: {
      set: (next: number[]) => {
        monotonicNowValues = [...next]
      },
    },
    promptProjections,
    runtime,
    sessionMessages,
    stateChanges,
    stream,
    telemetry,
    userAppended,
    userTurns,
  }
}

describe('createChatOrchestratorRuntime', () => {
  // https://github.com/moeru-ai/airi/pull/3289#pullrequestreview-5731937285
  // ROOT CAUSE:
  // Message counts and rounded-down retention split turns and discarded recent replies in small windows.
  // Count user/assistant groups as turns and round 90 percent retention up.
  it.each([
    [0, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    [-1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
    [1, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    [2, [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]],
    [3, [1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]],
    [5, [1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5]],
    [10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 10]],
    [11, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10]],
  ])('retains whole turns across twelve sends at limit %i (PR #3289)', async (limit, expected) => {
    const harness = createHarness()
    harness.contextWindow.set(limit)
    for (let index = 0; index < 12; index++)
      await harness.runtime.ingest(`input-${index}`, { model: 'gpt-test', chatProvider: provider })

    const requests = harness.stream.mock.calls.map(call => call[2].turns.filter(turn => turn.type !== 'system'))
    expect(requests.map(turns => turns.filter(turn => turn.type === 'user').length)).toEqual(expected)
    for (const [index, turns] of requests.entries()) {
      expect(turns.map(turn => turn.type)).toEqual([
        ...Array.from({ length: expected[index]! - 1 }, () => ['user', 'assistant']).flat(),
        'user',
      ])
      expect(JSON.stringify(turns.at(-1))).toContain(`input-${index}`)
    }
    expect(harness.sessionMessages['session-1']).toHaveLength(25)
  })

  // https://github.com/moeru-ai/airi/pull/3289#pullrequestreview-5731937285
  // ROOT CAUSE:
  // Deletions join messages with the same role. A message offset can split the resulting group.
  // Find whole user groups and keep their assistant and tool messages together.
  it.each(['user', 'assistant'] as const)('keeps consecutive %s messages together after deletion (PR #3289)', async (role) => {
    const harness = createHarness()
    harness.contextWindow.set(3)
    for (let index = 0; index < 4; index++)
      await harness.runtime.ingest(`input-${index}`, { model: 'gpt-test', chatProvider: provider })

    const messages = harness.sessionMessages['session-1']
    const deletedIndex = role === 'user' ? 4 : 5
    messages.splice(deletedIndex, 1)
    await harness.runtime.ingest('after deletion', { model: 'gpt-test', chatProvider: provider })

    const request = harness.stream.mock.calls[4]![2]
    const types = request.turns.map(turn => turn.type)
    expect(types).toEqual(role === 'user'
      ? ['system', 'user', 'user', 'assistant', 'user', 'assistant', 'user']
      : ['system', 'user', 'assistant', 'assistant', 'user', 'assistant', 'user'])
    expect(JSON.stringify(request)).toContain('input-1')
    expect(JSON.stringify(request)).not.toContain('input-0')
  })

  it('expands the cached boundary when deletion joins its user group to an earlier user message', async () => {
    const harness = createHarness()
    harness.contextWindow.set(10)
    for (let index = 0; index < 11; index++)
      await harness.runtime.ingest(`input-${index}`, { model: 'gpt-test', chatProvider: provider })

    const messages = harness.sessionMessages['session-1']
    const joinedUser = messages[3]!
    expect(harness.stream.mock.calls[10]![2].turns.map(turn => turn.id)).not.toContain(`${joinedUser.id}-0`)
    messages.splice(4, 1)
    await harness.runtime.ingest('after deletion', { model: 'gpt-test', chatProvider: provider })

    const turns = harness.stream.mock.calls[11]![2].turns
    expect(turns[1]?.id).toBe(`${joinedUser.id}-0`)
    expect(turns.slice(1, 4).map(turn => turn.type)).toEqual(['user', 'user', 'assistant'])
    expect(turns.filter(turn => turn.type === 'assistant')).toHaveLength(9)
    expect(JSON.stringify(turns)).not.toContain('input-0')
  })

  it('keeps consecutive current inputs in one turn after the last reply is deleted', async () => {
    const harness = createHarness()
    harness.contextWindow.set(2)
    await harness.runtime.ingest('first input', { model: 'gpt-test', chatProvider: provider })
    await harness.runtime.ingest('second input', { model: 'gpt-test', chatProvider: provider })
    harness.sessionMessages['session-1'].pop()
    await harness.runtime.ingest('third input', { model: 'gpt-test', chatProvider: provider })

    const turns = harness.stream.mock.calls[2]![2].turns
    expect(turns.map(turn => turn.type)).toEqual(['system', 'user', 'assistant', 'user', 'user'])
    expect(JSON.stringify(turns)).toContain('first input')
    expect(JSON.stringify(turns)).toContain('second input')
    expect(JSON.stringify(turns)).toContain('third input')
  })

  it('sends an earlier reply back with the cues the runtime accepted and keeps the stored reply as written', async () => {
    const harness = createHarness()
    const replies = ['<|ACT happy|> Well formed.', '[ACT happy] Bracketed. [DELAY 1s]', 'Third.']
    harness.stream.mockImplementation(async (_model, _provider, _context, options) => {
      const text = replies[harness.stream.mock.calls.length - 1]!
      const [turn] = chatMessagesToTurns([{ role: 'assistant', content: text }])
      if (turn?.type !== 'assistant')
        throw new Error('Expected assistant turn')
      // A live generation stores the provider's own messages beside the portable content.
      turn.rounds[0]!.continuation = { protocol: 'chat-completions', scope: 'scope', data: [{ role: 'assistant', content: text }] }
      await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onGeneratedTurn?.(turn)
      await options?.onStreamEvent?.({ type: 'finish' })
    })
    for (const input of ['one', 'two', 'three'])
      await harness.runtime.ingest(input, { model: 'gpt-test', chatProvider: provider })

    // Both projections of the same history: the provider's own messages, and the portable content another provider gets.
    for (const scope of ['scope', undefined]) {
      const requests = harness.stream.mock.calls.map(call => conversationToChatMessages(call[2], true, scope))
      const repliesSent = requests.map(messages => messages.filter(message => message.role === 'assistant').map(message => message.content))
      expect(repliesSent).toEqual([
        [],
        ['<|ACT happy|> Well formed.'],
        ['<|ACT happy|> Well formed.', '<|ACT happy|> Bracketed. '],
      ])
      // Each request repeats the one before it byte for byte, so a provider prompt cache keeps its prefix.
      expect(requests[2]!.slice(0, requests[1]!.length)).toEqual(requests[1])
    }

    const stored = harness.sessionMessages['session-1'].filter(message => message.role === 'assistant')
    expect(stored.map(message => message.generationTranscript?.rounds[0]?.content)).toEqual(replies.map(text => [{ type: 'text', text }]))
    expect(stored.map(message => message.generationTranscript?.rounds[0]?.continuation?.data)).toEqual(replies.map(text => [{ role: 'assistant', content: text }]))
    expect(stored.map(message => message.content)).toEqual([' Well formed.', ' Bracketed. ', 'Third.'])
  })

  it('keeps the newest 90 percent of turns when a card context window is exceeded', async () => {
    const harness = createHarness()
    harness.contextWindow.set(10)
    for (let index = 0; index < 20; index++) {
      if (index % 2 === 0) {
        harness.sessionMessages['session-1'].push({ role: 'user', content: `history-${index}`, id: `history-${index}` })
      }
      else {
        harness.sessionMessages['session-1'].push({ role: 'assistant', content: `history-${index}`, id: `history-${index}`, slices: [], tool_results: [] })
      }
    }

    await harness.runtime.ingest('latest message', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const turns = harness.stream.mock.calls[0]![2].turns
    expect(turns.filter(turn => turn.type !== 'system')).toHaveLength(17)
    expect(turns[0]?.type).toBe('system')
    expect(turns[1]?.type).toBe('user')
    expect(turns.at(-1)?.type).toBe('user')
    expect(JSON.stringify(turns)).toContain('latest message')
    expect(JSON.stringify(turns)).not.toContain('history-0')
  })

  it('holds the history prefix until the retained turns exceed the limit again', async () => {
    const harness = createHarness()
    harness.contextWindow.set(20)
    for (let index = 0; index < 40; index++) {
      harness.sessionMessages['session-1'].push(index % 2 === 0
        ? { role: 'user', content: `history-${index}`, id: `history-${index}` }
        : { role: 'assistant', content: `history-${index}`, id: `history-${index}`, slices: [], tool_results: [] })
    }
    const originalIds = harness.sessionMessages['session-1'].map(message => message.id)
    for (let index = 0; index < 4; index++)
      await harness.runtime.ingest(`new-${index}`, { model: 'gpt-test', chatProvider: provider })

    const requests = harness.stream.mock.calls.map(call => call[2].turns.filter(turn => turn.type !== 'system'))
    expect(requests.map(turns => turns.length)).toEqual([35, 37, 39, 35])
    expect(requests[0]?.[0]?.id).toBe('history-6-0')
    expect(requests[1]?.slice(0, 35)).toEqual(requests[0])
    expect(requests[2]?.slice(0, 35)).toEqual(requests[0])
    expect(requests[3]?.[0]?.id).toBe('history-12-0')
    expect(harness.sessionMessages['session-1'].slice(0, originalIds.length).map(message => message.id)).toEqual(originalIds)
  })

  it('skips assistant and tool messages at the cut and preserves complete later tool exchanges', async () => {
    const harness = createHarness()
    harness.contextWindow.set(2)
    harness.sessionMessages['session-1'].push(
      { role: 'user', content: 'old user', id: 'old-user' },
      { role: 'assistant', content: '', id: 'old-call', slices: [], tool_results: [], tool_calls: [{ id: 'old-tool', type: 'function', function: { name: 'weather', arguments: '{}' } }] },
      { role: 'tool', content: 'old result', tool_call_id: 'old-tool', id: 'old-result' },
      { role: 'user', content: 'kept user', id: 'kept-user' },
      {
        role: 'assistant',
        content: 'weather reply',
        id: 'kept-call',
        slices: [],
        tool_results: [],
        providerTranscript: [
          { role: 'assistant', content: '', tool_calls: [{ id: 'kept-tool', type: 'function', function: { name: 'weather', arguments: '{}' } }] },
          { role: 'tool', content: 'kept result', tool_call_id: 'kept-tool' },
          { role: 'assistant', content: 'weather reply' },
        ],
      },
    )
    await harness.runtime.ingest('latest', { model: 'gpt-test', chatProvider: provider })

    const request = harness.stream.mock.calls[0]![2]
    expect(request.turns[0]?.type).toBe('system')
    expect(request.turns[1]?.id).toBe('kept-user-0')
    expect(JSON.stringify(request)).not.toContain('old-tool')
    expect(JSON.stringify(request)).toContain('kept-tool')
    expect(JSON.stringify(request)).toContain('kept result')
  })

  it('sends only the system prompt and current input when the limit is zero', async () => {
    const harness = createHarness()
    harness.contextWindow.set(0)
    await harness.runtime.ingest('old input', { model: 'gpt-test', chatProvider: provider })
    await harness.runtime.ingest('current input', { model: 'gpt-test', chatProvider: provider })

    const request = harness.stream.mock.calls[1]![2]
    expect(request.turns.map(turn => turn.type)).toEqual(['system', 'user'])
    expect(JSON.stringify(request)).toContain('current input')
    expect(JSON.stringify(request)).not.toContain('old input')
  })

  it('isolates history cuts by session and resets them when the limit changes', async () => {
    const harness = createHarness()
    harness.contextWindow.set(2)
    for (let index = 0; index < 3; index++)
      await harness.runtime.ingest(`first-${index}`, { model: 'gpt-test', chatProvider: provider })
    await harness.runtime.ingest('second session', { model: 'gpt-test', chatProvider: provider }, 'session-2')
    expect(JSON.stringify(harness.stream.mock.calls[3]![2])).toContain('second session')
    expect(JSON.stringify(harness.stream.mock.calls[3]![2])).not.toContain('first-')

    harness.contextWindow.set(20)
    await harness.runtime.ingest('larger limit', { model: 'gpt-test', chatProvider: provider })
    expect(JSON.stringify(harness.stream.mock.calls[4]![2])).toContain('first-0')
    harness.contextWindow.set(-1)
    await harness.runtime.ingest('all history', { model: 'gpt-test', chatProvider: provider })
    expect(JSON.stringify(harness.stream.mock.calls[5]![2])).toContain('first-0')
  })

  it('recomputes the cut after the retained start is removed from history', async () => {
    const harness = createHarness()
    harness.contextWindow.set(2)
    for (let index = 0; index < 3; index++)
      await harness.runtime.ingest(`old-${index}`, { model: 'gpt-test', chatProvider: provider })
    harness.sessionMessages['session-1'] = [{ role: 'user', content: 'replacement', id: 'replacement' }]
    await harness.runtime.ingest('new input', { model: 'gpt-test', chatProvider: provider })
    expect(harness.stream.mock.calls[3]![2].turns[0]?.id).toBe('replacement-0')
  })

  it.each(['generation', 'cancellation'] as const)('resets the cut on session %s', async (reset) => {
    const harness = createHarness()
    harness.contextWindow.set(10)
    for (let index = 0; index < 11; index++)
      await harness.runtime.ingest(`old-${index}`, { model: 'gpt-test', chatProvider: provider })
    // Retain the anchor but shorten the conversation, as when history is edited or restored.
    harness.sessionMessages['session-1'] = harness.sessionMessages['session-1'].slice(0, 7)
    if (reset === 'generation')
      harness.generation.set(2)
    else
      harness.runtime.cancelPendingSends('session-1')
    await harness.runtime.ingest('after reset', { model: 'gpt-test', chatProvider: provider })
    expect(JSON.stringify(harness.stream.mock.calls[11]![2])).toContain('old-0')
  })

  // ROOT CAUSE:
  //
  // The marker parser holds back the end of the text and handles text later than it receives it.
  // A tool call joined the reply at once, so it landed inside the sentence before it.
  //
  // We now flush the parser at each tool call first.
  it.each([
    ['the text settled before the call', true],
    ['the text and the call arrive together', false],
  ])('keeps the text before a tool call in front of it when %s', async (_name, settled) => {
    const harness = createHarness()
    const call = { type: 'tool-call', toolCallId: 'call-weather', toolCallType: 'function', toolName: 'weather', args: '{}' } as const
    const firstLiteral = Promise.withResolvers<void>()
    harness.runtime.hooks.onTokenLiteral(async () => {
      firstLiteral.resolve()
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      // xsAI does not wait for the handler of an event before it sends the next one.
      for (const text of ['查曼谷', '和上海', '未来三天的天气。'])
        void options?.onStreamEvent?.({ type: 'text-delta', text })
      // Settled text has already reached a token hook before the call arrives.
      if (settled)
        await firstLiteral.promise
      void options?.onStreamEvent?.(call)
      void options?.onStreamEvent?.({ type: 'tool-result', toolCallId: 'call-weather', result: 'sunny' })
      void options?.onStreamEvent?.({ type: 'text-delta', text: '第 1/3 步完成。' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('weather', { model: 'test', chatProvider: provider })

    const saved = harness.sessionMessages['session-1'].findLast(message => message.role === 'assistant')
    expect(saved?.role === 'assistant' && saved.slices).toEqual([
      { type: 'text', text: '查曼谷和上海未来三天的天气。' },
      { type: 'tool-call', toolCall: call },
      { type: 'text', text: '第 1/3 步完成。' },
    ])
  })

  // https://github.com/moeru-ai/airi/pull/3008#discussion_r4302605324
  // ROOT CAUSE:
  // Calls wait for preceding text hooks before they join the reply.
  // An error or cancellation can save the reply before those hooks finish.
  // The interrupted reply must retain received calls without waiting for the hooks.
  it.each([
    ['provider error', true],
    ['provider error', false],
    ['cancellation', true],
    ['cancellation', false],
  ] as const)('preserves calls after %s with prior visible text: %s (PR #3008)', async (failure, priorText) => {
    const harness = createHarness()
    const firstLiteral = Promise.withResolvers<void>()
    const blockedLiteral = Promise.withResolvers<void>()
    const releaseHook = Promise.withResolvers<void>()
    const receivedCalls = Promise.withResolvers<void>()
    const releaseProvider = Promise.withResolvers<void>()
    let literalCount = 0
    harness.runtime.hooks.onTokenLiteral(async () => {
      if (priorText && ++literalCount === 1) {
        firstLiteral.resolve()
        return
      }
      blockedLiteral.resolve()
      await releaseHook.promise
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      if (priorText) {
        await options?.onStreamEvent?.({ type: 'text-delta', text: 'Text that already reached the reply.' })
        await firstLiteral.promise
      }
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Text that waits for a token hook.' })
      await blockedLiteral.promise
      for (const toolCallId of ['call-first', 'call-second'])
        await options?.onStreamEvent?.({ type: 'tool-call', toolCallId, toolCallType: 'function', toolName: 'weather', args: '{}' })
      receivedCalls.resolve()
      if (failure === 'provider error')
        throw new Error('Provider disconnected after delivering calls')
      await releaseProvider.promise
    })
    const request = harness.runtime.submit('weather', { model: 'test', chatProvider: provider, messageId: 'interrupted-turn' }, 'session-1')
    const done = request.done.catch(error => error)
    try {
      await receivedCalls.promise
      if (failure === 'cancellation')
        harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'interrupted-turn' })
      const outcome = await done
      if (failure === 'provider error')
        expect(outcome).toBeInstanceOf(Error)

      const saved = harness.sessionMessages['session-1'].findLast(message => message.role === 'assistant')
      expect(saved).toMatchObject({ role: 'assistant', interrupted: true })
      expect(saved?.role === 'assistant' && saved.slices.filter(slice => slice.type === 'tool-call').map(slice => slice.toolCall.toolCallId)).toEqual(['call-first', 'call-second'])

      const snapshot = structuredClone(saved)
      const patchCount = harness.foregroundPatches.length
      releaseHook.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(saved).toEqual(snapshot)
      expect(harness.foregroundPatches).toHaveLength(patchCount)
    }
    finally {
      releaseHook.resolve()
      releaseProvider.resolve()
      await done
    }
  })

  // https://github.com/moeru-ai/airi/issues/2899
  // ROOT CAUSE:
  //
  // The marker parser can emit whitespace as a separate literal.
  // The speechOnly.trim() check discarded it before history, slices, and hooks received it.
  //
  // We keep every non-empty speech literal so delta boundaries do not remove whitespace.
  it.each([
    ['spaces', 'Hello world again'],
    ['paragraph breaks', 'First paragraph\n\nSecond paragraph'],
    ['indentation', 'Example:\n\t  code line\nDone'],
    ['leading and trailing spaces', '  Hello world  '],
  ])('preserves %s across stream delta boundaries (Issue #2899)', async (_name, text) => {
    for (const deltas of [[text], Array.from(text)]) {
      const harness = createHarness()
      const literals: string[] = []
      harness.runtime.hooks.onTokenLiteral(async (literal) => {
        literals.push(literal)
      })
      harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
        for (const delta of deltas)
          await options?.onStreamEvent?.({ type: 'text-delta', text: delta })
        await options?.onStreamEvent?.({ type: 'finish' })
      })

      await harness.runtime.ingest('return formatted text', {
        model: 'gpt-test',
        chatProvider: provider,
      })

      const saved = harness.sessionMessages['session-1'].findLast(message => message.role === 'assistant')
      expect(saved?.content).toBe(text)
      expect(saved?.role === 'assistant' && saved.slices.filter(slice => slice.type === 'text').map(slice => slice.text).join('')).toBe(text)
      expect(literals.join('')).toBe(text)
    }
  })

  it.each([
    ['reasoning and a marker', ['<think>analysis</think>', 'Visible reply<|ACT|>'], 'Visible reply', ['<|ACT|>']],
    ['reasoning only', ['<think>analysis</think>'], undefined, []],
    ['empty output', [''], undefined, []],
  ])('keeps %s separate from speech literals', async (_name, deltas, expected, expectedSpecials) => {
    const harness = createHarness()
    const literals: string[] = []
    const specials: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (literal) => {
      literals.push(literal)
    })
    harness.runtime.hooks.onTokenSpecial(async (special) => {
      specials.push(special)
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      for (const text of deltas)
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('return reply', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const saved = harness.sessionMessages['session-1'].findLast(message => message.role === 'assistant')
    expect(saved?.content).toBe(expected)
    expect(literals.join('')).toBe(expected ?? '')
    expect(specials).toEqual(expectedSpecials)
  })

  // https://github.com/moeru-ai/airi/pull/2911#discussion_r4238926356
  // ROOT CAUSE:
  //
  // A whitespace-only literal created a text slice before any visible speech arrived.
  // The completion path stored that slice as a blank reply.
  //
  // Buffering leading whitespace until visible speech arrives avoids blank speech slices and hooks.
  it.each([
    ['spaces', '        '],
    ['tabs', '\t\t\t\t\t\t\t\t'],
    ['line breaks', '\n\n\n\n\n\n\n\n'],
    ['mixed whitespace', ' \t\n \t\n  '],
    ['reasoning with a trailing newline', '<think>analysis</think>\n'],
    ['reasoning with trailing whitespace', '<think>analysis</think> \t\n'],
  ])('does not store a blank speech reply for %s (PR #2911)', async (_name, text) => {
    const reasoning = '<think>analysis</think>'
    const streamedDeltas = text.startsWith(reasoning)
      ? [reasoning, ...Array.from(text.slice(reasoning.length))]
      : Array.from(text)
    for (const deltas of [[text], streamedDeltas]) {
      const harness = createHarness()
      const literals: string[] = []
      harness.runtime.hooks.onTokenLiteral(async (literal) => {
        literals.push(literal)
      })
      harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
        for (const text of deltas)
          await options?.onStreamEvent?.({ type: 'text-delta', text })
        await options?.onStreamEvent?.({ type: 'finish' })
      })
      await harness.runtime.ingest('reply', { model: 'test', chatProvider: provider })
      expect(harness.sessionMessages['session-1'].filter(message => message.role === 'assistant')).toEqual([])
      expect(harness.assistantAppended).toEqual([])
      expect(literals).toEqual([])
    }
  })

  it('does not retain blank speech when the stream fails', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '        ' })
      throw new Error('stream interrupted')
    })
    await expect(harness.runtime.ingest('reply', { model: 'test', chatProvider: provider })).rejects.toThrow('stream interrupted')
    expect(harness.sessionMessages['session-1'].filter(message => message.role === 'assistant')).toEqual([])
  })

  it.each(['tool', 'sticker', 'generated turn'])('retains %s output without blank speech slices', async (kind) => {
    const harness = createHarness()
    const literals: string[] = []
    const [generatedTurn] = chatMessagesToTurns([{ role: 'assistant', content: ' ' }])
    if (generatedTurn.type !== 'assistant')
      throw new Error('Expected assistant turn')
    harness.runtime.hooks.onTokenLiteral(async (literal) => {
      literals.push(literal)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '        ' })
      if (kind === 'tool') {
        await options?.onStreamEvent?.({ type: 'tool-call', toolCallId: 'call-weather', toolCallType: 'function', toolName: 'weather', args: '{}' })
        await options?.onStreamEvent?.({ type: 'tool-result', toolCallId: 'call-weather', result: 'sunny' })
      }
      else if (kind === 'sticker') {
        await options?.onStreamEvent?.({ type: 'text-delta', text: '<|STICKER heart|>' })
      }
      else {
        await options?.onGeneratedTurn?.(generatedTurn)
      }
      await options?.onStreamEvent?.({ type: 'finish' })
    })
    await harness.runtime.ingest('reply', { model: 'test', chatProvider: provider, stickers: [{ id: 'heart', description: 'A heart' }] })
    const saved = harness.sessionMessages['session-1'].findLast(message => message.role === 'assistant')
    expect(saved?.role).toBe('assistant')
    expect(saved?.content).toBe('')
    expect(saved?.role === 'assistant' && saved.slices.filter(slice => slice.type === 'text')).toEqual([])
    expect(literals).toEqual([])
    if (kind === 'tool') {
      expect(saved?.role === 'assistant' && saved.slices.some(slice => slice.type === 'tool-call')).toBe(true)
      expect(saved?.role === 'assistant' && saved.tool_results).toEqual([{ type: 'tool-call-result', id: 'call-weather', result: 'sunny' }])
    }
    else if (kind === 'sticker') {
      expect(saved?.role === 'assistant' && saved.slices).toEqual([{ type: 'sticker', stickerId: 'heart' }])
    }
    else {
      expect(saved?.role === 'assistant' && saved.generationTranscript).toEqual(generatedTurn)
    }
  })

  it('admits a replacement turn when the cancelled provider ignores abort', async () => {
    const harness = createHarness()
    const held = Promise.withResolvers<void>()
    let late: StreamOptions['onStreamEvent']
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      late = options?.onStreamEvent
      await held.promise
    })
    const first = harness.runtime.submit('first', { model: 'first', chatProvider: provider, messageId: 'first' }, 'session-1')
    await expect.poll(() => harness.stream.mock.calls.length).toBe(1)
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'first' })
    const next = harness.runtime.submit('next', { model: 'next', chatProvider: provider, messageId: 'next' }, 'session-1')
    try {
      await expect.poll(() => harness.stream.mock.calls.length).toBe(2)
      await next.done
      await late?.({ type: 'text-delta', text: 'obsolete provider output' })
      expect(harness.sessionMessages['session-1'].some(message => typeof message.content === 'string' && message.content.includes('obsolete'))).toBe(false)
    }
    finally {
      held.resolve()
      await Promise.all([first.done, next.done])
    }
  })

  it('cancels a named turn without stopping another session', async () => {
    const harness = createHarness()
    const signals = new Map<string, AbortSignal>()
    harness.stream.mockImplementation(async (model, _provider, _context, options) => {
      const signal = options?.abortSignal
      if (!signal)
        throw new Error('Missing request cancellation signal')
      signals.set(model, signal)
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    const first = harness.runtime.submit('one', { model: 'one', chatProvider: provider, messageId: 'turn-1' }, 'session-1')
    const other = harness.runtime.submit('two', { model: 'two', chatProvider: provider, messageId: 'turn-2' }, 'session-2')
    try {
      await expect.poll(() => signals.size).toBe(2)
      harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'turn-1' })
      expect(signals.get('one')?.aborted).toBe(true)
      expect(signals.get('two')?.aborted).toBe(false)
    }
    finally {
      harness.runtime.cancelPendingSends()
      await Promise.all([first.done, other.done])
    }
  })

  it('commits a voice attachment once and preserves audio in the provider input', async () => {
    const harness = createHarness()
    const options = {
      model: 'gpt-test',
      chatProvider: provider,
      messageId: 'voice-message',
      attachments: [{ type: 'audio' as const, data: 'YXVkaW8=', mimeType: 'audio/wav' as const }],
    }
    const first = harness.runtime.submit('', options, 'session-1')
    expect((await first.accepted).messageId).toBe('voice-message')
    await first.done
    const retried = harness.runtime.submit('', options, 'session-1')
    expect((await retried.accepted).messageId).toBe('voice-message')
    await retried.done
    expect(harness.stream).toHaveBeenCalledTimes(1)
    const user = harness.stream.mock.calls[0][2].turns.find(turn => turn.type === 'user')
    expect(user?.content).toContainEqual({ type: 'audio', data: 'YXVkaW8=', format: 'wav' })
  })

  it('stores the transcript of a voice attachment for text-only projection', async () => {
    const harness = createHarness()
    const request = harness.runtime.submit('', {
      model: 'gpt-test',
      chatProvider: provider,
      messageId: 'spoken',
      attachments: [{ type: 'audio' as const, data: 'YXVkaW8=', mimeType: 'audio/wav' as const, transcript: 'hello there' }],
    }, 'session-1')
    await request.done

    const stored = harness.sessionMessages['session-1'].find(message => message.id === 'spoken')
    expect(stored).toMatchObject({ role: 'user', audioTranscripts: ['hello there'] })
  })

  it('acknowledges persistence before generation and reuses a retried message identity', async () => {
    const harness = createHarness()
    const generation = Promise.withResolvers<void>()
    harness.stream.mockImplementationOnce(async () => generation.promise)
    const request = harness.runtime.submit('voice message', { model: 'voice', chatProvider: provider, messageId: 'voice-1' }, 'session-1')
    expect(await request.accepted).toEqual({ sessionId: 'session-1', messageId: 'voice-1' })
    let done = false
    void request.done.then(() => {
      done = true
    })
    expect(done).toBe(false)
    generation.resolve()
    await request.done
    const retry = harness.runtime.submit('voice message', { model: 'voice', chatProvider: provider, messageId: 'voice-1' }, 'session-1')
    expect(await retry.accepted).toEqual({ sessionId: 'session-1', messageId: 'voice-1' })
    await retry.done
    expect(harness.sessionMessages['session-1'].filter(message => message.id === 'voice-1')).toHaveLength(1)
    expect(harness.stream).toHaveBeenCalledOnce()
  })

  // https://github.com/moeru-ai/airi/issues/2738
  it('runs separate sessions concurrently while preserving each session order', async () => {
    const harness = createHarness()
    const held = Promise.withResolvers<void>()
    const started: string[] = []
    harness.stream.mockImplementation(async (model) => {
      started.push(model)
      if (model === 'first')
        await held.promise
    })
    const first = harness.runtime.ingest('first', { model: 'first', chatProvider: provider }, 'session-1')
    const next = harness.runtime.ingest('next', { model: 'next', chatProvider: provider }, 'session-1')
    const other = harness.runtime.ingest('other', { model: 'other', chatProvider: provider }, 'session-2')
    try {
      await expect.poll(() => started).toContain('other')
      await other
      expect(started).toEqual(['first', 'other'])
      expect(harness.runtime.getSending()).toBe(true)
    }
    finally {
      held.resolve()
      await Promise.all([first, next, other])
    }
    expect(started).toEqual(['first', 'other', 'next'])
    expect(harness.runtime.getSending()).toBe(false)
  })

  // ROOT CAUSE:
  //
  // The marker parser buffered 24 literal characters plus its marker-safety tail.
  // Providers that emitted small, slow deltas therefore showed no visible text for several seconds.
  //
  // We fixed this by keeping only the marker-safety tail before the first foreground update.
  it('updates the foreground stream before a slow response reaches 24 characters', async () => {
    const harness = createHarness()
    let patchesBeforeFinish = 0

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      for (const text of '1234567890')
        await options?.onStreamEvent?.({ type: 'text-delta', text })

      patchesBeforeFinish = harness.foregroundPatches.length
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('show a slow response', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(patchesBeforeFinish).toBeGreaterThan(1)
    expect(harness.foregroundPatches.some(message => message.content === '1234')).toBe(true)
  })

  // ROOT CAUSE:
  //
  // A transport failure cleared the foreground stream before the assistant
  // message was stored. Text that was already visible therefore disappeared.
  //
  // We preserve received output as an incomplete local assistant message. The
  // caller still receives the failure and can append its normal error item.
  it('stores visible assistant output when the stream fails', async () => {
    const harness = createHarness()
    const failedAt = new Date(2026, 3, 25, 18, 48).getTime()
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'partial reply' })
      harness.now.set(failedAt)
      throw new Error('stream interrupted')
    })

    await expect(harness.runtime.ingest('show partial output', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('stream interrupted')

    expect(harness.sessionMessages['session-1']?.at(-1)).toMatchObject({
      role: 'assistant',
      interrupted: true,
      content: 'partial ',
      slices: [{ type: 'text', text: 'partial ' }],
      completedAt: failedAt,
    })
    expect(harness.assistantAppended).toHaveLength(0)
    expect(harness.foregroundResets).toHaveLength(1)
  })

  it('does not store a search-only status when the stream fails', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'search', id: 'search-1', status: 'searching' })
      throw new Error('search interrupted')
    })

    await expect(harness.runtime.ingest('search for this', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('search interrupted')

    expect(harness.sessionMessages['session-1']?.filter(message => message.role === 'assistant')).toHaveLength(0)
    expect(harness.foregroundResets).toHaveLength(1)
  })

  // ROOT CAUSE:
  //
  // The rendered-response observer ran after the provider completed but before
  // history storage. If that observer threw, the complete reply was persisted
  // as interrupted and activation was reported as failed.
  it('keeps a completed response successful when its observer throws', async () => {
    const harness = createHarness()
    harness.assistantResponseRenderedError.set(new Error('analytics unavailable'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).resolves.toBeUndefined()

    expect(harness.sessionMessages['session-1']?.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'assistant reply',
    })
    expect(harness.sessionMessages['session-1']?.at(-1)).not.toHaveProperty('interrupted')
    expect(harness.telemetry.chatActivationSucceeded).toHaveLength(1)
    expect(harness.telemetry.chatActivationFailed).toHaveLength(0)
  })

  it('stores tool names with the user message and omits them from provider messages', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('use a widget', {
      model: 'gpt-test',
      chatProvider: provider,
      toolReferences: [{ name: 'stage_widgets' }],
    })

    const storedUserMessage = harness.sessionMessages['session-1']?.find(message => message.role === 'user')
    const providerMessages = conversationToChatMessages(harness.stream.mock.calls[0]![2])
    const providerUserMessage = providerMessages.find(message => message.role === 'user')

    expect(storedUserMessage).toMatchObject({
      role: 'user',
      tools: [{ name: 'stage_widgets' }],
    })
    expect(providerUserMessage).not.toHaveProperty('tools')
  })

  // ROOT CAUSE:
  //
  // The composer encoded a reply as localized Markdown inside the user text.
  // The stored message therefore lost the relation to the replied message.
  //
  // We fixed this by storing the reply message id and projecting its text only
  // for the provider request.
  it('stores a native reply relation without changing the user text', async () => {
    const harness = createHarness()
    harness.sessionMessages['session-1']?.push({
      role: 'assistant',
      content: 'Earlier answer',
      slices: [{ type: 'text', text: 'Earlier answer' }],
      tool_results: [],
      id: 'assistant-earlier',
    })

    await harness.runtime.ingest('My follow-up', {
      model: 'gpt-test',
      chatProvider: provider,
      replyToMessageId: 'assistant-earlier',
    })

    const storedUserMessage = harness.sessionMessages['session-1']?.find(message => message.id === 'user-id')
    const providerMessages = conversationToChatMessages(harness.stream.mock.calls[0]![2])
    const providerUserMessage = providerMessages?.at(-1)

    expect(storedUserMessage).toMatchObject({
      role: 'user',
      content: 'My follow-up',
      replyToMessageId: 'assistant-earlier',
    })
    expect(providerUserMessage).toMatchObject({
      role: 'user',
      content: '[2026-04-25 18:47] [Replying to: Earlier answer]\nMy follow-up',
    })
    expect(providerUserMessage).not.toHaveProperty('replyToMessageId')
  })

  it('limits repeated reply text in the provider prompt', async () => {
    const harness = createHarness()
    harness.sessionMessages['session-1']?.push({
      role: 'assistant',
      content: 'a'.repeat(600),
      slices: [{ type: 'text', text: 'a'.repeat(600) }],
      tool_results: [],
      id: 'assistant-long-reply',
    })

    await harness.runtime.ingest('My follow-up', {
      model: 'gpt-test',
      chatProvider: provider,
      replyToMessageId: 'assistant-long-reply',
    })

    const providerMessages = conversationToChatMessages(harness.stream.mock.calls[0]![2])
    const providerUserMessage = providerMessages?.at(-1)

    expect(providerUserMessage).toMatchObject({
      role: 'user',
      content: `[2026-04-25 18:47] [Replying to: ${'a'.repeat(479)}…]\nMy follow-up`,
    })
  })

  // ROOT CAUSE:
  //
  // xsAI kept the assistant tool call and tool result in its private message copy.
  // AIRI stored only UI slices, then removed those slices from the next provider request.
  //
  // We fixed this by storing the provider generated turn on the finalized UI message.
  // The next request expands that generated turn back into chronological provider messages.
  it('includes completed tool rounds in the next provider request', async () => {
    const harness = createHarness()

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      await options?.onStreamEvent?.({
        type: 'tool-call',
        toolCallId: 'call-weather',
        toolName: 'weather',
        args: '{}',
      } as StreamEvent)
      await options?.onStreamEvent?.({
        type: 'tool-result',
        toolCallId: 'call-weather',
        result: 'sunny',
      } as StreamEvent)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'The weather is sunny.' })

      const [turn] = chatMessagesToTurns([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-weather',
              type: 'function',
              function: {
                name: 'weather',
                arguments: '{}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call-weather',
          content: 'sunny',
        },
        {
          role: 'assistant',
          content: 'The weather is sunny.',
        },
      ])
      if (turn.type !== 'assistant')
        throw new Error('Expected assistant turn')
      await options?.onGeneratedTurn?.(turn)
    })

    await harness.runtime.ingest('What is the weather?', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await harness.runtime.ingest('Can you repeat that?', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const messages = conversationToChatMessages(harness.stream.mock.calls[1][2])

    expect(messages?.map(message => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ])
    expect(messages?.[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-weather',
          type: 'function',
          function: {
            name: 'weather',
            arguments: '{}',
          },
        },
      ],
    })
    expect(messages?.[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call-weather',
      content: 'sunny',
    })
    expect(messages?.[4]).toEqual({
      role: 'assistant',
      content: 'The weather is sunny.',
    })
  })

  it('keeps hook order and appends context prompt to the latest user message', async () => {
    const harness = createHarness()
    harness.contextSnapshot['system:weather'] = [
      {
        id: 'weather',
        contextId: 'system:weather',
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: 'sunny',
        createdAt: 1,
      },
    ]
    const hookOrder: string[] = []
    let composedMessages: Message[] = []

    harness.runtime.hooks.onBeforeMessageComposed(async () => {
      hookOrder.push('before-compose')
    })
    harness.runtime.hooks.onAfterMessageComposed(async () => {
      hookOrder.push('after-compose')
    })
    harness.runtime.hooks.onBeforeSend(async () => {
      hookOrder.push('before-send')
    })
    harness.runtime.hooks.onTokenLiteral(async () => {
      hookOrder.push('token-literal')
    })
    harness.runtime.hooks.onStreamEnd(async () => {
      hookOrder.push('stream-end')
    })
    harness.runtime.hooks.onAssistantResponseEnd(async () => {
      hookOrder.push('assistant-end')
    })
    harness.runtime.hooks.onAfterSend(async () => {
      hookOrder.push('after-send')
    })
    harness.runtime.hooks.onAssistantMessage(async () => {
      hookOrder.push('assistant-message')
    })
    harness.runtime.hooks.onChatTurnComplete(async () => {
      hookOrder.push('turn-complete')
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = conversationToChatMessages(messages)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

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
    expect(composedMessages[0]).toMatchObject({ role: 'system', content: 'system prompt' })
    expect(composedMessages[1]).toMatchObject({ role: 'user' })
    expect(composedMessages[1]?.content).toBe('[2026-04-25 18:47] hello from user\n\nsunny')
    expect(harness.lifecycleRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'before-compose' }),
      expect.objectContaining({ phase: 'prompt-context-built' }),
      expect.objectContaining({ phase: 'after-compose' }),
    ]))
    expect(harness.promptProjections).toHaveLength(1)
  })

  // ROOT CAUSE:
  //
  // Speech-muted consumers dispatch plugin CALL markers without a TTS
  // session. If the hook context has no turn id, a locally unhandled call
  // cannot be correlated and relayed to another Electron renderer.
  it('preserves the round turn id on special-token hooks', async () => {
    const harness = createHarness()
    let specialTurnId = ''

    harness.runtime.hooks.onTokenSpecial(async (_special, context) => {
      specialTurnId = context.turnId
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|CALL ["plugin.action"]|>' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('trigger special', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(specialTurnId).toBe('user-id')
    expect(harness.telemetry.messageSendStarted).toEqual([
      expect.objectContaining({ roundId: specialTurnId }),
    ])
  })

  it('names the stored reply on the hook context, so another window can key its stream with it', async () => {
    const harness = createHarness()
    let beforeSendAssistantMessageId: string | undefined

    harness.runtime.hooks.onBeforeSend(async (_message, context) => {
      beforeSendAssistantMessageId = context.assistantMessageId
    })

    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(beforeSendAssistantMessageId).toBe('assistant-id')
    expect(harness.sessionMessages['session-1'].findLast(message => message.role === 'assistant')?.id).toBe('assistant-id')
  })

  it('keeps timestamp prefixes stable for legacy user messages without createdAt', async () => {
    const harness = createHarness()
    const legacyUserMessage: ChatHistoryItem = {
      role: 'user' as const,
      content: 'legacy prompt',
      id: 'legacy-user',
    }
    harness.sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      legacyUserMessage,
    ]
    const firstMessages: Message[][] = []
    const secondMessages: Message[][] = []

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      firstMessages.push(conversationToChatMessages(messages))
      await options?.onStreamEvent?.({ type: 'finish' })
    })
    harness.now.set(new Date(2026, 3, 25, 18, 47).getTime())

    await harness.runtime.ingest('first send', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      secondMessages.push(conversationToChatMessages(messages))
      await options?.onStreamEvent?.({ type: 'finish' })
    })
    harness.now.set(new Date(2026, 3, 25, 19, 12).getTime())

    await harness.runtime.ingest('second send', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(firstMessages[0]?.[1]?.content).toBe('[2026-04-25 18:47] legacy prompt')
    expect(secondMessages[0]?.[1]?.content).toBe('[2026-04-25 18:47] legacy prompt')
    expect(legacyUserMessage.createdAt).toBe(new Date(2026, 3, 25, 18, 47).getTime())
  })

  it('sends the stored system message unchanged without resolveStep', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = conversationToChatMessages(messages)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
      stickers: [{ id: 'heart', description: 'A heart' }],
    })

    // The host composes every prompt part, stickers included. The runtime adds no prompt text.
    expect(composedMessages[0]).toEqual({ role: 'system', content: 'system prompt' })
  })

  it('resolves the first step once and shows its system prompt in the projection and the request', async () => {
    const harness = createHarness()
    const promptReport = [{ id: 'card', chars: 13, estimatedTokens: 4, dropped: 0, truncated: false, overBudget: false }]
    const resolveStep = vi.fn(async () => ({ model: 'edited-model', chatProvider: provider, providerId: 'mock-provider', systemPrompt: 'edited prompt', promptReport }))
    let requestMessages: Message[] = []
    let resolvedPrompt: string | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      requestMessages = conversationToChatMessages(messages)
      // The protocol adapter resolves the step of its first request.
      resolvedPrompt = (await options?.resolveStep?.())?.systemPrompt
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello from user', { model: 'gpt-test', chatProvider: provider, resolveStep })

    expect(resolveStep).toHaveBeenCalledOnce()
    expect(resolvedPrompt).toBe('edited prompt')
    expect(requestMessages[0]).toEqual({ role: 'system', content: 'edited prompt' })
    const projection = harness.promptProjections[0] as ChatOrchestratorPromptProjection
    expect(projection.composedMessage?.[0]).toEqual({ role: 'system', content: 'edited prompt' })
    expect(projection.promptReport).toEqual(promptReport)
  })

  it('reads the owner settings again for each request after the first', async () => {
    const harness = createHarness()
    let version = 0
    const resolveStep = vi.fn(async () => ({ model: 'edited-model', chatProvider: provider, providerId: 'mock-provider', systemPrompt: `prompt ${++version}` }))
    const prompts: string[] = []
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      // A tool round makes a second request.
      prompts.push((await options!.resolveStep!()).systemPrompt, (await options!.resolveStep!()).systemPrompt)
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello from user', { model: 'gpt-test', chatProvider: provider, resolveStep })

    expect(resolveStep).toHaveBeenCalledTimes(2)
    expect(prompts).toEqual(['prompt 1', 'prompt 2'])
  })

  it('creates a system message from the resolved prompt when the history has none', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.sessionMessages['session-1'] = []
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = conversationToChatMessages(messages)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
      resolveStep: async () => ({ model: 'gpt-test', chatProvider: provider, providerId: 'mock-provider', systemPrompt: 'resolved prompt' }),
    })

    expect(composedMessages[0]).toEqual({ role: 'system', content: 'resolved prompt' })
    expect(composedMessages[1]).toMatchObject({ role: 'user' })
  })

  it('emits telemetry milestones for a successful voice-backed message round', async () => {
    const harness = createHarness()
    harness.monotonicNow.set([100, 150, 250, 400, 460])
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
      await options?.onStreamEvent?.({ type: 'finish' })
      await options?.onUsage?.({
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        source: 'reported',
      })
    })

    await harness.runtime.ingest('hello from voice', {
      model: 'gpt-test',
      chatProvider: provider,
      input: {
        type: 'input:text:voice',
        data: {
          transcription: 'hello from voice',
        },
      },
    })

    expect(harness.telemetry.messageSendStarted).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      source: 'voice',
      model: 'gpt-test',
      turnIndex: 1,
    }])
    expect(harness.telemetry.llmRequestStarted).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      provider: 'mock-provider',
      hasVoice: true,
      turnIndex: 1,
    }])
    expect(harness.telemetry.llmFirstToken).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      ttfbMs: 100,
      turnIndex: 1,
    }])
    expect(harness.telemetry.assistantResponseRendered).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      latencyMs: 250,
      turnIndex: 1,
    }])
    expect(harness.telemetry.llmGeneration).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      provider: 'mock-provider',
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      usageSource: 'reported',
      turnIndex: 1,
    }])
    expect(harness.telemetry.messageRound).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      durationMs: 360,
      hasVoice: true,
      inputTokens: 12,
      model: 'gpt-test',
      outputTokens: 8,
      totalTokens: 20,
      turnIndex: 1,
      usageSource: 'reported',
    }])
    expect(harness.telemetry.chatActivationStarted).toEqual([{
      conversationId: 'session-1',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'voice',
      turnIndex: 1,
    }])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([{
      conversationId: 'session-1',
      durationMs: 360,
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'voice',
      turnIndex: 1,
    }])
    expect(harness.telemetry.chatActivationFailed).toEqual([])
  })

  // Review: https://github.com/moeru-ai/airi/pull/2325
  it('pr #2325 treats input:text metadata as text telemetry', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('hello from text input', {
      model: 'gpt-test',
      chatProvider: provider,
      input: {
        type: 'input:text',
        data: {
          text: 'hello from text input',
        },
      },
    })

    expect(harness.telemetry.messageSendStarted).toEqual([
      expect.objectContaining({ source: 'text' }),
    ])
    expect(harness.telemetry.llmRequestStarted).toEqual([
      expect.objectContaining({ hasVoice: false }),
    ])
    expect(harness.telemetry.messageRound).toEqual([
      expect.objectContaining({ hasVoice: false }),
    ])
    expect(harness.userAppended).toEqual([
      expect.objectContaining({ source: 'text' }),
    ])
  })

  // ROOT CAUSE:
  //
  // Activation callbacks were emitted for every chat round, so production
  // `chat_activation_*` volume tracked message traffic instead of the first
  // successful assistant response in a conversation.
  it('emits activation milestones only until the conversation gets its first assistant response', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('first turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await harness.runtime.ingest('second turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(harness.telemetry.chatActivationStarted).toHaveLength(1)
    expect(harness.telemetry.chatActivationSucceeded).toHaveLength(1)
    expect(harness.telemetry.chatActivationFailed).toHaveLength(0)
    expect(harness.telemetry.messageSendStarted).toHaveLength(2)
    expect(harness.telemetry.messageRound).toHaveLength(2)
  })

  // ROOT CAUSE:
  //
  // Preserving partial output created an assistant history item, so the next
  // send looked like a later turn even though activation had never succeeded.
  // Interrupted output is now marked separately from a completed assistant.
  it('keeps activation eligible after the first response is interrupted', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'partial reply' })
      throw new Error('stream interrupted')
    })

    await expect(harness.runtime.ingest('first turn fails', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('stream interrupted')
    await harness.runtime.ingest('second turn succeeds', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(harness.telemetry.chatActivationStarted).toHaveLength(2)
    expect(harness.telemetry.chatActivationFailed).toHaveLength(1)
    expect(harness.telemetry.chatActivationSucceeded).toHaveLength(1)
  })

  it('emits chat activation failure telemetry without raw provider messages', async () => {
    const harness = createHarness()
    harness.stream.mockRejectedValueOnce(new Error('provider rejected with sensitive details'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('provider rejected')
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'user-id', status: 'failed' }])

    expect(harness.telemetry.chatActivationStarted).toEqual([{
      conversationId: 'session-1',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'text',
      turnIndex: 1,
    }])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([])
    expect(harness.telemetry.chatActivationFailed).toEqual([{
      conversationId: 'session-1',
      errorCode: 'llm_response_failed',
      failureStage: 'llm_response',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'text',
      turnIndex: 1,
    }])
    expect(harness.telemetry.messageRoundFailed).toEqual([{
      conversationId: 'session-1',
      errorCode: 'llm_response_failed',
      failureStage: 'llm_response',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'text',
      turnIndex: 1,
    }])
  })

  it('emits a round failure for later turns without repeating activation failure', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('first turn succeeds', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    harness.stream.mockRejectedValueOnce(new Error('later turn rejected'))

    await expect(harness.runtime.ingest('second turn fails', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('later turn rejected')

    expect(harness.telemetry.chatActivationFailed).toEqual([])
    expect(harness.telemetry.messageRoundFailed).toEqual([
      expect.objectContaining({
        conversationId: 'session-1',
        errorCode: 'llm_response_failed',
        failureStage: 'llm_response',
        roundId: expect.any(String),
        turnIndex: 2,
      }),
    ])
  })

  // https://github.com/moeru-ai/airi/pull/2477#discussion_r4000149090
  // ROOT CAUSE:
  //
  // The queue retained the provider client but read the active provider ID at execution time.
  // A settings change could pair that client with another provider scope. Capture both at enqueue.
  it('keeps the provider identity captured before a queued send starts (PR #2477)', async () => {
    let providerId = 'original'
    const harness = createHarness(() => providerId)
    let release: (() => void) | undefined
    harness.stream.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const first = harness.runtime.ingest('first', { model: 'same', chatProvider: provider })
    await vi.waitFor(() => expect(harness.stream).toHaveBeenCalledTimes(1))
    const second = harness.runtime.ingest('second', { model: 'same', chatProvider: provider })
    providerId = 'changed'
    release?.()
    await Promise.all([first, second])
    expect(harness.stream.mock.calls[1][3]?.providerId).toBe('original')
  })

  it('rejects cancelled queued sends before they start', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest('cancel me', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  // https://github.com/moeru-ai/airi/pull/2489#discussion_r3967818108
  // ROOT CAUSE:
  //
  // A queued send kept the reply target captured by the composer. Deleting that
  // target did not change the session generation, so the queued message stored a
  // dangling relation and projected the missing id into the provider prompt.
  //
  // The send must revalidate the relation against current session history after
  // asynchronous composition and immediately before append.
  it('drops a queued reply relation when its target is deleted before append', async () => {
    const harness = createHarness()
    let queuedSendContext: ChatHistoryItem | undefined
    let releaseQueuedComposition: (() => void) | undefined
    harness.runtime.hooks.onBeforeMessageComposed(async (message, context) => {
      if (message !== 'send without stale reply')
        return

      queuedSendContext = context.message
      await new Promise<void>((resolve) => {
        releaseQueuedComposition = resolve
      })
    })
    harness.sessionMessages['session-1']?.push({
      role: 'assistant',
      content: 'Reply target',
      slices: [{ type: 'text', text: 'Reply target' }],
      tool_results: [],
      id: 'deleted-reply-target',
    })
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const queuedReply = harness.runtime.ingest('send without stale reply', {
      model: 'gpt-test',
      chatProvider: provider,
      replyToMessageId: 'deleted-reply-target',
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    releaseFirstSend?.()
    await vi.waitFor(() => {
      expect(releaseQueuedComposition).toBeTypeOf('function')
    })

    const sessionMessages = harness.sessionMessages['session-1']
    if (!sessionMessages)
      throw new Error('Expected the active test session to exist')

    harness.sessionMessages['session-1'] = sessionMessages
      .filter(message => message.id !== 'deleted-reply-target')
    releaseQueuedComposition?.()

    await firstSend
    await queuedReply

    const storedReply = harness.sessionMessages['session-1']
      ?.find(message => message.role === 'user' && message.content === 'send without stale reply')
    const providerUserMessage = conversationToChatMessages(harness.stream.mock.calls[1]![2]).at(-1)
    const syncedUserMessage = (harness.userAppended.at(-1) as { message?: ChatHistoryItem } | undefined)?.message

    expect(storedReply).toBeDefined()
    expect(storedReply).not.toHaveProperty('replyToMessageId')
    expect(providerUserMessage).toMatchObject({
      role: 'user',
      content: '[2026-04-25 18:47] send without stale reply',
    })
    expect(syncedUserMessage).toBeDefined()
    expect(syncedUserMessage).not.toHaveProperty('replyToMessageId')
    expect(queuedSendContext).toBeDefined()
    expect(queuedSendContext).not.toHaveProperty('replyToMessageId')
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3714754876
  it('suppresses completion hooks when an active send session is deleted for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Generation checks protected message mutation during a stream, but the
    // runtime still emitted completion hooks and success analytics after the
    // provider returned for a deleted session.
    const harness = createHarness()
    const completionHook = vi.fn()
    harness.runtime.hooks.onStreamEnd(completionHook)
    harness.runtime.hooks.onAssistantResponseEnd(completionHook)
    harness.runtime.hooks.onAfterSend(completionHook)
    harness.runtime.hooks.onAssistantMessage(completionHook)
    harness.runtime.hooks.onChatTurnComplete(completionHook)

    let finishStream: (() => void) | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await new Promise<void>((resolve) => {
        finishStream = resolve
      })
      options?.onUsage?.({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        source: 'reported',
      })
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'deleted reply' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    const pendingSend = harness.runtime.ingest('delete this chat', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    harness.generation.set(2)
    finishStream?.()
    await pendingSend

    expect(completionHook).not.toHaveBeenCalled()
    expect(harness.assistantAppended).toEqual([])
    expect(harness.assistantTurns).toEqual([])
    expect(harness.telemetry.assistantResponseRendered).toEqual([])
    expect(harness.telemetry.llmGeneration).toEqual([])
    expect(harness.telemetry.messageRound).toEqual([])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([])
  })

  it('rejects stale generation sends before they start', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest('stale request', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.generation.set(2)
    releaseFirstSend?.()

    await firstSend
    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    expect(harness.stream).toHaveBeenCalledTimes(1)
  })

  it('keeps sending externally writable for UI facades', () => {
    const harness = createHarness()

    harness.runtime.setSending(true)
    expect(harness.runtime.getSending()).toBe(true)
    expect(harness.stateChanges.at(-1)).toEqual({
      activeTurns: [],
      activeSendSessionId: 'session-1',
      activeStreamingMessage: undefined,
      sending: true,
      pendingQueuedSendCount: 0,
    })

    harness.runtime.setSending(false)
    expect(harness.runtime.getSending()).toBe(false)
    expect(harness.stateChanges.at(-1)).toEqual({
      activeTurns: [],
      activeSendSessionId: undefined,
      activeStreamingMessage: undefined,
      sending: false,
      pendingQueuedSendCount: 0,
    })
  })

  // https://github.com/moeru-ai/airi/issues/2085
  it('reports the queued send target while a background session is sending for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Runtime state exposed only a global sending boolean. A window-level sync
    // layer therefore had to infer the owner from the authority's visible
    // session, which is wrong when a follower targets a background session.
    const harness = createHarness()
    let finishSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'background reply' })
      await new Promise<void>((resolve) => {
        finishSend = resolve
      })
    })

    const pendingSend = harness.runtime.ingest('background request', {
      model: 'gpt-test',
      chatProvider: provider,
    }, 'session-2')

    await vi.waitFor(() => {
      expect(harness.stateChanges).toContainEqual(expect.objectContaining({
        activeSendSessionId: 'session-2',
        activeStreamingMessage: expect.objectContaining({
          role: 'assistant',
          createdAt: expect.any(Number),
        }),
        sending: true,
        pendingQueuedSendCount: 0,
      }))
    })
    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.stateChanges).toContainEqual(expect.objectContaining({
        activeSendSessionId: 'session-2',
        activeStreamingMessage: expect.objectContaining({ content: expect.stringContaining('background') }),
      }))
    })

    finishSend?.()
    await pendingSend

    expect(harness.stateChanges.at(-1)).toEqual({
      activeTurns: [],
      activeSendSessionId: undefined,
      activeStreamingMessage: undefined,
      sending: false,
      pendingQueuedSendCount: 0,
    })
  })

  it('returns pending queued send snapshots with public fields', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const queuedMessage = 'queued-message-'.repeat(12)
    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest(queuedMessage, {
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
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })

    expect(harness.runtime.getPendingQueuedSendSnapshot()).toEqual([
      {
        sessionId: 'session-1',
        generation: 1,
        cancelled: false,
        messagePreview: queuedMessage.slice(0, 120),
        hasAttachments: true,
        inputType: 'input:text',
      },
    ])

    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  it('handles attachments, reasoning deltas, tool events, and assistant finalization', async () => {
    const harness = createHarness()
    const finishedAt = new Date(2026, 3, 25, 18, 48).getTime()
    let composedMessages: Message[] = []
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = conversationToChatMessages(messages)
      await options?.onStreamEvent?.({ type: 'reasoning-delta', text: 'thinking' })
      await options?.onStreamEvent?.({
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'weather',
        args: {},
      } as StreamEvent)
      await options?.onStreamEvent?.({
        type: 'tool-result',
        toolCallId: 'tool-1',
        result: 'sunny',
      } as StreamEvent)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'visible reply' })
      harness.now.set(finishedAt)
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('see image', {
      model: 'gpt-test',
      chatProvider: provider,
      attachments: [
        {
          type: 'image',
          data: 'aW1hZ2U=',
          mimeType: 'image/png',
        },
      ],
    })

    expect(composedMessages[1]?.content).toEqual([
      {
        type: 'text',
        text: '[2026-04-25 18:47] see image',
      },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,aW1hZ2U=',
        },
      },
    ])
    const assistant = harness.sessionMessages['session-1']?.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'visible reply',
      categorization: {
        reasoning: 'thinking',
      },
      completedAt: finishedAt,
    })
    expect(assistant?.createdAt).toBeLessThan(finishedAt)
    expect((assistant as StreamingAssistantMessage).slices).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCall: expect.objectContaining({
          toolCallId: 'tool-1',
        }),
      }),
      {
        type: 'text',
        text: 'visible reply',
      },
    ])
    expect((assistant as StreamingAssistantMessage).tool_results).toEqual([
      {
        type: 'tool-call-result',
        id: 'tool-1',
        result: 'sunny',
      },
    ])
    expect(harness.assistantAppended).toHaveLength(1)
    expect(harness.foregroundResets).toHaveLength(1)
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'user-id', status: 'finished' }])
  })
})

describe('responses generated turn ownership', () => {
  it('keeps portable history and opaque continuation together for the selected adapter', async () => {
    const harness = createHarness()
    const responsesProvider: GenerationProvider = {
      generation: model => ({ protocol: 'responses', webSearch: false, config: { model, baseURL: 'https://example.com/' } }),
    }
    const [generatedTurn] = chatMessagesToTurns([{ role: 'assistant', content: 'answer' }])
    if (generatedTurn.type !== 'assistant')
      throw new Error('Expected assistant turn')
    generatedTurn.rounds[0].continuation = { protocol: 'responses', scope: 'adapter-scope', data: [{ type: 'reasoning', summary: [], encrypted_content: 'opaque' }] }
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onGeneratedTurn?.(generatedTurn)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'answer' })
    })
    await harness.runtime.ingest('first', { model: 'test', chatProvider: responsesProvider })
    await harness.runtime.ingest('second', { model: 'test', chatProvider: responsesProvider })
    expect(harness.stream.mock.calls[1][2].turns).toContainEqual(generatedTurn)
    await harness.runtime.ingest('third', { model: 'test', chatProvider: provider })
    expect(harness.stream.mock.calls[2][2].turns).toContainEqual(generatedTurn)
    expect(conversationToChatMessages(harness.stream.mock.calls[2][2])).toContainEqual({ role: 'assistant', content: 'answer' })
  })

  it('aborts the active provider request when its session is cancelled', async () => {
    const harness = createHarness()
    let signal: AbortSignal | undefined
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _messages, options) => {
      signal = options?.abortSignal
      started()
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }))
    })
    const send = harness.runtime.ingest('hello', { model: 'test', chatProvider: provider })
    await ready
    harness.runtime.cancelPendingSends('session-1')
    await send
    expect(signal?.aborted).toBe(true)
    expect(harness.assistantAppended).toHaveLength(0)
  })

  it('stores visible partial output when its session is cancelled', async () => {
    const harness = createHarness()
    const partialOutput = 'partial answer already visible in chat'
    let signal: AbortSignal | undefined
    let streamed!: () => void
    const visibleOutput = new Promise<void>((resolve) => {
      streamed = resolve
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _messages, options) => {
      signal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: partialOutput })
      streamed()
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }))
    })
    const send = harness.runtime.ingest('hello', { model: 'test', chatProvider: provider })
    await visibleOutput

    const cancelledAt = new Date(2026, 3, 25, 18, 48).getTime()
    harness.now.set(cancelledAt)
    harness.runtime.cancelPendingSends('session-1')
    await send

    expect(harness.sessionMessages['session-1']?.at(-1)).toEqual(expect.objectContaining({
      content: expect.stringContaining('partial answer'),
      interrupted: true,
      completedAt: cancelledAt,
    }))
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'user-id', status: 'cancelled' }])
    expect(harness.foregroundResets).toHaveLength(1)
  })
})

it('runs consecutive orchestrator turns through the real Responses adapter', async () => {
  const harness = createHarness()
  const requests: { input: unknown[] }[] = []
  const native = [
    { type: 'reasoning', id: 'rs-1', summary: [], encrypted_content: 'opaque' },
    { type: 'message', id: 'msg-1', role: 'assistant', content: [{ type: 'output_text', text: 'answer', annotations: [] }], phase: 'final_answer' },
  ]
  const provider: GenerationProvider = {
    generation: model => ({ protocol: 'responses', webSearch: false, config: {
      model,
      baseURL: 'https://example.test/v1/',
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        const events = [
          { type: 'response.output_text.delta', delta: 'answer' },
          ...native.map(item => ({ type: 'response.output_item.done', item })),
          { type: 'response.completed', response: { output: native, usage: null } },
        ]
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
      },
    } }),
  }
  harness.stream.mockImplementation((model, chatProvider, context, options) => streamFrom({ model, chatProvider, conversation: context, options }))
  await harness.runtime.ingest('first', { model: 'test', chatProvider: provider })
  await harness.runtime.ingest('second', { model: 'test', chatProvider: provider })
  expect(requests).toHaveLength(2)
  expect(requests[1].input.slice(2, 4)).toEqual(native)
  expect(harness.assistantAppended).toHaveLength(2)
  expect(JSON.stringify(harness.promptProjections)).not.toContain('encrypted_content')
  // ROOT CAUSE:
  // Lifecycle snapshots retained native history after each composition.
  // Keep opaque state on the provider boundary, outside diagnostic copies.
  // https://github.com/moeru-ai/airi/pull/2477#discussion_r4015043327
  expect(JSON.stringify(harness.lifecycleRecords)).not.toContain('encrypted_content')
  expect(JSON.stringify(harness.lifecycleRecords)).toContain('answer')
})

describe('chat stickers', () => {
  it('renders a split marker once without sending it to speech or special hooks', async () => {
    const harness = createHarness()
    const stickers = [{ id: 'heart', description: 'A red heart' }]
    const literals: string[] = []
    const specials: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      for (const text of ['Hello! ', '<', '|STI', 'CKER heart|', '>', '<|STICKER heart|>', '<|ACT|>'])
        await options?.onStreamEvent?.({ type: 'text-delta', text })
    })
    await harness.runtime.ingest('Send a heart', { model: 'test', chatProvider: provider, stickers })
    const saved = harness.sessionMessages['session-1'].at(-1)
    expect(saved).toMatchObject({
      role: 'assistant',
      content: 'Hello! ',
      slices: [{ type: 'text', text: 'Hello! ' }, { type: 'sticker', stickerId: 'heart' }],
    })
    expect(literals.join('')).toBe('Hello! ')
    expect(specials).toEqual(['<|ACT|>'])
    expect(saved?.role === 'assistant' && saved.categorization?.speech).toBe('Hello! <|ACT|>')
  })

  it('ignores unknown IDs, model URLs, and an unfinished marker', async () => {
    const harness = createHarness()
    const stickers = [{ id: 'heart', description: 'A red heart' }]
    const specials: string[] = []
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hello<|STICKER missing|><|STICKER https://example.com/image.png|><|STICKER heart' })
    })
    await harness.runtime.ingest('Hello', { model: 'test', chatProvider: provider, stickers })
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ slices: [{ type: 'text', text: 'Hello' }] })
    expect(specials).toEqual([])
  })

  it('does not advertise or render stickers when the catalog is disabled', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _provider, context, options) => {
      expect(JSON.stringify(context)).not.toContain('STICKER')
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hello<|STICKER heart|>' })
    })
    await harness.runtime.ingest('Hello', { model: 'test', chatProvider: provider })
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ slices: [{ type: 'text', text: 'Hello' }] })
  })

  it('stores a sticker-only reply and resets the limit for the next turn', async () => {
    const harness = createHarness()
    const stickers = [{ id: 'heart', description: 'A red heart' }]
    harness.stream.mockImplementation(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|STICKER heart|>' })
    })
    for (const text of ['Send a heart', 'Send another'])
      await harness.runtime.ingest(text, { model: 'test', chatProvider: provider, stickers })
    const replies = harness.sessionMessages['session-1'].filter(message => message.role === 'assistant')
    expect(replies).toHaveLength(2)
    for (const reply of replies)
      expect(reply).toMatchObject({ content: '', slices: [{ type: 'sticker', stickerId: 'heart' }] })
  })
})

it('ignores stickers inside reasoning without consuming the visible reply allowance', async () => {
  const harness = createHarness()
  const stickers = [{ id: 'heart', description: 'A heart' }, { id: 'dog', description: 'A dog' }]
  harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
    for (const text of ['<think>Consider ', '<|STICKER heart|>', ' but decline.</think>Hello!', '<|STICKER dog|>'])
      await options?.onStreamEvent?.({ type: 'text-delta', text })
  })
  await harness.runtime.ingest('Hello', { model: 'test', chatProvider: provider, stickers })
  const reply = harness.sessionMessages['session-1'].at(-1)
  expect(reply?.role === 'assistant' && reply.slices.filter(slice => slice.type === 'sticker')).toEqual([{ type: 'sticker', stickerId: 'dog' }])
})

it('keeps escaped sticker markers out of the saved speech categorization', async () => {
  const harness = createHarness()
  const stickers = [{ id: 'heart', description: 'A heart' }]
  harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hello!<{\'|\'}STICKER heart{\'|\'}>' })
  })
  await harness.runtime.ingest('Hello', { model: 'test', chatProvider: provider, stickers })
  expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({
    categorization: { speech: 'Hello!' },
    slices: [{ type: 'text', text: 'Hello!' }, { type: 'sticker', stickerId: 'heart' }],
  })
})

// The unprompted-turn contract must not change user-origin turns. These snapshots were recorded on the
// runtime before unprompted turns existed and pin every callback, hook payload, and stored message.
describe('user-origin hook sequence', () => {
  it('keeps the spoken user turn sequence unchanged', async () => {
    const harness = createHarness()
    harness.recordHooks()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'reasoning-delta', text: 'thinking' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT {"emotion":"happy"}|>' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: ' Hello' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: ' there' })
      await options?.onUsage?.({ inputTokens: 3, outputTokens: 2, totalTokens: 5, source: 'reported' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello', { model: 'gpt-test', chatProvider: provider })

    expect({
      order: harness.order,
      messages: harness.sessionMessages['session-1'],
      stateChangeCount: harness.stateChanges.length,
    }).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "system prompt",
            "createdAt": 1777154400000,
            "id": "system",
            "role": "system",
          },
          {
            "content": "hello",
            "createdAt": 1777157220000,
            "id": "user-id",
            "role": "user",
          },
          {
            "categorization": {
              "reasoning": "thinking",
              "speech": "<|ACT {"emotion":"happy"}|> Hello there",
            },
            "completedAt": 1777157220000,
            "content": " Hello there",
            "createdAt": 1777157220000,
            "generationTranscript": undefined,
            "id": "assistant-id",
            "role": "assistant",
            "slices": [
              {
                "text": " Hello there",
                "type": "text",
              },
            ],
            "tool_results": [],
          },
        ],
        "order": [
          "lifecycle:before-compose",
          "foreground:patch",
          "trackFirstMessage",
          "chatActivationStarted",
          "messageSendStarted",
          "hook:before-compose",
          "commitUserMessage",
          "userMessageAppended",
          "userTurnReady",
          "promptProjection",
          "lifecycle:after-compose",
          "hook:after-compose",
          "hook:before-send",
          "llmRequestStarted",
          "foreground:patch",
          "llmFirstToken",
          "hook:token-special:<|ACT {"emotion":"happy"}|>",
          "llmGeneration",
          "hook:token-literal: Hello ",
          "foreground:patch",
          "hook:token-literal:there",
          "foreground:patch",
          "foreground:patch",
          "assistantResponseRendered",
          "commitAssistantMessage:assistant",
          "assistantMessageAppended",
          "hook:stream-end",
          "hook:assistant-end:<|ACT {"emotion":"happy"}|> Hello there",
          "hook:after-send",
          "hook:assistant-message:<|ACT {"emotion":"happy"}|> Hello there",
          "hook:turn-complete",
          "assistantTurnReady",
          "foreground:reset",
          "messageRound",
          "chatActivationSucceeded",
          "settled:finished",
        ],
        "stateChangeCount": 8,
      }
    `)
  })

  it('answers a user turn with only the decline marker as a silent reply', async () => {
    const harness = createHarness()
    harness.recordHooks()
    const streamEnds: Array<ChatTurnCueStats | undefined> = []
    harness.runtime.hooks.onStreamEnd(async (context) => {
      streamEnds.push(context.cueStats && { ...context.cueStats })
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|SILENT|>' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello', { model: 'gpt-test', chatProvider: provider })

    // The marker is consumed: no hook receives it and nothing stores it. One empty assistant message is committed.
    expect(streamEnds).toEqual([{ act: 0, recovered: 0, rejected: 0, origin: 'user', declined: false, silent: true, wordless: false, breaks: 0, breaksIgnored: 0 }])
    expect(JSON.stringify(harness.sessionMessages['session-1'])).not.toContain('SILENT')
    expect({
      order: harness.order,
      messages: harness.sessionMessages['session-1'],
      stateChangeCount: harness.stateChanges.length,
    }).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "system prompt",
            "createdAt": 1777154400000,
            "id": "system",
            "role": "system",
          },
          {
            "content": "hello",
            "createdAt": 1777157220000,
            "id": "user-id",
            "role": "user",
          },
          {
            "categorization": {
              "reasoning": "",
              "speech": "",
            },
            "completedAt": 1777157220000,
            "content": "",
            "createdAt": 1777157220000,
            "id": "assistant-id",
            "role": "assistant",
            "slices": [],
            "tool_results": [],
            "wordless": {
              "cues": [],
            },
          },
        ],
        "order": [
          "lifecycle:before-compose",
          "foreground:patch",
          "trackFirstMessage",
          "chatActivationStarted",
          "messageSendStarted",
          "hook:before-compose",
          "commitUserMessage",
          "userMessageAppended",
          "userTurnReady",
          "promptProjection",
          "lifecycle:after-compose",
          "hook:after-compose",
          "hook:before-send",
          "llmRequestStarted",
          "llmFirstToken",
          "foreground:patch",
          "assistantResponseRendered",
          "commitAssistantMessage:assistant",
          "assistantMessageAppended",
          "hook:stream-end",
          "hook:assistant-end:",
          "hook:after-send",
          "hook:assistant-message:",
          "hook:turn-complete",
          "assistantTurnReady",
          "foreground:reset",
          "messageRound",
          "chatActivationSucceeded",
          "settled:finished",
        ],
        "stateChangeCount": 5,
      }
    `)
  })

  it('keeps the cancelled user turn sequence unchanged', async () => {
    const harness = createHarness()
    harness.recordHooks()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      const signal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'partial reply' })
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })

    const literalShown = harness.untilOrder(entries => entries.at(-2) === 'hook:token-literal:partial ' && entries.at(-1) === 'foreground:patch')
    const send = harness.runtime.submit('hello', { model: 'gpt-test', chatProvider: provider, messageId: 'user-turn' }, 'session-1')
    await literalShown
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'user-turn' })
    await send.done

    expect({
      order: harness.order,
      messages: harness.sessionMessages['session-1'],
      stateChangeCount: harness.stateChanges.length,
    }).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "system prompt",
            "createdAt": 1777154400000,
            "id": "system",
            "role": "system",
          },
          {
            "content": "hello",
            "createdAt": 1777157220000,
            "id": "user-turn",
            "role": "user",
          },
          {
            "completedAt": 1777157220000,
            "content": "partial ",
            "createdAt": 1777157220000,
            "id": "assistant-id",
            "interrupted": true,
            "role": "assistant",
            "slices": [
              {
                "text": "partial ",
                "type": "text",
              },
            ],
            "tool_results": [],
          },
        ],
        "order": [
          "lifecycle:before-compose",
          "foreground:patch",
          "trackFirstMessage",
          "chatActivationStarted",
          "messageSendStarted",
          "hook:before-compose",
          "commitUserMessage",
          "userMessageAppended",
          "userTurnReady",
          "promptProjection",
          "lifecycle:after-compose",
          "hook:after-compose",
          "hook:before-send",
          "llmRequestStarted",
          "llmFirstToken",
          "hook:token-literal:partial ",
          "foreground:patch",
          "commitAssistantMessage:assistant:interrupted",
          "foreground:reset",
          "settled:cancelled",
        ],
        "stateChangeCount": 6,
      }
    `)
  })
})

describe('unprompted turns', () => {
  const trigger = { topicKey: 'qa', text: 'QA topic', kind: 'continuation' }
  const triggerText = '(A quiet moment. Nobody said anything. What is on your mind right now: QA topic)'
  const unpromptedOptions = {
    model: 'gpt-test',
    chatProvider: provider,
    origin: 'unprompted' as const,
    trigger,
    messageId: 'trigger-1',
  }

  function replyWith(harness: ReturnType<typeof createHarness>, chunks: string[]) {
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      for (const text of chunks)
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })
  }

  function speechHookCalls(harness: ReturnType<typeof createHarness>) {
    return harness.order.filter(entry => entry.startsWith('hook:token-'))
  }

  /** Asserts the decline contract: nothing committed, no reply hooks, one stream end, one decline. */
  function expectDeclined(harness: ReturnType<typeof createHarness>) {
    expect(harness.commitUserMessage).not.toHaveBeenCalled()
    expect(harness.sessionMessages['session-1']).toEqual([expect.objectContaining({ role: 'system' })])
    expect(harness.userAppended).toEqual([])
    expect(harness.userTurns).toEqual([])
    expect(harness.assistantAppended).toEqual([])
    expect(harness.assistantTurns).toEqual([])
    expect(speechHookCalls(harness)).toEqual([])
    expect(harness.order.filter(entry => entry === 'hook:stream-end')).toHaveLength(1)
    expect(harness.order.filter(entry => /^hook:(?:assistant-end|after-send|assistant-message|turn-complete)/.test(entry))).toEqual([])
    expect(harness.foregroundPatches).toEqual([])
    expect(harness.declined).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', trigger }])
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'declined' }])
    expect(harness.telemetry.messageSendStarted).toEqual([])
    expect(harness.telemetry.chatActivationStarted).toEqual([])
    expect(harness.telemetry.assistantResponseRendered).toEqual([])
    expect(harness.telemetry.messageRound).toEqual([])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([])
    expect(harness.order).not.toContain('trackFirstMessage')
  }

  // (1)
  it('declines on the silent marker without committing or emitting speech', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<|SILENT|>'])

    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await request.done

    expectDeclined(harness)
    // Hosts must not read this acknowledgment as persistence for unprompted turns.
    await expect(request.accepted).resolves.toEqual({ sessionId: 'session-1', messageId: 'trigger-1' })
    expect(harness.order).toEqual([
      'lifecycle:before-compose',
      'hook:before-compose',
      'promptProjection',
      'lifecycle:after-compose',
      'hook:after-compose',
      'hook:before-send',
      'llmRequestStarted',
      'llmFirstToken',
      'hook:stream-end',
      'turnDeclined',
      'foreground:reset',
      'settled:declined',
    ])
    expect(harness.runtime.getSending()).toBe(false)
  })

  // (1b)
  it('sends the uncommitted trigger as the trailing user turn with runtime contexts and no tools', async () => {
    const harness = createHarness()
    harness.contextSnapshot['system:weather'] = [{
      id: 'weather',
      contextId: 'system:weather',
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'sunny',
      createdAt: 1,
    }]
    const tools = vi.fn(async () => undefined)
    replyWith(harness, ['<|SILENT|>'])

    await harness.runtime.ingest(triggerText, { ...unpromptedOptions, tools, toolReferences: [{ name: 'stage_widgets' }] }, 'session-1')

    const [, , conversation, streamOptions] = harness.stream.mock.calls[0]!
    expect(conversation.turns.at(-1)).toMatchObject({
      type: 'user',
      content: expect.arrayContaining([{ type: 'runtime-context', entries: [{ source: 'system:weather', text: 'sunny' }] }]),
    })
    expect(conversationToChatMessages(conversation).at(-1)).toEqual({
      role: 'user',
      content: `[2026-04-25 18:47] ${triggerText}\n\nsunny`,
    })
    expect(streamOptions?.tools).toBeUndefined()
    expect(tools).not.toHaveBeenCalled()
    expect(harness.commitUserMessage).not.toHaveBeenCalled()
  })

  it('passes only explicit read-only tools to the stream port for an unprompted turn', async () => {
    const harness = createHarness()
    const readTool: Tool = {
      type: 'function',
      function: { name: 'read_memory', parameters: { type: 'object', properties: {} } },
      execute: vi.fn(() => 'remembered fact'),
    }
    const writeTool: Tool = {
      type: 'function',
      function: { name: 'write_memory', parameters: { type: 'object', properties: {} } },
      execute: vi.fn(() => 'saved'),
    }
    replyWith(harness, ['<|SILENT|>'])

    const request = harness.runtime.submit(triggerText, {
      ...unpromptedOptions,
      tools: [readTool, writeTool],
      unpromptedTools: [readTool],
    }, 'session-1')
    await request.done

    expect(harness.stream.mock.calls[0]?.[3]?.tools).toEqual([readTool])
  })

  it('passes user tools instead of unprompted tools to the stream port for a user turn', async () => {
    const harness = createHarness()
    const readTool: Tool = {
      type: 'function',
      function: { name: 'read_memory', parameters: { type: 'object', properties: {} } },
      execute: vi.fn(() => 'remembered fact'),
    }
    const writeTool: Tool = {
      type: 'function',
      function: { name: 'write_memory', parameters: { type: 'object', properties: {} } },
      execute: vi.fn(() => 'saved'),
    }

    const request = harness.runtime.submit('Remember this fact', {
      model: 'gpt-test',
      chatProvider: provider,
      origin: 'user',
      tools: [readTool, writeTool],
      unpromptedTools: [readTool],
    }, 'session-1')
    await request.done

    expect(harness.stream.mock.calls[0]?.[3]?.tools).toEqual([readTool, writeTool])
  })

  // (2)
  it.each([
    ['whitespace only', [' ', '\n\t', '  ']],
    ['reasoning only', ['<think>The user is busy.</think>', '  ']],
    ['an unterminated marker', ['<|SILENT']],
  ])('declines a reply with %s', async (_name, chunks) => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, chunks)

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expectDeclined(harness)
  })

  // (3)
  it('holds specials until the first spoken text, then commits the trigger and replies', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<|ACT happy|>', ' Oh, a QA topic!'])

    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await request.done

    await expect(request.accepted).resolves.toEqual({ sessionId: 'session-1', messageId: 'trigger-1' })
    expect(harness.sessionMessages['session-1']).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: triggerText, createdAt: expect.any(Number), id: 'trigger-1', origin: 'unprompted', trigger },
      expect.objectContaining({ role: 'assistant', content: ' Oh, a QA topic!', slices: [{ type: 'text', text: ' Oh, a QA topic!' }] }),
    ])
    expect(harness.userAppended).toEqual([expect.objectContaining({ message: expect.objectContaining({ origin: 'unprompted', trigger }), turnIndex: 1 })])
    expect(harness.order).toEqual([
      'lifecycle:before-compose',
      'hook:before-compose',
      'promptProjection',
      'lifecycle:after-compose',
      'hook:after-compose',
      'hook:before-send',
      'llmRequestStarted',
      'llmFirstToken',
      // The decision point: the trigger is committed and the round starts at the first spoken text.
      'commitUserMessage',
      'foreground:patch',
      'trackFirstMessage',
      'chatActivationStarted',
      'messageSendStarted',
      'userMessageAppended',
      'userTurnReady',
      'hook:token-special:<|ACT happy|>',
      'hook:token-literal: Oh, a QA t',
      'foreground:patch',
      'hook:token-literal:opic!',
      'foreground:patch',
      'foreground:patch',
      'assistantResponseRendered',
      'commitAssistantMessage:assistant',
      'assistantMessageAppended',
      'hook:stream-end',
      'hook:assistant-end:<|ACT happy|> Oh, a QA topic!',
      'hook:after-send',
      'hook:assistant-message:<|ACT happy|> Oh, a QA topic!',
      'hook:turn-complete',
      'assistantTurnReady',
      'foreground:reset',
      'messageRound',
      'chatActivationSucceeded',
      'settled:finished',
    ])
    expect(harness.foregroundPatches[0]).toMatchObject({ content: '', slices: [] })
    expect(harness.declined).toEqual([])
  })

  // (4)
  it('declines when the silent marker follows a held special, without emitting that special', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<|ACT happy|>', '<|SILENT|>', ' I changed my mind.'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expectDeclined(harness)
    expect(harness.order.some(entry => entry.includes('ACT'))).toBe(false)
  })

  it('declines a held special and the silent marker in one chunk without emitting the ACT hook', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<|ACT happy|><|SILENT|>'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expectDeclined(harness)
    expect(harness.order.some(entry => entry.includes('ACT'))).toBe(false)
  })

  it('holds a recovered near-miss cue like any special and commits at the first spoken text', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['[ACT ha', 'ppy]', ' Oh, a QA topic!'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    const order = harness.order
    expect(order).toContain('hook:token-special:<|ACT happy|>')
    expect(order.some(entry => entry.startsWith('hook:token-') && entry.includes('[ACT'))).toBe(false)
    expect(order.indexOf('commitUserMessage')).toBeLessThan(order.indexOf('hook:token-special:<|ACT happy|>'))
    expect(order.indexOf('hook:token-special:<|ACT happy|>')).toBeLessThan(order.findIndex(entry => entry.startsWith('hook:token-literal:')))
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', content: ' Oh, a QA topic!' })
    expect(harness.declined).toEqual([])
  })

  it('does not commit an unprompted turn whose only content is a recovered cue', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<ACT happy>'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expectDeclined(harness)
    expect(harness.order.some(entry => entry.includes('ACT'))).toBe(false)
  })

  // https://github.com/moeru-ai/airi/issues/2988
  // Upstream fixed this case in #2993 for notice replies, where `fullText.trim()` counted parsed-away markers as a
  // visible reply. Here only visible speech commits an unprompted turn, so the same reply declines.
  it('declines an unprompted reply that only contains reasoning and an ACT marker (Issue #2988)', async () => {
    const harness = createHarness()
    harness.recordHooks()
    const [generatedTurn] = chatMessagesToTurns([{ role: 'assistant', content: '' }])
    if (generatedTurn.type !== 'assistant')
      throw new Error('Expected assistant turn')
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<think>Reasoning.</think><|ACT {"emotion":"neutral"}|>' })
      await options?.onGeneratedTurn?.(generatedTurn)
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expectDeclined(harness)
  })

  it('speaks only the text after a recovered cue and keeps the cue out of the stored speech', async () => {
    const harness = createHarness()
    const literals: string[] = []
    const specials: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      for (const text of ['[ACT ha', 'ppy] Hello there', ' [aside] not a cue'])
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider })

    const saved = harness.sessionMessages['session-1'].at(-1)
    expect(specials).toEqual(['<|ACT happy|>'])
    expect(literals.join('')).toBe(' Hello there [aside] not a cue')
    expect(saved?.role === 'assistant' && saved.categorization?.speech).toBe(' Hello there [aside] not a cue')
  })

  it('speaks a near-miss marker whose body is not a valid cue verbatim and still recovers a valid one', async () => {
    const harness = createHarness()
    const literals: string[] = []
    const specials: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      // The split keeps every literal non-blank: the runtime does not forward a whitespace-only literal to the hooks.
      for (const text of ['We start [Ac', 't 2] now', ' <act sad slight> ok'])
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider })

    const saved = harness.sessionMessages['session-1'].at(-1)
    expect(specials).toEqual(['<|ACT sad slight|>'])
    expect(literals.join('')).toBe('We start [Act 2] now  ok')
    expect(saved?.role === 'assistant' && saved.categorization?.speech).toBe('We start [Act 2] now  ok')
  })

  it.each([
    ['[ACT {"emotion":"happy",}] Hi'],
    ['[ACT] Hi'],
  ])('strips the marker-shaped near-miss in %j whose body is not a valid cue', async (reply) => {
    const harness = createHarness()
    const literals: string[] = []
    const specials: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: reply })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider })

    // The stored speech is categorized from the parser's end text, so it shows whether the marker left that text too.
    const saved = harness.sessionMessages['session-1'].at(-1)
    expect(specials).toEqual([])
    expect(literals.join('')).toBe(' Hi')
    expect(saved?.role === 'assistant' && saved.categorization?.speech).toBe(' Hi')
  })

  it('keeps a near-miss cue inside reasoning as reasoning text at every chunk split', async () => {
    const reply = '<think>Maybe I should use [ACT happy] or <|ACT sad|> here.</think>Hello there [ACT curious] bye'
    const closeTag = reply.indexOf('</think>')
    for (let split = 0; split <= reply.length; split++) {
      // Splitting inside `</think>` leaks `/think>` into speech even without any cue. That is a streaming categorizer
      // limitation outside marker recovery, so those offsets are not exercised here.
      if (split > closeTag && split < closeTag + '</think>'.length)
        continue
      const harness = createHarness()
      const literals: string[] = []
      const specials: string[] = []
      harness.runtime.hooks.onTokenLiteral(async (text) => {
        literals.push(text)
      })
      harness.runtime.hooks.onTokenSpecial(async (text) => {
        specials.push(text)
      })
      harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
        for (const text of [reply.slice(0, split), reply.slice(split)].filter(Boolean))
          await options?.onStreamEvent?.({ type: 'text-delta', text })
        await options?.onStreamEvent?.({ type: 'finish' })
      })

      await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider })

      const saved = harness.sessionMessages['session-1'].at(-1)
      // Native markers in reasoning were already specials before recovery existed. Only the near-miss stays text.
      expect(specials, `split at ${split}`).toEqual(['<|ACT sad|>', '<|ACT curious|>'])
      expect(literals.join('').replace(/\s+/g, ' '), `split at ${split}`).toBe('Hello there bye')
      expect(saved?.role === 'assistant' && saved.categorization?.reasoning, `split at ${split}`).toBe('Maybe I should use [ACT happy] or <|ACT sad|> here.')
    }
  })

  // (5)
  it('consumes a silent marker that arrives after speech started', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['Hi ', '<|SILENT|>', ' there'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    // Whitespace on both sides of the marker stays speech once speech has started, as in user turns. The marker removal adds no text.
    const reply = harness.sessionMessages['session-1'].at(-1)
    expect(reply).toMatchObject({ role: 'assistant', content: 'Hi  there', categorization: { speech: 'Hi  there' } })
    expect(JSON.stringify(harness.sessionMessages['session-1'])).not.toContain('SILENT')
    expect(JSON.stringify(harness.assistantAppended)).not.toContain('SILENT')
    expect(harness.order.filter(entry => entry.includes('SILENT'))).toEqual([])
    expect(speechHookCalls(harness)).toEqual(['hook:token-literal:Hi ', 'hook:token-literal: ', 'hook:token-literal:there'])
    expect(harness.order).toContain('hook:assistant-end:Hi  there')
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'finished' }])
    expect(harness.declined).toEqual([])
  })

  it.each([
    ['lower case', '<|silent|>'],
    ['inner whitespace', '<| SILENT |>'],
    ['the escaped form', '<{\'|\'}SILENT{\'|\'}>'],
  ])('declines on a silent marker written in %s', async (_name, marker) => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, [marker])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expectDeclined(harness)
  })

  it('declines on a custom decline marker', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<|PASS|>', 'Unused text'])

    await harness.runtime.ingest(triggerText, { ...unpromptedOptions, declineMarker: '<|PASS|>' }, 'session-1')

    expectDeclined(harness)
  })

  describe('with a host stage that declines on <|QUIET|>', () => {
    const quietStage = { declineMarker: '<|QUIET|>', recoverCueNames: ['ACT'] }

    it('declines on the host marker', async () => {
      const harness = createHarness(undefined, quietStage)
      harness.recordHooks()
      replyWith(harness, ['<|QUIET|>', 'Unused text'])

      await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

      expectDeclined(harness)
    })

    it('does not decline on the silent marker', async () => {
      const harness = createHarness(undefined, quietStage)
      replyWith(harness, ['<|SILENT|>', ' Oh, hi!'])

      await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

      expect(harness.declined).toEqual([])
      expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'finished' }])
    })

    it('lets the send option override the host marker', async () => {
      const harness = createHarness(undefined, quietStage)
      harness.recordHooks()
      replyWith(harness, ['<|PASS|>', 'Unused text'])

      await harness.runtime.ingest(triggerText, { ...unpromptedOptions, declineMarker: '<|PASS|>' }, 'session-1')

      expectDeclined(harness)
    })
  })

  it('does not decline on a silent marker inside reasoning', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<think>I could stay ', '<|SILENT|>', ' but no.</think>', 'Sure, hi!'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expect(harness.declined).toEqual([])
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'finished' }])
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', content: 'Sure, hi!' })
    expect(harness.order.filter(entry => entry.includes('SILENT'))).toEqual([])
  })

  it('speaks plain text that only names the marker', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['SILENT night'])

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    expect(harness.declined).toEqual([])
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', content: 'SILENT night' })
  })

  it('does not publish held output or reasoning before the decision', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'reasoning-delta', text: 'Should I speak?' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT happy|>' })
      await options?.onStreamEvent?.({ type: 'citations', citations: [] })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|SILENT|>' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')

    const states = harness.stateChanges as ChatOrchestratorRuntimeState[]
    expect(harness.foregroundPatches).toEqual([])
    expect(states.filter(state => state.activeStreamingMessage || state.activeTurns.length)).toEqual([])
    expect(states).toContainEqual(expect.objectContaining({ sending: true, activeSendSessionId: 'session-1' }))
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'declined' }])
  })

  // Hosts close the voice response of a cancelled turn when `onSendSettled` reports it, because stage-ui maps that
  // event to `voiceGenerationEnded`. A held turn therefore needs exactly one cancelled settlement and nothing else.
  it('closes a turn cancelled during HOLD through one cancelled settlement', async () => {
    const harness = createHarness()
    harness.recordHooks()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      const signal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'reasoning-delta', text: 'Maybe later.' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT happy|>' })
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })

    const generating = harness.untilOrder(entries => entries.includes('llmFirstToken'))
    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await generating
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'trigger-1' })
    await request.done

    await expect(request.accepted).rejects.toThrow('Chat request ended before persistence')
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'cancelled' }])
    expect(harness.commitUserMessage).not.toHaveBeenCalled()
    // The reasoning is not kept as an interrupted reply, because no trigger was committed.
    expect(harness.sessionMessages['session-1']).toEqual([expect.objectContaining({ role: 'system' })])
    expect(speechHookCalls(harness)).toEqual([])
    expect(harness.order).not.toContain('hook:stream-end')
    expect(harness.declined).toEqual([])
    expect(harness.foregroundPatches).toEqual([])
    expect(harness.telemetry.messageRoundFailed).toEqual([])
    expect(harness.runtime.getSending()).toBe(false)
  })

  it('settles a held turn once when it is cancelled twice', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      const signal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT happy|>' })
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })

    const generating = harness.untilOrder(entries => entries.includes('llmFirstToken'))
    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await generating
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'trigger-1' })
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'trigger-1' })
    await request.done
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'trigger-1' })

    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'cancelled' }])
    expect(harness.commitUserMessage).not.toHaveBeenCalled()
  })

  it('keeps the committed trigger and partial speech when cancelled after the decision', async () => {
    const harness = createHarness()
    harness.recordHooks()
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      const signal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT happy|>Oh, a QA topic' })
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })

    const spoken = harness.untilOrder(entries => entries.at(-2)?.startsWith('hook:token-literal:') === true && entries.at(-1) === 'foreground:patch')
    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await spoken
    harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'trigger-1' })
    await request.done

    expect(harness.sessionMessages['session-1']).toEqual([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'user', id: 'trigger-1', origin: 'unprompted', trigger }),
      expect.objectContaining({ role: 'assistant', interrupted: true, content: 'Oh, a QA ' }),
    ])
    expect(harness.order).toContain('hook:token-special:<|ACT happy|>')
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'cancelled' }])
    expect(harness.declined).toEqual([])
  })

  it('surfaces a trigger persistence failure as a stream error without speech', async () => {
    const harness = createHarness()
    harness.recordHooks()
    harness.commitUserMessage.mockRejectedValueOnce(new Error('storage full'))
    replyWith(harness, ['<|ACT happy|>Hello there, friend.', ' More text here.'])

    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')

    await expect(request.done).rejects.toThrow('storage full')
    await expect(request.accepted).rejects.toThrow('storage full')
    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'failed' }])
    expect(harness.sessionMessages['session-1']).toEqual([expect.objectContaining({ role: 'system' })])
    expect(speechHookCalls(harness)).toEqual([])
    expect(harness.telemetry.messageRoundFailed).toEqual([])
    expect(harness.telemetry.chatActivationFailed).toEqual([])
  })

  it('produces no second reply when the trigger was already committed', async () => {
    const harness = createHarness()
    replyWith(harness, ['Hello!'])
    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')
    harness.recordHooks()
    replyWith(harness, ['Hello again!'])

    const retry = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await retry.done

    await expect(retry.accepted).resolves.toEqual({ sessionId: 'session-1', messageId: 'trigger-1' })
    expect(harness.sessionMessages['session-1'].filter(message => message.role === 'assistant')).toHaveLength(1)
    expect(harness.sessionMessages['session-1'].filter(message => message.id === 'trigger-1')).toHaveLength(1)
    expect(speechHookCalls(harness)).toEqual([])
    expect(harness.assistantAppended).toHaveLength(1)
    expect(harness.settled.at(-1)).toEqual({ sessionId: 'session-1', turnId: 'trigger-1', status: 'finished' })
  })

  it('counts the turn and activation from history committed at the decision', async () => {
    const harness = createHarness()
    replyWith(harness, ['Hi!'])
    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')
    replyWith(harness, ['Second answer'])
    await harness.runtime.ingest('user follow-up', { model: 'gpt-test', chatProvider: provider }, 'session-1')

    expect(harness.telemetry.messageSendStarted).toEqual([
      expect.objectContaining({ roundId: 'trigger-1', turnIndex: 1 }),
      expect.objectContaining({ turnIndex: 2 }),
    ])
    expect(harness.telemetry.chatActivationStarted).toHaveLength(1)
    expect(harness.telemetry.chatActivationSucceeded).toEqual([expect.objectContaining({ roundId: 'trigger-1' })])
  })

  // A declined turn needs no more provider output. Its request stops, and the stop is the decided outcome.
  it('aborts the provider request when the turn declines and settles as declined', async () => {
    const harness = createHarness()
    harness.recordHooks()
    const rest = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    let late: StreamOptions['onStreamEvent']
    let streamEnded = false
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      signal = options?.abortSignal
      late = options?.onStreamEvent
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|SILENT|>' })
      // The rest of the reply arrives only after the test releases it. A real request rejects when it is aborted.
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
        void rest.promise.then(resolve)
      })
      for (let index = 0; index < 20; index++)
        await options?.onStreamEvent?.({ type: 'text-delta', text: ` chunk ${index}` })
      await options?.onStreamEvent?.({ type: 'finish' })
      streamEnded = true
    })

    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    try {
      await request.done

      expect(signal?.aborted).toBe(true)
      expect(streamEnded).toBe(false)
      expect(harness.runtime.getSending()).toBe(false)
      expectDeclined(harness)
      expect(harness.telemetry.messageRoundFailed).toEqual([])
      expect(harness.telemetry.chatActivationFailed).toEqual([])

      // Output that a provider delivers after the stop is ignored and does not fail the settled turn.
      const settledOrder = [...harness.order]
      await expect(late?.({ type: 'text-delta', text: 'Late speech.' })).resolves.toBeUndefined()
      await expect(late?.({ type: 'error', error: new Error('late provider error') })).resolves.toBeUndefined()
      expect(harness.order).toEqual(settledOrder)
    }
    finally {
      rest.resolve()
    }
  })

  it('aborts the provider request when the trigger was already committed', async () => {
    const harness = createHarness()
    replyWith(harness, ['Hello!'])
    await harness.runtime.ingest(triggerText, unpromptedOptions, 'session-1')
    harness.recordHooks()
    let signal: AbortSignal | undefined
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      signal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hello again!' })
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }))
    })

    const retry = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    await retry.done

    expect(signal?.aborted).toBe(true)
    expect(harness.runtime.getSending()).toBe(false)
    expect(speechHookCalls(harness)).toEqual([])
    expect(harness.sessionMessages['session-1'].filter(message => message.role === 'assistant')).toHaveLength(1)
    expect(harness.settled.at(-1)).toEqual({ sessionId: 'session-1', turnId: 'trigger-1', status: 'finished' })
  })

  it.each([
    ['a spoken unprompted turn', unpromptedOptions],
    ['a user turn that writes the marker', { model: 'gpt-test', chatProvider: provider }],
  ])('never aborts the provider request of %s', async (_name, options) => {
    const harness = createHarness()
    let signal: AbortSignal | undefined
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, streamOptions) => {
      signal = streamOptions?.abortSignal
      for (const text of ['Hi', ' <|SILENT|>', ...Array.from({ length: 20 }, (_, index) => ` chunk ${index}`)])
        await streamOptions?.onStreamEvent?.({ type: 'text-delta', text })
      await streamOptions?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest(triggerText, options, 'session-1')

    expect(signal?.aborted).toBe(false)
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', content: expect.stringContaining('chunk 19') })
    expect(harness.settled).toEqual([expect.objectContaining({ status: 'finished' })])
  })

  it('stays cancelled when a decline arrives after the turn was cancelled during HOLD', async () => {
    const harness = createHarness()
    harness.recordHooks()
    const parked = Promise.withResolvers<void>()
    let late: StreamOptions['onStreamEvent']
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      late = options?.onStreamEvent
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT happy|>' })
      // This provider ignores the abort and keeps its connection open.
      await parked.promise
    })

    const generating = harness.untilOrder(entries => entries.includes('llmFirstToken'))
    const request = harness.runtime.submit(triggerText, unpromptedOptions, 'session-1')
    try {
      await generating
      harness.runtime.cancelTurn({ sessionId: 'session-1', turnId: 'trigger-1' })
      await request.done
      await late?.({ type: 'text-delta', text: '<|SILENT|>' })
      await late?.({ type: 'finish' })

      expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'cancelled' }])
      expect(harness.declined).toEqual([])
      expect(harness.order).not.toContain('hook:stream-end')
      expect(harness.runtime.getSending()).toBe(false)
    }
    finally {
      parked.resolve()
    }
  })
})

// https://github.com/moeru-ai/airi/pull/2714#issuecomment-5976485328
// ROOT CAUSE:
// Reading a shared catalog at execution time ignored request-owned eligibility and changed queued sends.
// Copying catalogs at enqueue preserves each request's provider, prompt, and sticker selection.
it('isolates sticker catalogs and providers across concurrent and queued requests (PR #2714)', async () => {
  let activeProvider = 'provider-a'
  const harness = createHarness(() => activeProvider)
  const held = Promise.withResolvers<void>()
  const started: string[] = []
  const heart = [{ id: 'heart', description: 'A heart' }]
  harness.stream.mockImplementation(async (model, _provider, _context, options) => {
    started.push(model)
    if (model === 'first') {
      expect(options?.providerId).toBe('provider-a')
      await held.promise
    }
    else if (model === 'other') {
      expect(options?.providerId).toBe('provider-b')
    }
    else {
      expect(options?.providerId).toBe('provider-a')
    }
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'Reply <|STICKER heart|><|STICKER dog|>' })
  })
  const first = harness.runtime.ingest('first', { model: 'first', chatProvider: provider, stickers: heart }, 'session-1')
  const queued = harness.runtime.ingest('queued', { model: 'queued', chatProvider: provider, stickers: heart }, 'session-1')
  heart[0]!.id = 'changed'
  activeProvider = 'provider-b'
  const other = harness.runtime.ingest('other', { model: 'other', chatProvider: provider, stickers: [{ id: 'dog', description: 'A dog' }] }, 'session-2')
  try {
    await expect.poll(() => started).toContain('other')
    await other
    expect(started).toEqual(['first', 'other'])
  }
  finally {
    held.resolve()
    await Promise.all([first, queued, other])
  }
  const replies = harness.sessionMessages['session-1']!.filter(message => message.role === 'assistant')
  expect(replies).toHaveLength(2)
  for (const reply of replies) {
    expect(reply.slices.filter(slice => slice.type === 'sticker')).toEqual([{ type: 'sticker', stickerId: 'heart' }])
    expect(reply.categorization?.speech).toBe('Reply ')
  }
  expect(harness.sessionMessages['session-2']!.at(-1)).toMatchObject({
    slices: [{ type: 'text', text: 'Reply ' }, { type: 'sticker', stickerId: 'dog' }],
    categorization: { speech: 'Reply ' },
  })
})

/** Cue stats fields of a reply that is neither wordless nor silent and has no BREAK marker. */
const noReplyShape = { silent: false, wordless: false, breaks: 0, breaksIgnored: 0 } as const

describe('cue stats of a turn', () => {
  function replyWith(harness: ReturnType<typeof createHarness>, chunks: string[]) {
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      for (const text of chunks)
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })
  }

  /** Copies `cueStats` as each hook sees it, because the runtime reuses one context object per turn. */
  function recordCueStats(harness: ReturnType<typeof createHarness>) {
    const seen: Array<{ hook: string, cueStats: ChatTurnCueStats | undefined }> = []
    harness.runtime.hooks.onTokenSpecial(async (_special, context) => {
      seen.push({ hook: 'token-special', cueStats: context.cueStats && { ...context.cueStats } })
    })
    harness.runtime.hooks.onStreamEnd(async (context) => {
      seen.push({ hook: 'stream-end', cueStats: context.cueStats && { ...context.cueStats } })
    })
    return seen
  }

  it.each([
    ['a native ACT', ['<|ACT happy|>', ' a'], { act: 1, recovered: 0 }],
    ['a recovered ACT', ['[ACT sad]', ' b'], { act: 1, recovered: 1 }],
    ['a reply without ACT', ['c'], { act: 0, recovered: 0 }],
    // The stage controller rejects the payload later. The runtime does not validate ACT payloads.
    ['an ACT with an unknown emotion', ['<|ACT banana|> d'], { act: 1, recovered: 0 }],
    ['a DELAY only', ['<|DELAY 1|> e'], { act: 0, recovered: 0 }],
    ['a recovered DELAY', ['[DELAY 1] e'], { act: 0, recovered: 1 }],
    ['two ACTs', ['<|ACT happy|> x ', '<|ACT sad|> y'], { act: 2, recovered: 0 }],
    ['a near-miss inside reasoning', ['<think>maybe [ACT happy]</think>', 'Hi'], { act: 0, recovered: 0 }],
    // Prose that looks like a cue stays speech, because `2` is not a valid ACT body. It counts as neither ACT nor recovered.
    ['prose that reads as a cue', ['In [Act 2] the hero returns.'], { act: 0, recovered: 0 }],
    // A marker-shaped body that is no valid cue is stripped from speech. It counts as rejected, not as ACT or recovered.
    ['a marker-shaped ACT that does not parse', ['[ACT {"emotion":"happy",}] Hi'], { act: 0, recovered: 0, rejected: 1 }],
    ['an empty ACT near-miss', ['[ACT] Hi'], { act: 0, recovered: 0, rejected: 1 }],
    ['an empty DELAY near-miss', ['[DELAY] Hi'], { act: 0, recovered: 0, rejected: 1 }],
  ])('counts %s', async (_name, chunks, expected) => {
    const harness = createHarness()
    const seen = recordCueStats(harness)
    replyWith(harness, chunks)

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider }, 'session-1')

    expect(seen.filter(entry => entry.hook === 'stream-end')).toEqual([
      { hook: 'stream-end', cueStats: { rejected: 0, ...expected, origin: 'user', declined: false, ...noReplyShape } },
    ])
  })

  it('sets the stats only for the stream end and starts every turn from zero', async () => {
    const harness = createHarness()
    const seen = recordCueStats(harness)
    replyWith(harness, ['[ACT happy] hi ', '<|ACT sad|> there'])
    replyWith(harness, ['plain'])

    await harness.runtime.ingest('first', { model: 'test', chatProvider: provider }, 'session-1')
    await harness.runtime.ingest('second', { model: 'test', chatProvider: provider }, 'session-1')

    expect(seen).toEqual([
      { hook: 'token-special', cueStats: undefined },
      { hook: 'token-special', cueStats: undefined },
      { hook: 'stream-end', cueStats: { act: 2, recovered: 1, rejected: 0, origin: 'user', declined: false, ...noReplyShape } },
      { hook: 'stream-end', cueStats: { act: 0, recovered: 0, rejected: 0, origin: 'user', declined: false, ...noReplyShape } },
    ])
  })

  it('marks a declined unprompted turn and keeps the cues it held', async () => {
    const harness = createHarness()
    const seen = recordCueStats(harness)
    replyWith(harness, ['[ACT happy]', '<|SILENT|>'])

    await harness.runtime.ingest('(A quiet moment.)', { model: 'test', chatProvider: provider, origin: 'unprompted', messageId: 'trigger-1' }, 'session-1')

    expect(harness.settled).toEqual([{ sessionId: 'session-1', turnId: 'trigger-1', status: 'declined' }])
    expect(seen).toEqual([
      { hook: 'stream-end', cueStats: { act: 1, recovered: 1, rejected: 0, origin: 'unprompted', declined: true, ...noReplyShape } },
    ])
  })

  it('reports a spoken unprompted turn as not declined', async () => {
    const harness = createHarness()
    const seen = recordCueStats(harness)
    replyWith(harness, ['<|ACT happy|>', ' Oh, hi!'])

    await harness.runtime.ingest('(A quiet moment.)', { model: 'test', chatProvider: provider, origin: 'unprompted', messageId: 'trigger-1' }, 'session-1')

    expect(seen.filter(entry => entry.hook === 'stream-end')).toEqual([
      { hook: 'stream-end', cueStats: { act: 1, recovered: 0, rejected: 0, origin: 'unprompted', declined: false, ...noReplyShape } },
    ])
  })
})

describe('wordless user turns and break slices', () => {
  function replyWith(harness: ReturnType<typeof createHarness>, chunks: string[]) {
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      for (const text of chunks)
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })
  }

  /** Runs one user turn and returns what the hooks saw and what the session stored. */
  async function userTurn(chunks: string[]) {
    const harness = createHarness()
    harness.recordHooks()
    const literals: string[] = []
    const specials: string[] = []
    const streamEnds: Array<ChatTurnCueStats | undefined> = []
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.runtime.hooks.onStreamEnd(async (context) => {
      streamEnds.push(context.cueStats && { ...context.cueStats })
    })
    replyWith(harness, chunks)

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider }, 'session-1')

    return { harness, literals, specials, streamEnds, saved: harness.sessionMessages['session-1'].at(-1) }
  }

  /** Every way a stream can deliver `text`: whole, split once at each offset, and one character per chunk. */
  function chunkingsOf(text: string) {
    const splits = Array.from({ length: text.length - 1 }, (_, index) => [text.slice(0, index + 1), text.slice(index + 1)])
    return [[text], ...splits, [...text]]
  }

  it('stores a wordless reply for ACT then the decline marker, performs the ACT, and speaks nothing', async () => {
    const { harness, literals, specials, streamEnds, saved } = await userTurn(['<|ACT happy|><|SILENT|>'])

    expect(specials).toEqual(['<|ACT happy|>'])
    expect(literals).toEqual([])
    expect(saved).toMatchObject({ role: 'assistant', content: '', slices: [], tool_results: [], wordless: { cues: [{ emotion: 'happy' }] } })
    expect(streamEnds).toEqual([{ act: 1, recovered: 0, rejected: 0, origin: 'user', declined: false, silent: false, wordless: true, breaks: 0, breaksIgnored: 0 }])
    expect(JSON.stringify(harness.sessionMessages['session-1'])).not.toContain('SILENT')
    expect(harness.order.filter(entry => entry.includes('SILENT'))).toEqual([])
    // Hosts close the speech response that they opened before composition.
    expect(harness.order.filter(entry => entry === 'hook:stream-end')).toHaveLength(1)
    expect(harness.settled).toEqual([expect.objectContaining({ status: 'finished' })])
  })

  it('stores a wordless reply when the decline marker comes before a gesture-only ACT', async () => {
    const { specials, literals, saved, streamEnds } = await userTurn(['<|SILENT|>', '<|ACT {"gesture":"nod"}|>'])

    expect(specials).toEqual(['<|ACT {"gesture":"nod"}|>'])
    expect(literals).toEqual([])
    expect(saved).toMatchObject({ role: 'assistant', content: '', slices: [], wordless: { cues: [{ gesture: { kind: 'nod', count: 2 } }] } })
    expect(streamEnds[0]).toMatchObject({ act: 1, silent: false, wordless: true })
  })

  it('stores the action label of an action-only ACT in a wordless reply', async () => {
    const { saved } = await userTurn(['<|SILENT|>', '<|ACT {"action":" Wave "}|>'])

    expect(saved).toMatchObject({ role: 'assistant', content: '', wordless: { cues: [{ action: 'wave' }] } })
  })

  it('commits a wordless reply without the generation transcript that carries the decline marker', async () => {
    const harness = createHarness()
    const [generatedTurn] = chatMessagesToTurns([{ role: 'assistant', content: '<|ACT happy|><|SILENT|>' }])
    if (generatedTurn.type !== 'assistant')
      throw new Error('Expected assistant turn')
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|ACT happy|><|SILENT|>' })
      await options?.onGeneratedTurn?.(generatedTurn)
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider }, 'session-1')

    const saved = harness.sessionMessages['session-1'].at(-1)
    expect(saved).toMatchObject({ role: 'assistant', wordless: { cues: [{ emotion: 'happy' }] } })
    expect(saved?.role === 'assistant' && saved.generationTranscript).toBeUndefined()
    expect(JSON.stringify(saved)).not.toContain('SILENT')
  })

  it.each([
    ['a wordless reply', ['<|ACT {"emotion":"happy","gesture":"shrug"}|>', '<|SILENT|>'], '<|ACT {"emotion":"happy","gesture":{"kind":"shrug","count":1}}|><|SILENT|>'],
    ['a silent reply', ['<|SILENT|>'], '<|SILENT|>'],
  ])('sends %s to the provider as its cue text in the next request', async (_name, chunks, cueText) => {
    const harness = createHarness()
    replyWith(harness, chunks)
    replyWith(harness, ['Sure.'])

    await harness.runtime.ingest('first', { model: 'test', chatProvider: provider }, 'session-1')
    await harness.runtime.ingest('second', { model: 'test', chatProvider: provider }, 'session-1')

    const [, , conversation] = harness.stream.mock.calls[1]!
    const messages = conversationToChatMessages(conversation)
    expect(messages.filter(message => message.role === 'assistant')).toEqual([{ role: 'assistant', content: cueText }])
  })

  it('removes a decline marker that arrives after speech started and stores an ordinary reply', async () => {
    const { harness, specials, saved, streamEnds } = await userTurn(['Hi ', '<|SILENT|>', ' there'])

    expect(specials).toEqual([])
    expect(saved).toMatchObject({ role: 'assistant', content: 'Hi  there', categorization: { speech: 'Hi  there' } })
    expect(saved?.role === 'assistant' && saved.wordless).toBeUndefined()
    expect(harness.order).toContain('hook:assistant-end:Hi  there')
    expect(streamEnds[0]).toMatchObject({ silent: false, wordless: false })
  })

  it('does not answer wordless for a decline marker inside reasoning', async () => {
    const { specials, saved, streamEnds } = await userTurn(['<think>I could stay ', '<|SILENT|>', '</think>', '<|ACT happy|>'])

    expect(specials).toEqual(['<|ACT happy|>'])
    // Without visible text or a wordless answer, the turn stores no assistant message, as before.
    expect(saved?.role).toBe('user')
    expect(streamEnds).toEqual([{ act: 1, recovered: 0, rejected: 0, origin: 'user', declined: false, silent: false, wordless: false, breaks: 0, breaksIgnored: 0 }])
  })

  it('splits text at most twice at BREAK and joins the text around an ignored one, at every chunk split', async () => {
    const reply = 'a<|BREAK|>b<|BREAK 0.5|>c<|BREAK|>d'
    for (const chunks of chunkingsOf(reply)) {
      const label = JSON.stringify(chunks)
      const { specials, saved, streamEnds } = await userTurn(chunks)

      expect(specials, label).toEqual(['<|BREAK|>', '<|BREAK 0.5|>'])
      expect(saved?.role === 'assistant' && saved.slices, label).toEqual([
        { type: 'text', text: 'a' },
        { type: 'break', seconds: 1 },
        { type: 'text', text: 'b' },
        { type: 'break', seconds: 0.5 },
        { type: 'text', text: 'c d' },
      ])
      expect(saved?.content, label).toBe('a\n\nb\n\nc d')
      expect(streamEnds[0], label).toMatchObject({ breaks: 2, breaksIgnored: 1 })
    }
  })

  it('merges adjacent breaks into the longer one and drops the whitespace between bubbles', async () => {
    const { specials, saved, streamEnds } = await userTurn(['Hi', '<|BREAK 0.5|>', ' ', '<|BREAK 2|>', ' there'])

    expect(specials).toEqual(['<|BREAK 2|>'])
    expect(saved).toMatchObject({
      content: 'Hi\n\nthere',
      slices: [{ type: 'text', text: 'Hi' }, { type: 'break', seconds: 2 }, { type: 'text', text: 'there' }],
    })
    expect(streamEnds[0]).toMatchObject({ breaks: 1, breaksIgnored: 0 })
  })

  it.each([
    ['a leading break', ['<|BREAK|>', 'Hi there']],
    ['a trailing break', ['Hi there', '<|BREAK 2|>', '  ']],
  ])('keeps one bubble for %s', async (_name, chunks) => {
    const { specials, saved, streamEnds } = await userTurn(chunks)

    expect(specials).toEqual([])
    expect(saved).toMatchObject({ content: 'Hi there', slices: [{ type: 'text', text: 'Hi there' }] })
    expect(streamEnds[0]).toMatchObject({ breaks: 0, breaksIgnored: 1 })
  })

  it.each([
    ['ow, hey >_<', 'ow, hey'],
    ['hello there! >_<', 'hello there!'],
    ['ow, hey! >_< you', 'ow, hey! you'],
  ])('stores every character of %j and speaks it as %j, at every chunk split', async (reply, spoken) => {
    // ROOT CAUSE:
    //
    // The categorizer held a `<` that ended its buffer, since the next chunk could make it a tag, by filtering the whole
    // literal out of speech. Nothing released it, so the text before a trailing face such as `>_<` was lost.
    for (const chunks of chunkingsOf(reply)) {
      const label = JSON.stringify(chunks)
      const { literals, saved } = await userTurn(chunks)

      expect(saved?.content, label).toBe(reply)
      expect(saved?.role === 'assistant' && saved.slices, label).toEqual([{ type: 'text', text: reply }])
      const tts: string[] = []
      for await (const chunk of chunkTtsInput(literals.join(''), { stripAsciiFaces: true })) {
        if (chunk.text.trim())
          tts.push(chunk.text.trim())
      }
      expect(tts.join(' '), label).toBe(spoken)
    }
  })

  it.each([
    ['a trailing break', ['ow >_<', '<|BREAK 1|>'], [{ type: 'text', text: 'ow >_<' }], 'ow >_<', { breaks: 0, breaksIgnored: 1 }],
    ['a break before more text', ['ow >_<', '<|BREAK 0.5|>', ' more'], [{ type: 'text', text: 'ow >_<' }, { type: 'break', seconds: 0.5 }, { type: 'text', text: 'more' }], 'ow >_<\n\nmore', { breaks: 1, breaksIgnored: 0 }],
  ])('keeps a face whole before %s', async (_name, chunks, slices, content, cueStats) => {
    // ROOT CAUSE:
    //
    // A held `<` was released only by the next literal or by `flush`, and a marker is neither. A face right before a
    // BREAK left its `<` held across the marker, so it became a bubble of its own or started the next bubble.
    const { saved, streamEnds } = await userTurn(chunks)

    expect(saved).toMatchObject({ content, slices })
    expect(streamEnds[0]).toMatchObject(cueStats)
  })

  it('forwards a malformed BREAK as an ordinary special without splitting the text', async () => {
    const { specials, saved, streamEnds } = await userTurn(['a', '<|BREAK x|>', 'b'])

    expect(specials).toEqual(['<|BREAK x|>'])
    expect(saved).toMatchObject({ content: 'ab', slices: [{ type: 'text', text: 'ab' }] })
    expect(streamEnds[0]).toMatchObject({ breaks: 0, breaksIgnored: 0 })
  })

  it('ignores a break before the first text of an unprompted turn and still commits at that text', async () => {
    const harness = createHarness()
    harness.recordHooks()
    replyWith(harness, ['<|BREAK|>', 'Oh, hi!'])

    await harness.runtime.ingest('(A quiet moment.)', { model: 'test', chatProvider: provider, origin: 'unprompted', messageId: 'trigger-1' }, 'session-1')

    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', content: 'Oh, hi!', slices: [{ type: 'text', text: 'Oh, hi!' }] })
    expect(harness.order.filter(entry => entry.startsWith('hook:token-') && entry.includes('BREAK'))).toEqual([])
  })

  it('replays the break rule identically at every chunking', async () => {
    const replay = await replayReplyAtEveryChunking('a<|BREAK|>b<|BREAK|>c<|BREAK|>d<|BREAK|>', liveStage)

    expect(replay.specials).toEqual([{ value: '<|BREAK|>' }, { value: '<|BREAK|>' }])
    expect(replay.cueStats).toMatchObject({ breaks: 2, breaksIgnored: 2 })
  })
})

describe('host stage config', () => {
  it('recovers only the cue names that the host stage lists', async () => {
    const harness = createHarness(undefined, { declineMarker: '<|QUIET|>', recoverCueNames: ['ACT'] })
    const specials: string[] = []
    harness.runtime.hooks.onTokenSpecial(async (special) => {
      specials.push(special)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '[ACT happy] Hi [DELAY 1] there' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello', { model: 'test', chatProvider: provider }, 'session-1')

    expect(specials).toEqual(['<|ACT happy|>'])
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', categorization: { speech: expect.stringContaining('[DELAY 1]') } })
  })

  it('passes a MOOD cue to special hooks and speaks and stores only the words around it', async () => {
    const harness = createHarness()
    const literals: string[] = []
    const specials: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (special) => {
      specials.push(special)
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hi<|MOOD brighter: you came back|>' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('hello', { model: 'test', chatProvider: provider }, 'session-1')

    expect(specials).toEqual(['<|MOOD brighter: you came back|>'])
    expect(literals.join('')).toBe('Hi')
    expect(harness.sessionMessages['session-1'].at(-1)).toMatchObject({ role: 'assistant', content: 'Hi' })
  })

  it('requires the host stage config', () => {
    const build = (deps: Omit<ChatOrchestratorRuntimeDeps, 'stage'>) =>
      // @ts-expect-error The host must supply the decline marker and the cue names.
      createChatOrchestratorRuntime(deps)
    expect(build).toBeTypeOf('function')
  })
})

describe('malformed DELAY durations, line-broken ACT cues and colon-form cues that do not parse', () => {
  /** Every way a stream can deliver `text`: whole, split once at each offset, and one character per chunk. */
  function chunkingsOf(text: string) {
    const splits = Array.from({ length: text.length - 1 }, (_, index) => [text.slice(0, index + 1), text.slice(index + 1)])
    return [[text], ...splits, [...text]]
  }

  async function replay(chunks: string[]) {
    const harness = createHarness()
    const literals: string[] = []
    const specials: string[] = []
    let cueStats: ChatTurnCueStats | undefined
    harness.runtime.hooks.onTokenLiteral(async (text) => {
      literals.push(text)
    })
    harness.runtime.hooks.onTokenSpecial(async (text) => {
      specials.push(text)
    })
    harness.runtime.hooks.onStreamEnd(async (context) => {
      cueStats = context.cueStats && { ...context.cueStats }
    })
    harness.stream.mockImplementationOnce(async (_model, _provider, _context, options) => {
      for (const text of chunks)
        await options?.onStreamEvent?.({ type: 'text-delta', text })
      await options?.onStreamEvent?.({ type: 'finish' })
    })

    await harness.runtime.ingest('Hi', { model: 'test', chatProvider: provider }, 'session-1')

    // The stored speech is categorized from the parser's end text, so it shows whether the marker left that text too.
    const saved = harness.sessionMessages['session-1'].at(-1)
    return { literal: literals.join(''), specials, speech: saved?.role === 'assistant' ? saved.categorization?.speech : undefined, cueStats }
  }

  /**
   * Checks one reply at every chunking. The runtime does not forward a whitespace-only literal to the hooks,
   * so split runs compare the spoken text without whitespace. The whole-reply run and the stored speech compare exactly.
   */
  async function expectAtEveryChunking(reply: string, speech: string, cueStats: Pick<ChatTurnCueStats, 'act' | 'recovered' | 'rejected'>) {
    for (const chunks of chunkingsOf(reply)) {
      const label = JSON.stringify(chunks)
      const result = await replay(chunks)
      expect(result.specials, label).toEqual([])
      expect(result.literal.replace(/\s+/g, ''), label).toBe(speech.replace(/\s+/g, ''))
      if (chunks.length === 1)
        expect(result.literal, label).toBe(speech)
      expect(result.speech, label).toBe(speech)
      expect(result.cueStats, label).toEqual({ ...cueStats, origin: 'user', declined: false, ...noReplyShape })
    }
  }

  const placements: Array<[string, (marker: string) => string, string]> = [
    ['start', marker => `${marker} Hi`, ' Hi'],
    ['middle', marker => `Wait ${marker} go`, 'Wait  go'],
    ['end', marker => `Wait ${marker}`, 'Wait '],
  ]

  it.each([
    '[DELAY 1s]',
    '[DELAY 0]',
    '[DELAY 2 seconds]',
    '[DELAY 1.5s]',
    '[ACT\nhappy]',
    '[ACT\r\nhappy]',
    '[ACT:{"emotion":"happy",}]',
    '[ACT:]',
    '[DELAY:]',
    '[DELAY:{"seconds":1}]',
    '[DELAY:1s]',
    '[DELAY:.5s]',
    '[DELAY .5s]',
  ].flatMap(marker => placements.map(([where, place, speech]) => [marker, where, place(marker), speech])))(
    'strips %j at the %s of the turn at every chunk split and counts it as rejected',
    async (_marker, _where, reply, speech) => {
      await expectAtEveryChunking(reply, speech, { act: 0, recovered: 0, rejected: 1 })
    },
  )

  it.each([
    'In [ACT 2] she leaves',
    'We start [Act 2] now',
    'Be [ACT calm] now',
    'Wait [delay 1s] go',
    'Wait [Delay 1s] go',
    'Wait [DELAY soon] go',
    'Wait [DELAY -1] go',
    'Wait [Delay .5s] go',
    'Wait [DELAY:soon] go',
  ])('keeps the prose %j spoken verbatim at every chunk split', async (reply) => {
    await expectAtEveryChunking(reply, reply, { act: 0, recovered: 0, rejected: 0 })
  })

  it.each([
    ['[DELAY 1] e', '<|DELAY 1|>', 0],
    ['[DELAY 1.5] e', '<|DELAY 1.5|>', 0],
    ['[ACT happy] e', '<|ACT happy|>', 1],
    ['[ACT:Happy] e', '<|ACT:Happy|>', 1],
  ])('still recovers and performs the valid near-miss %j', async (reply, special, act) => {
    const result = await replay([reply])
    expect(result).toEqual({
      literal: ' e',
      specials: [special],
      speech: ' e',
      cueStats: { act, recovered: 1, rejected: 0, origin: 'user', declined: false, ...noReplyShape },
    })
  })
})
