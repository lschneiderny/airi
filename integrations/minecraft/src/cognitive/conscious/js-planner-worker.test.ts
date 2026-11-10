import type { SandboxWorkerRequest } from './js-planner-sandbox-protocol'

import { spawnSync } from 'node:child_process'
import { once } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { executeSandboxWorker } from './js-planner-sandbox-runner'
import { bounded, trackSandboxWorkers } from './js-planner-worker-test-support'

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, fork: vi.fn(original.fork) }
})

const workers = trackSandboxWorkers()
const yieldToParent = `await __plannerBridge.apply(undefined, ['resume', []], { arguments: { copy: true }, result: { promise: true, copy: true } });`

function request(script: string, timeoutMs: number): SandboxWorkerRequest {
  return {
    bootstrapScript: `globalThis.started = () => __plannerBridge.applyIgnored(undefined, ['started', []], { arguments: { copy: true } })`,
    script,
    timeoutMs,
    memoryLimitMb: 32,
    toolNames: [],
    bridgeAvailability: {
      botCall: false,
      forgetConversation: false,
      getNoActionBudget: false,
      notifyAiri: false,
      patternFind: false,
      patternGet: false,
      patternIds: false,
      patternList: false,
      queryBlockAt: false,
      queryMap: false,
      setNoActionBudget: false,
      updateAiriContext: false,
    },
    runtime: {
      actionQueue: null,
      currentInput: null,
      errorBurstGuard: null,
      event: { type: 'system_alert', payload: {}, source: { type: 'system', id: 'test' }, timestamp: 0 },
      historySeed: { conversationHistory: [], currentTurn: 0, llmLogEntries: [] },
      lastAction: null,
      llmInput: null,
      llmLogEntries: [],
      mem: {},
      noActionBudget: null,
      prevRun: null,
      querySeed: null,
      snapshot: {},
    },
  }
}

describe('planner worker lifecycle', () => {
  it('exits if IPC is already gone during startup', async () => {
    vi.useFakeTimers()
    const outcome = executeSandboxWorker(request('return 42', 100), {
      bridgeTimeoutMs: 100,
      maxBridgeCalls: 1,
      onBridgeRequest: async () => undefined,
    }).catch((error: unknown) => error)
    const [child] = workers()
    if (!child)
      throw new Error('Runner did not fork a worker')
    const exited = once(child, 'exit')

    child.disconnect()

    const exit = await bounded(exited, 2_000)
    const result = await bounded(outcome)
    expect(exit, String(result)).toEqual([0, null])
    expect(result).toBeInstanceOf(Error)
  })

  it.each([
    ['synchronous', 'started(); while (true) {}'],
    ['post-await', `${yieldToParent} started(); while (true) {}`],
  ])('exits when IPC disconnects during a %s loop', async (_, script) => {
    // Freeze only the parent timers: neither its SIGKILL nor a bridge timeout can rescue the worker.
    vi.useFakeTimers()
    const started = Promise.withResolvers<void>()
    const outcome = executeSandboxWorker(request(script, 30_000), {
      bridgeTimeoutMs: 30_000,
      maxBridgeCalls: 2,
      onBridgeRequest: async (method) => {
        if (method === 'started')
          started.resolve()
      },
    }).catch((error: unknown) => error)
    const [child] = workers()
    expect(child).toBeDefined()
    if (!child)
      throw new Error('Runner did not fork a worker')
    const exited = once(child, 'exit')

    await bounded(started.promise)
    child.disconnect()

    expect(await bounded(exited, 2_000)).toEqual([0, null])
    expect(await bounded(outcome)).toBeInstanceOf(Error)
  })

  it('stops a post-await loop with its own deadline while the parent timer is frozen', async () => {
    vi.useFakeTimers()
    const outcome = executeSandboxWorker(request(`${yieldToParent} while (true) {}`, 100), {
      bridgeTimeoutMs: 100,
      maxBridgeCalls: 1,
      onBridgeRequest: async () => undefined,
    }).catch((error: unknown) => error)
    const [child] = workers()
    expect(child).toBeDefined()
    if (!child)
      throw new Error('Runner did not fork a worker')

    const [code, signal] = await bounded(once(child, 'exit'), 5_000)

    expect(signal).toBeNull()
    expect(code).toBe(124)
    expect(await bounded(outcome)).toMatchObject({ message: 'Sandbox worker timed out after 2100ms' })
  }, 15_000)

  it('settles a successful result only after the worker is gone', async () => {
    const result = executeSandboxWorker(request('mem.answer = 42; return mem.answer', 100), {
      bridgeTimeoutMs: 100,
      maxBridgeCalls: 1,
      onBridgeRequest: async () => undefined,
    })
    const [child] = workers()

    expect(await bounded(result)).toMatchObject({ returnRaw: 42, mem: { answer: 42 } })
    expect(child?.pid).toBeTypeOf('number')
    expect(spawnSync('kill', ['-0', String(child?.pid)]).status).toBe(1)
  })

  it('rejects malformed script input and still reaps the worker', async () => {
    await expect(executeSandboxWorker(request('while (', 100), {
      bridgeTimeoutMs: 100,
      maxBridgeCalls: 1,
      onBridgeRequest: async () => undefined,
    })).rejects.toThrow(/Unexpected token/)
  })

  it('accepts a fresh evaluation after repeated disconnects with late bridge replies', async () => {
    vi.useFakeTimers()
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Promise.withResolvers<void>()
      const reply = Promise.withResolvers<void>()
      const outcome = executeSandboxWorker(request(yieldToParent, 30_000), {
        bridgeTimeoutMs: 30_000,
        maxBridgeCalls: 1,
        onBridgeRequest: async () => {
          started.resolve()
          await reply.promise
        },
      }).catch((error: unknown) => error)
      const child = workers().at(-1)
      if (!child)
        throw new Error('Runner did not fork a worker')
      const exited = once(child, 'exit')

      try {
        await bounded(started.promise)
        child.disconnect()
        expect(await bounded(exited, 2_000)).toEqual([0, null])
        expect(await bounded(outcome)).toBeInstanceOf(Error)
      }
      finally {
        reply.resolve()
      }
    }

    await expect(bounded(executeSandboxWorker(request('return 42', 100), {
      bridgeTimeoutMs: 100,
      maxBridgeCalls: 1,
      onBridgeRequest: async () => undefined,
    }))).resolves.toMatchObject({ returnRaw: 42 })
  }, 15_000)
})
