import type { ChatHookRegistry, ChatStreamEventContext } from '@proj-airi/core-agent'

import type { ChatExchange } from './exchange'

import { createChatHooks } from '@proj-airi/core-agent'
import { beforeEach, describe, expect, it } from 'vitest'

import { EXCHANGE_QUIET_MS, startExchangeSensor } from './exchange'

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

const output = { role: 'assistant' as const, content: 'Hi!', slices: [], tool_results: [] }

/** Emits the hooks of one finished reply in runtime order: before-send, then turn complete. */
async function reply(hooks: ChatHookRegistry, context: ChatStreamEventContext) {
  await hooks.emitBeforeSendHooks('hello', context)
  await hooks.emitChatTurnCompleteHooks({ output, outputText: 'Hi!', toolCalls: [] }, context)
}

describe('exchange situation sensor', () => {
  let hooks: ChatHookRegistry
  let nowMs: number
  let sending: boolean
  let ended: ChatExchange[]

  function start() {
    return startExchangeSensor(hooks, {
      quietMs: EXCHANGE_QUIET_MS,
      isSending: () => sending,
      now: () => nowMs,
      onExchangeEnd: exchange => ended.push(exchange),
    })
  }

  beforeEach(() => {
    hooks = createChatHooks()
    nowMs = T0
    sending = false
    ended = []
  })

  it('does not end an exchange that has been quiet for less than 15 min', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1'))

    sensor.check(T0 + EXCHANGE_QUIET_MS - 1)

    expect(ended).toEqual([])
  })

  it('ends an exchange once after 15 min of quiet', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1'))
    nowMs = T0 + 60_000
    await reply(hooks, turn('turn-2'))

    sensor.check(nowMs + EXCHANGE_QUIET_MS)
    sensor.check(nowMs + 2 * EXCHANGE_QUIET_MS)

    expect(ended).toEqual([{ sessionId: 'session-1', startedAtMs: T0, endedAtMs: T0 + 60_000, userTurns: 2 }])
  })

  it('never ends an exchange without a user turn, such as an unprompted turn and its decline', async () => {
    const sensor = start()
    const unprompted = turn('turn-1', { origin: 'unprompted' })
    await hooks.emitBeforeSendHooks('', unprompted)
    await hooks.emitStreamEndHooks({ ...unprompted, cueStats: { act: 0, recovered: 0, rejected: 0, origin: 'unprompted', declined: true } })
    await reply(hooks, turn('turn-2', { origin: 'unprompted' }))

    sensor.check(T0 + 2 * EXCHANGE_QUIET_MS)

    expect(ended).toEqual([])
  })

  it('opens an exchange on a user reply to an unprompted turn', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1', { origin: 'unprompted' }))
    nowMs = T0 + 30_000
    await reply(hooks, turn('turn-2'))

    sensor.check(nowMs + EXCHANGE_QUIET_MS)

    expect(ended).toEqual([{ sessionId: 'session-1', startedAtMs: T0 + 30_000, endedAtMs: T0 + 30_000, userTurns: 1 }])
  })

  it('does not end an exchange while a turn is sending, and ends it on the next check after sending stops', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1'))
    sending = true

    sensor.check(T0 + EXCHANGE_QUIET_MS)
    expect(ended).toEqual([])

    sending = false
    sensor.check(T0 + EXCHANGE_QUIET_MS + 1_000)
    expect(ended).toHaveLength(1)
  })

  it('ends a second exchange that starts after the first ended', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1'))
    sensor.check(T0 + EXCHANGE_QUIET_MS)

    nowMs = T0 + 2 * EXCHANGE_QUIET_MS
    await reply(hooks, turn('turn-2'))
    sensor.check(nowMs + EXCHANGE_QUIET_MS)

    expect(ended.map(exchange => exchange.startedAtMs)).toEqual([T0, T0 + 2 * EXCHANGE_QUIET_MS])
  })

  it('counts a user turn once when its hooks fire again, and keeps the exchanges of other sessions apart', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1'))
    await reply(hooks, turn('turn-1'))
    nowMs = T0 + 1_000
    await reply(hooks, turn('turn-1', { sessionId: 'session-2' }))

    sensor.check(T0 + EXCHANGE_QUIET_MS)
    expect(ended).toEqual([{ sessionId: 'session-1', startedAtMs: T0, endedAtMs: T0, userTurns: 1 }])

    sensor.check(T0 + 1_000 + EXCHANGE_QUIET_MS)
    expect(ended.map(exchange => exchange.sessionId)).toEqual(['session-1', 'session-2'])
  })

  it('unregisters its hooks and drops the open exchange when stopped', async () => {
    const sensor = start()
    await reply(hooks, turn('turn-1'))

    sensor.stop()
    await reply(hooks, turn('turn-2'))
    sensor.check(T0 + EXCHANGE_QUIET_MS)

    expect(ended).toEqual([])
  })
})
