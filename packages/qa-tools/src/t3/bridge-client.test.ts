import type { RendererEvaluator } from './bridge-client'

import { describe, expect, it } from 'vitest'

import { MotionQaBridgeClient, MotionQaBridgeError } from './bridge-client'

const state = { modelId: null, modelLoaded: false, driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: true, naturalActive: false, hold: null, captureActive: false, head: null, screen: { x: 0, y: 0, devicePixelRatio: 1 } }

function evaluatorFrom(replies: (() => unknown)[]) {
  const expressions: string[] = []
  const evaluator: RendererEvaluator = {
    evaluate: async <T>(expression: string) => {
      expressions.push(expression)
      const next = replies.shift()
      if (!next)
        throw new Error('no reply scripted')
      return next() as T
    },
  }
  return { evaluator, expressions }
}

function fakeClock() {
  let now = 0
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      now += ms
    },
    sleeps,
  }
}

describe('motionQaBridgeClient', () => {
  it('sends the command as one JSON string and returns the validated result', async () => {
    const { evaluator, expressions } = evaluatorFrom([() => JSON.stringify({ ok: true, result: { captureId: 'c1' } })])
    const client = new MotionQaBridgeClient(evaluator)

    await expect(client.call('startCapture', { durationSeconds: 5, label: 'run' }, 1_000)).resolves.toEqual({ captureId: 'c1' })
    expect(expressions[0]).toContain(JSON.stringify(JSON.stringify({ name: 'startCapture', input: { durationSeconds: 5, label: 'run' } })))
  })

  it('refuses to send a command outside the contract', async () => {
    const client = new MotionQaBridgeClient(evaluatorFrom([]).evaluator)
    await expect(client.call('startCapture', { durationSeconds: 601, label: 'run' }, 1_000)).rejects.toThrow(/Refusing to send an invalid startCapture command/)
  })

  it('turns ok: false and contract-breaking results into bridge errors', async () => {
    const { evaluator } = evaluatorFrom([
      () => JSON.stringify({ ok: false, error: 'A capture is already running' }),
      () => JSON.stringify({ ok: true, result: { captureId: '' } }),
    ])
    const client = new MotionQaBridgeClient(evaluator)
    await expect(client.call('startCapture', { durationSeconds: 5, label: 'run' }, 1_000)).rejects.toThrow('The bridge refused startCapture: A capture is already running')
    await expect(client.call('startCapture', { durationSeconds: 5, label: 'run' }, 1_000)).rejects.toThrow(/breaks the contract/)
  })

  it('waitForBridge retries with backoff while the bridge is not up, then returns the state', async () => {
    const clock = fakeClock()
    const { evaluator } = evaluatorFrom([
      () => { throw new Error('Execution context was destroyed') },
      () => JSON.stringify({ ok: false, error: '__airiMotionQa is not installed in this window' }),
      () => JSON.stringify({ ok: false, error: 'No stage in this window has registered the motion QA handlers yet' }),
      () => JSON.stringify({ ok: true, result: state }),
    ])
    const client = new MotionQaBridgeClient(evaluator)

    await expect(client.waitForBridge({ timeoutMs: 10_000, now: clock.now, sleep: clock.sleep })).resolves.toEqual(state)
    expect(clock.sleeps).toEqual([100, 200, 400])
  })

  it('waitForBridge times out with the last reason when the bridge never answers', async () => {
    const clock = fakeClock()
    const replies = Array.from({ length: 50 }, () => () => JSON.stringify({ ok: false, error: 'No stage in this window has registered the motion QA handlers yet' }))
    const client = new MotionQaBridgeClient(evaluatorFrom(replies).evaluator)

    const result = client.waitForBridge({ timeoutMs: 5_000, now: clock.now, sleep: clock.sleep })
    await expect(result).rejects.toThrow(MotionQaBridgeError)
    await expect(client.waitForBridge({ timeoutMs: 5_000, now: clock.now, sleep: clock.sleep })).rejects.toThrow(/did not answer within 5000ms .*No stage in this window/)
  })

  it('waitForBridge fails at once on a real refusal', async () => {
    const clock = fakeClock()
    const client = new MotionQaBridgeClient(evaluatorFrom([() => JSON.stringify({ ok: true, result: { ...state, driver: 3 } })]).evaluator)
    await expect(client.waitForBridge({ timeoutMs: 5_000, now: clock.now, sleep: clock.sleep })).rejects.toThrow(/breaks the contract/)
    expect(clock.sleeps).toEqual([])
  })

  it('start returns the renderer start time and settle reads the pending reply', async () => {
    const { evaluator, expressions } = evaluatorFrom([
      () => 1234.5,
      () => JSON.stringify({ ok: true, result: { dispatched: 2, rejected: [] } }),
    ])
    const client = new MotionQaBridgeClient(evaluator)
    const scenario = { version: 1 as const, id: 's', seed: 1, durationSeconds: 5, levels: ['t3' as const], events: [] }

    const started = await client.start('runScenario', { scenario }, 1_000)
    expect(started.rendererStartMs).toBe(1234.5)
    await expect(started.settle(1_000)).resolves.toEqual({ dispatched: 2, rejected: [] })
    expect(expressions[1]).toContain('__airiMotionQaPending')
  })
})
