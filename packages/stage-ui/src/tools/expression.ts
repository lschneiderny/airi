import type { Tool } from '@xsai/shared-chat'

import type { ActiveExpression, ExposedExpressionGroup, ExposedExpressionKind } from '../features/performance/runtime-state'

import { tool } from '@xsai/tool'
import { z } from 'zod'

/** Inclusive bounds of `hold_seconds`. */
const MIN_HOLD_SECONDS = 1
const MAX_HOLD_SECONDS = 30

const expressionSlots = ['face', 'effect', 'prop'] as const satisfies readonly ExposedExpressionKind[]

/** An exposed expression and whether a slot shows it now. */
export interface ListedExpression {
  label: string
  kind: ExposedExpressionGroup
  active: boolean
}

/** The JSON object every expression tool returns to the model. */
export interface ExpressionToolResult {
  success: boolean
  active?: ActiveExpression[]
  error?: string
  /** Exposed labels, returned when the requested name is not one of them. */
  available?: string[]
  /** Every exposed expression, returned by `list_expressions`. */
  expressions?: ListedExpression[]
}

/** The stage-side operations the expression tools call; the stage conductor implements it. */
export interface ExpressionToolPort {
  /** Exposed expressions only. */
  list: () => ListedExpression[]
  set: (name: string, holdSeconds?: number) => ExpressionToolResult
  clear: (slot?: ExposedExpressionKind) => ExpressionToolResult
}

/**
 * Builds the model-facing expression tools over the stage port.
 *
 * The parameter schema lists the exposed labels, but the tool store keeps no validator, so
 * every call is checked again here and an unknown name answers with the exposed labels.
 *
 * Expects:
 * - `port.list()` returns at least one exposed expression; callers remove the tools otherwise
 *
 * Returns:
 * - `set_expression`, `clear_expression`, and `list_expressions`
 */
export async function createExpressionTools(port: ExpressionToolPort): Promise<Tool[]> {
  const labels = port.list().map(entry => entry.label)
  const [first, ...rest] = labels
  if (first === undefined)
    throw new Error('Expression tools need at least one exposed expression.')

  return await Promise.all([
    tool({
      name: 'set_expression',
      description: 'Show one of the character\'s exposed expressions (faces, effects, props, or combos, which show several expressions together) by label. Without hold_seconds it lasts while the current reply is spoken.',
      execute: async (input) => {
        const name: unknown = input.expression
        const holdSeconds: unknown = input.hold_seconds
        if (typeof name !== 'string')
          return JSON.stringify({ success: false, error: 'expression must be a label string.', available: port.list().map(entry => entry.label) } satisfies ExpressionToolResult)
        if (holdSeconds !== undefined && holdSeconds !== null
          && (typeof holdSeconds !== 'number' || !Number.isFinite(holdSeconds) || holdSeconds < MIN_HOLD_SECONDS || holdSeconds > MAX_HOLD_SECONDS)) {
          return JSON.stringify({ success: false, error: `hold_seconds must be a number from ${MIN_HOLD_SECONDS} to ${MAX_HOLD_SECONDS}.` } satisfies ExpressionToolResult)
        }
        return JSON.stringify(port.set(name, typeof holdSeconds === 'number' ? holdSeconds : undefined))
      },
      parameters: z.object({
        expression: z.enum([first, ...rest]).describe('Label of an exposed expression.'),
        hold_seconds: z.number().min(MIN_HOLD_SECONDS).max(MAX_HOLD_SECONDS).optional().describe('Seconds to keep it shown, from 1 to 30. Omit to follow speech.'),
      }).strict(),
    }),
    tool({
      name: 'clear_expression',
      description: 'Remove expressions you or the stage showed. Pass a slot to clear only faces, effects, or props; omit it to clear all three.',
      execute: async (input) => {
        const slot: unknown = input.slot
        if (slot !== undefined && slot !== null && !(expressionSlots as readonly unknown[]).includes(slot))
          return JSON.stringify({ success: false, error: 'slot must be face, effect, or prop.' } satisfies ExpressionToolResult)
        return JSON.stringify(port.clear(expressionSlots.find(value => value === slot)))
      },
      parameters: z.object({
        slot: z.enum(expressionSlots).optional().describe('Slot to clear: face, effect, or prop.'),
      }).strict(),
    }),
    tool({
      name: 'list_expressions',
      description: 'List the exposed expression labels with their kind and whether each is shown now.',
      execute: async () => JSON.stringify({ success: true, expressions: port.list() } satisfies ExpressionToolResult),
      parameters: z.object({}).strict(),
    }),
  ])
}
