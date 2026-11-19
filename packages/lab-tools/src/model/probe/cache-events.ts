import type { ChatMessage } from '../run/chat'
import type { ProbeRequest, ProbeTarget } from './request'

import { median, promptTokens, send } from './request'

/** The empty-memory line of the app's memory segment (`composeMemoryHeader(false)` in stage-ui). */
export const EMPTY_MEMORY_LINE = 'The memory index is empty.'
/** The tool an unprompted turn keeps: the app offers only reading memory when nobody asked anything. */
export const UNPROMPTED_TOOLS = ['builtIn_readMemory']

export interface EventCaseInput {
  system: string
  tools: readonly unknown[]
  /** Earlier user turns, already time-prefixed, and the replies to them. The last pair is the "next turn". */
  history: readonly (readonly [user: string, reply: string])[]
  /** The next user message after the history, already time-prefixed. */
  nextUser: string
  /** One memory index line, as the memory store renders it. */
  memoryLine: string
  /** The unprompted instruction segment, and the user-turn trigger of an unprompted turn. */
  unprompted: string
  trigger: string
  /** The control segment text of one voice interruption. */
  control: string
}

export interface EventCase {
  name: string
  /** What the case measures, in one sentence for the report. */
  meaning: string
  before: ProbeRequest
  after: ProbeRequest
}

/** A segment the app appends at the end of the system prompt while the later segments (plugin, stickers) are empty. */
const withSegment = (system: string, segment: string) => `${system}\n\n${segment}`

function conversation(history: EventCaseInput['history'], last: string): ChatMessage[] {
  return [...history.flatMap(([user, reply]): ChatMessage[] => [{ role: 'user', content: user }, { role: 'assistant', content: reply }]), { role: 'user', content: last }]
}

/**
 * The per-request events of the app that change a request's prefix, each as a "before" request that leaves the server
 * cache as the app would and an "after" request whose time to first token the probe measures.
 *
 * A case that needs a part the capture does not have (a memory segment) is left out, and its name is returned in
 * `skipped` with the reason.
 */
export function buildEventCases(input: EventCaseInput): { cases: EventCase[], skipped: { name: string, reason: string }[] } {
  const earlier = input.history.slice(0, -1)
  const [lastUser] = input.history[input.history.length - 1]!
  const turn = { system: input.system, tools: input.tools, messages: conversation(earlier, lastUser) }
  const next = { system: input.system, tools: input.tools, messages: conversation(input.history, input.nextUser) }
  const readOnly = input.tools.filter(tool => UNPROMPTED_TOOLS.some(name => JSON.stringify(tool).includes(`"name":"${name}"`)))
  const unprompted = { system: withSegment(input.system, input.unprompted), tools: readOnly, messages: conversation(input.history, input.trigger) }
  const voice = { system: withSegment(input.system, input.control), tools: input.tools, messages: next.messages }
  const cases: EventCase[] = [
    { name: 'repeat', meaning: 'The same request again: the floor, with the whole prompt cached.', before: turn, after: turn },
    { name: 'next turn', meaning: 'A normal next turn: the cache holds everything before the new user message.', before: turn, after: next },
    { name: 'unprompted turn', meaning: 'An unprompted turn, with its instruction segment and only the memory-read tool.', before: turn, after: unprompted },
    { name: 'turn after unprompted', meaning: 'The typed turn after an unprompted turn.', before: unprompted, after: next },
    { name: 'voice turn with control events', meaning: 'A voice turn that carries a control event, after a typed turn.', before: turn, after: voice },
    { name: 'typed turn after control events', meaning: 'The typed turn after a voice turn with a control event.', before: { ...voice, messages: turn.messages }, after: next },
  ]
  const skipped: { name: string, reason: string }[] = []
  if (input.system.includes(EMPTY_MEMORY_LINE)) {
    const remembered = input.system.replace(EMPTY_MEMORY_LINE, `Memory index:\n${input.memoryLine}`)
    cases.splice(2, 0, { name: 'next turn after a memory write', meaning: 'The next turn after a memory write changed the memory index in the system prompt.', before: turn, after: { ...next, system: remembered } })
  }
  else {
    skipped.push({ name: 'next turn after a memory write', reason: `the capture has no "${EMPTY_MEMORY_LINE}" line to fill; capture from a profile without memory` })
  }
  if (!readOnly.length)
    skipped.push({ name: 'unprompted tools', reason: `the capture has no ${UNPROMPTED_TOOLS.join(', ')} tool, so the unprompted cases send no tools` })
  return { cases, skipped }
}

export interface EventCaseResult {
  name: string
  meaning: string
  ttftMs: number[]
  medianTtftMs: number | null
  promptTokens: number | null
}

/**
 * Times the "after" request of each case once per round, each after its "before" request.
 *
 * `casesFor(round)` must give every round its own conversation (for example by its time prefixes): llama-server keeps
 * earlier prompts in a prompt cache, so a round that repeats an earlier round's request measures that cache instead
 * of the event.
 */
export async function measureEventCases(target: Pick<ProbeTarget, 'baseUrl' | 'model'>, casesFor: (round: number) => readonly EventCase[], rounds: number, progress: (line: string) => void): Promise<EventCaseResult[]> {
  const perRound = Array.from({ length: rounds }, (_, round) => casesFor(round))
  const results: EventCaseResult[] = []
  for (const [index, entry] of perRound[0]!.entries()) {
    const times: number[] = []
    let tokens: number | null = null
    for (const cases of perRound) {
      const roundCase = cases[index]!
      await send(target, roundCase.before, { maxTokens: 2 })
      const outcome = await send(target, roundCase.after, { maxTokens: 2 })
      if (outcome.ttftMs !== null)
        times.push(outcome.ttftMs)
      tokens = promptTokens(outcome)
    }
    results.push({ name: entry.name, meaning: entry.meaning, ttftMs: times, medianTtftMs: median(times), promptTokens: tokens })
    progress(`${entry.name}: ${times.map(ms => (ms / 1000).toFixed(2)).join(', ')} s`)
  }
  return results
}
