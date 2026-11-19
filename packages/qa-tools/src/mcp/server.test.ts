import type { QaSession } from './server'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

import { createAiriQaServer } from './server'
import { AppSession } from './session'

function fakeSession(overrides: Partial<QaSession> = {}): QaSession {
  const notRunning = async () => {
    throw new Error('No app is running. Call airi_start first.')
  }
  return {
    start: vi.fn(async () => ({ runDir: '/run' })),
    state: notRunning,
    send: vi.fn(async () => ({ ok: true })),
    events: notRunning,
    evaluateVoice: notRunning,
    importModel: notRunning,
    screenshot: async () => ({ path: '/run/stage-001.png', png: 'iVBORw0KGgo=' }),
    errors: () => ({ page: [] }),
    evaluate: async () => undefined,
    stop: async () => ({ stopped: false as const }),
    ...overrides,
  }
}

async function connect(session: QaSession) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createAiriQaServer(session, '0.0.0').connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  return client
}

describe('airi-qa MCP server', () => {
  it('registers the session verbs', async () => {
    const client = await connect(fakeSession())
    const names = (await client.listTools()).tools.map(tool => tool.name)
    expect(names).toEqual(['airi_start', 'airi_state', 'airi_send', 'airi_events', 'airi_evaluate_voice', 'airi_import_model', 'airi_screenshot', 'airi_errors', 'airi_eval', 'airi_stop'])
  })

  it('returns a session error as a tool error with its message', async () => {
    const client = await connect(fakeSession())
    const result = await client.callTool({ name: 'airi_state', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'No app is running. Call airi_start first.' }])
  })

  it('applies send defaults and converts the timeout to milliseconds', async () => {
    const session = fakeSession()
    const client = await connect(session)
    await client.callTool({ name: 'airi_send', arguments: { text: 'hi' } })
    await client.callTool({ name: 'airi_send', arguments: { text: 'yo', reply: 'Hey', expect: ['act'], timeoutSeconds: 5 } })
    expect(session.send).toHaveBeenNthCalledWith(1, 'hi', { reply: undefined, expect: [], timeoutMs: 60_000 })
    expect(session.send).toHaveBeenNthCalledWith(2, 'yo', { reply: 'Hey', expect: ['act'], timeoutMs: 5_000 })
  })

  it('hands the stage host to the session and refuses one that is not a host', async () => {
    const session = fakeSession()
    const client = await connect(session)
    await client.callTool({ name: 'airi_start', arguments: { model: '/models/body.pmx', stageHost: 'desktop' } })
    expect(session.start).toHaveBeenCalledExactlyOnceWith({ model: '/models/body.pmx', stageHost: 'desktop' })
    const result = await client.callTool({ name: 'airi_start', arguments: { stageHost: 'stage' } })
    expect(result.isError).toBe(true)
    expect(session.start).toHaveBeenCalledOnce()
  })

  it('accepts a mind step as an expected event kind', async () => {
    const session = fakeSession()
    const client = await connect(session)
    await client.callTool({ name: 'airi_send', arguments: { text: 'hi', expect: ['mind'] } })
    expect(session.send).toHaveBeenCalledExactlyOnceWith('hi', { reply: undefined, expect: ['mind'], timeoutMs: 60_000 })
  })

  it('returns screenshots as an image plus the saved path, and undefined eval results as null', async () => {
    const client = await connect(fakeSession())
    expect((await client.callTool({ name: 'airi_screenshot', arguments: {} })).content).toEqual([
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      { type: 'text', text: '/run/stage-001.png' },
    ])
    expect((await client.callTool({ name: 'airi_eval', arguments: { expression: 'void 0' } })).content).toEqual([{ type: 'text', text: 'null' }])
  })

  it('rejects an unknown expected event kind before reaching the session', async () => {
    const session = fakeSession()
    const client = await connect(session)
    const result = await client.callTool({ name: 'airi_send', arguments: { text: 'hi', expect: ['dance'] } })
    expect(result.isError).toBe(true)
    expect(session.send).not.toHaveBeenCalled()
  })
})

describe('airi-qa app session', () => {
  it.each([
    [{ stageHost: 'desktop' as const }],
    [{ stageHost: 'desktop' as const, model: '/models/character.zip' }],
    [{ stageHost: 'desktop' as const, model: '/models/body.pmx', kind: 'vrm' as const }],
  ])('refuses the desktop stage without an MMD model before it launches anything: %j', async (options) => {
    const session = new AppSession('/repo')
    await expect(session.start(options)).rejects.toThrow('stageHost desktop needs an MMD model')
    expect(session.running).toBe(false)
  })
})
