import { Buffer } from 'node:buffer'

import * as v from 'valibot'

import { sha256Buffer } from '../../evidence/run'

const nullableString = v.nullable(v.string())

/** Where a row came from. `rowIndex` and `path` together locate the reply inside the source file. */
const SourceSchema = v.strictObject({
  kind: v.picklist(['ollama-bench', 'ollama-sweep', 'ollama-flash-attention', 'live']),
  file: v.string(),
  fileSha256: v.string(),
  rowIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
  path: v.string(),
})
export type ReplyTranscriptSource = v.InferOutput<typeof SourceSchema>

/** One cue-contract reply with the provenance needed to compare it with another run. */
export const ReplyTranscriptRecordSchema = v.strictObject({
  schema: v.literal('airi.reply-transcript/v1'),
  replyId: v.string(),
  /** The dataset id this row belongs to. */
  set: v.pipe(v.string(), v.nonEmpty()),
  runKey: v.string(),
  source: SourceSchema,
  model: v.strictObject({
    id: v.string(),
    provider: v.string(),
    digest: nullableString,
    /** What the server reported the model CAN do, for example `['tools', 'thinking']`. */
    capabilities: v.array(v.string()),
    family: v.optional(v.string()),
    parameterSize: v.optional(v.string()),
    quantization: v.optional(v.string()),
  }),
  /** What the request actually SENT: enablement, never capability. */
  generation: v.strictObject({
    config: v.string(),
    options: v.record(v.string(), v.unknown()),
    think: v.union([v.boolean(), v.string(), v.null()]),
    withTools: v.boolean(),
  }),
  prompt: v.strictObject({
    sha256: nullableString,
    shaSource: v.picklist(['recorded', 'repo-file-at-commit', 'unknown']),
    toolsSha256: nullableString,
    contractVersion: nullableString,
  }),
  machine: v.strictObject({
    label: v.string(),
    os: v.optional(v.string()),
    arch: v.optional(v.string()),
    memGb: v.optional(v.number()),
    serverVersion: v.optional(v.string()),
  }),
  conversation: v.strictObject({
    kind: v.picklist(['turn', 'probe']),
    turn: v.nullable(v.pipe(v.number(), v.integer())),
    user: v.string(),
    origin: v.picklist(['user', 'unprompted']),
  }),
  reply: v.strictObject({
    text: v.string(),
    thinkingText: v.string(),
    toolCalls: v.array(v.strictObject({ name: v.string(), arguments: v.unknown() })),
    finish: nullableString,
    error: nullableString,
    steps: v.nullable(v.unknown()),
  }),
  /** Ordered literal/special stream events recorded from a live run. */
  events: v.optional(v.array(v.strictObject({
    kind: v.picklist(['literal', 'special']),
    value: v.string(),
    raw: v.optional(v.string()),
  }))),
  timing: v.strictObject({
    ttftMs: v.nullable(v.number()),
    totalMs: v.nullable(v.number()),
  }),
  usage: v.nullable(v.record(v.string(), v.unknown())),
  stickers: v.optional(v.array(v.strictObject({ id: v.string() }))),
})
export type ReplyTranscriptRecord = v.InferOutput<typeof ReplyTranscriptRecordSchema>

/**
 * Stable id of one reply: the first 16 hex characters of the sha256 of its source coordinates.
 * `rowIndex` is part of the key because two rows of one file can both hold a `turns[0]`.
 */
export function replyIdFor(source: Pick<ReplyTranscriptSource, 'file' | 'fileSha256' | 'rowIndex' | 'path'>): string {
  const key = JSON.stringify([source.file, source.fileSha256, source.rowIndex, source.path])
  return sha256Buffer(Buffer.from(key, 'utf8')).slice(0, 16)
}
