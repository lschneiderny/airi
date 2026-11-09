import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { readTranscript } from '../model/transcript/jsonl'

const tokenCount = v.pipe(v.number(), v.integer(), v.minValue(0))
const entrySchema = v.strictObject({
  content: v.optional(v.string(), ''),
  match: v.optional(v.union([
    v.string(),
    v.strictObject({ regex: v.string(), flags: v.optional(v.string(), '') }),
  ])),
  toolCalls: v.optional(v.array(v.strictObject({
    name: v.pipe(v.string(), v.nonEmpty()),
    arguments: v.union([v.string(), v.record(v.string(), v.unknown())]),
  })), []),
  usage: v.optional(v.strictObject({
    prompt_tokens: tokenCount,
    completion_tokens: tokenCount,
    total_tokens: tokenCount,
  })),
})
export type ReplayEntry = v.InferOutput<typeof entrySchema>

export class ReplayError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
  }
}

/** JSON arrays or one entry per JSONL line. Invalid fixtures fail before listening. */
export function parseScript(text: string, source: string): ReplayEntry[] {
  try {
    const entries = v.parse(v.pipe(v.array(entrySchema), v.minLength(1)), source.endsWith('.jsonl')
      ? text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line))
      : JSON.parse(text))
    for (const entry of entries) {
      if (entry.match && typeof entry.match !== 'string')
        new RegExp(entry.match.regex, entry.match.flags).test('')
      for (const call of entry.toolCalls) {
        if (typeof call.arguments === 'string')
          v.parse(v.record(v.string(), v.unknown()), JSON.parse(call.arguments))
      }
    }
    return entries
  }
  catch (error) {
    throw new ReplayError(`${source}: ${errorMessageFrom(error) ?? 'invalid replay script'}`)
  }
}

/** Owns consumption; a preferred match never discards an earlier unconsumed entry. */
export class ReplayScript {
  private readonly consumed = new Set<number>()
  private readonly list: ReplayEntry[]

  constructor(entries: readonly ReplayEntry[], readonly source: string) {
    this.list = [...entries]
  }

  get entries(): readonly ReplayEntry[] {
    return this.list
  }

  /** Entries that no request has consumed yet. */
  get remaining(): number {
    return this.list.length - this.consumed.size
  }

  /** Queues one more reply, for a driver that scripts each turn as it sends it. */
  append(entry: ReplayEntry): void {
    this.list.push(entry)
  }

  take(lastUser: string): { readonly entry: ReplayEntry, readonly index: number } {
    const remaining = this.entries.map((entry, index) => ({ entry, index })).filter(item => !this.consumed.has(item.index))
    const selected = remaining.find(({ entry }) => {
      if (typeof entry.match === 'string')
        return lastUser.includes(entry.match)
      return entry.match !== undefined && new RegExp(entry.match.regex, entry.match.flags).test(lastUser)
    }) ?? remaining[0]
    if (!selected)
      throw new ReplayError(`${this.source}: exhausted at index ${this.entries.length}`, 409)
    this.consumed.add(selected.index)
    return selected
  }
}

export async function loadScript(options: { readonly script?: string, readonly set?: string, readonly runKey?: string }, repoRoot: string): Promise<ReplayScript> {
  if (options.script)
    return new ReplayScript(parseScript(await readFile(options.script, 'utf8'), options.script), options.script)
  if (options.set) {
    if (!/^[\w-]+$/.test(options.set))
      throw new ReplayError('Set id must contain only letters, numbers, underscores, or hyphens')
    const path = resolve(repoRoot, 'packages/qa-tools/model-eval/sets', options.set, 'transcripts.jsonl')
    const entries: ReplayEntry[] = []
    for await (const record of readTranscript(path)) {
      if (options.runKey === undefined || record.runKey === options.runKey)
        entries.push({ content: record.reply.text, toolCalls: [] })
    }
    if (entries.length === 0)
      throw new ReplayError(`${path}: no transcripts for run key ${options.runKey ?? '(all)'}`)
    return new ReplayScript(entries, path)
  }
  const path = resolve(repoRoot, 'packages/qa-tools/fixtures/llm/example.json')
  return new ReplayScript(parseScript(await readFile(path, 'utf8'), path), path)
}
