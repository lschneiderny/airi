import type { ChatHookRegistry } from '@proj-airi/core-agent'

/** The chat hooks the exchange sensor listens to. The chat store exposes them from its runtime. */
export type ExchangeHookSource = Pick<ChatHookRegistry, 'onBeforeSend' | 'onChatTurnComplete'>

/**
 * How long a chat session must stay quiet after its last turn before its exchange counts as ended.
 *
 * Tuning: long enough that a pause to look something up does not split one conversation in two, short enough that
 * the open threads of a finished conversation exist well before she could raise them (the earliest thread ripens
 * 45 min after it is born).
 */
export const EXCHANGE_QUIET_MS = 15 * 60_000

/** One finished exchange: a run of chat turns in one session, opened by the user, followed by {@link EXCHANGE_QUIET_MS} of quiet. */
export interface ChatExchange {
  sessionId: string
  /** When the user's first turn of the exchange was sent. */
  startedAtMs: number
  /** When the last turn of the exchange was sent or completed. */
  endedAtMs: number
  /** User-origin turns in the exchange, at least 1. */
  userTurns: number
}

export interface ExchangeSensorOptions {
  quietMs: number
  /** Whether any chat turn is generating. An exchange never ends while one is. */
  isSending: () => boolean
  now: () => number
  onExchangeEnd: (exchange: ChatExchange) => void
}

export interface ExchangeSensor {
  /** Ends every exchange that has been quiet for `quietMs` at `nowMs`. The store's 1 s advance ticker calls it. */
  check: (nowMs: number) => void
  /** Unregisters the hooks and drops the open exchanges without ending them. */
  stop: () => void
}

interface OpenExchange {
  startedAtMs: number
  lastTurnAtMs: number
  userTurns: number
  lastUserTurnId: string
}

/**
 * Detects the end of chat exchanges, so the open threads of a finished conversation can be extracted once.
 *
 * Only a user-origin `onBeforeSend` opens or extends an exchange: an unprompted turn alone, spoken or declined, never
 * opens one, but a user reply after it does. A completed turn of any origin in a session with an open exchange moves
 * its last activity. Exchanges are kept per chat session, so a session switch neither merges nor drops one. A repeat
 * of a user turn's hooks (same session and turn id) is counted once. {@link ExchangeSensor.check} reports each exchange
 * once, after `quietMs` without a turn, and only while no turn is generating; a later user turn starts a new exchange.
 */
export function startExchangeSensor(hooks: ExchangeHookSource, options: ExchangeSensorOptions): ExchangeSensor {
  const open = new Map<string, OpenExchange>()

  const unregister = [
    hooks.onBeforeSend(async (_message, context) => {
      if (context.origin === 'unprompted')
        return
      const nowMs = options.now()
      const exchange = open.get(context.sessionId)
      if (!exchange) {
        open.set(context.sessionId, { startedAtMs: nowMs, lastTurnAtMs: nowMs, userTurns: 1, lastUserTurnId: context.turnId })
        return
      }
      exchange.lastTurnAtMs = nowMs
      if (exchange.lastUserTurnId !== context.turnId) {
        exchange.userTurns += 1
        exchange.lastUserTurnId = context.turnId
      }
    }),
    hooks.onChatTurnComplete(async (_chat, context) => {
      const exchange = open.get(context.sessionId)
      if (exchange)
        exchange.lastTurnAtMs = options.now()
    }),
  ]

  function check(nowMs: number) {
    if (open.size === 0 || options.isSending())
      return
    for (const [sessionId, exchange] of open) {
      if (nowMs - exchange.lastTurnAtMs < options.quietMs)
        continue
      open.delete(sessionId)
      options.onExchangeEnd({ sessionId, startedAtMs: exchange.startedAtMs, endedAtMs: exchange.lastTurnAtMs, userTurns: exchange.userTurns })
    }
  }

  return {
    check,
    stop() {
      for (const off of unregister)
        off()
      open.clear()
    },
  }
}
