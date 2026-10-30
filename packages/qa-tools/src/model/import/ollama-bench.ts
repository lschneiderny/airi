import type { ModelCommandHandler } from '../cli'
import type { ReplyTranscriptRecord, ReplyTranscriptSource } from '../transcript/schema'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { createTranscriptWriter } from '../transcript/jsonl'
import { replyIdFor } from '../transcript/schema'

const replyFields = {
  text: v.string(),
  thinkingText: v.string(),
  toolCalls: v.array(v.object({ function: v.object({ name: v.string(), arguments: v.unknown() }) })),
  finish: v.nullable(v.string()),
  error: v.nullable(v.string()),
  steps: v.optional(v.unknown()),
  ttftMs: v.optional(v.nullable(v.number())),
  totalMs: v.number(),
  usage: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
}
const turnFields = { turn: v.pipe(v.number(), v.integer()), user: v.string() }
const benchSchema = v.object({
  model: v.string(),
  caps: v.array(v.string()),
  withTools: v.boolean(),
  turns: v.array(v.object({ ...replyFields, ...turnFields })),
  probes: v.array(v.object(replyFields)),
})
const sweepSchema = v.object({
  model: v.string(),
  config: v.string(),
  options: v.record(v.string(), v.unknown()),
  think: v.boolean(),
  withTools: v.boolean(),
  details: v.object({
    parent_model: v.optional(v.string()),
    family: v.optional(v.string()),
    parameter_size: v.optional(v.string()),
    quantization_level: v.optional(v.string()),
  }),
  replies: v.array(v.variant('kind', [
    v.object({ ...replyFields, ...turnFields, kind: v.literal('turn') }),
    v.object({ ...replyFields, user: v.string(), kind: v.literal('probe') }),
  ])),
})
const sources = [
  { file: 'bench.jsonl', kind: 'ollama-bench' },
  { file: 'sweep.jsonl', kind: 'ollama-sweep' },
  { file: 'flash-attention.jsonl', kind: 'ollama-flash-attention' },
] as const

class LegacyInputError extends Error {}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path))
    hash.update(chunk)
  return hash.digest('hex')
}

/** Retains only a stream chunk and one legacy row, including when a file contains long lines. */
async function* readRows(path: string) {
  const input = createReadStream(path, { encoding: 'utf8' })
  let pending = ''
  let line = 0
  try {
    for await (const chunk of input) {
      pending += chunk
      let end = pending.indexOf('\n')
      while (end !== -1) {
        yield { text: pending.slice(0, end), line: ++line }
        pending = pending.slice(end + 1)
        end = pending.indexOf('\n')
      }
    }
    if (pending.length)
      yield { text: pending, line: ++line }
  }
  finally {
    input.destroy()
  }
}

function parseRow<T extends v.GenericSchema>(schema: T, text: string, path: string, line: number): v.InferOutput<T> {
  try {
    return v.parse(schema, JSON.parse(text))
  }
  catch (error) {
    throw new LegacyInputError(`${path}: line ${line}: ${errorMessageFrom(error) ?? 'invalid legacy row'}`)
  }
}

/**
 * Converts saved native Ollama replies without executing their text. Existing output is overwritten,
 * never appended; identical source bytes and arguments produce identical transcript bytes and ids.
 */
