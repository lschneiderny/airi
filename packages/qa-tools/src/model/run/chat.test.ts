import type { Server, ServerResponse } from 'node:http'

import { once } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { buildChatRequest, requestChat } from './chat'

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

/** A loopback endpoint whose answer the test writes, and the request it received. */
async function endpoint(answer: (response: ServerResponse) => void) {
  const received: { path: string, headers: Record<string, unknown>, body: string }[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      received.push({ path: request.url ?? '', headers: request.headers, body })
      answer(response)
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('expected a TCP address')
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, received }
}

function sse(response: ServerResponse, events: unknown[], done = true) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const event of events)
    response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.end(done ? 'data: [DONE]\n\n' : '')
}

describe('buildChatRequest', () => {
  it('sends the config keys unchanged, streams with usage, and omits what the config omits', () => {
    const messages = [{ role: 'system' as const, content: 'S' }, { role: 'user' as const, content: 'U' }]

    expect(buildChatRequest('qwen3:8b', messages, { temperature: 0.6, top_p: 0.9, max_tokens: 320, seed: 7, reasoning_effort: 'none' })).toEqual({
      model: 'qwen3:8b',
      messages,
      temperature: 0.6,
      top_p: 0.9,
      max_tokens: 320,
      seed: 7,
      reasoning_effort: 'none',
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(Object.keys(buildChatRequest('m', messages, {}))).toEqual(['model', 'messages', 'stream', 'stream_options'])
  })

  it('copies the messages, so a later turn does not change a built request', () => {
    const messages = [{ role: 'user' as const, content: 'first' }]
    const request = buildChatRequest('m', messages, {})
    messages.push({ role: 'user', content: 'second' })

    expect(request.messages).toHaveLength(1)
  })
})

describe('requestChat', () => {
  it('posts the body bytes to chat/completions without credentials and collects what the endpoint reports', async () => {
    const { baseUrl, received } = await endpoint(response => sse(response, [
      { id: 'cmpl-1', model: 'qwen3:8b-q4', system_fingerprint: 'fp_ollama', choices: [{ delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      { id: 'cmpl-1', model: 'qwen3:8b-q4', choices: [{ delta: { reasoning: 'She greets me. ' }, finish_reason: null }] },
      { choices: [{ delta: { reasoning_content: 'Be warm.' }, finish_reason: null }] },
      { choices: [{ delta: { content: '<|ACT hap' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'py|>Hi!' }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'perform_action', arguments: '{"act' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ion":"stop"}' } }, { index: 1, function: { name: 'broken', arguments: '{' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 1500, completion_tokens: 9, total_tokens: 1509 } },
    ]))
    const body = JSON.stringify(buildChatRequest('qwen3:8b', [{ role: 'user', content: 'hey' }], { max_tokens: 320 }))

    const outcome = await requestChat(`${baseUrl}/`, body, 5000)

    expect(received).toHaveLength(1)
    expect(received[0].path).toBe('/v1/chat/completions')
    expect(received[0].body).toBe(body)
    expect(received[0].headers.authorization).toBeUndefined()
    expect(outcome).toMatchObject({
      status: 200,
      id: 'cmpl-1',
      model: 'qwen3:8b-q4',
      systemFingerprint: 'fp_ollama',
      text: '<|ACT happy|>Hi!',
      thinkingText: 'She greets me. Be warm.',
      toolCalls: [{ name: 'perform_action', arguments: { action: 'stop' } }, { name: 'broken', arguments: '{' }],
      finish: 'tool_calls',
      usage: { prompt_tokens: 1500, completion_tokens: 9, total_tokens: 1509 },
      error: null,
    })
    expect(outcome.ttftMs).toBeGreaterThanOrEqual(0)
    expect(outcome.totalMs).toBeGreaterThanOrEqual(outcome.ttftMs ?? Number.NaN)
  })

  it('keeps null for an id, model, fingerprint, and usage that the endpoint does not report', async () => {
    const { baseUrl } = await endpoint(response => sse(response, [
      { choices: [{ delta: { content: 'ok' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]))

    expect(await requestChat(baseUrl, '{}', 5000)).toMatchObject({ status: 200, id: null, model: null, systemFingerprint: null, usage: null, text: 'ok', finish: 'stop', error: null })
  })

  it('reports an HTTP error with the message of its JSON body, or the raw text', async () => {
    const json = await endpoint((response) => {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'model "absent" not found', type: 'not_found_error' } }))
    })
    const text = await endpoint((response) => {
      response.writeHead(502)
      response.end('Bad Gateway')
    })

    expect(await requestChat(json.baseUrl, '{}', 5000)).toMatchObject({ status: 404, error: 'HTTP 404: model "absent" not found', text: '', finish: null, model: null, ttftMs: null })
    expect(await requestChat(text.baseUrl, '{}', 5000)).toMatchObject({ status: 502, error: 'HTTP 502: Bad Gateway' })
  })

  it('reports a refused connection with no status', async () => {
    const { baseUrl } = await endpoint(response => response.end())
    const server = servers.pop()!
    await new Promise(resolve => server.close(resolve))

    const outcome = await requestChat(baseUrl, '{}', 5000)

    expect(outcome.status).toBeNull()
    expect(outcome.error).toContain('ECONNREFUSED')
  })

  it('keeps the partial text of a stream that ends without a finish reason, sends an error event, or is malformed', async () => {
    const cut = await endpoint(response => sse(response, [{ model: 'm', choices: [{ delta: { content: 'Hel' }, finish_reason: null }] }], false))
    const failed = await endpoint(response => sse(response, [
      { choices: [{ delta: { content: 'Hel' }, finish_reason: null }] },
      { error: { message: 'out of memory' } },
    ]))
    const malformed = await endpoint((response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\ndata: {broken\n\n')
    })

    expect(await requestChat(cut.baseUrl, '{}', 5000)).toMatchObject({ status: 200, model: 'm', text: 'Hel', finish: null, error: 'the stream ended without a finish reason' })
    expect(await requestChat(failed.baseUrl, '{}', 5000)).toMatchObject({ text: 'Hel', error: 'out of memory' })
    const outcome = await requestChat(malformed.baseUrl, '{}', 5000)
    expect(outcome.text).toBe('Hel')
    expect(outcome.error).toMatch(/JSON/)
  })
})
