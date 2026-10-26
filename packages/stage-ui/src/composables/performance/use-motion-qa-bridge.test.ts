import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { NaturalCaptureResult } from '@proj-airi/stage-ui-live2d/stores'

import type { MotionQaFrames } from './use-motion-qa-bridge'

import { defineInvoke } from '@moeru/eventa'
import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { createMotionQaContext, createMotionQaDispatcher, motionQaRunScenarioInvokeEventa } from '@proj-airi/stage-shared/motion-scenario'
import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, watch } from 'vue'

import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useMotionQaBridge } from './use-motion-qa-bridge'

/** Frames advance only when the test steps them, so scenario time is exactly the stepped time. */
function controlledFrames() {
  let now = 5_000
  let pending: (() => void) | undefined
  let requested = Promise.withResolvers<void>()
  const frames: MotionQaFrames = {
    now: () => now,
    request(callback) {
      pending = callback
      requested.resolve()
      return 1
    },
    cancel() {
      pending = undefined
    },
  }
  return {
    frames,
    /** Waits until the bridge requests a frame, moves the clock, and runs that frame. */
    async step(milliseconds: number) {
      await requested.promise
      requested = Promise.withResolvers<void>()
      now += milliseconds
      const callback = pending
      pending = undefined
      callback?.()
    },
  }
}

/** Steps frames until `reply` settles; a scenario that never finishes fails after `maxFrames`. */
async function drive<T>(clock: ReturnType<typeof controlledFrames>, reply: Promise<T>, maxFrames = 100): Promise<T> {
  let settled = false
  void reply.finally(() => {
    settled = true
  })
  for (let frame = 0; frame < maxFrames; frame++) {
    if (settled)
      break
    await Promise.race([clock.step(500), reply])
  }
  expect(settled).toBe(true)
  return reply
}

function scenario(events: MotionScenario['events']): MotionScenario {
  return { version: 1, id: 'bridge-test', seed: 1, durationSeconds: 10, levels: ['t3'], events }
}

const report: NaturalCaptureResult['report'] = { metrics: {}, hardFailures: [], warnings: [], score: 100, pass: true }

