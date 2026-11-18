import type { OllamaServerSnapshot } from '../run/ollama-probe'
import type { ReplyTranscriptRecord } from '../transcript/schema'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { runRunCli } from '../run/command'
import { readTranscript } from '../transcript/jsonl'

/** Ollama's binary inside its macOS app bundle, used when `ollama` is not on PATH. */
const MAC_APP_BINARY = '/Applications/Ollama.app/Contents/Resources/ollama'

export interface SweepVariant {
  label: string
  /** Server environment, for example `OLLAMA_FLASH_ATTENTION=0` or `OLLAMA_KV_CACHE_TYPE=q8_0`. */
  env: Record<string, string>
}

/**
 * Parses `label:KEY=VALUE,KEY=VALUE`. A label alone (`default:`) starts the server with its own defaults.
 *
 * Throws:
 * - An `Error` for a malformed label or pair, or a key that is not an `OLLAMA_` setting other than `OLLAMA_HOST`,
 *   which the sweep sets itself.
 */
export function parseVariant(text: string): SweepVariant {
  const separator = text.indexOf(':')
  const label = separator === -1 ? text : text.slice(0, separator)
  if (!/^[a-z0-9][a-z0-9.-]{0,31}$/.test(label))
    throw new Error(`variant ${JSON.stringify(text)}: the label must be lowercase letters, digits, '.' and '-'`)
  const env: Record<string, string> = {}
  const pairs = separator === -1 ? '' : text.slice(separator + 1)
  for (const pair of pairs.split(',').filter(Boolean)) {
    const match = /^(OLLAMA_[A-Z0-9_]+)=(.*)$/.exec(pair)
    if (!match || match[1] === 'OLLAMA_HOST')
      throw new Error(`variant ${label}: ${JSON.stringify(pair)} is not an OLLAMA_ setting (OLLAMA_HOST is set by the sweep)`)
    env[match[1]!] = match[2]!
  }
  return { label, env }
}

/** The `ollama` binary to start: `explicit`, else the macOS app's binary when it exists, else `ollama` on PATH. */
export function ollamaBinary(explicit: string | undefined, exists: (path: string) => boolean = existsSync): string {
  return explicit ?? (exists(MAC_APP_BINARY) ? MAC_APP_BINARY : 'ollama')
}

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  server.close()
  if (address === null || typeof address === 'string')
    throw new Error('no TCP port for the private server')
  return address.port
}

export interface SweepRow {
  label: string
  env: Record<string, string>
  runDir: string
  exitCode: number
  coldTtftMs: number | null
  warmTtftMs: number | null
  warmFirstSpeechMs: number | null
  meanTotalMs: number | null
  /** Completion tokens after the first, over the time after the first token, across the run. */
  decodeTps: number | null
  /** The largest prompt of the run, to compare with the loaded context: a larger prompt was cut by the server. */
  maxPromptTokens: number | null
  /** The load's buffers from the private server's log, from the run's `server.json`. */
  load: { gpuGiB: number, cpuWeightsGiB: number, contextLength: number | null, flashAttention: string | null, cacheTypeK: string | null } | null
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

/** Timing of a run's records, as the score summary computes it, for the sweep's table. */
export function sweepTiming(records: readonly ReplyTranscriptRecord[]): Pick<SweepRow, 'coldTtftMs' | 'warmTtftMs' | 'warmFirstSpeechMs' | 'meanTotalMs' | 'decodeTps' | 'maxPromptTokens'> {
  const first = records.filter(record => record.conversation.turn === 1)
  const later = records.filter(record => (record.conversation.turn ?? 0) > 1)
  let tokens = 0
  let ms = 0
  for (const record of records) {
    const completion = record.usage?.completion_tokens
    const { ttftMs, totalMs } = record.timing
    if (typeof completion === 'number' && completion > 1 && ttftMs !== null && totalMs !== null && totalMs > ttftMs) {
      tokens += completion - 1
      ms += totalMs - ttftMs
    }
  }
  const values = (list: readonly ReplyTranscriptRecord[], pick: (record: ReplyTranscriptRecord) => number | null | undefined) => list.map(pick).filter(value => typeof value === 'number')
  return {
    coldTtftMs: mean(values(first, record => record.timing.ttftMs)),
    warmTtftMs: mean(values(later, record => record.timing.ttftMs)),
    warmFirstSpeechMs: mean(values(later, record => record.timing.firstSpeechMs)),
    meanTotalMs: mean(values(records, record => record.timing.totalMs)),
    decodeTps: ms ? tokens / (ms / 1000) : null,
    maxPromptTokens: values(records, (record) => {
      const prompt = record.usage?.prompt_tokens
      return typeof prompt === 'number' ? prompt : null
    }).reduce<number | null>((max, value) => Math.max(max ?? 0, value), null),
  }
}

export interface SweepOptions {
  repoRoot: string
  env: NodeJS.ProcessEnv
  binary: string
  model: string
  /** `run` arguments other than the endpoint, the model, the output, and the log. */
  runArgs: string[]
  outDir: string
  progress: (line: string) => void
}

/**
 * Starts a private `ollama serve` on a free loopback port with the variant's environment, runs one scenario
 * conversation against it with `qa:model run`, reads the load's buffers from its log, and stops it.
 */
export async function runVariant(variant: SweepVariant, options: SweepOptions): Promise<SweepRow> {
  const port = await freePort()
  const log = join(options.outDir, `server-${variant.label}.log`)
  const runDir = join(options.outDir, variant.label)
  const output = openSync(log, 'a')
  const child = spawn(options.binary, ['serve'], { env: { ...process.env, ...variant.env, OLLAMA_HOST: `127.0.0.1:${port}` }, stdio: ['ignore', output, output] })
  const exited = once(child, 'exit')
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
      ready = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok, () => false)
      if (ready)
        break
      await sleep(500)
    }
    if (!ready)
      throw new Error(`the private Ollama server for ${variant.label} did not start; see ${log}`)
    options.progress(`${variant.label}: server on port ${port}${Object.keys(variant.env).length ? ` with ${Object.entries(variant.env).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}`)
    let json = ''
    const exitCode = await runRunCli([...options.runArgs, '--base-url', `${baseUrl}/v1`, '--model', options.model, '--out', runDir, '--ollama-log', log, '--json'], options.repoRoot, options.env, {
      stdout: (text) => {
        json += text
      },
      stderr: text => options.progress(`${variant.label}: ${text.trimEnd()}`),
    })
    if (!json)
      throw new Error(`the run for ${variant.label} refused to start; see the lines above`)
    const records: ReplyTranscriptRecord[] = []
    for await (const record of readTranscript(join(runDir, 'transcripts.jsonl')))
      records.push(record)
    // The run wrote this snapshot a moment ago, in the current shape.
    const server: OllamaServerSnapshot | null = existsSync(join(runDir, 'server.json')) ? JSON.parse(await readFile(join(runDir, 'server.json'), 'utf8')) : null
    const load = server === null ? null : server.load
    return {
      label: variant.label,
      env: variant.env,
      runDir,
      exitCode,
      ...sweepTiming(records),
      load: load === null
        ? null
        : { gpuGiB: (load.gpuWeightsMiB + load.gpuCacheMiB + load.gpuComputeMiB) / 1024, cpuWeightsGiB: load.cpuWeightsMiB / 1024, contextLength: load.contextLength, flashAttention: load.flashAttention, cacheTypeK: load.cacheTypeK },
    }
  }
  finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      const stopped = await Promise.race([exited.then(() => true), sleep(15_000).then(() => false)])
      if (!stopped)
        child.kill('SIGKILL')
    }
  }
}
