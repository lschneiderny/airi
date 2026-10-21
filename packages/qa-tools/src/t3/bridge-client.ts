import type {
  MotionQaAwaitCaptureInput,
  MotionQaAwaitCaptureResult,
  MotionQaConfigureInput,
  MotionQaImportModelInput,
  MotionQaImportModelResult,
  MotionQaRunScenarioInput,
  MotionQaRunScenarioResult,
  MotionQaStartCaptureInput,
  MotionQaStartCaptureResult,
  MotionQaState,
} from '@proj-airi/stage-shared/motion-scenario'
import type { GenericSchema } from 'valibot'

import { errorMessageFrom } from '@moeru/std'
import {
  MotionQaAwaitCaptureResultSchema,
  MotionQaCommandSchema,
  MotionQaImportModelResultSchema,
  MotionQaRunScenarioResultSchema,
  MotionQaStartCaptureResultSchema,
  MotionQaStateSchema,
} from '@proj-airi/stage-shared/motion-scenario'
import { safeParse } from 'valibot'

/** The part of `CdpClient` the bridge client needs; tests pass a fake. */
export interface RendererEvaluator {
  evaluate: <T>(expression: string, timeoutMs?: number) => Promise<T>
}

interface MotionQaCommands {
  state: { input: undefined, result: MotionQaState }
  configure: { input: MotionQaConfigureInput, result: MotionQaState }
  importModelFromInput: { input: MotionQaImportModelInput, result: MotionQaImportModelResult }
  startCapture: { input: MotionQaStartCaptureInput, result: MotionQaStartCaptureResult }
  runScenario: { input: MotionQaRunScenarioInput, result: MotionQaRunScenarioResult }
  awaitCapture: { input: MotionQaAwaitCaptureInput, result: MotionQaAwaitCaptureResult }
}
export type MotionQaCommandName = keyof MotionQaCommands

const resultSchemas: Record<MotionQaCommandName, GenericSchema> = {
  state: MotionQaStateSchema,
  configure: MotionQaStateSchema,
  importModelFromInput: MotionQaImportModelResultSchema,
  startCapture: MotionQaStartCaptureResultSchema,
  runScenario: MotionQaRunScenarioResultSchema,
  awaitCapture: MotionQaAwaitCaptureResultSchema,
}

/** The bridge answered `ok: false`, or its answer broke the contract. */
export class MotionQaBridgeError extends Error {}

export interface WaitForBridgeOptions {
  timeoutMs: number
  /** First retry delay; doubles up to `maxDelayMs`. */
  initialDelayMs?: number
  maxDelayMs?: number
  /** Injectable for tests. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolveSleep => setTimeout(resolveSleep, ms))

/** Answers that mean the bridge is not up yet, so `waitForBridge` retries instead of failing. */
const notReadyPattern = /No stage in this window has registered|__airiMotionQa is not installed/

/**
 * Typed client of `globalThis.__airiMotionQa.dispatch` over a renderer evaluator (CDP `Runtime.evaluate` with
 * `awaitPromise`). Commands are validated with `MotionQaCommandSchema` before they are sent and results with the
 * contract's result schema after; every call is bounded by its timeout.
 */
export class MotionQaBridgeClient {
  private pendingSeq = 0

  constructor(private readonly renderer: RendererEvaluator) {}

  private static commandText<N extends MotionQaCommandName>(name: N, input: MotionQaCommands[N]['input']): string {
    const command = input === undefined ? { name } : { name, input }
    const checked = safeParse(MotionQaCommandSchema, command)
    if (!checked.success)
      throw new MotionQaBridgeError(`Refusing to send an invalid ${name} command: ${checked.issues.map(issue => issue.message).join('; ')}`)
    return JSON.stringify(command)
  }

  private static dispatchExpression(commandText: string): string {
    return `(globalThis.__airiMotionQa ? globalThis.__airiMotionQa.dispatch(${JSON.stringify(commandText)}) : JSON.stringify({ ok: false, error: '__airiMotionQa is not installed in this window' }))`
  }