describe('useMotionQaBridge', () => {
  let pinia: ReturnType<typeof createPinia>
  let scope: ReturnType<typeof effectScope>
  let log: string[]
  let clock: ReturnType<typeof controlledFrames>
  let dispatch: (command: unknown) => Promise<{ ok: boolean, result?: unknown, error?: string, issues?: { path: string }[] }>

  /** Stands in for the capture that Model.vue runs: scenario events stamped into it land in the log. */
  function recordCaptureMarks() {
    useNaturalMotionDiagnostics().setCaptureMarker(event => log.push(event.kind === 'marker' ? `mark:marker:${event.label}` : `mark:${event.kind}`))
  }

  beforeEach(() => {
    vi.stubGlobal('window', { screenX: -1200, screenY: 20, devicePixelRatio: 1.5 })
    pinia = createPinia()
    setActivePinia(pinia)
    log = []
    clock = controlledFrames()
    const streaming = useLlmStreamingControlStore()
    const dispatcher = createMotionQaDispatcher()
    dispatch = async command => JSON.parse(await dispatcher(JSON.stringify(command)))
    scope = effectScope()
    scope.run(() => {
      // Stage.vue enqueues a parsed ACT emotion from this signal; the recording queue stands in for its emotion queue.
      streaming.onSignal(async (signal) => {
        if (signal.type === 'act')
          log.push(`queue:${normalizeActPayload(signal.payload).emotion?.name}:act`)
      })
      watch(() => useNaturalPerformanceOverride().overrideMode, mode => log.push(`mode:${mode}`), { flush: 'sync' })
      useMotionQaBridge({
        emotionsQueue: { enqueue: cue => log.push(`queue:${cue.emotion.name}:${cue.source}:${cue.emotion.intensity}`) },
        dispatchAct: marker => streaming.dispatchWith(marker),
        renderError: () => undefined,
        frames: clock.frames,
      })
    })
  })

  afterEach(() => {
    scope.stop()
    useSettingsLive2d().resetState()
    disposePinia(pinia)
    vi.unstubAllGlobals()
  })

  it('writes the settings that configure names and reports them back', async () => {
    const reply = await dispatch({ name: 'configure', input: { driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: false } })

    const live2d = useSettingsLive2d()
    expect([live2d.live2dMotionDriver, live2d.live2dNaturalCursorAttention, live2d.live2dExpressionEnabled]).toEqual(['natural', false, true])
    expect(useExpressionPerformanceSettings().document.heldEmotions).toBe(false)
    expect(reply).toMatchObject({ ok: true, result: { driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: false, captureActive: false, head: null, screen: { x: -1200, y: 20, devicePixelRatio: 1.5 } } })
  })

  it('writes the screen-aware setting and reports it back', async () => {
    const live2d = useSettingsLive2d()
    expect(live2d.live2dNaturalScreenAwareness).toBe(true)

    expect(await dispatch({ name: 'configure', input: { screenAwareness: false } })).toMatchObject({ ok: true, result: { screenAwareness: false } })
    expect(live2d.live2dNaturalScreenAwareness).toBe(false)
    // Omitting the field leaves the setting as it is.
    expect(await dispatch({ name: 'configure', input: {} })).toMatchObject({ ok: true, result: { screenAwareness: false } })
    expect(await dispatch({ name: 'configure', input: { screenAwareness: true } })).toMatchObject({ ok: true, result: { screenAwareness: true } })
    expect(live2d.live2dNaturalScreenAwareness).toBe(true)
  })

  it('reports the placement the stage last handed to Natural and the applied yaw bias', async () => {
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { placement: null, placementYawBias: 0 } })

    useNaturalMotionDiagnostics().reportPlacement(-0.8, -0.0973)
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { placement: -0.8, placementYawBias: -0.0973 } })

    useNaturalMotionDiagnostics().reportPlacement(null, 0)
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { placement: null, placementYawBias: 0 } })
  })

  it('reports the chat input the stage last handed to Natural as flags and counters', async () => {
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { chat: null } })

    const diagnostics = useNaturalMotionDiagnostics()
    diagnostics.reportChat({ target: { x: -3, y: -1 }, typing: true, sentSeq: 2, sentWords: 5, unfoldSeq: 1 })
    const reply = await dispatch({ name: 'state' })
    // `sentWords` and the target point stay inside the stage; the bridge only says whether a target exists.
    expect(reply).toMatchObject({ ok: true, result: { chat: { hasTarget: true, typing: true, sentSeq: 2, unfoldSeq: 1 } } })
    expect(Object.keys((reply as { result: { chat: object } }).result.chat).sort()).toEqual(['hasTarget', 'sentSeq', 'typing', 'unfoldSeq'])

    diagnostics.reportChat({ target: null, typing: false, sentSeq: 2, sentWords: 5, unfoldSeq: 1 })
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { chat: { hasTarget: false, typing: false, sentSeq: 2, unfoldSeq: 1 } } })

    diagnostics.reportChat(null)
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { chat: null } })
  })

  it('reports the stage face-feature head unit without applying another scale', async () => {
    const head = { x: 100, y: 50, width: 80, height: 100 }
    const release = useNaturalMotionDiagnostics().registerStageReader(() => ({ naturalActive: true, hold: null, head }))
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { head, screen: { x: -1200, y: 20, devicePixelRatio: 1.5 } } })
    release()
  })

  it('dispatches emotion, ACT and mode events in scenario order through the real paths', async () => {
    recordCaptureMarks()
    const reply = drive(clock, dispatch({ name: 'runScenario', input: { scenario: scenario([
      { kind: 'emotion', at: 1, emotion: 'happy', band: 'clear', source: 'devtools' },
      { kind: 'act', at: 2, marker: '<|ACT {"emotion":"angry"}|>' },
      { kind: 'mode', at: 3, mode: 'thinking', energy: 0.4 },
      { kind: 'expression', at: 3.2, expressionId: 'missing', on: true },
      { kind: 'marker', at: 3.5, label: 'end' },
    ]) } }))

    expect(await reply).toEqual({ ok: true, result: { dispatched: 4, rejected: [{ at: 3.2, kind: 'expression', reason: expect.any(String) }] } })
    const clear = useExpressionPerformanceSettings().document.intensity.clear
    expect(log).toEqual([`queue:happy:devtools:${clear}`, 'mark:emotion', 'queue:angry:act', 'mark:act', 'mode:thinking', 'mark:mode', 'mark:marker:end'])
    expect(useNaturalPerformanceOverride().performanceOverride).toEqual({ mode: 'thinking', energy: 0.4 })
  })

  it('rejects speech events that reach the handler without dispatching them', async () => {
    recordCaptureMarks()
    const run = defineInvoke(createMotionQaContext(), motionQaRunScenarioInvokeEventa)
    const reply = drive(clock, run({ scenario: scenario([
      { kind: 'speech', at: 1, turnId: 'turn', seconds: 2, envelopeSeed: 1 },
      { kind: 'marker', at: 1.5, label: 'after' },
    ]) }))

    expect(await reply).toEqual({ dispatched: 1, rejected: [{ at: 1, kind: 'speech', reason: expect.any(String) }] })
    expect(log).toEqual(['mark:marker:after'])
  })

  it.each([undefined, 'desk', 'product'] as const)('applies scenario home %s before dispatch and retains it until disposal', async (home) => {
    const diagnostics = useNaturalMotionDiagnostics()
    expect(diagnostics.postureHome).toBe('product')
    diagnostics.setPostureHome(home === 'product' ? 'desk' : 'product')
    scope.run(() => watch(() => diagnostics.postureHome, value => log.push(`home:${value}`), { flush: 'sync' }))
    const input = { ...scenario([{ kind: 'emotion', at: 0, emotion: 'happy' as const, band: 'clear' as const, source: 'devtools' as const }]), home }
    expect(await drive(clock, dispatch({ name: 'runScenario', input: { scenario: input } }))).toMatchObject({ ok: true })
    expect(diagnostics.postureHome).toBe(home ?? 'desk')
    expect(log[0]).toBe(`home:${home ?? 'desk'}`)
    expect(log.at(-1)).toContain('queue:happy:')
    scope.stop()
    expect(diagnostics.postureHome).toBe('product')
  })

  it('returns schema errors as replies with their paths', async () => {
    const reply = await dispatch({ name: 'configure', input: { driver: 'magic' } })
    expect(reply.ok).toBe(false)
    expect(reply.issues?.map(issue => issue.path)).toEqual(['input.driver'])

    const t1Only = await dispatch({ name: 'runScenario', input: { scenario: { ...scenario([]), levels: ['t1'] } } })
    expect(t1Only).toEqual({ ok: false, error: expect.stringContaining('t3') })
  })

  it('fails a capture that no stage model starts and leaves nothing pending', async () => {
    const reply = await dispatch({ name: 'startCapture', input: { durationSeconds: 5, label: 'idle' } })

    expect(reply.ok).toBe(false)
    expect(useNaturalMotionDiagnostics().pendingRequest).toBeNull()
  })

  it('starts a capture with rig parameters and returns its trace when the stage completes it', async () => {
    const diagnostics = useNaturalMotionDiagnostics()
    // Stands in for Model.vue, which starts sampling when a request arrives.
    const stopStage = watch(() => diagnostics.pendingRequest, (request) => {
      if (request)
        recordCaptureMarks()
    })

    const started = await dispatch({ name: 'startCapture', input: { durationSeconds: 5, extraParameterIds: ['Param60'], label: 'idle' } })
    const captureId = diagnostics.pendingRequest?.id
    if (!captureId)
      throw new Error('the capture must be pending')
    expect(started).toEqual({ ok: true, result: { captureId } })
    expect(diagnostics.pendingRequest?.extraParameterIds).toEqual(['Param60'])
    expect(log).toEqual(['mark:marker:capture:idle'])

    const awaited = dispatch({ name: 'awaitCapture', input: { captureId } })
    const trace = { version: 2 as const, t: [0], channels: { Param60: [1] }, ranges: { Param60: { min: 0, max: 1, default: 0 } }, events: [], meta: { model: 'rig', driver: 'natural', energy: 0.5, home: 'desk' as const, adapter: { weightMean: 1, bodyWrites: 0, physicsOutputSkips: 0 }, capturedAt: '2026-10-20T00:00:00.000Z', durationSeconds: 5 } }
    diagnostics.completeCapture(captureId, trace, report)

    expect(await awaited).toEqual({ ok: true, result: { trace } })
    expect(await dispatch({ name: 'awaitCapture', input: { captureId } })).toEqual({ ok: false, error: expect.any(String) })
    stopStage()
  })
})
