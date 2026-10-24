import type { MotionQaRunScenarioResult, MotionQaState, MotionScenario, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { EmotionPayload } from '../../constants/emotions'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import {
  claimMotionQaHandlers,
  createMotionQaContext,
  createScenarioPlayer,
  motionQaAwaitCaptureInvokeEventa,
  motionQaConfigureInvokeEventa,
  motionQaImportModelFromInputInvokeEventa,
  motionQaRunScenarioInvokeEventa,
  motionQaStartCaptureInvokeEventa,
  motionQaStateInvokeEventa,
} from '@proj-airi/stage-shared/motion-scenario'
import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useExpressionStore, useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { nextTick, onScopeDispose, watch } from 'vue'

import { EMOTION_VALUES } from '../../constants/emotions'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { DisplayModelFormat, useDisplayModelsStore } from '../../stores/display-models'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useSettingsStageModel } from '../../stores/settings/stage-model'

/** The frame source that paces a scenario. */
export interface MotionQaFrames {
  /** Monotonic milliseconds, like `performance.now()`. */
  now: () => number
  request: (callback: () => void) => number
  cancel: (handle: number) => void
}

export interface MotionQaBridgeOptions {
  /** The stage's emotion queue. Bridge emotions enter it exactly like devtools lab pulses. */
  emotionsQueue: { enqueue: (cue: { emotion: EmotionPayload, source: 'act' | 'devtools' }) => void }
  /** Dispatches a raw special token through the streaming-control parser, as speech output does; resolves whether it parsed. */
  dispatchAct: (marker: string) => Promise<boolean>
  /** The stage's render error for the selected model, if it reported one. */
  renderError: () => Error | undefined
  /** Defaults to `performance.now()` and `requestAnimationFrame`. */
  frames?: MotionQaFrames
}

const browserFrames: MotionQaFrames = {
  now: () => performance.now(),
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle),
}

/**
 * Answers the dev-only motion QA bridge contracts for the stage of this window.
 *
 * Use when:
 * - `Stage.vue` runs with the bridge flag set; it imports this module lazily so production bundles never contain it
 *
 * Expects:
 * - An active effect scope; the handlers and any running scenario end when it is disposed
 *
 * Every input goes through the stage's real paths: settings stores, the emotion queue, the streaming-control
 * parser, the performance override and expression stores, and the Natural capture of the diagnostics store.
 */
