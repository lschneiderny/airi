import type { RunHandle } from '../../evidence/run'
import type { ProbeTarget } from './request'

import process from 'node:process'

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { createRun } from '../../evidence/run'
import { loadAppRequest } from '../run/app-request'
import { loadScenario } from '../run/scenario'
import { renderPromptMessage } from '../stage-contract'
import { buildEventCases, measureEventCases } from './cache-events'
import { measureColdStart } from './cold-start'
import { measureOverflow } from './overflow'
import { send, targetFrom } from './request'
import { ollamaBinary, parseVariant, runVariant } from './server-sweep'

export const probeUsage = `Usage:
  pnpm qa:model probe cache-events --base-url <url> --model <id> --app-request <file> [--scenario general] [--rounds 3] [--json]
  pnpm qa:model probe cold-start --base-url <url> --model <id> --app-request <file> [--rounds 3] [--json]
  pnpm qa:model probe overflow --base-url <url> --model <id> --app-request <file> [--sizes 8000,14000,20000] [--json]
  pnpm qa:model probe server-sweep --model <id> --scenario <id|file> --config <name> --variant <label:OLLAMA_X=v,...>... [--app-request <file>] [--reasoning none] [--context 16384] [--ollama-bin <path>] [--json]
`

const PROBES = ['cache-events', 'cold-start', 'overflow', 'server-sweep'] as const

const ProbeSegmentsSchema = v.object({ controlPrefix: v.string() })
const FullPromptMemorySchema = v.object({ memory: v.object({ entries: v.pipe(v.array(v.string()), v.minLength(1)) }) })

export interface ProbeCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

function positiveInteger(value: string, name: string, max: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max)
    throw new Error(`--${name} must be an integer from 1 to ${max}`)
  return parsed
}

function endpoint(value: string | undefined): string {
  if (!value)
    throw new Error('--base-url is required')
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('--base-url must be an http or https URL')
  if (url.username || url.password)
    throw new Error('--base-url must not contain credentials')
  return url.href
}

/**
 * Runs `qa:model probe <name>`: one measurement of how a local server handles the app's requests, written to a run
 * directory as `probe.json` and printed as a table.
 *
 * Returns:
 * - 0 after the measurement, 1 when a request fails. Invalid arguments throw, and the `qa:model` router reports them.
 */
export async function runProbeCli(argv: string[], repoRoot: string, env: NodeJS.ProcessEnv, io: ProbeCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  const [name, ...rest] = argv
  const probe = PROBES.find(entry => entry === name)
  if (!probe)
    throw new Error(`${name === undefined ? 'missing probe' : `unknown probe ${JSON.stringify(name)}`}; probes are ${PROBES.join(', ')}\n\n${probeUsage}`)
  const { values } = parseArgs({
    args: rest,
    strict: true,
    allowPositionals: false,
    options: {
      'base-url': { type: 'string' },
      'model': { type: 'string' },
      'app-request': { type: 'string' },
      'scenario': { type: 'string' },
      'config': { type: 'string' },
      'rounds': { type: 'string', default: '3' },
      'sizes': { type: 'string', default: '8000,14000,20000' },
      'variant': { type: 'string', multiple: true },
      'reasoning': { type: 'string' },
      'ollama-bin': { type: 'string' },
      'context': { type: 'string', default: '16384' },
      'json': { type: 'boolean', default: false },
    },
  })
  if (!values.model)
    throw new Error('--model is required')
  const model = values.model
  const rounds = positiveInteger(values.rounds, 'rounds', 20)
  const progress = (line: string) => stderr(`${probe}: ${line}\n`)

  const capture = values['app-request'] === undefined ? null : await loadAppRequest(resolve(repoRoot, values['app-request']))
  const needTarget = (): ProbeTarget => {
    if (capture === null)
      throw new Error(`${probe} needs --app-request: it measures the app's own prompt and tools`)
    return targetFrom(endpoint(values['base-url']), model, capture)
  }

  let result: { rows: unknown[], notes: string[], table: string }
  let run: RunHandle | undefined
  try {
    switch (probe) {
      case 'cache-events':
        result = await cacheEvents(needTarget(), values.scenario ?? 'general', rounds, repoRoot, progress)
        break
      case 'cold-start':
        result = await coldStart(needTarget(), rounds, progress)
        break
      case 'overflow':
        result = await overflow(needTarget(), values.sizes, progress)
        break
      case 'server-sweep':
        run = createRun({ tool: 'model-probe', label: probe, repoRoot, env })
        result = await serverSweep(values, model, repoRoot, env, run.dir, progress)
        break
    }
    run ??= createRun({ tool: 'model-probe', label: probe, repoRoot, env })
    await writeFile(run.path('probe.json'), `${JSON.stringify({ schema: 'airi.model-probe/v1', probe, model, capture: capture === null ? null : { source: capture.source, systemSha256: capture.systemSha256, toolsSha256: capture.toolsSha256 }, notes: result.notes, rows: result.rows }, null, 2)}\n`)
    run.addArtifact('probe.json', 'model-probe')
    run.finish({ exitCode: 0, summary: `${probe} of ${model}: ${result.rows.length} rows` })
    stderr(`${probe}: ${run.dir}\n`)
    stdout(values.json ? `${JSON.stringify({ runDir: run.dir, probe, notes: result.notes, rows: result.rows })}\n` : `${result.table}${result.notes.map(note => `\n${note}`).join('')}\n`)
    return 0
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'probe failed'
    run?.finish({ exitCode: 1, summary: message })
    stderr(`qa-tools model probe ${probe}: ${message}\n`)
    return 1
  }
}

