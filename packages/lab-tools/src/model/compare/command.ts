import type { RunHandle } from '../../evidence/run'
import type { CheckResult } from '../run/scenario'
import type { RunScore } from '../score/aggregate'
import type { ServerMemory } from './pool'

import process from 'node:process'

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { createRun } from '../../evidence/run'
import { resolveTranscriptInput } from '../inputs'
import { runScoreCli } from '../score/command'
import { readTranscript } from '../transcript/jsonl'
import { poolRuns, renderCompareMarkdown } from './pool'

export const compareUsage = `Usage:
  pnpm qa:model compare <transcripts.jsonl|run dir|set id>... [--exposed-actions <label:kind,...>] [--json]
`

const nullableNumber = v.nullable(v.number())
/**
 * The parts of a run's `server.json` that a comparison reads. Snapshots written before 2026-11-18 have no `load`, and
 * read as having no server-log buffers.
 */
const ServerSnapshotSchema = v.object({
  version: v.nullable(v.string()),
  loaded: v.nullable(v.object({ size: v.number(), sizeVram: v.number(), contextLength: nullableNumber })),
  load: v.optional(v.nullable(v.object({
    gpuWeightsMiB: v.number(),
    cpuWeightsMiB: v.number(),
    gpuCacheMiB: v.number(),
    gpuComputeMiB: v.number(),
    contextLength: nullableNumber,
  })), null),
})
const ChecksSchema = v.object({
  runs: v.array(v.object({
    runKey: v.string(),
    results: v.array(v.object({ turn: v.number(), any: v.array(v.string()), passed: v.nullable(v.boolean()) })),
  })),
})

export interface CompareCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

/**
 * Runs `qa:model compare`: scores every input together and prints one row per model and config, with the Ollama
 * footprint and recall checks recorded beside each input.
 *
 * Returns:
 * - 0 after printing the table, 1 when scoring fails. Invalid arguments throw, and the `qa:model` router reports them.
 */
export async function runCompareCli(argv: string[], repoRoot: string, env: NodeJS.ProcessEnv, io: CompareCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: { 'exposed-actions': { type: 'string' }, 'json': { type: 'boolean', default: false } },
  })
  if (!positionals.length)
    throw new Error(`expected at least one transcript input\n\n${compareUsage}`)
  const inputs = await Promise.all(positionals.map(input => resolveTranscriptInput(repoRoot, input)))

  let run: RunHandle | undefined
  try {
    run = createRun({ tool: 'model-compare', label: 'pooled', repoRoot, env })
    const pooled = run.path('transcripts.jsonl')
    const servers = new Map<string, ServerMemory>()
    const checks = new Map<string, readonly CheckResult[]>()
    for (const input of inputs) {
      const runKeys = new Set<string>()
      for await (const record of readTranscript(input)) {
        runKeys.add(record.runKey)
        await appendFile(pooled, `${JSON.stringify(record)}\n`)
      }
      const server = await readSidecar(join(dirname(input), 'server.json'), ServerSnapshotSchema)
      if (server !== null) {
        for (const runKey of runKeys)
          servers.set(runKey, server)
      }
      const recorded = await readSidecar(join(dirname(input), 'checks.json'), ChecksSchema)
      for (const entry of recorded?.runs ?? [])
        checks.set(entry.runKey, entry.results)
    }

    let scored = ''
    const exitCode = await runScoreCli([pooled, '--label', 'compare', '--json', ...(values['exposed-actions'] === undefined ? [] : ['--exposed-actions', values['exposed-actions']])], repoRoot, env, {
      stdout: (text) => {
        scored += text
      },
      stderr,
    })
    if (exitCode !== 0)
      throw new Error('scoring the pooled transcripts failed')
    const { runDir } = JSON.parse(scored) as { runDir: string }
    const runs: RunScore[] = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'))
    const rows = poolRuns(runs, { servers, checks })
    const contractVersions = [...new Set(runs.map(score => score.prompt.contractVersion).filter(version => version !== null))]
    const scorer = runs[0] === undefined ? 'unknown' : `${runs[0].scorer.id}@${runs[0].scorer.version}`
    const markdown = renderCompareMarkdown(rows, { contractVersions, scorer })
    await writeFile(run.path('compare.json'), `${JSON.stringify({ schema: 'airi.model-compare/v1', scoreRun: runDir, contractVersions, scorer, rows }, null, 2)}\n`)
    await writeFile(run.path('compare.md'), markdown)
    run.addArtifact('transcripts.jsonl', 'model-transcripts')
    run.addArtifact('compare.json', 'model-compare')
    run.addArtifact('compare.md', 'model-compare-markdown')
    run.finish({ exitCode: 0, summary: `${rows.length} contenders from ${inputs.length} inputs` })
    if (contractVersions.length > 1)
      stderr(`qa-tools model compare: the inputs answered ${contractVersions.length} stage contracts (${contractVersions.join(', ')}); rows of different contracts are not comparable\n`)
    stderr(`qa-tools model compare: ${run.dir}\n`)
    stdout(values.json ? `${JSON.stringify({ runDir: run.dir, scoreRun: runDir, contractVersions, rows })}\n` : markdown)
    return 0
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'compare failed'
    run?.finish({ exitCode: 1, summary: message })
    stderr(`qa-tools model compare: ${message}\n`)
    return 1
  }
}

/** A JSON file a run wrote beside its transcripts, or `null` when that run did not write one. */
async function readSidecar<T extends v.GenericSchema>(path: string, schema: T): Promise<v.InferOutput<T> | null> {
  try {
    return v.parse(schema, JSON.parse(await readFile(path, 'utf8')))
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null
    throw new Error(`${path}: ${errorMessageFrom(error) ?? 'unreadable'}`)
  }
}
