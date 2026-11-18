import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { sha256Buffer } from '../../evidence/run'

const ToolSchema = v.looseObject({
  type: v.literal('function'),
  function: v.looseObject({ name: v.pipe(v.string(), v.nonEmpty()) }),
})

/**
 * The system prompt and tools of one real app chat request, saved so a model run can send what the app sends.
 *
 * The app composes its system prompt from the card, the stage contract, the model's motion list, plugins, and memory,
 * and it sends a dozen tool definitions. `qa:model run` without a capture composes a smaller prompt and sends no tools,
 * and on 2026-11-18 its cue scores were far better than the app's (88% against 16% parsed for one model).
 */
export const AppRequestSchema = v.strictObject({
  schema: v.literal('airi.app-request/v1'),
  /** The capture's source: a `qa:app` run directory or a replay request log, as given to `capture`. */
  source: v.string(),
  capturedAt: v.pipe(v.string(), v.isoTimestamp()),
  system: v.pipe(v.string(), v.nonEmpty()),
  tools: v.array(ToolSchema),
  /** The app's reply budget, or `null` when the request set none. */
  maxTokens: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
  systemSha256: v.string(),
  toolsSha256: v.nullable(v.string()),
})
export type AppRequest = v.InferOutput<typeof AppRequestSchema>

const LogLineSchema = v.object({
  method: v.string(),
  path: v.string(),
  body: v.unknown(),
})

const ChatBodySchema = v.object({
  messages: v.pipe(v.array(v.object({ role: v.string(), content: v.unknown() })), v.minLength(1)),
  tools: v.optional(v.array(ToolSchema)),
  max_tokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
})

/** Hash of the tool list as a request carries it, so two captures with the same tools hash alike. */
export function toolsSha256(tools: readonly unknown[]): string | null {
  return tools.length ? sha256Buffer(Buffer.from(JSON.stringify(tools), 'utf8')) : null
}

/**
 * Builds a capture from the lines of a replay request log (`qa:llm --log`, or `requests.jsonl` of a `qa:app` run).
 *
 * The first chat request whose first message is a string system message wins: it is the app's first turn, before any
 * history, memory write, or control event could change the prompt.
 *
 * Throws:
 * - An `Error` when no line is such a chat request.
 */
export function appRequestFromLog(lines: readonly string[], source: string, capturedAt: string): AppRequest {
  for (const line of lines) {
    if (!line.trim())
      continue
    const entry = v.safeParse(LogLineSchema, JSON.parse(line))
    if (!entry.success || entry.output.method !== 'POST' || !entry.output.path.endsWith('/chat/completions'))
      continue
    const body = v.safeParse(ChatBodySchema, entry.output.body)
    if (!body.success)
      continue
    const [first] = body.output.messages
    if (first.role !== 'system' || typeof first.content !== 'string' || !first.content)
      continue
    const tools = body.output.tools ?? []
    return {
      schema: 'airi.app-request/v1',
      source,
      capturedAt,
      system: first.content,
      tools,
      maxTokens: body.output.max_tokens ?? null,
      systemSha256: sha256Buffer(Buffer.from(first.content, 'utf8')),
      toolsSha256: toolsSha256(tools),
    }
  }
  throw new Error('no chat request with a system message in the log')
}

/**
 * Loads and validates a capture written by `qa:model capture`.
 *
 * Throws:
 * - An `Error` naming the file when it is missing, not JSON, not a capture, or edited after capture (its hashes no
 *   longer match its text), because records would then name a prompt they were not sent.
 */
export async function loadAppRequest(path: string): Promise<AppRequest> {
  try {
    const parsed = v.parse(AppRequestSchema, JSON.parse(await readFile(path, 'utf8')))
    if (sha256Buffer(Buffer.from(parsed.system, 'utf8')) !== parsed.systemSha256 || toolsSha256(parsed.tools) !== parsed.toolsSha256)
      throw new Error('its text no longer matches its hashes; capture it again instead of editing it')
    return parsed
  }
  catch (error) {
    throw new Error(`${path}: ${errorMessageFrom(error) ?? 'unreadable app request'}`)
  }
}
