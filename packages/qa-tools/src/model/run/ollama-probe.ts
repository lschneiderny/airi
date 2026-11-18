import type { OllamaLoadBuffers } from './ollama-log'

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import * as v from 'valibot'

import { parseOllamaLoad } from './ollama-log'

/**
 * What an Ollama server reported about the model of a run, read once after the last request.
 *
 * The OpenAI-compatible endpoint reports none of this, and every field decides local reply times: a model that does
 * not fit the GPU (`sizeVram` below `size`) re-runs its prompt on the CPU, and a context smaller than the prompt
 * truncates it without an error. A field the server did not report is `null`.
 */
export interface OllamaServerSnapshot {
  schema: 'airi.ollama-snapshot/v1'
  version: string | null
  model: string
  /** The digest of the installed model, from `/api/tags`. */
  digest: string | null
  family: string | null
  parameterSize: string | null
  quantization: string | null
  capabilities: string[]
  /** The loaded model as `/api/ps` lists it. `null` when the model was no longer loaded. */
  loaded: {
    /** Bytes the loaded model takes, weights and cache. */
    size: number
    /** Bytes of it on the GPU. Less than `size` means part of the model runs on the CPU. */
    sizeVram: number
    /** The context the server loaded the model with, which a compatible request cannot choose. */
    contextLength: number | null
  } | null
  /**
   * The buffers of the model's most recent load, from the server log, or `null` when no log was read or it holds no
   * load of the model. Prefer it to `loaded.size`, which some Ollama versions misreport.
   */
  load: OllamaLoadBuffers | null
}

const versionSchema = v.object({ version: v.string() })
const tagsSchema = v.object({ models: v.array(v.object({ name: v.string(), model: v.optional(v.string()), digest: v.string() })) })
const showSchema = v.object({
  details: v.optional(v.object({
    family: v.optional(v.string()),
    parameter_size: v.optional(v.string()),
    quantization_level: v.optional(v.string()),
  })),
  capabilities: v.optional(v.nullable(v.array(v.string()))),
  modelfile: v.optional(v.string()),
})
const psSchema = v.object({
  models: v.array(v.object({
    name: v.string(),
    model: v.optional(v.string()),
    size: v.number(),
    size_vram: v.number(),
    context_length: v.optional(v.number()),
  })),
})

async function getJson<T extends v.GenericSchema>(url: URL, schema: T, timeoutMs: number, body?: unknown): Promise<v.InferOutput<T> | null> {
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok)
      return null
    const parsed = v.safeParse(schema, await response.json())
    return parsed.success ? parsed.output : null
  }
  catch {
    // Not an Ollama server, or it went away: the snapshot is best effort and never fails a run.
    return null
  }
}

/**
 * Reads the server, model, and load state of `model` from the Ollama native API at the origin of `baseUrl`.
 *
 * Use when:
 * - A live run has finished and its directory should record why its replies took the time they did.
 *
 * Returns:
 * - `null` when the origin does not answer `/api/version`, so a run against another server records nothing.
 */
export async function probeOllama(baseUrl: string, model: string, options: { timeoutMs?: number, serverLog?: string } = {}): Promise<OllamaServerSnapshot | null> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const api = (path: string) => new URL(path, new URL(baseUrl).origin)
  const version = await getJson(api('/api/version'), versionSchema, timeoutMs)
  if (version === null)
    return null
  const [tags, show, ps] = await Promise.all([
    getJson(api('/api/tags'), tagsSchema, timeoutMs),
    getJson(api('/api/show'), showSchema, timeoutMs, { model }),
    getJson(api('/api/ps'), psSchema, timeoutMs),
  ])
  const named = (entry: { name: string, model?: string }) => entry.name === model || entry.model === model
  const tag = tags?.models.find(named)
  const loaded = ps?.models.find(named)
  // The modelfile's first FROM line names the weights file, which is what the log's runner command loads.
  const blob = /^FROM \S*sha256-([0-9a-f]{64})/m.exec(show?.modelfile ?? '')?.[1]
  const log = options.serverLog === undefined || blob === undefined ? null : await readFile(options.serverLog, 'utf8').catch(() => null)
  return {
    schema: 'airi.ollama-snapshot/v1',
    version: version.version,
    model,
    digest: tag?.digest ?? null,
    family: show?.details?.family ?? null,
    parameterSize: show?.details?.parameter_size ?? null,
    quantization: show?.details?.quantization_level ?? null,
    capabilities: show?.capabilities ?? [],
    loaded: loaded ? { size: loaded.size, sizeVram: loaded.size_vram, contextLength: loaded.context_length ?? null } : null,
    load: log === null || blob === undefined ? null : parseOllamaLoad(log, blob),
  }
}

/**
 * The server log to read buffers from: `explicit` when given, otherwise Ollama's default log file on this machine when
 * `baseUrl` is a loopback address and the file exists. A remote server's log is not on this machine.
 */
export function ollamaServerLog(baseUrl: string, explicit: string | undefined, home = homedir()): string | undefined {
  if (explicit !== undefined)
    return explicit
  const { hostname } = new URL(baseUrl)
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname))
    return undefined
  const path = join(home, '.ollama', 'logs', 'server.log')
  return existsSync(path) ? path : undefined
}

/** One line about the loaded model, preferring the log's buffers over `/api/ps`, which some versions misreport. */
export function describeOllamaSnapshot(server: OllamaServerSnapshot): string {
  const gib = (mib: number) => (mib / 1024).toFixed(2)
  const { load, loaded } = server
  if (load !== null) {
    const total = load.gpuWeightsMiB + load.gpuCacheMiB + load.gpuComputeMiB
    return `ollama ${server.version}: ${gib(total)} GiB on the GPU (weights ${gib(load.gpuWeightsMiB)}, cache ${gib(load.gpuCacheMiB)}, compute ${gib(load.gpuComputeMiB)}), ${gib(load.cpuWeightsMiB)} GiB of weights on the CPU, context ${load.contextLength ?? 'unknown'}, flash attention ${load.flashAttention ?? 'default'}${load.cacheTypeK === null ? '' : `, cache ${load.cacheTypeK}`}`
  }
  return `ollama ${server.version}: ${loaded === null ? 'model not loaded' : `${(loaded.size / 2 ** 30).toFixed(1)} GiB loaded, ${Math.round(100 * loaded.sizeVram / loaded.size)}% on GPU, context ${loaded.contextLength ?? 'unknown'}`}`
}