const seconds = (ms: number | null | undefined) => typeof ms === 'number' ? (ms / 1000).toFixed(2) : 'n/a'
const table = (header: string[], rows: (string | number)[][]) => [`| ${header.join(' | ')} |`, `|${header.map(() => ' --- ').join('|')}|`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n')

async function cacheEvents(target: ProbeTarget, scenarioRef: string, rounds: number, repoRoot: string, progress: (line: string) => void) {
  const { formatTimePrefix } = await import('@proj-airi/core-agent')
  const { scenario } = await loadScenario(scenarioRef, repoRoot)
  if (scenario.turns.length < 3)
    throw new Error(`scenario ${scenario.id} needs at least 3 turns: a history and a next turn`)
  const [year, month, day, hour, minute] = scenario.startsAt.split(/[-T:]/).map(Number)
  // Each round starts an hour after the last, so its time prefixes, and with them its whole conversation, are new to
  // the server's prompt cache.
  const prefixed = (round: number, index: number, text: string) => `${formatTimePrefix(new Date(year!, month! - 1, day!, hour! + round, minute! + index).getTime())}${text}`
  const users = scenario.turns.slice(0, -1)
  // The history is the model's own replies to the scenario's turns, so the cached prefix is what the app would hold.
  const replies: string[] = []
  for (const [index, user] of users.entries()) {
    const messages = users.slice(0, index).flatMap((earlier, position) => [{ role: 'user' as const, content: prefixed(0, position, earlier) }, { role: 'assistant' as const, content: replies[position]! }])
    const reply = await send(target, { system: target.system, tools: target.tools, messages: [...messages, { role: 'user', content: prefixed(0, index, user) }] }, { maxTokens: 120 })
    replies.push(reply.text)
    progress(`history turn ${index + 1}/${users.length}`)
  }
  const segments = v.parse(ProbeSegmentsSchema, JSON.parse(await readFile(resolve(repoRoot, 'packages/qa-tools/fixtures/model/probe-segments.json'), 'utf8')))
  const fullPrompt = v.parse(FullPromptMemorySchema, JSON.parse(await readFile(resolve(repoRoot, 'packages/qa-tools/fixtures/model/full-prompt.json'), 'utf8')))
  const unprompted = renderPromptMessage('base.prompt.unprompted')
  const trigger = renderPromptMessage('base.prompt.unprompted-trigger', { reason: 'a while since they spoke' })
  const build = (round: number) => buildEventCases({
    system: target.system,
    tools: target.tools,
    history: users.map((user, index) => [prefixed(round, index, user), replies[index]!] as const),
    nextUser: prefixed(round, users.length, scenario.turns[users.length]!),
    memoryLine: fullPrompt.memory.entries[0]!,
    unprompted,
    trigger,
    control: `${segments.controlPrefix}${JSON.stringify([{ kind: 'voice-interruption', eventId: `e${round + 1}`, at: '2026-11-18T11:05:12Z', renderedText: 'Oh, that sounds like such a long', renderedChars: 32, totalChars: 74 }])}`,
  })
  const { skipped } = build(0)
  const rows = await measureEventCases(target, round => build(round).cases, rounds, progress)
  const floor = rows[0]?.medianTtftMs ?? null
  return {
    rows,
    notes: skipped.map(entry => `Skipped "${entry.name}": ${entry.reason}.`),
    table: table(['Case', 'median TTFT s', 'over repeat s', 'runs s', 'prompt tok', 'meaning'], rows.map(row => [
      row.name,
      seconds(row.medianTtftMs),
      floor === null || row.medianTtftMs === null ? 'n/a' : seconds(row.medianTtftMs - floor),
      row.ttftMs.map(ms => seconds(ms)).join(', '),
      row.promptTokens ?? 'n/a',
      row.meaning,
    ])),
  }
}

async function coldStart(target: ProbeTarget, rounds: number, progress: (line: string) => void) {
  const version = await fetch(new URL('/api/version', new URL(target.baseUrl).origin), { signal: AbortSignal.timeout(5000) }).then(response => response.ok, () => false)
  if (!version)
    throw new Error('cold-start needs an Ollama server: it unloads and loads the model through Ollama\'s native API')
  const rows = await measureColdStart(target, rounds, progress)
  return {
    rows,
    notes: [],
    table: table(['Round', 'load only s', 'cold TTFT s', 'warm same s', 'warm new message s', 'prompt tok'], rows.map((row, index) => [index + 1, seconds(row.loadOnlyMs), seconds(row.coldTtftMs), seconds(row.warmSameTtftMs), seconds(row.warmNewTtftMs), row.promptTokens ?? 'n/a'])),
  }
}

async function overflow(target: ProbeTarget, sizes: string, progress: (line: string) => void) {
  const targets = sizes.split(',').map(size => positiveInteger(size.trim(), 'sizes', 1_000_000))
  const rows = await measureOverflow(target, targets, progress)
  const mark = (kept: boolean) => kept ? 'kept' : 'LOST'
  return {
    rows,
    notes: ['A lost system fact means the server dropped the start of the prompt; a lost first message means it dropped the oldest messages. Ollama does both without an error once a request exceeds its context.'],
    table: table(['Target tok', 'filler turns', 'prompt tok', 'system fact', 'first message', 'cue'], rows.map(row => [row.targetTokens, row.padTurns, row.promptTokens ?? 'n/a', mark(row.systemKept), mark(row.firstMessageKept), mark(row.cueKept)])),
  }
}

async function serverSweep(values: { 'context': string, 'scenario'?: string, 'config'?: string, 'variant'?: string[], 'app-request'?: string, 'reasoning'?: string, 'ollama-bin'?: string }, model: string, repoRoot: string, env: NodeJS.ProcessEnv, outDir: string, progress: (line: string) => void) {
  if (!values.scenario || !values.config)
    throw new Error('server-sweep needs --scenario and --config: each variant runs one conversation')
  if (!values.variant?.length)
    throw new Error('server-sweep needs at least one --variant, for example --variant default: --variant kv-q8:OLLAMA_KV_CACHE_TYPE=q8_0')
  // A private `ollama serve` does not read the Ollama app's context setting and falls back to 4096 tokens, which cuts
  // the app's 6.4k-token prompt, so each server gets the app's recommended context unless its variant sets one.
  const context = positiveInteger(values.context, 'context', 262_144)
  const variants = values.variant.map(parseVariant).map(variant => ({ ...variant, env: { OLLAMA_CONTEXT_LENGTH: String(context), ...variant.env } }))
  if (new Set(variants.map(variant => variant.label)).size !== variants.length)
    throw new Error('two variants share a label')
  const runArgs = ['--scenario', values.scenario, '--config', values.config, ...(values['app-request'] === undefined ? [] : ['--app-request', values['app-request']]), ...(values.reasoning === undefined ? [] : ['--reasoning', values.reasoning])]
  const binary = ollamaBinary(values['ollama-bin'])
  const rows = []
  for (const variant of variants)
    rows.push(await runVariant(variant, { repoRoot, env, binary, model, runArgs, outDir, progress }))
  const gib = (value: number | null | undefined) => typeof value === 'number' ? value.toFixed(2) : 'n/a'
  return {
    rows,
    notes: [
      'Each variant ran on its own private server, one after another. A model loaded on another server at the same time shares the memory and slows every variant.',
      ...rows.filter(row => row.maxPromptTokens !== null && row.load?.contextLength != null && row.maxPromptTokens >= row.load.contextLength).map(row => `${row.label}: a prompt of ${row.maxPromptTokens} tokens filled the ${row.load!.contextLength}-token context, so the server cut it and the row does not show the app's conditions.`),
    ],
    table: table(['Variant', 'env', 'exit', 'GPU GiB', 'CPU weights GiB', 'context', 'flash attn', 'cache k', 'cold TTFT s', 'warm TTFT s', 'warm speech s', 'mean total s', 'decode tok/s'], rows.map(row => [
      row.label,
      Object.entries(row.env).map(([key, value]) => `${key}=${value}`).join(' ') || '-',
      row.exitCode,
      gib(row.load?.gpuGiB),
      gib(row.load?.cpuWeightsGiB),
      row.load?.contextLength ?? 'n/a',
      row.load?.flashAttention ?? 'n/a',
      row.load?.cacheTypeK ?? 'default',
      seconds(row.coldTtftMs),
      seconds(row.warmTtftMs),
      seconds(row.warmFirstSpeechMs),
      seconds(row.meanTotalMs),
      row.decodeTps === null ? 'n/a' : row.decodeTps.toFixed(1),
    ])),
  }
}