export const runImportOllamaBenchCli: ModelCommandHandler = async (argv, repoRoot, _env) => {
  let args
  let resultsDir: string
  try {
    args = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: Object.fromEntries(['set', 'out', 'machine-label', 'server-version', 'mem-gb'].map(key => [key, { type: 'string' as const }])),
    })
    if (args.positionals.length !== 1 || !args.values.set || !/^[\w-]+$/.test(args.values.set))
      throw new Error('expected <resultsDir> --set <set-id>')
    if (args.values['mem-gb'] !== undefined && (!Number.isFinite(Number(args.values['mem-gb'])) || Number(args.values['mem-gb']) <= 0))
      throw new Error('--mem-gb must be a positive finite number')
    if (Object.values(args.values).includes(''))
      throw new Error('option values must not be empty')
    resultsDir = resolve(repoRoot, args.positionals[0])
    if (!(await stat(resultsDir)).isDirectory())
      throw new Error(`${resultsDir} is not a directory`)
  }
  catch (error) {
    process.stderr.write(`import-ollama-bench: ${errorMessageFrom(error) ?? 'invalid arguments'}\n`)
    return 2
  }

  const out = resolve(repoRoot, args.values.out ?? `packages/qa-tools/model-eval/sets/${args.values.set}/transcripts.jsonl`)
  let files: typeof sources[number][]
  const thinkingModels = new Set<string>()
  let rows = 0
  try {
    const entries = await readdir(resultsDir)
    const unknown = entries.find(name => name !== 'notes.md' && !sources.some(source => source.file === name) && resolve(resultsDir, name) !== out)
    if (unknown)
      throw new LegacyInputError(`${resolve(resultsDir, unknown)}: line 1: unknown legacy source`)
    files = sources.filter(source => entries.includes(source.file))
    if (!files.length)
      throw new LegacyInputError(`${resultsDir}: line 1: empty legacy results directory`)
    if (files.some(source => resolve(resultsDir, source.file) === out))
      throw new LegacyInputError(`${out}: line 1: output must not overwrite a source`)

    // Inspect the whole sweep before emitting defaults: think-on may appear later in the file.
    for (const source of files) {
      const path = resolve(resultsDir, source.file)
      let fileRows = 0
      for await (const { text, line } of readRows(path)) {
        if (source.kind === 'ollama-sweep') {
          const row = parseRow(sweepSchema, text, path, line)
          if (row.config === 'think-on')
            thinkingModels.add(row.model)
        }
        else {
          parseRow(benchSchema, text, path, line)
        }
        fileRows++
      }
      if (!fileRows)
        throw new LegacyInputError(`${path}: line 1: empty legacy source`)
      rows += fileRows
    }
  }
  catch (error) {
    if (!(error instanceof LegacyInputError))
      throw error
    process.stderr.write(`import-ollama-bench: ${error.message}\n`)
    return 2
  }

  const prompt = {
    sha256: await hashFile(resolve(repoRoot, 'scripts/ollama-bench/inputs/shuka-system-prompt.txt')),
    shaSource: 'repo-file-at-commit' as const,
    toolsSha256: await hashFile(resolve(repoRoot, 'scripts/ollama-bench/inputs/tools.json')),
    contractVersion: null,
  }
  const machine = {
    label: args.values['machine-label'] ?? basename(resultsDir),
    ...(args.values['server-version'] === undefined ? {} : { serverVersion: args.values['server-version'] }),
    ...(args.values['mem-gb'] === undefined ? {} : { memGb: Number(args.values['mem-gb']) }),
  }
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, '')
  const writer = createTranscriptWriter(out)
  let replies = 0
  const bySource: Record<string, number> = {}
  try {
    for (const source of files) {
      const path = resolve(resultsDir, source.file)
      const fileSha256 = await hashFile(path)
      bySource[source.file] = 0
      let rowIndex = 0
      for await (const { text, line } of readRows(path)) {
        const sweep = source.kind === 'ollama-sweep' ? parseRow(sweepSchema, text, path, line) : null
        const bench = sweep ? null : parseRow(benchSchema, text, path, line)
        const modelId = sweep?.model ?? bench!.model
        const config = sweep?.config ?? 'bench'
        const model: ReplyTranscriptRecord['model'] = {
          id: modelId,
          provider: 'ollama',
          digest: sweep?.details.parent_model?.split('sha256-').at(-1) ?? null,
          capabilities: bench?.caps ?? [
            ...(sweep!.withTools ? ['tools'] : []),
            ...(thinkingModels.has(modelId) ? ['thinking'] : []),
          ],
          ...(sweep?.details.family === undefined ? {} : { family: sweep.details.family }),
          ...(sweep?.details.parameter_size === undefined ? {} : { parameterSize: sweep.details.parameter_size }),
          ...(sweep?.details.quantization_level === undefined ? {} : { quantization: sweep.details.quantization_level }),
        }
        const generation = {
          config,
          options: {
            num_ctx: 8192,
            ...sweep?.options,
            ...(source.kind === 'ollama-flash-attention' ? { OLLAMA_FLASH_ATTENTION: 1, OLLAMA_KV_CACHE_TYPE: 'q8_0' } : {}),
          },
          think: sweep?.think ?? false,
          withTools: sweep?.withTools ?? bench!.withTools,
        }
        const items = sweep
          ? sweep.replies.map((reply, i) => ({ reply, kind: reply.kind, turn: reply.kind === 'turn' ? reply.turn : null, user: reply.user, path: `replies[${i}]` }))
          : [
              ...bench!.turns.map((reply, i) => ({ reply, kind: 'turn' as const, turn: reply.turn, user: reply.user, path: `turns[${i}]` })),
              ...bench!.probes.map((reply, i) => ({ reply, kind: 'probe' as const, turn: null, user: 'hey', path: `probes[${i}]` })),
            ]
        for (const item of items) {
          const coordinates: ReplyTranscriptSource = { kind: source.kind, file: relative(repoRoot, path).replaceAll('\\', '/'), fileSha256, rowIndex, path: item.path }
          const reply = item.reply
          await writer.write({
            schema: 'airi.reply-transcript/v1',
            replyId: replyIdFor(coordinates),
            set: args.values.set!,
            runKey: `${modelId}/${config}`,
            source: coordinates,
            model,
            generation,
            prompt,
            machine,
            conversation: { kind: item.kind, turn: item.turn, user: item.user, origin: 'user' },
            reply: {
              text: reply.text,
              thinkingText: reply.thinkingText,
              toolCalls: reply.toolCalls.map(call => call.function),
              finish: reply.finish,
              error: reply.error,
              steps: reply.steps ?? null,
            },
            timing: { ttftMs: reply.ttftMs ?? null, totalMs: reply.totalMs },
            usage: reply.usage ?? null,
          })
          replies++
          bySource[source.file]++
        }
        rowIndex++
      }
    }
  }
  finally {
    await writer.close()
  }
  process.stdout.write(`${JSON.stringify({ rows, replies, bySource })}\n`)
  return 0
}