export function useMotionQaBridge(options: MotionQaBridgeOptions) {
  const release = claimMotionQaHandlers()
  if (!release) {
    console.warn('[motion-qa] Another stage in this window already answers the bridge; this one does not.')
    return
  }

  const frames = options.frames ?? browserFrames
  const live2d = useSettingsLive2d()
  const performanceSettings = useExpressionPerformanceSettings()
  const stageModel = useSettingsStageModel()
  const displayModels = useDisplayModelsStore()
  const diagnostics = useNaturalMotionDiagnostics()
  const override = useNaturalPerformanceOverride()
  const expressions = useExpressionStore()
  const context = createMotionQaContext()
  /** Captures this bridge started, so `awaitCapture` can tell an unknown id from a failed capture. */
  const startedCaptures = new Set<string>()
  /** Rejects whatever still waits when the stage goes away. */
  const abandon = new Set<(error: Error) => void>()

  /** Read through a call: TypeScript would keep a checked `pendingRequest` narrowed across an `await`. */
  function pendingCaptureId() {
    return diagnostics.pendingRequest?.id
  }

  function readState(): MotionQaState {
    const snapshot = diagnostics.stageSnapshot()
    const modelId = stageModel.stageModelSelected || null
    return {
      modelId,
      modelLoaded: modelId !== null && diagnostics.loadedModelId === modelId,
      driver: live2d.live2dMotionDriver,
      cursorAttention: live2d.live2dNaturalCursorAttention,
      expressionEnabled: live2d.live2dExpressionEnabled,
      heldEmotions: performanceSettings.document.heldEmotions,
      naturalActive: snapshot?.naturalActive ?? false,
      hold: snapshot?.hold ? { emotion: snapshot.hold.emotion, strength: snapshot.hold.strength } : null,
      captureActive: diagnostics.pendingRequest !== null,
    }
  }

  /** Resolves once `settled` returns a value; rejects when the stage goes away first. */
  function waitFor<T>(settled: () => T | undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let stop: (() => void) | undefined
      function finish(callback: () => void) {
        stop?.()
        abandon.delete(onAbandon)
        callback()
      }
      function onAbandon(error: Error) {
        finish(() => reject(error))
      }
      abandon.add(onAbandon)
      stop = watch(() => {
        try {
          return { value: settled() }
        }
        catch (error) {
          return { error }
        }
      }, (outcome) => {
        if ('error' in outcome)
          finish(() => reject(outcome.error))
        else if (outcome.value !== undefined)
          finish(() => resolve(outcome.value as T))
      }, { immediate: true })
      // `immediate` runs the callback before `watch` returns `stop`, so settle a first-run result here.
      if (!abandon.has(onAbandon))
        stop()
    })
  }

  async function dispatchEvent(event: ScenarioEvent): Promise<string | null> {
    switch (event.kind) {
      case 'emotion': {
        const name = EMOTION_VALUES.find(value => value === event.emotion)
        if (!name)
          return `The stage has no emotion "${event.emotion}"`
        // Same nominal intensity the devtools lab pulse buttons send for a band.
        options.emotionsQueue.enqueue({ emotion: { name, intensity: performanceSettings.document.intensity[event.band] }, source: event.source })
        return null
      }
      case 'act':
        return await options.dispatchAct(event.marker) ? null : 'The streaming-control parser did not accept the marker'
      case 'mode':
        override.overrideEnabled = true
        override.overrideMode = event.mode
        override.overrideEnergy = event.energy ?? null
        return null
      case 'expression': {
        if (!expressions.definitions.some(definition => definition.id === event.expressionId))
          return `The loaded model has no expression "${event.expressionId}"`
        // The expression settings toggle, so the event goes through the same command the UI sends.
        if (expressions.manualActive.includes(event.expressionId) !== event.on)
          expressions.applySettingsCommand({ type: 'toggle', id: event.expressionId })
        return null
      }
      case 'placebo':
      case 'noop':
      case 'marker':
        return null
      // The rendered app has no QA input that produces these; T1 and T2 simulate them.
      case 'speech':
      case 'cursor':
      case 'pointer':
        return `The rendered app has no QA input for "${event.kind}" events`
    }
  }

  let scenarioRunning = false

  function runScenario(scenario: MotionScenario): Promise<MotionQaRunScenarioResult> {
    if (!scenario.levels.includes('t3'))
      throw new Error('The scenario does not list level "t3", so it cannot run in the rendered app')
    if (scenarioRunning)
      throw new Error('A scenario is already running')
    scenarioRunning = true
    // Keep the home through capture completion, which can follow the last scenario event.
    // The next scenario replaces it; disposing this bridge restores the product home.
    diagnostics.setPostureHome(scenario.home ?? 'desk')

    const player = createScenarioPlayer(scenario)
    const lastAt = scenario.events.at(-1)?.at ?? 0
    const result: MotionQaRunScenarioResult = { dispatched: 0, rejected: [] }
    const startSeconds = frames.now() / 1000
    let previous = Number.NEGATIVE_INFINITY
    let handle: number | undefined

    return new Promise<MotionQaRunScenarioResult>((resolve, reject) => {
      function finish(callback: () => void) {
        scenarioRunning = false
        abandon.delete(onAbandon)
        callback()
      }
      function onAbandon(error: Error) {
        if (handle !== undefined)
          frames.cancel(handle)
        finish(() => reject(error))
      }
      abandon.add(onAbandon)

      async function tick() {
        handle = undefined
        const elapsed = frames.now() / 1000 - startSeconds
        for (const event of player.eventsBetween(previous, elapsed)) {
          const reason = await dispatchEvent(event)
          if (reason) {
            result.rejected.push({ at: event.at, kind: event.kind, reason })
            continue
          }
          diagnostics.markCaptureEvent(event)
          result.dispatched += 1
        }
        previous = elapsed
        if (!abandon.has(onAbandon))
          return
        if (elapsed >= lastAt)
          finish(() => resolve(result))
        else
          schedule()
      }

      // One frame callback at a time: the next frame is requested only after this frame's events are dispatched.
      function schedule() {
        handle = frames.request(() => void tick().catch(error => onAbandon(error instanceof Error ? error : new Error(errorMessageFrom(error) ?? 'unknown error'))))
      }

      schedule()
    })
  }

  const disposers = [
    defineInvokeHandler(context, motionQaStateInvokeEventa, () => readState()),
    defineInvokeHandler(context, motionQaConfigureInvokeEventa, async (input) => {
      if (input.driver)
        live2d.live2dMotionDriver = input.driver
      if (input.cursorAttention !== undefined)
        live2d.live2dNaturalCursorAttention = input.cursorAttention
      if (input.expressionEnabled !== undefined)
        live2d.live2dExpressionEnabled = input.expressionEnabled
      if (input.heldEmotions !== undefined) {
        const updated = await performanceSettings.update({ heldEmotions: input.heldEmotions })
        if (!updated.success)
          throw new Error('The performance settings rejected "heldEmotions"')
      }
      return readState()
    }),
    defineInvokeHandler(context, motionQaImportModelFromInputInvokeEventa, async ({ inputId }) => {
      const input = document.getElementById(inputId)
      const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined
      if (!file)
        throw new Error(`#${inputId} is not a file input with a selected file`)
      // The settings model picker's import: add the display model, select it, and publish it to the stage.
      const model = await displayModels.addDisplayModel(DisplayModelFormat.Live2dZip, file)
      stageModel.stageModelSelected = model.id
      await stageModel.updateStageModel()
      return waitFor(() => {
        if (diagnostics.loadedModelId === model.id)
          return { modelId: model.id }
        const error = options.renderError()
        if (error)
          throw new Error(`The stage could not load the imported model: ${error.message}`)
        return undefined
      })
    }),
    defineInvokeHandler(context, motionQaStartCaptureInvokeEventa, async ({ durationSeconds, extraParameterIds, label }) => {
      if (diagnostics.pendingRequest)
        throw new Error('A capture is already running')
      const captureId = diagnostics.requestCapture(durationSeconds, { extraParameterIds })
      // The stage's model starts the capture from a watcher, which runs before the next tick resolves.
      await nextTick()
      if (pendingCaptureId() !== captureId || !diagnostics.markCaptureEvent({ kind: 'marker', at: 0, label: `capture:${label}` })) {
        const reason = diagnostics.failure ?? 'No Live2D model in this window started the capture'
        if (pendingCaptureId() === captureId)
          diagnostics.cancelCapture()
        throw new Error(reason)
      }
      startedCaptures.add(captureId)
      return { captureId }
    }),
    defineInvokeHandler(context, motionQaRunScenarioInvokeEventa, ({ scenario }) => runScenario(scenario)),
    defineInvokeHandler(context, motionQaAwaitCaptureInvokeEventa, async ({ captureId }) => {
      if (!startedCaptures.has(captureId))
        throw new Error(`No capture "${captureId}" was started through the bridge`)
      const trace = await waitFor(() => {
        if (diagnostics.pendingRequest?.id === captureId)
          return undefined
        if (diagnostics.result?.id === captureId && diagnostics.trace)
          return diagnostics.trace
        throw new Error(diagnostics.failure ?? `Capture "${captureId}" ended without a trace`)
      })
      startedCaptures.delete(captureId)
      // A spread is an object literal type, which the contract's loose trace object accepts; the interface is not.
      return { trace: { ...trace } }
    }),
  ]

  onScopeDispose(() => {
    for (const dispose of disposers)
      dispose()
    for (const reject of abandon)
      reject(new Error('The stage that answered the motion QA bridge was disposed'))
    diagnostics.setPostureHome('product')
    release()
  })
}
