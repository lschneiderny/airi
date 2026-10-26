import { defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it, onTestFinished } from 'vitest'

import { buildEmotionTrial, claimMotionQaHandlers, createMotionQaContext, createMotionQaDispatcher, motionQaRunScenarioInvokeEventa, motionQaStateInvokeEventa } from '.'

const state = { modelId: 'm', modelLoaded: true, driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: true, naturalActive: true, hold: null, captureActive: false, head: null, screen: { x: 0, y: 0, devicePixelRatio: 1 }, screenAwareness: true, placement: null, placementYawBias: 0, chat: null }

function claim() {
  const release = claimMotionQaHandlers()
  if (!release)
    throw new Error('the handler claim must be free between tests')
  onTestFinished(release)
}

async function dispatch(command: unknown) {
  return JSON.parse(await createMotionQaDispatcher()(typeof command === 'string' ? command : JSON.stringify(command)))
}

describe('createMotionQaDispatcher', () => {
  it('answers a command through the registered handler', async () => {
    claim()
    onTestFinished(defineInvokeHandler(createMotionQaContext(), motionQaStateInvokeEventa, () => state))
    expect(await dispatch({ name: 'state' })).toEqual({ ok: true, result: state })
  })

  it('rejects text that is not JSON', async () => {
    const reply = await dispatch('{"name":')
    expect(reply.ok).toBe(false)
    expect(reply.issues).toBeUndefined()
  })

  it('rejects an unknown command and reports the issue path', async () => {
    const reply = await dispatch({ name: 'reboot' })
    expect(reply.ok).toBe(false)
    expect(reply.issues.map((issue: { path: string }) => issue.path)).toEqual(['name'])
  })

  it('rejects a t3 scenario with speech at the event before any handler runs', async () => {
    const scenario = { ...buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }), levels: ['t3'] }
    const events = [{ kind: 'speech', at: 1, turnId: 't', seconds: 1, envelopeSeed: 1 }]
    const reply = await dispatch({ name: 'runScenario', input: { scenario: { ...scenario, events } } })
    expect(reply.ok).toBe(false)
    expect(reply.issues.map((issue: { path: string }) => issue.path)).toEqual(['input.scenario.events.0.kind'])
  })

  it('answers at once when no stage registered the handlers', async () => {
    expect(await dispatch({ name: 'state' })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('turns a handler error into a reply', async () => {
    claim()
    onTestFinished(defineInvokeHandler(createMotionQaContext(), motionQaRunScenarioInvokeEventa, () => {
      throw new Error('a scenario is already running')
    }))
    const scenario = { ...buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }), levels: ['t3'] }
    expect(await dispatch({ name: 'runScenario', input: { scenario } })).toEqual({ ok: false, error: 'a scenario is already running' })
  })

  it('rejects a handler result outside the contract', async () => {
    claim()
    // The same contract id with a loose result type: a handler that the typed contract would not let compile.
    const looseState = defineInvokeEventa<Record<string, unknown>>('eventa:invoke:motion-qa:state')
    onTestFinished(defineInvokeHandler(createMotionQaContext(), looseState, () => ({ ...state, driver: 1 })))
    const reply = await dispatch({ name: 'state' })
    expect(reply.ok).toBe(false)
    expect(reply.issues.map((issue: { path: string }) => issue.path)).toEqual(['driver'])
  })
})
