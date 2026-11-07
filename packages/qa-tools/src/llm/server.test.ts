import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { streamText } from '@xsai/stream-text'
import { afterEach, describe, expect, it } from 'vitest'

import { parseServeArgs } from './cli'
import { loadScript, parseScript, ReplayScript } from './script'
import { ReplayServer } from './server'

const resources: { server: ReplayServer, dir: string }[] = []

async function start(entries: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'qa-llm-'))
  const log = join(dir, 'requests.jsonl')
  const script = new ReplayScript(parseScript(JSON.stringify(entries), 'test.json'), 'test.json')
  const server = new ReplayServer({ script, log, chunkChars: 2 })
  resources.push({ server, dir })
  const baseURL = await server.listen()
  return { baseURL, log }
}

afterEach(async () => {
  for (const { server, dir } of resources.splice(0)) {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

describe('replay HTTP server', () => {
  it('streams ACT text and executes a tool through AIRI xsai, then answers the tool result', async () => {
    const text = '<|ACT {"emotion":"happy"}|>Stopping now.'
    const { baseURL, log } = await start([
      { content: text, toolCalls: [{ name: 'perform_action', arguments: { action: 'stop' } }], usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } },
      { content: 'Done.' },
    ])
    const executed: unknown[] = []
    const result = streamText({
      baseURL,
      apiKey: 'replay',
      model: 'airi-replay',
      messages: [{ role: 'system', content: 'QA system prompt' }, { role: 'user', content: [{ type: 'text', text: 'stop' }] }],
      tools: [{
        type: 'function',
        function: { name: 'perform_action', parameters: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
        execute: (input) => {
          executed.push(input)
          return 'stopped'
        },
      }],
      streamOptions: { includeUsage: true },
      stopWhen: ({ step }) => step.toolCalls.length === 0,
      abortSignal: AbortSignal.timeout(5000),
    })
    let received = ''
    for await (const delta of result.textStream)
      received += delta
    const steps = await result.steps
    expect(received).toBe(`${text}Done.`)
    expect(executed).toEqual([{ action: 'stop' }])
    expect(steps.map(step => step.finishReason)).toEqual(['tool_calls', 'stop'])
    expect(steps[0].toolCalls).toMatchObject([{ toolName: 'perform_action', args: '{"action":"stop"}' }])
    expect(await result.totalUsage).toMatchObject({ inputTokens: 10, outputTokens: 6, totalTokens: 16 })
    const rows = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rows.map(row => [row.method, row.path, row.selectedEntryIndex, row.status])).toEqual([
      ['POST', '/v1/chat/completions', 0, 200],
      ['POST', '/v1/chat/completions', 1, 200],
    ])
    expect(rows[0].body).toMatchObject({
      messages: [{ role: 'system', content: 'QA system prompt' }, { role: 'user', content: [{ type: 'text', text: 'stop' }] }],
      tools: [{ type: 'function', function: { name: 'perform_action' } }],
    })
    expect(rows[1].body.messages.at(-1)).toMatchObject({ role: 'tool', content: 'stopped', tool_call_id: 'call_0_0' })
    expect(rows.every(row => Number.isFinite(Date.parse(row.timestamp)))).toBe(true)
  })

  it('returns JSON completions, models, WAV speech and logged client errors without consuming invalid requests', async () => {
    const { baseURL, log } = await start([{ content: 'one' }])
    const post = (path: string, body: string) => fetch(`${baseURL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    const models = await fetch(`${baseURL}models`)
    expect(await models.json()).toMatchObject({ data: [{ id: 'airi-replay' }, { id: 'airi-replay-tts' }] })
    const speech = await post('audio/speech', JSON.stringify({ model: 'airi-replay-tts', voice: 'alloy', input: 'a'.repeat(40), response_format: 'mp3', speed: 1 }))
    expect(speech.headers.get('content-type')).toBe('audio/wav')
    expect(Buffer.from(await speech.arrayBuffer()).readUInt32LE(40)).toBe(96000)
    const malformed = await post('chat/completions', '{broken')
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { message: expect.stringContaining('Malformed JSON') } })
    const invalid = await post('chat/completions', '{"messages":"bad"}')
    expect(invalid.status).toBe(400)
    const normal = await post('chat/completions', '{"model":"airi-replay","messages":[{"role":"user","content":"hello"}]}')
    expect(await normal.json()).toMatchObject({ choices: [{ message: { content: 'one' }, finish_reason: 'stop' }] })
    const exhausted = await post('chat/completions', '{"model":"airi-replay","messages":[{"role":"user","content":"again"}],"stream":true}')
    expect(exhausted.status).toBe(409)
    expect(await exhausted.json()).toMatchObject({ error: { message: 'test.json: exhausted at index 1' } })
    expect((await fetch(`${baseURL}unknown`)).status).toBe(404)
    const preflight = await fetch(`${baseURL}chat/completions`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    const rows = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rows.map(row => row.status)).toEqual([200, 200, 400, 400, 200, 409, 404, 204])
    expect(rows.map(row => row.selectedEntryIndex)).toEqual([null, null, null, null, 0, null, null, null])
  })
})

describe('serve configuration', () => {
  it.each([
    [],
    ['other'],
    ['serve', 'extra'],
    ['serve', '--unknown'],
    ['serve', '--port', '-1'],
    ['serve', '--chunk-chars', '0'],
    ['serve', '--delay-ms', 'NaN'],
    ['serve', '--host', ''],
    ['serve', '--script', 'a.json', '--set', 'a'],
    ['serve', '--run-key', 'a'],
  ].map(args => ({ args })))('rejects invalid arguments $args', ({ args }) => {
    expect(() => parseServeArgs(args)).toThrow()
  })

  it('loads transcript reply text in file order for an exact run key', async () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const script = await loadScript({ set: 'legacy-2026-10-27-mac-m2', runKey: 'dolphin3:8b/bench' }, repoRoot)
    const source = (await readFile(join(repoRoot, 'packages/qa-tools/model-eval/sets/legacy-2026-10-27-mac-m2/transcripts.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
      .filter(row => row.runKey === 'dolphin3:8b/bench')
    expect(script.entries.map(entry => entry.content)).toEqual(source.map(row => row.reply.text))
    expect(script.entries).toHaveLength(10)
    await expect(loadScript({ set: 'legacy-2026-10-27-mac-m2', runKey: 'absent' }, repoRoot)).rejects.toThrow('no transcripts')
    await expect(loadScript({ set: '../escape' }, repoRoot)).rejects.toThrow('Set id')
  })
})
