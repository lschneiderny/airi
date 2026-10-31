import type { BodyToolPort, BodyToolResult } from './body'

import { describe, expect, it, vi } from 'vitest'

import { createBodyTools } from './body'

function execute(entry: { execute?: unknown } | undefined, input: unknown) {
  if (!entry?.execute)
    throw new Error('Expected the tool to define an execute function.')
  return (entry.execute as (value: unknown, options: unknown) => Promise<string>)(input, { messages: [], toolCallId: 'call-1' })
}

const state = { position: 'home' as const, moving: false, refractorySeconds: 0 }

function createPort(result: BodyToolResult = { success: true, state }) {
  return {
    state: vi.fn(() => state),
    comeHere: vi.fn(async () => result),
    goHome: vi.fn(async () => result),
    lookAt: vi.fn(async () => result),
  } satisfies BodyToolPort
}

async function toolsOf(port: BodyToolPort) {
  const tools = await createBodyTools(port)
  return { tools, byName: (name: string) => tools.find(item => item.function.name === name) }
}

describe('createBodyTools', () => {
  it('offers exactly come_here, go_home and look_at, with strict parameters', async () => {
    const { tools } = await toolsOf(createPort())

    expect(tools.map(item => item.function.name)).toEqual(['come_here', 'go_home', 'look_at'])
    for (const item of tools)
      expect(item.function.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    expect(tools.find(item => item.function.name === 'look_at')?.function.parameters).toMatchObject({
      required: ['target'],
      properties: { target: { enum: ['camera', 'cursor', 'chat', 'away'] } },
    })
  })

  it('forwards each tool to its port call and returns the port result as JSON', async () => {
    const port = createPort()
    const { byName } = await toolsOf(port)

    expect(JSON.parse(await execute(byName('come_here'), {}))).toEqual({ success: true, state })
    expect(JSON.parse(await execute(byName('go_home'), {}))).toEqual({ success: true, state })
    expect(JSON.parse(await execute(byName('look_at'), { target: 'cursor' }))).toEqual({ success: true, state })

    expect(port.comeHere).toHaveBeenCalledTimes(1)
    expect(port.goHome).toHaveBeenCalledTimes(1)
    expect(port.lookAt).toHaveBeenCalledExactlyOnceWith('cursor')
  })

  it('passes a refusal with its retry delay through unchanged', async () => {
    const refusal: BodyToolResult = { success: false, error: 'The character is not ready for that yet.', retryAfterSeconds: 42 }
    const { byName } = await toolsOf(createPort(refusal))

    expect(JSON.parse(await execute(byName('come_here'), {}))).toEqual(refusal)
  })

  it('rejects an unknown or missing look target and extra keys without calling the port', async () => {
    const port = createPort()
    const { byName } = await toolsOf(port)

    for (const input of [{ target: 'moon' }, {}, { target: 'chat', extra: 1 }]) {
      const answer = JSON.parse(await execute(byName('look_at'), input)) as BodyToolResult
      expect(answer.success).toBe(false)
      expect(answer.error).toEqual(expect.any(String))
    }
    expect(port.lookAt).not.toHaveBeenCalled()
  })
})
