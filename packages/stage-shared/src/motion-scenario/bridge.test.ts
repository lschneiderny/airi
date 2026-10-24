import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { safeParse } from 'valibot'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'

import { buildEmotionTrial, claimMotionQaHandlers, createMotionQaContext, hasMotionQaHandlers, isMotionQaBridgeEnabled, MotionQaAwaitCaptureResultSchema, MotionQaCommandSchema, MotionQaConfigureInputSchema, MotionQaRunScenarioInputSchema, MotionQaRunScenarioResultSchema, MotionQaStartCaptureInputSchema, motionQaStateInvokeEventa, MotionQaStateSchema } from '.'

const state = { modelId: 'm', modelLoaded: true, driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: true, naturalActive: true, hold: { emotion: 'angry', strength: 0.9 }, captureActive: false, head: { x: 100, y: 50, width: 80, height: 90 }, screen: { x: -1200, y: 20, devicePixelRatio: 1.5 } } as const

describe('motion QA bridge schemas', () => {
  it('requires usable screen scale and positive head geometry, while accepting an unavailable head', () => {
    expect(safeParse(MotionQaStateSchema, { ...state, head: null }).success).toBe(true)
    expect(safeParse(MotionQaStateSchema, { ...state, head: { ...state.head, width: 0 } }).success).toBe(false)
    expect(safeParse(MotionQaStateSchema, { ...state, screen: { ...state.screen, devicePixelRatio: 0 } }).success).toBe(false)
    expect(safeParse(MotionQaStateSchema, { ...state, screen: { ...state.screen, x: Number.NaN } }).success).toBe(false)
  })

  it('round-trips each payload through JSON', () => {
    const scenario = buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 })
    const payloads = [
      [MotionQaStateSchema, state],
      [MotionQaConfigureInputSchema, { driver: 'natural', heldEmotions: false }],
      [MotionQaStartCaptureInputSchema, { durationSeconds: 30, extraParameterIds: ['Param60'], label: 'angry' }],
      [MotionQaRunScenarioInputSchema, { scenario }],
      [MotionQaRunScenarioResultSchema, { dispatched: 1, rejected: [{ at: 2, kind: 'speech', reason: 'unsupported' }] }],
      [MotionQaAwaitCaptureResultSchema, { trace: { version: 2, events: [] } }],
    ] as const
    for (const [schema, payload] of payloads) {
      const parsed = safeParse(schema, JSON.parse(JSON.stringify(payload)))
      expect(parsed.success).toBe(true)
      expect(parsed.output).toEqual(payload)
    }
  })

  it('rejects out-of-range captures, unknown fields and non-v2 traces', () => {
    expect(safeParse(MotionQaStartCaptureInputSchema, { durationSeconds: 0, label: 'x' }).success).toBe(false)
    expect(safeParse(MotionQaStartCaptureInputSchema, { durationSeconds: 601, label: 'x' }).success).toBe(false)
    expect(safeParse(MotionQaConfigureInputSchema, { driver: 'sdk' }).success).toBe(false)
    expect(safeParse(MotionQaConfigureInputSchema, { extra: true }).success).toBe(false)
    expect(safeParse(MotionQaAwaitCaptureResultSchema, { trace: { version: 1 } }).success).toBe(false)
  })

  it('parses dispatcher commands by name and rejects unknown ones', () => {
    expect(safeParse(MotionQaCommandSchema, { name: 'state' }).success).toBe(true)
    expect(safeParse(MotionQaCommandSchema, { name: 'configure', input: { cursorAttention: true } }).success).toBe(true)
    expect(safeParse(MotionQaCommandSchema, { name: 'configure' }).success).toBe(false)
    expect(safeParse(MotionQaCommandSchema, { name: 'reboot' }).success).toBe(false)
  })
})

describe('motion QA bridge context', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__airiMotionQaEnabled')
  })

  it('reuses one window-local context that delivers invocations', async () => {
    expect(createMotionQaContext()).toBe(createMotionQaContext())
    onTestFinished(defineInvokeHandler(createMotionQaContext(), motionQaStateInvokeEventa, () => state))
    expect(await defineInvoke(createMotionQaContext(), motionQaStateInvokeEventa)()).toEqual(state)
  })

  it('grants the handler claim to one owner at a time', () => {
    const release = claimMotionQaHandlers()
    onTestFinished(() => release?.())
    expect(release).toBeTypeOf('function')
    expect(hasMotionQaHandlers()).toBe(true)
    expect(claimMotionQaHandlers()).toBeNull()
    release?.()
    expect(hasMotionQaHandlers()).toBe(false)
    const next = claimMotionQaHandlers()
    onTestFinished(() => next?.())
    // A stale release must not free the claim of the next owner.
    release?.()
    expect(hasMotionQaHandlers()).toBe(true)
  })

  it('reports the bridge enabled only for the exact flag value', () => {
    expect(isMotionQaBridgeEnabled()).toBe(false)
    Object.assign(globalThis, { __airiMotionQaEnabled: 'true' })
    expect(isMotionQaBridgeEnabled()).toBe(false)
    Object.assign(globalThis, { __airiMotionQaEnabled: true })
    expect(isMotionQaBridgeEnabled()).toBe(true)
  })
})
