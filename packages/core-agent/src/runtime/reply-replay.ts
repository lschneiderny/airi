import type { GenerationProvider } from '@proj-airi/provider-inference'

import type { ChatHistoryItem, ChatTurnCueStats } from '../types/chat'

import { createChatOrchestratorRuntime } from './chat-orchestrator-runtime'

export interface ReplyReplay {
  events: Array<{ kind: 'literal', value: string } | { kind: 'special', value: string, raw?: string }>
  literals: string[]
  specials: Array<{ value: string, raw?: string }>
  cueStats: ChatTurnCueStats
  speech: string | undefined
  fullText: string
}

/** Replays saved provider output as data through an isolated, in-memory chat runtime. */
export async function replayReply(input: {
  text: string
  thinkingText?: string
  chunks?: string[] | 'whole' | 'per-char'
  origin?: 'user' | 'unprompted'
  stickers?: { id: string }[]
}): Promise<ReplyReplay> {
  const messages: ChatHistoryItem[] = [{ role: 'system', content: 'system prompt', createdAt: 0, id: 'system' }]
  const events: ReplyReplay['events'] = []
  const settled = Promise.withResolvers<void>()
  let cueStats: ChatTurnCueStats | undefined
  let fullText = ''
  let nextId = 0
  const chunks = Array.isArray(input.chunks)
    ? input.chunks
    : input.chunks === 'per-char' ? [...input.text] : input.text ? [input.text] : []
  const provider: GenerationProvider = {
    generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.com/' } }),
  }
  const runtime = createChatOrchestratorRuntime({
    session: {
      commitUserMessage: async (_sessionId, message) => {
        messages.push(message)
        return { status: 'inserted', messageId: message.id }
      },
      commitAssistantMessage: async (_sessionId, message) => {
        messages.push(message)
      },
      getSessionMessages: () => messages,
      getSessionGeneration: () => 1,
    },
    context: {
      ingest: () => {},
      snapshot: () => ({}),
    },
    foregroundStream: {
      patch: () => {},
      reset: () => {},
    },
    llm: {
      stream: async (_model, _provider, _messages, options) => {
        if (input.thinkingText)
          await options?.onStreamEvent?.({ type: 'reasoning-delta', text: input.thinkingText })
        for (const text of chunks)
          await options?.onStreamEvent?.({ type: 'text-delta', text })
        await options?.onStreamEvent?.({ type: 'finish' })
      },
    },
    getActiveSessionId: () => 'session-1',
    getActiveProvider: () => 'replay',
    now: () => 0,
    monotonicNow: () => 0,
    createId: () => `replay-${nextId++}`,
    onSendSettled: () => settled.resolve(),
  })
  runtime.hooks.onTokenLiteral(async (value) => {
    events.push({ kind: 'literal', value })
  })
  runtime.hooks.onTokenSpecial(async (value) => {
    events.push({ kind: 'special', value })
  })
  runtime.hooks.onStreamEnd(async (context) => {
    cueStats = context.cueStats && { ...context.cueStats }
  })
  runtime.hooks.onAssistantResponseEnd(async (text) => {
    fullText = text
  })

  await runtime.ingest('replay', {
    model: 'replay',
    chatProvider: provider,
    origin: input.origin,
    stickers: input.stickers?.map(({ id }) => ({ id, description: '' })),
  }, 'session-1')
  await settled.promise
  if (!cueStats)
    throw new Error('Replay ended without runtime cue statistics')
  const saved = messages.at(-1)
  return {
    events,
    literals: events.filter(event => event.kind === 'literal').map(event => event.value),
    specials: events.filter(event => event.kind === 'special').map(({ value, raw }) => ({ value, ...(raw === undefined ? {} : { raw }) })),
    cueStats,
    speech: saved?.role === 'assistant' ? saved.categorization?.speech : undefined,
    fullText,
  }
}

export class ChunkInvariantError extends Error {
  constructor(public readonly split: string) {
    super(`Reply replay diverged at ${split}`)
    this.name = 'ChunkInvariantError'
  }
}

function invariantProjection(replay: ReplyReplay) {
  const events: ReplyReplay['events'] = []
  for (const event of replay.events) {
    if (event.kind === 'special') {
      events.push(event)
      continue
    }
    const value = event.value.replace(/\s+/g, '')
    if (!value)
      continue
    const previous = events.at(-1)
    if (previous?.kind === 'literal')
      previous.value += value
    else
      events.push({ kind: 'literal', value })
  }
  return JSON.stringify({ events, cueStats: replay.cueStats, speech: replay.speech })
}

/**
 * Checks ordered hooks, cue counts and stored speech at every single split, plus whole and per-character streams.
 * Whitespace-only literal hooks are omitted by the runtime, so only the hook comparison ignores whitespace.
 * Returns the whole-reply replay, whose literal whitespace remains intact.
 */
export async function replayReplyAtEveryChunking(text: string): Promise<ReplyReplay> {
  const canonical = await replayReply({ text, chunks: 'whole' })
  const expected = invariantProjection(canonical)
  if (invariantProjection(await replayReply({ text, chunks: 'per-char' })) !== expected)
    throw new ChunkInvariantError('per-char')
  for (let split = 1; split < text.length; split++) {
    const replay = await replayReply({ text, chunks: [text.slice(0, split), text.slice(split)] })
    if (invariantProjection(replay) !== expected)
      throw new ChunkInvariantError(`split ${split}`)
  }
  return canonical
}
