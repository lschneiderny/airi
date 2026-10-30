import type { Tool } from '@xsai/shared-chat'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import { DEVTOOLS_INSPECT_TIMEOUT_MS, getDevtoolsBusContext } from '../../services/devtools/bus'
import { FORGET_MEMORY_TOOL_NAME, READ_MEMORY_TOOL_NAME, WRITE_MEMORY_TOOL_NAME } from '../../tools/memory'
import { useMemoryStore } from '../memory'
import { useAiriCardStore } from '../modules/airi-card'

/** Length cap of the memory tool call history: older calls are dropped first. */
export const MEMORY_TOOL_HISTORY_MAX = 50

/** Length cap of the recorded tool result text. */
export const MEMORY_TOOL_RESULT_MAX = 200

/** One memory tool call of a chat run, as the inspector lists it. */
export interface MemoryToolRecord {
  id: string
  timestamp: number
  sessionId: string
  origin: 'user' | 'unprompted'
  tool: 'read' | 'write' | 'forget'
  /** Every entry id the call named, as the model passed it. */
  ids: string[]
  /** `refused` for an input the tool rejected, `missing` when a read named an unknown entry, `ok` otherwise. */
  outcome: 'ok' | 'missing' | 'refused'
  /** The tool result text, capped at {@link MEMORY_TOOL_RESULT_MAX} characters. */
  result: string
}

/** The run the observed tools belong to. */
export interface MemoryToolContext {
  sessionId: string
  origin: MemoryToolRecord['origin']
}

export interface MemoryCardIndex {
  cardId: string
  name: string
  index: string
}

/** Memory as seen by the window that answered an inspection. */
export interface MemoryInspection {
  enabled: boolean
  /** The index each card would get in its prompt. */
  indexes: MemoryCardIndex[]
  /** The general entries alone, as they appear in every index. */
  general: string
  /** Newest first, at most {@link MEMORY_TOOL_HISTORY_MAX}. */
  history: MemoryToolRecord[]
}

/** The leader window answers it with {@link MemoryInspection} of its memory. */
export const memoryInspectInvoke = defineInvokeEventa<MemoryInspection>('eventa:devtools:memory:inspect')

const TOOL_KINDS: Record<string, MemoryToolRecord['tool']> = {
  [READ_MEMORY_TOOL_NAME]: 'read',
  [WRITE_MEMORY_TOOL_NAME]: 'write',
  [FORGET_MEMORY_TOOL_NAME]: 'forget',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Collects the ids a raw tool input names, without validating it: `ids`, `entries[].id`, or `id`. */
function idsOf(input: unknown): string[] {
  if (!isRecord(input))
    return []
  const ids: string[] = []
  if (Array.isArray(input.ids))
    ids.push(...input.ids.filter((id): id is string => typeof id === 'string'))
  if (Array.isArray(input.entries)) {
    for (const entry of input.entries) {
      if (isRecord(entry) && typeof entry.id === 'string')
        ids.push(entry.id)
    }
  }
  if (typeof input.id === 'string')
    ids.push(input.id)
  return ids
}

/** Reads the outcome from the result text the memory tools return. */
function outcomeOf(result: string): MemoryToolRecord['outcome'] {
  if (result.startsWith('Give at least') || result.startsWith('Memory not saved') || result === 'No memory entry with that id.')
    return 'refused'
  if (result.split('\n').some(line => line.startsWith('No memory entry with id')))
    return 'missing'
  return 'ok'
}

/**
 * Collects what the devtools Memory inspector shows: whether memory is on, the index of every card, and the memory
 * tool calls of this window's chat runs.
 *
 * The chat store of each window wraps its memory tools with {@link observeMemoryTools}, so every call lands here in
 * the window that ran it. Only the leader mounts the Stage and runs chat, so a follower window (the Electron settings
 * window, for example) reads the leader's copy through {@link inspectLeader}. While this window leads, it answers over
 * the devtools inspector bus, an Eventa BroadcastChannel context. The store is not synced: synced actions would keep
 * every polled result in the shared domain state until their call timeout, and the inspector polls every second.
 */
export const useMemoryObservabilityStore = defineStore('devtools:memory-observability', () => {
  const history = shallowRef<readonly MemoryToolRecord[]>([])
  let stopServing: (() => void) | undefined

  /** Records one memory tool call. */
  function record(entry: Omit<MemoryToolRecord, 'id' | 'timestamp'>) {
    const next: MemoryToolRecord = { id: nanoid(), timestamp: Date.now(), ...entry }
    history.value = [next, ...history.value].slice(0, MEMORY_TOOL_HISTORY_MAX)
  }

  /**
   * Returns the memory tools of one run with `execute` wrapped, so that each call records one row. Ids come from the
   * raw input, so a refused call still lists what the model asked for.
   */
  function observeMemoryTools(tools: Tool[], context: MemoryToolContext): Tool[] {
    return tools.map((tool) => {
      const kind = TOOL_KINDS[tool.function.name]
      if (!kind)
        return tool
      return {
        ...tool,
        execute: async (input, options) => {
          const result = await tool.execute(input, options)
          const text = typeof result === 'string' ? result : JSON.stringify(result)
          record({ sessionId: context.sessionId, origin: context.origin, tool: kind, ids: idsOf(input), outcome: outcomeOf(text), result: text.slice(0, MEMORY_TOOL_RESULT_MAX) })
          return result
        },
      }
    })
  }

  /** Answers the inspector bus from this window. Only the leader serves, so a follower's empty copy never answers. */
  function serve() {
    return defineInvokeHandler(getDevtoolsBusContext(), memoryInspectInvoke, () => inspect())
  }

  /** Called beside the situation store's leadership publish, so the leader window answers inspections. */
  function setLeading(leading: boolean) {
    if (leading) {
      stopServing ??= serve()
    }
    else {
      stopServing?.()
      stopServing = undefined
    }
  }

  /** Returns the memory flag, the index of every card, and the tool call history of this window. */
  async function inspect(): Promise<MemoryInspection> {
    // Resolved here, not at setup: the situation store creates this store on every window, and the card store needs
    // an i18n context that only exists once the app is mounted, while inspections arrive after that.
    const memory = useMemoryStore()
    const cardStore = useAiriCardStore()
    const indexes = [...cardStore.cards.entries()].map(([cardId, card]) => ({ cardId, name: card.name, index: memory.indexFor(cardId) }))
    return {
      enabled: memory.enabled,
      indexes,
      general: memory.entries.filter(entry => !entry.persona).map(entry => `- ${entry.id}: ${entry.description}`).join('\n'),
      history: [...history.value],
    }
  }

  /** Returns {@link inspect} of the leader window. Rejects when no window answers in time. */
  async function inspectLeader(): Promise<MemoryInspection> {
    return defineInvoke(getDevtoolsBusContext(), memoryInspectInvoke)(undefined, { signal: AbortSignal.timeout(DEVTOOLS_INSPECT_TIMEOUT_MS) })
  }

  return {
    history: computed(() => history.value),
    record,
    observeMemoryTools,
    setLeading,
    inspect,
    inspectLeader,
  }
})
