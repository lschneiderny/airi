import type { InferOutput } from 'valibot'

import type { PerformanceEmotion } from '../expression-performance/types'

import { defineInvokeEventa } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/event-target'
import { array, boolean, finite, literal, looseObject, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, strictObject, string, variant } from 'valibot'

import { MotionScenarioSchema } from './schema'

export { isMotionQaBridgeEnabled } from './flag'

/** Dev-only control surface of the rendered app. Dispatch goes through these contracts; handlers live in stage-ui. */

const nonEmpty = pipe(string(), minLength(1))
// NOTICE:
// This picklist duplicates the `PerformanceEmotion` union that expression-performance/types.ts owns, as schema.ts does.
// The `satisfies` clause makes the compiler reject a value the union does not contain.
// Source: expression-performance/types.ts.
// Removal condition: the union becomes an exported value array in its owning module.
const emotion = picklist(['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral', 'love', 'flustered', 'sleepy'] as const satisfies readonly PerformanceEmotion[])

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
  /** Unscaled face-feature cursor unit in viewport CSS pixels, or null while unavailable. */
  head: nullable(strictObject({ x: pipe(number(), finite()), y: pipe(number(), finite()), width: pipe(number(), finite(), minValue(Number.MIN_VALUE)), height: pipe(number(), finite(), minValue(Number.MIN_VALUE)) })),
  /** DOM window origin in screen CSS pixels; the harness converts to physical pixels. */
  screen: strictObject({ x: pipe(number(), finite()), y: pipe(number(), finite()), devicePixelRatio: pipe(number(), finite(), minValue(Number.MIN_VALUE)) }),
  /** The persisted Natural screen-aware attention setting. */
  screenAwareness: boolean(),
  /** Screen inwardness (-1..1, positive toward screen +x) the stage last handed to Natural, or null without a signal. */
  placement: nullable(pipe(number(), finite())),
  /** Normalized head-X placement term the Natural controller last applied. */
  placementYawBias: pipe(number(), finite()),
})
export type MotionQaState = InferOutput<typeof MotionQaStateSchema>

export const MotionQaConfigureInputSchema = strictObject({
  driver: optional(literal('natural')),
  cursorAttention: optional(boolean()),
  expressionEnabled: optional(boolean()),
  heldEmotions: optional(boolean()),
  screenAwareness: optional(boolean()),
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

let motionQaHandlersClaimed = false

/**
 * Claims the one handler set of the window's bridge context. Returns the release, or `null` when another
 * owner already holds the claim; an invoke contract must have exactly one handler per context.
 */
export function claimMotionQaHandlers(): (() => void) | null {
  if (motionQaHandlersClaimed)
    return null
  motionQaHandlersClaimed = true
  let released = false
  return () => {
    if (released)
      return
    released = true
    motionQaHandlersClaimed = false
  }
}

/** Whether a stage in this window holds the handler claim, so an invoke has someone to answer it. */
export function hasMotionQaHandlers(): boolean {
  return motionQaHandlersClaimed
}
