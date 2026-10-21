import type { GenericSchema } from 'valibot'

import { defineInvoke } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { safeParse } from 'valibot'

import {
  createMotionQaContext,
  hasMotionQaHandlers,
  motionQaAwaitCaptureInvokeEventa,
  MotionQaAwaitCaptureResultSchema,
  MotionQaCommandSchema,
  motionQaConfigureInvokeEventa,
  motionQaImportModelFromInputInvokeEventa,
  MotionQaImportModelResultSchema,
  motionQaRunScenarioInvokeEventa,
  MotionQaRunScenarioResultSchema,
  motionQaStartCaptureInvokeEventa,
  MotionQaStartCaptureResultSchema,
  motionQaStateInvokeEventa,
  MotionQaStateSchema,
} from './bridge'

/** One schema problem, with its dotted path from the command root (for example `input.scenario.events.0.kind`). */
export interface MotionQaIssue {
  path: string
  message: string
}

/** What `dispatch` answers, as JSON. Every failure is an `ok: false` reply; dispatch never rejects. */
export type MotionQaResponse
  = | { ok: true, result: unknown }
    | { ok: false, error: string, issues?: MotionQaIssue[] }

function issuesOf(issues: readonly { message: string, path?: readonly { key: unknown }[] }[]): MotionQaIssue[] {
  return issues.map(issue => ({ path: (issue.path ?? []).map(item => String(item.key)).join('.'), message: issue.message }))
}

function invalid(error: string, issues: MotionQaIssue[]): MotionQaResponse {
  return { ok: false, error: `${error}: ${issues.map(issue => `${issue.path || '(root)'}: ${issue.message}`).join('; ')}`, issues }
}

/**
 * Creates the dispatcher behind `globalThis.__airiMotionQa.dispatch`.
 *
 * Use when:
 * - A remote-debug client sends one JSON command string and needs one JSON reply string
 *
 * Expects:
 * - The stage of this window registers the handlers on the same context (see `claimMotionQaHandlers`)
 *
 * Returns:
 * - `{ ok: true, result }`, where `result` passed the contract's result schema
 * - `{ ok: false, error, issues? }` for invalid JSON, a command or result that fails its schema, a missing
 *   stage, or a handler error. The promise never rejects.
 */
export function createMotionQaDispatcher(context = createMotionQaContext()) {
  const invokes = {
    state: defineInvoke(context, motionQaStateInvokeEventa),
    configure: defineInvoke(context, motionQaConfigureInvokeEventa),
    importModelFromInput: defineInvoke(context, motionQaImportModelFromInputInvokeEventa),
    startCapture: defineInvoke(context, motionQaStartCaptureInvokeEventa),
    runScenario: defineInvoke(context, motionQaRunScenarioInvokeEventa),
    awaitCapture: defineInvoke(context, motionQaAwaitCaptureInvokeEventa),
  }

  async function run(text: string): Promise<{ name: string, schema: GenericSchema, result: unknown } | MotionQaResponse> {
    let json: unknown
    try {
      json = JSON.parse(text)
    }
    catch (error) {
      return { ok: false, error: `The command is not JSON: ${errorMessageFrom(error) ?? 'unknown error'}` }
    }
    const parsed = safeParse(MotionQaCommandSchema, json)
    if (!parsed.success)
      return invalid('The command does not match the motion QA contract', issuesOf(parsed.issues))
    // An invoke without a handler would never settle.
    if (!hasMotionQaHandlers())
      return { ok: false, error: 'No stage in this window has registered the motion QA handlers yet' }

    const command = parsed.output
    switch (command.name) {
      case 'state':
        return { name: command.name, schema: MotionQaStateSchema, result: await invokes.state() }
      case 'configure':
        return { name: command.name, schema: MotionQaStateSchema, result: await invokes.configure(command.input) }
      case 'importModelFromInput':
        return { name: command.name, schema: MotionQaImportModelResultSchema, result: await invokes.importModelFromInput(command.input) }
      case 'startCapture':
        return { name: command.name, schema: MotionQaStartCaptureResultSchema, result: await invokes.startCapture(command.input) }
      case 'runScenario':
        return { name: command.name, schema: MotionQaRunScenarioResultSchema, result: await invokes.runScenario(command.input) }
      case 'awaitCapture':
        return { name: command.name, schema: MotionQaAwaitCaptureResultSchema, result: await invokes.awaitCapture(command.input) }
    }
  }

  async function respond(text: string): Promise<MotionQaResponse> {
    try {
      const outcome = await run(text)
      if ('ok' in outcome)
        return outcome
      const checked = safeParse(outcome.schema, outcome.result)
      if (!checked.success)
        return invalid(`The ${outcome.name} handler returned a result outside the contract`, issuesOf(checked.issues))
      return { ok: true, result: checked.output }
    }
    catch (error) {
      return { ok: false, error: errorMessageFrom(error) ?? 'unknown error' }
    }
  }

  return async function dispatch(command: string): Promise<string> {
    return JSON.stringify(await respond(command))
  }
}
