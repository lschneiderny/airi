import type { InferOutput } from 'valibot'

import type { Band, PerformanceEmotion } from '../expression-performance/types'
import type { PerformanceMode } from '../performance-state'

import { array, boolean, check, finite, integer, literal, maxValue, minLength, minValue, number, optional, picklist, pipe, rawCheck, strictObject, string, unknown, variant } from 'valibot'

/** The QA levels a scenario can run at: T1 simulated pipeline, T2 headless rig, T3 rendered app. */
export const motionScenarioLevels = ['t1', 't2', 't3'] as const
export type MotionScenarioLevel = typeof motionScenarioLevels[number]

// NOTICE:
// These picklists duplicate unions that stage-shared owns elsewhere (or, for `PostureHome`, that stage-ui-live2d owns,
// which stage-shared must not import). The `satisfies` clauses make the compiler reject drift on the stage-shared side.
// Source: expression-performance/types.ts, performance-state/index.ts, stage-ui-live2d natural-motion/posture.ts.
// Removal condition: the unions become exported value arrays in their owning modules.
const emotions = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral', 'love', 'flustered', 'sleepy'] as const satisfies readonly PerformanceEmotion[]
const bands = ['slight', 'clear', 'strong'] as const satisfies readonly Band[]
const modes = ['idle', 'watching', 'listening', 'thinking', 'talking'] as const satisfies readonly PerformanceMode[]
const postureHomes = ['product', 'desk'] as const

const seconds = pipe(number(), finite(), minValue(0))
const uint32 = pipe(number(), integer(), minValue(0), maxValue(0xFFFFFFFF))
const nonEmpty = pipe(string(), minLength(1))
const trialId = optional(nonEmpty)

/** One scheduled input of a motion scenario. `at` is seconds from the scenario start. */
export const ScenarioEventSchema = variant('kind', [
  strictObject({ kind: literal('emotion'), at: seconds, emotion: picklist(emotions), band: picklist(bands), source: picklist(['devtools', 'act']), trialId }),
  /** `marker` is the raw `<|ACT {...}|>` text. */
  strictObject({ kind: literal('act'), at: seconds, marker: nonEmpty, trialId }),
  strictObject({ kind: literal('mode'), at: seconds, mode: picklist(modes), energy: optional(pipe(number(), finite(), minValue(0), maxValue(1))) }),
  strictObject({ kind: literal('speech'), at: seconds, turnId: nonEmpty, seconds: pipe(number(), finite(), minValue(0)), envelopeSeed: uint32 }),
  /**
   * The cursor offset Natural attends to: head widths from the eye anchor, x right and y up.
   * Either `x` and `y` (both) or `clear: true`; the scenario check enforces the pairing.
   */
  strictObject({ kind: literal('cursor'), at: seconds, x: optional(pipe(number(), finite())), y: optional(pipe(number(), finite())), clear: optional(literal(true)) }),
  /**
   * Pointer coordinates are head widths from the head-box center (x right, y down).
   * If a scenario has both `cursor` and `pointer` events, the latest event by `at` sets the cursor.
   * The T3 harness performs these events with the real OS cursor, not synthetic DOM events.
   */
  strictObject({ kind: literal('pointer'), at: seconds, phase: picklist(['move', 'down', 'up', 'leave']), x: pipe(number(), finite()), y: pipe(number(), finite()) }),
  strictObject({ kind: literal('expression'), at: seconds, expressionId: nonEmpty, on: boolean() }),
  strictObject({ kind: literal('placebo'), at: seconds, trialId: nonEmpty }),
  strictObject({ kind: literal('noop'), at: seconds, replaced: picklist(['emotion', 'act']), trialId }),
  strictObject({ kind: literal('marker'), at: seconds, label: nonEmpty }),
])
export type ScenarioEvent = InferOutput<typeof ScenarioEventSchema>

const scenarioObject = strictObject({
  version: literal(1),
  id: nonEmpty,
  seed: uint32,
  durationSeconds: pipe(number(), finite(), minValue(Number.MIN_VALUE)),
  /** Posture home Natural starts from. */
  home: optional(picklist(postureHomes)),
  levels: pipe(array(picklist(motionScenarioLevels)), minLength(1)),
  // Valibot objects accept arrays; the settings section must be a record, as in expression-performance/settings.ts.
  settings: optional(pipe(unknown(), check(value => !Array.isArray(value), 'Expected a settings object'), strictObject({
    heldEmotions: optional(boolean()),
    cursorAttention: optional(boolean()),
    expressionEnabled: optional(boolean()),
    /** Validated later with `parseExpressionPerformanceSettings`. */
    performance: optional(unknown()),
  }))),
  screenshotsAt: optional(array(seconds)),
  events: array(ScenarioEventSchema),
})

/**
 * A deterministic, replayable input script for motion QA.
 *
 * Events must be sorted by `at` and must not come after `durationSeconds`. A scenario that includes level `t3` cannot contain `speech` or `cursor`
 * events, because the rendered app cannot produce those inputs through the QA bridge.
 */
export const MotionScenarioSchema = pipe(scenarioObject, rawCheck(({ dataset, addIssue }) => {
  if (!dataset.typed)
    return
  const scenario = dataset.value
  const root = { type: 'object', origin: 'value', input: scenario, key: 'events', value: scenario.events } as const
  const at = (index: number, key: string) => [
    root,
    { type: 'array', origin: 'value', input: scenario.events, key: index, value: scenario.events[index] },
    { type: 'object', origin: 'value', input: scenario.events[index], key, value: (scenario.events[index] as Record<string, unknown>)[key] },
  ] as const
  const hasT3 = scenario.levels.includes('t3')
  scenario.events.forEach((event, index) => {
    if (index > 0 && event.at < scenario.events[index - 1].at)
      addIssue({ message: `Events must be sorted by "at": ${event.at} comes after ${scenario.events[index - 1].at}`, path: [...at(index, 'at')] })
    // A runner plays the scenario for `durationSeconds`, so a later event would silently never play.
    if (event.at > scenario.durationSeconds)
      addIssue({ message: `Event at ${event.at} s is after the scenario ends at ${scenario.durationSeconds} s`, path: [...at(index, 'at')] })
    if (hasT3 && (event.kind === 'speech' || event.kind === 'cursor'))
      addIssue({ message: `Scenarios with level "t3" cannot contain "${event.kind}" events`, path: [...at(index, 'kind')] })
    if (event.kind === 'cursor' && !(event.clear === true ? event.x === undefined && event.y === undefined : event.x !== undefined && event.y !== undefined))
      addIssue({ message: 'A cursor event needs both "x" and "y", or only "clear: true"', path: [...at(index, 'kind')] })
  })
}))
export type MotionScenario = InferOutput<typeof scenarioObject>
