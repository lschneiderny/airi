import type { ProbeTarget } from './request'

import { setTimeout as sleep } from 'node:timers/promises'

import * as v from 'valibot'

import { PROBE_TIMEOUT_MS, promptTokens, send } from './request'

const psSchema = v.object({ models: v.array(v.object({ name: v.string(), model: v.optional(v.string()) })) })

export interface ColdStartRound {
  /** Loading the weights alone, through Ollama's native API, before any prompt. */
  loadOnlyMs: number
  /** The first reply after an unload: load plus processing the whole system prompt and tools. */
  coldTtftMs: number | null
  /** The same request again: the floor with the prompt cached. */
  warmSameTtftMs: number | null
  /** A different user message: the cached system prompt and tools, plus the new message. */
  warmNewTtftMs: number | null
  promptTokens: number | null
}

function ollamaApi(baseUrl: string, path: string): URL {
  return new URL(path, new URL(baseUrl).origin)
}

async function post(baseUrl: string, path: string, body: unknown): Promise<void> {
  const response = await fetch(ollamaApi(baseUrl, path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  if (!response.ok)
    throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`)
  await response.arrayBuffer()
}

/** Whether `model` is loaded, from `/api/ps`. */
async function isLoaded(baseUrl: string, model: string): Promise<boolean> {
  const response = await fetch(ollamaApi(baseUrl, '/api/ps'), { signal: AbortSignal.timeout(10_000) })
  const ps = v.parse(psSchema, await response.json())
  return ps.models.some(entry => entry.name === model || entry.model === model)
}

/** Unloads the model and waits until `/api/ps` no longer lists it. */
async function unload(baseUrl: string, model: string): Promise<void> {
  await post(baseUrl, '/api/generate', { model, keep_alive: 0 })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!await isLoaded(baseUrl, model))
      return
    await sleep(200)
  }
  throw new Error(`${model} was still loaded 20 s after the unload request`)
}

/**
 * Measures cold and warm first replies through the OpenAI-compatible endpoint, as the app sends them.
 *
 * Expects:
 * - An Ollama server at the origin of `baseUrl`: unloading and loading use its native `/api/generate` and `/api/ps`.
 */
export async function measureColdStart(target: ProbeTarget, rounds: number, progress: (line: string) => void): Promise<ColdStartRound[]> {
  const results: ColdStartRound[] = []
  const ask = async (user: string) => send(target, { system: target.system, tools: target.tools, messages: [{ role: 'user', content: user }] }, { maxTokens: 2 })
  for (let round = 0; round < rounds; round++) {
    await unload(target.baseUrl, target.model)
    const started = performance.now()
    await post(target.baseUrl, '/api/generate', { model: target.model })
    const loadOnlyMs = Math.round(performance.now() - started)
    await unload(target.baseUrl, target.model)
    const cold = await ask(`hey, good morning! (${round + 1})`)
    const warmSame = await ask(`hey, good morning! (${round + 1})`)
    const warmNew = await ask(`what did you do last night? (${round + 1})`)
    const row = { loadOnlyMs, coldTtftMs: cold.ttftMs, warmSameTtftMs: warmSame.ttftMs, warmNewTtftMs: warmNew.ttftMs, promptTokens: promptTokens(cold) }
    results.push(row)
    progress(`round ${round + 1}: load ${(loadOnlyMs / 1000).toFixed(2)} s, cold ${((cold.ttftMs ?? 0) / 1000).toFixed(2)} s, warm ${((warmSame.ttftMs ?? 0) / 1000).toFixed(2)} s, new message ${((warmNew.ttftMs ?? 0) / 1000).toFixed(2)} s`)
  }
  return results
}
