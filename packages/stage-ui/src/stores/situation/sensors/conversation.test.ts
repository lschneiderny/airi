import type { ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'
import type { Observation } from '@proj-airi/stage-shared/situation'

import { createChatHooks } from '@proj-airi/core-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startConversationSensor } from './conversation'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

function turn(turnId: string, overrides: Partial<ChatStreamEventContext> = {}): ChatStreamEventContext {
  return {
    sessionId: 'session-1',
    turnId,
    message: { role: 'user', content: 'hello', createdAt: T0, id: `message-${turnId}` },
    contexts: {},
    composedMessage: [],
    ...overrides,
  }
}

/** Emits the hooks of one finished reply in runtime order: before-send, assistant message, turn complete. */
async function reply(hooks: ChatHookRegistry, context: ChatStreamEventContext) {
  const output = { role: 'assistant' as const, content: 'Hi!', slices: [], tool_results: [] }
  await hooks.emitBeforeSendHooks('hello', context)
  await hooks.emitAssistantMessageHooks(output, 'Hi!', context)
  await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Hi!', toolCalls: [] }, context)
}

describe('conversation situation sensor', () => {
  let hooks: ChatHookRegistry
  let observations: Observation[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    hooks = createChatHooks()
    observations = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records one user and one character observation per user turn', async () => {
    startConversationSensor(hooks, observation => observations.push(observation))

    await reply(hooks, turn('turn-1'))

    expect(observations).toEqual([
      { kind: 'conversation', who: 'user', origin: 'user', atMs: T0 },
      { kind: 'conversation', who: 'character', origin: 'user', atMs: T0 },
    ])
  })

  it('never counts an unprompted turn as the user speaking', async () => {
    startConversationSensor(hooks, observation => observations.push(observation))

    await reply(hooks, turn('turn-1', { origin: 'unprompted' }))

    expect(observations).toEqual([
      { kind: 'conversation', who: 'character', origin: 'unprompted', atMs: T0 },
    ])
  })

  it('counts a turn once when its hooks fire again, and keeps turns of other sessions apart', async () => {
    startConversationSensor(hooks, observation => observations.push(observation))

    await reply(hooks, turn('turn-1'))
    vi.setSystemTime(T0 + 1_000)
    await reply(hooks, turn('turn-1'))
    await reply(hooks, turn('turn-1', { sessionId: 'session-2' }))

    expect(observations).toEqual([
      { kind: 'conversation', who: 'user', origin: 'user', atMs: T0 },
      { kind: 'conversation', who: 'character', origin: 'user', atMs: T0 },
      { kind: 'conversation', who: 'user', origin: 'user', atMs: T0 + 1_000 },
      { kind: 'conversation', who: 'character', origin: 'user', atMs: T0 + 1_000 },
    ])
  })

  it('unregisters its hooks when stopped', async () => {
    const stop = startConversationSensor(hooks, observation => observations.push(observation))

    stop()
    await reply(hooks, turn('turn-1'))

    expect(observations).toEqual([])
  })
})
