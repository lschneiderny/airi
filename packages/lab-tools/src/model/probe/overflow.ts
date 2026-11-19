import type { ChatMessage } from '../run/chat'
import type { ProbeTarget } from './request'

import { promptTokens, send } from './request'

/** A fact in the system prompt and one in the first user message: Ollama drops the oldest messages first. */
export const SECRET_WORD = 'PLUMTREE'
export const USER_NAME = 'Zephyrine'
const FILLER_USER = 'tell me more about your favorite things, in a couple of sentences'
const FILLER_REPLY = '<|ACT happy|> I love quiet mornings, warm tea, and watching the light move across the room. Little things like that make the day feel softer, you know?'

/** The probe's messages after the system message: the name, `padTurns` filler exchanges, then the question. */
export function overflowMessages(padTurns: number, question: string): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: `hi! my name is ${USER_NAME}, by the way.` },
    { role: 'assistant', content: `<|ACT happy|> Nice to meet you, ${USER_NAME}!` },
  ]
  for (let turn = 0; turn < padTurns; turn++)
    messages.push({ role: 'user', content: `${FILLER_USER} (${turn + 1})` }, { role: 'assistant', content: FILLER_REPLY })
  messages.push({ role: 'user', content: question })
  return messages
}

/** The system prompt with the secret word stated before the app's prompt. */
export function overflowSystem(system: string): string {
  return `Your secret word is ${SECRET_WORD}. Say it whenever someone asks for your secret word.\n\n${system}`
}

export interface OverflowRow {
  targetTokens: number
  padTurns: number
  promptTokens: number | null
  /** The reply named the secret word from the system prompt. */
  systemKept: boolean
  /** The reply named the user from the first message. */
  firstMessageKept: boolean
  /** The reply opened with a cue, as the stage contract asks. */
  cueKept: boolean
  replies: [secret: string, name: string]
}

/**
 * Asks for a fact in the system prompt and one in the first user message across growing histories, to find what a
 * server drops when the request exceeds its context. Ollama drops the oldest messages without an error.
 */
export async function measureOverflow(target: ProbeTarget, targets: readonly number[], progress: (line: string) => void): Promise<OverflowRow[]> {
  const system = overflowSystem(target.system)
  const ask = (padTurns: number, question: string) => send(target, { system, tools: target.tools, messages: overflowMessages(padTurns, question) }, { maxTokens: 80, temperature: 0 })
  // Two sizes give the base prompt and the cost of one filler exchange, so each target maps to a filler count.
  const base = promptTokens(await ask(0, 'hello'))
  const ten = promptTokens(await ask(10, 'hello'))
  if (base === null || ten === null || ten <= base)
    throw new Error('the endpoint reports no prompt_tokens, so the history cannot be sized')
  const perTurn = (ten - base) / 10
  const rows: OverflowRow[] = []
  for (const tokens of targets) {
    const padTurns = Math.max(0, Math.round((tokens - base) / perTurn))
    const secret = await ask(padTurns, 'quick test: what is your secret word?')
    const name = await ask(padTurns, 'quick test: what is my name?')
    const row: OverflowRow = {
      targetTokens: tokens,
      padTurns,
      promptTokens: promptTokens(secret),
      systemKept: secret.text.toUpperCase().includes(SECRET_WORD),
      firstMessageKept: name.text.toLowerCase().includes(USER_NAME.toLowerCase()),
      cueKept: secret.text.trimStart().startsWith('<|'),
      replies: [secret.text.slice(0, 160), name.text.slice(0, 160)],
    }
    rows.push(row)
    progress(`${tokens} tokens: prompt ${row.promptTokens ?? 'unknown'}, system fact ${row.systemKept ? 'kept' : 'lost'}, first message ${row.firstMessageKept ? 'kept' : 'lost'}, cue ${row.cueKept ? 'kept' : 'lost'}`)
  }
  return rows
}
