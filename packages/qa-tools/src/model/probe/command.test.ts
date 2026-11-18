import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { parseScript, ReplayScript } from '../../llm/script'
import { ReplayServer } from '../../llm/server'
import { buildSystemPrompt, renderDefaultCard } from '../stage-contract'
import { runProbeCli } from './command'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const owned: string[] = []
const servers: ReplayServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(entries: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'model-probe-'))
  owned.push(dir)
  const server = new ReplayServer({ script: new ReplayScript(parseScript(JSON.stringify(entries), 'test.json'), 'test.json'), log: join(dir, 'requests.jsonl') })
  servers.push(server)
  const baseUrl = await server.listen()
  const system = `${buildSystemPrompt({ cardPrompt: renderDefaultCard(), register: 'talking' }).text}\n\nThe memory index is empty.`
  const log = join(dir, 'app.jsonl')
  await writeFile(log, `${JSON.stringify({ method: 'POST', path: '/v1/chat/completions', body: { tools: [{ type: 'function', function: { name: 'builtIn_readMemory' } }], messages: [{ role: 'system', content: system }] } })}\n`)
  const capture = join(dir, 'capture.json')
  const { runCaptureCli } = await import('../run/capture-command')
  await runCaptureCli([log, '--out', capture], repoRoot, {}, { stdout: () => {} })
  await writeFile(join(dir, 'short.json'), JSON.stringify({ schema: 'airi.model-scenario/v1', id: 'short', version: 1, description: 'Three turns.', prompt: { register: 'talking' }, startsAt: '2026-11-18T09:00', configs: { default: {} }, turns: ['hi', 'how are you?', 'what now?'] }))
  return { baseUrl, capture, scenario: join(dir, 'short.json') }
}

async function probe(args: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await runProbeCli(args, repoRoot, {}, {
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })
  return { code, stdout, stderr }
}

describe('qa:model probe', () => {
  it('times every cache event against the endpoint', async () => {
    // Two history replies, then a before and an after request for each of the seven cases.
    const { baseUrl, capture, scenario } = await setup(Array.from({ length: 16 }, () => ({ content: 'ok' })))

    const result = await probe(['cache-events', '--base-url', baseUrl, '--model', 'airi-replay', '--app-request', capture, '--scenario', scenario, '--rounds', '1', '--json'])

    expect(result.code).toBe(0)
    const { rows, notes } = JSON.parse(result.stdout)
    expect(rows.map((row: { name: string }) => row.name)).toHaveLength(7)
    expect(rows.every((row: { ttftMs: number[] }) => row.ttftMs.length === 1)).toBe(true)
    expect(notes).toEqual([])
  })

  it('finds what an overflowing request kept', async () => {
    const { baseUrl, capture } = await setup([
      { content: 'hi', usage: { prompt_tokens: 1000, completion_tokens: 5, total_tokens: 1000 } },
      { content: 'hi', usage: { prompt_tokens: 1600, completion_tokens: 5, total_tokens: 1600 } },
      { content: '<|ACT happy|> It is PLUMTREE!', usage: { prompt_tokens: 7990, completion_tokens: 5, total_tokens: 7990 } },
      { content: 'Hmm, I do not know your name.', usage: { prompt_tokens: 7990, completion_tokens: 5, total_tokens: 7990 } },
    ])

    const result = await probe(['overflow', '--base-url', baseUrl, '--model', 'airi-replay', '--app-request', capture, '--sizes', '8000', '--json'])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).rows).toEqual([expect.objectContaining({ targetTokens: 8000, padTurns: 117, promptTokens: 7990, systemKept: true, firstMessageKept: false, cueKept: true })])
  })

  it('refuses a probe without the capture it measures, and an unknown probe', async () => {
    const missing = await probe(['overflow', '--base-url', 'http://127.0.0.1:9/v1', '--model', 'm'])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('needs --app-request')
    await expect(runProbeCli(['warp', '--model', 'm'], repoRoot, {})).rejects.toThrow('unknown probe "warp"')
  })

  it('refuses cold-start against a server that is not Ollama', async () => {
    const { baseUrl, capture } = await setup([{ content: 'unused' }])

    const result = await probe(['cold-start', '--base-url', baseUrl, '--model', 'airi-replay', '--app-request', capture])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('needs an Ollama server')
  })
})
