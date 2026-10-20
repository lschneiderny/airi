import type { InferOutput } from 'valibot'

import { defineInvokeEventa } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/event-target'
import { array, boolean, finite, literal, looseObject, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, strictObject, string, variant } from 'valibot'

import { MotionScenarioSchema } from './schema'

/** Dev-only control surface of the rendered app. Dispatch goes through these contracts; handlers live in stage-ui. */

const nonEmpty = pipe(string(), minLength(1))
const emotion = picklist(['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral', 'love', 'flustered', 'sleepy'])

export const MotionQaStateSchema = strictObject({
  modelId: nullable(string()),
  modelLoaded: boolean(),
  driver: string(),
  cursorAttention: boolean(),
  expressionEnabled: boolean(),
  heldEmotions: boolean(),
  naturalActive: boolean(),
  hold: nullable(strictObject({ emotion, strength: pipe(number(), finite()) })),
  captureActive: boolean(),
})
export type MotionQaState = InferOutput<typeof MotionQaStateSchema>

export const MotionQaConfigureInputSchema = strictObject({
  driver: optional(literal('natural')),
  cursorAttention: optional(boolean()),
  expressionEnabled: optional(boolean()),
  heldEmotions: optional(boolean()),
})

export const MotionQaImportModelInputSchema = strictObject({ inputId: nonEmpty })
export const MotionQaImportModelResultSchema = strictObject({ modelId: nonEmpty })

export const MotionQaStartCaptureInputSchema = strictObject({
  durationSeconds: pipe(number(), finite(), minValue(1), maxValue(600)),
  extraParameterIds: optional(array(nonEmpty)),
  label: nonEmpty,
})
export const MotionQaStartCaptureResultSchema = strictObject({ captureId: nonEmpty })

export const MotionQaRunScenarioInputSchema = strictObject({ scenario: MotionScenarioSchema })
export const MotionQaRunScenarioResultSchema = strictObject({
  dispatched: pipe(number(), finite(), minValue(0)),
  rejected: array(strictObject({ at: pipe(number(), finite(), minValue(0)), kind: nonEmpty, reason: nonEmpty })),
})

export const MotionQaAwaitCaptureInputSchema = strictObject({ captureId: nonEmpty })
/** The trace is the Natural trace v2 JSON; stage-ui-live2d owns its full shape, so only the version is pinned here. */
export const MotionQaAwaitCaptureResultSchema = strictObject({ trace: looseObject({ version: literal(2) }) })

export type MotionQaConfigureInput = InferOutput<typeof MotionQaConfigureInputSchema>
export type MotionQaImportModelInput = InferOutput<typeof MotionQaImportModelInputSchema>
export type MotionQaImportModelResult = InferOutput<typeof MotionQaImportModelResultSchema>
export type MotionQaStartCaptureInput = InferOutput<typeof MotionQaStartCaptureInputSchema>
export type MotionQaStartCaptureResult = InferOutput<typeof MotionQaStartCaptureResultSchema>
export type MotionQaRunScenarioInput = InferOutput<typeof MotionQaRunScenarioInputSchema>
export type MotionQaRunScenarioResult = InferOutput<typeof MotionQaRunScenarioResultSchema>
export type MotionQaAwaitCaptureInput = InferOutput<typeof MotionQaAwaitCaptureInputSchema>
export type MotionQaAwaitCaptureResult = InferOutput<typeof MotionQaAwaitCaptureResultSchema>

export const motionQaStateInvokeEventa = defineInvokeEventa<MotionQaState>('eventa:invoke:motion-qa:state')
export const motionQaConfigureInvokeEventa = defineInvokeEventa<MotionQaState, MotionQaConfigureInput>('eventa:invoke:motion-qa:configure')
export const motionQaImportModelFromInputInvokeEventa = defineInvokeEventa<MotionQaImportModelResult, MotionQaImportModelInput>('eventa:invoke:motion-qa:import-model-from-input')
export const motionQaStartCaptureInvokeEventa = defineInvokeEventa<MotionQaStartCaptureResult, MotionQaStartCaptureInput>('eventa:invoke:motion-qa:start-capture')
export const motionQaRunScenarioInvokeEventa = defineInvokeEventa<MotionQaRunScenarioResult, MotionQaRunScenarioInput>('eventa:invoke:motion-qa:run-scenario')
export const motionQaAwaitCaptureInvokeEventa = defineInvokeEventa<MotionQaAwaitCaptureResult, MotionQaAwaitCaptureInput>('eventa:invoke:motion-qa:await-capture')

/** One JSON command as the renderer dispatcher receives it: `{ "name": "state" }` or `{ "name": "configure", "input": {...} }`. */
export const MotionQaCommandSchema = variant('name', [
  strictObject({ name: literal('state') }),
  strictObject({ name: literal('configure'), input: MotionQaConfigureInputSchema }),
  strictObject({ name: literal('importModelFromInput'), input: MotionQaImportModelInputSchema }),
  strictObject({ name: literal('startCapture'), input: MotionQaStartCaptureInputSchema }),
  strictObject({ name: literal('runScenario'), input: MotionQaRunScenarioInputSchema }),
  strictObject({ name: literal('awaitCapture'), input: MotionQaAwaitCaptureInputSchema }),
])

let motionQaContext: ReturnType<typeof createContext> | undefined
let motionQaTarget: EventTarget | undefined

/** The window-local context that carries the bridge contracts. It never leaves the window: a dedicated EventTarget, no channel. */
export function createMotionQaContext() {
  motionQaTarget ??= new EventTarget()
  motionQaContext ??= createContext(motionQaTarget)
  return motionQaContext.context
}

/** True only when the renderer set the dev-only flag before mounting the stage. */
export function isMotionQaBridgeEnabled(): boolean {
  return (globalThis as { __airiMotionQaEnabled?: unknown }).__airiMotionQaEnabled === true
}