  private static readReply<N extends MotionQaCommandName>(name: N, reply: unknown): MotionQaCommands[N]['result'] {
    if (typeof reply !== 'string')
      throw new MotionQaBridgeError(`The ${name} reply is not a JSON string`)
    const parsed = JSON.parse(reply) as { ok?: unknown, result?: unknown, error?: unknown }
    if (parsed.ok !== true)
      throw new MotionQaBridgeError(`The bridge refused ${name}: ${typeof parsed.error === 'string' ? parsed.error : reply}`)
    const checked = safeParse(resultSchemas[name], parsed.result)
    if (!checked.success)
      throw new MotionQaBridgeError(`The ${name} result breaks the contract: ${checked.issues.map(issue => issue.message).join('; ')}`)
    return checked.output as MotionQaCommands[N]['result']
  }

  /** Sends one command and resolves its validated result; rejects with `MotionQaBridgeError` on `ok: false`. */
  async call<N extends MotionQaCommandName>(name: N, input: MotionQaCommands[N]['input'], timeoutMs: number): Promise<MotionQaCommands[N]['result']> {
    const reply = await this.renderer.evaluate<unknown>(MotionQaBridgeClient.dispatchExpression(MotionQaBridgeClient.commandText(name, input)), timeoutMs)
    return MotionQaBridgeClient.readReply(name, reply)
  }

  /**
   * Starts a command without awaiting it and returns the renderer's `performance.now()` (ms) at dispatch, so the
   * caller can time screenshots on the renderer clock. `settle` awaits the reply later.
   */
  async start<N extends MotionQaCommandName>(name: N, input: MotionQaCommands[N]['input'], timeoutMs: number): Promise<{ rendererStartMs: number, settle: (settleTimeoutMs: number) => Promise<MotionQaCommands[N]['result']> }> {
    const key = `qa-${++this.pendingSeq}`
    const commandText = MotionQaBridgeClient.commandText(name, input)
    const rendererStartMs = await this.renderer.evaluate<number>(`(() => {
      const pending = globalThis.__airiMotionQaPending ??= {}
      const startedAt = performance.now()
      pending[${JSON.stringify(key)}] = ${MotionQaBridgeClient.dispatchExpression(commandText)}
      return startedAt
    })()`, timeoutMs)
    if (typeof rendererStartMs !== 'number')
      throw new MotionQaBridgeError(`Starting ${name} returned no renderer time`)
    return {
      rendererStartMs,
      settle: async (settleTimeoutMs) => {
        const reply = await this.renderer.evaluate<unknown>(`(async () => {
          const pending = globalThis.__airiMotionQaPending ?? {}
          try { return await pending[${JSON.stringify(key)}] }
          finally { delete pending[${JSON.stringify(key)}] }
        })()`, settleTimeoutMs)
        return MotionQaBridgeClient.readReply(name, reply)
      },
    }
  }

  /** The renderer's `performance.now()` in ms. */
  async rendererNowMs(timeoutMs = 10_000): Promise<number> {
    return await this.renderer.evaluate<number>('performance.now()', timeoutMs)
  }

  /**
   * Polls `state` until a stage answers, retrying only while the bridge is not up yet (no dispatcher, no handlers,
   * or an evaluation that failed during a reload) with exponential backoff; throws after `timeoutMs`.
   */
  async waitForBridge(options: WaitForBridgeOptions): Promise<MotionQaState> {
    const now = options.now ?? Date.now
    const sleep = options.sleep ?? defaultSleep
    const maxDelayMs = options.maxDelayMs ?? 2_000
    const deadline = now() + options.timeoutMs
    let delay = options.initialDelayMs ?? 100
    let lastReason = 'no attempt finished'
    for (let attempt = 1; ; attempt++) {
      const remaining = deadline - now()
      if (remaining <= 0)
        throw new MotionQaBridgeError(`The motion QA bridge did not answer within ${options.timeoutMs}ms (${attempt - 1} attempts; last: ${lastReason})`)
      try {
        return await this.call('state', undefined, Math.max(1, Math.min(remaining, 10_000)))
      }
      catch (error) {
        lastReason = errorMessageFrom(error) ?? 'unknown error'
        if (error instanceof MotionQaBridgeError && !notReadyPattern.test(lastReason))
          throw error
      }
      await sleep(Math.min(delay, Math.max(0, deadline - now())))
      delay = Math.min(maxDelayMs, delay * 2)
    }
  }
}
