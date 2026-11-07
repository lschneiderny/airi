import type { ReplayEntry } from './script'

export const replayModel = 'airi-replay'
export const speechModel = 'airi-replay-tts'

interface ToolDelta {
  readonly index: number
  readonly id?: string
  readonly type?: 'function'
  readonly function: { readonly name?: string, readonly arguments: string }
}

interface Chunk {
  readonly id: string
  readonly object: 'chat.completion.chunk'
  readonly created: number
  readonly model: string
  readonly system_fingerprint: string
  readonly choices: readonly {
    readonly index: number
    readonly delta: { readonly role?: 'assistant', readonly content?: string, readonly tool_calls?: readonly ToolDelta[] }
    readonly finish_reason: 'stop' | 'tool_calls' | null
  }[]
  readonly usage?: ReplayEntry['usage']
}

function* splitText(text: string, size: number): Generator<string> {
  // Code points preserve Unicode when a single frame is independently UTF-8 encoded.
  const chars = Array.from(text)
  for (let offset = 0; offset < chars.length; offset += size)
    yield chars.slice(offset, offset + size).join('')
}

export function completion(entry: ReplayEntry, index: number) {
  return {
    id: `chatcmpl-replay-${index}`,
    object: 'chat.completion',
    created: 0,
    model: replayModel,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: entry.content,
        ...(entry.toolCalls.length
          ? {
              tool_calls: entry.toolCalls.map((call, toolIndex) => ({
                id: `call_${index}_${toolIndex}`,
                type: 'function',
                function: { name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      },
      finish_reason: entry.toolCalls.length ? 'tool_calls' : 'stop',
    }],
    ...(entry.usage ? { usage: entry.usage } : {}),
  }
}

/** Deterministic OpenAI chunks; the HTTP layer owns SSE framing and pacing. */
export function* streamChunks(entry: ReplayEntry, options: { readonly index: number, readonly chunkChars: number }): Generator<Chunk> {
  const envelope = {
    id: `chatcmpl-replay-${options.index}`,
    object: 'chat.completion.chunk' as const,
    created: 0,
    model: replayModel,
    system_fingerprint: 'airi-replay',
  }
  yield { ...envelope, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }
  for (const content of splitText(entry.content, options.chunkChars))
    yield { ...envelope, choices: [{ index: 0, delta: { content }, finish_reason: null }] }
  for (const [index, call] of entry.toolCalls.entries()) {
    yield {
      ...envelope,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index, id: `call_${options.index}_${index}`, type: 'function', function: { name: call.name, arguments: '' } }] },
        finish_reason: null,
      }],
    }
    const args = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments)
    for (const part of splitText(args, options.chunkChars))
      yield { ...envelope, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: part } }] }, finish_reason: null }] }
  }
  yield { ...envelope, choices: [{ index: 0, delta: {}, finish_reason: entry.toolCalls.length ? 'tool_calls' : 'stop' }] }
  if (entry.usage)
    yield { ...envelope, choices: [], usage: entry.usage }
}
