import type { ActionToolPort, ActionToolResult, ExposedToolAction } from './action'

import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { useLlmToolsStore } from '../stores/ai/chat-llm/tools'
import { actionToolIds, createActionToolRegistration, createActionTools } from './action'

function execute(entry: { execute?: unknown } | undefined, input: unknown) {
  if (!entry?.execute)
    throw new Error('Expected the tool to define an execute function.')
  return (entry.execute as (value: unknown, options: unknown) => Promise<string>)(input, { messages: [], toolCallId: 'call-1' })
}

const idle = { performing: null }

function createPort(exposed: ExposedToolAction[], result: ActionToolResult = { success: true, state: idle }) {
  return {
    exposed: vi.fn(() => exposed),
    perform: vi.fn(async (_label: string | null) => result),
    state: vi.fn(() => idle),
  } satisfies ActionToolPort
}

function enumOf(tool: { function: { parameters?: unknown } } | undefined) {
  return (tool?.function.parameters as { properties: { action: { enum: string[] } } } | undefined)?.properties.action.enum
}

describe('createActionTools', () => {
  it('offers one perform_action tool whose enum is the exposed labels plus stop', async () => {
    const [tool, ...rest] = await createActionTools(createPort([{ label: 'moonwalk', kind: 'dance' }, { label: 'bow', kind: 'action' }]))

    expect(rest).toEqual([])
    expect(tool.function.name).toBe('perform_action')
    expect(tool.function.parameters).toMatchObject({ type: 'object', additionalProperties: false, required: ['action'] })
    expect(enumOf(tool)).toEqual(['moonwalk', 'bow', 'stop'])
  })

  it('throws when nothing is exposed', async () => {
    await expect(createActionTools(createPort([]))).rejects.toThrow('at least one exposed action')
  })

  it('performs the label, stops with null, and passes a refusal with its retry delay through unchanged', async () => {
    const refusal: ActionToolResult = { success: false, state: idle, error: 'She can do that again in 42 s.', retryAfterSeconds: 42 }
    const port = createPort([{ label: 'moonwalk', kind: 'dance' }], refusal)
    const [tool] = await createActionTools(port)

    expect(JSON.parse(await execute(tool, { action: 'moonwalk' }))).toEqual(refusal)
    await execute(tool, { action: 'stop' })

    expect(port.perform.mock.calls).toEqual([['moonwalk'], [null]])
  })

  it('rejects an unknown, wrongly cased or missing label with the available labels, without calling the port', async () => {
    const port = createPort([{ label: 'moonwalk', kind: 'dance' }])
    const [tool] = await createActionTools(port)

    for (const input of [{ action: 'cartwheel' }, { action: 'STOP' }, {}, { action: 'moonwalk', extra: 1 }]) {
      const answer = JSON.parse(await execute(tool, input)) as ActionToolResult
      expect(answer.success, JSON.stringify(input)).toBe(false)
      expect(answer.error, JSON.stringify(input)).toEqual(expect.any(String))
      expect(answer.available, JSON.stringify(input)).toEqual(['moonwalk'])
    }
    expect(port.perform).not.toHaveBeenCalled()
  })

  it('keeps stop reserved when a clip is labeled stop', async () => {
    const [tool] = await createActionTools(createPort([{ label: 'stop', kind: 'action' }, { label: 'bow', kind: 'action' }]))

    expect(enumOf(tool)).toEqual(['bow', 'stop'])
  })
})

describe('createActionToolRegistration', () => {
  it('registers perform_action by id, follows a changed exposed set, and removes it when the set empties or the port goes', async () => {
    setActivePinia(createPinia())
    const tools = useLlmToolsStore()
    const registration = createActionToolRegistration(tools)
    let exposed: ExposedToolAction[] = [{ label: 'moonwalk', kind: 'dance' }]
    const port = { ...createPort([]), exposed: () => exposed }
    const key = () => JSON.stringify(exposed)

    await registration.sync(port, key())
    expect(tools.tools.map(tool => tool.id)).toEqual([...actionToolIds])
    expect(tools.activeTools.map(tool => tool.function.name)).toEqual(['perform_action'])
    expect(enumOf(tools.tools[0])).toEqual(['moonwalk', 'stop'])

    exposed = [...exposed, { label: 'bow', kind: 'action' }]
    await registration.sync(port, key())
    expect(tools.tools.map(tool => tool.id)).toEqual([...actionToolIds])
    expect(enumOf(tools.tools[0])).toEqual(['moonwalk', 'bow', 'stop'])

    exposed = []
    await registration.sync(port, key())
    expect(tools.tools).toEqual([])

    // Re-exposing after a removal registers the new set, not the schema registered before it.
    exposed = [{ label: 'bow', kind: 'action' }]
    await registration.sync(port, key())
    expect(enumOf(tools.tools[0])).toEqual(['bow', 'stop'])

    await registration.sync(undefined, key())
    expect(tools.tools).toEqual([])

    // A build that a newer, port-less sync overtakes must not register stale tools.
    const overtaken = registration.sync(port, key())
    await registration.sync(undefined, key())
    await overtaken
    expect(tools.tools).toEqual([])

    await registration.sync(port, key())
    registration.dispose()
    await registration.sync(port, key())
    expect(tools.tools).toEqual([])
  })
})
